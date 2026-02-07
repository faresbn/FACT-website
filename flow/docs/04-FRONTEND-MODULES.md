# Frontend Module Reference

## Entry Point: main.js (~1,090 lines)

The orchestrator. Does NOT contain business logic -- it imports from all 17 modules, initializes STATE, sets up Supabase auth, and wires ~150 `window.*` exports for `onclick=` handlers in flow.html.

### Responsibilities
- Supabase client initialization
- Auth state management (onAuthStateChange)
- STATE object definition
- Import and re-export all module functions to `window.*`
- First-load orchestration (sync -> setSalaryPeriod -> render)
- Merchant modal (open, filter, close) with search and sort
- Viz tab and main tab switching logic

### Key Constants (defined in constants.js)
```javascript
MERCHANT_TYPES = {
  Groceries: { icon: '...', color: '#...', essential: true },
  Dining: { icon: '...', color: '#...', essential: false },
  // ... 15 types total
}

SUMMARY_GROUPS = {
  Essentials: { types: ['Groceries', 'Bills', 'Health', 'Transport'], color: '#...', icon: '...' },
  Lifestyle: { types: ['Dining', 'Coffee', 'Delivery', 'Shopping', ...], color: '#...', icon: '...' },
  Family: { ... },
  Financial: { ... },
}
```

---

## data.js (~570 lines) -- Data Layer

### Functions
| Function | Purpose |
|----------|---------|
| `syncData()` | POST to flow-data, process all sheets, incremental sync |
| `processTxns()` | Parse raw_ledger rows into transaction objects |
| `categorize()` | 3-tier categorization: localMappings > DB category > merchantMap |
| `normalizeCounterparty()` | Title-case ALL-CAPS names, consolidate brand variants (Woqod, Carrefour, etc.) |
| `processFX()` | Parse FX rates |
| `processMerchantMap()` | Parse merchant patterns |
| `processUserContext()` | Parse user corrections/preferences |
| `processRecipients()` | Parse recipient directory |
| `matchRecipient()` | Match counterparty to known recipient (phone/account/name) |
| `getContextForTransaction()` | Find relevant user_context for a transaction |
| `isExemptFromSplurge()` | Check if user exempted transaction from splurge detection |

### Counterparty Normalization
- ALL-CAPS names (e.g., `ANTHROPIC`) are title-cased (`Anthropic`)
- Known brands with variants are consolidated (e.g., `Woqod Al Wakra` -> `Woqod`)
- Applied during `processTxns()` before categorization

### Recipient Matching
- **Transfers**: Matches by counterparty first, then falls back to raw_text (catches phone numbers in SMS body)
- **Non-transfer OUT**: Only does phone/account matching (8+ digits) to avoid false-positive name matches

### Transaction Object Shape
```javascript
{
  date: dayjs,           // Parsed timestamp
  amount: number,        // In QAR (converted via fxRates)
  currency: string,      // Original currency
  raw: string,           // Full SMS text
  counterparty: string,  // Clean merchant name from DB
  card: string,          // Card identifier
  display: string,       // What shows in UI (from categorize())
  consolidated: string,  // Grouping name
  merchantType: string,  // Subcategory (Groceries, Dining, etc.)
  summaryGroup: string,  // Parent category (Essentials, Lifestyle, etc.)
  direction: 'IN'|'OUT',
  txnType: string,       // Purchase, Transfer, Salary, etc.
  confidence: string,    // high/medium/low/matched/corrected
  isSalary: boolean,
  recipient: object|null, // Matched recipient for transfers
  resolvedName: string|null,
  dims: {
    what: string,        // = merchantType
    when: string,        // Time context (Morning, Late Night, Weekend, etc.)
    size: string,        // Micro/Small/Medium/Large/Major
    pattern: string,     // Normal/Night Out/Work Expense/Splurge/Subscription
  },
  isWorkHours: boolean,
  isLateNight: boolean,
  isWeekend: boolean,
  isLarge: boolean,
  isEssential: boolean,
}
```

---

## render.js (203 lines) -- Core Rendering

| Function | Purpose |
|----------|---------|
| `filterAndRender()` | Filter allTxns by dateRange, trigger all renders |
| `renderTodaySection()` | Today's date, spending, budget meter, streak |
| `renderCategoryBreakdown()` | Left panel category bars (parent or subcategory view) |
| `renderMetrics()` | Income, Spent, Net, Daily Budget metrics |
| `sortTransactions()` | Set txnSort and re-render |
| `filterTransactions()` | Set txnFilter and re-render |
| `setViewMode()` | Toggle parent/subcategory view |

---

## modals.js (567 lines) -- Transaction UI

| Function | Purpose |
|----------|---------|
| `renderRecentTxns()` | Top 15 transactions in main view |
| `renderTxnRow()` | Single transaction row HTML |
| `openCatModal()` | Open categorization dialog for a transaction |
| `saveCategorization()` | Save category to localMappings + sync to flow-learn |
| `openDrilldown()` | Category drill-down modal with mini chart |
| `openParentDrilldown()` | Summary group drill-down |
| `openUncatModal()` | Uncategorized transactions list |
| `openAllTransactions()` | Full transaction list modal |

### Categorization Flow (saveCategorization)
1. Save to `STATE.localMappings[raw.toLowerCase()]`
2. Save to localStorage
3. Update all matching transactions in STATE.allTxns (display, consolidated, merchantType)
4. Re-run `detectPatterns()` so insights/patterns reflect new category
5. Re-render UI (filterAndRender)
6. Fire-and-forget POST to flow-learn (syncs to DB)

---

## chat.js (456 lines) -- Streaming Chat (Side Panel + FAB)

| Function | Purpose |
|----------|---------|
| `initChat()` | Render chat UI, set up events |
| `toggleChat()` | Toggle panel expand/collapse |
| `openChat()` / `closeChat()` | Explicit open/close |
| `sendMessage()` | POST to flow-chat, read SSE stream, render markdown |
| `loadConversationList()` | Fetch conversation history |
| `loadConversation()` | Load messages for a conversation |
| `startNewConversation()` | Reset to welcome state |

### Layout
- **Desktop**: Right-side slide panel (380px), main content shrinks with `margin-right: 380px`
- **Mobile**: Full-screen overlay
- **FAB**: Floating action button (bottom-right), hidden when panel is open
- **Input area**: Textarea + send button (top), powered-by + char count (bottom)

### Quick Actions
Pre-defined queries: "This month summary", "Where am I overspending?", "Predict end-of-month", "Compare to last month", "Top merchants", "Anomalies".

---

## visualizations.js (534 lines) -- Charts

| Function | Chart Type | Container ID |
|----------|-----------|--------------|
| `renderSpendingTrend()` | Stacked area (Chart.js line) | `spendingTrendChart` |
| `renderMerchantTreemap()` | Treemap (chartjs-chart-treemap) | `merchantTreemapChart` |
| `renderPeriodComparison()` | Horizontal bar | `periodComparisonChart` |
| `renderTimeHeatmap()` | HTML grid (inline, not canvas) | `timeHeatmapGrid` |
| `renderSmartMetrics()` | Metric cards with sparklines | `metricBalance`, `metricDailyBudget`, etc. |

All canvas charts stored in `vizCharts` object with `.destroy()` before recreate.

---

## patterns.js (285 lines) -- Behavioral Analysis

| Function | Purpose |
|----------|---------|
| `detectPatterns()` | Find Night Out, Work Expense, Splurge, Subscription patterns |
| `detectSalary()` | Find salary transactions, calculate modal amount |
| `getIncomeDayFromContext()` | Read salary day from user_context |
| `getNextSalaryDate()` | Predict next salary with weekend adjustment (Qatar Fri/Sat) |
| `setSalaryPeriod()` | Set date range to last salary cycle |
| `calculateBudgetProjection()` | Income - expenses / days remaining |

### Pattern Detection Rules
- **Night Out**: 2+ bars/dining/coffee in same evening, late night hours
- **Work Expense**: Dining/coffee during work hours
- **Splurge**: Amount > 3x average for that merchant type
- **Subscription**: Same merchant, similar amount, ~monthly interval

---

## focus.js (283 lines) -- ADHD-Friendly Mode

| Function | Purpose |
|----------|---------|
| `toggleFocusMode()` | Enable/disable simplified view |
| `updateFocusHero()` | Big number: remaining daily budget |
| `updateQuickInsight()` | Contextual one-liner insight |
| `checkDailyBudget()` | Calculate today's spend vs budget |
| `updateDailyBudgetMeter()` | Visual budget progress bar |
| `detectImpulseBurst()` | 3+ transactions in 30 minutes |
| `checkForImpulseBursts()` | Show impulse warning banner |
| `getStreakData()` / `updateStreak()` | Under-budget day counting |

---

## goals.js (208 lines) -- Budget Goals

| Function | Purpose |
|----------|---------|
| `getGoals()` | DB-first, localStorage fallback |
| `renderSettingsGoalsList()` | Goals with progress bars + pace indicator |
| `addNewGoal()` | Open goal creation modal |
| `saveGoal()` | Save to localStorage (DB sync TODO) |
| `deleteGoal()` | Confirm and remove |
| `migrateGoalsToDb()` | One-time localStorage -> DB migration |

---

## settings.js (~530 lines) -- Settings & Profile

| Function | Purpose |
|----------|---------|
| `setPeriod()` | salary, thisMonth, lastMonth, last90, custom |
| `openSettings()` / `closeSettings()` | Settings modal |
| `switchSettingsTab()` | account, budget, goals, contacts, data tabs |
| `saveSettings()` | AI model preference (localStorage) |
| `generateShortcutKey()` | Create API key via flow-keys |
| `revokeShortcutKey()` | Revoke API key |
| `runBackfill()` | Trigger flow-backfill |
| `loadProfileTab()` / `saveProfile()` | Profile settings CRUD |
| `changePassword()` | Supabase auth password update |
| `renderFxRates()` / `saveFxOverrides()` | FX rate management |
| `listKeys()` / `renderKeyList()` | API key management |

### Settings Tabs
| Tab | Contents |
|-----|----------|
| **Account** | AI model selector, password change, logout |
| **Budget** | Salary day, salary amount, monthly budget, family names |
| **Goals** | Budget goals CRUD with progress bars |
| **Contacts** | Recipients CRUD (phone, bank account, names) |
| **Data** | iOS shortcut keys, FX rates, backfill, export CSV |

---

## Other Modules

### forecast.js (293 lines)
Client-side spending forecasts. No edge functions needed — all computation from STATE.

| Function | Purpose |
|----------|---------|
| `forecastPeriodEnd()` | Projected balance, daily burn rate, confidence level |
| `forecastCategories()` | 3-month moving average per category, flags rising/falling trends |
| `forecastRecurring()` | Sum recurring costs for next 30 days |
| `forecastGoals()` | Predict goal status (safe/warning/over) |
| `renderForecast()` | Update forecast card DOM (compact 2x2 grid) |

Confidence levels: High (3+ months, low variance), Medium (2 months), Low (<2 months or high variance).

### features.js (522 lines)
Donut chart, budget projection rendering, quick insights, pattern warnings, generosity budget, check achievements.

### charts.js (269 lines)
Donut chart canvas rendering with Chart.js. Animated, responsive, dark-mode aware.

### filters.js (173 lines)
All-transactions modal, merchant grouping modal, CSV export.

### recipients.js (215 lines)
Recipient CRUD UI in settings contacts tab.

### onboarding.js (295 lines)
First-run welcome flow, guided setup.

### constants.js (~100 lines)
Extracted from main.js. Contains `MERCHANT_TYPES`, `SUMMARY_GROUPS`, `CAT_COLORS`, `PATTERNS`, `TIME_CONTEXTS`, `SIZE_TIERS` and helper functions.

### utils.js (139 lines)
`formatNum()`, `escapeHtml()`, `showToast()`, `showConfirm()`, `initServiceWorker()`, `initPWAInstall()`, `initDarkMode()`, `toggleDarkMode()`.

### events.js (29 lines)
EventTarget-based pub/sub. Events: `DATA_FILTERED`, `PERIOD_CHANGED`, `DATA_SYNCED`, `TOAST`.
