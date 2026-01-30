/**
 * QNB SMS -> RawLedger (Google Sheet) — v5 ENHANCED
 *
 * Enhanced with:
 * - Contextual AI categorization using GPT-4.1 (upgradeable to GPT-5.1/o3)
 * - Multi-user support
 * - Time/day/amount context inference
 * - Pattern learning from MerchantMap
 * - Smarter category suggestions
 * - Transaction anomaly detection
 */

// ============== CONFIGURATION ==============

const CONFIG = {
  // Model selection - upgrade as needed
  // Options: 'gpt-4.1-nano' (fast), 'gpt-4.1-mini' (balanced), 'gpt-4.1' (best), 'gpt-5.1' (cutting edge)
  AI_MODEL: 'gpt-4.1',

  // Multi-user sheet mapping
  USER_SHEETS: {
    'fares': '1LLpl1sH7LHqD3u3ZU4JWZJtvcHD_SGFql76llyfAIBw',
    // Add more users: 'username': 'SHEET_ID'
  },

  DEFAULT_USER: 'fares',

  // Category structure
  CATEGORIES: {
    'Essentials': ['Groceries', 'Bills', 'Health', 'Transport'],
    'Lifestyle': ['Dining', 'Delivery', 'Bars & Hotels', 'Shopping', 'Hobbies', 'Travel'],
    'Family': ['Family Transfers'],
    'Financial': ['Transfers', 'Fees'],
    'Other': ['Other', 'Uncategorized']
  },

  // Known family members for transfer detection (customize per user)
  FAMILY_PATTERNS: {
    'fares': ['mom', 'dad', 'brother', 'sister', 'baba', 'mama', 'ahmed', 'fatima']
    // Add patterns for each user
  }
};

// Flatten categories for validation
const ALL_CATEGORIES = Object.values(CONFIG.CATEGORIES).flat();

// ============== MAIN ENTRY POINT ==============

function doPost(e) {
  const debugLog = [];
  const log_ = (msg, data) => {
    debugLog.push({ step: debugLog.length + 1, msg, data: data ?? null, ts: new Date().toISOString() });
  };

  log_("doPost started - Enhanced v5");

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    log_("Failed to acquire lock");
    return json_({ result: "error", error: "Server busy", debug: debugLog });
  }

  log_("Lock acquired");

  try {
    if (!e?.postData?.contents) {
      log_("No POST body contents");
      return json_({ result: "error", error: "Missing POST body", debug: debugLog });
    }

    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
      log_("Payload parsed", { keys: Object.keys(payload), user: payload.user });
    } catch (parseErr) {
      return json_({ result: "error", error: "Invalid JSON: " + parseErr.message, debug: debugLog });
    }

    // Get user and their sheet
    const userId = (payload.user || CONFIG.DEFAULT_USER).toLowerCase();
    const SHEET_ID = CONFIG.USER_SHEETS[userId];

    if (!SHEET_ID) {
      log_("Unknown user", { userId });
      return json_({ result: "error", error: "Unknown user: " + userId, debug: debugLog });
    }

    log_("User identified", { userId });

    // Build entries array
    const entries = Array.isArray(payload.entries)
      ? payload.entries
      : [{ sms: payload.sms, timestamp: payload.timestamp }];

    log_("Entries to process", { count: entries.length });

    if (!entries.length || !entries[0]?.sms) {
      return json_({ result: "error", error: "No valid entries", debug: debugLog });
    }

    // Open spreadsheet
    let ss;
    try {
      ss = SpreadsheetApp.openById(SHEET_ID);
      log_("Spreadsheet opened", { name: ss.getName() });
    } catch (ssErr) {
      return json_({ result: "error", error: "Cannot open spreadsheet: " + ssErr.message, debug: debugLog });
    }

    // Find sheets
    const EXPECTED_HEADERS = ["Timestamp", "Amount", "Currency", "Counterparty", "Card", "Direction", "TxnType", "Category", "Subcategory", "Confidence", "Context", "RawText"];

    let sheet = findOrCreateSheet_(ss, "RawLedger", EXPECTED_HEADERS, log_);
    if (!sheet) {
      return json_({ result: "error", error: "Could not find or create RawLedger sheet", debug: debugLog });
    }

    // Load merchant patterns for context
    const merchantPatterns = loadMerchantPatterns_(ss, log_);
    const familyPatterns = CONFIG.FAMILY_PATTERNS[userId] || [];

    // Process entries
    let appended = 0, skipped = 0, errors = 0;
    const entryLogs = [];

    for (let i = 0; i < entries.length; i++) {
      const item = entries[i];
      const entryLog = { index: i };

      const sms = (item?.sms ?? "").toString();
      entryLog.smsPreview = sms.slice(0, 80);

      if (!sms.trim()) {
        entryLog.fate = "skipped";
        entryLog.reason = "Empty SMS";
        entryLogs.push(entryLog);
        skipped++;
        continue;
      }

      // Get timestamp with context
      const ts = normaliseIso_(item?.timestamp);
      const txnContext = extractTimeContext_(ts);
      entryLog.timestamp = ts;
      entryLog.context = txnContext;

      // AI extraction with context
      log_("Calling AI for entry " + i);
      let extracted;
      try {
        extracted = extractWithContext_(sms, txnContext, merchantPatterns, familyPatterns, debugLog);
        entryLog.aiSuccess = true;
        entryLog.extracted = extracted;
        log_("AI returned", { skip: extracted?.skip, category: extracted?.category, confidence: extracted?.confidence });
      } catch (aiErr) {
        entryLog.fate = "error";
        entryLog.reason = "AI failed";
        entryLog.aiError = aiErr.message;
        entryLogs.push(entryLog);
        errors++;
        log_("AI error", { error: aiErr.message });
        continue;
      }

      if (extracted?.skip) {
        entryLog.fate = "skipped";
        entryLog.reason = extracted.reason || "AI skip=true";
        entryLogs.push(entryLog);
        skipped++;
        continue;
      }

      // Normalize and validate
      const normalised = normaliseExtracted_(extracted, sms, txnContext);

      // RawText for dedupe
      const raw200 = (normalised.rawText ?? sms).toString().slice(0, 200);

      // Dedupe check
      if (alreadyLogged_(sheet, raw200)) {
        entryLog.fate = "skipped";
        entryLog.reason = "Duplicate";
        entryLogs.push(entryLog);
        skipped++;
        continue;
      }

      // Validation
      const valErrors = [];
      if (typeof normalised.amount !== "number" || isNaN(normalised.amount)) {
        valErrors.push("amount invalid");
      }
      if (!normalised.currency) valErrors.push("currency empty");
      if (!normalised.direction) valErrors.push("direction empty");
      if (!normalised.txnType) valErrors.push("txnType empty");

      if (valErrors.length > 0) {
        entryLog.fate = "error";
        entryLog.reason = "Validation failed";
        entryLog.validationErrors = valErrors;
        entryLogs.push(entryLog);
        errors++;
        continue;
      }

      // Append to sheet (enhanced schema)
      log_("Appending row for entry " + i);
      try {
        sheet.appendRow([
          ts,
          normalised.amount,
          normalised.currency,
          normalised.counterparty ?? "",
          normalised.card ?? "",
          normalised.direction,
          normalised.txnType,
          normalised.category,
          normalised.subcategory,
          normalised.confidence,
          JSON.stringify(normalised.context),
          raw200
        ]);
        entryLog.fate = "appended";
        entryLogs.push(entryLog);
        appended++;
      } catch (appendErr) {
        entryLog.fate = "error";
        entryLog.reason = "Append failed: " + appendErr.message;
        entryLogs.push(entryLog);
        errors++;
      }
    }

    log_("Processing complete", { appended, skipped, errors });

    return json_({
      result: "done",
      user: userId,
      wroteTo: sheet.getName(),
      received: entries.length,
      appended,
      skipped,
      errors,
      entryLogs,
      debug: debugLog
    });

  } catch (err) {
    log_("Uncaught error", { error: err.message, stack: err.stack });
    return json_({ result: "error", error: err.message, debug: debugLog });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// ============== TIME CONTEXT EXTRACTION ==============

function extractTimeContext_(isoTimestamp) {
  const date = new Date(isoTimestamp);
  const hour = date.getHours();
  const day = date.getDay(); // 0 = Sunday
  const dayOfMonth = date.getDate();

  // Time of day classification
  let timeOfDay;
  if (hour >= 5 && hour < 12) timeOfDay = 'morning';
  else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
  else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
  else timeOfDay = 'night';

  // Day classification
  const isWeekend = (day === 5 || day === 6); // Friday/Saturday in Qatar
  const isEndOfMonth = dayOfMonth >= 25;
  const isStartOfMonth = dayOfMonth <= 5;

  return {
    hour,
    timeOfDay,
    dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day],
    isWeekend,
    isEndOfMonth,
    isStartOfMonth,
    isoTimestamp
  };
}

// ============== MERCHANT PATTERN LOADING ==============

function loadMerchantPatterns_(ss, log_) {
  const patterns = [];
  try {
    const mapSheet = ss.getSheetByName("MerchantMap");
    if (!mapSheet) {
      log_("MerchantMap sheet not found");
      return patterns;
    }

    const data = mapSheet.getDataRange().getValues();
    // Skip header row
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[0] && row[3]) { // Pattern and Category
        patterns.push({
          pattern: String(row[0]).toLowerCase(),
          displayName: row[1] || row[0],
          consolidatedName: row[2] || row[1] || row[0],
          category: row[3]
        });
      }
    }
    log_("Loaded merchant patterns", { count: patterns.length });
  } catch (err) {
    log_("Error loading merchant patterns", { error: err.message });
  }
  return patterns;
}

// ============== AI EXTRACTION WITH CONTEXT ==============

function extractWithContext_(sms, timeContext, merchantPatterns, familyPatterns, debugLog) {
  const log_ = (msg, data) => {
    if (debugLog) debugLog.push({ step: debugLog.length + 1, msg, data: data ?? null, ts: new Date().toISOString() });
  };

  const apiKey = PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY");
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY in Script Properties");

  // Build context hints for the AI
  const contextHints = buildContextHints_(sms, timeContext, merchantPatterns, familyPatterns);

  const systemPrompt = buildEnhancedPrompt_(contextHints);

  const url = "https://api.openai.com/v1/responses";

  const body = {
    model: CONFIG.AI_MODEL,
    instructions: systemPrompt,
    input: `Extract and categorize this QNB SMS transaction:\n\n${sms}\n\nTransaction Context:\n- Time: ${timeContext.timeOfDay} (${timeContext.hour}:00)\n- Day: ${timeContext.dayOfWeek}\n- Weekend: ${timeContext.isWeekend}\n- Month timing: ${timeContext.isStartOfMonth ? 'start of month' : timeContext.isEndOfMonth ? 'end of month' : 'mid-month'}`,
    text: {
      format: {
        type: "json_schema",
        name: "qnb_txn_enhanced",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            skip: { type: "boolean", description: "True if not a real money movement transaction" },
            reason: { type: "string", description: "Why skipped, or empty string" },
            amount: { type: "number" },
            currency: { type: "string" },
            counterparty: { type: "string", description: "Merchant name or transfer recipient" },
            direction: { type: "string", enum: ["IN", "OUT"] },
            txnType: { type: "string", enum: ["Purchase", "Fawran", "Transfer", "Received", "Fee", "Salary"] },
            card: { type: "string" },
            category: {
              type: "string",
              enum: ["Essentials", "Lifestyle", "Family", "Financial", "Other"],
              description: "Parent category"
            },
            subcategory: {
              type: "string",
              enum: ALL_CATEGORIES,
              description: "Specific subcategory"
            },
            confidence: {
              type: "string",
              enum: ["high", "medium", "low"],
              description: "How confident are you in the categorization?"
            },
            reasoning: {
              type: "string",
              description: "Brief explanation of why you chose this category"
            },
            rawText: { type: "string" }
          },
          required: ["skip", "reason", "amount", "currency", "counterparty", "direction", "txnType", "card", "category", "subcategory", "confidence", "reasoning", "rawText"]
        }
      }
    }
  };

  log_("AI request", { model: CONFIG.AI_MODEL, contextHints: contextHints.length });

  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + apiKey },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  const status = res.getResponseCode();
  const txt = res.getContentText();

  log_("AI response", { status, length: txt.length });

  if (status < 200 || status >= 300) {
    throw new Error("AI HTTP " + status + ": " + txt.slice(0, 300));
  }

  const parsed = JSON.parse(txt);

  if (parsed.output_text) {
    return JSON.parse(parsed.output_text);
  }

  const messageItem = parsed?.output?.find(item => item.type === "message");
  if (!messageItem?.content) {
    throw new Error("No message in AI output");
  }

  const textContent = messageItem.content.find(c => c.type === "output_text");
  if (!textContent?.text) {
    throw new Error("No text in AI message");
  }

  return JSON.parse(textContent.text);
}

// ============== CONTEXT HINTS BUILDER ==============

function buildContextHints_(sms, timeContext, merchantPatterns, familyPatterns) {
  const hints = [];
  const smsLower = sms.toLowerCase();

  // Check for known merchant patterns
  for (const pattern of merchantPatterns) {
    if (smsLower.includes(pattern.pattern)) {
      hints.push(`Known merchant: "${pattern.displayName}" is usually categorized as ${pattern.category}`);
      break;
    }
  }

  // Check for family-related transfers
  for (const familyName of familyPatterns) {
    if (smsLower.includes(familyName.toLowerCase())) {
      hints.push(`Family member detected: "${familyName}" - likely a Family Transfer`);
      break;
    }
  }

  // Time-based hints
  if (timeContext.timeOfDay === 'morning' && timeContext.hour >= 6 && timeContext.hour <= 9) {
    hints.push("Morning transaction (6-9am) - could be coffee/breakfast");
  }
  if (timeContext.timeOfDay === 'evening' && timeContext.isWeekend) {
    hints.push("Weekend evening - higher likelihood of social/entertainment spending");
  }
  if (timeContext.isStartOfMonth) {
    hints.push("Start of month - watch for rent, subscriptions, salary");
  }
  if (timeContext.isEndOfMonth) {
    hints.push("End of month - watch for bill payments");
  }

  // Amount-based hints (extract from SMS if possible)
  const amountMatch = sms.match(/Amount:\s*(?:QAR|USD|EUR|GBP)?\s*([\d,]+\.?\d*)/i);
  if (amountMatch) {
    const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
    if (amount > 1000) {
      hints.push(`Large transaction (${amount}) - could be travel, electronics, or family transfer`);
    } else if (amount < 50) {
      hints.push(`Small transaction (${amount}) - likely food/coffee/transport`);
    }
  }

  return hints;
}

// ============== ENHANCED AI PROMPT ==============

function buildEnhancedPrompt_(contextHints) {
  let prompt = `You are an intelligent financial categorization assistant for QNB (Qatar National Bank) SMS transactions.

GOAL: Extract transaction data AND intelligently categorize based on context.

CATEGORY STRUCTURE:
- Essentials (must-pay): Groceries, Bills, Health, Transport
- Lifestyle (discretionary): Dining, Delivery, Bars & Hotels, Shopping, Hobbies, Travel
- Family (family money flow): Family Transfers
- Financial (money movement): Transfers, Fees
- Other: Other, Uncategorized

TRANSACTION DETECTION:
- Purchase (OUT): "has been used for a purchase" → Analyze merchant for category
- Fawran (OUT): "using Fawran" → Check recipient name for family vs other
- Transfer (OUT): "Funds were transferred" → Check if to family member
- Received (IN): "fund transfer to your account" → Check if from family
- Salary (IN): "Your salary is credited" → Financial > Transfers
- Fee (OUT): Service charges, ATM fees → Financial > Fees

SKIP these (not real transactions):
- OTP codes, login alerts, marketing, declined transactions, balance inquiries

CATEGORIZATION INTELLIGENCE:
1. Use merchant name to infer category:
   - Restaurants/cafes → Lifestyle > Dining
   - Supermarkets → Essentials > Groceries
   - Gas stations → Essentials > Transport
   - Hotels → Lifestyle > Bars & Hotels
   - Airlines/travel agencies → Lifestyle > Travel
   - Pharmacies/clinics → Essentials > Health

2. Use amount as a hint:
   - Very small (<20 QAR): Often transport, coffee
   - Small (20-100 QAR): Often food, delivery
   - Medium (100-500 QAR): Dining, shopping
   - Large (500+): Travel, electronics, family transfers

3. Use time context:
   - Morning: Coffee, breakfast, transport
   - Lunch time: Dining, delivery
   - Evening weekend: Social, entertainment

4. For transfers:
   - Check counterparty name against common family names
   - If unclear, mark as Financial > Transfers with medium confidence`;

  if (contextHints.length > 0) {
    prompt += `\n\nCONTEXT HINTS FOR THIS TRANSACTION:\n${contextHints.map(h => '- ' + h).join('\n')}`;
  }

  prompt += `\n
CONFIDENCE LEVELS:
- high: Clear merchant/category match, known pattern
- medium: Reasonable inference but could be wrong
- low: Guessing based on limited info

IMPORTANT:
- Always provide reasoning for your categorization
- If genuinely uncertain, use "Uncategorized" with low confidence
- Prefer specific subcategories over generic ones`;

  return prompt;
}

// ============== NORMALISATION ==============

function normaliseExtracted_(extracted, sms, timeContext) {
  const out = Object.assign({}, extracted);
  const smsLower = sms.toLowerCase();

  // Salary handling
  if (smsLower.includes("your salary is credited") || smsLower.includes("salary amount:")) {
    out.direction = "IN";
    out.txnType = "Salary";
    out.counterparty = "SALARY";
    out.card = "SALARY";
    out.category = "Financial";
    out.subcategory = "Transfers";
    out.confidence = "high";
  }

  // Set card for transfers
  if (out.txnType === "Transfer" || out.txnType === "Received" || out.txnType === "Fawran") {
    if (out.category === "Family") {
      out.card = "FAMILY";
    } else {
      out.card = "TRANSFER";
    }
  }

  // Clean up
  if (typeof out.counterparty === "string" && !out.counterparty.trim()) {
    out.counterparty = null;
  }
  if (!out.rawText) out.rawText = sms;

  // Add context
  out.context = {
    timeOfDay: timeContext.timeOfDay,
    dayOfWeek: timeContext.dayOfWeek,
    isWeekend: timeContext.isWeekend,
    reasoning: out.reasoning || ''
  };

  return out;
}

// ============== HELPERS ==============

function findOrCreateSheet_(ss, sheetName, headers, log_) {
  let sheet = ss.getSheetByName(sheetName);

  if (sheet) {
    // Verify headers
    const row1 = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    const headersOk = headers.every((h, i) => String(row1[i] ?? "").trim() === h);

    if (!headersOk) {
      log_("Headers mismatch, checking if old schema");
      // Check if it's the old schema (8 columns)
      const oldHeaders = ["Timestamp", "Amount", "Currency", "Counterparty", "Card", "Direction", "TxnType", "RawText"];
      const isOldSchema = oldHeaders.every((h, i) => String(row1[i] ?? "").trim() === h);

      if (isOldSchema) {
        log_("Old schema detected - adding new columns");
        // Add new columns: Category, Subcategory, Confidence, Context
        sheet.getRange(1, 8, 1, 4).setValues([["Category", "Subcategory", "Confidence", "Context"]]);
        // Move RawText to the end
        // Actually, let's just append the new columns after RawText for backwards compatibility
        sheet.getRange(1, 9, 1, 4).setValues([["Category", "Subcategory", "Confidence", "Context"]]);
      }
    }
    return sheet;
  }

  // Create new sheet
  log_("Creating new RawLedger sheet");
  sheet = ss.insertSheet(sheetName);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}

function alreadyLogged_(sheet, rawText200) {
  // Search in the RawText column (last column)
  const lastCol = sheet.getLastColumn();
  const finder = sheet.getRange(1, lastCol, sheet.getLastRow(), 1).createTextFinder(rawText200);
  finder.matchEntireCell(true);
  return !!finder.findNext();
}

function normaliseIso_(maybeTs) {
  try {
    if (typeof maybeTs === "string" && maybeTs.trim()) {
      const d = new Date(maybeTs);
      if (!isNaN(d.getTime())) return d.toISOString().replace(/\.\d{3}Z$/, "");
      return maybeTs.trim().slice(0, 32);
    }
  } catch (_) {}
  return new Date().toISOString().replace(/\.\d{3}Z$/, "");
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============== BATCH ANALYSIS (Run weekly/monthly) ==============

/**
 * Analyze recent transactions and generate insights
 * Set up a time-based trigger to run this weekly
 */
function analyzeRecentTransactions() {
  const userId = CONFIG.DEFAULT_USER;
  const SHEET_ID = CONFIG.USER_SHEETS[userId];
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("RawLedger");

  if (!sheet) {
    Logger.log("RawLedger not found");
    return;
  }

  // Get last 30 days of transactions
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentTxns = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const timestamp = new Date(row[0]);
    if (timestamp >= thirtyDaysAgo) {
      recentTxns.push({
        timestamp: row[0],
        amount: row[1],
        currency: row[2],
        counterparty: row[3],
        direction: row[5],
        category: row[7] || 'Uncategorized',
        subcategory: row[8] || 'Other'
      });
    }
  }

  if (recentTxns.length === 0) {
    Logger.log("No recent transactions");
    return;
  }

  // Generate insights using AI
  const insights = generateInsights_(recentTxns);
  Logger.log("Insights:\n" + insights);

  // Optionally save to a sheet or send via email
  saveInsights_(ss, insights);
}

function generateInsights_(transactions) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY");
  if (!apiKey) return "Missing API key";

  const txnSummary = transactions.map(t =>
    `${t.timestamp}: ${t.direction} ${t.amount} ${t.currency} @ ${t.counterparty} (${t.subcategory})`
  ).join('\n');

  const prompt = `Analyze these personal finance transactions from the last 30 days and provide:
1. Spending patterns and trends
2. Unusual or anomalous transactions
3. Category breakdown summary
4. Actionable suggestions for saving money
5. Recurring payments detected

Keep it concise and actionable.

Transactions:
${txnSummary}`;

  const url = "https://api.openai.com/v1/responses";
  const body = {
    model: CONFIG.AI_MODEL,
    input: prompt
  };

  try {
    const res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + apiKey },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });

    const parsed = JSON.parse(res.getContentText());
    return parsed.output_text || parsed.output?.[0]?.content?.[0]?.text || "No insights generated";
  } catch (err) {
    return "Error generating insights: " + err.message;
  }
}

function saveInsights_(ss, insights) {
  let insightSheet = ss.getSheetByName("Insights");
  if (!insightSheet) {
    insightSheet = ss.insertSheet("Insights");
    insightSheet.getRange(1, 1, 1, 2).setValues([["Date", "Insights"]]);
  }

  insightSheet.appendRow([new Date().toISOString(), insights]);
}

// ============== RECATEGORIZATION LEARNING ==============

/**
 * Call this when user manually recategorizes a transaction
 * It updates the MerchantMap for future auto-categorization
 */
function learnFromRecategorization(counterparty, newCategory, newSubcategory) {
  const userId = CONFIG.DEFAULT_USER;
  const SHEET_ID = CONFIG.USER_SHEETS[userId];
  const ss = SpreadsheetApp.openById(SHEET_ID);

  let mapSheet = ss.getSheetByName("MerchantMap");
  if (!mapSheet) {
    mapSheet = ss.insertSheet("MerchantMap");
    mapSheet.getRange(1, 1, 1, 4).setValues([["Pattern", "DisplayName", "ConsolidatedName", "Category"]]);
  }

  // Check if pattern already exists
  const data = mapSheet.getDataRange().getValues();
  const counterpartyLower = counterparty.toLowerCase();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toLowerCase() === counterpartyLower) {
      // Update existing
      mapSheet.getRange(i + 1, 4).setValue(newSubcategory);
      Logger.log(`Updated ${counterparty} to ${newSubcategory}`);
      return;
    }
  }

  // Add new pattern
  mapSheet.appendRow([counterpartyLower, counterparty, counterparty, newSubcategory]);
  Logger.log(`Added new pattern: ${counterparty} -> ${newSubcategory}`);
}

// ============== TEST FUNCTIONS ==============

function testEnhancedExtraction() {
  const sms = `Your credit card has been used for a purchase.
Details:
Card number: VISA2
Amount: QAR 85
Location: STARBUCKS COFFEE
Available balance: QAR 1500.
In case the transaction is suspicious
Please Call 44407711`;

  const timeContext = extractTimeContext_(new Date().toISOString());
  const debugLog = [];

  Logger.log("=== Testing Enhanced Extraction ===");
  Logger.log("Time context: " + JSON.stringify(timeContext));

  try {
    const result = extractWithContext_(sms, timeContext, [], [], debugLog);
    Logger.log("Result: " + JSON.stringify(result, null, 2));
    Logger.log("Category: " + result.category + " > " + result.subcategory);
    Logger.log("Confidence: " + result.confidence);
    Logger.log("Reasoning: " + result.reasoning);
  } catch (err) {
    Logger.log("Error: " + err.message);
  }
}

function testFamilyTransfer() {
  const sms = `Funds were transferred from your account using Fawran.
Details:
Amount: QAR 500
To: Ahmed (family)
Reference: Monthly support
Available balance: QAR 3000.`;

  const timeContext = extractTimeContext_(new Date().toISOString());
  const familyPatterns = ['ahmed', 'fatima', 'mom', 'dad'];
  const debugLog = [];

  Logger.log("=== Testing Family Transfer Detection ===");

  try {
    const result = extractWithContext_(sms, timeContext, [], familyPatterns, debugLog);
    Logger.log("Result: " + JSON.stringify(result, null, 2));
    Logger.log("Should be Family > Family Transfers");
    Logger.log("Actual: " + result.category + " > " + result.subcategory);
  } catch (err) {
    Logger.log("Error: " + err.message);
  }
}
