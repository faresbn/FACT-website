# FACT/Flow - Personal Finance Intelligence

A privacy-first personal finance tracker designed for ADHD-friendly budgeting and spending control. Built on Supabase (PostgreSQL + Edge Functions + Auth) with a Vite-bundled vanilla JS frontend, deployed on GitHub Pages.

## Architecture (February 2026)

```
flow/
├── index.html          # Production entry (Vite-built, deployed via GitHub Pages)
├── flow.html           # Vite source entry (dev/build input)
├── sw.js               # Service worker (offline support, network-first HTML)
├── src/
│   ├── main.js         # Thin orchestrator — imports, STATE, auth, window exports
│   ├── style.css       # Custom CSS (complements Tailwind CDN)
│   └── modules/        # 14 ES6 modules
│       ├── ai.js       # AI chat (Claude Sonnet), quick insights
│       ├── charts.js   # Chart.js donut, daily, cumulative, budget projection
│       ├── data.js     # Supabase sync, categorisation, merchant matching
│       ├── features.js # Heatmap, achievements, health score, generosity
│       ├── filters.js  # Dimension filters (time, amount, pattern), voice input
│       ├── focus.js    # Focus mode (ADHD-friendly), streaks, impulse detection
│       ├── goals.js    # Financial goals CRUD + localStorage → DB migration
│       ├── modals.js   # Drilldown, categorisation, transaction modals
│       ├── onboarding.js # New-user wizard (bank, API key, Shortcut)
│       ├── patterns.js # Salary detection, subscriptions, splurge flagging
│       ├── recipients.js # Transfer recipient management
│       ├── render.js   # filterAndRender pipeline, metrics, today section
│       ├── settings.js # Period picker, profile tab, backfill, AI model
│       └── utils.js    # formatNum, toast, SW registration, dark mode, PWA
├── assets/             # Built assets (committed for GitHub Pages)
├── dist/               # Vite build output (gitignored)
├── public/             # Static assets (icons, manifest)
└── .env                # Supabase credentials (gitignored)
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vanilla JS + Tailwind CSS (CDN) + Vite 5 bundler |
| **Backend** | Supabase PostgreSQL + Row Level Security |
| **Auth** | Supabase Auth — Google OAuth (PKCE flow) + Magic Link OTP |
| **Edge Functions** | 9 Deno edge functions on Supabase |
| **AI** | Anthropic Claude — Haiku (SMS parsing), Sonnet (chat/analysis) |
| **Deployment** | GitHub Pages (static) + Supabase (backend) |
| **SMS Ingestion** | iOS Shortcut → `flow-sms` edge function |
| **PWA** | Service worker with network-first HTML, cache-first assets |

## Database Schema (Supabase — project `fihxypjmvizgwinozjsf`)

All tables have **RLS enabled** and foreign keys to `auth.users.id`.

| Table | Purpose | Rows | Notes |
|-------|---------|------|-------|
| `raw_ledger` | Transaction records | 329 | SMS-parsed + AI-categorised |
| `merchant_map` | Merchant → category rules | 150 | Pattern-based matching |
| `profiles` | User profile & settings | 1 | Salary day, budget, family names |
| `user_context` | User corrections & context | 6 | Fed into AI prompts |
| `fx_rates` | Foreign exchange rates | 6 | Multi-currency support |
| `recipients` | Transfer recipients | 2 | Phone/account → name mapping |
| `user_keys` | API keys for Shortcuts | 1 | SHA-256 hashed |
| `insights` | AI-generated insights | 0 | type, period_start/end, metadata |
| `goals` | Spending limit goals | 0 | Category-based monthly limits |
| `streaks` | Budget streak tracking | 0 | Current/best count, last_date |

### Migrations Applied

| # | Name | Purpose |
|---|------|---------|
| 1 | `flow_schema` | Initial schema (all core tables + RLS) |
| 2 | `fix_set_updated_at_search_path` | Fix trigger search path |
| 3 | `optimize_rls_policies_initplan` | `auth.uid()` → `(select auth.uid())` |
| 4 | `add_missing_foreign_key_indexes` | Index all FK columns |
| 5 | `remove_duplicate_index` | Cleanup |
| 6 | `normalize_legacy_subcategories` | Align old taxonomy names |
| 7 | `create_goals_and_streaks_tables` | Goals + streaks with RLS |
| 8 | `enhance_insights_table` | Add type, period_start/end, metadata |
| 9 | `fix_goals_streaks_rls_and_index` | Optimise RLS + add FK indexes |

## Edge Functions

| Function | Version | Auth | Purpose |
|----------|---------|------|---------|
| `flow-sms` | v8 | API Key | Parse SMS via Claude Haiku; retry with Sonnet on low confidence |
| `flow-data` | v5 | JWT | Sync all data (txns, merchants, FX, context, profile, goals, insights, streaks) |
| `flow-ai` | v7 | JWT | AI chat via Claude Sonnet — enriched with profile, goals, insights context |
| `flow-learn` | v5 | JWT | Learn from user corrections; propagate to `raw_ledger` |
| `flow-backfill` | v1 | JWT | Batch AI re-categorisation of uncategorised transactions |
| `flow-profile` | v1 | JWT | CRUD for profile settings, goals, streaks, insights |
| `flow-keys` | v4 | API Key | Generate/revoke/validate API keys |
| `flow-recipients` | v4 | API Key | Manage transfer recipients |
| `flow-remember` | v4 | API Key | Store user context (corrections, preferences) |

## Authentication

- **Google OAuth** via Supabase Auth with **PKCE flow** (`flowType: 'pkce'`)
- **Magic Link OTP** as fallback (email-based)
- **API Key auth** for iOS Shortcut automation (`flow-sms`, `flow-keys`, `flow-recipients`, `flow-remember`)
- **Auth guard**: Synchronous `<script>` in `<head>` checks `localStorage` for session token before first paint — prevents FOUC
- **Redirect URL**: `https://www.fact.qa/flow/`
- Supabase client configured with `detectSessionInUrl: true` for automatic `?code=` exchange

## Key Features

- **5-Dimension categorisation**: What (merchant type), When (time context), Size (amount tier), Pattern (routine/splurge/trip), Who (recipient)
- **AI-powered insights**: Claude Sonnet analyses spending with full user context
- **Focus Mode**: ADHD-friendly simplified view with daily budget meter
- **Streak tracking**: Consecutive days under budget
- **Impulse detection**: Alerts for burst spending patterns
- **Heatmap**: Calendar view of spending intensity
- **Achievements**: Gamified financial milestones
- **Health Score**: Composite financial health metric
- **Generosity budget**: Track charitable/family giving
- **Voice input**: Web Speech API for AI chat
- **Dark mode**: System-preference aware with manual toggle
- **PWA**: Installable, offline-capable via service worker

## Development

### Prerequisites

- Node.js 18+
- npm
- Supabase project with edge functions deployed

### Local Setup

```bash
cd flow
npm install
cp .env.example .env   # Fill in your Supabase credentials
npm run dev             # Start dev server at localhost:5173
```

### Environment Variables

Create `flow/.env`:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_FUNCTIONS_BASE=https://your-project.supabase.co/functions/v1
VITE_AUTH_REDIRECT_URL=https://www.fact.qa/flow/
```

### Build & Deploy

```bash
cd flow
npm run build                              # Vite build → dist/
cp dist/flow.html ../flow/index.html       # Update production HTML
rm -f assets/flow-*.js assets/flow-*.css   # Remove old hashed assets
cp dist/assets/* assets/                   # Copy new hashed assets
git add -A && git commit && git push       # Deploy to GitHub Pages
```

The service worker uses a versioned cache name (`fact-flow-vN`). Bump the version in `sw.js` when deploying significant changes to ensure clients pick up the new code.

### Module Pattern

All UI logic is split into 14 ES6 modules. `main.js` acts as a thin orchestrator:

1. **Imports** all module functions
2. **Defines** shared STATE object and CONFIG
3. **Creates** wrapper functions that bind STATE + callbacks to module functions
4. **Exports** wrappers to `window.*` for HTML `onclick` handlers
5. **Manages** auth flow (PKCE via `onAuthStateChange`)

Modules never access STATE directly — it's always passed as a parameter.

## Security Notes

- All 10 public tables have **Row Level Security** enabled
- RLS policies use optimised `(select auth.uid())` pattern
- All FK columns are indexed
- Edge functions use JWT auth (except SMS/key/recipient endpoints which use API key auth with internal validation)
- API keys are **SHA-256 hashed** before storage in `user_keys`
- `raw_text` column in `raw_ledger` stores SMS content (may contain card last-4 digits)
- Supabase anon key is safe to expose in frontend (designed to be public, gated by RLS)
- Service worker bypasses caching for all auth-related requests

## Known Limitations

1. **Single bank**: SMS parsing is currently QNB-specific. Multi-bank support requires abstracting the parser.
2. **No push notifications**: PWA install is supported, but transaction alerts require a native app or web push setup.
3. **Chart.js bundle size**: The full Chart.js v4 is bundled (~550KB total JS). Could be reduced with tree-shaking or code splitting.
4. **Goals/Streaks tables empty**: These features are deployed but depend on user interaction to populate.

---

FACT · https://www.fact.qa
