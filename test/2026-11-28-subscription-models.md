# 订阅模型管理页面（Round 3 一期 C）验证记录

## 目标与成功标准

验证「设置 → 模型与用量 → 订阅模型管理」完整交互与视觉表现：入口懒加载不触碰 `WorkspaceShell.vue`、包体积与语言包预算通过、扫描本机凭证/非官方渠道提示/账号池配额与冷却/切换主账号/单模型乐观开关无闪烁/设为默认/Device Flow 授权弹窗/移除模态确认/深浅主题与 `1000×680` 大字号无溢出，以及启用/默认模型同步至全局模型选择器。

## 环境

Windows x64，Node v24.19.0，Electron 42.5.0（`apps/desktop` 本地构建与 Electron 渲染探测），浅色/深色主题，`1200×800` 默认字号（`14px`）与 `1000×680` 大字号（`20px`）。测试数据均使用 `example.test` 占位值，不含真实凭据或地址。

## 步骤与命令

1. 单测与性能守卫：`pnpm vitest run apps/desktop/src/renderer/src/components/subscriptions/SubscriptionModelSettingsPanel.test.ts apps/desktop/src/renderer/src/App.performance.test.ts apps/desktop/src/renderer/src/components/ModelSettingsFeature.test.ts tools/i18n-resources.test.mjs`
2. 质量与构建预算：`pnpm exec eslint --max-warnings=0 ...`、`pnpm exec prettier --check ...`、`pnpm lint:boundary`、`pnpm typecheck`、`pnpm build`
3. 真实桌面冒烟：`pnpm smoke:conversation`
4. Electron 视觉与全流程探测（模拟 `window.writer.subscriptions` 与 `models` 桥接，存档于 `test/2026-11-28-subscription-models/`）：覆盖进入设置页、扫描导入本机凭证、切换平台显示非官方提示条与即将支持平台、切换主账号与模型乐观开关（MutationObserver + rAF 校验无回弹与误禁）、设为默认、Device Flow 弹窗、移除确认弹窗、深色主题、`1000×680` + `20px` 浅/深色溢出检测，以及返回应用在全局模型选择器中可见。

## 结果

- 单测：4 个文件 46 项测试全部通过；ESLint、Prettier、`pnpm lint:boundary`、`pnpm typecheck` 全部 0 错误通过。
- 构建与体积预算：`pnpm build` 通过，异步块 `SubscriptionModelSettingsPanel` 为 `42.04 kB`，`Renderer application JS` `1,222,952 B`（预算 `< 1,235,000 B`），`Renderer language data` `832,633 B`（预算 `< 845,000 B`），`app-ready` `1,270,778 B`。
- 桌面冒烟：`pnpm smoke:conversation` 通过（`WRITER_CONVERSATION_SMOKE_OK`，39 页对话与崩溃恢复正常）。
- 界面视觉与端到端探测（10 张截图）：控制台 0 报错、0 Vue 警告；乐观开关 `checked1Transitions: 1`、`anyUnrelatedDisabled: false`；`1000×680` + `20px` 浅/深色水平溢出均为 `0`；全局模型选择器正确按平台分组显示 `Gemini 2.5 Flash`（当前默认）、`Gemini 2.5 Pro`、`Gemini 3 Pro (Antigravity)`、`GPT-5.3 Codex`。

## 未覆盖与后续

- 本轮 Electron 界面探测使用本地模拟 IPC 快照，未在真实用户浏览器中执行上游 OAuth / Device Flow 线上授权与实时上游配额接口拉取；二/三期平台（Claude/Kiro/Cursor/Windsurf/CodeBuddy）当前仅折叠展示「即将支持」。
