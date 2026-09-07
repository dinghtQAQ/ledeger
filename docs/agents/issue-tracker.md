# Issue Tracker: GitHub

本仓库使用 GitHub Issues 作为唯一的工作跟踪入口，对应仓库为
`dinghtQAQ/ledeger`。本地 ticket 已完成迁移并删除；新增或更新 issue 时，使用
`gh issue` 命令直接同步到 GitHub。

## 常用操作

- 创建：`gh issue create --title "..." --body-file <file>`
- 查看：`gh issue view <number> --comments`
- 列表：`gh issue list --state open --json number,title,labels`
- 评论：`gh issue comment <number> --body "..."`
- 关闭：`gh issue close <number> --comment "..."`

## 约定

- 规格总 issue 作为阶段索引，链接到拆分后的实现 issue。
- 已经完成并有验证记录的 issue 发布到 GitHub 后立即关闭，并在 GitHub issue 中保留验收清单。
- PR 不作为外部需求的 triage surface；需求统一进入 issue。
