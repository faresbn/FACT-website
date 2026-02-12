// ─── FORECAST MODULE ─────────────────────────────────────────────
// Client-side spending forecasts using already-synced data
// No new edge functions needed — all computation from STATE

import dayjs from 'dayjs';

/**
 * Forecast spending to end of current salary period
 * Returns projected balance, daily burn rate, and confidence
 */
export function forecastPeriodEnd(STATE) {
    const today = dayjs().startOf('day');
    const periodEnd = STATE.dateRange?.end || today.endOf('month');
    const periodStart = STATE.dateRange?.start || today.startOf('month');
    const daysRemaining = Math.max(0, periodEnd.diff(today, 'day'));
    const daysPassed = Math.max(1, today.diff(periodStart, 'day') + 1);

    const filtered = STATE.filtered || [];

    const expenses = filtered
        .filter(t => t.direction === 'OUT')
        .reduce((s, t) => s + (t.amtQAR || t.amount || 0), 0);

    const income = filtered
        .filter(t => t.direction === 'IN')
        .reduce((s, t) => s + (t.amtQAR || t.amount || 0), 0);

    const dailyBurn = daysPassed > 0 ? expenses / daysPassed : 0;
    const projectedTotal = expenses + (dailyBurn * daysRemaining);
    const projectedBalance = income - projectedTotal;

    // Use server-computed confidence if available, else compute client-side
    const confidence = STATE.forecastData?.confidenceStats?.confidence
        || getConfidence(getMonthsOfData(STATE), getDailyVariance(STATE));

    return {
        dailyBurn,
        daysRemaining,
        projectedTotal,
        projectedBalance,
        currentSpent: expenses,
        currentIncome: income,
        confidence
    };
}

/**
 * Forecast category trends — uses server-computed data when available,
 * falls back to client-side 3-month moving average per category
 */
export function forecastCategories(STATE) {
    // Use server-computed category trends if available
    if (STATE.forecastData?.categoryTrends?.length) {
        return STATE.forecastData.categoryTrends;
    }

    // Fallback: client-side computation
    const today = dayjs();
    const trends = [];
    const allTxns = STATE.allTxns || [];

    const catMonthly = {};
    for (const t of allTxns) {
        if (t.direction !== 'OUT' || !t.merchantType) continue;
        const cat = t.merchantType;
        const monthKey = t.date.format('YYYY-MM');
        if (!catMonthly[cat]) catMonthly[cat] = {};
        if (!catMonthly[cat][monthKey]) catMonthly[cat][monthKey] = 0;
        catMonthly[cat][monthKey] += (t.amtQAR || t.amount || 0);
    }

    const thisMonth = today.format('YYYY-MM');
    const lastMonth = today.subtract(1, 'month').format('YYYY-MM');
    const twoMonthsAgo = today.subtract(2, 'month').format('YYYY-MM');

    for (const [cat, monthly] of Object.entries(catMonthly)) {
        const current = monthly[thisMonth] || 0;
        const prev = monthly[lastMonth] || 0;
        const prevPrev = monthly[twoMonthsAgo] || 0;

        const hasHistory = prev > 0 || prevPrev > 0;
        if (!hasHistory && current === 0) continue;

        const avgPrev = prev > 0 && prevPrev > 0 ? (prev + prevPrev) / 2 : (prev || prevPrev || 0);
        const changePercent = avgPrev > 0 ? ((current - avgPrev) / avgPrev) * 100 : 0;

        let trend = 'stable';
        if (changePercent > 10) trend = 'rising';
        else if (changePercent < -10) trend = 'falling';

        trends.push({
            category: cat,
            current,
            avgPrevious: avgPrev,
            changePercent,
            trend,
            projected30d: current > 0
                ? (current / Math.max(1, today.date())) * 30
                : avgPrev
        });
    }

    trends.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
    return trends;
}

/**
 * Forecast recurring costs for next 30 days
 * Uses STATE.recurring from flow-data's detect_recurring_transactions
 */
export function forecastRecurring(STATE) {
    const recurring = STATE.recurring || [];
    if (!recurring.length) return { total: 0, items: [] };

    const items = recurring
        .filter(r => r.is_active !== false)
        .map(r => ({
            name: r.counterparty || r.merchant,
            monthlyCost: r.monthly_cost || r.avg_amount || 0,
            frequency: r.frequency || 'monthly',
            category: r.category || 'Other',
            lastSeen: r.last_seen ? dayjs(r.last_seen) : null
        }));

    const total = items.reduce((s, i) => s + i.monthlyCost, 0);

    return { total, items };
}

/**
 * Forecast goal trajectories
 * For each goal, predict if on track or when overage will occur
 */
export function forecastGoals(STATE) {
    const goals = STATE.dbGoals || [];
    if (!goals.length) return { safe: 0, warning: 0, over: 0, details: [] };

    const today = dayjs();
    const filtered = STATE.filtered || [];
    const details = [];
    let safe = 0, warning = 0, over = 0;

    for (const goal of goals) {
        const limit = goal.amount || 0;
        if (!limit) continue;

        // Find matching spending (goals use merchantType for category matching)
        const cat = goal.category;
        const currentSpend = filtered
            .filter(t => t.direction === 'OUT' && t.merchantType === cat)
            .reduce((s, t) => s + (t.amtQAR || t.amount || 0), 0);

        const periodStart = STATE.dateRange?.start || today.startOf('month');
        const periodEnd = STATE.dateRange?.end || today.endOf('month');
        const periodDays = Math.max(1, today.diff(periodStart, 'day') + 1);
        const totalPeriodDays = Math.max(1, periodEnd.diff(periodStart, 'day') + 1);
        const dailyRate = currentSpend / periodDays;
        const projected = dailyRate * totalPeriodDays;
        const percentUsed = (currentSpend / limit) * 100;
        const percentProjected = (projected / limit) * 100;

        let status = 'safe';
        if (percentProjected > 100) {
            const daysToExceed = dailyRate > 0 ? Math.ceil((limit - currentSpend) / dailyRate) : Infinity;
            if (percentUsed > 100) {
                status = 'over';
                over++;
            } else {
                status = 'warning';
                warning++;
            }
            details.push({ category: cat, limit, currentSpend, projected, status, percentUsed, daysToExceed });
        } else {
            safe++;
            details.push({ category: cat, limit, currentSpend, projected, status, percentUsed, daysToExceed: Infinity });
        }
    }

    return { safe, warning, over, details };
}

/**
 * Render the forecast card
 */
export function renderForecast(STATE, { formatNum }) {
    const container = document.getElementById('forecastCard');
    if (!container) return;

    const period = forecastPeriodEnd(STATE);
    const recurring = forecastRecurring(STATE);
    const categories = forecastCategories(STATE);
    const goals = forecastGoals(STATE);

    // Find top rising category
    const topRising = categories.find(c => c.trend === 'rising');
    const risingLabel = topRising
        ? `${topRising.category} +${Math.round(topRising.changePercent)}%`
        : 'All stable';
    const risingSubLabel = topRising ? 'vs last month' : 'no notable changes';

    // Goals summary
    const totalGoals = goals.safe + goals.warning + goals.over;
    const goalsLabel = totalGoals > 0
        ? `${goals.safe}/${totalGoals} safe`
        : 'No goals set';
    const goalsSubLabel = goals.warning > 0
        ? `${goals.warning} warning`
        : goals.over > 0
            ? `${goals.over} over budget`
            : totalGoals > 0 ? 'all on track' : 'set goals in settings';

    // Confidence badge color
    const confColors = {
        high: 'bg-fact-green/20 text-fact-green',
        medium: 'bg-fact-yellow/20 text-fact-yellow',
        low: 'bg-fact-red/20 text-fact-red'
    };
    const confClass = confColors[period.confidence] || confColors.low;

    // Balance color
    const balColor = period.projectedBalance >= 0 ? 'text-fact-green' : 'text-fact-red';
    const balPrefix = period.projectedBalance >= 0 ? '+' : '';

    container.innerHTML = `
        <div class="flex items-center justify-between mb-2">
            <h3 class="text-xs font-semibold text-fact-ink dark:text-fact-dark-ink uppercase tracking-wider">Forecast</h3>
            <span class="text-[9px] px-1.5 py-0.5 rounded-full font-medium ${confClass}">${period.confidence}</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
            <div class="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                <div class="text-sm font-display font-bold ${balColor}">${balPrefix}${formatNum(Math.abs(period.projectedBalance))}</div>
                <div class="text-[9px] text-fact-muted dark:text-fact-dark-muted mt-0.5">projected bal</div>
                <div class="text-[8px] text-fact-muted dark:text-fact-dark-muted">${period.daysRemaining}d left</div>
            </div>
            <div class="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                <div class="text-sm font-display font-bold text-fact-ink dark:text-fact-dark-ink">${formatNum(recurring.total)}</div>
                <div class="text-[9px] text-fact-muted dark:text-fact-dark-muted mt-0.5">upcoming bills</div>
                <div class="text-[8px] text-fact-muted dark:text-fact-dark-muted">next 30d</div>
            </div>
            <div class="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                <div class="text-sm font-display font-bold ${topRising?.trend === 'rising' ? 'text-fact-red' : 'text-fact-green'}">${risingLabel}</div>
                <div class="text-[9px] text-fact-muted dark:text-fact-dark-muted mt-0.5">trending</div>
                <div class="text-[8px] text-fact-muted dark:text-fact-dark-muted">${risingSubLabel}</div>
            </div>
            <div class="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                <div class="text-sm font-display font-bold text-fact-ink dark:text-fact-dark-ink">${goalsLabel}</div>
                <div class="text-[9px] text-fact-muted dark:text-fact-dark-muted mt-0.5">goals</div>
                <div class="text-[8px] text-fact-muted dark:text-fact-dark-muted">${goalsSubLabel}</div>
            </div>
        </div>
    `;
}

/**
 * Render SVG radial gauges for each active budget goal.
 * Color: green (<80%), yellow (80-100%), red (>100%). Center: remaining amount.
 * innerHTML safety: all data from forecastGoals() which computes from STATE (our own DB data).
 * Category names come from goals table (user's own goals). No external/untrusted input.
 */
export function renderGoalGauges(STATE, { formatNum }) {
    const container = document.getElementById('goalGauges');
    if (!container) return;

    const goals = forecastGoals(STATE);
    if (!goals.details.length) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    // SVG gauge: 60px circle, stroke-dasharray for arc progress
    container.innerHTML = `
        <h3 class="text-xs font-semibold text-fact-ink dark:text-fact-dark-ink uppercase tracking-wider mb-3">Goal Progress</h3>
        <div class="grid grid-cols-3 gap-3 sm:grid-cols-4">
            ${goals.details.map(g => {
                const pct = Math.min(g.percentUsed, 120);
                const remaining = Math.max(0, g.limit - g.currentSpend);
                const color = pct > 100 ? '#EF4444' : pct > 80 ? '#F59E0B' : '#10B981';
                const radius = 26;
                const circumference = 2 * Math.PI * radius;
                const offset = circumference - (Math.min(pct, 100) / 100) * circumference;
                return `
                    <div class="text-center">
                        <svg viewBox="0 0 64 64" class="w-14 h-14 mx-auto">
                            <circle cx="32" cy="32" r="${radius}" fill="none" stroke="currentColor" stroke-width="4" class="text-gray-200 dark:text-gray-700"/>
                            <circle cx="32" cy="32" r="${radius}" fill="none" stroke="${color}" stroke-width="4"
                                stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
                                stroke-linecap="round" transform="rotate(-90 32 32)" class="transition-all duration-700"/>
                            <text x="32" y="30" text-anchor="middle" class="fill-current text-[8px] font-bold">${Math.round(pct)}%</text>
                            <text x="32" y="40" text-anchor="middle" class="fill-current text-[6px] text-fact-muted">${formatNum(remaining)}</text>
                        </svg>
                        <div class="text-[9px] font-medium mt-1 truncate">${g.category}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// ─── Helpers ──────────────────────────────────────────────────

function getMonthsOfData(STATE) {
    const allTxns = STATE.allTxns || [];
    if (!allTxns.length) return 0;
    const earliest = allTxns.reduce((min, t) => t.date.isBefore(min) ? t.date : min, dayjs());
    return dayjs().diff(earliest, 'month', true);
}

function getDailyVariance(STATE) {
    const today = dayjs();
    const allTxns = STATE.allTxns || [];
    const last30 = allTxns.filter(t =>
        t.direction === 'OUT' && t.date.isAfter(today.subtract(30, 'day'))
    );
    if (last30.length < 7) return 1; // high variance if insufficient data

    // Group by day
    const dailyTotals = {};
    for (const t of last30) {
        const key = t.date.format('YYYY-MM-DD');
        if (!dailyTotals[key]) dailyTotals[key] = 0;
        dailyTotals[key] += (t.amtQAR || t.amount || 0);
    }

    const values = Object.values(dailyTotals);
    if (values.length < 3) return 1;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1; // coefficient of variation
    return cv;
}

function getConfidence(monthsOfData, variance) {
    if (monthsOfData >= 3 && variance < 0.5) return 'high';
    if (monthsOfData >= 2 || variance < 0.8) return 'medium';
    return 'low';
}
