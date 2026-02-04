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
  const type = payload.type;
  const data = payload.data || {};

  if (!type) return jsonResponse(request, { error: 'Missing type' }, 400);

  const timestamp = new Date().toISOString();
  let row: Record<string, unknown> = { user_id: user.id, type, date_added: timestamp, source: 'user' };

  switch (type) {
    case 'income':
      row = { ...row, key: data.type || 'Salary', value: data.day || '', details: data.amount || '' };
      break;
    case 'payee':
      row = { ...row, key: data.name, value: data.purpose || '', details: data.category || '' };
      break;
    case 'correction':
      row = { ...row, key: data.original || '', value: data.corrected || '', details: data.context || '' };
      break;
    case 'preference':
      row = { ...row, key: data.key || '', value: data.value || '', details: data.notes || '' };
      break;
    case 'rule':
      row = { ...row, key: data.merchant || '', value: data.category || '', details: JSON.stringify({ condition: data.condition || '', amount: data.amount || null, frequency: data.frequency || '', description: data.description || '' }) };
      break;
    default:
      return jsonResponse(request, { error: `Unknown type: ${type}` }, 400);
  }

  const { error: insertErr } = await supabase.from('user_context').insert(row);
  if (insertErr) return jsonResponse(request, { error: insertErr.message }, 400);

  return jsonResponse(request, { success: true });
});
