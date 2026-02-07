# FACT/Flow Architecture

## System Overview

FACT/Flow is a personal finance intelligence system built for Qatar. SMS banking notifications are parsed by AI, stored in Supabase, and rendered in a Vite-built vanilla JS PWA with an AI chatbot.

```
[SMS Source] --> [flow-sms] --> [raw_ledger] --> [flow-data] --> [Frontend]
  (GAS/iOS)      (Haiku)       (Postgres)      (API layer)    (Vite PWA)
                                    |
                              [DB Views] --> [flow-chat] --> [Streaming AI]
                                    |          (Sonnet)
                              [flow-backfill] + [flow-learn]
                              (Categorization pipeline)
```

## Data Pipeline: SMS to Insight

### Stage 1: Ingest (flow-sms)

**Trigger**: GAS script or iOS Shortcut POSTs to `/flow-sms`
**Auth**: API key (SHA-256 hashed, stored in `user_keys`)
**AI Model**: Claude Haiku (retry with Sonnet on low confidence)

```
SMS text --> Claude Haiku --> Structured JSON --> raw_ledger INSERT
```

The AI extracts:
- `counterparty`: Clean merchant name (e.g., "Talabat QFC LLC")
- `amount`, `currency`, `direction` (IN/OUT)
- `category` (parent: Essentials/Lifestyle/Family/Financial/Other)
- `subcategory` (leaf: Groceries/Dining/Transport/etc.)
- `confidence`: high/medium/low
- `context`: JSON with reasoning

**Deduplication**: SHA-256 of `(sms_content + timestamp_minute)` stored as `idempotency_key`.

**Context injection**: The prompt receives:
- Time context (morning/evening, weekend, month timing)
- User's merchant_map patterns (up to 50)
- Family name patterns from profile
- Recent user corrections from user_context

### Stage 2: Storage (raw_ledger)

Core table. One row per transaction.

| Column | Purpose |
|--------|---------|
| `counterparty` | Clean merchant name (AI-parsed) |
| `raw_text` | Full SMS message (preserved for audit/re-parse) |
| `category` | Parent category (Essentials, Lifestyle, etc.) |
| `subcategory` | Leaf category (Groceries, Dining, etc.) |
| `confidence` | high/medium/low/matched/corrected |
| `context` | JSON: AI reasoning, time context |
| `idempotency_key` | SHA-256 dedup key |
| `ai_model` | Which model parsed it |
| `ai_mode` | sms/backfill/import |

### Stage 3: Categorization Pipeline

Three layers of categorization, each feeding the next:

```
[flow-sms]          -- AI parses on ingest (Haiku/Sonnet)
    |
[flow-data]         -- Auto-backfill if >10% uncategorized
    |                  (calls categorize_from_merchant_map RPC)
[flow-backfill]     -- Manual trigger: merchant_map match + AI batch
    |
[flow-learn]        -- User correction: updates merchant_map + raw_ledger
                       + logs to user_context for future SMS parsing
```

**The categorization flywheel:**
1. User corrects a transaction category in the UI
2. `flow-learn` saves the pattern to `merchant_map`
3. `flow-learn` updates ALL matching transactions in `raw_ledger`
4. `flow-learn` logs the correction to `user_context`
5. Next SMS: `flow-sms` includes the correction in its AI prompt
6. AI learns the user's preferences over time

### Stage 4: Data Delivery (flow-data)

**Auth**: JWT Bearer token (Supabase auth)
**Sync**: Incremental via `last_sync` timestamp in localStorage

Returns all data in a single POST response:
- `RawLedger`: Array of JSON objects (direct from DB), 13 columns including `amount_qar_approx`
- `MerchantMap`, `FXRates`, `UserContext`, `Recipients`: Array-of-arrays (header + rows)
- `Profile`, `Goals`, `Insights`, `Streaks`: JSON objects/arrays
- `Recurring`, `HourlySpend`, `Proactive`: Pre-computed analytics from DB functions/views
- `meta`: `{ is_incremental, backfill_applied, uncategorized_count, total_count, fx_refreshed }`

### Stage 5: Frontend Processing (data.js)

```
flow-data response --> processTxns() --> categorize() --> STATE.allTxns
                                             |
                                     [4-tier priority]
                                     1. localMappings (user overrides in localStorage)
                                     2. DB subcategory (AI-assigned, with mapping)
                                     3. merchantMap patterns (with mapping)
                                     4. Fallback: counterparty as 'Uncategorized'
```

**Key**: `categorize()` uses `counterparty` (clean name) for display, NOT `raw_text` (full SMS).

**Subcategory mapping**: DB subcategory values may differ from `MERCHANT_TYPES` keys. The `categorize()` function maps legacy values:
- `Bars & Hotels` -> `Bars & Nightlife`
- `Hobbies` -> `Entertainment`
- `Transfers` -> `Transfer`
- `Income` -> `Transfer`
- `Family Transfers` -> `Family`

Each transaction object gets computed dimensions:
- `display`: Clean name for UI
- `merchantType`: Subcategory for grouping
- `summaryGroup`: Parent category (Essentials/Lifestyle/etc.)
- `dims`: { what, when, size, pattern } for behavioral analysis
- `recipient`: Matched transfer recipient (phone/account/name)

### Stage 6: Frontend Rendering

```
STATE.allTxns --> filterAndRender() --> STATE.filtered
                      |
         [renders all UI components]
         - Budget projection
         - Donut chart
         - Category breakdown
         - Recent transactions
         - Smart metrics
         - Visualizations
         - Today section
         - Impulse warnings
```

## Database Schema

### Tables
| Table | Purpose | RLS |
|-------|---------|-----|
| `raw_ledger` | All transactions | Yes |
| `merchant_map` | Pattern -> category mappings | Yes |
| `fx_rates` | Currency conversion rates | Yes |
| `user_context` | Corrections, preferences, rules | Yes |
| `recipients` | Transfer recipient directory | Yes |
| `profiles` | User settings (salary, budget, family) | Yes |
| `goals` | Monthly spending limits by category | Yes |
| `streaks` | Budget streak tracking | Yes |
| `insights` | AI-generated period insights | Yes |
| `user_keys` | API keys for SMS ingest | Yes |
| `conversations` | Chat conversation metadata | Yes |
| `messages` | Chat message history | Yes |

### Views (all `security_invoker = true`)
| View | Used By |
|------|---------|
| `period_summary` | flow-chat (monthly overview) |
| `merchant_analytics` | flow-chat (top merchants) |
| `monthly_category_spend` | flow-chat (current month breakdown) |
| `weekly_category_spend` | flow-chat (weekly trends) |
| `daily_spend` | flow-chat (daily trends) |
| `hourly_spend` | flow-data -> frontend heatmap |

### Functions
| Function | Type | Purpose |
|----------|------|---------|
| `categorize_from_merchant_map(p_user_id)` | DML | Server-side pattern matching backfill |
| `detect_recurring_transactions(p_user_id)` | Query | Find recurring merchants by interval/amount |
| `generate_proactive_insights(p_user_id)` | Query | Budget warnings, spending spikes, new merchants |
| `handle_new_user()` | Trigger | Create profile on signup |
| `set_updated_at()` | Trigger | Auto-update timestamps |
| `update_conversation_timestamp()` | Trigger | Update conversation.updated_at on message |

### RLS
All tables have SELECT/INSERT/UPDATE/DELETE policies using `(select auth.uid()) = user_id` with WITH CHECK on INSERT. The `(select ...)` wrapper ensures the initplan optimization (computed once per query, not per row).

## Edge Functions

| Function | Version | Auth | Purpose |
|----------|---------|------|---------|
| `flow-sms` | v11 | API key | Parse SMS, insert transaction |
| `flow-data` | v13 | JWT | Fetch all user data, incremental sync, FX auto-refresh |
| `flow-backfill` | v3 | JWT | Categorize uncategorized txns |
| `flow-learn` | v7 | JWT | Save user category corrections |
| `flow-chat` | v6 | JWT | Streaming AI chat with SSE + 4 tools |
| `flow-profile` | v3 | JWT | CRUD for profile/goals/streaks/insights |
| `flow-remember` | v6 | JWT | Save user context entries |
| `flow-recipients` | v6 | JWT | CRUD for transfer recipients |
| `flow-keys` | v7 | JWT | Generate/revoke API keys |
| `flow-ai` | v9 | JWT | Legacy non-streaming chat (refreshInsights only) |

**All functions**: `verify_jwt: false` with explicit JWT extraction (`authHeader.replace('Bearer ', '')` -> `getUser(jwt)`).

## Frontend Architecture

### Build
- **Bundler**: Vite 5
- **CSS**: Tailwind v4 via `@tailwindcss/vite` plugin
- **Typography**: `@tailwindcss/typography` for chat markdown
- **Entry**: `flow/flow.html` (NOT index.html)

### Module Map (17 modules)

| Module | Responsibility |
|--------|----------------|
| `main.js` | Orchestrator, STATE, CONFIG, window exports, auth |
| `data.js` | Sync, parse, categorize (with subcategory mapping), FX, recipients |
| `constants.js` | MERCHANT_TYPES, TIME_CONTEXTS, SIZE_TIERS, PATTERNS, SUMMARY_GROUPS |
| `modals.js` | Transaction rows, drilldowns, categorization modal |
| `features.js` | Achievements, heatmap, CSV export, health score, generosity |
| `visualizations.js` | Spending trend, treemap, period comparison, heatmap, smart metrics |
| `chat.js` | Streaming SSE chat UI, conversation management |
| `settings.js` | Periods, settings modal, backfill, FX overrides, profile |
| `onboarding.js` | First-run bank setup, API key generation |
| `insights.js` | Quick insights, recurring summary, proactive alerts |
| `patterns.js` | Salary detection, pattern detection, budget projection |
| `focus.js` | Focus mode, impulse detection, streaks, daily budget |
| `charts.js` | Chart.js donut, budget, daily, cumulative |
| `recipients.js` | Recipient CRUD UI |
| `render.js` | Filter, render, category breakdown, metrics |
| `goals.js` | Goal CRUD, localStorage-to-DB migration |
| `filters.js` | Dimension-based filtering, filtered results modal |
| `utils.js` | formatNum, escapeHtml, showToast, dark mode, PWA |
| `events.js` | EventTarget-based event bus |

### State Management
Single mutable `STATE` object in main.js, passed to all modules:
```javascript
const STATE = {
    allTxns: [],        // All parsed transactions
    filtered: [],       // Filtered by current period
    fxRates: {},        // Currency conversion
    merchantMap: [],    // Pattern matching rules
    localMappings: {},  // User overrides (localStorage)
    userContext: [],     // Corrections & preferences
    recipients: [],     // Transfer recipients
    categories: new Set(),
    dateRange: { start, end },
    period: 'salary',
    viewMode: 'parent',
    profile: null,
    dbGoals: [],
    dbInsights: [],
    dbStreaks: [],
    currentUser: null,
    hasLoaded: false,
    // ... UI state flags
};
```

### Event Bus
Lightweight pub/sub on `EventTarget`:
- `DATA_FILTERED`: After period change
- `PERIOD_CHANGED`: Period selector update
- `DATA_SYNCED`: After successful sync
- `TOAST`: Show notification
