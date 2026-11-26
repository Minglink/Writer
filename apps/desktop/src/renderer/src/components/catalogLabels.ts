import { createScopedTranslator } from "../i18n";

export { genreLabel } from "./genreLabels";

const t = /* @__PURE__ */ createScopedTranslator("components.catalogLabels");
type CatalogLabelKey = Parameters<typeof t>[0];

const formatKeys: Readonly<Record<string, CatalogLabelKey>> = {
  正文: "manuscript",
  设定: "setting",
  技能: "skill",
  素材: "material",
  账本: "ledger"
};
const fontKeys: Readonly<Record<string, CatalogLabelKey>> = {
  system: "fontSystem",
  sans: "fontSans",
  song: "fontSong",
  kai: "fontKai",
  fangsong: "fontFangsong",
  yuan: "fontYuan"
};

export function documentFormatLabel(value: string | undefined): string {
  const key = value && formatKeys[value];
  return key ? t(key) : (value ?? "");
}

export function builtinFontLabel(value: string, fallback: string): string {
  const key = fontKeys[value];
  return key ? t(key) : fallback;
}
