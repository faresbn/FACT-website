import { createAdminClient } from '../_shared/supabase.ts';
import { buildIdempotencyKey, extractTimeContext, sha256Hex } from '../_shared/utils.ts';
import { resolveCorsOrigin, corsHeaders } from '../_shared/cors.ts';

const MODEL_SMS = Deno.env.get('FLOW_MODEL_SMS') || 'gpt-5-mini';
const MODEL_SMS_RETRY = Deno.env.get('FLOW_MODEL_SMS_RETRY') || 'gpt-5.1';

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
  return `You are parsing a QNB bank SMS and must extract a clean JSON object.

Return ONLY valid JSON with these keys:
- amount (number)
- currency (string, e.g. QAR, USD)
- counterparty (string)
- card (string or empty)
- direction (IN or OUT)
- txnType (string)
- category (parent category: Essentials, Lifestyle, Family, Financial, Other)
- subcategory (specific type like Groceries, Dining, Transfer, etc.)
- confidence (high|medium|low)
- context (object with short reasoning, may include timeContext)
- skip (boolean, default false)
- reason (string, if skip=true)

Use these hints when applicable:
${contextHints}

If the SMS is not a transaction, set skip=true and provide reason.`;
}

async function callOpenAI(model: string, systemPrompt: string, sms: string) {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: sms },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error: ${response.status} ${text}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty OpenAI response');
  return content;
}

function parseExtracted(content: string) {
  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`Invalid JSON from model: ${content?.slice(0, 200)}`);
  }
}

function shouldRetry(extracted: any) {
  const confidence = (extracted?.confidence || '').toLowerCase();
  const subcategory = (extracted?.subcategory || '').toLowerCase();
  return confidence === 'low' || subcategory === 'uncategorized' || !subcategory;
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
      merchants?.length ? `Merchant patterns: ${merchants.slice(0, 50).map(m => m.pattern).join(', ')}` : '',
      familyPatterns?.length ? `Family names: ${familyPatterns.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    const systemPrompt = buildSystemPrompt(contextHints);

    try {
      let content = await callOpenAI(MODEL_SMS, systemPrompt, sms);
      let extracted = parseExtracted(content);

      if (shouldRetry(extracted)) {
        content = await callOpenAI(MODEL_SMS_RETRY, systemPrompt, sms);
        extracted = parseExtracted(content);
      }

      if (extracted?.skip) {
        skipped++;
        results.push({ fate: 'skipped', reason: extracted.reason || 'skip=true' });
        continue;
      }

      const amount = Number(extracted.amount);
      if (!Number.isFinite(amount)) throw new Error('Invalid amount');

      const currency = extracted.currency || 'QAR';
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
      const insertPayload = {
        user_id: userId,
        txn_timestamp: ts.toISOString(),
        amount,
        currency,
        counterparty: extracted.counterparty || null,
        card: extracted.card || null,
        direction: direction || null,
        txn_type: extracted.txnType || null,
        category: extracted.category || null,
        subcategory: extracted.subcategory || extracted.category || null,
        confidence: extracted.confidence || null,
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
