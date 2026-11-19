/**
 * 编辑区 → 大纲 滚动联动：监听活跃编辑器滚动容器，计算视口顶部当前标题，
 * 写入 ui.outlineActive（key = "level:text"），大纲面板据此高亮并滚入视口。
 * rAF 节流 + key 去重；内容变化时也重新计算。
 */
import { editorViewCtx } from "@milkdown/core";
import { getMilkdown, getCm6 } from "./activeEditor";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { extractOutline } from "./preview";

const THRESHOLD = 96;

let raf = 0;
let lastKey: string | null = null;

function computeKey(): string | null {
  const ui = useUi.getState();
  // 关键性能优化：大纲面板未显示或未开启高亮时，滚动时直接跳过计算，杜绝 Layout Thrashing
  if (!ui.sidebarVisible || ui.panel !== "outline" || ui.prefs.outlineHeadingHighlight === false) {
    return null;
  }

  const md = getMilkdown();
  if (md) {
    const host = document.querySelector<HTMLElement>(".am-milkdown-host");
    const scroller = host?.parentElement;
    if (!host || !scroller) return null;

    const scrollTop = scroller.scrollTop;
    const targetScroll = scrollTop + THRESHOLD;
    const headings = host.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");
    if (!headings.length) return null;

    let match: HTMLElement | null = null;
    // 从前往后扫描，定位距离当前视口顶部最近的有效标题
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      if (h.offsetTop <= targetScroll) {
        match = h;
      } else {
        break;
      }
    }
    if (!match) match = headings[0];
    const level = Number(match.tagName.slice(1)) || 1;
    return `${level}:${(match.textContent ?? "").trim()}`;
  }
  const cm = getCm6();
  if (cm) {
    const line = cm.state.doc.lineAt(cm.lineBlockAtHeight(cm.scrollDOM.scrollTop + THRESHOLD).from).number;
    let key: string | null = null;
    for (const item of extractOutline(useWorkspace.getState().content)) {
      if (item.line <= line) key = `${item.level}:${item.text}`;
      else break;
    }
    return key;
  }
  return null;
}

function tick() {
  raf = 0;
  // 偏好「大纲高亮当前标题」关闭：清空联动高亮，不再跟随滚动
  if (useUi.getState().prefs.outlineHeadingHighlight === false) {
    if (lastKey !== null) {
      lastKey = null;
      useUi.getState().setOutlineActive(null);
    }
    return;
  }
  const key = computeKey();
  if (key !== lastKey) {
    lastKey = key;
    useUi.getState().setOutlineActive(key);
  }
}

function schedule() {
  if (!raf) raf = requestAnimationFrame(tick);
}

function currentScroller(): HTMLElement | null {
  if (getMilkdown()) return document.querySelector<HTMLElement>(".am-milkdown-host")?.parentElement ?? null;
  return getCm6()?.scrollDOM ?? null;
}

/**
 * 全局安装（App 挂载一次）：document 捕获阶段监听 scroll，
 * 仅当事件来自当前活跃编辑器的滚动容器时重算——避免模式切换时容器重建带来的绑定时机问题。
 */
export function installOutlineSync(): () => void {
  const onScroll = (e: Event) => {
    if (e.target === currentScroller()) schedule();
  };
  document.addEventListener("scroll", onScroll, true);
  const unsub = useWorkspace.subscribe(schedule);
  schedule();
  return () => {
    document.removeEventListener("scroll", onScroll, true);
    unsub();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
}

/** 模式/文件切换后主动重算一次。 */
export function refreshOutlineSync() {
  schedule();
}

/** 文件切换时清空高亮，避免残留旧文档的 key。 */
export function resetOutlineSync() {
  lastKey = null;
  useUi.getState().setOutlineActive(null);
}