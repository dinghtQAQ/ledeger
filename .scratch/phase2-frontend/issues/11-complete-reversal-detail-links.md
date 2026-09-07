# 11: 让冲正详情关联不受列表窗口限制

**What to build:** 让原账目和冲正记录在详情页始终能够互相跳转，不因账目总量或列表分页窗口而丢失关联。

**Blocked by:** None (can start immediately)

**Status:** done

- [x] 原账目详情可以定位并打开对应冲正记录
- [x] 冲正记录详情可以定位并打开对应原账目
- [x] 关联查找不依赖固定数量的最近列表结果
- [x] 账目超过当前列表窗口后，关联链接仍然存在且指向正确记录
- [x] API 和浏览器测试覆盖双向跳转及大于列表窗口的数据量

## Verification

- 改动文件：`src/schemas.ts`、`src/index.ts`、`frontend/src/main.tsx`、`test/index.spec.ts`、`test/browser/entry-flow.spec.ts`
- 测试命令：`pnpm run check`、`pnpm run test:browser`
- 测试结果：类型检查通过；Worker 测试 30/30 通过；浏览器测试 16/16 通过。
- 剩余风险：详情响应新增 `relatedEntry` 字段；旧客户端可忽略该字段，未发现其他已知风险。
