# FACT/Flow - Personal Finance Intelligence

A privacy-first personal finance tracker designed for ADHD-friendly budgeting and spending control.

## Current State (February 2026)

### Architecture

```
flow/
├── index.html          # Main entry point (Vite-built app)
├── flow.html           # Vite source entry point
├── src/
│   ├── main.js         # Thin orchestrator (~900 lines)
│   ├── style.css       # Custom CSS (complements Tailwind)
│   └── modules/        # 14 ES6 modules
│       ├── ai.js       # AI chat integration
│       ├── charts.js   # Chart.js visualizations
│       ├── data.js     # Supabase data sync
│       ├── features.js # Feature toggles
│       ├── filters.js  # Transaction filtering
│       ├── focus.js    # Focus mode (ADHD-friendly)
│       ├── goals.js    # Financial goals
│       ├── modals.js   # Modal dialogs
│       ├── onboarding.js # New user wizard
│       ├── patterns.js # Spending pattern detection
│       ├── recipients.js # Transfer recipients
│       ├── render.js   # UI rendering
│       ├── settings.js # User settings
│       └── utils.js    # Utility functions
├── assets/             # Built assets (committed for GitHub Pages)
├── dist/               # Vite build output (gitignored)
├── public/             # Static assets
└── gas_enhanced.js     # Google Apps Script (SMS → Google Sheet)
```

### Technology Stack

- **Frontend**: Vanilla JS + Tailwind CSS (CDN) + Vite bundler
- **Backend**: Supabase (PostgreSQL + Auth + Edge Functions)
- **AI**: Anthropic Claude (Haiku for SMS parsing, Sonnet for chat/analysis)
- **Deployment**: GitHub Pages (static hosting)
- **SMS Ingestion**: iOS Shortcut → Supabase Edge Function (`flow-sms`)

### Database Tables (Supabase)

| Table | Purpose | Rows |
|-------|---------|------|
| `raw_ledger` | Transaction records | 329 |
| `merchant_map` | Merchant categorization rules | 155 |
| `recipients` | Transfer recipients | 13 |
| `user_context` | User-specific context | 6 |
| `fx_rates` | Foreign exchange rates | 6 |
| `insights` | AI-generated insights | 2 |
| `user_keys` | API keys for Shortcuts | 0 |
| `profiles` | User profile settings | 0 |

### Edge Functions

| Function | Purpose | Auth |
|----------|---------|------|
| `flow-sms` | Parse SMS via Claude Haiku, retry with Sonnet | API Key |
| `flow-data` | CRUD for transactions | JWT |
| `flow-ai` | AI chat via Claude Sonnet (standard + deep) | JWT |
| `flow-keys` | Manage API keys | JWT |
| `flow-learn` | Learn from corrections | JWT |
| `flow-recipients` | Manage recipients | JWT |
| `flow-remember` | Store user context | JWT |

### Authentication

- Supabase Auth (Magic Link OTP + Google OAuth)
- Redirect URL: `https://www.fact.qa/flow/`
- API Key auth for iOS Shortcut automation

---

## Roadmap

### Tier 1: Urgent/Immediate (This Week)

1. **Enable Leaked Password Protection**
   - Supabase Dashboard → Auth → Settings
   - Enable "Leaked password protection"
   - Status: Manual (dashboard setting)

2. **Set CORS Origins**
   - Supabase Dashboard → Edge Functions → Settings
   - Set `FLOW_ALLOWED_ORIGINS` to `https://www.fact.qa`
   - Status: Manual (dashboard setting)

3. **Verify Auth Redirect URLs**
   - Supabase Dashboard → Auth → URL Configuration
   - Ensure `https://www.fact.qa/flow/` is in allowed redirects
   - Status: Manual (dashboard setting)

### Tier 2: Priority Fixes (This Month)

1. **iOS Shortcut Integration**
   - Create downloadable Shortcut template
   - Add setup instructions to onboarding wizard
   - Test end-to-end SMS → Supabase flow
   - Status: Onboarding wizard code exists, needs testing

2. **Complete Onboarding Wizard**
   - Bank selection (QNB only for now)
   - API key generation
   - Shortcut download link
   - Connection test
   - Status: Code written, needs integration

3. **AI Model Migration**
   - Migrated from OpenAI GPT to Anthropic Claude
   - `flow-sms`: Claude Haiku (fast), Sonnet retry on low confidence
   - `flow-ai`: Claude Sonnet for standard + deep analysis
   - Status: Done

4. **CSS/Accessibility Fixes**
   - Skip-link properly hidden (inline styles added)
   - Focus indicators for keyboard navigation
   - Status: Done

### Tier 3: Needed Functional Requirements (Next Quarter)

1. **Multi-Bank Support**
   - Abstract SMS parsing for different bank formats
   - Bank configuration object pattern
   - Currently hardcoded for QNB

2. **Receipt Capture**
   - Photo → OCR → Transaction matching
   - Store receipt images in Supabase Storage

3. **Budget Forecasting**
   - Historical pattern analysis
   - Spending velocity tracking
   - Daily/weekly burn rate alerts

4. **Category Learning**
   - User corrections → ML model retraining
   - Confidence scoring improvements

5. **Export/Reporting**
   - PDF monthly reports
   - Tax category summaries
   - Multi-currency consolidation

### Tier 4: Future Enhancements (Backlog)

1. **Native Mobile App**
   - React Native or Flutter
   - Push notifications for transactions
   - Offline support

2. **Multi-User/Family**
   - Shared budgets
   - Allowances
   - Permission levels

3. **Investment Tracking**
   - Portfolio integration
   - Net worth tracking

4. **AI Insights Enhancement**
   - Weekly/monthly spending summaries
   - Anomaly detection
   - Goal recommendations

5. **Integrations**
   - Bank API connections (where available)
   - Accounting software export
   - Tax preparation integration

---

## Development

### Local Setup

```bash
cd flow
npm install
npm run dev     # Start dev server at localhost:5173
npm run build   # Build for production
```

### Environment Variables

Create `flow/.env`:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_FUNCTIONS_BASE=https://your-project.supabase.co/functions/v1
VITE_AUTH_REDIRECT_URL=https://www.fact.qa/flow/
```

### Deployment

1. Run `npm run build` in `flow/`
2. Copy `dist/index.html` to `flow/flow.html` and `flow/index.html`
3. Copy `dist/assets/*` to `flow/assets/`
4. Commit and push to main
5. GitHub Actions deploys automatically

### GAS Pipeline (Legacy/Deprecated)

The Google Apps Script (`gas_enhanced.js`) was the original SMS ingestion pipeline.
It has been superseded by the Supabase `flow-sms` edge function + iOS Shortcut flow.
The file is kept for reference only.

---

## Security Notes

- All tables have RLS (Row Level Security) enabled
- Edge functions use JWT auth (except `flow-sms` which uses API key)
- API keys are SHA-256 hashed before storage
- `raw_text` column stores SMS content (may contain card last-4)
- No secrets in frontend code (anon key is designed to be public)

---

## Known Issues

1. **Vite Source HTML**: The source `index.html` doesn't include inline skip-link styles. Future builds need the fix applied to the output.

2. **Asset Hash Changes**: Each build produces new hashed filenames. Old assets should be removed after deployment.

3. **GAS Not Connected**: The Google Apps Script pipeline operates independently. Data from it doesn't flow to Supabase yet.

---

## Contact

FACT · https://www.fact.qa
