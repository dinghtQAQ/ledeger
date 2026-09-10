# 第二阶段前端实施设计

## 目标

在不改变单用户总账边界的前提下，增加同源 React/Vite/TypeScript SPA，提供登录、分析、账目列表、新增记账、详情冲正和设置页面。当前阶段只新增收入与普通支出；旧版到期支出能力不作为前端功能，也不进入分析。

## 部署

前端构建产物由同一个 Cloudflare Worker 托管，API 继续使用现有 Worker 路由。生产只需要部署一个 Worker；前端与 API 使用同源路径，不把 API key 放入浏览器。Wrangler 配置增加静态资源目录和 SPA fallback，开发环境继续使用现有 Worker dev 流程。

## 认证

### API

```text
POST /auth/login
body: { password, turnstileToken }
response: { authenticated: true, expiresAt }

GET /auth/session
response: { authenticated, expiresAt? }

POST /auth/logout
response: 204
```

- 密码只从 Worker Secret 读取，不建立用户表。
- D1 保存会话哈希、创建时间和过期时间。
- 会话有效期 7 天，认证请求滑动续期。
- Cookie 使用 HttpOnly、Secure、SameSite=Lax。
- 所有业务写请求（无论使用 Bearer 还是 Cookie 会话）都必须提供 `Origin` 或 `Referer`，并通过同源校验；缺失或跨来源均拒绝。若两者同时存在，以 `Origin` 为准。
- 每次登录要求 Turnstile；登录失败仍执行轻量限速。

## 数据模型迁移

新增固定粗类表：

```text
coarse_categories(id, name)
```

新增细类表：

```text
fine_categories(id, name, coarse_category_id, sort_order, is_active)
```

账目分类字段调整为：

```text
category_id       支出必填，收入可空
subcategory_id    可空，且必须属于 category_id
```

粗类使用固定数字 ID 和种子数据，不提供管理接口。细类允许新增、改名、排序和停用，不物理删除已存在记录。历史空分类继续显示为“未分类”。生产当前无数据，迁移可直接替换旧文本分类字段；若未来已有历史数据，应先执行显式转换而不是静默猜测。

## API 契约

### 账目

```text
GET    /entries
POST   /entries
POST   /entries/batch
GET    /entries/:id
DELETE /entries/:id        # 语义为冲正
```

列表支持现有日期、排序、游标参数，并增加 `type`、`categoryId`、`subcategoryId`。新增接口只接受 `income` 和 `expense`；`expense` 必须有粗类，细类可为空。列表默认包含原账目和冲正记录，冲正记录不可再次冲正。

### 分类

```text
GET   /categories
POST  /categories/fine
PATCH /categories/fine/:id
POST  /categories/fine/:id/disable
```

粗类只读返回；细类返回启用状态、所属粗类和排序值。停用细类不能用于新支出，但历史账目仍显示。

### 设置

```text
GET /settings/ledger
PUT /settings/ledger
```

设置包含发薪日，范围 1–28，默认 20；时区继续读取既有 `LEDGER_TIMEZONE`，不在页面修改。

### 分析

```text
GET /analytics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&level=coarse|fine
```

响应至少包含：

```text
periodIncome       所选期间收入
periodExpense      所选期间普通支出
periodNet          周期净额
currentBalance     全部有效账目的当前余额
items              [{ id, name, parentId?, parentName?, amount, displayAmount, count }]
```

分析只统计 `income`、`expense`，并排除冲正原账目和冲正记录。柱状图只聚合支出：默认按粗类，开关切换到细类。空分类进入“未分类”。金额字段使用十进制字符串，`displayAmount` 仅用于展示。

## 前端路由与交互

```text
/login          单密码登录
/analytics      登录后的默认首页
/entries        游标列表，默认显示全部记录
/entries/new    新增记账
/entries/:id    详情与冲正
/settings       发薪日、细类管理、退出会话
```

分析页提供当前周期、上一周期、下一周期和自定义日期范围；默认周期由发薪日计算。页面摘要同时显示周期净额和当前余额。粗类柱状图和饼图的悬停/键盘聚焦状态展示对应粗类下的细类金额与笔数；细类视图仍可切换查看平铺结果。列表不提供编辑、物理删除或付款操作；冲正需要二次确认。

新增记账页面支持按需添加或删除收入/普通支出行，一次提交多笔账目；每行独立校验类型、金额、时间和分类，批量请求使用一个幂等键并在服务端事务中整体成功或失败。保存成功后清空编辑区，用户可继续添加下一批或进入账目列表。

前端视觉基调为冷白和蓝灰中性色，收入绿与支出红仅用于金额和状态表达，避免以偏黄背景和高饱和状态色作为页面主色。

## 实施顺序

1. 新增 D1 migration、分类种子和设置/会话表。
2. 增加认证中间件、登录/会话/登出接口、同源写请求校验。
3. 调整账目 schema 和列表/新增接口，补齐分类归属校验。
4. 增加分类、设置、分析 API 与 OpenAPI schema。
5. 初始化 React/Vite 前端、路由、API client 和登录保护。
6. 实现分析、列表、新增、详情/冲正、设置页面。
7. 增加 Worker、API、D1 migration 和前端流程测试。
8. 配置静态资源构建、SPA fallback，运行 `pnpm run check` 和部署 dry-run。

## 首版测试重点

- 会话滑动续期、过期和登出。
- Turnstile token 缺失/失败与登录限速。
- 写请求跨来源被拒绝。
- 支出缺少粗类、细类不属于粗类、停用细类不能新用。
- 周期边界和自定义结束日包含语义。
- 当前余额不受分析日期筛选影响。
- 冲正记录与原账目出现在列表，但都不进入分析。
- 粗类/细类柱状图金额和笔数均使用十进制字符串。
