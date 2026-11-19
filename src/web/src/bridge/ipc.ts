/**
 * Tauri IPC 封装。
 * - Tauri 环境：走 @tauri-apps/api 的 invoke / event；
 * - 浏览器环境：返回 mock 实现（见 mockFs.ts），让前端可独立开发验证。
 */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

let tauriInvoke: InvokeFn | null = null;

async function loadInvoke(): Promise<InvokeFn> {
  if (!tauriInvoke) {
    const mod = await import("@tauri-apps/api/core");
    tauriInvoke = mod.invoke as InvokeFn;
  }
  return tauriInvoke;
}

/**
 * 统一调用入口。通道名沿用后端 ipc_invoke 的 channel 约定：
 * invoke("fs.readFile", { path }) → ipc_invoke(channel="fs.readFile", payload={path})
 */
export async function invoke<T = unknown>(
  channel: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (isTauri()) {
    const fn = await loadInvoke();
    return (await fn("ipc_invoke", { channel, payload })) as T;
  }
  const { mockInvoke } = await import("./mockFs");
  return mockInvoke(channel, payload) as Promise<T>;
}

/** 订阅后端事件（Tauri）；浏览器环境返回空卸载函数。 */
export async function listen<T = unknown>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  const un = await tauriListen<T>(event, (e) => handler(e.payload));
  return un;
}