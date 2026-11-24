import { fs } from "@/bridge/fs";
import { useUi } from "@/stores/ui";

export const CURRENT_VERSION = "4.0.1";
export const GITHUB_REPO = "Arbor4/ArborMark";

export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt?: string;
}

function compareVersions(v1: string, v2: string): number {
  const parse = (v: string) => v.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const p1 = parse(v1);
  const p2 = parse(v2);
  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const n1 = p1[i] ?? 0;
    const n2 = p2[i] ?? 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

export async function checkUpdateFromGitHub(): Promise<UpdateInfo> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API HTTP ${res.status}`);
  }
  const data = await res.json();
  const latestTag = String(data.tag_name || "").replace(/^v/i, "");
  const hasUpdate = compareVersions(latestTag, CURRENT_VERSION) > 0;
  return {
    hasUpdate,
    latestVersion: latestTag,
    releaseUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases`,
    releaseNotes: data.body || "",
    publishedAt: data.published_at,
  };
}

export async function runCheckForUpdates(interactive = true) {
  const ui = useUi.getState();
  if (interactive) {
    ui.toast("正在检查更新…", "info");
  }
  try {
    const info = await checkUpdateFromGitHub();
    if (info.hasUpdate) {
      const ok = window.confirm(
        `发现新版本 ArborMark v${info.latestVersion}（当前版本 v${CURRENT_VERSION}）！\n\n更新说明：\n${info.releaseNotes.slice(0, 300)}${info.releaseNotes.length > 300 ? "..." : ""}\n\n是否前往 GitHub Releases 下载更新？`
      );
      if (ok) {
        await fs.openExternal(info.releaseUrl);
      }
    } else if (interactive) {
      ui.toast(`已是最新版本 (v${CURRENT_VERSION})`, "success");
    }
  } catch {
    if (interactive) {
      ui.toast("检查更新失败，请检查网络连接", "danger");
    }
  }
}
