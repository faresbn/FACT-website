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
 * - Frontend AI proxy endpoint (doGet for queries)
 */

// ============== CONFIGURATION ==============

const CONFIG = {
  // ============== TIERED AI MODEL STRATEGY ==============
  // Only using: gpt-4.1-mini, gpt-4.1, gpt-5-mini, gpt-5.1
  // SMS Parsing: gpt-4.1-mini (reliable, cost-effective for high volume)
  // Retry on low confidence: gpt-5-mini (upgrade when needed)
  // Ask AI default: gpt-5-mini (strong feel per dollar)
  // Ask AI deep analysis: gpt-5.1 (for "why", "optimize", "forecast", etc.)
  // Batch Insights: gpt-5.1 (premium for highest value output)

  AI_MODEL_SMS: 'gpt-4.1-mini',        // SMS → JSON parsing (high volume)
  AI_MODEL_SMS_RETRY: 'gpt-5-mini',    // Retry when confidence=low or Uncategorized
  AI_MODEL_FRONTEND: 'gpt-5-mini',     // Ask AI default
  AI_MODEL_FRONTEND_DEEP: 'gpt-5.1',   // Ask AI for deep analysis queries
  AI_MODEL_INSIGHTS: 'gpt-5.1',        // Batch insights (best quality)

  // Model capabilities - which models support custom temperature
  MODEL_SUPPORTS_TEMPERATURE: {
    'gpt-4.1-mini': true,
    'gpt-4.1': true,
    'gpt-5-mini': false,  // Only supports temperature=1
    'gpt-5.1': false      // Only supports temperature=1
  },

  // Keywords that trigger deep analysis mode
  DEEP_ANALYSIS_KEYWORDS: [
    'why', 'optimize', 'forecast', 'anomaly', 'anomalies', 'plan',
    'predict', 'trend', 'pattern', 'analyze', 'analysis', 'deep',
    'detail', 'explain', 'insight', 'recommend', 'suggestion', 'budget'
  ],

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

// ============== SESSION TOKEN MANAGEMENT ==============

const TOKEN_EXPIRY_HOURS = 24; // Tokens valid for 24 hours

function generateToken_() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function storeSession_(username, sheetId) {
  const token = generateToken_();
  const expiry = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  const cache = CacheService.getScriptCache();

  // Store token -> session mapping (6 hour cache, refresh on use)
  cache.put(`session_${token}`, JSON.stringify({
    user: username,
    sheetId: sheetId,
    expiry: expiry
  }), 21600); // 6 hours in seconds

  return { token, expiry };
}

function validateToken_(token) {
  if (!token) return null;

  const cache = CacheService.getScriptCache();
  const sessionJson = cache.get(`session_${token}`);

  if (!sessionJson) return null;

  try {
    const session = JSON.parse(sessionJson);
    if (new Date(session.expiry) < new Date()) {
      cache.remove(`session_${token}`);
      return null;
    }
    // Refresh cache on successful validation
    cache.put(`session_${token}`, sessionJson, 21600);
    return session;
  } catch (e) {
    return null;
  }
}

// ============== GET ENDPOINT (Status only) ==============

function doGet(e) {
  // GET only for status check - all sensitive operations use POST
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'FACT Finance API v6' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============== POST ENDPOINT (Auth, AI, Data) ==============

/**
 * Secure POST endpoint for all sensitive operations
 * Actions: auth, ai, data, learn
 */
function doPost(e) {
  // Handle SMS ingestion (legacy format - no JSON body)
  if (e?.postData?.contents) {
    try {
      const payload = JSON.parse(e.postData.contents);

      // Route based on action
      if (payload.action === 'auth') {
        return handleAuthPost_(payload);
      }

      if (payload.action === 'ai') {
        return handleAIQueryPost_(payload);
      }

      if (payload.action === 'data') {
        return handleDataFetch_(payload);
      }

      if (payload.action === 'learn') {
        return handleLearnCategory_(payload);
      }

      if (payload.action === 'remember') {
        return handleRemember_(payload);
      }

      if (payload.action === 'context') {
        return handleGetContext_(payload);
      }

      // Default: SMS ingestion (existing behavior)
      return handleSMSIngestion_(e, payload);

    } catch (parseErr) {
      return json_({ error: 'Invalid JSON: ' + parseErr.message });
    }
  }

  return json_({ error: 'Missing POST body' });
}

/**
 * Secure authentication via POST
 * Returns short-lived token instead of sheetId
 */
function handleAuthPost_(payload) {
  const username = (payload.user || '').toLowerCase().trim();
  const password = payload.pass || '';

  if (!username || !password) {
    return json_({ success: false, error: 'Missing credentials' });
  }

  const props = PropertiesService.getScriptProperties();
  let users = {};

  try {
    const usersJson = props.getProperty('PULSE_USERS');
    if (usersJson) {
      users = JSON.parse(usersJson);
    }
  } catch (err) {
    return json_({ success: false, error: 'Auth config error' });
  }

  const userConfig = users[username];
  if (!userConfig) {
    return json_({ success: false, error: 'User not found' });
  }

  if (userConfig.pass !== password) {
    return json_({ success: false, error: 'Invalid password' });
  }

  // Generate session token
  const { token, expiry } = storeSession_(username, userConfig.sheetId);

  return json_({
    success: true,
    user: username,
    token: token,
    expiry: expiry,
    model: CONFIG.AI_MODEL_FRONTEND,
    modelDeep: CONFIG.AI_MODEL_FRONTEND_DEEP
  });
}

/**
 * Secure AI query via POST
 */
function handleAIQueryPost_(payload) {
  const token = payload.token;
  const query = payload.q || '';
  const txnData = payload.data || '';

  // Validate token
  const session = validateToken_(token);
  if (!session) {
    return json_({ error: 'Invalid or expired session', code: 'AUTH_REQUIRED' });
  }

  if (!query) {
    return json_({ error: 'Missing query' });
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY");
  if (!apiKey) {
    return json_({ error: 'OpenAI API key not configured' });
  }

  try {
    // Check if this is a "remember" command via natural language
    const queryLower = query.toLowerCase();
    const rememberPatterns = [
      /^remember\s+that\s+(.+)/i,
      /^note\s+that\s+(.+)/i,
      /^(salary|income).+(?:arrives?|comes?|paid).+(?:on|day)\s+(\d+)/i,
      /^(.+)\s+(?:is|handles?|books?)\s+(?:my\s+)?(.+)/i
    ];

    for (const pattern of rememberPatterns) {
      const match = query.match(pattern);
      if (match && queryLower.startsWith('remember')) {
        // Extract and save the context
        return handleRememberFromQuery_(session.sheetId, query);
      }
    }

    // Smart model selection
    const isDeepAnalysis = CONFIG.DEEP_ANALYSIS_KEYWORDS.some(kw => queryLower.includes(kw));
    const selectedModel = isDeepAnalysis ? CONFIG.AI_MODEL_FRONTEND_DEEP : CONFIG.AI_MODEL_FRONTEND;

    // Load user context for personalized responses
    const userContext = getUserContext_(session.sheetId);
    const contextPrompt = formatContextForPrompt_(userContext);

    const basePrompt = `You are a personal finance analyst. Analyze the user's spending data and answer their questions.
Be concise but insightful. Use specific numbers from the data. Format your response with markdown.
Identify patterns, anomalies, and actionable insights.

The data includes dimensions:
- merchantType: what was purchased (Groceries, Dining, Bars & Nightlife, Coffee, Shopping, etc.)
- dims.when: time context (Work Hours, Evening, Late Night, Weekend)
- dims.size: amount tier (Micro, Small, Medium, Large, Major)
- dims.pattern: detected pattern (Normal, Night Out, Work Expense, Splurge, Subscription)

${contextPrompt ? '--- USER CONTEXT ---\n' + contextPrompt + '\n--- END CONTEXT ---\n' : ''}`;

    const deepPrompt = isDeepAnalysis
      ? `\n\nDEEP ANALYSIS MODE: Provide thorough, detailed analysis. Consider:
- Root causes and underlying patterns
- Comparative analysis (week-over-week, category comparisons)
- Actionable recommendations with specific numbers
- Potential future projections based on current trends
- Risk factors and opportunities for optimization`
      : '';

    const systemPrompt = basePrompt + deepPrompt;
    const userPrompt = txnData
      ? `Here is my spending data for the selected period:\n\n${txnData}\n\nQuestion: ${query}`
      : query;

    // Build request payload - conditionally include temperature based on model support
    const requestPayload = {
      model: selectedModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_completion_tokens: isDeepAnalysis ? 2000 : 1000
    };

    // Only include temperature if the model supports it
    if (CONFIG.MODEL_SUPPORTS_TEMPERATURE[selectedModel]) {
      requestPayload.temperature = isDeepAnalysis ? 0.5 : 0.7;
    }

    const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      payload: JSON.stringify(requestPayload),
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText());

    if (result.error) {
      return json_({ error: result.error.message });
    }

    return json_({
      answer: result.choices[0].message.content,
      model: selectedModel,
      mode: isDeepAnalysis ? 'deep' : 'standard'
    });

  } catch (err) {
    return json_({ error: err.message });
  }
}

/**
 * Secure data fetch via POST - replaces direct sheet access
 */
function handleDataFetch_(payload) {
  const token = payload.token;
  const sheets = payload.sheets || ['RawLedger']; // Which sheets to fetch

  const session = validateToken_(token);
  if (!session) {
    return json_({ error: 'Invalid or expired session', code: 'AUTH_REQUIRED' });
  }

  try {
    const ss = SpreadsheetApp.openById(session.sheetId);
    const result = {};

    for (const sheetName of sheets) {
      const sheet = ss.getSheetByName(sheetName);
      if (sheet) {
        const data = sheet.getDataRange().getValues();
        result[sheetName] = data;
      }
    }

    return json_({ success: true, data: result });

  } catch (err) {
    return json_({ error: 'Failed to fetch data: ' + err.message });
  }
}

/**
 * Learn from user categorization - syncs to MerchantMap
 */
function handleLearnCategory_(payload) {
  const token = payload.token;
  const counterparty = payload.counterparty;
  const merchantType = payload.merchantType;
  const consolidated = payload.consolidated || counterparty;

  const session = validateToken_(token);
  if (!session) {
    return json_({ error: 'Invalid or expired session', code: 'AUTH_REQUIRED' });
  }

  if (!counterparty || !merchantType) {
    return json_({ error: 'Missing counterparty or merchantType' });
  }

  try {
    const ss = SpreadsheetApp.openById(session.sheetId);
    let mapSheet = ss.getSheetByName("MerchantMap");

    if (!mapSheet) {
      mapSheet = ss.insertSheet("MerchantMap");
      mapSheet.getRange(1, 1, 1, 4).setValues([["Pattern", "DisplayName", "ConsolidatedName", "MerchantType"]]);
    }

    const data = mapSheet.getDataRange().getValues();
    const counterpartyLower = counterparty.toLowerCase();

    // Check if pattern already exists
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toLowerCase() === counterpartyLower) {
        // Update existing
        mapSheet.getRange(i + 1, 3).setValue(consolidated);
        mapSheet.getRange(i + 1, 4).setValue(merchantType);
        return json_({ success: true, action: 'updated' });
      }
    }

    // Add new pattern
    mapSheet.appendRow([counterpartyLower, counterparty, consolidated, merchantType]);
    return json_({ success: true, action: 'added' });

  } catch (err) {
    return json_({ error: 'Failed to save: ' + err.message });
  }
}

/**
 * Handle "remember" command - stores user context/corrections
 * Types: income, payee, correction, preference
 */
function handleRemember_(payload) {
  const token = payload.token;
  const type = payload.type;       // 'income', 'payee', 'correction', 'preference'
  const data = payload.data || {};

  const session = validateToken_(token);
  if (!session) {
    return json_({ error: 'Invalid or expired session', code: 'AUTH_REQUIRED' });
  }

  if (!type || !data) {
    return json_({ error: 'Missing type or data' });
  }

  try {
    const ss = SpreadsheetApp.openById(session.sheetId);
    let ctxSheet = ss.getSheetByName("UserContext");

    // Create UserContext sheet if it doesn't exist
    if (!ctxSheet) {
      ctxSheet = ss.insertSheet("UserContext");
      ctxSheet.getRange(1, 1, 1, 6).setValues([[
        "Type", "Key", "Value", "Details", "DateAdded", "Source"
      ]]);
      ctxSheet.setFrozenRows(1);
    }

    const timestamp = new Date().toISOString();
    let rowData = [];

    switch (type) {
      case 'income':
        // data: { type: 'Salary', day: 28, amount: 25000, notes: 'Main job' }
        rowData = ['income', data.type || 'Salary', data.day || '', data.amount || '', timestamp, data.notes || ''];
        break;

      case 'payee':
        // data: { name: 'Aleks', purpose: 'Flight bookings', category: 'Travel', isWorkExpense: true }
        rowData = ['payee', data.name, data.purpose || '', data.category || '', timestamp, data.isWorkExpense ? 'work' : 'personal'];
        break;

      case 'correction':
        // data: { original: 'Ooredoo is a splurge', corrected: 'Ooredoo is a telecom bill', context: 'monthly' }
        rowData = ['correction', data.original || '', data.corrected || '', data.context || '', timestamp, 'user'];
        break;

      case 'preference':
        // data: { key: 'telecom_essential', value: 'true', notes: 'Ooredoo, Vodafone are essential' }
        rowData = ['preference', data.key || '', data.value || '', data.notes || '', timestamp, 'user'];
        break;

      default:
        return json_({ error: 'Unknown type: ' + type });
    }

    ctxSheet.appendRow(rowData);

    return json_({ success: true, type: type, message: 'Context saved' });

  } catch (err) {
    return json_({ error: 'Failed to save context: ' + err.message });
  }
}

/**
 * Get user context for AI prompts
 */
function handleGetContext_(payload) {
  const token = payload.token;

  const session = validateToken_(token);
  if (!session) {
    return json_({ error: 'Invalid or expired session', code: 'AUTH_REQUIRED' });
  }

  return json_({ success: true, context: getUserContext_(session.sheetId) });
}

/**
 * Load user context from UserContext sheet
 * Returns structured context for AI prompts
 */
function getUserContext_(sheetId) {
  const context = {
    income: [],
    payees: [],
    corrections: [],
    preferences: []
  };

  try {
    const ss = SpreadsheetApp.openById(sheetId);
    const ctxSheet = ss.getSheetByName("UserContext");

    if (!ctxSheet) return context;

    const data = ctxSheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const type = row[0];

      switch (type) {
        case 'income':
          context.income.push({
            type: row[1],
            day: row[2],
            amount: row[3],
            notes: row[5]
          });
          break;
        case 'payee':
          context.payees.push({
            name: row[1],
            purpose: row[2],
            category: row[3],
            isWorkExpense: row[5] === 'work'
          });
          break;
        case 'correction':
          context.corrections.push({
            original: row[1],
            corrected: row[2],
            context: row[3]
          });
          break;
        case 'preference':
          context.preferences.push({
            key: row[1],
            value: row[2],
            notes: row[3]
          });
          break;
      }
    }
  } catch (err) {
    // Return empty context on error
  }

  return context;
}

/**
 * Format user context for inclusion in AI prompts
 */
function formatContextForPrompt_(context) {
  const parts = [];

  if (context.income.length > 0) {
    parts.push("USER'S INCOME SCHEDULE:");
    context.income.forEach(inc => {
      parts.push(`- ${inc.type}: arrives on day ${inc.day} of month${inc.amount ? ', ~' + inc.amount + ' QAR' : ''}${inc.notes ? ' (' + inc.notes + ')' : ''}`);
    });
  }

  if (context.payees.length > 0) {
    parts.push("\nKNOWN PAYEES:");
    context.payees.forEach(p => {
      parts.push(`- ${p.name}: ${p.purpose} (${p.category})${p.isWorkExpense ? ' [WORK EXPENSE]' : ''}`);
    });
  }

  if (context.corrections.length > 0) {
    parts.push("\nPREVIOUS CORRECTIONS (learn from these):");
    context.corrections.forEach(c => {
      parts.push(`- Wrong: "${c.original}" → Correct: "${c.corrected}"`);
    });
  }

  if (context.preferences.length > 0) {
    parts.push("\nUSER PREFERENCES:");
    context.preferences.forEach(p => {
      parts.push(`- ${p.key}: ${p.value}${p.notes ? ' (' + p.notes + ')' : ''}`);
    });
  }

  return parts.join('\n');
}

/**
 * Parse natural language "remember" commands and store context
 * Examples:
 * - "Remember that Aleks handles my flight bookings"
 * - "Remember that my salary arrives on day 28"
 * - "Remember that Ooredoo is a telecom bill, not a splurge"
 */
function handleRememberFromQuery_(sheetId, query) {
  const queryLower = query.toLowerCase();

  try {
    const ss = SpreadsheetApp.openById(sheetId);
    let ctxSheet = ss.getSheetByName("UserContext");

    if (!ctxSheet) {
      ctxSheet = ss.insertSheet("UserContext");
      ctxSheet.getRange(1, 1, 1, 6).setValues([[
        "Type", "Key", "Value", "Details", "DateAdded", "Source"
      ]]);
      ctxSheet.setFrozenRows(1);
    }

    const timestamp = new Date().toISOString();
    let saved = false;
    let message = '';

    // Pattern: salary/income arrives on day X
    const incomeMatch = query.match(/(?:salary|income|pay).+(?:arrives?|comes?|paid|on)\s+(?:day\s+)?(\d+)/i);
    if (incomeMatch) {
      const day = parseInt(incomeMatch[1]);
      ctxSheet.appendRow(['income', 'Salary', day, '', timestamp, query]);
      saved = true;
      message = `Got it! I'll remember your salary arrives on day ${day}.`;
    }

    // Pattern: [name] handles/books my [purpose]
    const payeeMatch = query.match(/(?:remember\s+that\s+)?(\w+)\s+(?:handles?|books?|manages?|does)\s+(?:my\s+)?(.+)/i);
    if (!saved && payeeMatch) {
      const name = payeeMatch[1];
      const purpose = payeeMatch[2].replace(/\.$/, '');
      // Infer category from purpose
      let category = 'Other';
      let isWork = false;
      if (/flight|travel|trip|booking/i.test(purpose)) {
        category = 'Travel';
        isWork = /work|business/i.test(query);
      }
      ctxSheet.appendRow(['payee', name, purpose, category, timestamp, isWork ? 'work' : 'personal']);
      saved = true;
      message = `Got it! I'll remember that ${name} ${purpose}.`;
    }

    // Pattern: [thing] is [correction], not [wrong]
    const correctionMatch = query.match(/(\w+(?:\s+\w+)?)\s+is\s+(?:a\s+)?(.+?)(?:,\s*not\s+(?:a\s+)?(.+))?$/i);
    if (!saved && correctionMatch) {
      const subject = correctionMatch[1];
      const correct = correctionMatch[2];
      const wrong = correctionMatch[3] || '';
      ctxSheet.appendRow(['correction', wrong ? `${subject} is ${wrong}` : subject, `${subject} is ${correct}`, '', timestamp, 'user']);
      saved = true;
      message = `Got it! I'll remember that ${subject} is ${correct}${wrong ? ', not ' + wrong : ''}.`;
    }

    // Generic remember - store as preference
    if (!saved) {
      const content = query.replace(/^remember\s+that\s+/i, '').replace(/^note\s+that\s+/i, '');
      ctxSheet.appendRow(['preference', 'user_note', content, '', timestamp, 'user']);
      saved = true;
      message = "Got it! I've noted that for future reference.";
    }

    return json_({ success: true, remembered: true, message: message });

  } catch (err) {
    return json_({ error: 'Failed to save: ' + err.message });
  }
}

/**
 * Handle SMS ingestion (existing logic, refactored)
 */
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

      // Idempotency check: hash of key fields
      const idempotencyKey = generateIdempotencyKey_(sms, ts);
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

function generateIdempotencyKey_(sms, timestamp) {
  // Create a hash-like key from SMS content + timestamp (rounded to minute)
  const tsMinute = timestamp.slice(0, 16); // YYYY-MM-DDTHH:MM
  const content = sms.replace(/\s+/g, '').toLowerCase().slice(0, 100);
  return Utilities.base64Encode(Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    content + tsMinute
  ));
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

// ============== LEGACY HANDLERS (for backwards compatibility) ==============
// These will be removed in future versions

function handleAuth(e) {
  // Redirect to POST-based auth
  return json_({
    error: 'Auth via GET is deprecated. Please update your client.',
    code: 'DEPRECATED'
  });
}

function handleAIQuery(e) {
  // Redirect to POST-based AI
  return json_({
    error: 'AI queries via GET are deprecated. Please update your client.',
    code: 'DEPRECATED'
  });
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

  // Generate insights using AI (pass sheetId for user context)
  const insights = generateInsights_(recentTxns, SHEET_ID);
  Logger.log("Insights:\n" + insights);

  // Optionally save to a sheet or send via email
  saveInsights_(ss, insights);
}

function generateInsights_(transactions, sheetId) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY");
  if (!apiKey) return "Missing API key";

  const txnSummary = transactions.map(t =>
    `${t.timestamp}: ${t.direction} ${t.amount} ${t.currency} @ ${t.counterparty} (${t.subcategory})`
  ).join('\n');

  // Load user context for personalized insights
  const userContext = sheetId ? getUserContext_(sheetId) : { income: [], payees: [], corrections: [], preferences: [] };
  const contextPrompt = formatContextForPrompt_(userContext);

  // Premium insights prompt for batch analysis
  const prompt = `You are a senior financial analyst reviewing personal transaction data. Provide a comprehensive but actionable monthly financial review.

${contextPrompt ? '## User Context (IMPORTANT - use this information)\n' + contextPrompt + '\n\n' : ''}## Transaction Data (Last 30 Days)
${txnSummary}

## Required Analysis

### 1. Executive Summary
- Total spending vs typical month (if patterns visible)
- Key financial health indicators

### 2. Spending Patterns & Trends
- Day-of-week patterns (weekday vs weekend spending)
- Time-of-day patterns (work hours vs evening vs late night)
- Category concentration analysis

### 3. Anomaly Detection
- Transactions that deviate from established patterns
- One-time large purchases
- Unusual merchant activity

### 4. Recurring Payments Audit
- Detected subscriptions and their monthly cost
- Potential duplicate or forgotten subscriptions
- Optimization opportunities

### 5. Actionable Recommendations
- Specific, numbered recommendations with estimated savings
- Quick wins vs longer-term changes
- Priority ranking

### 6. Forward Look
- Predicted expenses for next month based on patterns
- Upcoming potential budget pressure points

Format in clean markdown. Be specific with numbers and merchant names. Prioritize actionable insights over generic advice.`;

  const url = "https://api.openai.com/v1/responses";
  const body = {
    model: CONFIG.AI_MODEL_INSIGHTS, // Premium model for best quality insights
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
