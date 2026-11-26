import { registerFeatureMessages } from "../i18n";

export const writingContextCoCreationT = registerFeatureMessages(
  "components.writingContextCoCreation",
  {
    "zh-CN": {
      coCreateWithAgent: "与智能体共创",
      webNovelPositioning: "网文定位",
      longPositioningDescription:
        "调整本书频道、题材、连载风向与流派标签；既有正文与设定保持不变，可交由智能体平滑过渡创作上下文。",
      shortPositioningDescription:
        "调整本篇频道、题材、短篇风向与流派标签；既有正文与设定保持不变，可交由智能体平滑过渡创作上下文。",
      scriptGenre: "剧本题材",
      scriptGenreDescription:
        "调整当前剧本的题材分类，既有分场与人物设定保持不变。",
      handoffDraftPrefilled:
        "已将共创请求填入右侧对话框，选择可用模型或待当前任务结束后即可发送。",
      handoffWorkspaceUnavailable:
        "无法打开目标作品会话，请先在左侧选择该作品后重试。"
    },
    "en-US": {
      coCreateWithAgent: "Co-create with Agent",
      webNovelPositioning: "Web-Novel Positioning",
      longPositioningDescription:
        "Adjust channel, genre, serial pacing, and trope tags while keeping existing chapters and lore intact, or hand off to the agent for a smooth context transition.",
      shortPositioningDescription:
        "Adjust channel, genre, short-story pacing, and trope tags while keeping existing sections and notes intact, or hand off to the agent for a smooth context transition.",
      scriptGenre: "Genre",
      scriptGenreDescription:
        "Update the genre category for this screenplay without altering existing scenes or character notes.",
      handoffDraftPrefilled:
        "Prepared the co-creation prompt in the conversation input. Select an active model or wait for the current task to finish, then send.",
      handoffWorkspaceUnavailable:
        "Could not open the target book conversation. Select the book in the sidebar and try again."
    }
  }
);
