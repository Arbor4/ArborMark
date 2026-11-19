import { create } from "zustand";

export interface LinkEditState {
  open: boolean;
  x: number;
  y: number;
  from: number;
  to: number;
  text: string;
  href: string;
  title: string;
  openLink: (p: { x: number; y: number; from: number; to: number; text: string; href: string; title: string }) => void;
  close: () => void;
}

export const useLinkEdit = create<LinkEditState>((set) => ({
  open: false,
  x: 0, y: 0, from: 0, to: 0, text: "", href: "", title: "",
  openLink: (p) => set({ open: true, ...p }),
  close: () => set({ open: false }),
}));