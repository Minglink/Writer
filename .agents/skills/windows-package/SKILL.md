---
name: windows-package
description: 构建并验证 Writer Windows x64 安装包（Writer-<version>-win-x64.exe）；本地只测本轮改动后加 --skip-verify 一次编排出包。版本递增与发布 GitHub Release 另用 package-patch-release。
---

# Writer Windows 安装包构建与校验

默认生成本地 Windows x64 正式命名安装包（`Writer-<version>-win-x64.exe`），保持当前版本号不变。需要递增版本或发布 GitHub Release 时，配合 [package-patch-release](../package-patch-release/SKILL.md) 执行。

## 1. 打包前最小校验

本地打包一律带 `--skip-verify`，全量 `pnpm verify` 由 GitHub Actions CI 执行：

- 若本轮改动尚未验证：只对本轮修改的文件跑 `pnpm vitest related --run <改动文件>`、`pnpm exec eslint <改动文件>`、`pnpm exec prettier --check <改动文件>`（改了类型或契约再加 `pnpm typecheck`）。
- 若用户已确认验证过或本会话已测过且未再改代码：直接进入打包。

## 2. 一次编排出包

在仓库根目录执行：

```bash
pnpm pack:win --skip-verify
```

- 不要绕过编排脚本直接调 `electron-builder`；`tools/run-test-package.mjs` 会自动完成 `pnpm build`、NSIS 打包、包内运行时文件完整性检查，以及首次启动与重新打开冒烟（`verify-test-package.mjs`）。
- 正常结束后不要重复运行 `pnpm electron:ensure` 或 `verify-test-package.mjs`。

## 3. 失败排查

- L1 检查失败：只修本轮改动引起的问题并重跑失败项。
- `pnpm build` 或包内冒烟失败：按报错定位根因修复后，重新运行 `pnpm pack:win --skip-verify`（同一问题最多诊断修复两轮，仍受阻则汇报原因）。

## 4. 交付核对

检查 `apps/desktop/release/` 下的产物文件名与非零大小：
- `Writer-<version>-win-x64.exe`
- `Writer-<version>-win-x64.exe.blockmap`

向用户简明汇报：版本号、安装包路径与大小、打包前校验范围及包内冒烟结果。
