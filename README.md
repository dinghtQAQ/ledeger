# ledeger

Cloudflare Worker 的最小 TypeScript 基线，使用 Wrangler 原生开发与部署流程。

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

- Worker 配置唯一来源为 `wrangler.jsonc`。
- 本地非敏感变量放在 `.dev.vars`；敏感变量使用 `.dev.vars` 文件或 `.dev.vars.example` 约定，均不会提交。
- 线上密钥使用 `pnpm exec wrangler secret put <NAME>` 写入，不放进仓库。
- 当前尚未声明 D1、KV、Durable Objects、R2 或其他 bindings；等业务需求确定后再添加。

首次登录 Cloudflare：

```bash
pnpm exec wrangler login
```
