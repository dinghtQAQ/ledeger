# ledeger

Cloudflare Worker 的 TypeScript 基线，使用 Hono 处理 HTTP 接口，使用 D1 持久化数据。

## 本地开发

环境要求：Node.js 24+、pnpm 10+。

```bash
pnpm install
pnpm dev
```

开发服务器默认地址为 `http://localhost:8787`。

常用命令：

```bash
pnpm run cf-typegen       # 根据 wrangler.jsonc 生成 Worker 运行时类型
pnpm run typecheck        # 检查 Worker 和测试的 TypeScript 类型
pnpm run test             # 在 workerd 运行测试
pnpm run test:watch       # 监听模式运行测试
pnpm run check            # 类型检查 + 测试，作为合并前门禁
pnpm run deploy:dry-run   # 检查部署产物，不发布
pnpm run deploy           # 发布到 Cloudflare Workers
```

新增或修改 Wrangler bindings 后，先运行 `pnpm run cf-typegen`，再运行 `pnpm run check`。

当前接口：

- `GET /`：返回 Worker smoke response
- `GET /health`：返回 Hono JSON 健康状态
- `GET /health/db`：通过 D1 执行 `SELECT 1`，验证数据库 binding
- `GET /openapi.json`：OpenAPI 3.0 文档
- `GET /docs`：Swagger UI 交互式 API 文档
- `POST /entries`：创建收入、支出或到期支出（必须携带 Bearer 鉴权和 `Idempotency-Key`）
- `GET /entries`：游标分页，支持 `from`、`to`、`category`、`sort` 和 `limit`
- `GET /entries/:id`：查询单笔账目
- `DELETE /entries/:id`：执行一次完整冲正，不物理删除
- `POST /entries/:id/pay`：将到期支出标记为已付款

## 记账规则

- 账目类型为 `income`、`expense`、`due_expense`。
- 金额必须使用十进制字符串，且为正数；输入超过 4 位小数时按半入规则舍入到 4 位。
- D1 以四位小数整数单位作为金额的唯一存储源；响应中的 `amount` 由该单位还原，`displayAmount` 默认显示三位小数。
- 冲正会保留原记录，并在同一 D1 batch 中写入等额反向记录；同一账目只能冲正一次。
- 到期支出有 `unpaid`、`paid`、`cancelled` 状态；冲正会将原到期支出置为 `cancelled`，付款只改变状态，不创建重复账目。
- 数据库时间保存为 UTC；日期筛选按 `LEDGER_TIMEZONE` 解释，默认 `Asia/Shanghai`。

业务接口鉴权：

```text
Authorization: Bearer <LEDGER_API_KEY>
```

`/health`、`/health/db`、`/docs`、`/openapi.json` 公开访问；业务接口未配置或未提供正确密钥时返回 `403`。

## 发布流程

1. 从 `main` 创建功能分支，提交代码并运行 `pnpm run check`。
2. 创建 Pull Request；Cloudflare Workers Builds 负责执行检查并生成预览部署。
3. 合并到 `main` 后由 Workers Builds 执行 `pnpm run deploy`，`main` 是生产分支。
4. 需要回滚时，使用 Wrangler 的版本回滚命令：

   ```bash
   pnpm exec wrangler rollback
   ```

Workers Builds 建议配置：

- 构建命令：`pnpm install --frozen-lockfile && pnpm run check`
- 部署命令：`pnpm run deploy`
- 生产分支：`main`
- 打开 Pull Request 预览部署

## 配置与密钥

- 公共 Worker 配置放在 `wrangler.jsonc`；个人生产配置使用未提交的独立 Wrangler 配置文件。
- 本地非敏感变量放在 `.dev.vars`；敏感变量使用 `.dev.vars` 文件或 `.dev.vars.example` 约定，均不会提交。
- 线上密钥使用 `pnpm exec wrangler secret put <NAME>` 写入，不放进仓库。
- D1 binding 名称为 `DB`，数据库名为 `ledeger-db`。
- 业务表通过 `migrations/0001_entries.sql` 创建；不要在请求处理器中执行建表。
- 尚未声明 KV、Durable Objects、R2 或其他 bindings；等业务需求确定后再添加。

本地开发变量可参考已提交的 `.dev.vars.example`，实际值放在未提交的 `.dev.vars`：

```text
LEDGER_API_KEY=replace-with-a-local-secret
LEDGER_TIMEZONE=Asia/Shanghai
```

生产环境请使用单独的未提交 Wrangler 配置文件（例如 `wrangler.production.jsonc`），在其中填写生产 D1 的 `database_id`，并通过 `--config wrangler.production.jsonc` 部署。不要把个人 D1 ID 或密钥写入公共配置。

首次创建 D1 数据库（只需执行一次）：

```bash
pnpm exec wrangler d1 create ledeger-db
```

将命令输出的 `database_id` 写入个人未提交的 Wrangler 配置文件，然后运行：

```bash
pnpm run cf-typegen
pnpm run check
```

首次登录 Cloudflare：

```bash
pnpm exec wrangler login
```
