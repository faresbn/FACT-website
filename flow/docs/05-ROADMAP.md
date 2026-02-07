# Implementation Roadmap

Work is organized into parallel phases. Each phase is independent and can be done in a separate conversation thread.

---

## Phase A: Pipeline Tightening (Backend) -- COMPLETE

**Goal**: Make the data pipeline reliable, consistent, and efficient.

### A1. Fix Auth Pattern in 3 Edge Functions -- DONE
- `flow-remember` (v6), `flow-recipients` (v6), `flow-keys` (v6): Explicit JWT extraction added
- Pattern: `const jwt = authHeader.replace('Bearer ', ''); getUser(jwt)`

### A2. Fix Categorization Priority -- DONE
- `data.js` `categorize()`: Priority is now localMappings > DB category (trusted) > merchantMap > fallback
- The `dbCategory` parameter is forwarded through the categorize closure

### A3. Fix Incremental Sync Timestamp -- DONE
- `flow-data` (v12): Uses `.gt('created_at', lastSync)` for incremental sync
- Historical imports are now picked up correctly

### A4. Migrate RawLedger to JSON Format -- DONE
- `flow-data` (v12): Returns RawLedger as JSON objects
- `data.js` `processTxns()`: Simplified to direct field access (no schema detection)

---

## Phase B: Frontend Cleanup -- COMPLETE (all 4 items)

**Goal**: Reduce bundle size, improve maintainability, eliminate dead code.

### B1. Remove Legacy ai.js Module -- DONE
- Removed ai.js import and all `window.*` exports for legacy chat
- Saved ~449 lines of dead code from bundle
- `flow-ai` edge function kept as API-only fallback for refreshInsights

### B2. Extract constants.js from main.js -- DONE
- Extracted `MERCHANT_TYPES`, `SUMMARY_GROUPS`, `CAT_COLORS`, `PATTERNS`, `TIME_CONTEXTS`, `SIZE_TIERS` to `modules/constants.js`
- Also extracted helper functions: `getSummaryGroup`, `getTimeContext`, `getSizeTier`, `getTypeColor`, `getGroupColor`
- main.js reduced from 1049 to ~949 lines (thin orchestrator)

### B3. Use Database Views for Heatmap -- DONE
- `renderTimeHeatmap()` now uses pre-aggregated `STATE.hourlySpend` from `hourly_spend` view
- Falls back to client-side computation when server data unavailable
- `flow-data` (v12) returns `HourlySpend` sheet from `hourly_spend` view

### B4. Clean Up Modals -- DONE
- `modals.js`: Counterparty subtitle in uncategorized modal (when different from display)
- `modals.js`: Pre-fill category dropdown + display name in categorization modal
- `modals.js`: Counterparty included in all-transactions search filter

---

## Phase C: Chat & AI Intelligence -- COMPLETE

**Goal**: Make the AI chatbot smarter and more responsive.

### C1. Cache Chat System Prompt -- DONE
- `flow-chat` (v5): 5-minute TTL cache per user using in-memory Map
- Cache invalidated when `force_refresh` flag is passed or cache exceeds 100 entries
- Reduced DB queries from 8 per message to 8 per 5 minutes

### C2. Chat Tool Use -- DONE
- `flow-chat` (v5): 4 tools added with non-streaming tool use loop (up to 5 iterations)
  - `query_transactions(filters)` -- search by date, merchant, amount, category
  - `query_trends(period, category)` -- get spending trends from pre-aggregated views
  - `set_goal(category, amount)` -- create/update budget goal from chat
  - `remember(type, key, value)` -- save user context from natural language
- Final response sent as single SSE chunk after all tool resolution

### C3. Proactive Insights -- DONE
- `generate_proactive_insights(p_user_id)` Postgres function (SECURITY DEFINER)
- Detects: budget warnings (goals >80%), spending spikes (pace >125% of last month), new merchants (first-time this week), large purchases (>2.5x category average)
- Surfaced in UI via `renderProactiveInsights()` with severity-based styling
- `flow-data` (v12) returns `Proactive` sheet from the RPC

### C4. Chat Actions -- DONE
- Chat tool use (C2) covers `set_goal` and `remember` actions
- `flow-chat` (v5): SSE `done` event includes `tools_used` flag
- Frontend `chat.js`: `onDataChanged` callback triggers re-sync when tools modify data

---

## Phase D: iOS Shortcut Integration -- PARTIAL

**Goal**: Replace GAS with native iOS Shortcut for SMS capture.

### D1. Shortcut Template -- DONE
- Created `flow/docs/06-IOS-SHORTCUT.md` with complete setup guide
- Documents: API endpoint, single/batch SMS format, automation trigger, troubleshooting

### D2. Batch Mode
- Status: flow-sms already supports `entries[]` array (documented in D1)
- Shortcut offline queueing/retry: Not implemented (iOS Shortcuts limitation)

### D3. Key Management UI -- DONE
- `flow-keys` (v7): Added `list` action returning key metadata (prefix, label, created, last used, revoked)
- `settings.js`: `listKeys()`, `renderKeyList()` — dynamic key cards with status, per-key revoke
- `flow.html`: Key list section with label input + New Key button in General settings tab
- `main.js`: `refreshKeyList()`, `revokeKeyById()` wrappers + window exports

---

## Phase E: Data Quality & Polish -- MOSTLY COMPLETE

### E1. Merchant Name Normalization -- DONE
- `flow-sms` (v10): Added normalization in AI prompt and post-processing
- Strips POS prefixes, terminal IDs, standardizes casing
- Results stored in `counterparty` field

### E2. Currency Handling -- DONE
- DB: Added `amount_qar_approx` column to `raw_ledger`
- `flow-data` (v13): Auto-fetches FX rates from `open.er-api.com` when >24h stale, upserts for 12 common currencies
- `flow-sms` (v11): AI prompt extracts `amount_qar_approx` from SMS (QAR equivalent amounts), included in insert
- `data.js`: `processTxns()` prefers bank-reported approx QAR over FX rate conversion
- Settings UI: Editable FX rates in General tab with refresh + save overrides

### E3. Recurring Transaction Detection -- DONE
- `detect_recurring_transactions(p_user_id)` Postgres function (SECURITY DEFINER)
- Analyzes merchant patterns over 6 months using window functions
- Filters: 7-95 day intervals, 3+ transactions, coefficient of variation <15% (amounts), <30% (intervals)
- Surfaced in UI via `renderRecurringSummary()` with monthly cost totals
- `flow-data` (v12) returns `Recurring` sheet from the RPC

### E4. Receipt/Invoice Capture
- Status: Not started (future)

---

## Security Fixes (Review Pass)

### Fix SECURITY DEFINER Views -- DONE
- All 6 public views recreated with `security_invoker = true`
- Views: `daily_spend`, `hourly_spend`, `weekly_category_spend`, `monthly_category_spend`, `merchant_analytics`, `period_summary`
- RLS policies now enforced for querying users

### Fix Function Search Path -- DONE
- `detect_recurring_transactions` and `generate_proactive_insights`: `search_path` set to `public`

### Fix doSync Reference -- DONE
- `main.js`: Changed `doSync()` (undefined) to `window.syncData()` in chat callback

---

## Priority Matrix (Updated)

| Phase | Impact | Effort | Priority | Status |
|-------|--------|--------|----------|--------|
| A1 (Auth fix) | High | Low | P0 | DONE |
| A2 (Category priority) | High | Low | P0 | DONE |
| A3 (Sync timestamp) | Medium | Low | P1 | DONE |
| A4 (JSON format) | Medium | Medium | P2 | DONE |
| B1 (Remove ai.js) | Low | Low | P1 | DONE |
| B2 (Extract constants.js) | Medium | Medium | P2 | DONE |
| B3 (Use DB views) | Low | Medium | P3 | DONE |
| C1 (Cache system prompt) | Medium | Medium | P1 | DONE |
| C2 (Chat tools) | High | High | P2 | DONE |
| C3 (Proactive insights) | High | High | P3 | DONE |
| C4 (Chat actions) | Medium | High | P3 | DONE |
| D1 (iOS Shortcut) | High | Medium | P2 | DONE |
| E1 (Merchant names) | Medium | Medium | P2 | DONE |
| E3 (Recurring detection) | Medium | Medium | P3 | DONE |
| B4 (Clean up modals) | Low | Low | P4 | DONE |
| D2 (Batch mode) | Low | Low | P4 | Documented |
| D3 (Key management UI) | Low | Medium | P4 | DONE |
| E2 (Currency handling) | Low | Medium | P4 | DONE |
| E4 (Receipt capture) | Medium | High | P5 | Not started |
