// ─── FILTER & RENDER ──────────────────────────────────────────
import dayjs from 'dayjs';

// FILTER & RENDER
export function filterAndRender(STATE, callbacks) {
    const { start, end } = STATE.dateRange;
    STATE.filtered = STATE.allTxns.filter(t => t.date.isBetween(start, end, 'day', '[]'));
    STATE.txnSort = STATE.txnSort || 'date-desc';
    STATE.txnFilter = STATE.txnFilter || '';

    const {
        renderBudgetProjection,
        renderDonutChart,
        renderCategoryBreakdown,
        renderRecentTxns,
        renderUncatAlert,
        renderQuickInsights,
        renderTodaySection,
        checkForImpulseBursts
    } = callbacks;

    renderBudgetProjection();
    renderDonutChart();
    renderCategoryBreakdown();
    renderRecentTxns();
    renderUncatAlert();
    renderQuickInsights();
    renderTodaySection();
    checkForImpulseBursts();
}

// Render Today section with daily budget meter
export function renderTodaySection(STATE, callbacks) {
    const { checkDailyBudget, formatNum, updateDailyBudgetMeter, updateStreak, renderStreakBadge, renderGenerosityBudget, updateFocusHero, updateQuickInsight, isFocusMode } = callbacks;

    // Update date
    document.getElementById('todayDate').textContent = dayjs().format('dddd, MMM D');

    // Calculate today's spending
    const status = checkDailyBudget();
    document.getElementById('todaySpent').textContent = `QAR ${formatNum(status.spent)}`;
    document.getElementById('todayBudget').textContent = `QAR ${formatNum(status.budget)}`;

    // Update meter
    updateDailyBudgetMeter();

    // Update streak
    updateStreak();
    renderStreakBadge();

    // Update generosity budget (if enabled)
    if (typeof renderGenerosityBudget === 'function') {
        renderGenerosityBudget();
    }

    // Update focus mode hero if active
    if (isFocusMode && typeof updateFocusHero === 'function') {
        updateFocusHero();
        updateQuickInsight();
    }
}

// Category breakdown for left panel
export function renderCategoryBreakdown(STATE, callbacks) {
    const { formatNum, escapeHtml, SUMMARY_GROUPS, MERCHANT_TYPES } = callbacks;

    const out = STATE.filtered.filter(t => t.direction === 'OUT');
    const container = document.getElementById('categoryBreakdown');

    if (STATE.viewMode === 'parent') {
        // Group by summary group
        const byGroup = {};
        out.forEach(t => {
            if (!byGroup[t.summaryGroup]) byGroup[t.summaryGroup] = { total: 0, count: 0 };
            byGroup[t.summaryGroup].total += t.amount;
            byGroup[t.summaryGroup].count++;
        });

        const total = out.reduce((s, t) => s + t.amount, 0);
        const sorted = Object.entries(byGroup).sort((a, b) => b[1].total - a[1].total);

        container.innerHTML = sorted.map(([group, data]) => {
            const pct = total > 0 ? (data.total / total * 100).toFixed(0) : 0;
            const color = SUMMARY_GROUPS[group]?.color || '#999';
            const icon = SUMMARY_GROUPS[group]?.icon || '?';
            return `
                <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition" onclick="openParentDrilldown('${group}')">
                    <div class="w-8 h-8 rounded-full flex items-center justify-center" style="background: ${color}20">
                        <span>${icon}</span>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between">
                            <span class="text-sm font-medium truncate">${group}</span>
                            <span class="text-sm font-bold">${formatNum(data.total)}</span>
                        </div>
                        <div class="flex items-center gap-2 mt-1">
                            <div class="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                <div class="h-full rounded-full" style="width: ${pct}%; background: ${color}"></div>
                            </div>
                            <span class="text-[10px] text-fact-muted">${pct}%</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        // Group by merchant type
        const byType = {};
        out.forEach(t => {
            if (!byType[t.merchantType]) byType[t.merchantType] = { total: 0, count: 0 };
            byType[t.merchantType].total += t.amount;
            byType[t.merchantType].count++;
        });

        const total = out.reduce((s, t) => s + t.amount, 0);
        const sorted = Object.entries(byType).sort((a, b) => b[1].total - a[1].total);

        container.innerHTML = sorted.slice(0, 10).map(([type, data]) => {
            const pct = total > 0 ? (data.total / total * 100).toFixed(0) : 0;
            const color = MERCHANT_TYPES[type]?.color || '#999';
            const icon = MERCHANT_TYPES[type]?.icon || '?';
            return `
                <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition" onclick="openDrilldown('${type}')">
                    <div class="w-6 h-6 rounded-full flex items-center justify-center text-xs" style="background: ${color}20">
                        ${icon}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-medium truncate">${type}</span>
                            <span class="text-xs font-bold">${formatNum(data.total)}</span>
                        </div>
                        <div class="flex items-center gap-2 mt-0.5">
                            <div class="flex-1 h-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                <div class="h-full rounded-full" style="width: ${pct}%; background: ${color}"></div>
                            </div>
                            <span class="text-[9px] text-fact-muted">${data.count}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

// Transaction sorting
export function sortTransactions(sortBy, STATE, renderRecentTxns) {
    STATE.txnSort = sortBy;
    renderRecentTxns();
}

// Transaction filtering
export function filterTransactions(query, STATE, renderRecentTxns) {
    STATE.txnFilter = query.toLowerCase();
    renderRecentTxns();
}

// VIEW MODE TOGGLE
export function setViewMode(mode, STATE, renderCategoryBreakdown, renderDonutChart) {
    STATE.viewMode = mode;

    const parentBtn = document.getElementById('viewParent');
    const subcatBtn = document.getElementById('viewSubcat');

    if (mode === 'parent') {
        parentBtn.classList.add('bg-fact-ink', 'dark:bg-fact-dark-ink', 'text-white', 'dark:text-fact-dark-bg');
        parentBtn.classList.remove('text-fact-muted', 'dark:text-fact-dark-muted');
        subcatBtn.classList.remove('bg-fact-ink', 'dark:bg-fact-dark-ink', 'text-white', 'dark:text-fact-dark-bg');
        subcatBtn.classList.add('text-fact-muted', 'dark:text-fact-dark-muted');
    } else {
        subcatBtn.classList.add('bg-fact-ink', 'dark:bg-fact-dark-ink', 'text-white', 'dark:text-fact-dark-bg');
        subcatBtn.classList.remove('text-fact-muted', 'dark:text-fact-dark-muted');
        parentBtn.classList.remove('bg-fact-ink', 'dark:bg-fact-dark-ink', 'text-white', 'dark:text-fact-dark-bg');
        parentBtn.classList.add('text-fact-muted', 'dark:text-fact-dark-muted');
    }

    renderCategoryBreakdown();
    renderDonutChart();
}

// METRICS
export function renderMetrics(STATE, formatNum) {
    const out = STATE.filtered.filter(t => t.direction === 'OUT');
    const inc = STATE.filtered.filter(t => t.direction === 'IN');

    const totalSpend = out.reduce((s, t) => s + t.amount, 0);
    const totalIncome = inc.reduce((s, t) => s + t.amount, 0);
    const net = totalIncome - totalSpend;

    const daysTotal = STATE.dateRange.end.diff(STATE.dateRange.start, 'day') + 1;
    const daysPassed = dayjs().diff(STATE.dateRange.start, 'day') + 1;
    const daysLeft = Math.max(0, daysTotal - daysPassed);
    const dailyBudget = daysLeft > 0 ? net / daysLeft : 0;

    document.getElementById('metricIncome').textContent = formatNum(totalIncome);
    document.getElementById('metricSpent').textContent = formatNum(totalSpend);
    document.getElementById('metricNet').textContent = (net >= 0 ? '+' : '') + formatNum(net);
    document.getElementById('metricDaily').textContent = formatNum(Math.max(0, dailyBudget));
    document.getElementById('metricDaysLeft').textContent = `${daysLeft} days left`;

    const netDot = document.getElementById('netDot');
    netDot.classList.toggle('bg-fact-green', net >= 0);
    netDot.classList.toggle('bg-fact-red', net < 0);
}
