import { create } from "zustand";

interface FindState {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  index: number;
  count: number;
  /** 每次显式 next/prev 自增，保证重复按同一匹配也重新滚动定位。 */
  seq: number;
  replaceMode: boolean;
  replaceText: string;
  setOpen: (open: boolean) => void;
  openReplace: () => void;
  setReplaceMode: (on: boolean) => void;
  setReplaceText: (t: string) => void;
  setQuery: (q: string) => void;
  toggleCase: () => void;
  setMatches: (count: number, index: number) => void;
  next: () => void;
  prev: () => void;
  close: () => void;
}

export const useFind = create<FindState>((set, get) => ({
  open: false,
  query: "",
  caseSensitive: false,
  index: 0,
  count: 0,
  seq: 0,
  replaceMode: false,
  replaceText: "",
  setOpen: (open) => set({ open }),
  openReplace: () => set({ open: true, replaceMode: true }),
  setReplaceMode: (replaceMode) => set({ replaceMode }),
  setReplaceText: (replaceText) => set({ replaceText }),
  setQuery: (query) => set({ query, index: 0 }),
  toggleCase: () => set((s) => ({ caseSensitive: !s.caseSensitive, index: 0 })),
  setMatches: (count, index) => set({ count, index: count ? Math.min(index, count - 1) : 0 }),
  next: () => {
    const { count, index } = get();
    if (count) set((s) => ({ index: (index + 1) % count, seq: s.seq + 1 }));
  },
  prev: () => {
    const { count, index } = get();
    if (count) set((s) => ({ index: (index - 1 + count) % count, seq: s.seq + 1 }));
  },
  close: () => set({ open: false, count: 0, index: 0 }),
}));