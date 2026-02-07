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

    // Confidence based on data age
    const monthsOfData = getMonthsOfData(STATE);
    const variance = getDailyVariance(STATE);
    const confidence = getConfidence(monthsOfData, variance);

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
 * Forecast category trends — 3-month moving average per category
 * Flags rising/falling categories
 */
export function forecastCategories(STATE) {
    const today = dayjs();
    const trends = [];
    const allTxns = STATE.allTxns || [];

    // Group all transactions by month and category (last 3 months)
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

        // Need at least 2 months of data to show a trend
        const hasHistory = prev > 0 || prevPrev > 0;
        if (!hasHistory && current === 0) continue;

        const avgPrev = prev > 0 && prevPrev > 0 ? (prev + prevPrev) / 2 : (prev || prevPrev || 0);
        const changePercent = avgPrev > 0 ? ((current - avgPrev) / avgPrev) * 100 : 0;

        // Only flag notable changes (>10%)
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

    // Sort by absolute change
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
        <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-fact-ink dark:text-fact-dark-ink">Forecast</h3>
            <span class="text-[10px] px-2 py-0.5 rounded-full font-medium ${confClass}">${period.confidence} confidence</span>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div class="text-center p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
                <div class="text-lg font-display font-bold ${balColor}">${balPrefix}${formatNum(Math.abs(period.projectedBalance))}</div>
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mt-1">projected balance</div>
                <div class="text-[9px] text-fact-muted dark:text-fact-dark-muted">${period.daysRemaining}d remaining</div>
            </div>
            <div class="text-center p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
                <div class="text-lg font-display font-bold text-fact-ink dark:text-fact-dark-ink">${formatNum(recurring.total)}</div>
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mt-1">upcoming bills</div>
                <div class="text-[9px] text-fact-muted dark:text-fact-dark-muted">next 30 days</div>
            </div>
            <div class="text-center p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
                <div class="text-lg font-display font-bold ${topRising?.trend === 'rising' ? 'text-fact-red' : 'text-fact-green'}">${risingLabel}</div>
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mt-1">trending up</div>
                <div class="text-[9px] text-fact-muted dark:text-fact-dark-muted">${risingSubLabel}</div>
            </div>
            <div class="text-center p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
                <div class="text-lg font-display font-bold text-fact-ink dark:text-fact-dark-ink">${goalsLabel}</div>
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mt-1">goals</div>
                <div class="text-[9px] text-fact-muted dark:text-fact-dark-muted">${goalsSubLabel}</div>
            </div>
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
