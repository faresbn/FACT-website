// ============== SUPABASE FORWARDING ==============

/**
 * Fire-and-forget: forward raw SMS to Supabase flow-sms edge function.
 * Failures are logged but never block the GSheet pipeline.
 */
function forwardToSupabase_(entries, userId) {
  try {
    var props = PropertiesService.getScriptProperties();
    var apiKey = props.getProperty('SUPABASE_FLOW_SMS_KEY');
    var supabaseUrl = props.getProperty('SUPABASE_FLOW_SMS_URL');

    if (!apiKey || !supabaseUrl) {
      Logger.log('Supabase forwarding skipped: missing config');
      return;
    }

    // Always use current server time — the trigger's timestamp is unreliable (wrong timezone)
    var now = new Date().toISOString();
    var payload = {
      key: apiKey,
      entries: entries.map(function(e) {
        return {
          sms: e.sms || '',
          timestamp: now
        };
      })
    };

    UrlFetchApp.fetch(supabaseUrl, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    Logger.log('Supabase forwarding OK: ' + entries.length + ' entries');
  } catch (err) {
    Logger.log('Supabase forwarding failed (non-blocking): ' + err.message);
  }
}

// ============== SMS INGESTION ==============

function handleSMSIngestion_(e, payload) {
  const debugLog = [];
  const log_ = (msg, data) => {
    debugLog.push({ step: debugLog.length + 1, msg, data: data ?? null, ts: new Date().toISOString() });
  };

  log_("SMS ingestion started - Enhanced v6");

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    log_("Failed to acquire lock");
    return json_({ result: "error", error: "Server busy", debug: debugLog });
  }

  log_("Lock acquired");

  try {
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

    // Use spreadsheet timezone for consistent timestamps
    const tz = ss.getSpreadsheetTimeZone ? ss.getSpreadsheetTimeZone() : Session.getScriptTimeZone();
    const tzOffsetMinutes = getTimezoneOffsetMinutes_(tz);

    // --- SUPABASE FORWARDING (fire-and-forget, uses server time) ---
    try {
      forwardToSupabase_(entries, userId);
      log_("Supabase forwarding dispatched", { count: entries.length });
    } catch (supaErr) {
      log_("Supabase forwarding error (non-blocking)", { error: supaErr.message });
    }
    // --- END SUPABASE FORWARDING ---

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

      // Use server time — the trigger's timestamp is unreliable (wrong timezone)
      const ts = new Date();
      const txnContext = extractTimeContext_(ts.toISOString());
      entryLog.timestamp = ts;
      entryLog.context = txnContext;

      // Idempotency check: hash of key fields
      const idempotencyKey = generateIdempotencyKey_(sms, ts, tz);
      if (isDuplicateEntry_(sheet, idempotencyKey, log_)) {
        entryLog.fate = "skipped";
        entryLog.reason = "Duplicate (idempotency check)";
        entryLogs.push(entryLog);
        skipped++;
        continue;
      }

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

      // Legacy dedupe check
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

      // Append to sheet
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

// ============== IDEMPOTENCY ==============

function generateIdempotencyKey_(sms, timestamp, timeZone) {
  // Create a hash-like key from SMS content + timestamp (rounded to minute)
  const tsMinute = normaliseMinute_(timestamp, timeZone);
  const content = sms.replace(/\s+/g, '').toLowerCase().slice(0, 100);
  return Utilities.base64Encode(Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    content + tsMinute
  ));
}

function normaliseMinute_(timestamp, timeZone) {
  try {
    const tz = timeZone || Session.getScriptTimeZone();
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (!isNaN(date.getTime())) {
      return Utilities.formatDate(date, tz, "yyyy-MM-dd'T'HH:mm");
    }
  } catch (_) {}
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm");
}

function isDuplicateEntry_(sheet, idempotencyKey, log_) {
  const cache = CacheService.getScriptCache();
  const cacheKey = `idem_${idempotencyKey}`;

  if (cache.get(cacheKey)) {
    log_("Idempotency cache hit", { key: idempotencyKey.slice(0, 8) });
    return true;
  }

  // Store in cache for 1 hour to prevent rapid duplicates
  cache.put(cacheKey, '1', 3600);
  return false;
}


// ============== TIME & CONTEXT ==============

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

// ============== MERCHANT PATTERNS ==============

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

// ============== AI EXTRACTION ==============

function extractWithContext_(sms, timeContext, merchantPatterns, familyPatterns, debugLog) {
  const log_ = (msg, data) => {
    if (debugLog) debugLog.push({ step: debugLog.length + 1, msg, data: data ?? null, ts: new Date().toISOString() });
  };

  const apiKey = PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY");
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY in Script Properties");

  // Build context hints for the AI
  const contextHints = buildContextHints_(sms, timeContext, merchantPatterns, familyPatterns);
  const systemPrompt = buildEnhancedPrompt_(contextHints);

  // First attempt with cost-effective model
  let result = callExtractionAPI_(sms, timeContext, systemPrompt, CONFIG.AI_MODEL_SMS, apiKey, log_);

  // Retry with premium model if low confidence or uncategorized
  const needsRetry = !result.skip && (
    result.confidence === 'low' ||
    result.subcategory === 'Uncategorized' ||
    result.subcategory === 'Other'
  );

  if (needsRetry) {
    log_("Low confidence or uncategorized - retrying with premium model", {
      confidence: result.confidence,
      subcategory: result.subcategory,
      retryModel: CONFIG.AI_MODEL_SMS_RETRY
    });

    const retryResult = callExtractionAPI_(sms, timeContext, systemPrompt, CONFIG.AI_MODEL_SMS_RETRY, apiKey, log_);

    // Use retry result if it's better (higher confidence or more specific category)
    const confidenceRank = { 'high': 3, 'medium': 2, 'low': 1 };
    const retryBetter = (
      confidenceRank[retryResult.confidence] > confidenceRank[result.confidence] ||
      (retryResult.subcategory !== 'Uncategorized' && retryResult.subcategory !== 'Other' &&
       (result.subcategory === 'Uncategorized' || result.subcategory === 'Other'))
    );

    if (retryBetter) {
      log_("Using retry result", { newConfidence: retryResult.confidence, newSubcategory: retryResult.subcategory });
      result = retryResult;
      result.wasRetried = true;
      result.originalConfidence = result.confidence;
    } else {
      log_("Keeping original result (retry not better)");
    }
  }

  return result;
}

// Helper function to call the extraction API
function callExtractionAPI_(sms, timeContext, systemPrompt, model, apiKey, log_) {
  const url = "https://api.openai.com/v1/responses";

  const body = {
    model: model,
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

  log_("AI request", { model: model });

  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + apiKey },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  const status = res.getResponseCode();
  const txt = res.getContentText();

  log_("AI response", { model: model, status, length: txt.length });

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
        log_("Old schema detected - inserting new columns before RawText");
        // Insert new columns after TxnType (col 7) to keep RawText at the end
        sheet.insertColumnsAfter(7, 4);
        sheet.getRange(1, 8, 1, 4).setValues([["Category", "Subcategory", "Confidence", "Context"]]);
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
  return finder.findNext() !== null;
}

// ============== TIMESTAMP UTILITIES ==============

function getTimezoneOffsetMinutes_(timeZone) {
  try {
    const tz = timeZone || Session.getScriptTimeZone();
    const offset = Utilities.formatDate(new Date(), tz, "Z"); // e.g. +0300
    const sign = offset.startsWith("-") ? -1 : 1;
    const hours = parseInt(offset.slice(1, 3), 10);
    const minutes = parseInt(offset.slice(3, 5), 10);
    return sign * (hours * 60 + minutes);
  } catch (_) {
    return 180; // Default to Qatar (UTC+3)
  }
}

function parseNaiveTimestamp_(value, tzOffsetMinutes) {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;

  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const hour = parseInt(m[4] || "0", 10);
  const minute = parseInt(m[5] || "0", 10);
  const second = parseInt(m[6] || "0", 10);

  const offset = (tzOffsetMinutes || 0) * 60 * 1000;
  const utcMs = Date.UTC(year, month, day, hour, minute, second) - offset;
  return new Date(utcMs);
}

function hasTimezoneInfo_(value) {
  return /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
}

function normaliseIso_(maybeTs, tzOffsetMinutes) {
  try {
    if (maybeTs instanceof Date) return maybeTs;
    if (typeof maybeTs === "number") return new Date(maybeTs);

    if (typeof maybeTs === "string" && maybeTs.trim()) {
      const s = maybeTs.trim();
      if (hasTimezoneInfo_(s)) {
        const d = new Date(s);
        if (!isNaN(d.getTime())) return d;
      }

      const naive = parseNaiveTimestamp_(s, tzOffsetMinutes);
      if (naive && !isNaN(naive.getTime())) return naive;

      const d = new Date(s);
      if (!isNaN(d.getTime())) return d;
      return new Date();
    }
  } catch (_) {}

  return new Date();
}
