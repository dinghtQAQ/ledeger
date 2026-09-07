# 第二阶段前端与分析规格

## Problem Statement

当前系统已经具备生产可用的账目 API，但缺少面向日常使用的前端。用户需要通过 API 客户端手工完成记账、查询和冲正，无法快速查看当前工资周期的收支结构，也无法按分类理解支出构成。

第二阶段需要在不改变单用户总账边界的前提下，提供一个可直接使用的同源 Web 应用：用户登录后能够查看分析摘要、登记收入或普通支出、浏览全部账目、查看详情、执行冲正，并维护细类和工资周期设置。

## Solution

构建 React、Vite、TypeScript 单页应用，由现有 Cloudflare Worker 同时托管静态资源和业务 API。前端与 API 使用同源 Cookie 会话，不向浏览器暴露生产 API key。

登录采用单账户密码模型。密码保存在 Worker Secret；每次登录都要求 Cloudflare Turnstile。登录成功后建立 7 天有效、访问时滑动续期的会话；会话存储在 D1，浏览器只保存安全 Cookie。

第二阶段只新增和分析 `income` 与 `expense`。旧版到期支出字段和接口可继续存在以保持兼容，但不提供新增入口、不提供付款操作，也不纳入分析。

分析页是登录后的默认首页，默认展示当前工资周期。工资周期使用已有时区配置，发薪日默认为每月 20 日，可设置为每月 1 至 28 日。分析支持当前周期、上一周期、下一周期和自定义日期范围；首版图表按分类汇总普通支出金额，可在粗类和细类之间切换。

## User Stories

### Authentication

1. As the single ledger owner, I want to log in with only a password, so that I do not need an account registration flow.
2. As the single ledger owner, I want every login to include Turnstile verification, so that automated password guessing is harder.
3. As the single ledger owner, I want the browser to receive an expiring secure session instead of an API key, so that the production secret is not embedded in frontend code.
4. As the single ledger owner, I want an active session to slide for seven days when I use the app, so that normal use does not require frequent logins.
5. As the single ledger owner, I want an expired session to return me to the login page, so that stale access is not retained indefinitely.
6. As the single ledger owner, I want to log out the current session, so that I can end access from the current browser.
7. As the system, I want login failures to be rate-limited, so that repeated password attempts cannot run without friction.
8. As the system, I want write requests to require a same-origin request source, so that a third-party site cannot silently submit ledger mutations.

### Analysis

9. As the ledger owner, I want to land on the analysis page after login, so that the most useful overview is immediately available.
10. As the ledger owner, I want to see the current wage cycle by default, so that the dashboard matches how I reason about income and spending.
11. As the ledger owner, I want to move to the previous or next wage cycle, so that I can compare adjacent periods.
12. As the ledger owner, I want to select a custom start and end date, so that I can inspect an arbitrary interval.
13. As the ledger owner, I want the displayed date range to include both selected dates, so that date selection matches normal user expectations.
14. As the ledger owner, I want to see income for the selected period, so that I know how much entered the ledger during that interval.
15. As the ledger owner, I want to see ordinary spending for the selected period, so that I know the period's recorded cost.
16. As the ledger owner, I want to see the period net amount, so that I can understand the selected period without confusing it with the whole-ledger balance.
17. As the ledger owner, I want to see the current balance across all valid historical entries, so that the balance card is not accidentally limited by the chart's date filter.
18. As the ledger owner, I want a bar chart with coarse categories on the X axis and spending amounts on the Y axis, so that the main spending structure is easy to compare.
19. As the ledger owner, I want to switch the chart to fine categories, so that I can inspect more detailed spending when needed.
20. As the ledger owner, I want each chart item to include amount and count, so that I can compare both total cost and transaction frequency.
21. As the ledger owner, I want uncategorized spending to appear as “未分类”, so that missing or erroneous data remains visible rather than disappearing.
22. As the ledger owner, I want reversed entries excluded from analysis, so that a correction does not distort spending totals.
23. As the ledger owner, I want the chart to show zero-value categories consistently when appropriate, so that the seven fixed coarse categories remain comparable across periods.
24. As the system, I want analysis amounts to remain decimal strings until presentation, so that four-decimal accounting precision is not lost to floating-point arithmetic.

### Entry List and Details

25. As the ledger owner, I want the entries list to be the complete ledger view, so that I can audit every recorded fact.
26. As the ledger owner, I want the list to show both original entries and reversal entries, so that corrections remain traceable.
27. As the ledger owner, I want reversal entries to have a clear visual label, so that they are not mistaken for ordinary income or spending.
28. As the ledger owner, I want an original entry marked as reversed and linked to its reversal, so that I can follow the correction relationship.
29. As the ledger owner, I want a reversal entry linked back to its original entry, so that I can inspect the source fact.
30. As the ledger owner, I want to filter entries by date range, type, coarse category, and fine category, so that the list remains useful as data grows.
31. As the ledger owner, I want to sort entries using the existing supported sort options, so that recent and high-value entries are easy to find.
32. As the ledger owner, I want to load more entries using cursor pagination, so that the list does not depend on unstable numbered pages.
33. As the ledger owner, I want to view an entry's full details, so that I can verify its amount, time, categories, note, and reversal state.
34. As the ledger owner, I want to reverse an eligible original entry after confirmation, so that mistakes can be corrected without editing history.
35. As the system, I want to prevent a reversal entry from being reversed again, so that reversal chains cannot become ambiguous.
36. As the system, I want to prevent an already reversed original from being reversed again, so that each entry has at most one reversal.
37. As the ledger owner, I do not want edit, physical delete, or payment controls in the second-phase UI, so that the interface matches the immutable ledger model.

### New Entry

38. As the ledger owner, I want to create an income entry, so that money entering the ledger is recorded.
39. As the ledger owner, I want to create an ordinary expense entry, so that current spending is recorded.
40. As the ledger owner, I want the form fields ordered as type, coarse category, optional fine category, amount, and note, so that the form follows the mental model of a ledger entry.
41. As the ledger owner, I want the occurred time to default to the current time, so that common entries require minimal input.
42. As the ledger owner, I want expense entries to require a coarse category, so that spending analysis remains meaningful.
43. As the ledger owner, I want a fine category to be optional, so that I can record an expense without inventing unnecessary detail.
44. As the ledger owner, I want income entries to allow empty category fields, so that income does not require an artificial spending classification.
45. As the system, I want a fine category to be rejected when it does not belong to the selected coarse category, so that category relationships remain valid.
46. As the system, I want a stopped fine category to be unavailable for new entries, so that deactivated classifications do not continue spreading.
47. As the ledger owner, I want a successful create to return me to a useful view with the new entry visible, so that I can verify the result immediately.
48. As the system, I want repeated create submissions to retain the existing idempotency behavior, so that accidental retries do not create duplicate entries.

### Categories and Settings

49. As the ledger owner, I want to view the fixed coarse categories, so that I understand the available spending vocabulary.
50. As the system, I want coarse categories to use stable numeric IDs and names, so that historical entries do not depend on display text.
51. As the ledger owner, I want to create a fine category under a coarse category, so that the classification can become more specific over time.
52. As the ledger owner, I want to rename a fine category, so that its wording can improve without rewriting historical entries.
53. As the ledger owner, I want to reorder fine categories, so that frequently used options appear in a convenient order.
54. As the ledger owner, I want to deactivate a fine category, so that it cannot be selected for new entries while historical entries remain readable.
55. As the system, I want fine categories to use stable numeric IDs and a coarse-category foreign key, so that hierarchy validation is explicit.
56. As the system, I want used fine categories to be non-deletable, so that historical entries never lose their classification reference.
57. As the ledger owner, I want to view the configured payday anchor, so that I know how the current analysis cycle is calculated.
58. As the ledger owner, I want to change the payday anchor from the first through the twenty-eighth day, so that the cycle matches my actual salary schedule.
59. As the ledger owner, I want the default payday anchor to be the twentieth day, so that the first setup matches the agreed cycle.
60. As the system, I want all cycle calculations to use the existing configured timezone, so that dates do not shift unexpectedly between the UI and database.

## Implementation Decisions

### Application Shape

- The frontend is a React/Vite/TypeScript SPA.
- The SPA and Worker API are deployed as one same-origin application.
- The authenticated default route is `/analytics`.
- The main routes are `/login`, `/analytics`, `/entries`, `/entries/new`, `/entries/:id`, and `/settings`.
- The frontend API client sends credentials with same-origin requests and centralizes handling of `401`/`403` session failures.

### Authentication and Session

- There is exactly one logical account and no registration, account selector, or user table.
- Login accepts a password and a Turnstile token. The login form contains only a password input plus the Turnstile widget.
- The password is stored as a Worker Secret; the database stores only session records.
- A successful login creates a random session token, stores a hash of that token with creation and expiry timestamps, and sets a Secure, HttpOnly, SameSite=Lax cookie.
- Session lifetime is seven days with sliding renewal on authenticated use.
- `GET /auth/session` reports authentication state and expiry; `POST /auth/logout` revokes the current session.
- Every login requires Turnstile server-side verification. Repeated failures are rate-limited and return a generic authentication failure rather than revealing account details.
- Every authenticated business mutation requires a same-origin `Origin` or `Referer` in addition to authentication, regardless of whether the caller uses a Bearer key or a Cookie session. Requests missing both headers, or whose `Origin` (when present) or fallback `Referer` is cross-origin, are rejected; when both are present, `Origin` is authoritative.

### Ledger Scope

- New writes accept only `income` and `expense`.
- Existing due-expense columns and routes may remain for compatibility but are not exposed in the second-phase form, list actions, or analytics.
- The ledger remains immutable: correction is performed by reversal, not by edit or physical deletion.
- Reversal entries and their original reversed entries remain visible in the list but are excluded from all analysis totals and category aggregates.

### Categories

The storage model has two classification levels:

- Coarse category: numeric `id` and `name`; fixed system dictionary, no CRUD management UI.
- Fine category: numeric `id`, `name`, `coarse_category_id`, `sort_order`, and `is_active`; supports create, rename, reorder, and disable, but not physical deletion.

Initial coarse categories are 住房、餐饮、交通、公用、健康、娱乐、投资. The coarse category IDs are stable seed values.

Entries store `category_id` and nullable `subcategory_id`. An expense must have a coarse category. A fine category is optional and, when present, must belong to the selected coarse category and be active for new writes. Income may leave both fields empty. Historical missing classification is displayed as “未分类”.

### API Contract

Authentication:

- `POST /auth/login` accepts `{ password, turnstileToken }` and returns authentication state plus `expiresAt` on success.
- `GET /auth/session` returns `{ authenticated, expiresAt? }`.
- `POST /auth/logout` revokes the current session and returns no content.

Entries:

- Existing list, detail, create, and reversal operations remain the primary ledger boundary.
- Listing adds `type`, `categoryId`, and `subcategoryId` filters while preserving cursor pagination, date filters, and supported sorts.
- Create accepts only income and ordinary expense; expense classification and parent-child validation are enforced server-side.
- Reversal keeps the existing API meaning of the delete-shaped route but is presented in the UI as “冲正”.

Categories and settings:

- `GET /categories` returns coarse categories and fine categories, including fine-category active state and ordering.
- Fine categories support create, patch, and disable operations; coarse categories are read-only.
- `GET /settings/ledger` and `PUT /settings/ledger` expose the payday anchor. The accepted range is 1–28, with 20 as the default. Timezone remains server-configured.

Analytics:

- `GET /analytics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&level=coarse|fine` is the single summary endpoint for the first release.
- The service interprets `from` inclusively and `to` exclusively. The UI presents custom end dates as inclusive and converts them to the next local calendar day before requesting data.
- The response contains period income, period ordinary expense, period net amount, whole-ledger current balance, and category items containing amount, display amount, and count.
- Fine-level items include their parent coarse category ID and name.
- Aggregation excludes reversed originals and reversal entries, includes only income and ordinary expense, and groups missing classification under “未分类”.
- Amounts used for computation and returned by the API are decimal strings; display formatting is separate.
- The chart defaults to coarse level and switches to fine level without changing the selected date range.

### Wage Cycle

- The payday anchor is interpreted in the existing `LEDGER_TIMEZONE`.
- The cycle is a half-open interval: `[anchor date at local midnight, next anchor date at local midnight)`.
- With payday 20 and current date September 2, 2026, the current cycle is August 20, 2026 through September 19, 2026 inclusive.
- A custom date range is inclusive in the UI and half-open at the API boundary.
- Changing the payday anchor affects future cycle calculations and the default analysis view; it does not rewrite entry timestamps.

### Frontend Behaviour

- Login success navigates to `/analytics`.
- Unauthenticated access to protected routes navigates to `/login`.
- The analytics page shows period income, period ordinary expense, period net amount, and whole-ledger current balance.
- The analytics page provides previous-cycle, current-cycle, next-cycle, and custom-range controls.
- The expense chart provides a coarse/fine toggle and displays amount and count per item.
- The entries page shows all records, including reversal relationships, and uses “load more” for cursor pagination.
- The detail page provides read-only fields and a confirmation flow for eligible reversal operations.
- The new-entry page presents type, coarse category, optional fine category, amount, and note; occurred time defaults to now.
- The settings page provides payday configuration, fine-category management, and current-session logout. Coarse categories are read-only.

## Testing Decisions

Tests verify externally observable behaviour through the highest stable seams and do not assert internal implementation details such as SQL statement shape or component structure.

### Primary HTTP seam

Use the existing Worker HTTP test boundary to cover:

- Login success, invalid password, missing/invalid Turnstile token, rate limiting, session lookup, sliding renewal, expiry, and logout.
- Same-origin enforcement for mutating requests.
- Expense category required validation, fine-category parent validation, inactive fine-category rejection, and income category optionality.
- Coarse/fine category retrieval and fine-category create, rename, reorder, disable, and non-deletion behavior.
- Payday setting validation and wage-cycle boundary calculation in the configured timezone.
- Analysis totals, current balance independence from the selected date range, decimal-string amounts, coarse/fine aggregation, uncategorized grouping, and reversal exclusion.
- Entry list filters, cursor continuation, detail retrieval, and reversal eligibility.
- Idempotent creation and conflict behavior.

### Browser seam

Use browser-level tests for complete user flows:

- User logs in and lands on `/analytics`.
- User switches cycles and custom date ranges; the chart updates without changing settings.
- User toggles coarse and fine chart levels.
- User creates income and expense entries and sees the result in the list.
- User opens details and confirms a reversal; both records remain visible while analytics excludes them.
- User creates, renames, reorders, and disables a fine category.
- User changes the payday anchor and sees the default current cycle update.
- An expired session returns the user to `/login`.

Prior art is the existing Worker request test suite; browser tests should be added at the application boundary rather than testing individual UI components in isolation.

## Out of Scope

- Multi-user accounts, registration, account switching, password reset, and role permissions.
- Browser-held API keys or client-side exposure of the production API secret.
- Credit-card billing cycles, actual payment dates, overdue states, automatic payment, and due-expense analysis.
- New due-expense creation, payment controls, and due-expense frontend workflows.
- Monthly, quarterly, or annual dedicated analysis pages.
- Scheduled balance refresh, Cron-based analytics snapshots, and materialized summary tables in the first release.
- Export, backup, restore, external account mapping, bank integrations, and notifications.
- Coarse-category CRUD management.
- Physical deletion of entries or fine categories.
- Fine-category hierarchy deeper than one level.

## Further Notes

- The current balance is a derived value: all valid historical income minus all valid historical ordinary expense. It is not a mutable account balance and is not maintained by a scheduled task.
- The period net amount is a view-specific value: selected-period income minus selected-period ordinary expense.
- “未分类” is a display fallback for missing classification and remains visible in analysis; new expense writes cannot omit the coarse category.
- The specification is intentionally limited to the first frontend release. Performance snapshots can be introduced later if real query measurements justify them.
- The canonical tracker is GitHub Issues in `dinghtQAQ/ledeger`; this file remains the versioned source copy for the phase-2 specification and links from the phase tracker issue.
