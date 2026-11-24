---
name: package-patch-release
description: 为 Writer 递增版本号、清理旧产物并打包 Windows x64 安装包；按授权发布到 Minglink/Writer 的 GitHub Release，验证公开后更新并推送根目录 update.json。
---

# Writer 版本打包与 GitHub Release 发布

打包与校验规则遵循 [windows-package](../windows-package/SKILL.md)，提交与推送遵循 [git-commit](../git-commit/SKILL.md)。仅在用户明确要求发布时才创建 GitHub Release 并更新 `update.json`。

## 1. 定版本并清理旧产物

1. 查看 Git 状态、根目录 `package.json` 与 `apps/desktop/package.json` 的 `version`、`update.json` 的 `version`、远端最新 tag 以及 `apps/desktop/release/` 目录。
2. 两个 `package.json` 的 `version` 必须保持一致的三段式 SemVer，且大于当前已发布的 `update.json.version`（用户指定版本号优先；“升一个小版本”则递增补丁位一次）。
3. 清理 `apps/desktop/release/` 下的旧安装包、`win-unpacked/`、`latest*.yml`、`builder-debug.yml` 等旧生成物。
4. 同步更新两个 `package.json` 的顶层 `version`（此时暂不修改 `update.json`）。

## 2. 构建 Windows x64 安装包与 latest.yml

1. 执行 `pnpm pack:win --skip-verify`，确保构建与包内首次启动/重开冒烟通过。
2. 用 `tools/release-files.mjs` 计算 `Writer-<新版本>-win-x64.exe` 的大小与 SHA-512，生成对应的 `apps/desktop/release/latest.yml`。

## 3. 发布 GitHub Release（需用户授权）

1. 检查 `gh auth status` 及 `Minglink/Writer` 是否已存在 `v<新版本>`，禁止覆盖已有公开 Release。
2. 先创建 Draft Release（标题 `Writer <新版本>`），上传三个资产：
   - `Writer-<新版本>-win-x64.exe`
   - `Writer-<新版本>-win-x64.exe.blockmap`
   - `latest.yml`
3. 用 `gh release view v<新版本> --json assets` 确认三个资产均上传成功且大小非零后，将 Draft 设为公开正式版（`--draft=false --latest`）。

## 4. 更新并推送 update.json

1. 确认 Release 已公开可访问后，更新根目录 `update.json` 的 `version`、`title`、`publishedAt`（`+08:00` ISO 8601）、`releaseNotes`、`releasePage`（`https://github.com/Minglink/Writer/releases/tag/v<新版本>`）与 `feedUrl`（`https://github.com/Minglink/Writer/releases/latest/download`）。
2. 提交更新并推送至 `origin/main`，最后校验 `https://raw.githubusercontent.com/Minglink/Writer/main/update.json` 已返回新版本清单。
