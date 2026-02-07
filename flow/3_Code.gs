// ============== HTTP ENDPOINTS ==============

// ============== GET ENDPOINT (Status only) ==============

function doGet(e) {
  logEntry_('doGet', { params: e?.parameter });
  const response = { status: 'ok', message: 'FACT Finance API v7' };
  logExit_('doGet', { status: 'ok' });
  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============== POST ENDPOINT (Auth, AI, Data) ==============

/**
 * Secure POST endpoint for all sensitive operations
 * Actions: auth, ai, data, learn, remember, context, changePassword
 */
function doPost(e) {
  logEntry_('doPost', { hasBody: !!e?.postData?.contents });

  if (e?.postData?.contents) {
    try {
      const payload = JSON.parse(e.postData.contents);
      const action = payload.action || 'sms_ingestion';
      log_('doPost', 'Routing action', { action: action, user: payload.user || payload.token?.substring(0, 8) });

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

      if (payload.action === 'changePassword') {
        return handleChangePassword_(payload);
      }

      if (payload.action === 'recipients') {
        return handleRecipients_(payload);
      }

      // Default: SMS ingestion (existing behavior)
      return handleSMSIngestion_(e, payload);

    } catch (parseErr) {
      return json_({ error: 'Invalid JSON: ' + parseErr.message });
    }
  }

  return json_({ error: 'Missing POST body' });
}

// ============== AI QUERY HANDLER ==============

/**
 * Secure AI query via POST
 */
function handleAIQueryPost_(payload) {
  logEntry_('handleAIQueryPost_', {
    tokenPrefix: payload.token?.substring(0, 8),
    queryLength: payload.q?.length,
    dataLength: payload.data?.length,
    userModel: payload.model
  });

  const token = payload.token;
  const query = payload.q || '';
  const txnData = payload.data || '';
  const userModel = payload.model || null; // User-selected model from settings

  // Validate token
  const session = validateToken_(token);
  if (!session) {
    log_('handleAIQueryPost_', 'Invalid session');
    logExit_('handleAIQueryPost_', { success: false, error: 'AUTH_REQUIRED' });
    return json_({ error: 'Invalid or expired session', code: 'AUTH_REQUIRED' });
  }

  log_('handleAIQueryPost_', 'Session validated', { user: session.user });

  if (!query) {
    logExit_('handleAIQueryPost_', { success: false, error: 'Missing query' });
    return json_({ error: 'Missing query' });
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY");
  if (!apiKey) {
    logExit_('handleAIQueryPost_', { success: false, error: 'No API key' });
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
        log_('handleAIQueryPost_', 'Detected remember command', { query: query.substring(0, 50) });
        return handleRememberFromQuery_(session.sheetId, query);
      }
    }

    // Smart model selection - user preference overrides default, but deep analysis always uses best model
    const isDeepAnalysis = CONFIG.DEEP_ANALYSIS_KEYWORDS.some(kw => queryLower.includes(kw));
    const selectedModel = isDeepAnalysis
      ? CONFIG.AI_MODEL_FRONTEND_DEEP  // Always use gpt-5.1 for deep analysis
      : (userModel || CONFIG.AI_MODEL_FRONTEND);  // User preference or default

    log_('handleAIQueryPost_', 'Model selected', { selectedModel, isDeepAnalysis, userModel });

    // Load user context for personalized responses
    const userContext = getUserContext_(session.sheetId);

    // Load MerchantMap for alias recognition
    const ss = SpreadsheetApp.openById(session.sheetId);
    const merchantMap = getMerchantMap_(ss);

    // Load Recipients for transfer/Fawran name resolution
    const recipients = getRecipients_(ss);

    // Format context including MerchantMap and Recipients
    const contextPrompt = formatContextForPrompt_(userContext, merchantMap, recipients);
    log_('handleAIQueryPost_', 'Context loaded', {
      income: userContext.income.length,
      payees: userContext.payees.length,
      corrections: userContext.corrections.length,
      preferences: userContext.preferences.length,
      rules: userContext.rules?.length || 0,
      merchants: merchantMap.length,
      recipients: recipients.length
    });

    const basePrompt = `You are a personal finance analyst for this specific user. Answer their questions about spending data.
Be concise but insightful. Use specific numbers from the data. Format your response with markdown.

${contextPrompt ? `CRITICAL - USER'S PERSONAL CONTEXT (ALWAYS USE THIS):
${contextPrompt}

You MUST apply this context to your analysis. For example:
- Use the correct salary date from their income schedule
- Recognize known payees and their purposes
- Apply corrections they've taught you (e.g., if they said Ooredoo is telecom, don't call it a splurge)
---

` : ''}The transaction data includes dimensions:
- merchantType: what was purchased (Groceries, Dining, Bars & Nightlife, Coffee, Shopping, etc.)
- dims.when: time context (Work Hours, Evening, Late Night, Weekend)
- dims.size: amount tier (Micro, Small, Medium, Large, Major)
- dims.pattern: detected pattern (Normal, Night Out, Work Expense, Splurge, Subscription)`;

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

    log_('handleAIQueryPost_', 'Calling OpenAI API', { model: selectedModel, maxTokens: requestPayload.max_completion_tokens });

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
      log_('handleAIQueryPost_', 'OpenAI API error', { error: result.error.message });
      logExit_('handleAIQueryPost_', { success: false, error: result.error.message });
      return json_({ error: result.error.message });
    }

    // Validate response structure
    if (!result.choices || !result.choices[0] || !result.choices[0].message || !result.choices[0].message.content) {
      log_('handleAIQueryPost_', 'Invalid API response structure', { result: JSON.stringify(result).substring(0, 500) });
      logExit_('handleAIQueryPost_', { success: false, error: 'Invalid response from AI' });
      return json_({ error: 'Invalid response from AI. Please try again.' });
    }

    const aiAnswer = result.choices[0].message.content;
    if (!aiAnswer || aiAnswer.trim() === '') {
      log_('handleAIQueryPost_', 'Empty AI response');
      logExit_('handleAIQueryPost_', { success: false, error: 'Empty response' });
      return json_({ error: 'AI returned an empty response. Please try again.' });
    }

    // Include context stats so frontend can verify it's loaded
    const contextStats = {
      income: userContext.income.length,
      payees: userContext.payees.length,
      corrections: userContext.corrections.length,
      preferences: userContext.preferences.length,
      rules: userContext.rules?.length || 0,
      merchants: merchantMap.length
    };

    log_('handleAIQueryPost_', 'OpenAI API success', {
      model: selectedModel,
      mode: isDeepAnalysis ? 'deep' : 'standard',
      answerLength: aiAnswer.length,
      contextStats
    });
    logExit_('handleAIQueryPost_', { success: true, model: selectedModel });

    return json_({
      answer: aiAnswer,
      model: selectedModel,
      mode: isDeepAnalysis ? 'deep' : 'standard',
      contextLoaded: contextStats
    });

  } catch (err) {
    logError_('handleAIQueryPost_', err, { query: query?.substring(0, 50) });
    logExit_('handleAIQueryPost_', { success: false, error: err.message });
    return json_({ error: err.message });
  }
}

/**
 * Secure data fetch via POST - replaces direct sheet access

// ============== DATA FETCH ==============

function handleDataFetch_(payload) {
  logEntry_('handleDataFetch_', { tokenPrefix: payload.token?.substring(0, 8), sheets: payload.sheets });

  const token = payload.token;
  const sheets = payload.sheets || ['RawLedger']; // Which sheets to fetch

  const session = validateToken_(token);
  if (!session) {
    log_('handleDataFetch_', 'Invalid session');
    logExit_('handleDataFetch_', { success: false, error: 'AUTH_REQUIRED' });
    return json_({ error: 'Invalid or expired session', code: 'AUTH_REQUIRED' });
  }

  try {
    const ss = SpreadsheetApp.openById(session.sheetId);
    const result = {};
    const rowCounts = {};

    for (const sheetName of sheets) {
      const sheet = ss.getSheetByName(sheetName);
      if (sheet) {
        const data = sheet.getDataRange().getValues();
        result[sheetName] = data;
        rowCounts[sheetName] = data.length;
      }
    }

    log_('handleDataFetch_', 'Data fetched', { user: session.user, rowCounts });
    logExit_('handleDataFetch_', { success: true, sheets: Object.keys(result) });
    return json_({ success: true, data: result });

  } catch (err) {
    logError_('handleDataFetch_', err, { user: session.user, sheets });
    logExit_('handleDataFetch_', { success: false, error: err.message });
    return json_({ error: 'Failed to fetch data: ' + err.message });
  }
}

/**
 * Learn from user categorization - syncs to MerchantMap AND UserContext
 * This creates a feedback loop: corrections are remembered by the AI

// ============== LEARN CATEGORY ==============

function handleLearnCategory_(payload) {
  logEntry_('handleLearnCategory_', {
    tokenPrefix: payload.token?.substring(0, 8),
    counterparty: payload.counterparty,
    merchantType: payload.merchantType,
    previousType: payload.previousType
  });

  const token = payload.token;
  const counterparty = payload.counterparty;
  const merchantType = payload.merchantType;
  const consolidated = payload.consolidated || counterparty;
  const previousType = payload.previousType || null; // What AI thought it was

  const session = validateToken_(token);
  if (!session) {
    log_('handleLearnCategory_', 'Invalid session');
    logExit_('handleLearnCategory_', { success: false, error: 'AUTH_REQUIRED' });
    return json_({ error: 'Invalid or expired session', code: 'AUTH_REQUIRED' });
  }

  if (!counterparty || !merchantType) {
    logExit_('handleLearnCategory_', { success: false, error: 'Missing fields' });
    return json_({ error: 'Missing counterparty or merchantType' });
  }

  try {
    const ss = SpreadsheetApp.openById(session.sheetId);

    // 1. Update MerchantMap (existing behavior)
    let mapSheet = ss.getSheetByName("MerchantMap");

    if (!mapSheet) {
      log_('handleLearnCategory_', 'Creating MerchantMap sheet');
      mapSheet = ss.insertSheet("MerchantMap");
      mapSheet.getRange(1, 1, 1, 4).setValues([["Pattern", "DisplayName", "ConsolidatedName", "MerchantType"]]);
    }

    const data = mapSheet.getDataRange().getValues();
    const counterpartyLower = counterparty.toLowerCase();
    let action = 'added';

    // Check if pattern already exists
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toLowerCase() === counterpartyLower) {
        // Update existing
        mapSheet.getRange(i + 1, 3).setValue(consolidated);
        mapSheet.getRange(i + 1, 4).setValue(merchantType);
        action = 'updated';
        break;
      }
    }

    if (action === 'added') {
      mapSheet.appendRow([counterpartyLower, counterparty, consolidated, merchantType]);
    }

    // 2. NEW: Also add to UserContext for AI learning (if this was a correction)
    if (previousType && previousType !== merchantType) {
      let ctxSheet = ss.getSheetByName("UserContext");

      if (!ctxSheet) {
        ctxSheet = ss.insertSheet("UserContext");
        ctxSheet.getRange(1, 1, 1, 6).setValues([[
          "Type", "Key", "Value", "Details", "DateAdded", "Source"
        ]]);
        ctxSheet.setFrozenRows(1);
      }

      const timestamp = new Date().toISOString();

      // Add as both payee (for general knowledge) and correction (for AI learning)
      ctxSheet.appendRow(['payee', counterparty, '', merchantType, timestamp, 'learned']);
      ctxSheet.appendRow(['correction',
        `${counterparty} is ${previousType}`,
        `${counterparty} is ${merchantType}`,
        'User correction from transaction review',
        timestamp,
        'learned'
      ]);

      log_('handleLearnCategory_', 'Added to UserContext for AI learning', {
        counterparty,
        previousType,
        merchantType
      });
    }

    log_('handleLearnCategory_', 'Pattern saved', { counterparty, merchantType, action });
    logExit_('handleLearnCategory_', { success: true, action });
    return json_({ success: true, action: action });

  } catch (err) {
    logError_('handleLearnCategory_', err, { counterparty, merchantType });
    logExit_('handleLearnCategory_', { success: false, error: err.message });
    return json_({ error: 'Failed to save: ' + err.message });
  }
}

/**
 * Handle "remember" command - stores user context/corrections
 * Types: income, payee, correction, preference

// ============== REMEMBER ==============

function handleRemember_(payload) {
  logEntry_('handleRemember_', { tokenPrefix: payload.token?.substring(0, 8), type: payload.type, data: payload.data });

  const token = payload.token;
  const type = payload.type;       // 'income', 'payee', 'correction', 'preference'
  const data = payload.data || {};

  const session = validateToken_(token);
  if (!session) {
    log_('handleRemember_', 'Invalid session');
    logExit_('handleRemember_', { success: false, error: 'AUTH_REQUIRED' });
    return json_({ error: 'Invalid or expired session', code: 'AUTH_REQUIRED' });
  }

  if (!type || !data) {
    logExit_('handleRemember_', { success: false, error: 'Missing type or data' });
    return json_({ error: 'Missing type or data' });
  }

  try {
    const ss = SpreadsheetApp.openById(session.sheetId);
    let ctxSheet = ss.getSheetByName("UserContext");

    // Create UserContext sheet if it doesn't exist
    if (!ctxSheet) {
      log_('handleRemember_', 'Creating UserContext sheet');
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
        rowData = ['income', data.type || 'Salary', data.day || '', data.amount || '', timestamp, data.notes || ''];
        break;

      case 'payee':
        rowData = ['payee', data.name, data.purpose || '', data.category || '', timestamp, data.isWorkExpense ? 'work' : 'personal'];
        break;

      case 'correction':
        rowData = ['correction', data.original || '', data.corrected || '', data.context || '', timestamp, 'user'];
        break;

      case 'preference':
        rowData = ['preference', data.key || '', data.value || '', data.notes || '', timestamp, 'user'];
        break;

      default:
        logExit_('handleRemember_', { success: false, error: 'Unknown type' });
        return json_({ error: 'Unknown type: ' + type });
    }

    ctxSheet.appendRow(rowData);

    log_('handleRemember_', 'Context saved', { user: session.user, type, rowData });
    logExit_('handleRemember_', { success: true, type });
    return json_({ success: true, type: type, message: 'Context saved' });

  } catch (err) {
    logError_('handleRemember_', err, { type, data });
    logExit_('handleRemember_', { success: false, error: err.message });
    return json_({ error: 'Failed to save context: ' + err.message });
  }
}

/**
 * Get user context for AI prompts

// ============== USER CONTEXT ==============

function handleGetContext_(payload) {
  logEntry_('handleGetContext_', { tokenPrefix: payload.token?.substring(0, 8) });

  const token = payload.token;

  const session = validateToken_(token);
  if (!session) {
    log_('handleGetContext_', 'Invalid session');
    logExit_('handleGetContext_', { success: false, error: 'AUTH_REQUIRED' });
    return json_({ error: 'Invalid or expired session', code: 'AUTH_REQUIRED' });
  }

  const context = getUserContext_(session.sheetId);
  log_('handleGetContext_', 'Context retrieved', {
    user: session.user,
    income: context.income.length,
    payees: context.payees.length,
    corrections: context.corrections.length,
    preferences: context.preferences.length
  });
  logExit_('handleGetContext_', { success: true });
  return json_({ success: true, context: context });
}

/**
 * Load user context from UserContext sheet
 * Returns structured context for AI prompts
 * Now includes 'rules' for transaction-specific patterns
 */
function getUserContext_(sheetId) {
  logEntry_('getUserContext_', { sheetId: sheetId?.substring(0, 10) });

  const context = {
    income: [],
    payees: [],
    corrections: [],
    preferences: [],
    rules: []  // NEW: Transaction-specific rules
  };

  try {
    const ss = SpreadsheetApp.openById(sheetId);
    const ctxSheet = ss.getSheetByName("UserContext");

    if (!ctxSheet) {
      log_('getUserContext_', 'UserContext sheet not found');
      logExit_('getUserContext_', { found: false });
      return context;
    }

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
        case 'rule':
          // NEW: Transaction-specific rules
          let ruleDetails = {};
          try {
            ruleDetails = row[3] ? JSON.parse(row[3]) : {};
          } catch (e) {
            ruleDetails = { description: row[3] };
          }
          context.rules.push({
            merchant: row[1],
            condition: row[2],
            ...ruleDetails
          });
          break;
      }
    }

    log_('getUserContext_', 'Context loaded', {
      rows: data.length - 1,
      income: context.income.length,
      payees: context.payees.length,
      corrections: context.corrections.length,
      preferences: context.preferences.length,
      rules: context.rules.length
    });
  } catch (err) {
    logError_('getUserContext_', err, { sheetId });
  }

  logExit_('getUserContext_', {
    total: context.income.length + context.payees.length + context.corrections.length + context.preferences.length + context.rules.length
  });
  return context;
}

/**
 * Format user context for inclusion in AI prompts
 * Includes income, payees, corrections, preferences, rules, and optionally MerchantMap
 */
function formatContextForPrompt_(context, merchantMap = null, recipients = null) {
  const parts = [];

  if (context.income.length > 0) {
    parts.push("USER'S INCOME SCHEDULE:");
    context.income.forEach(inc => {
      parts.push(`- ${inc.type}: arrives on day ${inc.day} of month${inc.amount ? ', ~' + inc.amount + ' QAR' : ''}${inc.notes ? ' (' + inc.notes + ')' : ''}`);
    });
  }

  if (context.payees.length > 0) {
    parts.push("\nKNOWN PAYEES (user has taught you about these):");
    context.payees.forEach(p => {
      parts.push(`- ${p.name}: ${p.purpose} (${p.category})${p.isWorkExpense ? ' [WORK EXPENSE - reimbursable]' : ''}`);
    });
  }

  // NEW: Transaction-specific rules
  if (context.rules && context.rules.length > 0) {
    parts.push("\nTRANSACTION-SPECIFIC RULES (apply these ONLY to matching transactions, not all transactions to this merchant):");
    context.rules.forEach(r => {
      const conditions = [];
      if (r.amount) conditions.push(`amount ~${r.amount} QAR`);
      if (r.frequency) conditions.push(r.frequency);
      if (r.condition) conditions.push(r.condition);
      parts.push(`- ${r.merchant}: when ${conditions.join(', ')} → categorize as ${r.category || r.description}`);
    });
  }

  if (context.corrections.length > 0) {
    parts.push("\nPREVIOUS CORRECTIONS (you got these wrong before - don't repeat the mistake):");
    context.corrections.forEach(c => {
      parts.push(`- WRONG: "${c.original}" → CORRECT: "${c.corrected}"${c.context ? ' (' + c.context + ')' : ''}`);
    });
  }

  if (context.preferences.length > 0) {
    parts.push("\nUSER PREFERENCES:");
    context.preferences.forEach(p => {
      parts.push(`- ${p.key}: ${p.value}${p.notes ? ' (' + p.notes + ')' : ''}`);
    });
  }

  // Include MerchantMap for alias recognition
  if (merchantMap && merchantMap.length > 0) {
    parts.push("\nMERCHANT ALIASES (recognize these names and their categories):");
    // Group by category for readability, limit to most relevant
    const byCategory = {};
    merchantMap.forEach(m => {
      const cat = m.category || 'Other';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(m);
    });
    Object.keys(byCategory).slice(0, 8).forEach(cat => {
      const merchants = byCategory[cat].slice(0, 5);
      parts.push(`- ${cat}: ${merchants.map(m => m.displayName).join(', ')}`);
    });
  }

  // Include Recipients for transfer/Fawran name resolution
  if (recipients && recipients.length > 0) {
    parts.push("\nKNOWN RECIPIENTS (for transfers and Fawran):");
    recipients.forEach(r => {
      const identifiers = [];
      if (r.phone) identifiers.push(`phone: ${r.phone}`);
      if (r.bankAccount) identifiers.push(`account: ...${r.bankAccount.slice(-4)}`);
      parts.push(`- ${r.shortName}${r.longName ? ' (' + r.longName + ')' : ''}: ${identifiers.join(', ')}`);
    });
  }

  return parts.join('\n');
}

/**
 * Parse natural language "remember" commands using AI
 * Handles complex commands including:
 * - Multiple entries ("remember this AND that")
 * - Transaction-specific rules ("one QAR 4000 to Afif is rent")
 * - Merchant aliases (matches to MerchantMap)
 * Examples:
 * - "Remember that Aleks handles my flight bookings"
 * - "Remember that my salary arrives on day 28"
 * - "Remember that Ooredoo is a telecom bill, not a splurge"
 * - "Remember that one QAR 4000 transaction per month to Afif is rent"
 * - "Remember that Afif handles my travel bookings and Ooredoo is my phone bill"

function handleRememberFromQuery_(sheetId, query) {
  logEntry_('handleRememberFromQuery_', { sheetId: sheetId?.substring(0, 10), query: query?.substring(0, 50) });

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

    // Load MerchantMap for alias matching
    const merchantMap = getMerchantMap_(ss);

    // Use AI to parse complex remember commands
    const parsedEntries = parseRememberWithAI_(query, merchantMap);

    if (!parsedEntries || parsedEntries.length === 0) {
      // Fallback to simple parsing
      return handleRememberSimple_(ctxSheet, query);
    }

    // Check for contradictions before saving
    const existingContext = getUserContext_(sheetId);
    const contradictions = checkContradictions_(parsedEntries, existingContext);

    const timestamp = new Date().toISOString();
    const savedEntries = [];
    const warnings = [];

    for (const entry of parsedEntries) {
      // Add contradiction warning but still save (newer info takes precedence)
      if (contradictions[entry.key]) {
        warnings.push(`Note: This updates previous info about "${entry.key}"`);
      }

      // Map entry type to row format
      let rowData;
      switch (entry.type) {
        case 'income':
          rowData = ['income', entry.incomeType || 'Salary', entry.day || '', entry.amount || '', timestamp, entry.notes || query];
          break;
        case 'payee':
          rowData = ['payee', entry.name, entry.purpose || '', entry.category || 'Other', timestamp, entry.isWorkExpense ? 'work' : 'personal'];
          break;
        case 'correction':
          rowData = ['correction', entry.original || '', entry.corrected || '', entry.context || '', timestamp, 'user'];
          break;
        case 'rule':
          // Transaction-specific rules (new type!)
          rowData = ['rule', entry.merchant || '', entry.condition || '', JSON.stringify({
            amount: entry.amount,
            frequency: entry.frequency,
            category: entry.category,
            description: entry.description
          }), timestamp, 'user'];
          break;
        case 'preference':
        default:
          rowData = ['preference', entry.key || 'user_note', entry.value || '', entry.notes || '', timestamp, 'user'];
      }

      ctxSheet.appendRow(rowData);
      savedEntries.push(entry);
    }

    // Build confirmation message
    let message;
    if (savedEntries.length === 1) {
      message = formatSingleEntryConfirmation_(savedEntries[0]);
    } else {
      message = `Got it! I've remembered ${savedEntries.length} things:\n` +
                savedEntries.map((e, i) => `${i + 1}. ${formatEntryDescription_(e)}`).join('\n');
    }

    if (warnings.length > 0) {
      message += '\n\n' + warnings.join('\n');
    }

    log_('handleRememberFromQuery_', 'Entries saved', { count: savedEntries.length, types: savedEntries.map(e => e.type) });
    logExit_('handleRememberFromQuery_', { success: true, count: savedEntries.length });

    return json_({ success: true, remembered: true, message: message, entriesSaved: savedEntries.length });

  } catch (err) {
    logError_('handleRememberFromQuery_', err, { query: query?.substring(0, 50) });
    logExit_('handleRememberFromQuery_', { success: false, error: err.message });
    return json_({ error: 'Failed to save: ' + err.message });
  }
}

/**
 * Simple fallback parsing for remember commands (no AI)
 */
function handleRememberSimple_(ctxSheet, query) {
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
}

/**
 * Use AI to parse complex remember commands
 * Returns array of structured entries
 */
function parseRememberWithAI_(query, merchantMap) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY");
  if (!apiKey) {
    log_('parseRememberWithAI_', 'No API key, falling back to simple parsing');
    return null;
  }

  // Build merchant context for AI
  const merchantContext = merchantMap.length > 0
    ? `\n\nKnown merchants/payees from user's data:\n${merchantMap.map(m => `- ${m.displayName} (pattern: ${m.pattern}, category: ${m.category})`).join('\n')}`
    : '';

  const systemPrompt = `You are a parser for personal finance "remember" commands. Extract structured data entries from user's natural language.

IMPORTANT RULES:
1. If the user mentions multiple things to remember (connected by "and", "also", commas, etc.), extract EACH as a separate entry
2. Match partial names to known merchants (e.g., "Afif" matches "Afif Bou Nassif")
3. Detect transaction-specific rules vs general merchant categorization:
   - "Afif is travel" → payee (ALL Afif transactions)
   - "One QAR 4000 to Afif per month is rent" → rule (ONLY matching transactions)
4. Recognize income patterns, payees, corrections, and preferences
${merchantContext}

ENTRY TYPES:
- income: salary/income schedule (day of month, amount, type)
- payee: merchant/person info (name, purpose, category, isWorkExpense)
- correction: fixing AI mistakes (original interpretation, correct interpretation)
- rule: transaction-specific pattern (merchant, amount condition, frequency, category)
- preference: general user preference

Return a JSON array of entries. Each entry should have:
- type: one of [income, payee, correction, rule, preference]
- Plus type-specific fields as appropriate`;

  const requestPayload = {
    model: CONFIG.AI_MODEL_FRONTEND, // Use standard model for parsing
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Parse this remember command into structured entries:\n\n"${query}"` }
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 500
  };

  try {
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
      log_('parseRememberWithAI_', 'API error', { error: result.error.message });
      return null;
    }

    const content = result.choices[0].message.content;
    const parsed = JSON.parse(content);

    // Handle both { entries: [...] } and direct array format
    const entries = Array.isArray(parsed) ? parsed : (parsed.entries || [parsed]);

    log_('parseRememberWithAI_', 'Parsed entries', { count: entries.length, types: entries.map(e => e.type) });
    return entries;

  } catch (err) {
    log_('parseRememberWithAI_', 'Parse error', { error: err.message });
    return null;
  }
}

/**
 * Load MerchantMap data for AI context

// ============== MERCHANT MAP & RECIPIENTS ==============

function getMerchantMap_(ss) {
  const merchants = [];
  try {
    const mapSheet = ss.getSheetByName("MerchantMap");
    if (!mapSheet) return merchants;

    const data = mapSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[0]) {
        merchants.push({
          pattern: String(row[0]).toLowerCase(),
          displayName: row[1] || row[0],
          consolidatedName: row[2] || row[1] || row[0],
          category: row[3] || 'Other'
        });
      }
    }
  } catch (err) {
    log_('getMerchantMap_', 'Error loading', { error: err.message });
  }
  return merchants;
}

/**
 * Load Recipients data for counterparty matching
 * Columns: Phone, BankAccount, ShortName, LongName
 */
function getRecipients_(ss) {
  const recipients = [];
  try {
    const sheet = ss.getSheetByName("Recipients");
    if (!sheet) return recipients;

    const data = sheet.getDataRange().getValues();
    // Skip header row
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const shortName = String(row[2] || '').trim();
      const longName = String(row[3] || '').trim();

      // Must have at least ShortName or LongName
      if (shortName || longName) {
        recipients.push({
          phone: normalizePhone_(String(row[0] || '')),
          bankAccount: String(row[1] || '').trim(),
          shortName: shortName,
          longName: longName
        });
      }
    }
    log_('getRecipients_', 'Loaded recipients', { count: recipients.length });
  } catch (err) {
    log_('getRecipients_', 'Error loading', { error: err.message });
  }
  return recipients;
}

/**
 * CRUD operations for Recipients sheet
 * subActions: add, update, delete
 */
function handleRecipients_(payload) {
  logEntry_('handleRecipients_', {
    tokenPrefix: payload.token?.substring(0, 8),
    subAction: payload.subAction
  });

  const token = payload.token;
  const subAction = payload.subAction;
  const data = payload.data || {};

  const session = validateToken_(token);
  if (!session) {
    log_('handleRecipients_', 'Invalid session');
    logExit_('handleRecipients_', { success: false, error: 'AUTH_REQUIRED' });
    return json_({ error: 'Invalid or expired session', code: 'AUTH_REQUIRED' });
  }

  try {
    const ss = SpreadsheetApp.openById(session.sheetId);
    let sheet = ss.getSheetByName('Recipients');

    // Create sheet if it doesn't exist
    if (!sheet) {
      log_('handleRecipients_', 'Creating Recipients sheet');
      sheet = ss.insertSheet('Recipients');
      sheet.getRange(1, 1, 1, 4).setValues([['Phone', 'BankAccount', 'ShortName', 'LongName']]);
      sheet.setFrozenRows(1);
    }

    const allData = sheet.getDataRange().getValues();
    const rows = allData.slice(1); // Skip header

    switch (subAction) {
      case 'add': {
        if (!data.shortName) {
          return json_({ error: 'ShortName is required' });
        }

        const phone = normalizePhone_(String(data.phone || ''));
        const newRow = [
          phone,
          data.bankAccount || '',
          data.shortName,
          data.longName || ''
        ];

        sheet.appendRow(newRow);
        log_('handleRecipients_', 'Added recipient', { shortName: data.shortName });

        logExit_('handleRecipients_', { success: true, action: 'added' });
        return json_({
          success: true,
          action: 'added',
          recipient: {
            phone: phone,
            bankAccount: data.bankAccount || '',
            shortName: data.shortName,
            longName: data.longName || ''
          }
        });
      }

      case 'update': {
        const index = parseInt(data.index);
        if (isNaN(index) || index < 0 || index >= rows.length) {
          return json_({ error: 'Invalid index' });
        }

        if (!data.shortName) {
          return json_({ error: 'ShortName is required' });
        }

        const rowNum = index + 2; // +1 for header, +1 for 1-indexed
        const phone = normalizePhone_(String(data.phone || ''));

        sheet.getRange(rowNum, 1, 1, 4).setValues([[
          phone,
          data.bankAccount || '',
          data.shortName,
          data.longName || ''
        ]]);

        log_('handleRecipients_', 'Updated recipient', { index, shortName: data.shortName });

        logExit_('handleRecipients_', { success: true, action: 'updated' });
        return json_({
          success: true,
          action: 'updated',
          index: index
        });
      }

      case 'delete': {
        const index = parseInt(data.index);
        if (isNaN(index) || index < 0 || index >= rows.length) {
          return json_({ error: 'Invalid index' });
        }

        const rowNum = index + 2;
        const deletedName = rows[index][2]; // ShortName

        sheet.deleteRow(rowNum);
        log_('handleRecipients_', 'Deleted recipient', { index, shortName: deletedName });

        logExit_('handleRecipients_', { success: true, action: 'deleted' });
        return json_({
          success: true,
          action: 'deleted',
          index: index
        });
      }

      default:
        return json_({ error: 'Unknown subAction: ' + subAction });
    }

  } catch (err) {
    logError_('handleRecipients_', err, { subAction, data });
    logExit_('handleRecipients_', { success: false, error: err.message });
    return json_({ error: 'Operation failed: ' + err.message });
  }
}

/**
 * Normalize phone number for matching (remove spaces, dashes, country codes)
 */
function normalizePhone_(phone) {
  if (!phone) return '';
  // Remove all non-digits
  let digits = phone.replace(/\D/g, '');
  // Qatar numbers: strip +974 or 974 prefix
  if (digits.startsWith('974') && digits.length > 8) {
    digits = digits.slice(3);
  }
  return digits;
}

/**
 * Check for contradictions with existing context
 */
function checkContradictions_(newEntries, existingContext) {
  const contradictions = {};

  for (const entry of newEntries) {
    const key = entry.key || entry.name || entry.merchant || entry.incomeType;
    if (!key) continue;

    const keyLower = key.toLowerCase();

    // Check payees
    for (const payee of existingContext.payees) {
      if (payee.name.toLowerCase() === keyLower &&
          entry.type === 'payee' &&
          payee.category !== entry.category) {
        contradictions[key] = {
          type: 'payee_category',
          existing: payee.category,
          new: entry.category
        };
      }
    }

    // Check corrections
    for (const correction of existingContext.corrections) {
      if (correction.original.toLowerCase().includes(keyLower) && entry.type === 'correction') {
        contradictions[key] = {
          type: 'correction_exists',
          existing: correction.corrected
        };
      }
    }

    // Check income (only one salary date should exist)
    if (entry.type === 'income' && existingContext.income.length > 0) {
      const existingSalary = existingContext.income.find(i => i.type === 'Salary');
      if (existingSalary && existingSalary.day !== entry.day) {
        contradictions[key || 'Salary'] = {
          type: 'income_date',
          existing: existingSalary.day,
          new: entry.day
        };
      }
    }
  }

  return contradictions;
}

/**
 * Format confirmation message for single entry
 */
function formatSingleEntryConfirmation_(entry) {
  switch (entry.type) {
    case 'income':
      return `Got it! I'll remember your ${entry.incomeType || 'salary'} arrives on day ${entry.day}.`;
    case 'payee':
      return `Got it! I'll remember that ${entry.name} ${entry.purpose || 'is categorized as ' + entry.category}.`;
    case 'correction':
      return `Got it! I'll remember that ${entry.corrected} (not ${entry.original}).`;
    case 'rule':
      return `Got it! I'll remember that ${entry.condition} transactions to ${entry.merchant} are ${entry.category || entry.description}.`;
    case 'preference':
    default:
      return `Got it! I've noted: ${entry.value || entry.key}.`;
  }
}

/**
 * Format brief entry description
 */
function formatEntryDescription_(entry) {
  switch (entry.type) {
    case 'income':
      return `${entry.incomeType || 'Salary'} on day ${entry.day}`;
    case 'payee':
      return `${entry.name}: ${entry.purpose || entry.category}`;
    case 'correction':
      return `${entry.corrected}`;
    case 'rule':
      return `${entry.condition || ''} to ${entry.merchant} = ${entry.category || entry.description}`;
    case 'preference':
    default:
      return entry.value || entry.key;
  }
}

/**
 * Handle SMS ingestion (existing logic, refactored)

// ============== DEPRECATED HANDLERS ==============

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
