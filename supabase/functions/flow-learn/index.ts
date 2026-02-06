import { createUserClient } from '../_shared/supabase.ts';
import { resolveCorsOrigin, corsHeaders } from '../_shared/cors.ts';

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

// Map subcategory to parent category
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

  const payload = await request.json().catch(() => ({}));
  const counterparty = payload.counterparty;
  const merchantType = payload.merchantType;
  const consolidated = payload.consolidated || counterparty;
  const previousType = payload.previousType || null;

  if (!counterparty || !merchantType) {
    return jsonResponse(request, { error: 'Missing counterparty or merchantType' }, 400);
  }

  const pattern = String(counterparty).toLowerCase();

  // 1. Upsert merchant_map (existing behavior)
  const { error: upsertErr } = await supabase
    .from('merchant_map')
    .upsert({
      user_id: user.id,
      pattern,
      display_name: counterparty,
      consolidated_name: consolidated,
      category: merchantType,
    }, { onConflict: 'user_id,pattern' });

  if (upsertErr) return jsonResponse(request, { error: upsertErr.message }, 400);

  // 2. Update raw_ledger: apply new category to ALL matching transactions
  const { data: updatedRows, error: _ledgerErr } = await supabase
    .from('raw_ledger')
    .update({
      subcategory: merchantType,
      category: parentCategory(merchantType),
      confidence: 'corrected',
    })
    .eq('user_id', user.id)
    .ilike('counterparty', `%${pattern}%`)
    .select('id');

  const updatedCount = updatedRows?.length || 0;

  // 3. Record correction in user_context (existing behavior)
  if (previousType && previousType !== merchantType) {
    const timestamp = new Date().toISOString();
    const { error: ctxErr } = await supabase.from('user_context').insert([
      { user_id: user.id, type: 'payee', key: counterparty, value: '', details: merchantType, date_added: timestamp, source: 'learned' },
      { user_id: user.id, type: 'correction', key: `${counterparty} is ${previousType}`, value: `${counterparty} is ${merchantType}`, details: 'User correction from transaction review', date_added: timestamp, source: 'learned' },
    ]);

    if (ctxErr) return jsonResponse(request, { error: ctxErr.message }, 400);
  }

  return jsonResponse(request, {
    success: true,
    updated: updatedCount,
    message: updatedCount > 0
      ? `Updated ${updatedCount} transaction${updatedCount > 1 ? 's' : ''} to ${merchantType}`
      : 'Merchant pattern saved',
  });
});
