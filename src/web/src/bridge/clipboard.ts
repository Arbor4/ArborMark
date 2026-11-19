/**
 * 统一剪贴板写入：桌面端走 Rust arboard（WKWebView 的 navigator.clipboard 常因
 * 焦点/权限拒绝），浏览器走 async Clipboard API，最后回退 execCommand。
 * 语义 HTML 同时写 text/html 与 text/plain 两种 flavor。
 */
import { invoke, isTauri } from "./ipc";

function legacyCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  return ok;
}

export async function writeClipboardText(text: string): Promise<boolean> {
  if (isTauri()) {
    try { await invoke("clipboard.write", { text }); return true; } catch { /* fall through */ }
  }
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  return legacyCopy(text);
}

export async function writeClipboardHtml(html: string, plain: string): Promise<boolean> {
  if (isTauri()) {
    try { await invoke("clipboard.write", { text: plain, html }); return true; } catch { /* fall through */ }
  }
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
  } catch { /* fall through */ }
  return writeClipboardText(plain);
}

export async function readClipboardText(): Promise<string | null> {
  if (isTauri()) {
    try { return await invoke<string>("clipboard.readText"); } catch { /* fall through */ }
  }
  try {
    if (navigator.clipboard?.readText) return await navigator.clipboard.readText();
  } catch { /* fall through */ }
  return null;
}