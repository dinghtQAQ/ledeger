# 09: 将 phase2 数据库初始化完全迁移化

**What to build:** 让 phase2 的数据库结构只通过版本化 migration 创建和演进，避免请求处理器在运行时修改 schema，并确保实际约束与发布 migration 保持一致。

**Blocked by:** None (can start immediately)

**Status:** done

- [x] 受保护请求不再执行建表、改表、播种或建索引等 DDL 操作
- [x] 全新本地数据库执行完整 migration 后，分类、设置、会话及账目字段和约束一次性可用
- [x] 运行时使用的分类关系约束与 migration 定义一致，不存在弱化或漂移
- [x] Wrangler binding 类型与当前配置同步生成，类型检查和 HTTP 测试通过
- [x] 增加回归验证，确认重复请求不会触发 schema 初始化副作用

## Verification

改动文件：`src/index.ts`、`test/index.spec.ts`、`test/raw-modules.d.ts`、`worker-configuration.d.ts`。

测试命令与结果：

- `pnpm run check`：类型检查通过，Worker HTTP 测试 28/28 通过。
- `pnpm run test:migrations`：4 个 migration 在全新本地 D1 完整执行，重复执行确认无待应用 migration。
- `pnpm exec wrangler types --check`：binding 类型与当前 `wrangler.jsonc` 配置同步。
- `pnpm run build`：Vite 生产构建通过。
- `pnpm run deploy:dry-run`：读取 4 个静态资源并成功生成部署 dry-run。
- `pnpm run test:browser`：Playwright 浏览器测试 15/15 通过。

剩余风险：未连接真实 Cloudflare 生产 D1、Worker Secret 或生产域名执行远端部署；生产发布仍需按既有部署说明完成配置。
