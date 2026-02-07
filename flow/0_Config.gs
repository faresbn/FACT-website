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

}

// ============== EXECUTION LOGGING ==============

/**
 * Centralized logging helper for all functions
 * Logs to Apps Script Logger with timestamp and structured data
 */
function log_(functionName, message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    ts: timestamp,
    fn: functionName,
    msg: message,
    data: data
  };
  Logger.log(JSON.stringify(logEntry));
}

/**
 * Log function entry with parameters
 */
function logEntry_(functionName, params = {}) {
  log_(functionName, 'ENTRY', params);
}

/**
 * Log function exit with result summary
 */
function logExit_(functionName, result = {}) {
  log_(functionName, 'EXIT', result);
}

/**
 * Log error with details
 */
function logError_(functionName, error, context = {}) {
  log_(functionName, 'ERROR', {
    error: error.message || String(error),
    stack: error.stack || null,
    context: context
  });
}

// ============== SESSION TOKEN MANAGEMENT ==============

const TOKEN_EXPIRY_HOURS = 24; // Tokens valid for 24 hours

// ============== RESPONSE UTILITY ==============

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}
