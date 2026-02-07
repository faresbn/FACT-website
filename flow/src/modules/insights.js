// ─── INSIGHTS ───────────────────────────────────────────────────

export function prepareTransactionSummary(STATE, formatNum) {
    const txns = STATE.filtered.filter(t => t.direction === 'OUT');

    // Group by merchant type
    const byType = {};
    txns.forEach(t => {
        if (!byType[t.merchantType]) byType[t.merchantType] = { total: 0, count: 0, txns: [] };
        byType[t.merchantType].total += t.amount;
        byType[t.merchantType].count++;
        byType[t.merchantType].txns.push(t);
    });

    // Build summary
    let summary = `Period: ${STATE.dateRange.start.format('MMM D')} - ${STATE.dateRange.end.format('MMM D, YYYY')}\n`;
    summary += `Total Transactions: ${txns.length}\n`;
    summary += `Total Spent: QAR ${formatNum(txns.reduce((s, t) => s + t.amount, 0))}\n\n`;

    summary += `By Type:\n`;
    Object.entries(byType)
        .sort((a, b) => b[1].total - a[1].total)
        .forEach(([type, data]) => {
            summary += `- ${type}: QAR ${formatNum(data.total)} (${data.count} txns)\n`;
        });

    summary += `\nRecent transactions (last 30):\n`;
    txns.slice(0, 30).forEach(t => {
        summary += `${t.date.format('MMM D HH:mm')} | ${t.display} | QAR ${formatNum(t.amount)} | ${t.merchantType} | ${t.dims.when.join(', ')} | ${t.dims.pattern}\n`;
    });

    return summary;
}

export function renderQuickInsights(STATE, callbacks) {
    const { formatNum } = callbacks;

    const out = STATE.filtered.filter(t => t.direction === 'OUT');
    const insights = [];

    // Night out patterns
    const nightOuts = out.filter(t => t.dims.pattern === 'Night Out');
    if (nightOuts.length > 0) {
        const total = nightOuts.reduce((s, t) => s + t.amount, 0);
        insights.push({
            icon: 'party',
            text: `${nightOuts.length} Night Out transactions totaling QAR ${formatNum(total)}`,
            filter: 'nightOut'
        });
    }

    // Work expense candidates
    const workExpenses = out.filter(t => t.dims.pattern === 'Work Expense');
    if (workExpenses.length > 0) {
        const total = workExpenses.reduce((s, t) => s + t.amount, 0);
        insights.push({
            icon: 'work',
            text: `${workExpenses.length} potential work expenses (QAR ${formatNum(total)})`,
            filter: 'workHours'
        });
    }

    // Splurges
    const splurges = out.filter(t => t.dims.pattern === 'Splurge');
    if (splurges.length > 0) {
        const total = splurges.reduce((s, t) => s + t.amount, 0);
        insights.push({
            icon: 'money',
            text: `${splurges.length} splurge purchases (QAR ${formatNum(total)})`,
            filter: 'splurge'
        });
    }

    // Subscriptions
    const subs = out.filter(t => t.dims.pattern === 'Subscription');
    if (subs.length > 0) {
        const merchants = [...new Set(subs.map(t => t.consolidated))];
        insights.push({
            icon: 'calendar',
            text: `${merchants.length} detected subscriptions`,
            filter: 'subscription'
        });
    }

    // Late night spending
    const lateNight = out.filter(t => t.isLateNight);
    if (lateNight.length >= 3) {
        const total = lateNight.reduce((s, t) => s + t.amount, 0);
        insights.push({
            icon: 'moon',
            text: `QAR ${formatNum(total)} spent late at night (${lateNight.length} txns)`,
            filter: 'lateNight'
        });
    }

    // Large purchases
    const large = out.filter(t => t.isLarge);
    if (large.length > 0) {
        insights.push({
            icon: 'dots',
            text: `${large.length} large purchases (500+ QAR each)`,
            filter: 'large'
        });
    }

    // Render insights
    const tagsContainer = document.getElementById('insightsTags');
    const insightsSection = document.getElementById('insightsSection');
    const countEl = document.getElementById('insightsCount');

    if (countEl) countEl.textContent = insights.length;

    if (!insightsSection) return;

    if (insights.length === 0) {
        insightsSection.classList.add('hidden');
    } else {
        insightsSection.classList.remove('hidden');

        const colorMap = {
            'nightOut': 'bg-fact-purple/15 text-fact-purple border-fact-purple/30',
            'workHours': 'bg-fact-yellow/15 text-fact-ink border-fact-yellow/50',
            'splurge': 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800',
            'subscription': 'bg-fact-green/15 text-fact-green border-fact-green/30',
            'lateNight': 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800',
            'large': 'bg-gray-100 dark:bg-gray-800 text-fact-ink dark:text-fact-dark-ink border-fact-border dark:border-fact-dark-border'
        };

        if (tagsContainer) {
            tagsContainer.innerHTML = insights.map(i => {
                const colors = colorMap[i.filter] || 'bg-gray-100 dark:bg-gray-800 text-fact-muted border-fact-border';
                return `<button onclick="filterByDimension('${i.filter}')"
                    class="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full border ${colors} hover:scale-105 transition-transform cursor-pointer">
                    <span>${i.icon}</span>
                    <span>${i.text}</span>
                </button>`;
            }).join('');
        }
    }
}

export function closeAiInsights() {
    const container = document.getElementById('aiInsightsContainer');
    if (container) container.classList.add('hidden');
}

export function renderRecurringSummary(STATE, { formatNum, escapeHtml }) {
    const section = document.getElementById('recurringSection');
    const list = document.getElementById('recurringList');
    const totalEl = document.getElementById('recurringTotal');
    if (!section || !list) return;

    const recurring = STATE.recurring || [];
    if (recurring.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    const monthlyTotal = recurring.reduce((s, r) => s + parseFloat(r.monthly_cost || 0), 0);
    if (totalEl) totalEl.textContent = `QAR ${formatNum(monthlyTotal)}/mo`;

    list.innerHTML = recurring.map(r => {
        const nextDate = r.next_expected ? new Date(r.next_expected) : null;
        const nextStr = nextDate ? nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        const consistency = parseFloat(r.amount_consistency || 0);
        return `<div class="flex items-center justify-between text-[10px] px-2 py-1 bg-white/50 dark:bg-gray-800/50 rounded border border-fact-border/30 dark:border-fact-dark-border/30">
            <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-fact-green font-medium truncate">${escapeHtml(r.merchant)}</span>
                <span class="text-fact-muted shrink-0">${escapeHtml(r.subcategory || '')}</span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                ${nextStr ? `<span class="text-fact-muted">next ${nextStr}</span>` : ''}
                <span class="font-semibold text-fact-ink dark:text-fact-dark-ink">QAR ${formatNum(parseFloat(r.avg_amount))}</span>
            </div>
        </div>`;
    }).join('');
}

export function renderProactiveInsights(STATE, { formatNum, escapeHtml }) {
    const section = document.getElementById('proactiveSection');
    const list = document.getElementById('proactiveList');
    if (!section || !list) return;

    const insights = STATE.proactiveInsights || [];
    // Only show medium/high severity or limit to top 5
    const notable = insights
        .filter(i => i.severity !== 'info' || i.insight_type === 'new_merchant')
        .slice(0, 5);

    if (notable.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');

    const iconMap = {
        'budget_warning': '⚠️',
        'spending_spike': '📈',
        'new_merchant': '🆕',
        'large_purchase': '💰',
    };

    const colorMap = {
        'high': 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20',
        'medium': 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20',
        'low': 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20',
        'info': 'border-fact-border dark:border-fact-dark-border bg-white/50 dark:bg-gray-800/50',
    };

    list.innerHTML = notable.map(i => {
        const icon = iconMap[i.insight_type] || '💡';
        const colors = colorMap[i.severity] || colorMap['info'];
        return `<div class="px-2.5 py-1.5 text-[10px] rounded-lg border ${colors}">
            <span>${icon}</span> ${escapeHtml(i.description)}
        </div>`;
    }).join('');
}

export async function refreshInsights(STATE, supabaseClient, CONFIG, callbacks) {
    const { formatNum, escapeHtml, sanitizeHTML, prepareTransactionSummary } = callbacks;

    const btn = document.getElementById('refreshInsightsBtn');
    const aiContainer = document.getElementById('aiInsightsContainer');
    const aiList = document.getElementById('aiInsightsList');

    if (!btn) return;

    // Show loading state
    btn.disabled = true;
    btn.innerHTML = `
        <svg class="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
        </svg>
        Analyzing...
    `;

    try {
        const txnSummary = prepareTransactionSummary(STATE, formatNum);
        const contextSummary = STATE.userContext.length > 0
            ? '\n\nUser corrections/context: ' + STATE.userContext.map(c => c.value).join('; ')
            : '';

        const { data: session } = await supabaseClient.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) throw new Error('Not authenticated');

        const response = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-ai`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                q: 'Analyse this spending data and return exactly 3-5 bullet points. Each must: (1) cite a specific QAR amount or percentage, (2) name the merchant/category involved, (3) end with one actionable suggestion. Start each bullet with a relevant emoji. One sentence per bullet, no headers.' + contextSummary,
                data: txnSummary,
                model: 'claude-sonnet'
            })
        });

        const data = await response.json();

        if (data.error) throw new Error(data.error);

        const aiInsights = data.answer
            .split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => line.replace(/^[-*]\s*/, '').trim())
            .filter(line => line.length > 0)
            .slice(0, 5);

        if (aiInsights.length > 0 && aiContainer && aiList) {
            aiContainer.classList.remove('hidden');
            aiList.innerHTML = aiInsights.map(insight => `
                <div class="px-2.5 py-1.5 text-[11px] bg-gradient-to-r from-fact-purple/5 to-fact-yellow/5 border border-fact-purple/20 rounded-lg text-fact-ink dark:text-fact-dark-ink">
                    ${sanitizeHTML(insight)}
                </div>
            `).join('');

            // Persist insights to DB
            try {
                await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-profile`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`
                    },
                    body: JSON.stringify({
                        action: 'insights.save',
                        insight: {
                            type: 'manual',
                            insights: data.answer,
                            period_start: STATE.dateRange?.start?.toISOString() || null,
                            period_end: STATE.dateRange?.end?.toISOString() || null,
                            metadata: { model: data.model || 'claude-sonnet', txn_count: STATE.filtered?.length || 0 }
                        }
                    })
                });
            } catch (_e) { /* silently fail persistence */ }
        }

    } catch (err) {
        if (aiContainer && aiList) {
            aiContainer.classList.remove('hidden');
            aiList.innerHTML = `<div class="text-[11px] text-fact-red">Error: ${escapeHtml(err.message)}</div>`;
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = `
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            Refresh
        `;
    }
}
