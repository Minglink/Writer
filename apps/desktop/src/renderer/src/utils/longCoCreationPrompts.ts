import type { LongCoCreationMode } from "@writer/contracts";

export type EmptyCardBrainstormStyle = "ask_one" | "two_paths";

export interface SelectionCoCreationRequest {
  mode: LongCoCreationMode;
  intent: string;
}

export interface EmptyCardBrainstormRequest {
  spark: string;
  style: EmptyCardBrainstormStyle;
}

export function buildSelectionCoCreationPrompt(params: {
  mode: LongCoCreationMode;
  chapterTitle: string;
  intent: string;
  locale?: string;
}): string {
  const { mode, chapterTitle, locale } = params;
  const intent = params.intent.trim();
  const isEn = locale === "en-US";

  if (mode === "critique") {
    if (isEn) {
      return [
        `Please read the selected passage in "${chapterTitle}" as a reader first (read-only margin notes, do not rewrite the text).`,
        intent
          ? `Intended reader effect: ${intent}`
          : "Tell me 1–2 exact quotes where the reading feel shifts or undercuts tension; if it already works, say so directly."
      ].join("\n");
    }
    return [
      `请先以读者视角「读读这段」（《${chapterTitle}》，本轮仅给只读边注，不要擅自改写正文）：`,
      intent
        ? `我希望读者读到这段时的感受/意图：${intent}`
        : "请只挑最影响阅读感受的 1–2 处，引用原句说明读到这里的感觉；如果这段已经达到效果，直接告诉我保留原句。"
    ].join("\n");
  }

  if (mode === "brainstorm") {
    if (isEn) {
      return [
        `Help me brainstorm the next scene from the selected passage in "${chapterTitle}" (read-only discussion, do not edit the book).`,
        intent
          ? `Current blocker / constraint: ${intent}`
          : "Offer 2 concise next-scene directions grounded in established facts, each stating who acts, the immediate cost, and which relationship shifts."
      ].join("\n");
    }
    return [
      `请围绕《${chapterTitle}》选中段落帮我「想下一幕」（本轮仅只读推演，不修改作品）：`,
      intent
        ? `我当前的卡点或想守住的悬念：${intent}`
        : "请结合已有前文与人物处境给 2 条短走向，每条讲清「谁采取行动、当场付出什么代价、会改变哪段关系」；若需要新增设定请标明。"
    ].join("\n");
  }

  // try_rewrite
  if (isEn) {
    return [
      `Propose one restrained local rewrite for only the selected passage in "${chapterTitle}" (manual diff preview required; keep surrounding sentences intact).`,
      intent
        ? `Target effect: ${intent}`
        : "Keep my voice and adjust only the exact phrase that gets in the way."
    ].join("\n");
  }
  return [
    `请针对《${chapterTitle}》选中的这段「试改此处」（强制手动差异预览，只改这一处，保留前后段落与原有人物口吻）：`,
    intent
      ? `本次希望达到的局部效果：${intent}`
      : "请尽量保留原段里最像我自己的词句，只做最克制的一处局部试改并说明理由。"
  ].join("\n");
}

export function buildEmptyCardBrainstormPrompt(params: {
  chapterTitle: string;
  spark: string;
  style: EmptyCardBrainstormStyle;
  locale?: string;
}): string {
  const { chapterTitle, style, locale } = params;
  const spark = params.spark.trim();
  const isEn = locale === "en-US";

  if (style === "ask_one") {
    if (isEn) {
      return [
        `Let's brainstorm "${chapterTitle}" together (read-only, do not edit the chapter card).`,
        spark
          ? `My starting image / spark: ${spark}`
          : "I only have a blank chapter card right now.",
        "Ask me just 1 sharp question about character relationship or stakes to unlock the first scene."
      ].join("\n");
    }
    return [
      `我想一起构思《${chapterTitle}》的故事（本轮仅在会话讨论，不要修改章卡）：`,
      spark
        ? `我手头只有一个画面/想法：${spark}`
        : "我现在只有一个空白章卡，还没想好第一场戏从哪切入。",
      "请先只问我 1 个最关键的人物关系或代价问题，帮我把第一场戏立起来。"
    ].join("\n");
  }

  if (isEn) {
    return [
      `Let's brainstorm "${chapterTitle}" together (read-only, do not edit the chapter card).`,
      spark
        ? `My starting image / blocker: ${spark}`
        : "Give me 2 short, concrete story seeds for this chapter.",
      "For each direction, state who acts, what cost they pay on the spot, and what shifts for the next chapter."
    ].join("\n");
  }
  return [
    `我想一起构思《${chapterTitle}》的下一幕（本轮仅在会话讨论，不要修改章卡）：`,
    spark
      ? `我目前的画面/卡点：${spark}`
      : "请结合本书已有设定，给我 2 个短小具体的开场故事种子。",
    "请给 2 条短走向，每条讲清「谁作出什么选择、当场付出什么代价、会给后文留下什么」；如需新设定请标明。"
  ].join("\n");
}
