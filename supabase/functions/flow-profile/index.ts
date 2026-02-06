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
  const action = payload.action || 'get';

  // ─── PROFILE SETTINGS ─────────────────────────────────
  if (action === 'get') {
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('settings, display_name')
      .eq('user_id', user.id)
      .single();

    if (profileErr && profileErr.code !== 'PGRST116') {
      return jsonResponse(request, { error: profileErr.message }, 400);
    }

    return jsonResponse(request, {
      settings: profile?.settings || {},
      display_name: profile?.display_name || null,
    });
  }

  if (action === 'save') {
    const settings = payload.settings || {};
    const displayName = payload.display_name;

    const upsertData: Record<string, unknown> = {
      user_id: user.id,
      settings,
      updated_at: new Date().toISOString(),
    };
    if (displayName !== undefined) {
      upsertData.display_name = displayName;
    }

    const { error: upsertErr } = await supabase
      .from('profiles')
      .upsert(upsertData, { onConflict: 'user_id' });

    if (upsertErr) return jsonResponse(request, { error: upsertErr.message }, 400);

    return jsonResponse(request, { success: true });
  }

  // ─── GOALS ─────────────────────────────────────────────
  if (action === 'goals.list') {
    const { data: goals, error: goalsErr } = await supabase
      .from('goals')
      .select('*')
      .eq('user_id', user.id)
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (goalsErr) return jsonResponse(request, { error: goalsErr.message }, 400);

    return jsonResponse(request, { goals: goals || [] });
  }

  if (action === 'goals.save') {
    const goal = payload.goal;
    if (!goal || !goal.category || !goal.monthly_limit) {
      return jsonResponse(request, { error: 'Missing goal category or monthly_limit' }, 400);
    }

    if (goal.id) {
      // Update existing goal
      const { error: updateErr } = await supabase
        .from('goals')
        .update({
          category: goal.category,
          monthly_limit: goal.monthly_limit,
          active: goal.active !== false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', goal.id)
        .eq('user_id', user.id);

      if (updateErr) return jsonResponse(request, { error: updateErr.message }, 400);
    } else {
      // Insert new goal
      const { error: insertErr } = await supabase
        .from('goals')
        .insert({
          user_id: user.id,
          category: goal.category,
          monthly_limit: goal.monthly_limit,
          active: goal.active !== false,
        });

      if (insertErr) return jsonResponse(request, { error: insertErr.message }, 400);
    }

    return jsonResponse(request, { success: true });
  }

  if (action === 'goals.delete') {
    const goalId = payload.goalId;
    if (!goalId) return jsonResponse(request, { error: 'Missing goalId' }, 400);

    const { error: deleteErr } = await supabase
      .from('goals')
      .delete()
      .eq('id', goalId)
      .eq('user_id', user.id);

    if (deleteErr) return jsonResponse(request, { error: deleteErr.message }, 400);

    return jsonResponse(request, { success: true });
  }

  // ─── STREAKS ───────────────────────────────────────────
  if (action === 'streaks.get') {
    const { data: streaks, error: streaksErr } = await supabase
      .from('streaks')
      .select('*')
      .eq('user_id', user.id);

    if (streaksErr) return jsonResponse(request, { error: streaksErr.message }, 400);

    return jsonResponse(request, { streaks: streaks || [] });
  }

  if (action === 'streaks.update') {
    const streak = payload.streak;
    if (!streak || !streak.type) {
      return jsonResponse(request, { error: 'Missing streak type' }, 400);
    }

    const { error: upsertErr } = await supabase
      .from('streaks')
      .upsert({
        user_id: user.id,
        type: streak.type,
        current_count: streak.current_count || 0,
        best_count: streak.best_count || 0,
        last_date: streak.last_date || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,type' });

    if (upsertErr) return jsonResponse(request, { error: upsertErr.message }, 400);

    return jsonResponse(request, { success: true });
  }

  // ─── INSIGHTS ──────────────────────────────────────────
  if (action === 'insights.save') {
    const insight = payload.insight;
    if (!insight || !insight.insights) {
      return jsonResponse(request, { error: 'Missing insight data' }, 400);
    }

    const { error: insertErr } = await supabase
      .from('insights')
      .insert({
        user_id: user.id,
        date: new Date().toISOString(),
        type: insight.type || 'manual',
        insights: insight.insights,
        period_start: insight.period_start || null,
        period_end: insight.period_end || null,
        metadata: insight.metadata || {},
      });

    if (insertErr) return jsonResponse(request, { error: insertErr.message }, 400);

    return jsonResponse(request, { success: true });
  }

  if (action === 'insights.list') {
    const limit = payload.limit || 5;
    const { data: insights, error: insightsErr } = await supabase
      .from('insights')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(limit);

    if (insightsErr) return jsonResponse(request, { error: insightsErr.message }, 400);

    return jsonResponse(request, { insights: insights || [] });
  }

  return jsonResponse(request, { error: `Unknown action: ${action}` }, 400);
});
