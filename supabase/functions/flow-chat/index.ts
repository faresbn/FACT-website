import { createUserClient, createAdminClient } from '../_shared/supabase.ts';
import { resolveCorsOrigin, corsHeaders } from '../_shared/cors.ts';
import { checkRateLimit, rateLimitResponse } from '../_shared/rate-limit.ts';

const MODEL = 'claude-sonnet-4-20250514';

const promptCache = new Map<string, { prompt: string; expiry: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

const TOOLS = [
  {
    name: 'query_transactions',
    description: 'Search the user\'s transactions with flexible filters. Use this when the user asks about specific transactions, merchants, categories, date ranges, or amounts. Returns up to 50 matching transactions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        merchant: { type: 'string', description: 'Filter by merchant/counterparty name (partial match, case-insensitive)' },
        category: { type: 'string', description: 'Filter by category (e.g., Dining, Groceries, Transport)' },
        direction: { type: 'string', enum: ['IN', 'OUT'], description: 'Filter by direction: IN (income) or OUT (expense)' },
        min_amount: { type: 'number', description: 'Minimum amount in QAR' },
        max_amount: { type: 'number', description: 'Maximum amount in QAR' },
        start_date: { type: 'string', description: 'Start date (ISO 8601, e.g., 2026-01-01)' },
        end_date: { type: 'string', description: 'End date (ISO 8601, e.g., 2026-01-31)' },
        limit: { type: 'number', description: 'Max results to return (default 20, max 50)' },
      },
      required: [],
    },
  },
  {
    name: 'query_trends',
    description: 'Get spending trends and aggregations. Use this when the user asks about trends, comparisons between periods, or category breakdowns over time.',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: 'Aggregation period' },
        category: { type: 'string', description: 'Filter to a specific category (optional)' },
        months_back: { type: 'number', description: 'How many months of history (default 3, max 12)' },
      },
      required: ['period'],
    },
  },
  {
    name: 'set_goal',
    description: 'Create or update a budget goal for a spending category. Use when the user says things like "set a budget" or "limit my spending on X".',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'The spending category (e.g., Dining, Groceries, Shopping)' },
        monthly_limit: { type: 'number', description: 'Monthly spending limit in QAR' },
      },
      required: ['category', 'monthly_limit'],
    },
  },
  {
    name: 'remember',
    description: 'Save user preferences, corrections, or notes for future reference. Use when the user asks you to remember something about their finances, merchants, or preferences.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', enum: ['preference', 'correction', 'payee', 'rule', 'income'], description: 'Type of context to save' },
        key: { type: 'string', description: 'What this is about (e.g., merchant name, preference key)' },
        value: { type: 'string', description: 'The value to remember' },
        details: { type: 'string', description: 'Additional details or notes' },
      },
      required: ['type', 'key', 'value'],
    },
  },
  {
    name: 'compare_periods',
    description: 'Compare spending between two time periods. Use when the user asks to compare months, weeks, or date ranges (e.g., "compare January vs February", "how does this month compare to last month").',
    input_schema: {
      type: 'object' as const,
      properties: {
        current_start: { type: 'string', description: 'Start of current period (ISO 8601)' },
        current_end: { type: 'string', description: 'End of current period (ISO 8601)' },
        previous_start: { type: 'string', description: 'Start of comparison period (ISO 8601, defaults to same-length period before current)' },
        previous_end: { type: 'string', description: 'End of comparison period (ISO 8601)' },
        category: { type: 'string', description: 'Optional: filter to a specific category' },
      },
      required: ['current_start', 'current_end'],
    },
  },
  {
    name: 'find_anomalies',
    description: 'Find unusual or outlier transactions. Use when the user asks about unusual spending, surprises, large purchases, or anything out of the ordinary.',
    input_schema: {
      type: 'object' as const,
      properties: {
        days_back: { type: 'number', description: 'How many days to look back (default 30, max 90)' },
      },
      required: [],
    },
  },
  {
    name: 'suggest_savings',
    description: 'Analyze spending and suggest specific areas to save money. Use when the user asks "how can I save", "where am I overspending", or wants budget optimization advice.',
    input_schema: {
      type: 'object' as const,
      properties: {
        target_savings: { type: 'number', description: 'Optional target savings amount in QAR per month' },
      },
      required: [],
    },
  },
  {
    name: 'forecast_category',
    description: 'Get a spending forecast for a specific category based on historical trends. Use when the user asks about future spending projections or "how much will I spend on X".',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'The spending category to forecast (e.g., Dining, Groceries)' },
      },
      required: ['category'],
    },
  },
  {
    name: 'explain_pattern',
    description: 'Explain a detected spending pattern with specific examples. Use when the user asks about their spending patterns, habits, or "why do I spend so much on weekends" etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern_type: { type: 'string', enum: ['Night Out', 'Work Expense', 'Splurge', 'Subscription'], description: 'The pattern type to explain' },
      },
      required: ['pattern_type'],
    },
  },
];

async function executeTool(supabase: any, userId: string, name: string, input: any): Promise<string> {
  switch (name) {
    case 'query_transactions': {
      let query = supabase
        .from('raw_ledger')
        .select('txn_timestamp, amount, currency, counterparty, direction, category, subcategory')
        .eq('user_id', userId)
        .order('txn_timestamp', { ascending: false });
      if (input.merchant) query = query.ilike('counterparty', `%${input.merchant}%`);
      if (input.category) query = query.or(`category.eq.${input.category},subcategory.eq.${input.category}`);
      if (input.direction) query = query.eq('direction', input.direction);
      if (input.min_amount) query = query.gte('amount', input.min_amount);
      if (input.max_amount) query = query.lte('amount', input.max_amount);
      if (input.start_date) query = query.gte('txn_timestamp', input.start_date);
      if (input.end_date) query = query.lte('txn_timestamp', input.end_date);
      const limit = Math.min(input.limit || 20, 50);
      query = query.limit(limit);
      const { data, error } = await query;
      if (error) return JSON.stringify({ error: error.message });
      const rows = (data || []).map((r: any) => {
        const date = new Date(r.txn_timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const dir = r.direction === 'IN' ? '+' : '-';
        return `${date} ${dir}QAR ${Number(r.amount).toFixed(2)} ${r.counterparty || 'Unknown'} [${r.subcategory || r.category || 'Uncategorized'}]`;
      });
      const total = (data || []).reduce((s: number, r: any) => s + Number(r.amount), 0);
      return `Found ${rows.length} transactions (total QAR ${total.toFixed(2)}):\n${rows.join('\n')}`;
    }
    case 'query_trends': {
      const monthsBack = Math.min(input.months_back || 3, 12);
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - monthsBack);
      if (input.period === 'monthly') {
        let query = supabase.from('monthly_category_spend').select('month, category, subcategory, total_amount, txn_count').eq('user_id', userId).eq('direction', 'OUT').gte('month', startDate.toISOString()).order('month', { ascending: false });
        if (input.category) query = query.or(`category.eq.${input.category},subcategory.eq.${input.category}`);
        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });
        const byMonth: Record<string, { total: number; count: number; categories: Record<string, number> }> = {};
        for (const row of (data || [])) {
          const m = new Date(row.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
          if (!byMonth[m]) byMonth[m] = { total: 0, count: 0, categories: {} };
          byMonth[m].total += Number(row.total_amount);
          byMonth[m].count += Number(row.txn_count);
          const cat = row.subcategory || row.category;
          byMonth[m].categories[cat] = (byMonth[m].categories[cat] || 0) + Number(row.total_amount);
        }
        const lines = Object.entries(byMonth).map(([month, d]) => {
          const topCats = Object.entries(d.categories).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, a]) => `${c}: QAR ${a.toFixed(0)}`).join(', ');
          return `${month}: QAR ${d.total.toFixed(0)} (${d.count} txns) \u2014 ${topCats}`;
        });
        return `Monthly spending trends (${monthsBack} months):\n${lines.join('\n')}`;
      }
      if (input.period === 'weekly') {
        let query = supabase.from('weekly_category_spend').select('week, subcategory, total_amount, txn_count').eq('user_id', userId).gte('week', startDate.toISOString()).order('week', { ascending: false });
        if (input.category) query = query.eq('subcategory', input.category);
        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });
        const byWeek: Record<string, number> = {};
        for (const row of (data || [])) {
          const w = new Date(row.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          byWeek[w] = (byWeek[w] || 0) + Number(row.total_amount);
        }
        const lines = Object.entries(byWeek).map(([week, total]) => `Week of ${week}: QAR ${total.toFixed(0)}`);
        return `Weekly spending trends:\n${lines.join('\n')}`;
      }
      const { data, error } = await supabase.from('daily_spend').select('day, total_amount, txn_count').eq('user_id', userId).eq('direction', 'OUT').gte('day', startDate.toISOString()).order('day', { ascending: false }).limit(90);
      if (error) return JSON.stringify({ error: error.message });
      const lines = (data || []).slice(0, 30).map((r: any) => {
        const d = new Date(r.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `${d}: QAR ${Number(r.total_amount).toFixed(0)} (${r.txn_count} txns)`;
      });
      return `Daily spending (last 30 days):\n${lines.join('\n')}`;
    }
    case 'set_goal': {
      const { data: existing } = await supabase.from('goals').select('id').eq('user_id', userId).eq('category', input.category).eq('active', true).single();
      if (existing) {
        await supabase.from('goals').update({ monthly_limit: input.monthly_limit }).eq('id', existing.id);
        return `Updated budget goal: ${input.category} limited to QAR ${input.monthly_limit}/month.`;
      } else {
        await supabase.from('goals').insert({ user_id: userId, category: input.category, monthly_limit: input.monthly_limit, active: true });
        return `Created new budget goal: ${input.category} limited to QAR ${input.monthly_limit}/month.`;
      }
    }
    case 'remember': {
      await supabase.from('user_context').insert({ user_id: userId, type: input.type, key: input.key, value: input.value, details: input.details || '', date_added: new Date().toISOString(), source: 'chat' });
      promptCache.delete(userId);
      return `Remembered: ${input.key} -> ${input.value}`;
    }
    case 'compare_periods': {
      const curStart = input.current_start;
      const curEnd = input.current_end;
      const curMs = new Date(curEnd).getTime() - new Date(curStart).getTime();
      const prevEnd = input.previous_end || new Date(new Date(curStart).getTime() - 1).toISOString();
      const prevStart = input.previous_start || new Date(new Date(prevEnd).getTime() - curMs).toISOString();

      const buildQuery = (start: string, end: string) => {
        let q = supabase.from('raw_ledger')
          .select('category, subcategory, amount, currency, counterparty, amount_qar')
          .eq('user_id', userId).eq('direction', 'OUT')
          .gte('txn_timestamp', start).lte('txn_timestamp', end);
        if (input.category) q = q.or(`category.eq.${input.category},subcategory.eq.${input.category}`);
        return q;
      };
      const [{ data: curRows }, { data: prevRows }] = await Promise.all([buildQuery(curStart, curEnd), buildQuery(prevStart, prevEnd)]);

      const aggregate = (rows: any[]) => {
        const byCat: Record<string, number> = {};
        let total = 0;
        for (const r of rows) {
          const amt = Number(r.amount_qar || r.amount);
          const cat = r.subcategory || r.category || 'Other';
          byCat[cat] = (byCat[cat] || 0) + amt;
          total += amt;
        }
        return { byCat, total, count: rows.length };
      };
      const cur = aggregate(curRows || []);
      const prev = aggregate(prevRows || []);

      const allCats = [...new Set([...Object.keys(cur.byCat), ...Object.keys(prev.byCat)])];
      const catLines = allCats.sort((a, b) => (cur.byCat[b] || 0) - (cur.byCat[a] || 0)).map(cat => {
        const c = cur.byCat[cat] || 0;
        const p = prev.byCat[cat] || 0;
        const pctChange = p > 0 ? ((c - p) / p * 100).toFixed(0) : (c > 0 ? '+∞' : '0');
        const arrow = c > p ? '↑' : c < p ? '↓' : '→';
        return `${cat}: QAR ${c.toFixed(0)} vs ${p.toFixed(0)} (${arrow}${pctChange}%)`;
      });

      const totalChange = prev.total > 0 ? ((cur.total - prev.total) / prev.total * 100).toFixed(1) : 'N/A';
      return `Period comparison:\nCurrent: QAR ${cur.total.toFixed(0)} (${cur.count} txns)\nPrevious: QAR ${prev.total.toFixed(0)} (${prev.count} txns)\nChange: ${totalChange}%\n\nBy category:\n${catLines.join('\n')}`;
    }
    case 'find_anomalies': {
      const daysBack = Math.min(input.days_back || 30, 90);
      const since = new Date();
      since.setDate(since.getDate() - daysBack);

      const { data: rows } = await supabase.from('raw_ledger')
        .select('txn_timestamp, amount, currency, counterparty, category, subcategory, amount_qar, pattern, size_tier')
        .eq('user_id', userId).eq('direction', 'OUT')
        .gte('txn_timestamp', since.toISOString())
        .order('amount_qar', { ascending: false });

      const txns = rows || [];
      if (!txns.length) return 'No transactions found in this period.';

      const amounts = txns.map((r: any) => Number(r.amount_qar || r.amount));
      const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length;
      const variance = amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / amounts.length;
      const stdDev = Math.sqrt(variance);
      const threshold = mean + 2 * stdDev;

      // Find statistical outliers
      const outliers = txns.filter((r: any) => Number(r.amount_qar || r.amount) > threshold);

      // Find merchant anomalies: merchants with only 1 transaction (new merchants)
      const merchantCounts: Record<string, number> = {};
      for (const r of txns) { merchantCounts[r.counterparty] = (merchantCounts[r.counterparty] || 0) + 1; }
      const newMerchants = txns.filter((r: any) => merchantCounts[r.counterparty] === 1 && Number(r.amount_qar || r.amount) > mean);

      const formatTxn = (r: any) => {
        const d = new Date(r.txn_timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `${d}: QAR ${Number(r.amount_qar || r.amount).toFixed(0)} at ${r.counterparty} [${r.subcategory || r.category}]${r.pattern ? ` (${r.pattern})` : ''}`;
      };

      const lines: string[] = [];
      lines.push(`Stats: mean QAR ${mean.toFixed(0)}, std dev QAR ${stdDev.toFixed(0)}, threshold QAR ${threshold.toFixed(0)}`);
      if (outliers.length) {
        lines.push(`\n**${outliers.length} large outlier${outliers.length > 1 ? 's' : ''}:**`);
        lines.push(...outliers.slice(0, 10).map(formatTxn));
      }
      if (newMerchants.length) {
        lines.push(`\n**${newMerchants.length} new merchant${newMerchants.length > 1 ? 's' : ''} (above average spend):**`);
        lines.push(...newMerchants.slice(0, 10).map(formatTxn));
      }
      if (!outliers.length && !newMerchants.length) {
        lines.push('\nNo anomalies detected — spending looks consistent.');
      }
      return lines.join('\n');
    }
    case 'suggest_savings': {
      const monthsBack = 3;
      const since = new Date();
      since.setMonth(since.getMonth() - monthsBack);

      const { data: monthly } = await supabase.from('monthly_category_spend')
        .select('month, category, subcategory, total_amount, txn_count')
        .eq('user_id', userId).eq('direction', 'OUT')
        .gte('month', since.toISOString());

      const discretionary = ['Dining', 'Coffee', 'Delivery', 'Shopping', 'Entertainment', 'Bars & Nightlife', 'Travel', 'Hobbies'];
      const catTotals: Record<string, { total: number; count: number; months: number }> = {};
      const monthSet = new Set<string>();

      for (const r of (monthly || [])) {
        const cat = r.subcategory || r.category;
        const m = new Date(r.month).toISOString().slice(0, 7);
        monthSet.add(m);
        if (!catTotals[cat]) catTotals[cat] = { total: 0, count: 0, months: 0 };
        catTotals[cat].total += Number(r.total_amount);
        catTotals[cat].count += Number(r.txn_count);
      }
      const numMonths = Math.max(monthSet.size, 1);

      const ranked = Object.entries(catTotals)
        .filter(([cat]) => discretionary.some(d => cat.toLowerCase().includes(d.toLowerCase())))
        .map(([cat, d]) => ({
          category: cat,
          monthlyAvg: d.total / numMonths,
          total: d.total,
          count: d.count,
          savingsPotential: d.total / numMonths * 0.3, // estimate 30% reduction possible
        }))
        .sort((a, b) => b.monthlyAvg - a.monthlyAvg);

      if (!ranked.length) return 'No discretionary spending found to optimize.';

      const totalDiscretionary = ranked.reduce((s, r) => s + r.monthlyAvg, 0);
      const target = input.target_savings || totalDiscretionary * 0.2;
      let cumSavings = 0;
      const suggestions: string[] = [];

      for (const r of ranked) {
        const reduction = Math.min(r.savingsPotential, target - cumSavings);
        if (reduction <= 0) break;
        const pct = ((reduction / r.monthlyAvg) * 100).toFixed(0);
        suggestions.push(`**${r.category}**: QAR ${r.monthlyAvg.toFixed(0)}/mo avg → save ~QAR ${reduction.toFixed(0)}/mo (${pct}% reduction, ${r.count} txns over ${numMonths} months)`);
        cumSavings += reduction;
      }

      return `Savings analysis (${numMonths}-month avg):\nTotal discretionary: QAR ${totalDiscretionary.toFixed(0)}/mo\nTarget savings: QAR ${target.toFixed(0)}/mo\nAchievable: QAR ${cumSavings.toFixed(0)}/mo\n\nSuggestions:\n${suggestions.join('\n')}`;
    }
    case 'forecast_category': {
      const admin = createAdminClient();
      const { data: forecast, error: foreErr } = await admin.rpc('generate_forecast_data', { p_user_id: userId });
      if (foreErr) return `Forecast error: ${foreErr.message}`;
      if (!forecast) return 'No forecast data available yet.';

      const parsed = typeof forecast === 'string' ? JSON.parse(forecast) : forecast;
      const trends = parsed.categoryTrends || parsed[0]?.categoryTrends || [];
      const confidence = parsed.confidenceStats || parsed[0]?.confidenceStats || {};

      const cat = input.category.toLowerCase();
      const match = trends.find((t: any) => (t.category || '').toLowerCase() === cat || (t.subcategory || '').toLowerCase() === cat);

      if (!match) {
        const available = trends.map((t: any) => t.subcategory || t.category).join(', ');
        return `No forecast data for "${input.category}". Available categories: ${available}`;
      }

      const lines = [
        `**${match.subcategory || match.category} Forecast**`,
        `Monthly average: QAR ${Number(match.avg_monthly || match.avgMonthly || 0).toFixed(0)}`,
        `Trend: ${match.trend || 'stable'} (${Number(match.trend_pct || match.trendPct || 0).toFixed(1)}% ${match.trend === 'increasing' ? '↑' : match.trend === 'decreasing' ? '↓' : '→'})`,
        match.projected_next_month || match.projectedNextMonth ? `Projected next month: QAR ${Number(match.projected_next_month || match.projectedNextMonth).toFixed(0)}` : '',
      ].filter(Boolean);

      if (confidence.overall_confidence || confidence.overallConfidence) {
        lines.push(`\nForecast confidence: ${confidence.overall_confidence || confidence.overallConfidence}`);
      }
      return lines.join('\n');
    }
    case 'explain_pattern': {
      const patternType = input.pattern_type;
      const since = new Date();
      since.setDate(since.getDate() - 90);

      const { data: txns } = await supabase.from('raw_ledger')
        .select('txn_timestamp, amount, currency, counterparty, category, subcategory, amount_qar, time_context')
        .eq('user_id', userId).eq('pattern', patternType)
        .gte('txn_timestamp', since.toISOString())
        .order('txn_timestamp', { ascending: false })
        .limit(30);

      if (!txns?.length) return `No "${patternType}" pattern transactions found in the last 90 days.`;

      const amounts = txns.map((r: any) => Number(r.amount_qar || r.amount));
      const total = amounts.reduce((s, v) => s + v, 0);
      const avg = total / amounts.length;

      // Analyze timing
      const dayDist: Record<string, number> = {};
      const hourDist: Record<number, number> = {};
      for (const r of txns) {
        const d = new Date(r.txn_timestamp);
        const day = d.toLocaleDateString('en-US', { weekday: 'long' });
        dayDist[day] = (dayDist[day] || 0) + 1;
        hourDist[d.getHours()] = (hourDist[d.getHours()] || 0) + 1;
      }
      const topDay = Object.entries(dayDist).sort((a, b) => b[1] - a[1])[0];
      const topHour = Object.entries(hourDist).sort((a, b) => b[1] - a[1])[0];

      // Top merchants
      const merchantTotals: Record<string, { total: number; count: number }> = {};
      for (const r of txns) {
        const m = r.counterparty || 'Unknown';
        if (!merchantTotals[m]) merchantTotals[m] = { total: 0, count: 0 };
        merchantTotals[m].total += Number(r.amount_qar || r.amount);
        merchantTotals[m].count++;
      }
      const topMerchants = Object.entries(merchantTotals).sort((a, b) => b[1].total - a[1].total).slice(0, 5);

      const lines = [
        `**"${patternType}" Pattern (last 90 days)**`,
        `${txns.length} transactions, total QAR ${total.toFixed(0)}, avg QAR ${avg.toFixed(0)}`,
        `\nMost common day: ${topDay?.[0]} (${topDay?.[1]} times)`,
        `Most common hour: ${topHour?.[0]}:00 (${topHour?.[1]} times)`,
        `\nTop merchants:`,
        ...topMerchants.map(([m, d]) => `  ${m}: QAR ${d.total.toFixed(0)} (${d.count}x)`),
        `\nRecent examples:`,
        ...txns.slice(0, 5).map((r: any) => {
          const d = new Date(r.txn_timestamp).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          return `  ${d}: QAR ${Number(r.amount_qar || r.amount).toFixed(0)} at ${r.counterparty}`;
        }),
      ];
      return lines.join('\n');
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

function sseResponse(request: Request, stream: ReadableStream) {
  const origin = resolveCorsOrigin(request);
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', ...corsHeaders(origin) } });
}

function jsonResponse(request: Request, body: unknown, status = 200) {
  const origin = resolveCorsOrigin(request);
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
}

async function buildSystemPrompt(supabase: any, userId: string): Promise<string> {
  const [periodRes, merchantRes, contextRes, recipientRes, profileRes, goalsRes, digestRes] = await Promise.all([
    supabase.from('period_summary').select('*').eq('user_id', userId).order('month', { ascending: false }).limit(6),
    supabase.from('merchant_analytics').select('*').eq('user_id', userId).order('total_spent', { ascending: false }).limit(20),
    supabase.from('user_context').select('type, key, value, details').eq('user_id', userId),
    supabase.from('recipients').select('short_name, long_name').eq('user_id', userId),
    supabase.from('profiles').select('settings, display_name').eq('user_id', userId).single(),
    supabase.from('goals').select('category, monthly_limit').eq('user_id', userId).eq('active', true),
    supabase.from('daily_digests').select('content').eq('user_id', userId).eq('digest_date', new Date().toISOString().slice(0, 10)).single(),
  ]);
  const periods = periodRes.data || [];
  const merchants = merchantRes.data || [];
  const context = contextRes.data || [];
  const recipients = recipientRes.data || [];
  const profile = profileRes.data;
  const goals = goalsRes.data || [];
  const digest = digestRes.data?.content;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { data: currentMonthBreakdown } = await supabase.from('monthly_category_spend').select('*').eq('user_id', userId).gte('month', monthStart).eq('direction', 'OUT');
  const periodSummary = periods.map((p: any) => {
    const month = new Date(p.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return `${month}: Income QAR ${Number(p.total_income).toFixed(0)}, Expenses QAR ${Number(p.total_expense).toFixed(0)}, Net QAR ${Number(p.net).toFixed(0)} (${p.expense_count} transactions)`;
  }).join('\n');
  const merchantSummary = merchants.slice(0, 15).map((m: any) => `${m.merchant}: QAR ${Number(m.total_spent).toFixed(0)} (${m.txn_count} visits, avg QAR ${Number(m.avg_spend).toFixed(0)}) [${m.subcategory}]`).join('\n');
  const currentBreakdown = (currentMonthBreakdown || []).map((c: any) => `${c.subcategory}: QAR ${Number(c.total_amount).toFixed(0)} (${c.txn_count} txns)`).join('\n');
  const settings = profile?.settings || {};
  const profileInfo = [settings.salary_amount ? `Monthly salary: QAR ${settings.salary_amount}` : '', settings.salary_day ? `Salary day: ${settings.salary_day}th` : '', settings.monthly_budget ? `Monthly budget: QAR ${settings.monthly_budget}` : ''].filter(Boolean).join('\n');
  const goalsSummary = goals.map((g: any) => `${g.category}: QAR ${g.monthly_limit}/month`).join(', ');
  const contextSummary = context.map((c: any) => `${c.type}: ${c.key} -> ${c.value}`).join('\n');
  const recipientSummary = recipients.map((r: any) => `${r.short_name}${r.long_name ? ' (' + r.long_name + ')' : ''}`).join(', ');

  return `You are the AI financial advisor for FACT/Flow, a personal finance intelligence system based in Qatar.

You have TOOLS to query the user's financial data dynamically. Use them instead of guessing \u2014 they give you real-time, accurate data.

Today is ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.

== MONTHLY OVERVIEW (last 6 months) ==
${periodSummary || 'No data yet'}

== THIS MONTH'S SPENDING BREAKDOWN ==
${currentBreakdown || 'No spending yet this month'}

== TOP MERCHANTS BY SPENDING ==
${merchantSummary || 'No merchant data'}

== FINANCIAL PROFILE ==
${profileInfo || 'Not configured'}

== BUDGET GOALS ==
${goalsSummary || 'No goals set'}

== USER CONTEXT & CORRECTIONS ==
${contextSummary || 'None'}

== KNOWN RECIPIENTS ==
${recipientSummary || 'None'}

== TODAY'S DIGEST ==
${digest ? `Budget: ${digest.budget_pct_used || 0}% used, burn rate QAR ${Number(digest.daily_burn_rate || 0).toFixed(0)}/day, ${digest.days_in_month - digest.days_elapsed} days left\n${digest.top_category_change?.category ? `Biggest change: ${digest.top_category_change.category} ${digest.top_category_change.change_pct > 0 ? '↑' : '↓'}${Math.abs(digest.top_category_change.change_pct)}% vs last month` : ''}\n${digest.next_bill?.merchant ? `Next bill: ${digest.next_bill.merchant} QAR ${digest.next_bill.amount} on ${digest.next_bill.expected_date}` : ''}\n${digest.anomaly_count > 0 ? `${digest.anomaly_count} anomalies detected` : ''}` : 'Not generated yet'}

== GOAL PROGRESS ==
${goals.length > 0 ? (await (async () => {
  const { data: curSpend } = await supabase.from('monthly_category_spend').select('subcategory, total_amount').eq('user_id', userId).gte('month', monthStart).eq('direction', 'OUT');
  const spendByCat: Record<string, number> = {};
  for (const s of (curSpend || [])) { spendByCat[s.subcategory] = (spendByCat[s.subcategory] || 0) + Number(s.total_amount); }
  return goals.map((g: any) => {
    const spent = spendByCat[g.category] || 0;
    const pct = g.monthly_limit > 0 ? (spent / g.monthly_limit * 100).toFixed(0) : '0';
    const status = Number(pct) > 100 ? 'OVER' : Number(pct) > 80 ? 'WARNING' : 'on-track';
    return `${g.category}: QAR ${spent.toFixed(0)}/${g.monthly_limit} (${pct}%) — ${status}`;
  }).join('\n');
})()) : 'No goals set'}

Guidelines:
- Use query_transactions to search for specific transactions when the user asks about merchants, dates, or amounts.
- Use query_trends for trend analysis and period comparisons.
- Use compare_periods when the user wants to compare two specific time periods side by side.
- Use find_anomalies when the user asks about unusual spending or surprises.
- Use suggest_savings when the user wants to know where they can cut costs.
- Use forecast_category when the user asks about projected future spending.
- Use explain_pattern when the user asks about spending habits or patterns.
- Use set_goal when the user wants to set or update a budget limit.
- Use remember when the user asks you to note or remember something.
- Proactively reference today's digest and goal progress when relevant.
- Lead with the insight, then supporting data. No filler.
- Reference specific QAR amounts and merchant names.
- Currency is QAR unless otherwise specified. The user is in Qatar.
- Be conversational but efficient. Use markdown for structure.`;
}

async function getCachedSystemPrompt(supabase: any, userId: string, forceRefresh: boolean): Promise<string> {
  if (!forceRefresh) {
    const cached = promptCache.get(userId);
    if (cached && Date.now() < cached.expiry) return cached.prompt;
  }
  const prompt = await buildSystemPrompt(supabase, userId);
  promptCache.set(userId, { prompt, expiry: Date.now() + CACHE_TTL_MS });
  if (promptCache.size > 100) {
    const oldest = [...promptCache.entries()].sort((a, b) => a[1].expiry - b[1].expiry).slice(0, promptCache.size - 50);
    for (const [key] of oldest) promptCache.delete(key);
  }
  return prompt;
}

async function callClaude(apiKey: string, systemPrompt: string, messages: any[], useTools: boolean) {
  const body: any = { model: MODEL, max_tokens: 4096, system: systemPrompt, messages };
  if (useTools) body.tools = TOOLS;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude error: ${response.status} ${errText}`);
  }
  return await response.json();
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    const origin = resolveCorsOrigin(request);
    return new Response('ok', { headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed' }, 405);

  const supabase = createUserClient(request);
  const authHeader = request.headers.get('authorization') || '';
  const jwt = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) return jsonResponse(request, { error: 'AUTH_REQUIRED', code: 'AUTH_REQUIRED' }, 401);

  // Rate limit check
  const rl = await checkRateLimit(user.id, 'flow-chat');
  if (!rl.allowed) {
    return rateLimitResponse(request, corsHeaders, resolveCorsOrigin, rl.retryAfterSeconds);
  }

  const payload = await request.json().catch(() => ({}));
  const message = payload.message || '';
  const conversationId = payload.conversation_id || null;
  const action = payload.action || 'chat';
  const freshData = payload.fresh_data === true;

  if (!message && action === 'chat') return jsonResponse(request, { error: 'Missing message' }, 400);

  if (action === 'list_conversations') {
    const { data: convos } = await supabase.from('conversations').select('id, title, updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(20);
    return jsonResponse(request, { conversations: convos || [] });
  }
  if (action === 'get_conversation') {
    if (!conversationId) return jsonResponse(request, { error: 'Missing conversation_id' }, 400);
    const { data: msgs } = await supabase.from('messages').select('id, role, content, created_at').eq('conversation_id', conversationId).order('created_at', { ascending: true });
    return jsonResponse(request, { messages: msgs || [] });
  }
  if (action === 'delete_conversation') {
    if (!conversationId) return jsonResponse(request, { error: 'Missing conversation_id' }, 400);
    await supabase.from('conversations').delete().eq('id', conversationId).eq('user_id', user.id);
    return jsonResponse(request, { success: true });
  }

  if (/^(remember|note)\b/i.test(message.trim())) {
    const content = message.replace(/^(remember|note)\s*(that\s*)?/i, '').trim();
    await supabase.from('user_context').insert({ user_id: user.id, type: 'preference', key: 'user_note', value: content, details: '', date_added: new Date().toISOString(), source: 'user' });
    promptCache.delete(user.id);
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: `Got it! I've remembered: \"${content}\"` })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', remembered: true, tools_used: true })}\n\n`));
        controller.close();
      }
    });
    return sseResponse(request, body);
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return jsonResponse(request, { error: 'Missing ANTHROPIC_API_KEY' }, 500);

  let activeConversationId = conversationId;
  if (!activeConversationId) {
    const { data: newConvo, error: convoErr } = await supabase.from('conversations').insert({ user_id: user.id, title: message.slice(0, 80) }).select('id').single();
    if (convoErr) return jsonResponse(request, { error: convoErr.message }, 500);
    activeConversationId = newConvo.id;
  }

  await supabase.from('messages').insert({ conversation_id: activeConversationId, role: 'user', content: message });

  const { data: historyRows } = await supabase.from('messages').select('role, content').eq('conversation_id', activeConversationId).order('created_at', { ascending: true }).limit(20);
  const conversationMessages = (historyRows || []).map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  const systemPrompt = await getCachedSystemPrompt(supabase, user.id, freshData);

  let claudeMessages = [...conversationMessages];
  let toolsUsed = false;
  let finalTextContent = '';

  for (let i = 0; i < 5; i++) {
    const result = await callClaude(apiKey, systemPrompt, claudeMessages, true);
    if (result.stop_reason === 'tool_use') {
      toolsUsed = true;
      const toolUseBlocks = result.content.filter((b: any) => b.type === 'tool_use');
      claudeMessages.push({ role: 'assistant', content: result.content });
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        const toolResult = await executeTool(supabase, user.id, toolUse.name, toolUse.input);
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: toolResult });
      }
      claudeMessages.push({ role: 'user', content: toolResults });
      continue;
    }
    for (const block of result.content) {
      if (block.type === 'text') finalTextContent += block.text;
    }
    break;
  }

  // Fallback if tool loop exhausted without producing a text response
  if (!finalTextContent) {
    finalTextContent = "I looked into your data but wasn't able to put together a complete response. Could you try rephrasing your question?";
  }

  const admin = createAdminClient();
  await admin.from('messages').insert({ conversation_id: activeConversationId, role: 'assistant', content: finalTextContent, metadata: { model: MODEL, tools_used: toolsUsed } });
  if (conversationMessages.length <= 2) {
    const title = message.length > 60 ? message.slice(0, 57) + '...' : message;
    await admin.from('conversations').update({ title }).eq('id', activeConversationId);
  }

  const encoder = new TextEncoder();
  const sseStream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: finalTextContent })}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', conversation_id: activeConversationId, tools_used: toolsUsed })}\n\n`));
      controller.close();
    }
  });

  return sseResponse(request, sseStream);
});
