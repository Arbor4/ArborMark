import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// ArborMark 前端构建。
// - 开发期：Vite dev server（Tauri devUrl 指向这里），浏览器里也能独立跑（mock FS）。
// - 生产期：产物输出到 dist/，Tauri frontendDist 指向它；入口 index.html 由
//   Rust 侧 WebviewUrl::App("index.html") 加载。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // Tauri 期望相对路径资源（生产走自定义协议 / 文件服务）
  base: "./",
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          editor: [
            "@codemirror/state",
            "@codemirror/view",
            "@codemirror/commands",
            "@codemirror/language",
            "@codemirror/lang-markdown",
            "@codemirror/search",
            "@codemirror/autocomplete",
          ],
          preview: ["markdown-it", "dompurify", "katex", "highlight.js"],
          react: ["react", "react-dom", "zustand"],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});