import { createScopedTranslator } from "../i18n";

const t = /* @__PURE__ */ createScopedTranslator("components.catalogLabels");
type CatalogLabelKey = Parameters<typeof t>[0];

// Persisted contract values mapped to localized UI labels; kept in its own
// module so startup editor panes that only format document kinds do not pull
// the full genre dictionary into app-ready JavaScript.
const genreKeys: Readonly<Record<string, CatalogLabelKey>> = {
  世情: "socialFiction",
  追妻: "romanticReconciliation",
  科幻: "scienceFiction",
  悬疑: "mystery",
  其他: "other",
  玄幻: "easternFantasy",
  传统玄幻: "tradFantasy",
  奇幻: "fantasy",
  武侠: "martialArts",
  仙侠: "cultivationFantasy",
  都市: "urban",
  现实: "realism",
  历史: "historical",
  军事: "military",
  言情: "romance",
  现言: "contemporaryRomance",
  古言: "historicalRomance",
  灵异: "supernatural",
  末世: "postApocalyptic",
  游戏: "gaming",
  体育: "sports",
  轻小说: "lightNovel",
  诸天: "multiverse",
  复仇: "revenge",
  重生复仇: "rebornRevenge",
  真假千金: "trueHeiress",
  青春: "youth",
  脑洞: "highConcept",
  玄幻脑洞: "efTwist",
  都市脑洞: "urbanTwist",
  都市高武: "urbanMartial",
  都市修真: "urbanCult",
  战神赘婿: "warGodSon",
  都市日常: "urbanSlice",
  都市生活: "urbanLife",
  历史脑洞: "histTwist",
  抗战谍战: "espionage",
  职场商战: "business",
  科幻末世: "scifiApoc",
  末日求生: "apocSurv",
  悬疑脑洞: "suspTwist",
  悬疑灵异: "mysSuper",
  女频悬疑: "femSusp",
  规则怪谈: "rulesHorror",
  现代言情: "modRom",
  现言甜宠: "sweetMod",
  古代言情: "ancRom",
  古风世情: "histSoc",
  宫斗宅斗: "palace",
  豪门世家: "wealthy",
  现言脑洞: "modTwist",
  古言脑洞: "ancTwist",
  玄幻言情: "fanRom",
  奇幻仙侠: "xianxiaFan",
  异世穿越: "isekai",
  快穿: "quickTrans",
  青春甜宠: "youthSweet",
  虐恋情深: "angstRom",
  民国言情: "repRom",
  种田: "farming",
  年代: "period",
  古代权谋: "ancPol",
  悬疑恋爱: "mysRom",
  搞笑轻松: "comedy",
  纯爱: "pureRom",
  双男主: "dualMale",
  无CP: "noCp",
  同人衍生: "fanfic"
};

export function genreLabel(value: string): string {
  const key = genreKeys[value];
  return key ? t(key) : value;
}
