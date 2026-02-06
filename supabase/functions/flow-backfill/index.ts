import { createUserClient } from '../_shared/supabase.ts';
import { resolveCorsOrigin, corsHeaders } from '../_shared/cors.ts';
import { extractTimeContext } from '../_shared/utils.ts';

const MODEL_BACKFILL = Deno.env.get('FLOW_MODEL_SMS') || 'claude-haiku-4';

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

// Map merchant_map category (e.g. "Dining") to parent category
function parentCategory(subcategory: string): string {
  const map: Record<string, string> = {
    'Groceries': 'Essentials',
    'Bills': 'Essentials',
    'Health': 'Essentials',
    'Transport': 'Essentials',
    'Dining': 'Lifestyle',
    'Coffee': 'Lifestyle',
    'Delivery': 'Lifestyle',
    'Shopping': 'Lifestyle',
    'Bars & Nightlife': 'Lifestyle',
    'Hobbies': 'Lifestyle',
    'Travel': 'Lifestyle',
    'Entertainment': 'Lifestyle',
    'Family': 'Family',
    'Transfer': 'Financial',
    'Fees': 'Financial',
    'Other': 'Other',
  };
  return map[subcategory] || 'Other';
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
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude error: ${response.status} ${text}`);
  }

  const json = await response.json();
  return json?.content?.[0]?.text || '';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    const origin = resolveCorsOrigin(request);
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  if (request.method !== 'POST') {
    return jsonResponse(request, { error: 'Method not allowed' }, 405);
  }

  const supabase = createUserClient(request);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return jsonResponse(request, { error: 'AUTH_REQUIRED', code: 'AUTH_REQUIRED' }, 401);
  }

  // Fetch uncategorized transactions
  const { data: uncategorized, error: fetchErr } = await supabase
    .from('raw_ledger')
    .select('id, counterparty, amount, currency, direction, txn_type, txn_timestamp, card')
    .eq('user_id', user.id)
    .or('subcategory.is.null,subcategory.eq.')
    .order('txn_timestamp', { ascending: false });

  if (fetchErr) return jsonResponse(request, { error: fetchErr.message }, 400);

  if (!uncategorized || uncategorized.length === 0) {
    return jsonResponse(request, { matched: 0, ai_categorized: 0, errors: 0, total: 0, message: 'All transactions already categorized' });
  }

  // Fetch merchant_map patterns
  const { data: merchants } = await supabase
    .from('merchant_map')
    .select('pattern, category')
    .eq('user_id', user.id);

  const merchantPatterns = (merchants || []).map(m => ({
    pattern: (m.pattern || '').toLowerCase(),
    category: m.category,
  }));

  // Pass 1: Match against merchant_map
  const matched: { id: string; subcategory: string; category: string }[] = [];
  const unmatched: typeof uncategorized = [];

  for (const txn of uncategorized) {
    const cp = (txn.counterparty || '').toLowerCase();
    const match = merchantPatterns.find(m => cp.includes(m.pattern) || m.pattern.includes(cp));

    if (match && match.category) {
      matched.push({
        id: txn.id,
        subcategory: match.category,
        category: parentCategory(match.category),
      });
    } else {
      unmatched.push(txn);
    }
  }

  // Apply merchant_map matches in batches
  let matchErrors = 0;
  for (let i = 0; i < matched.length; i += 50) {
    const batch = matched.slice(i, i + 50);
    for (const item of batch) {
      const { error: updateErr } = await supabase
        .from('raw_ledger')
        .update({
          subcategory: item.subcategory,
          category: item.category,
          confidence: 'matched',
        })
        .eq('id', item.id)
        .eq('user_id', user.id);

      if (updateErr) matchErrors++;
    }
  }

  // Pass 2: AI categorization for unmatched (Claude Haiku in batches of 10)
  let aiCategorized = 0;
  let aiErrors = 0;

  const systemPrompt = `You are a transaction categorizer for a Qatar-based personal finance tracker.

Given a list of transactions, return a JSON array with one object per transaction.
Each object must have: { "id": "<uuid>", "category": "<parent>", "subcategory": "<sub>", "confidence": "medium" }

Parent categories: Essentials, Lifestyle, Family, Financial, Other
Subcategories: Groceries, Dining, Coffee, Delivery, Shopping, Transport, Health, Bills, Travel, Entertainment, Bars & Nightlife, Family, Transfer, Fees, Hobbies, Other

Rules:
- Match based on counterparty name, amount, and transaction type
- Currency is QAR unless stated otherwise
- Return ONLY a JSON array, no markdown fences, no commentary`;

  for (let i = 0; i < unmatched.length; i += 10) {
    const batch = unmatched.slice(i, i + 10);
    const batchData = batch.map(t => ({
      id: t.id,
      counterparty: t.counterparty || 'Unknown',
      amount: t.amount,
      currency: t.currency || 'QAR',
      direction: t.direction || 'OUT',
      txnType: t.txn_type || 'Purchase',
      time: t.txn_timestamp,
    }));

    try {
      const response = await callClaude(MODEL_BACKFILL, systemPrompt, JSON.stringify(batchData));
      const cleaned = response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const results = JSON.parse(cleaned);

      if (Array.isArray(results)) {
        for (const result of results) {
          if (!result.id || !result.subcategory) continue;

          const { error: updateErr } = await supabase
            .from('raw_ledger')
            .update({
              subcategory: result.subcategory,
              category: result.category || parentCategory(result.subcategory),
              confidence: result.confidence || 'medium',
              ai_model: MODEL_BACKFILL,
              ai_mode: 'backfill',
            })
            .eq('id', result.id)
            .eq('user_id', user.id);

          if (!updateErr) aiCategorized++;
          else aiErrors++;
        }
      }
    } catch {
      aiErrors += batch.length;
    }
  }

  return jsonResponse(request, {
    matched: matched.length - matchErrors,
    ai_categorized: aiCategorized,
    errors: matchErrors + aiErrors,
    total: uncategorized.length,
    message: `Backfill complete: ${matched.length - matchErrors} matched, ${aiCategorized} AI-categorized, ${matchErrors + aiErrors} errors`,
  });
});
