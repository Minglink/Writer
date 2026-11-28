# 订阅配额折叠与 Google 登录回到 Writer

## 目标与成功标准

账号配额默认只显示一行，可展开并再次收起。账号的对话模型、余额和重置时间应与上游结果一致。浏览器回调页的按钮及空白区域应可唤回 Writer，已开始的凭证交换能继续完成。

## 环境

2026-11-28，Windows x64，Writer 1.7.0，Electron 42.5.0。使用本机已登录的 Google Antigravity 主账号刷新目录和配额、发起模型测试。重登、拒绝授权、移除及切换主账号在隔离配置中执行。截图中的实机账号标识已遮盖。

## 步骤与命令

- 在旧版本复现浏览器没有返回操作、17 条原始配额全部平铺。同账号、1200×800 窗口记录浅深色对比。[旧浅色](2026-11-28-quota-management/before-light.png) · [旧深色](2026-11-28-quota-management/before-dark.png)
- 运行 `pnpm exec vitest run subscriptions`、类型检查、改动文件 ESLint 与 Prettier、界面边界及多语言检查、`pnpm smoke:conversation`。
- 在 Electron 中通过正常订阅接口刷新真实账号，通过模型测试入口分别请求上游的 6 个对话模型；进入设置页验证折叠、展开、收起。
- 运行 `pnpm pack:win --skip-verify`、`node apps/desktop/scripts/subscription-accounts-probe.mjs test/2026-11-28-quota-management/simulated --packaged`，独立核对安装包与 latest.yml 的大小和 SHA-512。

## 结果

- 15 个测试文件共 86 项通过，类型、静态检查、构建预算和会话冒烟通过。初次启动和重新打开安装包内的 Writer 均通过。
- 真实账号的模型及配额一次刷新只请求一次可用模型接口。从 17 个原始记录中按上游菜单得到 6 个对话模型，并采用 Google 指定的首选项。Gemini 3.8 Flash 高、中、低三档、Claude Sonnet 4.6、Claude Opus 4.6、GPT-OSS 120B 均返回了用量。
- 模型调用后再刷新，三个 Gemini 档位剩余 99.999255%，另三项剩余 99.96136%。页面分别显示 >99.99% 与 99.96%，两组的本地重置时间分别为 19:27、19:40。缺失余额、无上限、零余额和重置时间已过均有独立测试。
- [默认折叠](2026-11-28-quota-management/after-light.png) · [深色](2026-11-28-quota-management/after-dark.png) · [展开明细](2026-11-28-quota-management/03-quota-details.png) · [再次收起](2026-11-28-quota-management/05-collapsed-again.png) · [对话模型](2026-11-28-quota-management/04-chat-models.png)
- 两个 Google 入口均用新建的本地模拟授权实际点击浏览器空白处，确认 Writer 窗口恢复可见；延迟交换、拒绝授权码、保存和重复登录均通过。九个平台共 10 条登录路径、18 个模拟账号，验证主备切换、停用、启用、移除及重开持久化。[浏览器回调页](2026-11-28-quota-management/simulated/google-antigravity-browser-return.png) · [登录保存过程](2026-11-28-quota-management/simulated/google-antigravity-oauth-03-saving.png)
- 本地安装包 `Writer-1.7.0-win-x64.exe` 为 106,865,762 字节，SHA-256 为 `4a7dc9151d9ce254dbbf0b53399367e862f4d77626056fe11613236f6d4fe88b`，与同目录清单的大小和 SHA-512 一致。

## 未覆盖与后续

本机仅 Antigravity 有已登录的订阅账号。其余八个平台的付费席位和真实上游授权交换未实测。当前账号的配额响应没有独立的周余额字段。九平台公开目录的来源见[当天核对记录](2026-11-28-google-login.md)。
