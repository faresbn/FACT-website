# iOS Shortcut Setup for FACT/Flow SMS Capture

Replace the Google Apps Script (GAS) SMS forwarding with a native iOS Shortcut that runs locally on your iPhone.

---

## Prerequisites

1. An API key generated from FACT/Flow Settings > API Keys
2. The Shortcuts app on your iPhone (pre-installed on iOS 13+)

---

## Shortcut Setup (Step-by-Step)

### Create a New Shortcut

1. Open the **Shortcuts** app
2. Tap **+** to create a new shortcut
3. Name it **"FACT SMS"**

### Add Actions (in order)

#### Action 1: Receive Input
- **Receive** → "Shortcut Input" from **Share Sheet**
- Show in Share Sheet: **ON**
- Accept Types: **Text**

#### Action 2: Get Text from Input
- Search for **"Get Text from Input"**
- Set input to **Shortcut Input**

#### Action 3: Get Contents of URL (API Call)
- Search for **"Get Contents of URL"**
- URL: `https://fihxypjmvizgwinozjsf.supabase.co/functions/v1/flow-sms`
- Method: **POST**
- Headers:
  - `Content-Type`: `application/json`
- Request Body (JSON):
  ```json
  {
    "key": "YOUR_API_KEY_HERE",
    "sms": "<Text from Input>",
    "timestamp": "<Current Date (ISO 8601)>"
  }
  ```
  - For `sms`: tap the variable and select "Text from Input"
  - For `timestamp`: add a **Date** action set to Current Date, format ISO 8601

#### Action 4: Get Dictionary Value
- Get **"success"** from **Contents of URL**

#### Action 5: If (Success Check)
- **If** → Dictionary Value **is** true
- **Show Notification**: "Transaction saved"
- **Otherwise**:
- **Show Notification**: "Failed to save transaction"

### Enable Automation

1. Go to **Shortcuts** → **Automation** tab
2. Tap **+** → **Personal Automation**
3. Select **Message** trigger
4. Sender: **QNB** (or your bank's sender name)
5. Contains: leave empty (triggers on all QNB messages)
6. Run Immediately: **ON** (no confirmation needed)
7. Action: **Run Shortcut** → select "FACT SMS"
8. Pass **Message Body** as input

---

## Batch Mode

For sending multiple SMS at once (e.g., after being offline):

```json
{
  "key": "YOUR_API_KEY_HERE",
  "entries": [
    { "sms": "First SMS text...", "timestamp": "2026-01-15T10:30:00Z" },
    { "sms": "Second SMS text...", "timestamp": "2026-01-15T14:45:00Z" }
  ]
}
```

The `entries[]` array lets you batch-send multiple transactions in a single API call.

---

## API Reference

**Endpoint**: `POST https://fihxypjmvizgwinozjsf.supabase.co/functions/v1/flow-sms`

**Authentication**: API key (generated in Settings)

**Single SMS**:
```json
{
  "key": "flow_abc123...",
  "sms": "Your QNB A/C **1234 Debit Card Purchase of QAR 45.00 at LULU HYPERMARKET on 15/01/2026",
  "timestamp": "2026-01-15T10:30:00+03:00"
}
```

**Response**:
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

**Possible fates**: `appended` (saved), `skipped` (duplicate or informational SMS), `error`

---

## Troubleshooting

- **"Invalid key"**: Regenerate your API key in Settings > API Keys
- **"skipped/Duplicate"**: The same SMS was already processed (idempotency check)
- **"skipped/skip=true"**: The SMS was informational (balance alert, OTP, promo)
- **Notification not showing**: Check Shortcuts notification permissions in iOS Settings
