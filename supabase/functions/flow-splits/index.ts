import { createUserClient } from '../_shared/supabase.ts';
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

// Compute each participant's amount based on share_type
function computeShares(
  participants: Array<{
    share_type: string;
    share_value?: number;
    is_self?: boolean;
    recipient_id?: string | null;
    ad_hoc_name?: string | null;
  }>,
  itemAmount: number
): Array<{ share_type: string; share_value: number | null; computed_amount: number }> {
  const equalCount = participants.filter((p) => p.share_type === 'equal').length;
  const fixedTotal = participants
    .filter((p) => p.share_type === 'fixed')
    .reduce((sum, p) => sum + (p.share_value || 0), 0);
  const pctTotal = participants
    .filter((p) => p.share_type === 'percentage')
    .reduce((sum, p) => sum + (p.share_value || 0), 0);

  // Remaining after fixed + percentage allocations goes to equal splits
  const pctAmount = (pctTotal / 100) * itemAmount;
  const remainingForEqual = Math.max(0, itemAmount - fixedTotal - pctAmount);
  const equalShare = equalCount > 0 ? remainingForEqual / equalCount : 0;

  return participants.map((p) => {
    let computed = 0;
    if (p.share_type === 'fixed') {
      computed = p.share_value || 0;
    } else if (p.share_type === 'percentage') {
      computed = ((p.share_value || 0) / 100) * itemAmount;
    } else {
      // equal
      computed = equalShare;
    }
    return {
      share_type: p.share_type,
      share_value: p.share_value ?? null,
      computed_amount: Math.round(computed * 100) / 100,
    };
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
  const authHeader = request.headers.get('authorization') || '';
  const jwt = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(jwt);
  if (error || !user) {
    return jsonResponse(request, { error: 'AUTH_REQUIRED', code: 'AUTH_REQUIRED' }, 401);
  }

  // Rate limiting
  const rl = await checkRateLimit(user.id, 'flow-splits');
  if (!rl.allowed) {
    return rateLimitResponse(request, corsHeaders, resolveCorsOrigin, rl.retryAfterSeconds);
  }

  const payload = await request.json().catch(() => ({}));
  const subAction = payload.subAction;
  const data = payload.data || {};

  // ─── LIST ───────────────────────────────────────────────
  // Returns all splits with nested items and participants
  if (subAction === 'list') {
    const { data: splits, error: listErr } = await supabase
      .from('splits')
      .select(`
        *,
        split_items (
          *,
          split_participants (*)
        )
      `)
      .eq('user_id', user.id)
      .order('split_date', { ascending: false });

    if (listErr) return jsonResponse(request, { error: listErr.message }, 400);

    return jsonResponse(request, { splits: splits || [] });
  }

  // ─── GET (single) ──────────────────────────────────────
  if (subAction === 'get') {
    if (!data.id) return jsonResponse(request, { error: 'Missing id' }, 400);

    const { data: split, error: getErr } = await supabase
      .from('splits')
      .select(`
        *,
        split_items (
          *,
          split_participants (*)
        )
      `)
      .eq('id', data.id)
      .eq('user_id', user.id)
      .single();

    if (getErr) return jsonResponse(request, { error: getErr.message }, 400);

    return jsonResponse(request, { split });
  }

  // ─── CREATE ─────────────────────────────────────────────
  // Expects: { title, total_amount, currency?, split_date?, transaction_id?, description?,
  //            items: [{ title, amount, currency?, category?, participants: [{ recipient_id?, ad_hoc_name?, is_self?, share_type, share_value? }] }] }
  if (subAction === 'create') {
    if (!data.title || !data.total_amount) {
      return jsonResponse(request, { error: 'Missing title or total_amount' }, 400);
    }
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      return jsonResponse(request, { error: 'At least one item is required' }, 400);
    }

    // Insert the parent split
    const { data: split, error: splitErr } = await supabase
      .from('splits')
      .insert({
        user_id: user.id,
        title: data.title,
        description: data.description || null,
        total_amount: data.total_amount,
        currency: data.currency || 'QAR',
        split_date: data.split_date || new Date().toISOString(),
        transaction_id: data.transaction_id || null,
        status: 'active',
      })
      .select('id')
      .single();

    if (splitErr) return jsonResponse(request, { error: splitErr.message }, 400);

    // Insert items + participants
    for (const item of data.items) {
      if (!item.title || !item.amount) continue;

      const { data: inserted, error: itemErr } = await supabase
        .from('split_items')
        .insert({
          split_id: split.id,
          title: item.title,
          amount: item.amount,
          currency: item.currency || data.currency || 'QAR',
          category: item.category || null,
        })
        .select('id')
        .single();

      if (itemErr) {
        // Cleanup: delete the parent split (CASCADE will handle children)
        await supabase.from('splits').delete().eq('id', split.id);
        return jsonResponse(request, { error: `Item insert failed: ${itemErr.message}` }, 400);
      }

      // Process participants for this item
      const participants = item.participants || [];
      if (participants.length > 0) {
        const computed = computeShares(participants, item.amount);
        const participantRows = participants.map(
          (
            p: {
              recipient_id?: string;
              ad_hoc_name?: string;
              is_self?: boolean;
              share_type: string;
            },
            idx: number
          ) => ({
            split_item_id: inserted.id,
            recipient_id: p.recipient_id || null,
            ad_hoc_name: p.ad_hoc_name || null,
            is_self: p.is_self || false,
            share_type: computed[idx].share_type,
            share_value: computed[idx].share_value,
            computed_amount: computed[idx].computed_amount,
            amount_settled: 0,
          })
        );

        const { error: partErr } = await supabase
          .from('split_participants')
          .insert(participantRows);

        if (partErr) {
          await supabase.from('splits').delete().eq('id', split.id);
          return jsonResponse(request, { error: `Participants insert failed: ${partErr.message}` }, 400);
        }
      }
    }

    // Return the fully populated split
    const { data: fullSplit } = await supabase
      .from('splits')
      .select(`
        *,
        split_items (
          *,
          split_participants (*)
        )
      `)
      .eq('id', split.id)
      .single();

    return jsonResponse(request, { success: true, split: fullSplit });
  }

  // ─── UPDATE ─────────────────────────────────────────────
  // Update split metadata (title, description, status, transaction_id)
  if (subAction === 'update') {
    if (!data.id) return jsonResponse(request, { error: 'Missing id' }, 400);

    const updates: Record<string, unknown> = {};
    if (data.title !== undefined) updates.title = data.title;
    if (data.description !== undefined) updates.description = data.description;
    if (data.status !== undefined) updates.status = data.status;
    if (data.transaction_id !== undefined) updates.transaction_id = data.transaction_id;
    if (data.split_date !== undefined) updates.split_date = data.split_date;
    if (data.total_amount !== undefined) updates.total_amount = data.total_amount;

    if (Object.keys(updates).length === 0) {
      return jsonResponse(request, { error: 'Nothing to update' }, 400);
    }

    const { error: updateErr } = await supabase
      .from('splits')
      .update(updates)
      .eq('id', data.id)
      .eq('user_id', user.id);

    if (updateErr) return jsonResponse(request, { error: updateErr.message }, 400);

    return jsonResponse(request, { success: true });
  }

  // ─── DELETE ─────────────────────────────────────────────
  if (subAction === 'delete') {
    if (!data.id) return jsonResponse(request, { error: 'Missing id' }, 400);

    const { error: deleteErr } = await supabase
      .from('splits')
      .delete()
      .eq('id', data.id)
      .eq('user_id', user.id);

    if (deleteErr) return jsonResponse(request, { error: deleteErr.message }, 400);

    return jsonResponse(request, { success: true });
  }

  // ─── ADD ITEM ───────────────────────────────────────────
  // Add an item to an existing split
  if (subAction === 'addItem') {
    if (!data.split_id || !data.title || !data.amount) {
      return jsonResponse(request, { error: 'Missing split_id, title, or amount' }, 400);
    }

    // Verify split ownership
    const { data: split, error: ownerErr } = await supabase
      .from('splits')
      .select('id')
      .eq('id', data.split_id)
      .eq('user_id', user.id)
      .single();

    if (ownerErr || !split) {
      return jsonResponse(request, { error: 'Split not found' }, 404);
    }

    const { data: inserted, error: itemErr } = await supabase
      .from('split_items')
      .insert({
        split_id: data.split_id,
        title: data.title,
        amount: data.amount,
        currency: data.currency || 'QAR',
        category: data.category || null,
      })
      .select('id')
      .single();

    if (itemErr) return jsonResponse(request, { error: itemErr.message }, 400);

    // Insert participants if provided
    const participants = data.participants || [];
    if (participants.length > 0) {
      const computed = computeShares(participants, data.amount);
      const rows = participants.map(
        (p: { recipient_id?: string; ad_hoc_name?: string; is_self?: boolean; share_type: string }, idx: number) => ({
          split_item_id: inserted.id,
          recipient_id: p.recipient_id || null,
          ad_hoc_name: p.ad_hoc_name || null,
          is_self: p.is_self || false,
          share_type: computed[idx].share_type,
          share_value: computed[idx].share_value,
          computed_amount: computed[idx].computed_amount,
          amount_settled: 0,
        })
      );

      const { error: partErr } = await supabase.from('split_participants').insert(rows);
      if (partErr) {
        await supabase.from('split_items').delete().eq('id', inserted.id);
        return jsonResponse(request, { error: partErr.message }, 400);
      }
    }

    return jsonResponse(request, { success: true, itemId: inserted.id });
  }

  // ─── REMOVE ITEM ────────────────────────────────────────
  if (subAction === 'removeItem') {
    if (!data.item_id) return jsonResponse(request, { error: 'Missing item_id' }, 400);

    // Verify ownership through the split
    const { data: item, error: itemErr } = await supabase
      .from('split_items')
      .select('id, split_id, splits!inner(user_id)')
      .eq('id', data.item_id)
      .single();

    if (itemErr || !item) {
      return jsonResponse(request, { error: 'Item not found' }, 404);
    }

    const splitRow = item.splits as unknown as { user_id: string };
    if (splitRow.user_id !== user.id) {
      return jsonResponse(request, { error: 'Not authorized' }, 403);
    }

    const { error: deleteErr } = await supabase
      .from('split_items')
      .delete()
      .eq('id', data.item_id);

    if (deleteErr) return jsonResponse(request, { error: deleteErr.message }, 400);

    return jsonResponse(request, { success: true });
  }

  // ─── SETTLE ─────────────────────────────────────────────
  // Mark a participant as settled (partial or full)
  if (subAction === 'settle') {
    if (!data.participant_id || data.amount === undefined) {
      return jsonResponse(request, { error: 'Missing participant_id or amount' }, 400);
    }

    // Verify ownership through the chain: participant → item → split
    const { data: participant, error: pErr } = await supabase
      .from('split_participants')
      .select('id, computed_amount, amount_settled, split_item_id, split_items!inner(split_id, splits!inner(user_id))')
      .eq('id', data.participant_id)
      .single();

    if (pErr || !participant) {
      return jsonResponse(request, { error: 'Participant not found' }, 404);
    }

    const splitItem = participant.split_items as unknown as { split_id: string; splits: { user_id: string } };
    if (splitItem.splits.user_id !== user.id) {
      return jsonResponse(request, { error: 'Not authorized' }, 403);
    }

    const newSettled = Number(data.amount);
    const updates: Record<string, unknown> = {
      amount_settled: newSettled,
      updated_at: new Date().toISOString(),
    };

    if (data.settlement_txn_id) {
      updates.settlement_txn_id = data.settlement_txn_id;
    }

    // Mark as settled if fully paid
    if (newSettled >= participant.computed_amount) {
      updates.settled_at = new Date().toISOString();
    } else {
      updates.settled_at = null;
    }

    const { error: updateErr } = await supabase
      .from('split_participants')
      .update(updates)
      .eq('id', data.participant_id);

    if (updateErr) return jsonResponse(request, { error: updateErr.message }, 400);

    // Check if all non-self participants for the entire split are settled
    // If so, update split status to 'settled'
    const { data: allItems } = await supabase
      .from('split_items')
      .select('id')
      .eq('split_id', splitItem.split_id);

    if (allItems && allItems.length > 0) {
      const itemIds = allItems.map((i: { id: string }) => i.id);
      const { data: unsettled } = await supabase
        .from('split_participants')
        .select('id')
        .in('split_item_id', itemIds)
        .eq('is_self', false)
        .is('settled_at', null);

      if (!unsettled || unsettled.length === 0) {
        await supabase
          .from('splits')
          .update({ status: 'settled', updated_at: new Date().toISOString() })
          .eq('id', splitItem.split_id);
      }
    }

    return jsonResponse(request, { success: true });
  }

  // ─── SUGGEST SETTLEMENTS ────────────────────────────────
  // Find incoming transfers that could match unsettled participants
  if (subAction === 'suggest') {
    // Get all unsettled non-self participants with their recipient info
    const { data: splits, error: splitsErr } = await supabase
      .from('splits')
      .select(`
        id, title,
        split_items (
          id, title, amount,
          split_participants (
            id, recipient_id, ad_hoc_name, computed_amount, amount_settled, is_self
          )
        )
      `)
      .eq('user_id', user.id)
      .eq('status', 'active');

    if (splitsErr) return jsonResponse(request, { error: splitsErr.message }, 400);

    // Collect unsettled participants
    const unsettled: Array<{
      participant_id: string;
      split_id: string;
      split_title: string;
      item_title: string;
      recipient_id: string | null;
      ad_hoc_name: string | null;
      owed: number;
    }> = [];

    for (const split of (splits || [])) {
      for (const item of (split.split_items || [])) {
        for (const p of (item.split_participants || [])) {
          if (p.is_self) continue;
          const remaining = p.computed_amount - p.amount_settled;
          if (remaining <= 0) continue;
          unsettled.push({
            participant_id: p.id,
            split_id: split.id,
            split_title: split.title,
            item_title: item.title,
            recipient_id: p.recipient_id,
            ad_hoc_name: p.ad_hoc_name,
            owed: Math.round(remaining * 100) / 100,
          });
        }
      }
    }

    if (unsettled.length === 0) {
      return jsonResponse(request, { suggestions: [] });
    }

    // Get recent incoming transfers (last 90 days)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: incomingTxns } = await supabase
      .from('raw_ledger')
      .select('id, counterparty, amount, currency, amount_qar, date, recipient_id')
      .eq('user_id', user.id)
      .eq('direction', 'IN')
      .gte('date', ninetyDaysAgo.toISOString())
      .order('date', { ascending: false })
      .limit(200);

    if (!incomingTxns || incomingTxns.length === 0) {
      return jsonResponse(request, { suggestions: [] });
    }

    // Match unsettled participants to incoming transactions
    const suggestions: Array<{
      participant_id: string;
      split_title: string;
      item_title: string;
      owed: number;
      transaction: { id: string; counterparty: string; amount: number; date: string };
      confidence: string;
    }> = [];

    for (const u of unsettled) {
      for (const txn of incomingTxns) {
        // Match by recipient_id if both have one
        const recipientMatch = u.recipient_id && txn.recipient_id && u.recipient_id === txn.recipient_id;
        if (!recipientMatch) continue;

        const txnAmount = txn.amount_qar || txn.amount;
        const diff = Math.abs(txnAmount - u.owed);
        const tolerance = u.owed * 0.05; // 5% tolerance

        let confidence = 'low';
        if (diff < 0.01) confidence = 'exact';
        else if (diff <= tolerance) confidence = 'high';
        else if (txnAmount >= u.owed) confidence = 'medium';
        else continue; // Amount too low and no recipient match - skip

        suggestions.push({
          participant_id: u.participant_id,
          split_title: u.split_title,
          item_title: u.item_title,
          owed: u.owed,
          transaction: {
            id: txn.id,
            counterparty: txn.counterparty,
            amount: txnAmount,
            date: txn.date,
          },
          confidence,
        });
      }
    }

    // Sort by confidence (exact > high > medium > low)
    const order = { exact: 0, high: 1, medium: 2, low: 3 };
    suggestions.sort((a, b) => order[a.confidence as keyof typeof order] - order[b.confidence as keyof typeof order]);

    return jsonResponse(request, { suggestions });
  }

  // ─── LINK PARTICIPANT TO CONTACT ────────────────────────
  // Convert an ad-hoc name to a real recipient
  if (subAction === 'linkContact') {
    if (!data.participant_id || !data.recipient_id) {
      return jsonResponse(request, { error: 'Missing participant_id or recipient_id' }, 400);
    }

    // Verify ownership
    const { data: participant, error: pErr } = await supabase
      .from('split_participants')
      .select('id, split_items!inner(splits!inner(user_id))')
      .eq('id', data.participant_id)
      .single();

    if (pErr || !participant) {
      return jsonResponse(request, { error: 'Participant not found' }, 404);
    }

    const chain = participant.split_items as unknown as { splits: { user_id: string } };
    if (chain.splits.user_id !== user.id) {
      return jsonResponse(request, { error: 'Not authorized' }, 403);
    }

    const { error: updateErr } = await supabase
      .from('split_participants')
      .update({
        recipient_id: data.recipient_id,
        ad_hoc_name: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.participant_id);

    if (updateErr) return jsonResponse(request, { error: updateErr.message }, 400);

    return jsonResponse(request, { success: true });
  }

  return jsonResponse(request, { error: `Unknown subAction: ${subAction}` }, 400);
});
