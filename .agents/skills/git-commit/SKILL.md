---
name: git-commit
description: 在 Writer 创建 Git 提交、推送、Pull Request 或合并时使用，核对变更范围、项目校验与远端分支状态。
---

# Writer Git 提交与交付

适用于用户明确要求的 Git 提交、推送或 PR；仅编辑代码时不自动提交。若发布技能对提交文件或顺序有更严格的约束，优先遵循发布技能。

## 提交前检查

1. 核对当前分支、工作树、暂存区与未跟踪文件；只暂存本次任务经审阅的文件，保留用户未纳入本轮的本地修改。
2. 审阅拟提交的 diff，确保测试、夹具、快照和日志中不含真实密钥、凭据或私有作品内容（测试地址统一用 `example.test`）。
3. 代码改动按 `TEST.md` 跑 L1 校验：`pnpm vitest related --run <文件>`、`pnpm exec eslint <文件>`、`pnpm exec prettier --check <文件>`；涉及类型或契约时补充 `pnpm typecheck`。本会话已测过且未再改动的文件不重复跑；全量 `pnpm verify` 交给 GitHub Actions CI。

## 提交与推送

- 使用仓库当前配置的 Git 身份提交，不自行添加额外的 `Co-authored-by` 或 `Signed-off-by` 尾注（除非用户明确要求）。
- 提交前执行 `git diff --cached --check` 检查空白字符与冲突标记。
- 推送前核对目标分支与远端历史，禁止未经授权的强制推送；推送后核对本地 `HEAD` 与远端分支 SHA 一致。
