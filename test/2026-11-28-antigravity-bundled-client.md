# Antigravity 内置 OAuth 客户端与干净安装登录

## 目标与成功标准

发行版自带经过授权的 Antigravity 桌面 OAuth 客户端，用户不必设置环境变量。全新安装的包能打开 Google 登录链接、完成授权并把账号保存到 Writer；账号的模型目录与配额可用。

## 环境

2026-11-28，Windows x64，Writer 0.1.8 本地包。回调使用本机固定端口，浏览器授权走用户真实 Google 账号。干净安装前把 `%APPDATA%\@writer` 整目录备份到 `@writer.backup-20261128-202453`，卸载旧包后重新安装；模拟链路使用隔离资料目录与模拟上游。

## 步骤与命令

- 客户端取自本机 Cockpit Tools 发行文件：`cockpit-tools.exe` 中的 `1071006060591-…apps.googleusercontent.com` 与 `GOCSPX-K58F…qDAf`，与旧测试包逐值一致。
- 在 `google-antigravity.ts` 写死该客户端，解析顺序为已存凭据 → 适配器参数 → `WRITER_GOOGLE_ANTIGRAVITY_*` → `ANTIGRAVITY_OAUTH_*` → 内置值，并去掉该入口的构建期变量。
- 运行订阅相关 Vitest、改动文件 ESLint 与 Prettier、typecheck、`lint:boundary`、`pnpm build`。
- 清空八个 Google 运行时变量后以 `WRITER_PROBE_BUNDLED_GOOGLE_OAUTH=1` 跑九平台账号探针，核对链接与令牌请求都使用内置客户端、链接不带客户端密钥；再按九平台取消、拒绝、过期、保存与重开复查。
- 清理旧产物后 `pnpm pack:win --skip-verify`；卸载旧包，静默安装新包，首次启动后走一次真实授权。
- 授权后核对账号记录、加密密钥、上游模型目录与账号状态，并截取界面。

## 结果

- 57 项订阅测试（含新增的两条内置客户端断言）与 8 项 provider 测试通过；类型、边界、构建、打包及包内首次启动与重开冒烟通过。
- 探针在清空运行时配置后，Antigravity 链接的 `client_id` 与令牌请求的客户端密钥均为内置值，链接不含密钥；九平台全部通过。
- 干净安装的 0.1.8 打开 Google 授权页并完成登录后，账号写入 `subscription-accounts.json` 且附带加密密钥，状态 `active`、套餐 Pro，随即拉回 10 个可用模型。
- 安装包 106,867,156 字节，SHA-256 为 `9cd5fde5bb33802e94b3135807f6846be66307d301db2892320e4c6b289facde`，公开附件与该哈希一致。[登录链接](../test/2026-11-28-antigravity-approved-client/01-login-link.png) · [账号保存](../test/2026-11-28-antigravity-approved-client/02-account-saved.png) · [模拟链路截图](2026-11-28-antigravity-approved-client/accounts/)
- 已发布 [v0.1.8](https://github.com/Minglink/Writer/releases/tag/v0.1.8)，`update.json` 推送后公开清单返回 0.1.8 与对应发布页。安装包在原地升级后账号与模型目录保持可用。

## 未覆盖与后续

Gemini CLI 入口仍靠构建期变量，仓库里没有对应的 Gemini 客户端密钥，CI 缺省时只发警告、该入口在包内显示未启用。刷新令牌与模型实际调用未在本轮单独复跑，沿用 0.1.7 结论。真实登录后的资料目录留在 `%APPDATA%\@writer`，备份目录未合并。
