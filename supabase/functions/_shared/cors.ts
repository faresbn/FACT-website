const allowedOrigins = (Deno.env.get('FLOW_ALLOWED_ORIGINS') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function resolveCorsOrigin(request: Request): string {
  const origin = request.headers.get('origin');
  if (!origin) return allowedOrigins[0] || '*';
  if (allowedOrigins.length === 0) return '*';
  if (allowedOrigins.includes(origin)) return origin;
  return allowedOrigins[0];
}

export function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

export function withCors(request: Request, response: Response): Response {
  const origin = resolveCorsOrigin(request);
  const headers = new Headers(response.headers);
  const extra = corsHeaders(origin);
  Object.entries(extra).forEach(([k, v]) => headers.set(k, v));
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
