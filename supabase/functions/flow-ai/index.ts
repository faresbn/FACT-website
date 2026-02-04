import { createUserClient } from '../_shared/supabase.ts';
import { resolveCorsOrigin, corsHeaders } from '../_shared/cors.ts';

const MODEL_DEFAULT = Deno.env.get('FLOW_MODEL_AI') || 'gpt-5-mini';
const MODEL_DEEP = Deno.env.get('FLOW_MODEL_AI_DEEP') || 'gpt-5.1';

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

async function callOpenAI(model: string, systemPrompt: string, userPrompt: string) {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error: ${response.status} ${text}`);
  }

  const json = await response.json();
  return json?.choices?.[0]?.message?.content || '';
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
  const selectedModel = payload.model || MODEL_DEFAULT;

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

  const ctxSummary = (contextRows || []).map((r) => `${r.type}: ${r.key} -> ${r.value} (${r.details || ''})`).slice(0, 200).join('\n');
  const merchantSummary = (merchantRows || []).slice(0, 200).map((m) => `${m.pattern} -> ${m.category}`).join('\n');

  const systemPrompt = `You are a personal finance assistant for FACT/Flow. Use the provided transaction summary and user context to answer.

User context:
${ctxSummary || 'None'}

Merchant map:
${merchantSummary || 'None'}

If asked for forecasts or optimization, be explicit about assumptions and uncertainty.`;

  const isDeep = DEEP_KEYWORDS.some((k) => query.toLowerCase().includes(k));
  const model = isDeep ? MODEL_DEEP : selectedModel;

  try {
    const answer = await callOpenAI(model, systemPrompt, `Question: ${query}\n\nData:\n${dataSummary}`);
    const contextLoaded = {
      income: (contextRows || []).filter((r) => r.type === 'income').length,
      payees: (contextRows || []).filter((r) => r.type === 'payee').length,
      corrections: (contextRows || []).filter((r) => r.type === 'correction').length,
      preferences: (contextRows || []).filter((r) => r.type === 'preference').length,
      rules: (contextRows || []).filter((r) => r.type === 'rule').length,
      merchants: (merchantRows || []).length,
    };

    return jsonResponse(request, {
      answer,
      model,
      mode: isDeep ? 'deep' : 'standard',
      contextLoaded,
    });
  } catch (err) {
    return jsonResponse(request, { error: (err as Error).message }, 500);
  }
});
