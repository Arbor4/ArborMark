import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { TreePine, PenLine, Search, Image as ImageIcon, Palette, PartyPopper, ChevronLeft, ChevronRight, Sun, Moon, Monitor, Check, ArrowUp, ArrowDown, Code2, Sigma, Workflow, Settings2 } from "lucide-react";
import { useLang } from "@/bridge/i18n";
import { useUi } from "@/stores/ui";
import { getAllThemes, getCurrentThemeId, getThemeMode, setThemeMode, applyTheme, isDarkActive, subscribeThemes, resolveTokens } from "@/theme/registry";
import { CelebrationLayer, type CelebrationHandle } from "./settings/Celebration";

const LS_KEY = "arbor.onboarded";

/** 供「关于」页等外部入口重新打开欢迎引导。 */
export function showOnboarding() {
  window.dispatchEvent(new CustomEvent("am:onboarding"));
}

interface Step { icon: typeof TreePine; zh: { title: string; body: string[] }; en: { title: string; body: string[] } }

const STEPS: Step[] = [
  {
    icon: TreePine,
    zh: { title: "欢迎使用 ArborMark", body: ["一款轻量、现代的本地 Markdown 编辑器。", "所见即所得：输入即渲染，无需切换预览。", "你的文档只保存在本机，隐私安全。"] },
    en: { title: "Welcome to ArborMark", body: ["A lightweight, modern local Markdown editor.", "WYSIWYG: type and see rendering instantly.", "Your documents stay on your device."] },
  },
  {
    icon: PenLine,
    zh: { title: "两种编辑视图", body: ["编辑态：在渲染结果上直接原位编辑表格、代码、公式。", "源码态：⌘/ 一键切换纯 Markdown，光标位置保持。", "悬浮工具栏与右键菜单提供常用格式化。"] },
    en: { title: "Two editing views", body: ["Edit: in-place editing of tables, code and math on the rendered result.", "Source: ⌘/ toggles raw Markdown, cursor preserved.", "Floating toolbar & context menu for formatting."] },
  },
  {
    icon: Search,
    zh: { title: "搜索与替换", body: ["⌘F 文件内搜索、⌘R 替换，双模式高亮定位。", "⌘⇧F 跨文件全局搜索，点击跳转并选中文件。", "选中文本可一键网络搜索（百度 / DeepSeek 等，可配置）。"] },
    en: { title: "Search & replace", body: ["⌘F find, ⌘R replace with dual-mode highlights.", "⌘⇧F global search across files.", "Select text to web-search (Baidu / DeepSeek, configurable)."] },
  },
  {
    icon: ImageIcon,
    zh: { title: "图片与多媒体", body: ["拖拽 / 粘贴图片自动落盘并插入相对路径。", "单击图片进入源码编辑行，双击打开放大模态。", "支持 KaTeX 公式、Mermaid 图表与代码高亮。"] },
    en: { title: "Images & media", body: ["Drag / paste images to save & insert relative paths.", "Single-click for source row, double-click to zoom.", "KaTeX math, Mermaid diagrams and code highlighting."] },
  },
  {
    icon: Palette,
    zh: { title: "个性化", body: ["偏好设置 → 外观：浅色 / 深色 / 跟随系统与自定义主题。", "通用：语言切换（中文 / English）。", "设置可导出 / 导入，便于备份与迁移。"] },
    en: { title: "Make it yours", body: ["Preferences → Appearance: light / dark / system & custom themes.", "General: language switch (中文 / English).", "Export / import settings for backup."] },
  },
  {
    icon: PartyPopper,
    zh: { title: "准备就绪！", body: ["一切就绪，开始你的写作之旅。", "提示：⌘\\ 可收起全部界面进入沉浸模式。", "祝你写作愉快！"] },
    en: { title: "You're all set!", body: ["Everything is ready — start writing.", "Tip: ⌘\\ hides all chrome for focus mode.", "Happy writing!"] },
  },
];

const Kbd = ({ k }: { k: string }) => (
  <kbd className="rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[10.5px] text-ink-secondary">{k}</kbd>
);

const Tile = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col rounded-lg border border-line bg-panel p-2.5">
    <div className="flex flex-1 items-center justify-center overflow-hidden">{children}</div>
    <p className="mt-1.5 truncate text-[10px] text-ink-muted">{label}</p>
  </div>
);

/** 第 2–6 步的示例面板：把固定内容区填实，避免统一尺寸后大面积留白。 */
function StepDemo({ step }: { step: number }) {
  const { lang, t } = useLang();
  const themeId = useSyncExternalStore(subscribeThemes, getCurrentThemeId);
  const mode = useSyncExternalStore(subscribeThemes, getThemeMode);
  const themeName = getAllThemes().find((th) => th.id === themeId)?.name ?? "";

  if (step === 1) {
    return (
      <div className="grid h-[200px] grid-cols-2 gap-2 text-left">
        <div className="flex flex-col rounded-lg border border-line bg-panel p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{t("onboard.demo.source")} ⌘/</p>
          <pre className="font-mono text-[11px] leading-relaxed text-ink-secondary">{"# 标题\n\n- 列表项\n**加粗** 与 `代码`"}</pre>
        </div>
        <div className="flex flex-col rounded-lg border border-line bg-elevated p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{t("onboard.demo.render")}</p>
          <p className="text-[14px] font-semibold text-ink">标题</p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-secondary">
            <span className="h-1 w-1 shrink-0 rounded-full bg-accent" /> 列表项
          </p>
          <p className="mt-1.5 text-[11.5px] text-ink-secondary">
            <strong className="font-semibold text-ink">加粗</strong> 与 <code className="rounded bg-accent-soft px-1 text-accent">代码</code>
          </p>
        </div>
      </div>
    );
  }
  if (step === 2) {
    const parts = t("onboard.demo.sentence").split("Markdown");
    return (
      <div className="flex h-[200px] flex-col gap-2 text-left">
        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-2">
          <Search size={12} className="shrink-0 text-ink-muted" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink">Markdown</span>
          <span className="text-[10.5px] text-ink-muted">2/2</span>
          {["Aa", "|ab|", ".*"].map((s) => (
            <span key={s} className="rounded border border-line px-1 font-mono text-[9.5px] text-ink-muted">{s}</span>
          ))}
          <ArrowUp size={12} className="text-ink-muted" />
          <ArrowDown size={12} className="text-ink-muted" />
        </div>
        <p className="rounded-lg border border-line bg-panel px-2.5 py-2 text-[12px] leading-relaxed text-ink-secondary">
          {parts.map((p, i) => (
            <span key={i}>
              {i > 0 && <mark className="rounded bg-accent-soft px-0.5 text-accent">Markdown</mark>}
              {p}
            </span>
          ))}
        </p>
        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-2">
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-muted">{t("onboard.demo.replace")}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink">MD</span>
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10.5px] text-accent">{t("onboard.demo.replace")}</span>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          <Kbd k="⌘F" /><Kbd k="⌘R" /><Kbd k="⌘⇧F" />
        </div>
      </div>
    );
  }
  if (step === 3) {
    return (
      <div className="grid h-[200px] grid-cols-2 gap-2 text-left">
        <Tile label={t("onboard.demo.math")}>
          <span className="font-serif text-[16px] italic text-ink">E = mc²</span>
        </Tile>
        <Tile label={t("onboard.demo.diagram")}>
          <svg viewBox="0 0 120 36" className="h-9 w-full text-ink-secondary" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="2" y="10" width="30" height="16" rx="3" />
            <rect x="45" y="10" width="30" height="16" rx="3" />
            <rect x="88" y="10" width="30" height="16" rx="3" />
            <path d="M32 18h13m-4-4 4 4-4 4M75 18h13m-4-4 4 4-4 4" />
          </svg>
        </Tile>
        <Tile label={t("onboard.demo.code")}>
          <code className="font-mono text-[10.5px]">
            <span className="text-accent">const</span> <span className="text-ink">x</span> = <span className="text-warn">42</span>
          </code>
        </Tile>
        <Tile label={t("onboard.demo.image")}>
          <span className="flex h-10 w-full items-center justify-center rounded border border-dashed border-line text-ink-muted">
            <ImageIcon size={16} />
          </span>
        </Tile>
      </div>
    );
  }
  if (step === 4) {
    const cells: [string, string, typeof Settings2][] = [
      ["⌘,", t("onboard.demo.prefs"), Settings2],
      ["⌘\\", t("onboard.demo.immersive"), Monitor],
      ["⌘⇧D", t("onboard.demo.focus"), PenLine],
      ["⌘+ / ⌘-", t("onboard.demo.zoom"), Search],
    ];
    return (
      <div className="grid h-[200px] grid-cols-2 gap-2 text-left">
        {cells.map(([k, label, Icon]) => (
          <div key={k} className="flex flex-col items-center justify-center gap-2 rounded-lg border border-line bg-panel p-2.5">
            <Icon size={16} className="text-accent" />
            <Kbd k={k} />
            <p className="text-[10.5px] text-ink-muted">{label}</p>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex h-[200px] flex-col gap-2 text-left">
      <div className="rounded-lg border border-line bg-panel p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{t("onboard.demo.recap")}</p>
        <div className="flex flex-wrap gap-1.5">
          {[lang === "en" ? "English" : "简体中文", t(`theme.${mode}`), themeName].map((v) => (
            <span key={v} className="rounded-md bg-accent-soft px-2 py-1 text-[11px] font-medium text-accent">{v}</span>
          ))}
        </div>
      </div>
      <div className="flex-1 rounded-lg border border-line bg-panel p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{t("onboard.demo.hotkeys")}</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11.5px] text-ink-secondary">
          {([["⌘N", t("onboard.demo.new")], ["⌘P", t("onboard.demo.quick")], ["⌘S", t("onboard.demo.save")], ["⌘/", t("onboard.demo.view")]] as const).map(([k, label]) => (
            <span key={k} className="flex items-center gap-1.5"><Kbd k={k} /> {label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Onboarding() {
  const { lang, t } = useLang();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const celeb = useRef<CelebrationHandle>(null);
  const fired = useRef(false);
  const themeId = useSyncExternalStore(subscribeThemes, getCurrentThemeId);
  const mode = useSyncExternalStore(subscribeThemes, getThemeMode);
  const dark = isDarkActive();
  const themes = getAllThemes();

  useEffect(() => {
    try { setOpen(localStorage.getItem(LS_KEY) !== "1"); } catch { setOpen(false); }
    const reopen = () => { fired.current = false; setStep(0); setOpen(true); };
    window.addEventListener("am:onboarding", reopen);
    return () => window.removeEventListener("am:onboarding", reopen);
  }, []);

  useEffect(() => {
    if (open && step === STEPS.length - 1 && !fired.current) {
      fired.current = true;
      const id = setTimeout(() => celeb.current?.fire(), 250);
      return () => clearTimeout(id);
    }
  }, [open, step]);

  if (!open) return null;
  const finish = () => {
    try { localStorage.setItem(LS_KEY, "1"); } catch { /* ignore */ }
    setOpen(false);
  };
  const s = STEPS[step];
  const content = lang === "en" ? s.en : s.zh;
  const Icon = s.icon;
  const last = step === STEPS.length - 1;

  return (
    <div className="am-no-print fixed inset-0 z-[95] flex items-center justify-center bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Onboarding">
      <div className="am-pop-in relative w-[560px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-line bg-elevated shadow-menu">
        <CelebrationLayer ref={celeb} />
        <div className="relative flex flex-col items-center px-8 pt-9 pb-6 text-center">
          <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Icon size={30} strokeWidth={1.6} />
          </span>
          <h2 className="text-[18px] font-semibold text-ink">{content.title}</h2>
          {/* 固定内容区高度：各步弹窗尺寸统一，不随文案长短伸缩 */}
          <div className="mt-5 h-[308px] w-full overflow-y-auto">
            {step === 0 ? (
              <div className="space-y-4 text-left">
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">{t("onboard.lang")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {([["zh-Hans", "简体中文"], ["en", "English"]] as const).map(([code, label]) => (
                    <button
                      key={code}
                      onClick={() => useUi.getState().setPref("language", code)}
                      aria-pressed={lang === code}
                      className={`flex h-9 items-center justify-center gap-1.5 rounded-lg border text-[13px] transition-colors ${lang === code ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-ink-secondary hover:bg-hover hover:text-ink"}`}
                    >
                      {lang === code && <Check size={13} />} {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">{t("onboard.appearance")}</p>
                <div className="grid grid-cols-3 gap-2">
                  {([["light", t("theme.light"), Sun], ["dark", t("theme.dark"), Moon], ["system", t("theme.system"), Monitor]] as const).map(([m, label, MIcon]) => (
                    <button
                      key={m}
                      onClick={() => setThemeMode(m)}
                      aria-pressed={mode === m}
                      className={`flex h-9 items-center justify-center gap-1.5 rounded-lg border text-[12px] transition-colors ${mode === m ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-ink-secondary hover:bg-hover hover:text-ink"}`}
                    >
                      <MIcon size={13} /> {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">{t("onboard.theme")}</p>
                <div className="grid max-h-[132px] grid-cols-3 gap-2 overflow-y-auto pr-1">
                  {themes.map((th) => {
                    const tok = resolveTokens(th, dark);
                    const active = th.id === themeId;
                    return (
                      <button
                        key={th.id}
                        onClick={() => applyTheme(th.id)}
                        aria-pressed={active}
                        title={th.name}
                        className={`flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors ${active ? "border-accent bg-accent-soft" : "border-line hover:bg-hover"}`}
                      >
                        <span className="flex items-center gap-1">
                          <span className="h-4 w-4 rounded-full border border-line" style={{ background: tok["--am-bg"] }} />
                          <span className="h-4 w-4 rounded-full" style={{ background: tok["--am-accent"] }} />
                          <span className="h-4 w-4 rounded-full" style={{ background: tok["--am-info"] }} />
                          {active && <Check size={12} className="ml-auto text-accent" />}
                        </span>
                        <span className={`truncate text-[11px] ${active ? "font-medium text-accent" : "text-ink-secondary"}`}>{th.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            ) : (
              <>
                <ul className="space-y-2 text-left">
                  {content.body.map((line, i) => (
                    <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-secondary">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      {line}
                    </li>
                  ))}
                </ul>
                <div className="mt-4">
                  <StepDemo step={step} />
                </div>
              </>
            )}
          </div>
          <div className="mt-6 flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <button key={i} aria-label={`step ${i + 1}`} onClick={() => setStep(i)} className={`h-1.5 rounded-full transition-all ${i === step ? "w-5 bg-accent" : "w-1.5 bg-line hover:bg-ink-muted"}`} />
            ))}
          </div>
        </div>
        <div className="relative flex items-center justify-between border-t border-line bg-panel px-5 py-3">
          <button onClick={finish} className="text-[12px] text-ink-muted transition-colors hover:text-ink">{t("onboard.skip")}</button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button onClick={() => setStep((v) => v - 1)} className="flex h-8 items-center gap-1 rounded-md border border-line px-3 text-[12.5px] text-ink-secondary hover:bg-hover hover:text-ink">
                <ChevronLeft size={13} /> {t("onboard.back")}
              </button>
            )}
            <button
              onClick={() => (last ? finish() : setStep((v) => v + 1))}
              className="flex h-8 items-center gap-1 rounded-md bg-accent px-4 text-[12.5px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
            >
              {last ? t("onboard.done") : t("onboard.next")} {!last && <ChevronRight size={13} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}