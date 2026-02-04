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

  if (previousType && previousType !== merchantType) {
    const timestamp = new Date().toISOString();
    const { error: ctxErr } = await supabase.from('user_context').insert([
      { user_id: user.id, type: 'payee', key: counterparty, value: '', details: merchantType, date_added: timestamp, source: 'learned' },
      { user_id: user.id, type: 'correction', key: `${counterparty} is ${previousType}`, value: `${counterparty} is ${merchantType}`, details: 'User correction from transaction review', date_added: timestamp, source: 'learned' },
    ]);

    if (ctxErr) return jsonResponse(request, { error: ctxErr.message }, 400);
  }

  return jsonResponse(request, { success: true });
});
