import { createAdminClient } from '../_shared/supabase.ts';
import { normalizeCounterparty, buildIdempotencyKey } from '../_shared/utils.ts';
import { resolveCorsOrigin, corsHeaders } from '../_shared/cors.ts';
import { checkRateLimit, rateLimitResponse } from '../_shared/rate-limit.ts';

// Subcategory → parent mapping (mirrors flow-sms)
const SUBCAT_TO_PARENT: Record<string, string> = {
  'Groceries': 'Essentials', 'Dining': 'Lifestyle', 'Coffee': 'Lifestyle',
  'Delivery': 'Lifestyle', 'Shopping': 'Lifestyle', 'Transport': 'Essentials',
  'Health': 'Essentials', 'Bills': 'Essentials', 'Travel': 'Lifestyle',
  'Entertainment': 'Lifestyle', 'Bars & Nightlife': 'Lifestyle',
  'Bars & Hotels': 'Lifestyle', 'Hobbies': 'Lifestyle', 'Transfer': 'Financial',
  'Transfers': 'Financial', 'Family': 'Family', 'Family Transfers': 'Family',
  'Fees': 'Financial', 'Other': 'Other',
};

function jsonResponse(request: Request, body: unknown, status = 200) {
  const origin = resolveCorsOrigin(request);
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    const origin = resolveCorsOrigin(req);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'Method not allowed' }, 405);
  }

  try {
    // Auth: extract JWT
    const authHeader = req.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return jsonResponse(req, { error: 'Missing authorization' }, 401);
    }
    const jwt = authHeader.replace('Bearer ', '');
    const admin = createAdminClient();
    const { data: { user }, error: authErr } = await admin.auth.getUser(jwt);
    if (authErr || !user) {
      return jsonResponse(req, { error: 'Invalid token' }, 401);
    }

    // Rate limiting
    const rl = await checkRateLimit(user.id, 'flow-import');
    if (!rl.allowed) {
      return rateLimitResponse(req, corsHeaders, resolveCorsOrigin, rl.retryAfterSeconds);
    }

    const body = await req.json();
    const rows: Array<{
      date: string;
      amount: number;
      currency?: string;
      counterparty: string;
      direction?: string;
      category?: string;
      notes?: string;
    }> = body.rows || [];

    if (!rows.length || rows.length > 500) {
      return jsonResponse(req, { error: 'Provide 1-500 rows' }, 400);
    }

    // Load merchant_map for auto-categorization
    const { data: merchants } = await admin
      .from('merchant_map')
      .select('counterparty, merchant_type, consolidated')
      .eq('user_id', user.id);
    const merchantMap = new Map(
      (merchants || []).map((m: { counterparty: string; merchant_type: string; consolidated: string }) => [
        m.counterparty.toLowerCase(), { type: m.merchant_type, consolidated: m.consolidated }
      ])
    );

    let imported = 0;
    let skipped = 0;
    let categorized = 0;
    const errors: Array<{ row: number; reason: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        // Validate required fields
        if (!row.date || !row.amount || !row.counterparty) {
          errors.push({ row: i, reason: 'Missing date, amount, or counterparty' });
          continue;
        }

        const amount = Math.abs(Number(row.amount));
        if (!Number.isFinite(amount) || amount <= 0) {
          errors.push({ row: i, reason: 'Invalid amount' });
          continue;
        }

        const ts = new Date(row.date);
        if (isNaN(ts.getTime())) {
          errors.push({ row: i, reason: 'Invalid date' });
          continue;
        }

        const currency = (row.currency || 'QAR').toUpperCase();
        const direction = (row.direction || 'OUT').toUpperCase();
        const counterparty = normalizeCounterparty(row.counterparty);

        // Build idempotency key from counterparty + amount + timestamp
        const idempKey = `csv|${counterparty.toLowerCase().replace(/\s+/g, '')}|${amount}|${ts.toISOString().slice(0, 16)}`;

        // Check for duplicates
        const { data: existing } = await admin
          .from('raw_ledger')
          .select('id')
          .eq('user_id', user.id)
          .eq('idempotency_key', idempKey)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }

        // Categorize: use merchant_map first, then user-provided category
        let category = row.category || null;
        let subcategory = category;
        let confidence = row.category ? 'user' : null;

        const mapKey = counterparty.toLowerCase();
        const mapMatch = merchantMap.get(mapKey);
        if (mapMatch) {
          subcategory = mapMatch.type;
          category = SUBCAT_TO_PARENT[subcategory] || 'Other';
          confidence = 'merchant_map';
          categorized++;
        } else if (!category) {
          category = 'Other';
          subcategory = 'Uncategorized';
          confidence = null;
        }

        const insertPayload = {
          user_id: user.id,
          txn_timestamp: ts.toISOString(),
          amount,
          currency,
          amount_qar_approx: currency === 'QAR' ? amount : null,
          counterparty,
          card: null,
          direction,
          txn_type: 'import',
          category,
          subcategory,
          confidence,
          context: { source: 'csv', notes: row.notes || null },
          raw_text: `[CSV] ${counterparty} ${currency} ${amount}`,
          net: direction === 'OUT' ? -amount : amount,
          idempotency_key: idempKey,
          ai_model: null,
          ai_mode: 'csv',
        };

        const { error: insertErr } = await admin.from('raw_ledger').insert(insertPayload);
        if (insertErr) throw new Error(insertErr.message);

        imported++;
      } catch (err) {
        errors.push({ row: i, reason: (err as Error).message });
      }
    }

    return jsonResponse(req, { imported, skipped, categorized, errors });
  } catch (err) {
    console.error('flow-import error:', err);
    return jsonResponse(req, { error: (err as Error).message }, 500);
  }
});
