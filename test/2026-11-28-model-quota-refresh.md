# Antigravity 当前账号模型目录与配额刷新

## 目标与成功标准

Writer 应显示 Google 为当前账号开放的最新对话模型。账号配额可手动刷新；展开明细后能自动获取新值。更新模型、配额、成功时间时使用同一次实际请求，网络失败应能重试并保留上一份成功结果。

## 环境

2026-11-28，Windows x64，Antigravity 桌面版 2.36.0，Writer 1.7.0，Electron 42.5.0。本机已登录的 Antigravity 账号用于正常目录、配额及模型调用。账号标识在截图中已遮盖。

## 步骤与命令

- 用相同账号、项目、Google 接口比较旧版请求、单独更新版本号的请求及当前 Hub 格式的请求；只记录模型 ID 和配额元数据。公开套餐规则见 [Google 模型目录](https://antigravity.google/docs/models)。
- 运行 `pnpm exec vitest run subscriptions`、`pnpm typecheck`、改动文件 ESLint 与 Prettier、边界、多语言和会话冒烟；运行 `pnpm pack:win --skip-verify` 和九平台账号探针（含打包版）。
- 从设置切到 Google Antigravity，点击账号的「刷新配额」、展开明细、再次拉取最新模型；在明细打开的窗口中等待一次真实自动更新。在测试进程中模拟一次 HTTP 503 并手动重试。

## 结果

- 两种旧式请求均只返回 6 个菜单项。当前 Hub 菜单返回 13 项，其中 Neon、Carbon、Argon 三项带禁用标记。Writer 得到 10 个可用档位和对应的 10 条配额。首选项为 Gemini 4 Hydrogen High。
- Hydrogen 的 Low、Medium、High、XHigh 四个实际模型请求全部返回用量。调用后，手动刷新观察到 Gemini 剩余比例从 99.999255% 降至 99.990815%，新版可分别显示 99.9993% 和 99.9908%。
- 分别点「刷新配额」和「拉取最新模型」均只发起一次目录与配额请求，界面数据与响应一致。展开后约 80 秒，自动刷新推进了成功时间；模拟 503 时旧配额和时间保持，重试恢复。
- [旧版浅色](2026-11-28-model-quota-refresh/before-light.png) · [新版浅色](2026-11-28-model-quota-refresh/after-light.png) · [旧版深色](2026-11-28-model-quota-refresh/before-dark.png) · [新版深色](2026-11-28-model-quota-refresh/after-dark.png) · [配额明细](2026-11-28-model-quota-refresh/02-updated-quota.png) · [失败重试](2026-11-28-model-quota-refresh/03-offline-keeps-quota.png) · [当前模型](2026-11-28-model-quota-refresh/04-latest-models.png)
- 订阅回归共 15 个文件、88 项通过。九平台的登录和账号管理使用隔离的 18 个模拟账号验证。
- 最终 Windows x64 1.7.0 包首次启动、重开及九平台账号持久化复验通过。安装包为 106,867,391 字节，大小和 SHA-512 与 `latest.yml` 一致，SHA-256 为 `b09b21d00660dd08727e8e706bfb94db8ae5fafbe936e75b766cd19b3bbbbddb`。

## 未覆盖与后续

真实上游验证覆盖本机已登录的 Antigravity 账号。其他八个平台使用模拟订阅回归。Google 会按账号及套餐调整目录，后续结果以刷新时的响应为准。
