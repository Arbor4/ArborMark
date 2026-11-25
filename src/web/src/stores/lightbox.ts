import { create } from "zustand";

export type LightboxKind = "image" | "svg" | "math";

interface LightboxState {
  open: boolean;
  kind: LightboxKind;
  src: string;
  alt: string;
  raw: string;
  svg: string;
  width: number;
  height: number;
  tex: string;
  title: string;
  openImage: (src: string, alt: string, raw: string) => void;
  openSvg: (svg: string, width: number, height: number, title: string) => void;
  openMath: (tex: string, title: string) => void;
  close: () => void;
}

export const useLightbox = create<LightboxState>((set) => ({
  open: false,
  kind: "image",
  src: "",
  alt: "",
  raw: "",
  svg: "",
  width: 0,
  height: 0,
  tex: "",
  title: "",
  openImage: (src, alt, raw) =>
    set({ open: true, kind: "image", src, alt, raw, svg: "", width: 0, height: 0, tex: "", title: alt }),
  openSvg: (svg, width, height, title) =>
    set({ open: true, kind: "svg", src: "", alt: title, raw: "", svg, width, height, tex: "", title }),
  openMath: (tex, title) =>
    set({ open: true, kind: "math", src: "", alt: title, raw: "", svg: "", width: 0, height: 0, tex, title }),
  close: () => set({ open: false }),
}));
