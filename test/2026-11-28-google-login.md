# Google 订阅登录链接与模型目录（2026-11-28）

## 目标与成功标准

两个 Google 入口均在启动浏览器之前显示本次登录的完整地址，用户能够复制、打开或取消。按平台核对离线目录，登录后以账号实际返回的模型为准。

## 环境

Windows x64、Electron 42.5.0、Writer 0.1.6；隔离的空用户目录，1200 × 800。截图中的授权网址已替换为 example.test。

## 步骤与命令

从左下角账号菜单进入设置 → 订阅模型管理。旧构建模拟系统浏览器不返回，复现等待期间无链接。新构建依次选择 Gemini CLI 与 Antigravity，获取链接，核对链接绑定本次授权，检查复制内容、交给浏览器的地址与取消结果。打包版另以缺省 OAuth 配置复测两个入口。
运行订阅相关 Vitest、改动文件 ESLint 与 Prettier、typecheck、lint:boundary、lint:i18n、smoke:conversation 及 pack:win --skip-verify。

## 结果

15 个测试文件共 77 项通过。两个入口通过 Electron 页面、Preload、Main 和本机回调监听器的验证。包内首次启动与重开冒烟通过。安装包为 106,862,308 字节，SHA-256 为 `15f54ee74152c5863cae4f4495617cc2027a15e3508955adb41c584ba227c740`。[完整截图](2026-11-28-google-login/)

| 平台 | 核对结果和依据 |
| --- | --- |
| Google Gemini CLI | 现有标准版／企业版支持 3.x，离线展示 3.5 Flash 与 3.1 Pro Preview；预览权限由管理员控制。[支持范围](https://docs.cloud.google.com/gemini/docs/codeassist/sunset) · [模型与版本通道](https://docs.cloud.google.com/gemini/docs/codeassist/gemini-3) |
| Google Antigravity | 增补 Hydrogen；Neon 支持最高 512K 上下文。Neon、Carbon、Hydrogen 按套餐开放。Argon 和 3.8 Flash 计划于 11 月 30 日退出。[模型与套餐](https://antigravity.google/docs/models) |
| OpenAI Codex | 6.2 Astra 和 Sol 均在支持的订阅计划中；更新模型查询所用的稳定版客户端版本。[模型](https://developers.openai.com/codex/models/) · [0.172.0](https://github.com/openai/codex/releases/tag/rust-v0.172.0) |
| GitHub Copilot | 补入 GPT-6.2 Sol，与已有 Astra 同列。[支持模型](https://docs.github.com/en/copilot/reference/ai-models/supported-models) |
| Claude | 已有 Fable 5.2、Opus 5.5、Sonnet 5.5、Haiku 5.5，四个标识与公开目录一致。[模型总览](https://platform.claude.com/docs/en/models/overview) |
| Kiro | 补入企业限量预览 GPT-6.2 Astra、Grok 4.7、Kimi K3，各有地区或方案限制。[可用模型](https://kiro.dev/docs/models/available-models/) |
| Cursor | 加入自有模型 Grok 4.7，官方列出的标准窗口为 256K。[Grok 4.7](https://cursor.com/docs/models/grok-4-7) |
| Windsurf | 同系列旗舰已更新至 SWE-2.1，Fable 5.2 正向付费组织推出。[模型选择](https://docs.devin.ai/desktop/models) |
| CodeBuddy | 以 DeepSeek V4 Pro、V4 Flash 对应具体变体。腾讯产品目录还列有 GLM-5.3 Flash 和 Kimi K3。[CodeBuddy CLI 更新](https://www.codebuddy.cn/docs/cli/release-notes/v2.103.0) · [腾讯模型目录](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model) |

## 未覆盖与后续

用户账号授权、真实令牌交换和各订阅席位的模型调用未实测。官方公开模型名用于核对离线候选，各地区和套餐的接口标识与授权范围以在线响应为准。
