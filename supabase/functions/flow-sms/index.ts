import { createAdminClient } from '../_shared/supabase.ts';
import { buildIdempotencyKey, extractTimeContext, sha256Hex, normalizeCounterparty } from '../_shared/utils.ts';
import { resolveCorsOrigin, corsHeaders } from '../_shared/cors.ts';

const MODEL_SMS = Deno.env.get('FLOW_MODEL_SMS') || 'claude-haiku-4';
const MODEL_SMS_RETRY = Deno.env.get('FLOW_MODEL_SMS_RETRY') || 'claude-sonnet-4-20250514';

// Maps subcategories from merchant_map to parent categories
const SUBCAT_TO_PARENT: Record<string, string> = {
  'Groceries': 'Essentials',
  'Dining': 'Lifestyle',
  'Coffee': 'Lifestyle',
  'Delivery': 'Lifestyle',
  'Shopping': 'Lifestyle',
  'Transport': 'Essentials',
  'Health': 'Essentials',
  'Bills': 'Essentials',
  'Travel': 'Lifestyle',
  'Entertainment': 'Lifestyle',
  'Bars & Nightlife': 'Lifestyle',
  'Bars & Hotels': 'Lifestyle',
  'Hobbies': 'Lifestyle',
  'Transfer': 'Financial',
  'Transfers': 'Financial',
  'Family': 'Family',
  'Family Transfers': 'Family',
  'Fees': 'Financial',
  'Other': 'Other',
};

function jsonResponse(request: Request, body: unknown, status = 200) {
  const origin = resolveCorsOrigin(request);
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

function buildSystemPrompt(contextHints: string) {
  return `Parse the following QNB (Qatar National Bank) SMS into a single JSON object. Return ONLY valid JSON, no markdown fences, no commentary.

Required fields:
{
  "amount": <number>,
  "currency": "<3-letter code, default QAR>",
  "amount_qar_approx": <number or null>,
  "counterparty": "<merchant or recipient name, cleaned>",
  "card": "<last 4 digits or empty string>",
  "direction": "<IN or OUT>",
  "txnType": "<Purchase|Transfer|ATM|Refund|Payment|Salary|Fee>",
  "category": "<Essentials|Lifestyle|Family|Financial|Other>",
  "subcategory": "<Groceries|Dining|Coffee|Delivery|Shopping|Transport|Health|Bills|Travel|Entertainment|Transfer|Bars & Nightlife|Family|Other>",
  "confidence": "<high|medium|low>",
  "context": { "reasoning": "<10 words max>" },
  "skip": false,
  "reason": ""
}

Rules:
- "Purchase" at a merchant = OUT. "Salary"/"Credit" = IN. "Transfer" direction depends on wording (sent=OUT, received=IN).
- For counterparty: strip "QNB", "POS", terminal IDs, city suffixes. Keep the recognisable merchant name only.
- Subcategory must be one of the listed values. Pick the closest match. Never return "Uncategorized".
- If the SMS is informational (balance alert, OTP, promo), set skip=true with reason.
- For amount_qar_approx: if the SMS mentions a QAR equivalent for a foreign currency transaction (e.g. "USD 17.33 QAR Equiv. 63.15"), extract the QAR amount. For QAR transactions, set to the same value as amount. Otherwise set to null.

${contextHints ? `Context:\n${contextHints}` : ''}`;
}

async function callClaude(model: string, systemPrompt: string, userContent: string) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude error: ${response.status} ${text}`);
  }

  const json = await response.json();
  const content = json?.content?.[0]?.text;
  if (!content) throw new Error('Empty Claude response');
  return content;
}

function parseExtracted(content: string) {
  // Strip markdown fences if present
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Invalid JSON from model: ${cleaned.slice(0, 200)}`);
  }
}

function shouldRetry(extracted: any) {
  const confidence = (extracted?.confidence || '').toLowerCase();
  const subcategory = (extracted?.subcategory || '').toLowerCase();
  return confidence === 'low' || subcategory === 'uncategorized' || !subcategory;
}

/**
 * Apply merchant_map matching to override AI category if user has a saved mapping.
 * Returns { category, subcategory, confidence } or null if no match.
 */
function applyMerchantMap(
  counterparty: string,
  rawText: string,
  merchants: Array<{ pattern: string; category: string }> | null
): { category: string; subcategory: string; confidence: string } | null {
  if (!merchants?.length || !counterparty) return null;

  const cpLower = counterparty.toLowerCase();
  const rawLower = (rawText || '').toLowerCase();

  for (const m of merchants) {
    if (cpLower.includes(m.pattern) || rawLower.includes(m.pattern)) {
      const subcategory = m.category;
      const category = SUBCAT_TO_PARENT[subcategory] || SUBCAT_TO_PARENT[subcategory] || 'Other';
      return { category, subcategory, confidence: 'matched' };
    }
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    const origin = resolveCorsOrigin(request);
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  if (request.method !== 'POST') {
    return jsonResponse(request, { error: 'Method not allowed' }, 405);
  }

  const payload = await request.json().catch(() => null);
  if (!payload) return jsonResponse(request, { error: 'Invalid JSON' }, 400);

  const key = payload.key || payload.apiKey || payload.token;
  if (!key) return jsonResponse(request, { error: 'Missing key' }, 401);

  const keyHash = await sha256Hex(key);
  const admin = createAdminClient();

  const { data: keyRow, error: keyErr } = await admin
    .from('user_keys')
    .select('id, user_id')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single();

  if (keyErr || !keyRow) {
    return jsonResponse(request, { error: 'Invalid key' }, 401);
  }

  const userId = keyRow.user_id;

  const entries = Array.isArray(payload.entries)
    ? payload.entries
    : [{ sms: payload.sms, timestamp: payload.timestamp }];

  if (!entries.length || !entries[0]?.sms) {
    return jsonResponse(request, { error: 'No valid entries' }, 400);
  }

  const { data: merchants } = await admin
    .from('merchant_map')
    .select('pattern, display_name, consolidated_name, category')
    .eq('user_id', userId);

  const { data: profile } = await admin
    .from('profiles')
    .select('settings')
    .eq('user_id', userId)
    .single();

  const familyPatterns = profile?.settings?.family_patterns || [];

  // Fetch recent corrections to improve AI accuracy
  const { data: corrections } = await admin
    .from('user_context')
    .select('key, value')
    .eq('user_id', userId)
    .eq('type', 'correction')
    .order('date_added', { ascending: false })
    .limit(20);

  const correctionHints = (corrections || [])
    .map(c => `${c.key} → ${c.value}`)
    .join(', ');

  const results = [] as any[];
  let appended = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of entries) {
    const sms = String(entry.sms || '').trim();
    if (!sms) {
      skipped++;
      results.push({ fate: 'skipped', reason: 'Empty SMS' });
      continue;
    }

    const ts = entry.timestamp ? new Date(entry.timestamp) : new Date();
    const timeContext = extractTimeContext(ts);

    const contextHints = [
      `Time: ${timeContext.timeOfDay} (${timeContext.hour}:00)`,
      `Day: ${timeContext.dayOfWeek}, weekend: ${timeContext.isWeekend}`,
      `Month timing: ${timeContext.isStartOfMonth ? 'start' : timeContext.isEndOfMonth ? 'end' : 'mid-month'}`,
      merchants?.length ? `Merchant patterns: ${merchants.slice(0, 50).map(m => `${m.pattern} → ${m.category}`).join(', ')}` : '',
      familyPatterns?.length ? `Family names: ${familyPatterns.join(', ')}` : '',
      correctionHints ? `User corrections: ${correctionHints}` : '',
    ].filter(Boolean).join('\n');

    const systemPrompt = buildSystemPrompt(contextHints);

    try {
      let content = await callClaude(MODEL_SMS, systemPrompt, sms);
      let extracted = parseExtracted(content);

      if (shouldRetry(extracted)) {
        content = await callClaude(MODEL_SMS_RETRY, systemPrompt, sms);
        extracted = parseExtracted(content);
      }

      if (extracted?.skip) {
        skipped++;
        results.push({ fate: 'skipped', reason: extracted.reason || 'skip=true' });
        continue;
      }

      const amount = Number(extracted.amount);
      if (!Number.isFinite(amount)) throw new Error('Invalid amount');

      // Normalize counterparty at ingest time (title-case, brand consolidation)
      const counterparty = normalizeCounterparty(extracted.counterparty || '');

      const VALID_CURRENCIES = ['QAR','USD','EUR','GBP','SAR','AED','KWD','BHD','OMR','EGP','JOD','INR','PKR','PHP','LKR','TRY','CHF','JPY','CAD','AUD','CNY','SGD'];
      const rawCurrency = (extracted.currency || 'QAR').toUpperCase();
      const currency = VALID_CURRENCIES.includes(rawCurrency) ? rawCurrency : 'QAR';
      const idempotencySource = buildIdempotencyKey(sms, ts);
      const idempotencyKey = await sha256Hex(idempotencySource);

      const { data: existing } = await admin
        .from('raw_ledger')
        .select('id')
        .eq('user_id', userId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existing) {
        skipped++;
        results.push({ fate: 'skipped', reason: 'Duplicate' });
        continue;
      }

      const direction = (extracted.direction || '').toUpperCase();
      const amountQarApprox = extracted.amount_qar_approx
        ? Number(extracted.amount_qar_approx)
        : (currency === 'QAR' ? amount : null);

      // Apply merchant_map override: if user has a saved mapping for this merchant,
      // use it instead of AI's category (user corrections take priority)
      let category = extracted.category || null;
      let subcategory = extracted.subcategory || extracted.category || null;
      let confidence = extracted.confidence || null;

      const mapMatch = applyMerchantMap(counterparty, sms, merchants);
      if (mapMatch) {
        category = mapMatch.category;
        subcategory = mapMatch.subcategory;
        confidence = mapMatch.confidence;
      }

      const insertPayload = {
        user_id: userId,
        txn_timestamp: ts.toISOString(),
        amount,
        currency,
        amount_qar_approx: Number.isFinite(amountQarApprox) ? amountQarApprox : null,
        counterparty,
        card: extracted.card || null,
        direction: direction || null,
        txn_type: extracted.txnType || null,
        category,
        subcategory,
        confidence,
        context: extracted.context || { timeContext },
        raw_text: extracted.rawText || sms,
        net: direction === 'OUT' ? -amount : amount,
        idempotency_key: idempotencyKey,
        ai_model: shouldRetry(extracted) ? MODEL_SMS_RETRY : MODEL_SMS,
        ai_mode: 'sms',
      };

      const { error: insertErr } = await admin.from('raw_ledger').insert(insertPayload);
      if (insertErr) throw new Error(insertErr.message);

      appended++;
      results.push({ fate: 'appended' });
    } catch (err) {
      errors++;
      results.push({ fate: 'error', reason: (err as Error).message });
    }
  }

  await admin
    .from('user_keys')
    .update({ last_used_at: new Date().toISOString(), last_used_ip: request.headers.get('x-forwarded-for') || null })
    .eq('id', keyRow.id);

  return jsonResponse(request, {
    success: true,
    received: entries.length,
    appended,
    skipped,
    errors,
    entryLogs: results,
  });
});
