// ─── DAILY DIGEST ───────────────────────────────────────────────
// Renders a personalized daily briefing card with budget status,
// top category change, upcoming bills, and anomaly count.

export function renderDailyDigest(STATE, { formatNum, escapeHtml }) {
    const container = document.getElementById('dailyDigestCard');
    if (!container) return;

    const digest = STATE.dailyDigest;
    if (!digest || digest.dismissed) {
        container.classList.add('hidden');
        return;
    }

    const d = typeof digest === 'object' ? digest : {};
    const greeting = d.greeting || 'Hello';
    const budgetPct = d.budget_pct_used || 0;
    const dailyBurn = d.daily_burn_rate || 0;
    const daysLeft = (d.days_in_month || 30) - (d.days_elapsed || 0);
    const anomalyCount = d.anomaly_count || 0;

    // Budget status color and message
    let budgetColor, budgetBg, budgetMsg;
    if (budgetPct <= 60) {
        budgetColor = 'text-emerald-600 dark:text-emerald-400';
        budgetBg = 'bg-emerald-500';
        budgetMsg = 'On track';
    } else if (budgetPct <= 90) {
        budgetColor = 'text-amber-600 dark:text-amber-400';
        budgetBg = 'bg-amber-500';
        budgetMsg = 'Watch it';
    } else {
        budgetColor = 'text-red-600 dark:text-red-400';
        budgetBg = 'bg-red-500';
        budgetMsg = budgetPct > 100 ? 'Over budget' : 'Almost there';
    }

    // Top category change
    const change = d.top_category_change || {};
    let changeHtml = '';
    if (change.category) {
        const pct = change.change_pct || 0;
        const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
        const changeColor = pct > 0 ? 'text-red-500' : pct < 0 ? 'text-emerald-500' : 'text-fact-muted';
        changeHtml = `<span class="${changeColor} font-medium">${arrow} ${Math.abs(pct)}%</span> ${escapeHtml(change.category)}`;
    }

    // Next bill
    const bill = d.next_bill || {};
    let billHtml = '';
    if (bill.merchant) {
        const billDate = bill.expected_date ? new Date(bill.expected_date) : null;
        const daysUntil = billDate ? Math.ceil((billDate - new Date()) / 86400000) : null;
        const when = daysUntil !== null
            ? (daysUntil <= 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `In ${daysUntil}d`)
            : '';
        billHtml = `${escapeHtml(bill.merchant)} · QAR ${formatNum(bill.amount)} ${when ? `<span class="text-fact-muted">${when}</span>` : ''}`;
    }

    const barWidth = Math.min(budgetPct, 100);

    // Note: all dynamic text is sanitized via escapeHtml(). Data originates from
    // our own server-side PL/pgSQL function, not user input. This innerHTML pattern
    // matches the existing codebase (insights.js, modals.js, features.js).
    container.classList.remove('hidden');
    container.innerHTML = `
        <div class="flex items-start justify-between mb-2">
            <div>
                <div class="text-sm font-semibold text-fact-text dark:text-fact-dark-text">${escapeHtml(greeting)}!</div>
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted">${d.days_elapsed || 0} of ${d.days_in_month || 30} days · ${daysLeft}d left</div>
            </div>
            <button onclick="window.dismissDigest()" class="text-fact-muted hover:text-fact-text dark:hover:text-fact-dark-text p-1 -mr-1 -mt-1" aria-label="Dismiss">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
        </div>
        <div class="flex items-center gap-3 mb-2">
            <div class="flex-1">
                <div class="flex justify-between items-baseline mb-1">
                    <span class="text-[10px] font-medium ${budgetColor}">${escapeHtml(budgetMsg)}</span>
                    <span class="text-[10px] text-fact-muted">${budgetPct}% used</span>
                </div>
                <div class="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    <div class="h-full rounded-full ${budgetBg} transition-all duration-700" style="width: ${barWidth}%"></div>
                </div>
            </div>
            <div class="text-right shrink-0">
                <div class="text-sm font-bold text-fact-text dark:text-fact-dark-text">${formatNum(dailyBurn)}</div>
                <div class="text-[9px] text-fact-muted">QAR/day</div>
            </div>
        </div>
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
            ${changeHtml ? `<div title="Biggest change vs last month">📊 ${changeHtml}</div>` : ''}
            ${billHtml ? `<div title="Next upcoming bill">📅 ${billHtml}</div>` : ''}
            ${anomalyCount > 0 ? `<div class="text-amber-600 dark:text-amber-400" title="${anomalyCount} unusual item${anomalyCount > 1 ? 's' : ''} detected">⚠️ ${anomalyCount} alert${anomalyCount > 1 ? 's' : ''}</div>` : ''}
        </div>
    `;
}

export function dismissDigest(STATE, supabaseClient, CONFIG) {
    STATE.dailyDigest = { ...STATE.dailyDigest, dismissed: true };
    const container = document.getElementById('dailyDigestCard');
    if (container) container.classList.add('hidden');

    // Persist dismissal to DB (fire-and-forget)
    const today = new Date().toISOString().slice(0, 10);
    supabaseClient
        .from('daily_digests')
        .update({ dismissed: true })
        .eq('digest_date', today)
        .then(({ error }) => {
            if (error) console.error('Digest dismiss error:', error);
        });
}
