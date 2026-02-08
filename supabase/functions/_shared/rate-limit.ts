import { createAdminClient } from './supabase.ts';

/**
 * Check rate limit for a user + function combination.
 * Uses the DB-backed check_rate_limit() function so limits
 * are configurable from the rate_limit_config table without redeploying.
 *
 * Returns { allowed: true } or { allowed: false, retryAfterSeconds }.
 */
export async function checkRateLimit(
  userId: string,
  functionName: string
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_user_id: userId,
      p_function_name: functionName,
    });

    if (error) {
      // Fail open: if rate limit check itself errors, allow the request
      console.error('Rate limit check error:', error);
      return { allowed: true };
    }

    if (data === false) {
      // Calculate seconds until next hour window
      const now = new Date();
      const nextWindow = new Date(now);
      nextWindow.setMinutes(0, 0, 0);
      nextWindow.setHours(nextWindow.getHours() + 1);
      const retryAfterSeconds = Math.ceil((nextWindow.getTime() - now.getTime()) / 1000);
      return { allowed: false, retryAfterSeconds };
    }

    return { allowed: true };
  } catch (err) {
    // Fail open on unexpected errors
    console.error('Rate limit unexpected error:', err);
    return { allowed: true };
  }
}

/**
 * Build a 429 Too Many Requests response with Retry-After header.
 */
export function rateLimitResponse(
  request: Request,
  corsHeadersFn: (origin: string) => Record<string, string>,
  resolveCorsOriginFn: (request: Request) => string,
  retryAfterSeconds = 60
): Response {
  const origin = resolveCorsOriginFn(request);
  return new Response(
    JSON.stringify({
      error: 'Too many requests. Please slow down and try again shortly.',
      code: 'RATE_LIMITED',
      retry_after: retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSeconds),
        ...corsHeadersFn(origin),
      },
    }
  );
}
