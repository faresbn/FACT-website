# Edge Functions Reference

## Shared Infrastructure

All edge functions share `_shared/` utilities:
- `supabase.ts`: `createUserClient(request)` and `createAdminClient()`
- `cors.ts`: `resolveCorsOrigin()`, `corsHeaders()` from `FLOW_ALLOWED_ORIGINS` env var
- `utils.ts`: `sha256Hex()`, `normalizePhone()`, `buildIdempotencyKey()`, `extractTimeContext()`

### Auth Patterns
| Pattern | Functions | How |
|---------|-----------|-----|
| API Key | flow-sms | SHA-256 hash lookup in `user_keys` table |
| JWT (explicit) | All other 9 functions | `jwt = authHeader.replace('Bearer ', '')` then `getUser(jwt)` |

All deployed with `verify_jwt: false` (explicit JWT validation in function code).

---

## flow-sms (v11) -- SMS Ingest

**Endpoint**: POST `/flow-sms`
**Auth**: API key in body (`key`, `apiKey`, or `token`)

### Request
```json
{
  "key": "flow_...",
  "sms": "Your credit card has been used...",
  "timestamp": "2026-02-06T10:00:00Z"
}
```
Or batch: `{ "key": "...", "entries": [{ "sms": "...", "timestamp": "..." }, ...] }`

### Processing
1. Validate API key against `user_keys` (SHA-256 hash match)
2. Load merchant_map, profile (family patterns), user_context (corrections) for context
3. Build context-aware prompt with time context, merchant patterns, corrections
4. Call Claude Haiku; if low confidence or uncategorized subcategory, retry with Sonnet
5. Check idempotency_key for duplicates
6. INSERT into raw_ledger with all parsed fields
7. Update `user_keys.last_used_at`

### Response
```json
{
  "success": true,
  "received": 1,
  "appended": 1,
  "skipped": 0,
  "errors": 0,
  "entryLogs": [{ "fate": "appended" }]
}
```

### AI Prompt Output Schema
```json
{
  "amount": 64.00,
  "currency": "QAR",
  "counterparty": "Talabat QFC LLC",
  "card": "VISA2",
  "direction": "OUT",
  "txnType": "Purchase",
  "category": "Lifestyle",
  "subcategory": "Delivery",
  "confidence": "high",
  "context": { "reasoning": "Food delivery service" },
  "skip": false
}
```

---

## flow-data (v13) -- Data Sync

**Endpoint**: POST `/flow-data`
**Auth**: JWT Bearer

### Request
```json
{
  "sheets": ["RawLedger", "MerchantMap", "FXRates", "UserContext", "Recipients", "Profile", "Goals", "Insights", "Streaks", "Recurring", "HourlySpend", "Proactive"],
  "last_sync": "2026-02-06T10:00:00Z"  // optional, for incremental
}
```

### Processing
1. Fetch RawLedger (optionally filtered by `created_at > last_sync` for incremental)
2. If >10% uncategorized, trigger `categorize_from_merchant_map` RPC, then re-fetch
3. Check FX rates staleness (>24h) and auto-refresh from `open.er-api.com/v6/latest/QAR`
4. Fetch all other requested sheets including Recurring, HourlySpend, Proactive
5. Return everything in a single response

### Response Format
- `RawLedger`: Array of JSON objects (13 columns including `amount_qar_approx`)
- `MerchantMap`: Array-of-arrays (header + rows, 4 columns)
- `FXRates`: Array-of-arrays (header + rows, 3 columns: Currency, RateToQAR, Formula)
- `UserContext`: Array-of-arrays (header + rows, 6 columns)
- `Recipients`: Array-of-arrays (header + rows, 5 columns)
- `Profile`, `Goals`, `Insights`, `Streaks`: Native JSON objects/arrays
- `Recurring`: Array from `detect_recurring_transactions()` RPC
- `HourlySpend`: Array from `hourly_spend` view
- `Proactive`: Array from `generate_proactive_insights()` RPC

---

## flow-backfill (v3) -- Batch Categorization

**Endpoint**: POST `/flow-backfill`
**Auth**: JWT Bearer

### Processing
1. Fetch all transactions where `subcategory IS NULL OR subcategory = ''`
2. Phase 1: Match against merchant_map patterns (counterparty contains pattern)
3. Phase 2: Batch remaining (10 at a time) to Claude Haiku for AI categorization
4. Update raw_ledger with results

### Response
```json
{
  "matched": 15,
  "ai_categorized": 8,
  "errors": 0,
  "total": 23,
  "message": "Backfill complete: 15 matched, 8 AI-categorized, 0 errors"
}
```

---

## flow-learn (v7) -- User Corrections

**Endpoint**: POST `/flow-learn`
**Auth**: JWT Bearer

### Request
```json
{
  "counterparty": "WOQOD - AL EGLA",
  "merchantType": "Transport",
  "consolidated": "WOQOD",
  "previousType": "Other"
}
```

### Processing
1. Upsert pattern into `merchant_map` (key: `user_id + pattern`)
2. Update ALL matching raw_ledger rows (ilike match on counterparty)
3. If category changed: log correction + payee entry in `user_context`

### Flywheel Effect
The user_context corrections are included in future flow-sms prompts, so the AI learns the user's preferences for similar transactions.

---

## flow-chat (v6) -- Streaming AI Chat

**Endpoint**: POST `/flow-chat`
**Auth**: JWT Bearer

### Actions
| Action | Purpose |
|--------|---------|
| `chat` (default) | Send message, get streaming SSE response |
| `list_conversations` | Get conversation history |
| `get_conversation` | Load messages for a conversation |
| `delete_conversation` | Delete a conversation |

### Chat Request
```json
{
  "message": "How much did I spend on delivery this month?",
  "conversation_id": "uuid-or-null"
}
```

### Tools (non-streaming tool loop, up to 5 iterations)
| Tool | Purpose |
|------|---------|
| `query_transactions` | Search transactions by merchant, category, date, amount |
| `query_trends` | Aggregated spending trends (daily/weekly/monthly) |
| `set_goal` | Create or update budget goals |
| `remember` | Save user preferences/corrections to user_context |

### System Prompt Context (6 parallel queries)
1. `period_summary` (last 6 months)
2. `merchant_analytics` (top 20 merchants)
3. `user_context` (corrections, preferences)
4. `recipients` (known people)
5. `profiles` (salary, budget settings)
6. `goals` (active budget limits)
+ `monthly_category_spend` (current month breakdown, sequential)

### SSE Stream Format
```
data: {"type":"text","content":"Based on your data..."}
data: {"type":"text","content":" you spent QAR 450"}
data: {"type":"done","conversation_id":"uuid"}
```

### Special: "Remember" Messages
Messages starting with "remember" or "note" are intercepted and saved to `user_context` as type `preference`, bypassing the full AI pipeline.

---

## flow-profile (v3) -- Profile & Goals CRUD

**Endpoint**: POST `/flow-profile`
**Auth**: JWT Bearer

### Actions
| Action | Purpose |
|--------|---------|
| `get` | Get profile settings |
| `save` | Save profile settings |
| `goals.list` | List active goals |
| `goals.save` | Create/update goal |
| `goals.delete` | Delete goal |
| `streaks.get` | Get streak data |
| `streaks.update` | Update streak |
| `insights.save` | Save AI-generated insight |
| `insights.list` | List recent insights |

### Profile Settings Object
```json
{
  "salary_day": 28,
  "salary_amount": 15000,
  "monthly_budget": 8000,
  "family_patterns": ["nassif", "daou"]
}
```

---

## flow-remember (v6) -- User Context

**Endpoint**: POST `/flow-remember`
**Auth**: JWT (explicit)

### Types
| Type | Key | Value | Details |
|------|-----|-------|---------|
| `income` | "Salary" | day (e.g., "28") | amount |
| `payee` | name | purpose | category |
| `correction` | original text | corrected text | context |
| `preference` | key | value | notes |
| `rule` | merchant | category | JSON conditions |

---

## flow-recipients (v6) -- Recipient Directory

**Endpoint**: POST `/flow-recipients`
**Auth**: JWT (explicit)

### Sub-Actions
- `add`: Create recipient (shortName required)
- `update`: Update by id
- `delete`: Delete by id

### Matching Logic (data.js client-side)
1. Phone number digits match
2. Bank account match (full or last 4)
3. Long name word match
4. Short name partial match

---

## flow-keys (v7) -- API Key Management

**Endpoint**: POST `/flow-keys`
**Auth**: JWT (explicit)

### Actions
- `create`: Generate new `flow_...` key, store SHA-256 hash
- `revoke`: Set `revoked_at` timestamp on key

Keys are 32 random bytes, base64url-encoded, prefixed with `flow_`.
