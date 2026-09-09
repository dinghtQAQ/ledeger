# iOS 快捷指令记账实现规格

状态：ready-for-agent  
记录日期：2026-09-08  
GitHub Issue：[Issue #15](https://github.com/dinghtQAQ/ledeger/issues/15)  
关联需求记录：[iOS 快捷指令记账需求草案](./ios-shortcut-entry-requirement.md)

## Problem Statement

现有总账已经具备完整的网页前端和后端 API，但在 iPhone 上记录一笔收入或普通支出仍需要打开网页并完成较长流程。用户希望通过 iOS 快捷指令快速完成单笔记账，同时保持现有总账的金额精度、分类约束、幂等写入和不可直接编辑的账本规则。

现有网页业务接口的写请求要求同源 `Origin`/`Referer`。iOS 快捷指令不是浏览器上下文，不能可靠地复用该来源校验；将现有主 API key 直接放入快捷指令也会扩大泄露后的权限影响。因此需要一个专门的、最小权限的快捷指令 API 边界。

## Solution

增加 `/shortcut` 专用 API 命名空间和一个专用 Cloudflare Secret 令牌。快捷指令只调用两个接口：读取记账选择所需的分类，以及创建一笔收入或普通支出。获准接口的字段、业务校验、幂等行为、状态码、响应结构和错误结构与对应普通接口保持一致；专用命名空间只改变访问边界和令牌校验，不复制另一套记账规则。

快捷指令一次运行只记录一笔账。用户选择类型、输入金额，支出选择固定粗分类并尝试读取细分类，随后查看摘要并确认。网络失败或超时自动重试一次，重试复用同一个幂等键；细分类读取失败时仍提交，但不传细分类。API 地址和专用令牌集中配置在快捷指令开头，Mac 用于编辑和调试，iPhone 直接访问公网 HTTPS 生产地址。

## User Stories

1. As the ledger owner, I want to start a shortcut on iPhone, so that I can record a ledger entry without opening the full web app.
2. As the ledger owner, I want to choose income or ordinary expense, so that the entry direction is explicit.
3. As the ledger owner, I want the shortcut to accept a positive decimal amount, so that the request follows the ledger amount contract.
4. As the ledger owner, I want the shortcut to reject empty or malformed amounts before submission, so that invalid data is not sent to the API.
5. As the ledger owner, I want the shortcut to use the current device time by default, so that normal entries need no extra time input.
6. As the ledger owner, I want the shortcut to send a timezone-aware occurrence time, so that travel and UTC persistence do not create ambiguous timestamps.
7. As the ledger owner, I want income entry to skip category selection, so that income recording stays short.
8. As the ledger owner, I want expense entry to require a coarse category, so that spending remains compatible with analysis rules.
9. As the ledger owner, I want coarse categories to be available immediately from a maintained fixed list, so that a temporary fine-category API failure does not block expense recording.
10. As the ledger owner, I want enabled fine categories for the selected coarse category to be loaded from the API, so that renamed or disabled classifications do not become stale in the shortcut.
11. As the ledger owner, I want to choose “no fine category”, so that an expense can be recorded at coarse-category level only.
12. As the ledger owner, I want a fine-category request failure to degrade to no fine category, so that a short-lived classification service problem does not block a valid expense.
13. As the ledger owner, I want to enter an optional note, so that I can preserve useful context without making notes mandatory.
14. As the ledger owner, I want to review a summary before submission, so that I can catch an incorrect type, amount, category, note, or time.
15. As the ledger owner, I want review confirmation to be only an error-checking step, so that it is not mistaken for server authentication.
16. As the system, I want shortcut requests to use a dedicated token, so that the main API key is not required on the phone.
17. As the system, I want every `/shortcut` endpoint to require the same dedicated token, so that the namespace has one clear authentication boundary.
18. As the system, I want the shortcut token to be stored as a Cloudflare Secret, so that it is managed outside source code and can be rotated.
19. As the operator, I want replacing the Cloudflare Secret to invalidate the old shortcut token, so that rotation does not require database token management.
20. As the system, I want shortcut entry creation to avoid browser-origin checks, so that a non-browser shortcut can call it without spoofing `Origin` or `Referer`.
21. As the system, I want all other ordinary business routes to retain their existing authentication and same-origin rules, so that the shortcut exception remains narrow.
22. As the system, I want shortcut creation to accept only income and ordinary expense, so that due expenses cannot be created through the shortcut.
23. As the system, I want shortcut creation to preserve existing category-parent and active-fine-category validation, so that the shortcut cannot bypass ledger invariants.
24. As the system, I want shortcut creation to require an idempotency key, so that accidental retries do not create duplicate entries.
25. As the ledger owner, I want a network timeout or transient failure to retry once automatically, so that a temporary connection problem does not force manual re-entry.
26. As the system, I want an automatic retry to reuse the original request body and idempotency key, so that retrying cannot create a second entry or mismatch the original intent.
27. As the system, I want authentication, parameter, and business-validation errors not to retry automatically, so that deterministic failures end promptly.
28. As the ledger owner, I want the shortcut to end after one successful entry, so that every run has one clear confirmation and idempotency lifecycle.
29. As the ledger owner, I want a success message to show type, amount, category, occurrence time, and entry ID, so that I can verify what the server accepted.
30. As the ledger owner, I want to copy the entry ID from the success result, so that I can locate the record in the web app if needed.
31. As the ledger owner, I want missing shortcut configuration to be detected before any business request, so that setup errors are understandable.
32. As the ledger owner, I want the API base URL and token to be configured in one place in the shortcut, so that changing environments or rotating a token does not require editing many actions.
33. As the developer, I want to validate the API flow on Mac before testing on iPhone, so that request and response problems are easier to diagnose.
34. As the developer, I want the shortcut to work against a public HTTPS production endpoint, so that it remains usable away from the home network.

## Implementation Decisions

- Add a dedicated `/shortcut` namespace rather than weakening the ordinary browser-oriented route boundary.
- Expose only `GET /shortcut/categories` and `POST /shortcut/entries` in the first release.
- Require `Authorization: Bearer <SHORTCUT_WRITE_TOKEN>` on every `/shortcut` endpoint, including category reads.
- Store one `SHORTCUT_WRITE_TOKEN` value as a Cloudflare Worker Secret. Do not add D1 token records, token names, multi-device token lists, or a web token-management page in the first release.
- Rotate the token by replacing the Cloudflare Secret; the old value becomes invalid, and the new value is entered in the shortcut’s single configuration action.
- Do not require browser `Origin`/`Referer` validation for the dedicated shortcut routes. Keep the existing same-origin enforcement on ordinary business mutations.
- Keep the ordinary API key separate from the shortcut token. The shortcut must not contain the web login password or Turnstile secret.
- Make the shortcut category endpoint return the data needed to build the selection menu: fixed coarse categories and active fine categories. The shortcut only displays fine categories belonging to the selected coarse category and always offers no fine category.
- Keep the coarse-category list as a small, easy-to-maintain shortcut configuration matching the current fixed dictionary. If the server dictionary changes later, update this shortcut configuration explicitly.
- Make shortcut entry creation accept the existing entry fields: `type`, `amount`, `occurredAt`, optional `categoryId`, optional `subcategoryId`, optional `note`. Do not expose `dueAt`.
- Preserve the existing amount contract: positive decimal string, maximum four business decimal places, no floating-point business calculation in the shortcut.
- Preserve the existing entry validation: expense requires a coarse category; fine category is optional, must belong to the selected coarse category, and must be active for new writes; income may omit categories.
- Preserve the existing idempotent create semantics and response shape. A successful or idempotently repeated response returns an entry payload; conflicting reuse of a key returns the existing conflict behavior.
- Generate the idempotency key only after user confirmation and before the first create request. Store it for the lifetime of that run and reuse it for one automatic network retry.
- Retry only network failures and request timeouts, at most once. Do not retry authentication failures, malformed requests, category validation failures, or other deterministic API errors.
- Freeze the confirmed request body for the retry. Do not ask for a second confirmation or allow the retry to use changed values with the old idempotency key.
- Use the device’s current time as the default `occurredAt`, encoded with an explicit timezone offset. Do not add custom historical time selection in the first release.
- Run configuration validation before category or entry requests. Missing base URL or token must produce a setup message and stop.
- Use JSON request and response headers consistently: `Content-Type: application/json` and `Accept: application/json`.
- Map server errors to short user-facing messages by class: invalid token, missing/invalid expense category, inactive or mismatched fine category, idempotency conflict, network failure, and unexpected server failure.
- Keep the shortcut flow to one entry per run. Do not add a loop for consecutive entries in the first release.
- Use the Mac for API probing and shortcut authoring/debugging; runtime access from iPhone uses the public HTTPS deployment and does not depend on the Mac being online.

## Testing Decisions

- Test externally observable HTTP behavior at the Worker request boundary. Prefer this single high-level seam over testing internal route helpers or SQL details.
- Verify that `/shortcut/categories` accepts the dedicated token, rejects missing or invalid tokens, and returns only the intended selection data.
- Verify that every allowed `/shortcut` endpoint uses the same dedicated token and that ordinary non-shortcut business routes retain their existing authentication and source checks.
- Verify that `/shortcut/entries` accepts income without categories and expense with a valid coarse category, while rejecting missing coarse category, mismatched fine category, inactive fine category, malformed amount, unsupported type, and `dueAt`.
- Verify that shortcut entry responses and errors match the corresponding ordinary entry contract.
- Verify idempotent creation, repeated identical submission, and conflicting reuse of the same idempotency key.
- Verify that shortcut routes do not require browser `Origin`/`Referer`, while ordinary mutating routes still enforce their existing source policy.
- Verify token rotation behavior at the configuration boundary: replacing the configured Secret invalidates the previous token and accepts the new one.
- Verify date-time input with an explicit offset and preservation of the existing UTC/timezone semantics.
- On Mac, run request-level checks against the production HTTPS endpoint or local development endpoint before assembling the iOS shortcut.
- On iPhone, perform acceptance flows for income, expense with coarse-only category, expense with fine category, fine-category API failure fallback, confirmation cancellation, automatic one-time network retry, idempotent retry after an ambiguous response, invalid token, and successful result display.
- Do not assert shortcut action ordering or internal implementation details when an externally visible request/response assertion is sufficient.

## Out of Scope

- Reusing the web login Cookie session from the shortcut.
- Storing the web login password, Turnstile secret, or main API key in the shortcut.
- A general-purpose API gateway or Mac-hosted runtime relay.
- D1-backed multi-token management, token naming, per-device tokens, audit UI, or in-app token rotation.
- Shortcut access to entry listing, entry details, reversal, due-expense payment, analytics, settings, or fine-category administration.
- Creating due expenses, editing entries, physical deletion, or reversal from the shortcut.
- Custom historical occurrence times, recurring schedules, batch entry loops, or consecutive multi-entry sessions.
- Siri natural-language parsing or dedicated voice recognition.
- Offline queueing or delayed background submission after the shortcut ends.
- Export, backup, restore, external account mapping, notifications, or bank integrations.

## Further Notes

- The dedicated shortcut token is a narrower authorization boundary, not a replacement for device security. The confirmation step exists only to let the owner inspect the pending entry.
- A dedicated endpoint is necessary because the current ordinary write policy requires browser-origin evidence that an iOS shortcut does not reliably provide.
- The shortcut’s fixed coarse categories are intentionally a small maintenance surface. Fine categories remain server-driven so active/disabled state and parent relationships stay current.
- If future requirements add another shortcut action, add and authorize a specific `/shortcut/...` route rather than mapping the entire ordinary API namespace.
- The implementation should consider an ADR only if the dedicated-token and non-browser route exception becomes a long-lived architectural trade-off requiring rationale beyond this feature specification.
