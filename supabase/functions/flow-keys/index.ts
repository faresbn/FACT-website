import { createUserClient, createAdminClient } from '../_shared/supabase.ts';
import { sha256Hex } from '../_shared/utils.ts';
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

function generateKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const base = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `flow_${base}`;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    const origin = resolveCorsOrigin(request);
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  const supabase = createUserClient(request);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return jsonResponse(request, { error: 'AUTH_REQUIRED', code: 'AUTH_REQUIRED' }, 401);
  }

  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const action = body.action || 'create';

  const admin = createAdminClient();

  if (action === 'revoke') {
    const { keyId } = body;
    if (!keyId) return jsonResponse(request, { error: 'Missing keyId' }, 400);

    const { error: updateErr } = await admin
      .from('user_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', keyId)
      .eq('user_id', user.id);

    if (updateErr) return jsonResponse(request, { error: updateErr.message }, 400);
    return jsonResponse(request, { success: true });
  }

  const rawKey = generateKey();
  const keyHash = await sha256Hex(rawKey);
  const keyPrefix = rawKey.slice(0, 12);

  const { data, error: insertErr } = await admin
    .from('user_keys')
    .insert({
      user_id: user.id,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      label: body.label || null,
    })
    .select('id, key_prefix, created_at')
    .single();

  if (insertErr) return jsonResponse(request, { error: insertErr.message }, 400);

  return jsonResponse(request, {
    success: true,
    key: rawKey,
    keyPrefix: keyPrefix,
    keyId: data?.id,
  });
});
