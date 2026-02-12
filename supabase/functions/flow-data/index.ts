import { createUserClient, createAdminClient } from '../_shared/supabase.ts';
import { resolveCorsOrigin, corsHeaders } from '../_shared/cors.ts';
import { checkRateLimit, rateLimitResponse } from '../_shared/rate-limit.ts';

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

// Auto-fetch FX rates from free API (no key required)
const FX_CURRENCIES = ['USD', 'EUR', 'GBP', 'SAR', 'AED', 'BHD', 'KWD', 'OMR', 'INR', 'PKR', 'PHP', 'EGP'];

async function fetchLiveRates(): Promise<Record<string, number> | null> {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/QAR');
    if (!response.ok) return null;
    const data = await response.json();
    if (data.result !== 'success' || !data.rates) return null;

    // API returns rates FROM QAR TO other currencies.
    // We need inverse: how many QAR per 1 unit of foreign currency.
    const rates: Record<string, number> = {};
    for (const [currency, rate] of Object.entries(data.rates)) {
      if (typeof rate === 'number' && rate > 0) {
        rates[currency] = 1 / rate;
      }
    }
    return rates;
  } catch (err) {
    console.error('FX rate fetch error:', err);
    return null;
  }
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
  const authHeader = request.headers.get('authorization') || '';
  const jwt = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) {
    return jsonResponse(request, { error: 'AUTH_REQUIRED', code: 'AUTH_REQUIRED' }, 401);
  }

  // Rate limit check
  const rl = await checkRateLimit(user.id, 'flow-data');
  if (!rl.allowed) {
    return rateLimitResponse(request, corsHeaders, resolveCorsOrigin, rl.retryAfterSeconds);
  }

  const payload = await request.json().catch(() => ({}));
  const sheets = payload.sheets || ['RawLedger'];
  const lastSync: string | undefined = payload.last_sync;

  const data: Record<string, any> = {};
  const meta: Record<string, any> = {
    is_incremental: false,
    backfill_applied: false,
    uncategorized_count: 0,
    total_count: 0,
  };

  // RawLedger select columns (includes enrichment columns + recipient_id)
  const RAW_LEDGER_COLS = 'id, txn_timestamp, amount, currency, counterparty, card, direction, txn_type, category, subcategory, confidence, context, raw_text, amount_qar_approx, amount_qar, time_context, size_tier, is_salary, pattern, recipient_id';

  if (sheets.includes('RawLedger')) {
    let query = supabase
      .from('raw_ledger')
      .select(RAW_LEDGER_COLS)
      .eq('user_id', user.id)
      .order('txn_timestamp', { ascending: false });

    if (lastSync) {
      query = query.gt('created_at', lastSync);
      meta.is_incremental = true;
    }

    const { data: rows, error: rowsErr } = await query;

    if (rowsErr) return jsonResponse(request, { error: rowsErr.message }, 400);

    const fetchedRows = rows || [];
    meta.total_count = fetchedRows.length;

    const uncategorizedCount = fetchedRows.filter(
      (r) => !r.category || r.category.trim() === ''
    ).length;
    meta.uncategorized_count = uncategorizedCount;

    let finalRows = fetchedRows;
    if (fetchedRows.length > 0 && uncategorizedCount / fetchedRows.length > 0.1) {
      try {
        const adminClient = createAdminClient();
        await adminClient.rpc('categorize_from_merchant_map', { p_user_id: user.id });
        meta.backfill_applied = true;

        let refetchQuery = supabase
          .from('raw_ledger')
          .select(RAW_LEDGER_COLS)
          .eq('user_id', user.id)
          .order('txn_timestamp', { ascending: false });

        if (lastSync) {
          refetchQuery = refetchQuery.gt('created_at', lastSync);
        }

        const { data: updatedRows, error: refetchErr } = await refetchQuery;
        if (!refetchErr && updatedRows) {
          finalRows = updatedRows;
          meta.uncategorized_count = finalRows.filter(
            (r) => !r.category || r.category.trim() === ''
          ).length;
          meta.total_count = finalRows.length;
        }
      } catch (backfillErr) {
        console.error('Backfill error:', backfillErr);
      }
    }

    data.RawLedger = finalRows;
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
      .select('currency, rate_to_qar, formula, updated_at')
      .eq('user_id', user.id);
    if (rowsErr) return jsonResponse(request, { error: rowsErr.message }, 400);

    const existingRates = rows || [];

    // Check if rates are stale (>24h old) or missing
    const now = Date.now();
    const isStale = existingRates.length === 0 ||
      existingRates.some(r => {
        const updatedAt = new Date(r.updated_at).getTime();
        return (now - updatedAt) > 24 * 60 * 60 * 1000;
      });

    if (isStale) {
      const liveRates = await fetchLiveRates();
      if (liveRates) {
        const adminClient = createAdminClient();
        for (const cur of FX_CURRENCIES) {
          if (liveRates[cur]) {
            await adminClient
              .from('fx_rates')
              .upsert({
                user_id: user.id,
                currency: cur,
                rate_to_qar: parseFloat(liveRates[cur].toFixed(6)),
                formula: `auto:${liveRates[cur].toFixed(6)}`,
                updated_at: new Date().toISOString()
              }, { onConflict: 'user_id,currency' });
          }
        }
        // Always include QAR = 1
        await adminClient
          .from('fx_rates')
          .upsert({
            user_id: user.id,
            currency: 'QAR',
            rate_to_qar: 1,
            formula: 'base',
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id,currency' });

        meta.fx_refreshed = true;

        // Re-fetch after update
        const { data: updatedRows } = await supabase
          .from('fx_rates')
          .select('currency, rate_to_qar, formula')
          .eq('user_id', user.id);
        const header = ['Currency', 'RateToQAR', 'Formula'];
        data.FXRates = [header, ...(updatedRows || []).map((r: any) => [r.currency, r.rate_to_qar, r.formula])];
      } else {
        // Fallback to existing (stale) rates
        const header = ['Currency', 'RateToQAR', 'Formula'];
        data.FXRates = [header, ...existingRates.map((r: any) => [r.currency, r.rate_to_qar, r.formula])];
      }
    } else {
      const header = ['Currency', 'RateToQAR', 'Formula'];
      data.FXRates = [header, ...existingRates.map((r: any) => [r.currency, r.rate_to_qar, r.formula])];
    }
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

  if (sheets.includes('Profile')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('settings, display_name')
      .eq('user_id', user.id)
      .single();
    data.Profile = profile || { settings: {}, display_name: null };
  }

  if (sheets.includes('Goals')) {
    const { data: goals } = await supabase
      .from('goals')
      .select('id, category, monthly_limit, active')
      .eq('user_id', user.id)
      .eq('active', true);
    data.Goals = goals || [];
  }

  if (sheets.includes('Insights')) {
    const { data: insights } = await supabase
      .from('insights')
      .select('id, date, type, insights, period_start, period_end, metadata')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(10);
    data.Insights = insights || [];
  }

  if (sheets.includes('Streaks')) {
    const { data: streaks } = await supabase
      .from('streaks')
      .select('type, current_count, best_count, last_date')
      .eq('user_id', user.id);
    data.Streaks = streaks || [];
  }

  // Pre-aggregated heatmap data from hourly_spend view
  if (sheets.includes('HourlySpend')) {
    const { data: hourly } = await supabase
      .from('hourly_spend')
      .select('day_of_week, hour_of_day, txn_count, total_amount')
      .eq('user_id', user.id);
    data.HourlySpend = hourly || [];
  }

  // Server-side computations: run in parallel for performance
  const adminClient = createAdminClient();
  const serverComputations: Promise<void>[] = [];

  // Recurring transaction detection
  if (sheets.includes('Recurring')) {
    serverComputations.push(
      adminClient.rpc('detect_recurring_transactions', { p_user_id: user.id })
        .then(({ data: recurring, error: recErr }) => {
          if (recErr) { console.error('Recurring detection error:', recErr); data.Recurring = []; }
          else { data.Recurring = recurring || []; }
        })
    );
  }

  // Proactive insights (anomalies, budget warnings, new merchants)
  if (sheets.includes('Proactive')) {
    serverComputations.push(
      adminClient.rpc('generate_proactive_insights', { p_user_id: user.id })
        .then(({ data: proactive, error: proErr }) => {
          if (proErr) { console.error('Proactive insights error:', proErr); data.Proactive = []; }
          else { data.Proactive = proactive || []; }
        })
    );
  }

  // Pattern detection (Night Out, Work Expense, Splurge, Subscription)
  if (sheets.includes('Patterns')) {
    serverComputations.push(
      adminClient.rpc('detect_spending_patterns', { p_user_id: user.id })
        .then(({ data: patterns, error: patErr }) => {
          if (patErr) { console.error('Pattern detection error:', patErr); data.Patterns = []; }
          else { data.Patterns = patterns || []; }
        })
    );
  }

  // Salary detection and budget info
  if (sheets.includes('SalaryInfo')) {
    serverComputations.push(
      adminClient.rpc('detect_salary_info', { p_user_id: user.id })
        .then(({ data: salary, error: salErr }) => {
          if (salErr) { console.error('Salary detection error:', salErr); data.SalaryInfo = null; }
          else { data.SalaryInfo = salary?.[0] || null; }
        })
    );
  }

  // Forecast data (category trends + confidence stats)
  if (sheets.includes('Forecast')) {
    serverComputations.push(
      adminClient.rpc('generate_forecast_data', { p_user_id: user.id })
        .then(({ data: forecast, error: foreErr }) => {
          if (foreErr) { console.error('Forecast data error:', foreErr); data.Forecast = null; }
          else { data.Forecast = forecast || null; }
        })
    );
  }

  // Chart aggregation data (daily, weekly, top merchants, comparison, summary)
  // Uses full data range for initial load; client re-aggregates for period changes
  if (sheets.includes('ChartData')) {
    serverComputations.push(
      (async () => {
        // Get user's full date range
        const { data: dateRange } = await adminClient
          .from('raw_ledger')
          .select('txn_timestamp')
          .eq('user_id', user.id)
          .order('txn_timestamp', { ascending: true })
          .limit(1)
          .single();

        if (dateRange?.txn_timestamp) {
          const startDate = dateRange.txn_timestamp;
          const endDate = new Date().toISOString();

          const { data: chartData, error: chartErr } = await adminClient
            .rpc('get_chart_data', {
              p_user_id: user.id,
              p_start: startDate,
              p_end: endDate
            });

          if (chartErr) {
            console.error('Chart data error:', chartErr);
            data.ChartData = null;
          } else {
            data.ChartData = chartData || null;
          }
        } else {
          data.ChartData = null;
        }
      })()
    );
  }

  // Daily digest (personalized daily briefing)
  if (sheets.includes('DailyDigest')) {
    serverComputations.push(
      adminClient.rpc('generate_daily_digest', { p_user_id: user.id })
        .then(({ data: digest, error: digErr }) => {
          if (digErr) { console.error('Daily digest error:', digErr); data.DailyDigest = null; }
          else { data.DailyDigest = digest || null; }
        })
    );
  }

  // Wait for all server computations to complete
  await Promise.all(serverComputations);

  return jsonResponse(request, { success: true, data, meta });
});
