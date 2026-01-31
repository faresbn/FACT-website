# FACT/Flow Setup Guide

This document explains FACT/Flow personal finance tracker with:
- Multi-user support
- AI-powered contextual categorization (GPT-4.1/5.1)
- Pattern learning from user corrections
- Weekly insights generation
- Hierarchical category structure

---

## Architecture Overview

```
┌─────────────────┐      ┌──────────────────────┐      ┌─────────────────┐
│   iOS Shortcut  │──────│  Google Apps Script  │──────│  Google Sheets  │
│  (SMS trigger)  │ POST │  (gas_enhanced.js)   │      │  (per-user)     │
└─────────────────┘      └──────────────────────┘      └─────────────────┘
                                   │
                                   │ AI Analysis
                                   ▼
                         ┌──────────────────────┐
                         │   OpenAI GPT-4.1     │
                         │ - Extract txn data   │
                         │ - Categorize context │
                         │ - Confidence scoring │
                         └──────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       flow.html                                   │
│  - Multi-user via ?u=username                                           │
│  - Hierarchical categories (5 groups, 13 subcategories)                 │
│  - Merchant analysis (count + total)                                    │
│  - AI confidence indicators                                             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Category Structure

| Parent | Purpose | Subcategories |
|--------|---------|---------------|
| **Essentials** | Must-pay expenses | Groceries, Bills, Health, Transport |
| **Lifestyle** | Discretionary spending | Dining, Delivery, Bars & Hotels, Shopping, Hobbies, Travel |
| **Family** | Inter-family money flow | Family Transfers |
| **Financial** | Non-family money movement | Transfers, Fees |
| **Other** | Catch-all | Other, Uncategorized |

---

## AI Contextual Categorization

The enhanced GAS (`gas_enhanced.js`) uses GPT to intelligently categorize transactions based on:

### Signals Analyzed

| Signal | How It's Used |
|--------|---------------|
| **Merchant name** | "STARBUCKS" → Dining, "CARREFOUR" → Groceries |
| **Amount** | <50 QAR = likely coffee/transport, >1000 = likely travel/electronics |
| **Time of day** | 7am = breakfast, 8pm Friday = social |
| **Day of week** | Weekend evening = higher likelihood of entertainment |
| **Month timing** | Start of month = watch for rent/subscriptions |
| **Counterparty name** | Check against family member list for Family Transfers |
| **Historical patterns** | MerchantMap patterns from past categorizations |

### Confidence Levels

- **High**: Clear merchant match, known pattern, obvious category
- **Medium**: Reasonable inference but could be wrong
- **Low**: Limited info, educated guess

### Model Selection

In `gas_enhanced.js`, configure your preferred model:

```javascript
const CONFIG = {
  AI_MODEL: 'gpt-4.1',  // Options: gpt-4.1-nano, gpt-4.1-mini, gpt-4.1, gpt-5.1, o3, o4-mini
  // ...
};
```

**Recommendations:**
- `gpt-4.1-mini`: Fast, cheap, good for most transactions
- `gpt-4.1`: Better accuracy, recommended for production
- `gpt-5.1` / `o3`: Cutting-edge, use if cost is not a concern

---

## Enhanced Sheet Schema

The enhanced GAS writes 12 columns instead of 8:

| Column | Description |
|--------|-------------|
| Timestamp | ISO timestamp |
| Amount | Numeric amount |
| Currency | QAR, USD, etc. |
| Counterparty | Merchant or recipient name |
| Card | VISA2, MDEBIT2, TRANSFER, FAMILY |
| Direction | IN or OUT |
| TxnType | Purchase, Fawran, Transfer, Received, Fee, Salary |
| Category | Parent category (Essentials, Lifestyle, Family, Financial, Other) |
| Subcategory | Specific subcategory (Dining, Groceries, etc.) |
| Confidence | high, medium, low |
| Context | JSON with reasoning and time context |
| RawText | Original SMS (200 chars) |

The frontend automatically handles both old (8-col) and new (12-col) schemas.

---

## Setup Instructions

### 1. Deploy Enhanced GAS

1. Go to [script.google.com](https://script.google.com)
2. Create a new project or open your existing one
3. Replace the code with contents of `gas_enhanced.js`
4. Configure:
   - Set `OPENAI_API_KEY` in Project Settings > Script Properties
   - Update `USER_SHEETS` with your sheet IDs
   - Update `FAMILY_PATTERNS` with family member names

5. Deploy:
   - Deploy > New deployment > Web app
   - Execute as: Me
   - Who has access: Anyone
   - Copy the deployment URL

### 2. Update iOS Shortcut

Your shortcut should POST to the GAS URL with:

```json
{
  "user": "fares",
  "sms": "Your credit card has been used for a purchase...",
  "timestamp": "2025-01-30T10:30:00Z"
}
```

### 3. Configure Frontend

In `flow.html`, update `USER_SHEETS`:

```javascript
USER_SHEETS: {
    'fares': '1LLpl1sH7LHqD3u3ZU4JWZJtvcHD_SGFql76llyfAIBw',
    'alice': 'SHEET_ID_FOR_ALICE',
},
```

Access via: `https://www.fact.qa/flow.html?u=fares`

---

## AI-Powered Features

### 1. Smart Initial Categorization

Every incoming SMS is analyzed with context:

```
SMS: "Your credit card has been used for a purchase. Amount: QAR 85 Location: STARBUCKS COFFEE"
Time: Friday 8pm

AI Analysis:
- Merchant: STARBUCKS = coffee shop
- Amount: 85 QAR = typical coffee shop spend
- Time: Friday evening = social occasion
→ Category: Lifestyle > Dining
→ Confidence: High
→ Reasoning: "Coffee shop purchase on weekend evening"
```

### 2. Family Transfer Detection

Configure family patterns per user:

```javascript
FAMILY_PATTERNS: {
  'fares': ['ahmed', 'fatima', 'mom', 'dad', 'baba', 'mama']
}
```

When a Fawran/Transfer mentions a family name:
→ Automatically categorized as **Family > Family Transfers**

### 3. Pattern Learning

When you manually recategorize a transaction in the UI, call:

```javascript
learnFromRecategorization('STARBUCKS COFFEE', 'Lifestyle', 'Dining');
```

This updates your MerchantMap so future transactions auto-categorize correctly.

### 4. Weekly Insights (Optional)

Set up a time-based trigger to run `analyzeRecentTransactions()` weekly:

1. In GAS, go to Triggers (clock icon)
2. Add trigger:
   - Function: `analyzeRecentTransactions`
   - Event source: Time-driven
   - Type: Week timer
   - Day: Sunday
   - Time: 9am-10am

This generates AI insights saved to an "Insights" sheet:
- Spending patterns and trends
- Unusual transactions
- Category breakdown
- Saving suggestions
- Recurring payments detected

---

## Troubleshooting

### Low confidence categorizations

If many transactions are marked "low confidence":
1. Add more patterns to your MerchantMap sheet
2. Check that merchant names are being extracted correctly
3. Consider upgrading to a better AI model

### Family transfers not detected

- Ensure family names are in `FAMILY_PATTERNS`
- Check that names match what appears in SMS (exact match, lowercase)

### Schema mismatch

If you see errors after upgrading:
1. The GAS will auto-add new columns to existing sheets
2. If issues persist, manually add headers: Category, Subcategory, Confidence, Context

---

## Future Enhancements

Possible additions:
- [ ] Budget targets per category with alerts
- [ ] Email/push notifications for anomalies
- [ ] Voice input via Siri for manual transactions
- [ ] Receipt photo OCR integration
- [ ] Shared family expense tracking
- [ ] Investment tracking integration
