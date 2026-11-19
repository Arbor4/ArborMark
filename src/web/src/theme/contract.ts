/**
 * ArborMark 主题契约 (Theme Contract)
 * ==================================
 * 这是主题作者与系统之间的唯一接口。
 *
 * 规则：
 *  1. 系统组件只消费 `--am-*` token（经 Tailwind @theme 映射成语义工具类），
 *     不写死颜色；
 *  2. 主题只提供 token 取值（+ 可选的 scoped CSS 扩展），不重写布局；
 *  3. 未覆盖的 token 沿用 DEFAULT_TOKENS 的默认值。
 *
 * 自定义主题：设置 → 外观 → 主题画廊 → 「导出主题模板」会得到一份 JSON，
 * 修改后放入 userData/themes/ 目录（或直接在画廊里导入）即可生效。
 */

export interface ThemeTokens {
  /* ── 表面 ─────────────────────────────────────────────── */
  /** 应用底色（窗口背景） */
  "--am-bg"?: string;
  /** 侧边栏 / 活动栏背景 */
  "--am-bg-sidebar"?: string;
  /** 编辑区背景 */
  "--am-bg-editor"?: string;
  /** 浮层背景（菜单、对话框、面板） */
  "--am-bg-elevated"?: string;
  /** 列表项 hover 背景 */
  "--am-bg-hover"?: string;
  /** 列表项选中 / 激活背景 */
  "--am-bg-active"?: string;
  /** 输入框背景 */
  "--am-bg-input"?: string;

  /* ── 文字 ─────────────────────────────────────────────── */
  "--am-text"?: string;
  "--am-text-secondary"?: string;
  "--am-text-muted"?: string;
  /** 强调色背景上的文字 */
  "--am-accent-text"?: string;

  /* ── 强调色 ───────────────────────────────────────────── */
  "--am-accent"?: string;
  "--am-accent-hover"?: string;
  /** 强调色的柔和 tint（选中态背景、徽章） */
  "--am-accent-soft"?: string;

  /* ── 边框与分隔 ───────────────────────────────────────── */
  "--am-border"?: string;
  "--am-border-strong"?: string;

  /* ── 状态色 ───────────────────────────────────────────── */
  "--am-success"?: string;
  "--am-warning"?: string;
  "--am-danger"?: string;
  "--am-info"?: string;

  /* ── 选区 ─────────────────────────────────────────────── */
  "--am-selection-bg"?: string;
  "--am-selection-text"?: string;

  /* ── 字体 ─────────────────────────────────────────────── */
  "--am-font-ui"?: string;
  "--am-font-editor"?: string;
  "--am-font-mono"?: string;
  /** 编辑器基准字号 */
  "--am-editor-size"?: string;
  "--am-editor-line-height"?: string;
  /** 编辑区最大宽度（CSS 长度或 none） */
  "--am-editor-width"?: string;

  /* ── Markdown 内容配色 ────────────────────────────────── */
  "--am-md-heading"?: string;
  "--am-md-link"?: string;
  "--am-md-code-bg"?: string;
  "--am-md-code-text"?: string;
  "--am-md-quote-border"?: string;
  "--am-md-quote-bg"?: string;
  "--am-md-mark-bg"?: string;
  "--am-md-mark-text"?: string;
  "--am-md-hr"?: string;
  "--am-md-table-border"?: string;
  "--am-md-meta"?: string;

  /* ── 质感 ─────────────────────────────────────────────── */
  /** 圆角基准 */
  "--am-radius"?: string;
  "--am-radius-lg"?: string;
  "--am-shadow-menu"?: string;
  "--am-shadow-modal"?: string;
  /** 玻璃拟态模糊半径（0 = 关闭，非玻璃主题保持 0） */
  "--am-glass-blur"?: string;
  /** 玻璃表面透明度叠加（可选，配合 --am-glass-blur） */
  "--am-glass-surface"?: string;

  /* 允许主题扩展私有 token（--am-x-* 命名空间） */
  [custom: `--am-x-${string}`]: string | undefined;
}

export type ThemeAppearance = "light" | "dark";

export interface ThemeDefinition {
  /** 唯一 id（kebab-case），也是 data-theme 属性值 */
  id: string;
  name: string;
  author?: string;
  description?: string;
  /** 主题适用的外观；auto 表示同时提供明暗两套 token */
  appearance: ThemeAppearance | "auto";
  /** 浅色 token（appearance=dark 时可省略） */
  light?: ThemeTokens;
  /** 深色 token（appearance=light 时可省略） */
  dark?: ThemeTokens;
  /**
   * 可选的扩展 CSS：注入到 [data-theme="<id>"] 作用域下，
   * 供高级主题作者做 token 之外的质感定制（玻璃、纹理、动效）。
   * 不允许覆盖布局结构（display/position 等由系统负责）。
   */
  css?: string;
  /** 内置主题标记（用户主题不可删除内置） */
  builtin?: boolean;
}

/** token 分组（主题编辑器 UI 用） */
export const TOKEN_GROUPS: { label: string; keys: (keyof ThemeTokens)[] }[] = [
  {
    label: "表面",
    keys: [
      "--am-bg",
      "--am-bg-sidebar",
      "--am-bg-editor",
      "--am-bg-elevated",
      "--am-bg-hover",
      "--am-bg-active",
      "--am-bg-input",
    ],
  },
  {
    label: "文字",
    keys: ["--am-text", "--am-text-secondary", "--am-text-muted", "--am-accent-text"],
  },
  {
    label: "强调色",
    keys: ["--am-accent", "--am-accent-hover", "--am-accent-soft"],
  },
  { label: "边框", keys: ["--am-border", "--am-border-strong"] },
  { label: "状态", keys: ["--am-success", "--am-warning", "--am-danger", "--am-info"] },
  { label: "选区", keys: ["--am-selection-bg", "--am-selection-text"] },
  {
    label: "Markdown",
    keys: [
      "--am-md-heading",
      "--am-md-link",
      "--am-md-code-bg",
      "--am-md-code-text",
      "--am-md-quote-border",
      "--am-md-quote-bg",
      "--am-md-mark-bg",
      "--am-md-mark-text",
      "--am-md-hr",
      "--am-md-table-border",
      "--am-md-meta",
    ],
  },
  {
    label: "质感",
    keys: [
      "--am-radius",
      "--am-radius-lg",
      "--am-shadow-menu",
      "--am-shadow-modal",
      "--am-glass-blur",
      "--am-glass-surface",
    ],
  },
];

/**
 * 结构默认值：主题未覆盖时的兜底。
 * 字体 / 字号 / 宽度属于「结构」，一般主题不改；配色属于「外观」。
 */
export const DEFAULT_TOKENS: Required<
  Pick<
    ThemeTokens,
    | "--am-font-ui"
    | "--am-font-editor"
    | "--am-font-mono"
    | "--am-editor-size"
    | "--am-editor-line-height"
    | "--am-editor-width"
    | "--am-radius"
    | "--am-radius-lg"
    | "--am-glass-blur"
    | "--am-glass-surface"
  >
> = {
  "--am-font-ui":
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  "--am-font-editor":
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  "--am-font-mono":
    '"SF Mono", "JetBrains Mono", "Cascadia Code", Consolas, "Liberation Mono", Menlo, monospace',
  "--am-editor-size": "16px",
  "--am-editor-line-height": "1.75",
  "--am-editor-width": "860px",
  "--am-radius": "8px",
  "--am-radius-lg": "14px",
  "--am-glass-blur": "0px",
  "--am-glass-surface": "transparent",
};

/** 主题必须覆盖的核心配色 token（校验自定义主题用） */
export const REQUIRED_COLOR_TOKENS: (keyof ThemeTokens)[] = [
  "--am-bg",
  "--am-bg-sidebar",
  "--am-bg-editor",
  "--am-text",
  "--am-accent",
  "--am-border",
];