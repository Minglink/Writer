# 九个平台的订阅登录和双账号管理（2026-11-28）

## 目标与成功标准

在九个平台各接入两个模拟账号。验证链接可以复制和打开、取消或失败不新增账号、成功后显示上游模型，以及切换、停用、启用、移除和重开后的账号状态。

## 环境

Windows x64、Writer 0.1.6、Electron 42.5.0。每次运行创建独立临时资料目录。Electron 开发构建使用实际界面、Preload、Main、适配器、系统加密存储和本机 OAuth 回调。上游 HTTP 响应、系统浏览器打开目标及剪贴板使用测试替身，超时场景使用缩短的等待时间。截图中的授权地址已脱敏。

## 步骤与命令

运行 `pnpm exec vitest run subscriptions`、改动文件 ESLint / Prettier、`pnpm typecheck`、`pnpm lint:boundary`、`pnpm lint:i18n`、`pnpm smoke:conversation`、`pnpm pack:win --skip-verify`。
运行 `node apps/desktop/scripts/subscription-accounts-probe.mjs test/2026-11-28-subscription-accounts --packaged`。先在设置页走完各登录流程，启动打包版复查账号和缓存，再重新打开开发构建，删除账号后再次重开。

## 结果

| 登录路径 | 平台 | 模拟上游的实测结果 |
| --- | --- | --- |
| 浏览器回调 | Google Gemini CLI、Google Antigravity、OpenAI Codex、Claude、Kiro Social | 复制和打开本次链接、取消、拒绝回调、等待超时及授权成功 |
| 设备码 | GitHub Copilot、Kiro AWS Builder ID | 验证地址和配对码、取消、上游拒绝、设备码过期及配对成功 |
| 浏览器轮询 | Cursor、CodeBuddy | 打开链接、取消、上游拒绝、轮询超时及返回会话成功 |
| 浏览器授权码回填 | Windsurf | 打开链接、取消、无效或过期码提示、有效授权码换取 API Key。流程依据[官方插件实现](https://github.com/Exafunction/codeium.nvim/blob/main/lua/codeium/api.lua) |

- 各平台共 18 个模拟账号。每个平台登录后均返回测试专用模型；切换主账号、停用后由另一个账号接任、重新启用、取消移除、确认移除和两次重开的断言全部通过。打包版读到九个平台各两个账号、所选主账号和已缓存的上游模型。[打包版截图](2026-11-28-subscription-accounts/packaged-cursor-accounts.png)
- 模拟 Claude 配额耗尽和凭证失效。失效账号停用再启用仍显示已失效，同账号重新授权后恢复可用。另有回归测试覆盖同名无邮箱的不同凭证、同一凭证重复导入，以及授权结果早于启动响应。[失效状态截图](2026-11-28-subscription-accounts/claude-03-expired.png)
- 15 个测试文件、79 项通过。静态检查、体积预算、会话冒烟、包内首次启动与重开冒烟通过。安装包为 106,864,005 字节，SHA-256 为 `3fbd3285c34882a7fb95dfe6893deebccd06f8dd17d03c90b0691d435682365e`。[完整截图](2026-11-28-subscription-accounts/)

## 未覆盖与后续

未使用真实订阅账号完成上游授权或模型推理。不同地区、套餐的实际模型清单取决于登录后的服务端响应。该日期公开模型与来源见[九平台模型核对记录](2026-11-28-google-login.md)。
