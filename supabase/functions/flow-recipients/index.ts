import { createUserClient } from '../_shared/supabase.ts';
import { normalizePhone } from '../_shared/utils.ts';
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
  const subAction = payload.subAction;
  const data = payload.data || {};

  if (subAction === 'add') {
    if (!data.shortName) return jsonResponse(request, { error: 'ShortName is required' }, 400);
    const { data: inserted, error: insertErr } = await supabase.from('recipients')
      .insert({
      user_id: user.id,
      phone: normalizePhone(String(data.phone || '')) || null,
      bank_account: data.bankAccount || null,
      short_name: data.shortName,
      long_name: data.longName || null,
    })
    .select('id')
    .single();
    if (insertErr) return jsonResponse(request, { error: insertErr.message }, 400);
    return jsonResponse(request, { success: true, action: 'added', id: inserted?.id });
  }

  if (subAction === 'update') {
    if (!data.id) return jsonResponse(request, { error: 'Missing id' }, 400);
    if (!data.shortName) return jsonResponse(request, { error: 'ShortName is required' }, 400);
    const { error: updateErr } = await supabase
      .from('recipients')
      .update({
        phone: normalizePhone(String(data.phone || '')) || null,
        bank_account: data.bankAccount || null,
        short_name: data.shortName,
        long_name: data.longName || null,
      })
      .eq('id', data.id)
      .eq('user_id', user.id);

    if (updateErr) return jsonResponse(request, { error: updateErr.message }, 400);
    return jsonResponse(request, { success: true, action: 'updated' });
  }

  if (subAction === 'delete') {
    if (!data.id) return jsonResponse(request, { error: 'Missing id' }, 400);
    const { error: deleteErr } = await supabase
      .from('recipients')
      .delete()
      .eq('id', data.id)
      .eq('user_id', user.id);

    if (deleteErr) return jsonResponse(request, { error: deleteErr.message }, 400);
    return jsonResponse(request, { success: true, action: 'deleted' });
  }

  return jsonResponse(request, { error: 'Unknown subAction' }, 400);
});
