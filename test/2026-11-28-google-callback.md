# Google 登录回到 Writer 后的账号保存反馈

## 目标与成功标准

在 Gemini CLI、Antigravity 中从浏览器回到 Writer，点登录弹窗外侧仍可继续。收到授权码、换取凭证失败、新账号保存及已有账号更新都能辨认；模型目录变慢时，账号先可见。

## 环境

Windows x64，Electron 42.5.0，Writer 1.7.0 本地重打包，隔离的临时配置和模拟 Google 账号。

## 步骤与命令

旧打包版的两个 Google 入口均可复现，打开登录弹窗后在遮罩上按下鼠标，登录会被取消。新打包版用相同步骤复测，再点「取消」验证主动取消。
运行 `pnpm exec vitest run subscriptions`、改动文件 ESLint 和 Prettier、typecheck、界面边界和多语言检查、会话冒烟及 `pnpm pack:win --skip-verify`。
运行 `node apps/desktop/scripts/subscription-accounts-probe.mjs test/2026-11-28-google-callback --packaged`。模拟延迟换取凭证、拒绝授权码、延迟模型目录以及重复登录，逐个打开九个平台的账号池。

## 结果

- 83 项定向测试通过。浏览器回调页收到授权码即提示返回 Writer 查看保存结果。换取凭证期间点击弹窗外保持会话有效。[保存中](2026-11-28-google-callback/google-gemini-cli-oauth-03-saving.png)
- 模拟 Google 返回 invalid_grant，两个入口均显示重新获取链接的提示，账号数不变。模拟模型目录延迟时，账号先写入并出现在列表。同账号再次登录仅更新该行并显示对应提示。[授权码被拒](2026-11-28-google-callback/google-antigravity-oauth-04-rejected.png)
- 包内首次启动、重开、打包版两个 Google 弹窗的空白处点击、九平台 18 个模拟账号检查均通过。安装包 106,864,548 字节，SHA-256 为 `0a362ab41cdacf16b0de4e155ef4219d697d620e6d314cc96959022cddc12dcf`。[完整截图](2026-11-28-google-callback/)

## 未覆盖与后续

本次未使用用户的 Google 账号或复原其单次登录记录，具体失败环节仍取决于该次凭证交换和保存结果。[Google 桌面应用授权流程](https://developers.google.com/identity/protocols/oauth2/native-app)
