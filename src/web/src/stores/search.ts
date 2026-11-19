import { create } from "zustand";
import { fs, type SearchFileResult } from "@/bridge/fs";
import { useWorkspace } from "./workspace";

interface SearchState {
  query: string;
  replaceText: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegexp: boolean;
  results: SearchFileResult[];
  searching: boolean;
  error: string | null;
  expandedFiles: Set<string>;
  activeMatch: { file: string; index: number } | null;

  setQuery: (q: string) => void;
  setReplaceText: (t: string) => void;
  toggleOption: (key: "caseSensitive" | "wholeWord" | "useRegexp") => void;
  run: () => Promise<void>;
  toggleFile: (path: string) => void;
  setActiveMatch: (file: string, index: number) => void;
  replaceOne: (file: string, index: number) => Promise<void>;
  replaceAll: () => Promise<void>;
  clear: () => void;
}

let searchSeq = 0;

export const useSearch = create<SearchState>((set, get) => ({
  query: "",
  replaceText: "",
  caseSensitive: false,
  wholeWord: false,
  useRegexp: false,
  results: [],
  searching: false,
  error: null,
  expandedFiles: new Set(),
  activeMatch: null,

  setQuery: (q) => set({ query: q }),
  setReplaceText: (t) => set({ replaceText: t }),
  toggleOption: (key) => set((s) => ({ [key]: !s[key] }) as Partial<SearchState>),

  run: async () => {
    const { query, caseSensitive, wholeWord, useRegexp } = get();
    const root = useWorkspace.getState().rootPath;
    if (!root || !query.trim()) {
      set({ results: [], error: null, searching: false });
      return;
    }
    const seq = ++searchSeq;
    set({ searching: true, error: null });
    try {
      const result = await fs.search(root, query, { caseSensitive, wholeWord, useRegexp });
      if (seq !== searchSeq) return; // 过期结果丢弃
      // 归一化匹配字段：Rust 返回 column/match，mock 返回 start/end
      const files = result.files.map((f) => ({
        ...f,
        matches: (f.matches ?? []).map((m) => {
          const raw = m as typeof m & { column?: number; match?: string };
          const start = typeof raw.start === "number" ? raw.start : (raw.column ?? 0);
          const match = typeof raw.match === "string" ? raw.match : (raw.text ?? "").slice(start, typeof raw.end === "number" ? raw.end : undefined);
          const end = typeof raw.end === "number" ? raw.end : start + match.length;
          return { line: raw.line, text: raw.text ?? "", start, end, match };
        }),
      }));
      const expanded = new Set(files.slice(0, 8).map((f) => f.path));
      // 活跃文件用编辑器缓冲区重算匹配：磁盘内容可能落后于未保存修改，
      // 而跳转按缓冲区行号映射，二者必须同源
      const { activePath, content } = useWorkspace.getState();
      if (activePath) {
        const { caseSensitive: cs, wholeWord: ww, useRegexp: ur } = get();
        let re: RegExp | null = null;
        try {
          const source = ur ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          re = new RegExp(ww ? `\\b(?:${source})\\b` : source, cs ? "g" : "gi");
        } catch {
          re = null;
        }
        if (re) {
          const matches: { line: number; text: string; start: number; end: number; match: string }[] = [];
          content.split("\n").forEach((line, i) => {
            re!.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re!.exec(line)) && matches.length < 40) {
              matches.push({ line: i + 1, text: line, start: m.index, end: m.index + m[0].length, match: m[0] });
              if (m.index === re!.lastIndex) re!.lastIndex++;
            }
          });
          const idx = files.findIndex((f) => f.path === activePath);
          if (matches.length) {
            const entry = { path: activePath, name: activePath.split("/").pop() ?? activePath, dir: ".", matches };
            if (idx >= 0) files[idx] = entry;
            else files.unshift(entry);
          } else if (idx >= 0) {
            files.splice(idx, 1);
          }
        }
      }
      set({ results: files, searching: false, expandedFiles: expanded, error: result.error ?? null });
    } catch (err) {
      if (seq !== searchSeq) return;
      set({ searching: false, error: String(err), results: [] });
    }
  },

  toggleFile: (path) =>
    set((s) => {
      const next = new Set(s.expandedFiles);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { expandedFiles: next };
    }),

  setActiveMatch: (file, index) => set({ activeMatch: { file, index } }),

  replaceOne: async (file, index) => {
    const { results, replaceText, query, caseSensitive, useRegexp, wholeWord } = get();
    const fileResult = results.find((f) => f.path === file);
    const match = fileResult?.matches[index];
    if (!match) return;
    try {
      const content = await fs.readFile(file);
      const lines = content.split("\n");
      const line = lines[match.line - 1];
      if (line === undefined) return;
      let flags = caseSensitive ? "" : "i";
      let source = useRegexp ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (wholeWord) source = `\\b(?:${source})\\b`;
      const re = new RegExp(source, flags);
      // 只替换该行第 index 个匹配（跨行计数简化：按行内序号定位）
      let count = -1;
      const replaced = line.replace(re, (m) => {
        count++;
        return count === indexWithinLine(results, file, match) ? replaceText : m;
      });
      lines[match.line - 1] = replaced;
      await fs.writeFile(file, lines.join("\n"));
      // 当前打开的文件同步内容
      const ws = useWorkspace.getState();
      if (ws.activePath === file) {
        await ws.openFile(file);
      }
      await get().run();
    } catch (err) {
      set({ error: String(err) });
    }
  },

  replaceAll: async () => {
    const { results, replaceText, query, caseSensitive, useRegexp, wholeWord } = get();
    let flags = caseSensitive ? "g" : "gi";
    let source = useRegexp ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (wholeWord) source = `\\b(?:${source})\\b`;
    let re: RegExp;
    try {
      re = new RegExp(source, flags);
    } catch (err) {
      set({ error: String(err) });
      return;
    }
    let total = 0;
    for (const fileResult of results) {
      try {
        const content = await fs.readFile(fileResult.path);
        const next = content.replace(re, () => {
          total++;
          return replaceText;
        });
        if (next !== content) {
          await fs.writeFile(fileResult.path, next);
          const ws = useWorkspace.getState();
          if (ws.activePath === fileResult.path) {
            useWorkspace.setState({ content: next, savedContent: next, dirty: false });
          }
        }
      } catch {
        /* 单文件失败继续 */
      }
    }
    await get().run();
    return total as unknown as void;
  },

  clear: () =>
    set({ query: "", results: [], error: null, activeMatch: null, expandedFiles: new Set() }),
}));

function indexWithinLine(
  results: SearchFileResult[],
  file: string,
  match: { line: number; start: number },
): number {
  const fileResult = results.find((f) => f.path === file);
  if (!fileResult) return 0;
  const sameLine = fileResult.matches.filter((m) => m.line === match.line);
  return sameLine.findIndex((m) => m.start === match.start);
}