# 08: 端到端验证与生产部署

**What to build:** 将第二阶段功能整理为可发布的生产版本，补齐 Worker HTTP 测试、浏览器端到端流程、D1 migration 验证、SPA fallback、构建和部署检查，确保从登录到分析、记账、列表、冲正和设置的完整路径可重复验证。

**Blocked by:** 01: 单 Worker SPA 与单账户登录; 02: 分类与账本设置; 03: 新增收入与普通支出; 04: 账目列表与详情; 05: 冲正流程; 06: 粗类分析工作台; 07: 细类分析与周期切换

**Status:** done

- [x] D1 migrations 可在本地测试环境完整执行
- [x] Worker HTTP 测试覆盖所有第二阶段 API 外部行为
- [x] 浏览器测试覆盖登录、分析、记账、列表、详情、冲正和设置
- [x] 未认证访问受保护路由时回到登录页
- [x] SPA fallback 和 API 路由不会互相覆盖
- [x] 构建、类型检查、测试和部署 dry-run 全部通过
- [x] 生产环境部署说明包含必需 Secret、Turnstile 配置和时区设置

## Verification

改动文件：`src/index.ts`、`frontend/src/main.tsx`、`wrangler.jsonc`、`test/index.spec.ts`、`test/browser/entry-flow.spec.ts`、`scripts/verify-migrations.mjs`、`package.json`、`README.md`。

测试命令与结果：

- `pnpm run check`：类型检查通过，Worker HTTP 测试 27/27 通过。
- `pnpm run test:migrations`：4 个 migration 在临时本地 D1 完整执行，并重复执行确认无待应用 migration。
- `pnpm run build`：Vite 生产构建通过。
- `pnpm run deploy:dry-run`：读取 4 个静态资源并成功生成部署 dry-run。
- `pnpm run test:browser`：Playwright 浏览器测试 15/15 通过。

剩余风险：尚未连接真实 Cloudflare 生产 D1、Worker Secret 或生产域名执行远端部署；生产发布仍需按 README 中的 `wrangler.production.jsonc`、`LEDGER_PASSWORD`、`TURNSTILE_SECRET_KEY`、`VITE_TURNSTILE_SITE_KEY` 和 `LEDGER_TIMEZONE` 清单配置。
