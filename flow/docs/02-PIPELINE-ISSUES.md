# Pipeline Audit: Issues & Tightening

## Critical Issues (Fixed)

### 1. Display Name Bug (FIXED)
**Where**: `data.js` `categorize()` + `modals.js` uncategorized modal
**Was**: `categorize()` used `raw` (full SMS text) as display name for all non-merchantMap-matched transactions. Even when the DB had a clean `counterparty` and valid `category`/`subcategory`, the UI showed the entire SMS message.
**Fix**: `categorize()` now accepts `counterparty` parameter. Uses `cleanName = counterparty || raw` for display. The closure in main.js forwards it: `(raw, aiType, counterparty, dbCategory) => categorize(raw, aiType, STATE, MERCHANT_TYPES, counterparty, dbCategory)`.

### 2. JWT Auth Pattern (FIXED)
**Where**: All 10 edge functions
**Was**: 5 edge functions had `verify_jwt: true` + `getUser()` without explicit JWT
**Fix**: All 10 functions now use `verify_jwt: false` + explicit `getUser(jwt)` pattern.

### 3. Auth Pattern Inconsistency (FIXED)
**Where**: `flow-remember` (v6), `flow-recipients` (v6), `flow-keys` (v6)
**Was**: Used `getUser()` without explicit JWT extraction.
**Fix**: All three upgraded to explicit `getUser(jwt)` pattern.

### 4. Categorization Priority (FIXED)
**Where**: `data.js` `categorize()`
**Was**: localMappings > MERCHANT_TYPES lookup > merchantMap > fallback (merchantMap could override AI)
**Fix**: localMappings > DB category (trusted, if present) > merchantMap > fallback

### 5. RawLedger Array-of-Arrays Format (FIXED)
**Where**: `flow-data` (v12)
**Was**: RawLedger returned as `[header, ...rows]` array-of-arrays
**Fix**: Now returns JSON objects. `processTxns()` simplified to direct field access.

### 6. Legacy ai.js Module (FIXED)
**Where**: `flow/src/modules/ai.js`
**Was**: 449-line module bundled as dead code
**Fix**: Removed from bundle. `flow-ai` edge function kept as API fallback for refreshInsights.

### 7. Database Views (FIXED)
**Was**: Views existed but unused; all had SECURITY DEFINER (bypassing RLS)
**Fix**:
- `hourly_spend` now used by flow-data for heatmap pre-aggregation
- `weekly_category_spend` used by flow-chat query_trends tool
- All 6 views recreated with `security_invoker = true` (RLS enforced)

### 8. Chat System Prompt Rebuilds on Every Message (FIXED)
**Where**: `flow-chat` (v5)
**Was**: 8 DB queries per message
**Fix**: 5-minute TTL in-memory cache per user. ~8 queries per 5 minutes.

### 9. Incremental Sync Timestamp (FIXED)
**Where**: `flow-data` (v12)
**Was**: `.gt('txn_timestamp', lastSync)` missed historical imports
**Fix**: `.gt('created_at', lastSync)` catches all newly inserted rows.

### 10. main.js Size (PARTIALLY FIXED)
**Where**: `flow/src/main.js`
**Was**: 1,049 lines
**Fix**: Extracted `constants.js` (~100 lines). main.js now ~949 lines. Further splitting (auth.js, window-exports.js) deferred as low priority.

### 11. doSync Undefined Reference (FIXED)
**Where**: `main.js` line 801
**Was**: `onDataChanged: () => doSync()` -- `doSync` never defined, causing runtime error when chat tools modified data
**Fix**: Changed to `window.syncData()`

### 12. Function Search Path (FIXED)
**Where**: `detect_recurring_transactions`, `generate_proactive_insights`
**Was**: No explicit `search_path` set (vulnerable to search path manipulation)
**Fix**: `ALTER FUNCTION ... SET search_path = public`

### 13. Insights Refresh Crash (FIXED)
**Where**: `insights.js` `refreshInsights()`
**Was**: No `response.ok` check; no null guard on `data.answer` before `.split('\n')`
**Fix**: Added `response.ok` check + null guard with user-friendly error

### 14. Category Changes Not Updating Insights (FIXED)
**Where**: `modals.js` `saveCategorization()`
**Was**: `detectPatterns()` not called after recategorizing; insights stayed stale
**Fix**: Added `detectPatterns` callback, called before `filterAndRender()`

### 15. Counterparty Normalization (FIXED)
**Where**: `data.js` `processTxns()`
**Was**: Raw counterparty names (ANTHROPIC, Woqod Al Wakra)
**Fix**: `normalizeCounterparty()` — title-cases ALL-CAPS, consolidates brand variants

### 16. Dark Mode in Charts (FIXED)
**Where**: `charts.js`, `visualizations.js`
**Was**: Wrong dark mode check (documentElement class or only media query)
**Fix**: Now checks `body.dark-mode` class OR prefers-color-scheme

### 17. Chat Input Layout (FIXED)
**Where**: `style.css` `.chat-input-area`
**Was**: Missing `flex-direction: column`
**Fix**: Added, input area now stacks correctly

## Production Hardening (Fixed)

### 18. Rate Limiting (FIXED)
**Where**: `_shared/rate-limit.ts`, `rate_limits` + `rate_limit_config` tables
**Was**: No rate limiting on any edge function
**Fix**: DB-backed rate limiting with configurable limits per function. Deployed on flow-data (v19) and flow-chat (v7). Fail-open pattern. Client shows friendly 429 message.

### 19. Fetch Timeouts & Retries (FIXED)
**Where**: `utils.js`, `data.js`, `chat.js`
**Was**: Raw `fetch()` with no timeouts, no retries, silent error swallowing
**Fix**: `fetchWithTimeout()` with AbortController timeout, auto-retry on 5xx/network. data.js: 45s/1 retry. chat.js: 90s/no retry. First-load failure shows app shell instead of stuck loading.

### 20. Global Error Handling (FIXED)
**Where**: `utils.js`, `main.js`
**Was**: No global error handler; unhandled promise rejections silently lost
**Fix**: `initGlobalErrorHandler()` catches unhandled rejections + window errors. `friendlyError()` translates technical errors to plain language.

### 21. Data Export (FIXED)
**Where**: `features.js`, `flow.html`
**Was**: Only CSV export available
**Fix**: XLSX (zero-dependency Office Open XML), PDF (browser print-to-PDF), CSV. Three buttons in Settings > Data tab.

### 22. Service Worker Silent Failures (FIXED)
**Where**: `utils.js` `initServiceWorker()`
**Was**: `.catch(() => {})` silently swallowed all errors; no update notification
**Fix**: Logs errors, detects updates, shows user notification toast for new versions.

## Remaining Issues (Low Priority)

### Leaked Password Protection
**Severity**: Low (project setting)
**Where**: Supabase Auth settings
**Issue**: HaveIBeenPwned password checking is disabled
**Fix**: Enable in Supabase dashboard Auth settings

### Mixed Return Formats
**Severity**: Low (tech debt)
**Where**: `flow-data` response
**Issue**: `RawLedger` returns JSON objects; `MerchantMap`, `FXRates`, `UserContext`, `Recipients` still return array-of-arrays with header row
**Impact**: Frontend has separate parsing logic for each format

### Rate Limiting Not Yet Wired on 8 Edge Functions
**Severity**: Low (config exists, just needs wiring)
**Where**: flow-sms, flow-backfill, flow-learn, flow-ai, flow-profile, flow-remember, flow-recipients, flow-keys
**Issue**: `rate_limit_config` rows exist for all 10 functions, but only flow-data and flow-chat have the `checkRateLimit()` call wired
**Fix**: Add rate-limit import + check to remaining 8 functions as needed

## Categorization Priority (Current)
```
1. localMappings[raw.toLowerCase()]     -- localStorage user overrides
2. DB category (if present) + counterparty as display  -- trust server-side AI
3. merchantMap pattern match on raw     -- fallback for uncategorized
4. Fallback: counterparty or raw        -- truly unknown
```
