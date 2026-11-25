import {
  X,
  Palette,
  PenLine,
  Info,
  Keyboard,
  FileText,
  Settings2,
  Image as ImageIcon,
  Globe,
  FolderOpen,
  FileDown,
} from "lucide-react";
import { useUi } from "@/stores/ui";
import { useLang } from "@/bridge/i18n";
import { Modal } from "../common";
import {
  AppearanceSettings,
  FileSettings,
  EditorSettings,
  MarkdownSettings,
  ImageSettings,
  ExportSettings,
} from "./EditorSettingsTabs";
import {
  WebSearchSettings,
  GeneralSettings,
  ShortcutSettings,
  AboutSettings,
} from "./AppSettingsTabs";

const TABS = [
  { id: "appearance", label: "settings.appearance", icon: Palette },
  { id: "file", label: "settings.file", icon: FolderOpen },
  { id: "editor", label: "settings.editor", icon: PenLine },
  { id: "markdown", label: "settings.markdown", icon: FileText },
  { id: "image", label: "settings.image", icon: ImageIcon },
  { id: "export", label: "settings.export", icon: FileDown },
  { id: "search", label: "settings.search", icon: Globe },
  { id: "general", label: "settings.general", icon: Settings2 },
  { id: "shortcuts", label: "settings.shortcuts", icon: Keyboard },
  { id: "about", label: "settings.about", icon: Info },
];

export function SettingsPanel() {
  const { t } = useLang();
  const open = useUi((s) => s.settingsOpen);
  const tab = useUi((s) => s.settingsTab);
  const close = useUi((s) => s.closeSettings);
  const openSettings = useUi((s) => s.openSettings);

  return (
    <Modal open={open} onClose={close} width={780} labelledBy="settings-title">
      <div className="relative flex h-[580px] max-h-[82vh]">
        {/* 左侧导航 */}
        <nav className="flex w-[160px] shrink-0 flex-col gap-0.5 border-r border-line bg-panel p-2.5" aria-label={t("设置分类")}>
          <p id="settings-title" className="mb-2 px-2 pt-1 text-[13px] font-semibold text-ink">
            {t("settings.title")}
          </p>
          {TABS.map((tb) => {
            const Icon = tb.icon;
            return (
              <button
                key={tb.id}
                onClick={() => openSettings(tb.id)}
                aria-current={tab === tb.id}
                className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] transition-colors ${
                  tab === tb.id
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-ink-secondary hover:bg-hover hover:text-ink"
                }`}
              >
                <Icon size={14} /> {t(tb.label)}
              </button>
            );
          })}
          <span className="flex-1" />
          <p className="px-2 text-[10px] text-ink-muted">ArborMark 4.0</p>
        </nav>

        {/* 固定关闭按钮：不随右侧设置内容滚动 */}
        <button
          aria-label={t("关闭设置")}
          onClick={close}
          className="absolute right-4 top-3.5 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-elevated/90 text-ink-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <X size={15} />
        </button>

        {/* 右侧内容 */}
        <div className="min-w-0 flex-1 overflow-y-auto p-5">
          {tab === "appearance" && <AppearanceSettings />}
          {tab === "file" && <FileSettings />}
          {tab === "editor" && <EditorSettings />}
          {tab === "markdown" && <MarkdownSettings />}
          {tab === "image" && <ImageSettings />}
          {tab === "export" && <ExportSettings />}
          {tab === "search" && <WebSearchSettings />}
          {tab === "general" && <GeneralSettings />}
          {tab === "shortcuts" && <ShortcutSettings />}
          {tab === "about" && <AboutSettings />}
        </div>
      </div>
    </Modal>
  );
}
