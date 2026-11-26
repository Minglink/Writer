import { z } from "zod";

export type BookGenreChannel = "male" | "female";

export const LONG_BOOK_GENRE_CHANNELS = {
  male: [
    "玄幻",
    "传统玄幻",
    "玄幻脑洞",
    "仙侠",
    "奇幻仙侠",
    "奇幻",
    "武侠",
    "诸天",
    "都市",
    "都市脑洞",
    "都市高武",
    "都市修真",
    "战神赘婿",
    "都市日常",
    "职场商战",
    "现实",
    "历史",
    "历史脑洞",
    "军事",
    "抗战谍战",
    "科幻",
    "科幻末世",
    "悬疑",
    "悬疑脑洞",
    "悬疑灵异",
    "规则怪谈",
    "游戏",
    "体育",
    "轻小说",
    "其他"
  ],
  female: [
    "现代言情",
    "现言甜宠",
    "豪门世家",
    "现言脑洞",
    "青春甜宠",
    "虐恋情深",
    "古代言情",
    "宫斗宅斗",
    "古风世情",
    "古言脑洞",
    "古代权谋",
    "民国言情",
    "种田",
    "年代",
    "玄幻言情",
    "奇幻仙侠",
    "异世穿越",
    "快穿",
    "悬疑恋爱",
    "女频悬疑",
    "规则怪谈",
    "末日求生",
    "都市生活",
    "职场商战",
    "搞笑轻松",
    "纯爱",
    "双男主",
    "无CP",
    "同人衍生",
    "其他"
  ]
} as const satisfies Record<BookGenreChannel, readonly string[]>;

export const SHORT_BOOK_GENRE_CHANNELS = {
  male: [
    "都市脑洞",
    "都市",
    "战神赘婿",
    "玄幻",
    "奇幻仙侠",
    "悬疑脑洞",
    "悬疑",
    "悬疑灵异",
    "规则怪谈",
    "科幻末世",
    "科幻",
    "历史",
    "复仇",
    "现实",
    "其他"
  ],
  female: [
    "世情",
    "追妻",
    "现代言情",
    "豪门世家",
    "现言脑洞",
    "古代言情",
    "宫斗宅斗",
    "古言脑洞",
    "重生复仇",
    "真假千金",
    "年代",
    "种田",
    "悬疑恋爱",
    "规则怪谈",
    "其他"
  ]
} as const satisfies Record<BookGenreChannel, readonly string[]>;

export const LONG_BOOK_GENRES: readonly string[] = /* @__PURE__ */ (() =>
  Array.from(
    new Set([
      ...LONG_BOOK_GENRE_CHANNELS.male,
      ...LONG_BOOK_GENRE_CHANNELS.female
    ])
  ))();

/**
 * The enum is primarily a UI suggestion list. Imported projects may preserve
 * a custom genre, so the wire contract deliberately accepts any short label.
 */
export const LongBookGenreSchema = /* @__PURE__ */ z
  .string()
  .trim()
  .min(1)
  .max(120);
export type LongBookGenre = z.infer<typeof LongBookGenreSchema>;
