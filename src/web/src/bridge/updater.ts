import { fs } from "@/bridge/fs";
import { t } from "@/bridge/i18n";
import { invoke, isTauri } from "@/bridge/ipc";
import { useUi } from "@/stores/ui";

export const CURRENT_VERSION = "4.0.4";
export const GITHUB_REPO = "Arbor4/ArborMark";

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
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

async function fetchFromBrowserApi(includeBeta: boolean): Promise<UpdateInfo> {
  const url = includeBeta
    ? `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`
    : `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API HTTP ${res.status}`);
  }
  const raw = await res.json();
  const data = Array.isArray(raw) ? raw[0] ?? {} : raw;
  const latestTag = String(data.tag_name || "").replace(/^v/i, "");
  const hasUpdate = compareVersions(latestTag, CURRENT_VERSION) > 0;
  return {
    hasUpdate,
    currentVersion: CURRENT_VERSION,
    latestVersion: latestTag,
    releaseUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases`,
    releaseNotes: data.body || "",
    publishedAt: data.published_at,
  };
}

export async function checkUpdateFromGitHub(): Promise<UpdateInfo> {
  const channel = String(useUi.getState().prefs.updateChannel ?? "stable");
  const includeBeta = channel === "beta";
  if (isTauri()) {
    try {
      const res = await invoke<{
        currentVersion?: string;
        latestVersion?: string;
        releaseUrl?: string;
        releaseNotes?: string;
        publishedAt?: string;
      }>("updater.checkForUpdates", { channel });
      const current = res?.currentVersion || CURRENT_VERSION;
      const latest = String(res?.latestVersion || "").replace(/^v/i, "");
      if (latest) {
        return {
          hasUpdate: compareVersions(latest, current) > 0,
          currentVersion: current,
          latestVersion: latest,
          releaseUrl: res.releaseUrl || `https://github.com/${GITHUB_REPO}/releases`,
          releaseNotes: res.releaseNotes || "",
          publishedAt: res.publishedAt || undefined,
        };
      }
    } catch {
      /* 桌面端原生 curl 失败（例如系统 PAC 代理仅浏览器可见）时，回退到浏览器 fetch */
    }
  }
  return fetchFromBrowserApi(includeBeta);
}

export async function runCheckForUpdates(interactive = true) {
  const ui = useUi.getState();
  if (interactive) {
    ui.toast(t("正在检查更新…"), "info");
  }
  try {
    const info = await checkUpdateFromGitHub();
    if (info.hasUpdate) {
      const notes = info.releaseNotes.trim();
      const notesBlock = notes
        ? `\n\n${t("更新说明：")}\n${notes.slice(0, 300)}${notes.length > 300 ? "..." : ""}`
        : "";
      const ok = await ui.confirm({
        title: t("发现新版本"),
        message: `${t("发现新版本 ArborMark v{latest}（当前版本 v{current}）！", {
          latest: info.latestVersion,
          current: info.currentVersion,
        })}${notesBlock}\n\n${t("是否前往 GitHub Releases 下载更新？")}`,
        confirmText: t("前往下载"),
        cancelText: t("稍后再说"),
      });
      if (ok) {
        await fs.openExternal(info.releaseUrl);
      }
    } else if (interactive) {
      ui.toast(t("已是最新版本 (v{v})", { v: info.currentVersion }), "success");
    }
  } catch {
    if (interactive) {
      ui.toast(t("检查更新失败，请检查网络连接"), "danger");
    }
  }
}
