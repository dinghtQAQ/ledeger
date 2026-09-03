# 07: 细类分析与周期切换

**What to build:** 在分析工作台上增加粗类/细类切换和时间范围导航。用户可以查看当前周期、上一周期、下一周期或自定义日期范围；细类结果包含所属粗类信息；空分类显示为“未分类”。

**Blocked by:** 06: 粗类分析工作台

**Status:** done

- [x] 图表提供粗类与细类切换开关，默认粗类
- [x] 细类项目返回自身和所属粗类的标识与名称
- [x] 用户可以切换当前、上一和下一工资周期
- [x] 用户可以输入自定义起止日期
- [x] 自定义日期在界面上包含结束日，服务端使用排他结束边界
- [x] 切换层级或日期范围不会修改账本设置
- [x] 空粗类或细类在图表和摘要中显示为“未分类”
- [x] 浏览器测试覆盖层级切换、周期导航和自定义范围

## Verification

- 改动文件：`src/index.ts`、`src/schemas.ts`、`frontend/src/main.tsx`、`frontend/src/styles.css`、`test/index.spec.ts`、`test/browser/entry-flow.spec.ts`
- 测试命令：`pnpm run typecheck`；`pnpm run build`；`pnpm run test`；`pnpm run test:browser`
- 测试结果：类型检查通过；生产构建通过；Worker HTTP 测试 25/25 通过；Playwright 浏览器测试 11/11 通过；分析专项浏览器测试 1/1 通过。
- 剩余风险：粗类分析请求仍会读取细类映射以复用统一聚合路径，属于低优先级性能优化项；不影响当前外部行为。
