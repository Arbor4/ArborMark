import { create } from "zustand";

interface LightboxState {
  open: boolean;
  src: string;
  alt: string;
  raw: string;
  openImage: (src: string, alt: string, raw: string) => void;
  close: () => void;
}

export const useLightbox = create<LightboxState>((set) => ({
  open: false,
  src: "",
  alt: "",
  raw: "",
  openImage: (src, alt, raw) => set({ open: true, src, alt, raw }),
  close: () => set({ open: false }),
}));