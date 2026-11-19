declare module "emojilib" {
  interface EmojiEntry {
    char: string;
    keywords?: string[];
    category?: string;
    fitzpatrick_scale?: boolean;
  }
  const emojilib: {
    lib: Record<string, EmojiEntry>;
    ordered: string[];
    fitzpatrick_scale_modifiers: string[];
  };
  export default emojilib;
}