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
  const [periodRes, merchantRes, contextRes, recipientRes, profileRes, goalsRes] = await Promise.all([
    supabase.from('period_summary').select('*').eq('user_id', userId).order('month', { ascending: false }).limit(6),
    supabase.from('merchant_analytics').select('*').eq('user_id', userId).order('total_spent', { ascending: false }).limit(20),
    supabase.from('user_context').select('type, key, value, details').eq('user_id', userId),
    supabase.from('recipients').select('short_name, long_name').eq('user_id', userId),
    supabase.from('profiles').select('settings, display_name').eq('user_id', userId).single(),
    supabase.from('goals').select('category, monthly_limit').eq('user_id', userId).eq('active', true),
  ]);
  const periods = periodRes.data || [];
  const merchants = merchantRes.data || [];
  const context = contextRes.data || [];
  const recipients = recipientRes.data || [];
  const profile = profileRes.data;
  const goals = goalsRes.data || [];
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

Guidelines:
- Use query_transactions to search for specific transactions when the user asks about merchants, dates, or amounts.
- Use query_trends for trend analysis and period comparisons.
- Use set_goal when the user wants to set or update a budget limit.
- Use remember when the user asks you to note or remember something.
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
