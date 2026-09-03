# 06: 粗类分析工作台

**What to build:** 让登录后的用户进入分析工作台，默认查看当前工资周期的收入、普通支出、周期净额和全局当前余额，并按粗类查看支出柱状图。分析只统计收入和普通支出，完全排除冲正原账目与冲正记录。

**Blocked by:** 01: 单 Worker SPA 与单账户登录; 02: 分类与账本设置; 03: 新增收入与普通支出; 05: 冲正流程

**Status:** done

- [x] 登录成功后默认进入 `/analytics`
- [x] 系统按发薪日和既有时区计算当前工资周期
- [x] 分析返回所选期间收入、普通支出和周期净额
- [x] 分析返回不受日期筛选影响的全局当前余额
- [x] 柱状图 X 轴为粗类，Y 轴为普通支出金额
- [x] 分类统计同时返回金额和笔数
- [x] 冲正原账目与冲正记录不进入任何分析结果
- [x] 金额以十进制字符串传输，展示格式与计算值分离
- [x] HTTP 测试覆盖统计口径、周期边界、余额独立性和冲正排除

## Verification

- 改动文件：`src/index.ts`、`src/schemas.ts`、`frontend/src/main.tsx`、`frontend/src/styles.css`、`test/index.spec.ts`、`test/browser/entry-flow.spec.ts`
- 测试命令：`pnpm run check`；`pnpm run test:browser`；`pnpm exec playwright test test/browser/entry-flow.spec.ts -g "登录后默认进入分析"`
- 测试结果：类型检查通过；Worker HTTP 测试 25/25 通过；Playwright 浏览器测试 10/10 通过；固定时钟周期测试 1/1 通过。
- 剩余风险：上一/下一周期、自定义范围及粗类/细类切换属于后续 ticket 07，未在本 ticket 实现；图表当前以固定粗类柱状布局呈现，未提供独立数值刻度控件。
