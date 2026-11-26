export default {
  loadingNovelAgentTeamSettings: "正在加载长篇智能体团队设置…",
  novelAgentTeamSettingsHaveNotLoaded: "长篇智能体团队设置未加载",
  reload: "重新加载",
  noNovelAgentTeamSettingsAvailable: "暂无可用的长篇智能体团队设置。",
  configureSpecialistAssistantsForWorldbuildingCharactersPlotManuscriptAnd:
    "配置世界观、人物、剧情、正文与连续性等专项助手，由长篇智能体按需调用。",
  subagentsUseThePrimaryAgentSModelByDefault:
    "子智能体默认跟随所属主智能体的模型；也可单独配置模型。它继承主智能体的工具与审批策略，但继承的工具不包含技能加载；不继承主智能体提示词、会话或技能库，且不能继续创建子智能体、不能绕过用户审批。每次调用以自己的系统提示词为主，运行时只额外附带可用工具清单和交接回主智能体的长度约束——它是直接用工具改文档，还是只把结论交回主智能体，完全由你写的系统提示词决定。",
  eachNovelPrimaryAgentSupportsUpToValueSubagents:
    "每个长篇主智能体最多配置 {arg0} 个子智能体",
  newSubagentValue: "新子智能体 {arg0}",
  copiedToTheCurrentDraftSaveTheAgentTeam:
    "已复制到当前草稿；保存智能体团队后生效",
  theSkillLibraryIsEmptyAddAnEntryIn: "技能库为空，请先在左侧技能库中添加条目",
  addedToThePrimaryAgentDraftSaveTheAgent:
    "已加入当前主智能体草稿；保存智能体团队后生效",
  removedFromTheCurrentDraftSaveTheAgentTeam:
    "已从当前草稿移除；保存智能体团队后生效",
  novelAgentTeamSettingsAreIncomplete: "长篇智能体团队配置不完整"
};
