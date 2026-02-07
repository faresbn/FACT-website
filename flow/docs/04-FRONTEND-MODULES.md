# Frontend Module Reference

## Entry Point: main.js (1,049 lines)

The orchestrator. Does NOT contain business logic -- it imports from all 17 modules, initializes STATE, sets up Supabase auth, and wires ~150 `window.*` exports for `onclick=` handlers in flow.html.

### Responsibilities
- Supabase client initialization
- Auth state management (onAuthStateChange)
- STATE object definition
- MERCHANT_TYPES and SUMMARY_GROUPS constants
- Import and re-export all module functions to `window.*`
- First-load orchestration (sync -> setSalaryPeriod -> render)

### Key Constants (defined in main.js)
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

## data.js (508 lines) -- Data Layer

### Functions
| Function | Purpose |
|----------|---------|
| `syncData()` | POST to flow-data, process all sheets, incremental sync |
| `processTxns()` | Parse raw_ledger rows into transaction objects |
| `categorize()` | 3-tier categorization: localMappings > AI > merchantMap |
| `processFX()` | Parse FX rates |
| `processMerchantMap()` | Parse merchant patterns |
| `processUserContext()` | Parse user corrections/preferences |
| `processRecipients()` | Parse recipient directory |
| `matchRecipient()` | Match counterparty to known recipient (phone/account/name) |
| `getContextForTransaction()` | Find relevant user_context for a transaction |
| `isExemptFromSplurge()` | Check if user exempted transaction from splurge detection |

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
3. Update all matching transactions in STATE.allTxns
4. Re-render UI
5. Fire-and-forget POST to flow-learn (syncs to DB)

---

## chat.js (452 lines) -- Streaming Chat

| Function | Purpose |
|----------|---------|
| `initChat()` | Render chat UI, set up events |
| `toggleChat()` | Toggle panel expand/collapse |
| `openChat()` / `closeChat()` | Explicit open/close |
| `sendMessage()` | POST to flow-chat, read SSE stream, render markdown |
| `loadConversationList()` | Fetch conversation history |
| `loadConversation()` | Load messages for a conversation |
| `startNewConversation()` | Reset to welcome state |

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

## settings.js (395 lines) -- Settings & Profile

| Function | Purpose |
|----------|---------|
| `setPeriod()` | thisMonth, lastMonth, last90, thisYear |
| `openSettings()` / `closeSettings()` | Settings modal |
| `switchSettingsTab()` | general, goals, contacts, profile tabs |
| `saveSettings()` | AI model preference (localStorage) |
| `generateShortcutKey()` | Create API key via flow-keys |
| `revokeShortcutKey()` | Revoke API key |
| `runBackfill()` | Trigger flow-backfill |
| `loadProfileTab()` / `saveProfile()` | Profile settings CRUD |
| `changePassword()` | Supabase auth password update |

---

## Other Modules

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

### ai.js (449 lines) -- LEGACY
Non-streaming AI chat. Replaced by chat.js + flow-chat. Still bundled.

### utils.js (139 lines)
`formatNum()`, `escapeHtml()`, `showToast()`, `showConfirm()`, `getTypeColor()`, `getSummaryGroup()`, `getTimeContext()`, `getSizeTier()`.

### events.js (29 lines)
EventTarget-based pub/sub. Events: `DATA_FILTERED`, `PERIOD_CHANGED`, `DATA_SYNCED`, `TOAST`.
