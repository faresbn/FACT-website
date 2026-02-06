import { createUserClient } from '../_shared/supabase.ts';
import { resolveCorsOrigin, corsHeaders } from '../_shared/cors.ts';

const MODEL_DEFAULT = Deno.env.get('FLOW_MODEL_AI') || 'claude-sonnet-4-20250514';
const MODEL_DEEP = Deno.env.get('FLOW_MODEL_AI_DEEP') || 'claude-sonnet-4-20250514';

const DEEP_KEYWORDS = [
  'why', 'optimize', 'forecast', 'anomaly', 'anomalies', 'plan',
  'predict', 'trend', 'pattern', 'analyze', 'analysis', 'deep',
  'detail', 'explain', 'insight', 'recommend', 'suggestion', 'budget'
];

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

function isRememberCommand(query: string) {
  return /^(remember|note)\b/i.test(query.trim());
}

async function callClaude(model: string, systemPrompt: string, userPrompt: string) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude error: ${response.status} ${text}`);
  }

  const json = await response.json();
  return json?.content?.[0]?.text || '';
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
  const query = payload.q || '';
  const dataSummary = payload.data || '';

  // Map friendly names to actual model IDs
  const MODEL_MAP: Record<string, string> = {
    'claude-sonnet': MODEL_DEFAULT,
    'claude-haiku': 'claude-haiku-4',
  };
  const rawModel = payload.model || 'claude-sonnet';
  const selectedModel = MODEL_MAP[rawModel] || rawModel;

  if (!query) return jsonResponse(request, { error: 'Missing query' }, 400);

  if (isRememberCommand(query)) {
    const content = query.replace(/^(remember|note)\s*(that\s*)?/i, '').trim();
    await supabase.from('user_context').insert({
      user_id: user.id,
      type: 'preference',
      key: 'user_note',
      value: content,
      details: '',
      date_added: new Date().toISOString(),
      source: 'user',
    });

    return jsonResponse(request, {
      remembered: true,
      message: `Got it! I've remembered: ${content}`,
    });
  }

  const { data: contextRows } = await supabase
    .from('user_context')
    .select('type, key, value, details')
    .eq('user_id', user.id);

  const { data: merchantRows } = await supabase
    .from('merchant_map')
    .select('pattern, category')
    .eq('user_id', user.id);

  const { data: recipientRows } = await supabase
    .from('recipients')
    .select('short_name, long_name, phone')
    .eq('user_id', user.id);

  // Fetch profile settings (salary, budget, goals)
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('settings')
    .eq('user_id', user.id)
    .single();

  const { data: goalsRows } = await supabase
    .from('goals')
    .select('category, monthly_limit')
    .eq('user_id', user.id)
    .eq('active', true);

  const { data: insightRows } = await supabase
    .from('insights')
    .select('date, insights, type')
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .limit(3);

  const ctxSummary = (contextRows || []).map((r) => `${r.type}: ${r.key} -> ${r.value} (${r.details || ''})`).slice(0, 200).join('\n');
  const merchantSummary = (merchantRows || []).slice(0, 200).map((m) => `${m.pattern} -> ${m.category}`).join('\n');
  const recipientSummary = (recipientRows || []).slice(0, 100).map((r) => `${r.short_name}${r.long_name ? ' (' + r.long_name + ')' : ''}`).join(', ');

  const settings = profileRow?.settings || {};
  const profileSummary = [
    settings.salary_amount ? `Monthly salary: QAR ${settings.salary_amount}` : '',
    settings.salary_day ? `Salary day: ${settings.salary_day}th` : '',
    settings.monthly_budget ? `Monthly budget: QAR ${settings.monthly_budget}` : '',
    settings.currency && settings.currency !== 'QAR' ? `Preferred currency: ${settings.currency}` : '',
  ].filter(Boolean).join('\n');

  const goalsSummary = (goalsRows || []).map((g) => `${g.category}: QAR ${g.monthly_limit}/month`).join(', ');

  const recentInsightsSummary = (insightRows || []).map((i) => {
    const date = new Date(i.date).toLocaleDateString();
    return `[${date}] ${String(i.insights).slice(0, 200)}`;
  }).join('\n');

  const isDeep = DEEP_KEYWORDS.some((k) => query.toLowerCase().includes(k));

  const systemPrompt = isDeep
    ? `You are an analytical financial advisor for FACT/Flow, a personal finance tracker based in Qatar.

Your role: provide data-driven analysis of spending patterns, anomalies, trends, and actionable recommendations.

When analysing:
- Reference specific numbers, dates, and merchants from the data.
- Compare against the user's own history (not generic benchmarks).
- Flag anomalies by comparing to the user's typical behaviour.
- For forecasts, state assumptions explicitly and give ranges, not point estimates.
- For budgeting advice, consider Qatar cost of living and the user's actual income if known.
- Be direct. No filler. Lead with the insight, then supporting data.

User context:
${ctxSummary || 'None'}

Financial profile:
${profileSummary || 'Not set'}

Budget goals:
${goalsSummary || 'None set'}

Merchant patterns:
${merchantSummary || 'None'}

Known recipients:
${recipientSummary || 'None'}

Recent insights:
${recentInsightsSummary || 'None'}`
    : `You are a concise personal finance assistant for FACT/Flow, a finance tracker based in Qatar.

Answer spending questions using the provided transaction data. Be specific with numbers and dates.
Keep responses short (2-4 sentences for simple questions, longer for complex ones).
Use markdown for structure when listing items. Currency is QAR unless stated otherwise.

User context:
${ctxSummary || 'None'}

Financial profile:
${profileSummary || 'Not set'}

Budget goals:
${goalsSummary || 'None set'}

Known recipients:
${recipientSummary || 'None'}`;

  const model = isDeep ? MODEL_DEEP : selectedModel;

  try {
    const answer = await callClaude(model, systemPrompt, `Question: ${query}\n\nData:\n${dataSummary}`);
    const contextLoaded = {
      income: (contextRows || []).filter((r) => r.type === 'income').length,
      payees: (contextRows || []).filter((r) => r.type === 'payee').length,
      corrections: (contextRows || []).filter((r) => r.type === 'correction').length,
      preferences: (contextRows || []).filter((r) => r.type === 'preference').length,
      rules: (contextRows || []).filter((r) => r.type === 'rule').length,
      merchants: (merchantRows || []).length,
    };

    // Return friendly model name for display
    const FRIENDLY_MAP: Record<string, string> = {
      'claude-sonnet-4-20250514': 'claude-sonnet',
      'claude-haiku-4': 'claude-haiku',
    };

    return jsonResponse(request, {
      answer,
      model: FRIENDLY_MAP[model] || model,
      mode: isDeep ? 'deep' : 'standard',
      contextLoaded,
    });
  } catch (err) {
    return jsonResponse(request, { error: (err as Error).message }, 500);
  }
});
