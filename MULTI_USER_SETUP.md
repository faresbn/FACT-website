# Multi-User Setup Guide for QNB Tracker

This document explains how to set up multi-user access for the QNB spending tracker.

## Overview

The multi-user system works by:
1. Each user has their own Google Sheet with their financial data
2. Users access their dashboard via URL parameter: `track_spend.html?u=username`
3. The iOS Shortcut sends data to the GAS which routes it to the correct user's sheet
4. Local categorizations are stored per-user in the browser

---

## Frontend Changes (Already Implemented)

The `track_spend.html` file now supports:

```javascript
// Users are mapped to their Google Sheet IDs
USER_SHEETS: {
    'fares': '1LLpl1sH7LHqD3u3ZU4JWZJtvcHD_SGFql76llyfAIBw',
    'alice': 'SHEET_ID_FOR_ALICE',
    'bob': 'SHEET_ID_FOR_BOB',
    // Add more users as needed
}
```

- Access via: `https://www.fact.qa/track_spend.html?u=fares`
- Each user's local mappings are stored separately
- Default (no parameter) uses the original sheet

---

## Google Apps Script Changes Required

### Option A: Single GAS Deployment (Recommended)

Update your existing GAS to route based on user parameter:

```javascript
// Add at the top of your GAS file
const USER_SHEET_IDS = {
  'fares': '1LLpl1sH7LHqD3u3ZU4JWZJtvcHD_SGFql76llyfAIBw',
  'alice': 'ALICE_SHEET_ID_HERE',
  'bob': 'BOB_SHEET_ID_HERE'
  // Add more users as needed
};

// Modify the doPost function to accept user parameter
function doPost(e) {
  const debugLog = [];
  const log_ = (msg, data) => {
    debugLog.push({ step: debugLog.length + 1, msg, data: data ?? null, ts: new Date().toISOString() });
  };

  log_("doPost started");

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    log_("Failed to acquire lock");
    return json_({ result: "error", error: "Server busy", debug: debugLog });
  }

  log_("Lock acquired");

  try {
    if (!e || !e.postData?.contents) {
      log_("No POST body contents");
      return json_({ result: "error", error: "Missing POST body", debug: debugLog });
    }

    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
      log_("Payload parsed", { keys: Object.keys(payload), hasUser: !!payload.user });
    } catch (parseErr) {
      return json_({ result: "error", error: "Invalid JSON: " + parseErr.message, debug: debugLog });
    }

    // NEW: Get user-specific sheet ID
    const userId = (payload.user || 'fares').toLowerCase();
    const SHEET_ID = USER_SHEET_IDS[userId];

    if (!SHEET_ID) {
      log_("Unknown user", { userId });
      return json_({ result: "error", error: "Unknown user: " + userId, debug: debugLog });
    }

    log_("User identified", { userId, sheetId: SHEET_ID.slice(0, 10) + '...' });

    // ... rest of the existing code, using SHEET_ID variable ...
```

### iOS Shortcut Update

Update your iOS Shortcut to include the user parameter:

```json
{
  "user": "fares",
  "sms": "Your credit card has been used...",
  "timestamp": "2025-01-30T10:30:00Z"
}
```

---

## Google Sheets Setup

For each new user:

### 1. Create Their Sheet

1. Create a new Google Spreadsheet
2. Create a sheet named `RawLedger` with headers:
   ```
   Timestamp | Amount | Currency | Counterparty | Card | Direction | TxnType | RawText
   ```
3. Create a sheet named `MerchantMap` with headers:
   ```
   Pattern | DisplayName | ConsolidatedName | Category
   ```
4. Create a sheet named `FXRates` with:
   ```
   USD | 3.65
   EUR | 3.95
   GBP | 4.60
   SAR | 0.97
   ```

### 2. Set Sharing Permissions

**Important for privacy:** Each user's sheet should be:
- Shared with the GAS service account (for write access)
- Published to web as CSV (for read access from the dashboard)
- NOT shared with other users

To publish as CSV:
1. File > Share > Publish to web
2. Select each sheet (RawLedger, MerchantMap, FXRates)
3. Choose CSV format
4. Publish

### 3. Add to Configuration

Add the new user's sheet ID to both:
- `track_spend.html` → `USER_SHEETS` object
- Your GAS → `USER_SHEET_IDS` object

---

## Security Considerations

### Current Model (URL-based access)
- Simple but not secure for sensitive data
- Anyone with the URL parameter can view the data
- Suitable for personal use where URL is kept private

### Enhanced Security Options

#### Option 1: Password Protection
Add a simple password check:
```javascript
const USER_PASSWORDS = {
  'fares': 'hashedPassword123',
  'alice': 'hashedPasswordABC'
};

function checkAccess() {
  const user = getCurrentUser();
  const storedAuth = localStorage.getItem(`auth_${user}`);
  if (!storedAuth || storedAuth !== USER_PASSWORDS[user]) {
    // Show login modal
    return false;
  }
  return true;
}
```

#### Option 2: Google Sign-In
Integrate Google OAuth for proper authentication. This requires:
- Setting up Google Cloud project
- Implementing OAuth flow
- Checking email matches authorized users

---

## Category Structure

The tracker now uses a hierarchical category system:

| Parent Category | Subcategories |
|----------------|---------------|
| **Essentials** | Groceries, Bills, Health, Transport |
| **Lifestyle** | Dining, Delivery, Bars & Hotels, Shopping |
| **Growth** | Hobbies, Travel, Family |
| **Financial** | Transfers |
| **Other** | Other, Uncategorized |

Update your `MerchantMap` sheet categories to use these subcategories. The parent grouping happens automatically in the UI.

---

## Troubleshooting

### "Unknown user" error
- Verify the user exists in both `USER_SHEETS` (frontend) and `USER_SHEET_IDS` (GAS)
- Check the URL parameter: `?u=username` (lowercase)

### Data not syncing
- Verify the sheet is published to web
- Check the sheet ID is correct
- Ensure the sheet names are exactly: `RawLedger`, `MerchantMap`, `FXRates`

### SMS not being logged
- Check the GAS execution logs
- Verify the iOS Shortcut includes `"user": "username"` in the JSON
- Ensure the GAS has access to the user's sheet
