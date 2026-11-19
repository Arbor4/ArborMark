/**
 * 轻量 DOM tooltip：供非 React 的 node view 按钮使用（如表格操作栏）。
 * 原生 title 延迟约 1s，这里 80ms 即显，视觉与全局 Tooltip 一致；
 * 单例元素，mouseleave / 点击 / 滚动即隐藏。
 */
let el: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function ensureEl(): HTMLDivElement {
  if (!el) {
    el = document.createElement("div");
    el.className =
      "am-pop-in pointer-events-none fixed z-[9999] rounded-md border border-line bg-elevated px-2.5 py-1 text-[11.5px] text-ink shadow-menu";
    el.style.translate = "-50% -100%";
    el.style.display = "none";
    document.body.appendChild(el);
    document.addEventListener("scroll", hide, true);
  }
  return el;
}

function hide() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (el) el.style.display = "none";
}

/** 悬浮 delay 毫秒后在目标上方显示提示文字。 */
export function attachFastTooltip(target: HTMLElement, label: string, delay = 80) {
  target.addEventListener("mouseenter", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!target.isConnected) return;
      const rect = target.getBoundingClientRect();
      const e = ensureEl();
      e.textContent = label;
      e.style.left = `${rect.left + rect.width / 2}px`;
      e.style.top = `${rect.top - 6}px`;
      e.style.display = "block";
    }, delay);
  });
  target.addEventListener("mouseleave", hide);
  target.addEventListener("mousedown", hide);
  target.addEventListener("click", hide);
}