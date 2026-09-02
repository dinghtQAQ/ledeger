# 使用 D1 migration 管理数据库并隔离个人部署配置

**Status: accepted**

数据库使用 Cloudflare D1，并通过版本化 migration 创建和演进业务表；公共仓库只保留不含个人标识的 Worker 配置，生产 D1 的 `database_id` 使用未提交的独立配置文件，密钥通过 Worker secret 写入。选择这一方式是为了让项目可以复现数据库结构，又不会把个人部署信息带入公共仓库。

## Consequences

- 新的表结构变化必须通过 migration 发布，不能在请求处理器中建表。
- 本地和生产环境可以使用不同的 D1 绑定，但必须共享同一套 migration。
- 当前不在应用层实现备份和导出。
