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
  const sheets = payload.sheets || ['RawLedger'];

  const data: Record<string, any> = {};

  if (sheets.includes('RawLedger')) {
    const { data: rows, error: rowsErr } = await supabase
      .from('raw_ledger')
      .select('txn_timestamp, amount, currency, counterparty, card, direction, txn_type, category, subcategory, confidence, context, raw_text')
      .eq('user_id', user.id)
      .order('txn_timestamp', { ascending: false });

    if (rowsErr) return jsonResponse(request, { error: rowsErr.message }, 400);

    const header = ['Timestamp', 'Amount', 'Currency', 'Counterparty', 'Card', 'Direction', 'TxnType', 'Category', 'Subcategory', 'Confidence', 'Context', 'RawText'];
    const rowsArray = (rows || []).map((r) => [
      r.txn_timestamp,
      r.amount,
      r.currency,
      r.counterparty,
      r.card,
      r.direction,
      r.txn_type,
      r.category,
      r.subcategory,
      r.confidence,
      r.context ? JSON.stringify(r.context) : '',
      r.raw_text,
    ]);
    data.RawLedger = [header, ...rowsArray];
  }

  if (sheets.includes('MerchantMap')) {
    const { data: rows, error: rowsErr } = await supabase
      .from('merchant_map')
      .select('pattern, display_name, consolidated_name, category')
      .eq('user_id', user.id);

    if (rowsErr) return jsonResponse(request, { error: rowsErr.message }, 400);

    const header = ['Pattern', 'Display Name', 'Consolidated Name', 'Category'];
    data.MerchantMap = [header, ...(rows || []).map((r) => [r.pattern, r.display_name, r.consolidated_name, r.category])];
  }

  if (sheets.includes('FXRates')) {
    const { data: rows, error: rowsErr } = await supabase
      .from('fx_rates')
      .select('currency, rate_to_qar, formula')
      .eq('user_id', user.id);

    if (rowsErr) return jsonResponse(request, { error: rowsErr.message }, 400);

    const header = ['Currency', 'RateToQAR', 'Formula'];
    data.FXRates = [header, ...(rows || []).map((r) => [r.currency, r.rate_to_qar, r.formula])];
  }

  if (sheets.includes('UserContext')) {
    const { data: rows, error: rowsErr } = await supabase
      .from('user_context')
      .select('type, key, value, details, date_added, source')
      .eq('user_id', user.id);

    if (rowsErr) return jsonResponse(request, { error: rowsErr.message }, 400);

    const header = ['Type', 'Key', 'Value', 'Details', 'DateAdded', 'Source'];
    data.UserContext = [header, ...(rows || []).map((r) => [r.type, r.key, r.value, r.details, r.date_added, r.source])];
  }

  if (sheets.includes('Recipients')) {
    const { data: rows, error: rowsErr } = await supabase
      .from('recipients')
      .select('phone, bank_account, short_name, long_name, id')
      .eq('user_id', user.id);

    if (rowsErr) return jsonResponse(request, { error: rowsErr.message }, 400);

    const header = ['Phone', 'BankAccount', 'ShortName', 'LongName', 'Id'];
    data.Recipients = [header, ...(rows || []).map((r) => [r.phone, r.bank_account, r.short_name, r.long_name, r.id])];
  }

  return jsonResponse(request, { success: true, data });
});
