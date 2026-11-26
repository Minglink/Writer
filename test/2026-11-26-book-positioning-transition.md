# 书籍网文定位全周期管理与连载平滑转型验收

## 目标与成功标准

补齐已建书籍（含旧版作品迁移）在长篇管理与短篇管理中的「设置 → 网文定位」全生命周期编辑、历史自定义题材兼容保留、转型备注与「仅保存定位 / 保存并交由智能体平滑过渡」双路径交接，以及长短篇 `AGENTS.md` 受控读写工具、Diff 提案审阅与接受前内联微调能力，确保已写正文、角色与设定存量一字不动。

## 环境

Windows，Electron 42.5.0（Node 24.17.0），简体中文与英文。无头 Electron 界面验收探针使用隔离临时 `userData`、1200×860 视口与默认 14px UI 字号。

## 步骤与命令

- 执行 `pnpm typecheck`、`pnpm lint:boundary`、`pnpm lint:i18n` 与 `pnpm build`（含 `check-renderer-build.mjs` 首屏与多语言体积预算校验）。
- 运行 `pnpm vitest run` 覆盖契约、受控工具、权限校验、新旧作品持久化迁移、提案协调器与界面交接等 13 个测试文件。
- 执行 `pnpm smoke:conversation` 验证真实 Electron 主进程、Core 与会话存储工作线程跨进程 IPC 读写及干净退出。
- 运行无头 Electron 界面探针截取长短篇网文定位、右侧共创 `AGENTS.md` Diff 审阅卡及深色内联微调 4 张流程截图。

## 结果

- 类型检查、渲染层边界检查、多语言检查与生产构建全部通过：`Renderer application JS` 为 `1,218,552 B`（`< 1,235,000 B`），`app-ready` 总 JS 为 `1,266,378 B`（`< 1,295,000 B`，低于基线 `49.4%`），`locale data` 为 `830,611 B`（`< 845,000 B`），`WorkspaceShell.vue` 为 `2,770` 行（`<= 2,800` 行）。
- 13 个测试文件共 150 项单元与磁盘集成测试全部通过；`pnpm smoke:conversation` 输出 `WRITER_CONVERSATION_SMOKE_OK` 并干净退出。
- 浅色与深色 4 张完整流程截图归档至 [2026-11-26-book-positioning-transition](./2026-11-26-book-positioning-transition/)，排版、对比度、Diff 高亮与内联编辑控件均无裁切或遗漏词条。

## 未覆盖与后续

- 真实商业大模型在百章以上存量长篇中途跨题材转型时的多轮剧情衔接建议质量，需配置真实模型密钥后结合实际连载书目进一步实测。
