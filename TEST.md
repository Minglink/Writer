# Writer 验证

本文件写验证思路与报告规范。每次验证的报告和产物放在 [test/](test/)，并在文末“验证记录”登记。报错时转 [ERROR.md](ERROR.md)。

## 原则

- 动手前把请求写成可观察的成功标准；完成后逐条核对，没核对的写进“未覆盖”，不报告为通过。
- 按影响面验证，默认不跑全量：先跑改动直接影响的部分，范围扩大才逐级加测。修正中只重跑失败项，收尾时通过一次即可。
- 测可观察的行为和失败路径：加校验先测无效输入；修缺陷先写能复现的失败测试；重构前后相关测试都要通过。
- 类型检查和构建不能代替跨进程、安装包、界面与真实模型的验证。缺密钥、缺设备拦下的记为“未验”，写明原因和需要谁来补。

## 验证分级

| 级别 | 何时 | 跑什么 |
| --- | --- | --- |
| L1 改动内 | 每次开发循环 | `pnpm vitest related --run <改动文件>`；`pnpm exec eslint <改动文件>`；`pnpm exec prettier --check <改动文件>` |
| L2 影响面 | 改类型、contracts、跨进程、界面、打包 | L1，再按下表加测 |
| L3 全量 | 仅用户明确要求 | `pnpm verify`；日常提交、打包、发版由 GitHub Actions CI 执行 |

## 按改动加测（L2）

| 改动 | 加测 |
| --- | --- |
| 类型、contracts schema | `pnpm typecheck`；schema 先测无效输入 |
| 磁盘、事务、SQLite、真实文件系统 | 测试登记到 `vitest.config.ts` 的 `disk-integration`；竞态用确定性同步点，不靠速度；临时目录用 `fs.rm` 有界重试 |
| 持久化 schema、双端同步模块 | 新旧数据双向读写测试（[error/schema-compat.md](error/schema-compat.md)） |
| 智能体工具、提示词、子智能体 | Faux 响应测试；工具测试要经过参数校验层；行为依赖模型时再用真实模型跑一次 |
| 涉及界面的功能新增、变更、修复 | 按“界面验收与截图”走完受影响的操作流程，在对话中直接展示代表性过程截图 |
| 样式、布局、组件外观 | 按“界面验收与截图”做前后对比，在对话中直接展示能说明差异的对比图 |
| 即时操作、保存状态 | 逐帧采样（[design/feedback.md](design/feedback.md)） |
| IPC、Utility、进程入口 | `pnpm lint:boundary` + `pnpm build` + `pnpm smoke`（或 `smoke:conversation` / `smoke:shutdown`） |
| 安装包、`files`、打包脚本 | `windows-package` skill（`pnpm pack:win --skip-verify`） |
| 路径、换行、进程占用 | Windows 路径与文件锁测试 |

## 开发环境：复用或重启

运行、MCP 与界面验证都在本仓库的开发版（`pnpm dev`）上做。先跑无头验证（Vitest、`pnpm build`、`pnpm smoke`、探针），再按需重启开发版，最后做界面和截图。

**查看当前 Windows 开发进程（PowerShell）：**

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" | Select-Object ProcessId, CommandLine
Get-Item apps/desktop/out/main/index.js | Select-Object LastWriteTime
```

| 现状 | 做法 |
| --- | --- |
| 没有开发版 | 运行 `pnpm dev` |
| 启动后改过 Main、Preload、Utility、`extras/` 非界面代码或 `packages/` 运行时代码 | 重启 `pnpm dev`（`pnpm dev` 只热更新 Renderer，不热更新主进程与契约） |
| `out/main` 时间晚于开发版启动（期间跑过 `pnpm build`） | 重启 `pnpm dev`，避免新旧产物混跑 |
| 只改了 Renderer（`.vue`、样式、Renderer 侧逻辑） | 直接复用，靠 Vite 热更新 |
| 热更新后状态异常，或改了 Pinia store、模块级单例 | 重启 `pnpm dev` |

## 界面验收与截图

在仓库根目录运行 `pnpm dev`，或参照 `apps/desktop/scripts/analysis-page-probe.mjs` 使用隐藏窗口（`show: false`）的 Electron 探针、临时 `userData` 和 `capturePage()` 生成隔离 PNG。默认使用常规窗口尺寸（1200×800）与默认字号（UI 14px）。

- **功能流程截图：**按操作顺序截取入口、交互、反馈与最终结果（`01-入口.png`、`02-结果.png`）。
- **样式前后对比：**在相同窗口尺寸、主题、字号下截取浅色与深色前后对比图（`before|after-light|dark-宽x高.png`）。
- **展示与归档：**最终回复中直接展示代表性截图，完整图片归档至 `test/日期-主题/`。

## 报告规范

- 报告写在 `test/YYYY-MM-DD-主题.md`（不超过 40 行），分五节：目标与成功标准 / 环境 / 步骤与命令 / 结果 / 未覆盖与后续。
- 产物不含私有正文、密钥或真实地址（测试地址统一用 `example.test`）。

## 验证记录

| 日期 | 主题 | 结论 | 报告 |
| --- | --- | --- | --- |
| 2026-11-25 | 创作方法与工作台 | 141 项定向测试及作品包装冒烟通过。本机小模型的章卡审读端到端未通过 | [验收记录](test/2026-11-25-writing-methods.md) |
| 2026-11-25 | 中国网文题材体系与创作框架 | 74 项单元与磁盘集成测试、多语言、边界及首屏构建预算通过；男女频开书与工作台界面探针截图验收通过 | [验收记录](test/2026-11-25-webnovel-genres-frameworks.md) |
| 2026-11-26 | 书籍网文定位全周期管理与连载平滑转型 | 150 项单元与磁盘集成测试、跨进程会话冒烟、边界及首屏构建预算通过；长短篇定位与 AGENTS.md Diff 审阅截图验收通过 | [验收记录](test/2026-11-26-book-positioning-transition.md) |
| 2026-11-26 | 全量浏览器交互巡检与界面设计优化 | 226 步浏览器实测复验通过，修复剧本题材错配、工具栏裁切、紧凑视口弹窗粘性底栏、Toast 遮挡去重与设置异常边界；构建预算通过 | [验收记录](test/2026-11-26-browser-ui-ux-audit.md) |
