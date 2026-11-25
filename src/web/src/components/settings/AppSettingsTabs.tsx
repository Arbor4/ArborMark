import { useState, useRef } from "react";
import {
  PenLine,
  TreePine,
  Download,
  Upload,
  Sparkles,
  Trash2,
  Compass,
  RotateCcw,
  RefreshCw,
  Plus,
} from "lucide-react";
import { useUi } from "@/stores/ui";
import { exportSettings, pickAndImportSettings } from "@/bridge/settingsTransfer";
import { CURRENT_VERSION } from "@/bridge/updater";
import { readConfig, writeConfig, defaultConfig, type WebSearchConfig } from "@/bridge/webSearch";
import { CelebrationLayer, type CelebrationHandle } from "./Celebration";
import { showOnboarding } from "../Onboarding";
import { useLang } from "@/bridge/i18n";
import { invoke } from "@/bridge/ipc";
import { Switch } from "../common";
import { Section, Row, PrefSwitch, Select } from "./SettingsPrimitives";

export function WebSearchSettings() {
  const { t } = useLang();
  const [cfg, setCfg] = useState<WebSearchConfig>(() => readConfig());
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const update = (fn: (c: WebSearchConfig) => WebSearchConfig) => {
    setCfg((prev) => {
      const next = fn(prev);
      writeConfig(next);
      return next;
    });
  };
  const addCustom = () => {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name || !url || !/%s|\{关键词\}|\{query\}|\{keyword\}/.test(url)) {
      useUi.getState().toast("自定义引擎需含名称与带 %s 或 {关键词} 的 URL", "warning");
      return;
    }
    update((c) => ({ ...c, engines: [...c.engines, { id: `custom-${Date.now()}`, name, url, enabled: true }] }));
    setNewName("");
    setNewUrl("");
  };
  return (
    <div>
      <Section title={t("选中文本搜索")}>
        <Row label={t("启用网络搜索")} hint={t("选中文本后可一键跳转到搜索引擎 / AI 问答")} control={<Switch checked={cfg.enabled} label={t("启用网络搜索")} onChange={(v) => update((c) => ({ ...c, enabled: v }))} />} />
        <Row label={t("选中气泡")} hint={t("选中文本后浮现搜索气泡")} control={<Switch checked={cfg.bubble} label={t("选中气泡")} onChange={(v) => update((c) => ({ ...c, bubble: v }))} />} />
        <Row label={t("右键菜单入口")} hint={t("在右键菜单显示「网络搜索」分组")} control={<Switch checked={cfg.contextMenu} label={t("右键菜单入口")} onChange={(v) => update((c) => ({ ...c, contextMenu: v }))} />} />
        <Row
          label={t("默认引擎")}
          hint={t("气泡主按钮与首选搜索目标")}
          control={
            <Select
              value={cfg.defaultId}
              onChange={(v) => update((c) => ({ ...c, defaultId: v }))}
              ariaLabel="默认搜索引擎"
              options={cfg.engines.filter((e) => e.enabled).map((e) => [e.id, e.name] as [string, string])}
            />
          }
        />
      </Section>
      <Section title={t("搜索引擎")}>
        {cfg.engines.map((e) => (
          <div key={e.id}>
            <Row
              label={e.name}
              hint={e.url}
              control={
                <span className="flex items-center gap-1.5">
                  <Switch checked={e.enabled} label={`启用 ${e.name}`} onChange={(v) => update((c) => ({ ...c, engines: c.engines.map((x) => (x.id === e.id ? { ...x, enabled: v } : x)) }))} />
                  <button
                    aria-label={`编辑 ${e.name}`}
                    onClick={() => { setEditId(editId === e.id ? null : e.id); setEditName(e.name); setEditUrl(e.url); }}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
                  >
                    <PenLine size={12} />
                  </button>
                  <button aria-label={`删除 ${e.name}`} onClick={() => update((c) => ({ ...c, engines: c.engines.filter((x) => x.id !== e.id), defaultId: c.defaultId === e.id ? (c.engines.find((x) => x.id !== e.id && x.enabled)?.id ?? c.defaultId) : c.defaultId }))} className="flex h-6 w-6 items-center justify-center rounded-md text-ink-muted hover:bg-danger/10 hover:text-danger">
                    <Trash2 size={13} />
                  </button>
                </span>
              }
            />
            {editId === e.id && (
              <div className="mb-2 ml-4 flex items-center gap-2 rounded-md border border-line bg-hover p-2">
                <input value={editName} onChange={(ev) => setEditName(ev.target.value)} aria-label={t("引擎名称")} className="h-7 w-[90px] rounded-md border border-line bg-field px-2 text-[12px] text-ink outline-none focus:border-accent" />
                <input value={editUrl} onChange={(ev) => setEditUrl(ev.target.value)} aria-label={t("引擎 URL")} className="h-7 flex-1 rounded-md border border-line bg-field px-2 font-mono text-[11px] text-ink outline-none focus:border-accent" />
                <button
                  onClick={() => {
                    if (!editName.trim() || !/%s|\{关键词\}|\{query\}|\{keyword\}/.test(editUrl)) { useUi.getState().toast("URL 需含 %s 或 {关键词} 占位符", "warning"); return; }
                    update((c) => ({ ...c, engines: c.engines.map((x) => (x.id === e.id ? { ...x, name: editName.trim(), url: editUrl.trim() } : x)) }));
                    setEditId(null);
                  }}
                  className="h-7 rounded-md bg-accent px-2.5 text-[11.5px] text-on-accent hover:bg-accent-hover"
                >{t("保存")}</button>
              </div>
            )}
          </div>
        ))}
        <div className="mt-2 flex items-center gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("名称")} aria-label={t("自定义引擎名称")} className="h-8 w-[100px] rounded-md border border-line bg-field px-2 text-[12px] text-ink outline-none focus:border-accent" />
          <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://…?q=%s 或 {关键词}" aria-label={t("自定义引擎 URL")} className="h-8 flex-1 rounded-md border border-line bg-field px-2 font-mono text-[12px] text-ink outline-none focus:border-accent" />
          <button onClick={addCustom} className="flex h-8 items-center gap-1 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink"><Plus size={13} /> {t("添加")}</button>
          <button onClick={() => update((c) => ({ ...c, engines: defaultConfig().engines, defaultId: "baidu" }))} className="flex h-8 items-center gap-1 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink">{t("恢复默认")}</button>
        </div>
        <p className="mt-2 text-[11px] text-ink-muted">{"%s 或 {关键词} 为选中文本占位符；DeepSeek 默认携带 autosend/search/thinking 参数。"}</p>
      </Section>
    </div>
  );
}

export function GeneralSettings() {
  const { t } = useLang();
  const prefs = useUi((s) => s.prefs);
  const setPref = useUi((s) => s.setPref);
  const resetPrefs = useUi((s) => s.resetPrefs);
  const bool = (k: string) => prefs[k] !== false;
  return (
    <div>
      <Section title={t("语言与更新")}>
        <Row
          label={t("界面语言")}
          control={
            <Select
              value={String(prefs.language ?? "zh-Hans")}
              onChange={(v) => {
                setPref("language", v);
                invoke("setting.set", { userLanguage: v === "system" ? "" : v }).catch(() => {});
              }}
              ariaLabel={t("界面语言")}
              options={[
                ["system", t("跟随系统")],
                ["zh-Hans", "简体中文"],
                ["zh-Hant", "繁體中文"],
                ["en", "English"],
                ["ja-JP", "日本語"],
                ["ko-KR", "한국어"],
                ["de-DE", "Deutsch"],
                ["fr-FR", "Français"],
                ["es-ES", "Español"],
                ["ru-RU", "Русский"],
                ["it-IT", "Italiano"],
                ["pt-BR", "Português (Brasil)"],
                ["nl-NL", "Nederlands"],
                ["pl-PL", "Polski"],
                ["tr-TR", "Türkçe"],
                ["ar-SA", "العربية"],
              ]}
            />
          }
        />
        <Row label={t("自动检查更新")} control={<Switch checked={bool("autoCheckUpdate")} label={t("自动检查更新")} onChange={(v) => setPref("autoCheckUpdate", v)} />} />
        <Row
          label={t("检查更新")}
          hint={`${t("当前版本")} v${CURRENT_VERSION}`}
          control={
            <button
              onClick={() => {
                import("@/bridge/updater").then(({ runCheckForUpdates }) => runCheckForUpdates(true));
              }}
              className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
            >
              <RefreshCw size={12} />
              {t("立即检查")}
            </button>
          }
        />
      </Section>
      <Section title={t("会话与文件树")}>
        <Row label={t("启动时恢复上次会话")} hint={t("重新打开上次的文件夹与文档")} control={<Switch checked={bool("restoreSession")} label={t("恢复会话")} onChange={(v) => setPref("restoreSession", v)} />} />
        <PrefSwitch k="showHiddenFiles" label={t("显示隐藏文件")} hint={t("文件树中显示以 . 开头的文件")} def={false} />
      </Section>
      <Section title={t("设置备份与迁移")}>
        <Row
          label={t("导出设置")}
          hint={t("将当前偏好保存为 JSON 文件，便于备份或迁移")}
          control={
            <button
              onClick={async () => {
                const r = await exportSettings();
                const ui = useUi.getState();
                if (r.status === "saved") ui.toast(t("设置已导出"), "success");
                else if (r.status === "error") ui.toast(`${t("导出失败")}：${r.error ?? "未知错误"}`, "danger");
              }}
              className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
            >
              <Download size={13} /> {t("导出…")}
            </button>
          }
        />
        <Row
          label={t("导入设置")}
          hint={t("从 JSON 文件恢复偏好（覆盖当前设置）")}
          control={
            <button
              onClick={async () => {
                const r = await pickAndImportSettings();
                const ui = useUi.getState();
                if (r.status === "imported") ui.toast(t("设置已导入并应用"), "success");
                else if (r.status === "error") ui.toast(`${t("导入失败")}：${r.error ?? "文件格式无效"}`, "danger");
              }}
              className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
            >
              <Upload size={13} /> {t("导入…")}
            </button>
          }
        />
      </Section>
      <Section title={t("重置选项")}>
        <Row
          label={t("恢复默认偏好设置")}
          hint={t("将所有偏好设置重置为初始默认值")}
          control={
            <button
              onClick={async () => {
                const ui = useUi.getState();
                const ok = await ui.confirm({
                  title: t("恢复默认偏好设置"),
                  message: t("确定要恢复默认偏好设置吗？"),
                  confirmText: t("恢复默认"),
                  danger: true,
                });
                if (ok) {
                  resetPrefs();
                  ui.toast(t("已恢复默认偏好设置"), "success");
                }
              }}
              className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
            >
              <RotateCcw size={13} /> {t("恢复默认")}
            </button>
          }
        />
        <Row
          label={t("重置全部警告提示对话框")}
          hint={t("恢复所有被勾选「不再提示」的确认弹窗")}
          control={
            <button
              onClick={() => {
                try {
                  localStorage.removeItem("arbor.dismissed_dialogs");
                  useUi.getState().toast(t("已重置所有警告提示"), "success");
                } catch {
                  /* ignore */
                }
              }}
              className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
            >
              <RotateCcw size={13} /> {t("重置对话框")}
            </button>
          }
        />
      </Section>
    </div>
  );
}

export function ShortcutSettings() {
  const { t } = useLang();
  const isMac = typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);
  const groups: { title: string; items: [string, string][] }[] = [
    {
      title: t("文件"),
      items: [
        ["新建文件", "⌘N"],
        ["保存", "⌘S"],
        ["快速打开", "⌘P"],
        ["全局搜索", "⌘⇧F"],
        ["打开文件夹", "⌘O"],
      ],
    },
    {
      title: t("段落与标题"),
      items: [
        ["一阶 ~ 六阶标题", isMac ? "⌘1 ~ ⌘6" : "Ctrl+1 ~ 6"],
        ["普通段落", isMac ? "⌘0" : "Ctrl+0"],
      ],
    },
    {
      title: t("视图"),
      items: [
        ["文件 / 大纲面板", isMac ? "⌘⇧2 / ⌘⇧1" : "Ctrl+Shift+2 / 1"],
        ["收起 / 展开侧边栏", isMac ? "⌘\\ / ⌘⇧L" : "Ctrl+\\ / Ctrl+Shift+L"],
        ["编辑 / 源码", isMac ? "⌘/" : "Ctrl+/"],
        ["专注模式", isMac ? "⌘⇧D" : "Ctrl+Shift+D"],
        ["偏好设置", isMac ? "⌘," : "Ctrl+,"],
      ],
    },
    {
      title: t("编辑"),
      items: [
        ["加粗 / 斜体 / 行内代码", "⌘B / I / ⌘E"],
        ["删除线", "⌘⇧X"],
        ["查找 / 替换（当前文件）", "⌘F / ⌘⌥F"],
        ["撤销 / 重做", "⌘Z / ⇧Z"],
      ],
    },
    {
      title: t("文件树"),
      items: [
        ["重命名", "F2"],
        ["删除所选", "⌫"],
        ["连选 / 多选", "Shift 点击 / ⌘点击"],
        ["移动文件", "拖拽到目标文件夹"],
      ],
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-x-6">
      {groups.map((g) => (
        <Section key={g.title} title={g.title}>
          {g.items.map(([label, keys]) => (
            <div key={label} className="flex items-center justify-between border-b border-line py-2 last:border-0">
              <span className="text-[12px] text-ink-secondary">{t(label)}</span>
              <kbd className="rounded border border-line bg-field px-1.5 py-0.5 font-mono text-[10.5px] text-ink">
                {t(keys)}
              </kbd>
            </div>
          ))}
        </Section>
      ))}
    </div>
  );
}

export function AboutSettings() {
  const celeb = useRef<CelebrationHandle>(null);
  const { t } = useLang();
  return (
    <div className="relative flex h-full flex-col items-center justify-center text-center">
      <CelebrationLayer ref={celeb} />
      <button
        aria-label={t("about.celebrate")}
        title={t("about.celebrate")}
        onClick={(e) => celeb.current?.fire(e.clientX, e.clientY)}
        className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent transition-transform hover:scale-105 active:scale-95"
      >
        <TreePine size={30} strokeWidth={1.6} />
      </button>
      <h2 className="text-[18px] font-semibold text-ink">ArborMark</h2>
      <p className="mt-1 text-[12px] text-ink-muted">{t("about.version")}</p>
      <p className="mt-4 max-w-[360px] text-[12.5px] leading-relaxed text-ink-secondary">
        {t("about.body")}
      </p>
      <div className="mt-5 flex items-center gap-2">
        <button
          onClick={() => showOnboarding()}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
        >
          <Compass size={13} /> {t("about.reopen")}
        </button>
        <button
          onClick={() => celeb.current?.fire()}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
        >
          <Sparkles size={13} /> {t("about.celebrate")}
        </button>
      </div>
      <p className="mt-6 text-[11px] text-ink-muted">GPL-3.0-or-later · ArborMark Team</p>
    </div>
  );
}
