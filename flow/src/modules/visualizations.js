// ─── ADVANCED VISUALIZATIONS ───────────────────────────────────
// Spending trend, treemap, period comparison, time heatmap

import Chart from 'chart.js/auto';
import { TreemapController, TreemapElement } from 'chartjs-chart-treemap';
import dayjs from 'dayjs';

// Register treemap plugin
Chart.register(TreemapController, TreemapElement);

const vizCharts = {};

// ============== 1. SPENDING TREND AREA CHART ==============
// Stacked area by category over weekly buckets
export function renderSpendingTrend(STATE, { formatNum, SUMMARY_GROUPS }) {
    const container = document.getElementById('spendingTrendChart');
    if (!container) return;

    const groups = Object.keys(SUMMARY_GROUPS);

    // Try server-provided weekly data first
    let sortedWeeks, weeks;
    if (STATE.chartData?.weekly?.length) {
        weeks = {};
        STATE.chartData.weekly.forEach(w => {
            if (!weeks[w.weekStart]) {
                weeks[w.weekStart] = {};
                groups.forEach(g => weeks[w.weekStart][g] = 0);
            }
            weeks[w.weekStart][w.group] = (weeks[w.weekStart][w.group] || 0) + w.total;
        });
        sortedWeeks = Object.keys(weeks).sort();
    } else {
        // Fallback: client-side aggregation
        const out = STATE.filtered.filter(t => t.direction === 'OUT');
        if (out.length === 0) return;

        weeks = {};
        out.forEach(t => {
            const weekStart = t.date.startOf('week').format('YYYY-MM-DD');
            if (!weeks[weekStart]) {
                weeks[weekStart] = {};
                groups.forEach(g => weeks[weekStart][g] = 0);
            }
            weeks[weekStart][t.summaryGroup] = (weeks[weekStart][t.summaryGroup] || 0) + t.amount;
        });
        sortedWeeks = Object.keys(weeks).sort();
    }

    if (!sortedWeeks.length) return;
    const labels = sortedWeeks.map(w => dayjs(w).format('MMM D'));
    const isDark = document.body.classList.contains('dark-mode') || window.matchMedia('(prefers-color-scheme: dark)').matches;

    const datasets = groups
        .filter(g => sortedWeeks.some(w => weeks[w][g] > 0))
        .map(group => ({
            label: group,
            data: sortedWeeks.map(w => weeks[w][group] || 0),
            backgroundColor: (SUMMARY_GROUPS[group]?.color || '#999') + '40',
            borderColor: SUMMARY_GROUPS[group]?.color || '#999',
            borderWidth: 1.5,
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
        }));

    if (vizCharts.trend) vizCharts.trend.destroy();

    vizCharts.trend = new Chart(container, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 8,
                        boxHeight: 8,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 12,
                        font: { size: 10 },
                        color: isDark ? '#9CA3AF' : '#6B7280',
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 15, 15, 0.95)',
                    titleColor: '#F4C44E',
                    bodyColor: '#ffffff',
                    borderColor: '#F4C44E',
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 10,
                    bodyFont: { size: 11 },
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: QAR ${formatNum(ctx.raw)}`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: isDark ? '#888' : '#666', font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
                    stacked: true,
                },
                y: {
                    grid: { color: isDark ? '#2A2A2A' : '#E5E5E5' },
                    ticks: { color: isDark ? '#888' : '#666', font: { size: 10 }, callback: v => formatNum(v) },
                    beginAtZero: true,
                    stacked: true,
                },
            },
        },
    });
}

// ============== 2. MERCHANT TREEMAP ==============
export function renderMerchantTreemap(STATE, { formatNum, SUMMARY_GROUPS }) {
    const container = document.getElementById('merchantTreemapChart');
    if (!container) return;

    let treeData;

    // Try server-provided top merchants first
    if (STATE.chartData?.topMerchants?.length) {
        treeData = STATE.chartData.topMerchants;
    } else {
        // Fallback: client-side aggregation
        const out = STATE.filtered.filter(t => t.direction === 'OUT');
        if (out.length === 0) return;

        const merchantData = {};
        out.forEach(t => {
            const key = t.consolidated || t.display || 'Unknown';
            if (!merchantData[key]) {
                merchantData[key] = {
                    merchant: key,
                    group: t.summaryGroup,
                    total: 0,
                    count: 0,
                    category: t.merchantType,
                };
            }
            merchantData[key].total += t.amount;
            merchantData[key].count++;
        });

        treeData = Object.values(merchantData)
            .filter(m => m.total > 0)
            .sort((a, b) => b.total - a.total)
            .slice(0, 30);
    }

    if (!treeData.length) return;

    const groupColors = {};
    Object.entries(SUMMARY_GROUPS).forEach(([name, data]) => {
        groupColors[name] = data.color;
    });

    const isDark = document.body.classList.contains('dark-mode') || window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (vizCharts.treemap) vizCharts.treemap.destroy();

    vizCharts.treemap = new Chart(container, {
        type: 'treemap',
        data: {
            datasets: [{
                tree: treeData,
                key: 'total',
                groups: ['group', 'merchant'],
                spacing: 1,
                borderWidth: 1,
                borderColor: isDark ? '#1A1A1A' : '#ffffff',
                backgroundColor: (ctx) => {
                    if (!ctx.raw?._data) return '#999';
                    const group = ctx.raw._data.group || ctx.raw._data.children?.[0]?.group;
                    const color = groupColors[group] || '#999';
                    // Make leaf nodes slightly different opacity
                    return ctx.type === 'data' && ctx.raw._data.merchant
                        ? color + 'CC'
                        : color + '40';
                },
                labels: {
                    display: true,
                    align: 'center',
                    position: 'middle',
                    font: { size: 10, weight: 'bold' },
                    color: isDark ? '#F5F5F5' : '#111111',
                    formatter: (ctx) => {
                        const data = ctx.raw?._data;
                        if (!data) return '';
                        if (data.merchant) {
                            return ctx.raw.w > 60 && ctx.raw.h > 30
                                ? [data.merchant, `QAR ${formatNum(data.total)}`]
                                : data.merchant;
                        }
                        return data.group || '';
                    },
                },
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 15, 15, 0.95)',
                    titleColor: '#F4C44E',
                    bodyColor: '#ffffff',
                    borderColor: '#F4C44E',
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 10,
                    callbacks: {
                        title: (items) => items[0]?.raw?._data?.merchant || items[0]?.raw?._data?.group || '',
                        label: (ctx) => {
                            const d = ctx.raw?._data;
                            if (!d) return '';
                            const lines = [`QAR ${formatNum(d.total)}`];
                            if (d.count) lines.push(`${d.count} transactions`);
                            if (d.category) lines.push(`Category: ${d.category}`);
                            return lines;
                        },
                    },
                },
            },
        },
    });
}

// ============== 3. PERIOD COMPARISON ==============
let compareMode = 'bar'; // 'bar' or 'line'

export function toggleCompareMode() {
    compareMode = compareMode === 'bar' ? 'line' : 'bar';
    // Update toggle button text
    const btn = document.getElementById('compareModeToggle');
    if (btn) btn.textContent = compareMode === 'bar' ? 'Line' : 'Bar';
}

export function renderPeriodComparison(STATE, { formatNum, SUMMARY_GROUPS }) {
    const container = document.getElementById('periodComparisonChart');
    if (!container) return;

    const { start, end } = STATE.dateRange;
    const periodLength = end.diff(start, 'day');
    const prevStart = start.subtract(periodLength + 1, 'day');
    const prevEnd = start.subtract(1, 'day');

    const isDark = document.body.classList.contains('dark-mode') || window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (vizCharts.comparison) vizCharts.comparison.destroy();

    if (compareMode === 'line') {
        // Line overlay: daily spend for both periods on same day-offset axis
        const currentDaily = {};
        const prevDaily = {};

        const currentOut = STATE.allTxns.filter(t =>
            t.direction === 'OUT' && t.date.isBetween(start, end, 'day', '[]')
        );
        const prevOut = STATE.allTxns.filter(t =>
            t.direction === 'OUT' && t.date.isBetween(prevStart, prevEnd, 'day', '[]')
        );

        currentOut.forEach(t => {
            const dayOffset = t.date.diff(start, 'day');
            currentDaily[dayOffset] = (currentDaily[dayOffset] || 0) + (t.amtQAR || t.amount || 0);
        });
        prevOut.forEach(t => {
            const dayOffset = t.date.diff(prevStart, 'day');
            prevDaily[dayOffset] = (prevDaily[dayOffset] || 0) + (t.amtQAR || t.amount || 0);
        });

        const days = Math.max(periodLength + 1, 1);
        const labels = [];
        const currentData = [];
        const prevData = [];
        for (let d = 0; d < days; d++) {
            labels.push(`Day ${d + 1}`);
            currentData.push(currentDaily[d] || 0);
            prevData.push(prevDaily[d] || 0);
        }

        vizCharts.comparison = new Chart(container, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: `${prevStart.format('MMM D')} - ${prevEnd.format('MMM D')}`,
                        data: prevData,
                        borderColor: isDark ? '#666' : '#9CA3AF',
                        backgroundColor: isDark ? 'rgba(102,102,102,0.1)' : 'rgba(156,163,175,0.1)',
                        borderWidth: 1.5,
                        borderDash: [4, 4],
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                    },
                    {
                        label: `${start.format('MMM D')} - ${end.format('MMM D')}`,
                        data: currentData,
                        borderColor: '#F4C44E',
                        backgroundColor: 'rgba(244,196,78,0.15)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 10 }, color: isDark ? '#9CA3AF' : '#6B7280' }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 15, 15, 0.95)',
                        titleColor: '#F4C44E',
                        bodyColor: '#ffffff',
                        borderColor: '#F4C44E',
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 10,
                        callbacks: { label: (ctx) => ` ${ctx.dataset.label}: QAR ${formatNum(ctx.raw)}` },
                    },
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: isDark ? '#888' : '#666', font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
                    y: { grid: { color: isDark ? '#2A2A2A' : '#E5E5E5' }, ticks: { color: isDark ? '#888' : '#666', font: { size: 10 }, callback: v => formatNum(v) }, beginAtZero: true },
                },
            },
        });
    } else {
        // Bar mode (original)
        const groups = Object.keys(SUMMARY_GROUPS);
        const currentByGroup = {};
        const prevByGroup = {};
        groups.forEach(g => { currentByGroup[g] = 0; prevByGroup[g] = 0; });

        if (STATE.chartData?.comparison?.length) {
            STATE.chartData.comparison.forEach(c => {
                currentByGroup[c.group] = c.current;
                prevByGroup[c.group] = c.previous;
            });
        } else {
            const currentOut = STATE.allTxns.filter(t =>
                t.direction === 'OUT' && t.date.isBetween(start, end, 'day', '[]')
            );
            const prevOut = STATE.allTxns.filter(t =>
                t.direction === 'OUT' && t.date.isBetween(prevStart, prevEnd, 'day', '[]')
            );
            currentOut.forEach(t => currentByGroup[t.summaryGroup] = (currentByGroup[t.summaryGroup] || 0) + t.amount);
            prevOut.forEach(t => prevByGroup[t.summaryGroup] = (prevByGroup[t.summaryGroup] || 0) + t.amount);
        }

        const activeGroups = groups.filter(g => currentByGroup[g] > 0 || prevByGroup[g] > 0);

        vizCharts.comparison = new Chart(container, {
            type: 'bar',
            data: {
                labels: activeGroups,
                datasets: [
                    {
                        label: `${prevStart.format('MMM D')} - ${prevEnd.format('MMM D')}`,
                        data: activeGroups.map(g => prevByGroup[g]),
                        backgroundColor: isDark ? '#4A4A4A' : '#D1D5DB',
                        borderRadius: 4,
                        barPercentage: 0.7,
                        categoryPercentage: 0.7,
                    },
                    {
                        label: `${start.format('MMM D')} - ${end.format('MMM D')}`,
                        data: activeGroups.map(g => currentByGroup[g]),
                        backgroundColor: activeGroups.map(g => SUMMARY_GROUPS[g]?.color || '#999'),
                        borderRadius: 4,
                        barPercentage: 0.7,
                        categoryPercentage: 0.7,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 10 }, color: isDark ? '#9CA3AF' : '#6B7280' }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 15, 15, 0.95)',
                        titleColor: '#F4C44E',
                        bodyColor: '#ffffff',
                        borderColor: '#F4C44E',
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 10,
                        callbacks: { label: (ctx) => ` ${ctx.dataset.label}: QAR ${formatNum(ctx.raw)}` },
                    },
                },
                scales: {
                    x: {
                        grid: { color: isDark ? '#2A2A2A' : '#E5E5E5' },
                        ticks: { color: isDark ? '#888' : '#666', font: { size: 10 }, callback: v => formatNum(v) },
                        beginAtZero: true,
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: isDark ? '#CCC' : '#333', font: { size: 11, weight: '500' } },
                    },
                },
            },
        });
    }
}

// ============== 4. TIME-OF-DAY HEATMAP ==============
export function renderTimeHeatmap(STATE, { formatNum }) {
    const container = document.getElementById('timeHeatmapGrid');
    if (!container) return;

    // Build heatmap data: 7 days x 24 hours
    // Use pre-aggregated hourly_spend view when available (all-time, not period-filtered)
    const heatData = {};
    const maxAmount = { value: 0 };

    if (STATE.hourlySpend && STATE.hourlySpend.length > 0) {
        // Server-side pre-aggregated data from hourly_spend view
        STATE.hourlySpend.forEach(row => {
            const day = parseInt(row.day_of_week);
            const hour = parseInt(row.hour_of_day);
            const amount = parseFloat(row.total_amount || 0);
            const key = `${day}-${hour}`;
            heatData[key] = (heatData[key] || 0) + amount;
            if (heatData[key] > maxAmount.value) maxAmount.value = heatData[key];
        });
    } else {
        // Fallback: compute client-side from filtered transactions
        const out = STATE.filtered.filter(t => t.direction === 'OUT');
        if (out.length === 0) {
            container.innerHTML = '<div class="text-xs text-fact-muted p-4 text-center">No spending data for heatmap</div>';
            return;
        }
        out.forEach(t => {
            const day = t.date.day();
            const hour = t.date.hour();
            const key = `${day}-${hour}`;
            heatData[key] = (heatData[key] || 0) + t.amount;
            if (heatData[key] > maxAmount.value) maxAmount.value = heatData[key];
        });
    }

    if (maxAmount.value === 0) {
        container.innerHTML = '<div class="text-xs text-fact-muted p-4 text-center">No spending data for heatmap</div>';
        return;
    }

    // Qatar week: Sun-Thu work, Fri-Sat weekend
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hourLabels = [];
    for (let h = 0; h < 24; h += 3) {
        hourLabels.push(h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);
    }

    let html = '<div class="heatmap-container">';

    // Header row with hour labels
    html += '<div class="heatmap-row"><div class="heatmap-label"></div>';
    for (let h = 0; h < 24; h += 3) {
        html += `<div class="heatmap-hour-label">${hourLabels[h / 3]}</div>`;
    }
    html += '</div>';

    // Data rows
    for (let d = 0; d < 7; d++) {
        html += `<div class="heatmap-row"><div class="heatmap-label">${dayLabels[d]}</div>`;

        for (let h = 0; h < 24; h += 3) {
            // Aggregate 3-hour blocks
            let blockTotal = 0;
            let blockCount = 0;
            for (let hh = h; hh < h + 3; hh++) {
                const val = heatData[`${d}-${hh}`] || 0;
                blockTotal += val;
                if (val > 0) blockCount++;
            }

            const intensity = maxAmount.value > 0 ? Math.min(blockTotal / maxAmount.value, 1) : 0;
            const bgColor = intensity === 0
                ? 'var(--heatmap-empty)'
                : `rgba(244, 196, 78, ${0.15 + intensity * 0.85})`;
            const textColor = intensity > 0.5 ? '#111' : (intensity > 0 ? '#F4C44E' : 'transparent');

            html += `<div class="heatmap-cell" style="background: ${bgColor}; color: ${textColor}"
                title="${dayLabels[d]} ${h}:00-${h + 3}:00: QAR ${formatNum(blockTotal)}">
                ${blockTotal > 0 ? formatNum(blockTotal) : ''}
            </div>`;
        }
        html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
}

// ============== SMART METRIC CARDS ==============
export function renderSmartMetrics(STATE, { formatNum }) {
    const { start, end } = STATE.dateRange;
    const periodLength = end.diff(start, 'day') + 1;

    // Current period
    const currentOut = STATE.filtered.filter(t => t.direction === 'OUT');
    const currentIn = STATE.filtered.filter(t => t.direction === 'IN');
    const totalSpent = currentOut.reduce((s, t) => s + t.amount, 0);
    const totalIncome = currentIn.reduce((s, t) => s + t.amount, 0);
    const net = totalIncome - totalSpent;

    // Previous period for comparison
    const prevStart = start.subtract(periodLength, 'day');
    const prevEnd = start.subtract(1, 'day');
    const prevOut = STATE.allTxns.filter(t =>
        t.direction === 'OUT' && t.date.isBetween(prevStart, prevEnd, 'day', '[]')
    );
    const prevSpent = prevOut.reduce((s, t) => s + t.amount, 0);

    // Spend change %
    const spendChange = prevSpent > 0 ? ((totalSpent - prevSpent) / prevSpent * 100) : 0;

    // Daily budget
    const daysPassed = dayjs().diff(start, 'day') + 1;
    const daysLeft = Math.max(0, periodLength - daysPassed);
    const todayOut = STATE.allTxns.filter(t =>
        t.direction === 'OUT' && t.date.isSame(dayjs(), 'day')
    );
    const todaySpent = todayOut.reduce((s, t) => s + t.amount, 0);
    const dailyBudget = daysLeft > 0 ? Math.max(0, net) / daysLeft : 0;
    const dailyRemaining = dailyBudget - todaySpent;

    // Top category
    const byCat = {};
    currentOut.forEach(t => {
        byCat[t.summaryGroup] = (byCat[t.summaryGroup] || 0) + t.amount;
    });
    const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    const topCatPct = totalSpent > 0 && topCat ? (topCat[1] / totalSpent * 100).toFixed(0) : 0;

    // 7-day sparkline data
    const spark = [];
    for (let i = 6; i >= 0; i--) {
        const d = dayjs().subtract(i, 'day');
        const daySpent = STATE.allTxns
            .filter(t => t.direction === 'OUT' && t.date.isSame(d, 'day'))
            .reduce((s, t) => s + t.amount, 0);
        spark.push(daySpent);
    }

    // Update metric cards
    updateMetricCard('metricBalance', {
        value: `${net >= 0 ? '+' : ''}${formatNum(net)}`,
        label: 'Net Balance',
        trend: spendChange,
        trendLabel: `${Math.abs(spendChange).toFixed(0)}% vs last period`,
        positive: net >= 0,
        sparkline: spark,
    });

    updateMetricCard('metricDailyBudget', {
        value: formatNum(Math.max(0, dailyRemaining)),
        label: 'Remaining Today',
        sublabel: `of ${formatNum(dailyBudget)}/day`,
        positive: dailyRemaining >= 0,
        progress: dailyBudget > 0 ? Math.min(todaySpent / dailyBudget, 1) : 0,
    });

    updateMetricCard('metricTopCategory', {
        value: topCat ? topCat[0] : '--',
        label: 'Top Category',
        sublabel: topCat ? `QAR ${formatNum(topCat[1])} (${topCatPct}%)` : '',
        positive: true,
    });

    updateMetricCard('metricTxnCount', {
        value: `${currentOut.length}`,
        label: 'Transactions',
        sublabel: `${daysLeft} days left`,
        positive: true,
    });
}

function updateMetricCard(id, data) {
    const card = document.getElementById(id);
    if (!card) return;

    const valueEl = card.querySelector('.metric-value');
    const labelEl = card.querySelector('.metric-label');
    const sublabelEl = card.querySelector('.metric-sublabel');
    const trendEl = card.querySelector('.metric-trend');
    const sparkEl = card.querySelector('.metric-sparkline');
    const progressEl = card.querySelector('.metric-progress-fill');

    if (valueEl) {
        valueEl.textContent = data.value;
        valueEl.classList.toggle('text-fact-green', data.positive);
        valueEl.classList.toggle('text-fact-red', !data.positive);
    }
    if (labelEl) labelEl.textContent = data.label;
    if (sublabelEl) sublabelEl.textContent = data.sublabel || '';

    if (trendEl && data.trend !== undefined) {
        const isUp = data.trend > 0;
        // For spending, up is bad (red), down is good (green)
        trendEl.innerHTML = `
            <span class="${isUp ? 'text-fact-red' : 'text-fact-green'} text-[10px] font-medium flex items-center gap-0.5">
                <svg class="w-3 h-3 ${isUp ? '' : 'rotate-180'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                </svg>
                ${data.trendLabel}
            </span>
        `;
    }

    if (sparkEl && data.sparkline) {
        renderSparkline(sparkEl, data.sparkline, data.positive);
    }

    if (progressEl && data.progress !== undefined) {
        progressEl.style.width = `${Math.min(data.progress * 100, 100)}%`;
        progressEl.classList.toggle('bg-fact-green', data.progress <= 0.8);
        progressEl.classList.toggle('bg-fact-yellow', data.progress > 0.8 && data.progress <= 1);
        progressEl.classList.toggle('bg-fact-red', data.progress > 1);
    }
}

function renderSparkline(container, data, positive) {
    const max = Math.max(...data, 1);
    const width = 60;
    const height = 20;
    const points = data.map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - (v / max) * height;
        return `${x},${y}`;
    }).join(' ');

    const color = positive ? '#75B876' : '#E74C3C';
    container.innerHTML = `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
            <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;
}

// ============== 5. SPENDING DISTRIBUTION HISTOGRAM ==============
// Transaction amount distribution using SIZE_TIERS buckets
export function renderSpendingDistribution(STATE, { formatNum, SIZE_TIERS }) {
    const container = document.getElementById('spendingDistChart');
    if (!container) return;

    const out = STATE.filtered.filter(t => t.direction === 'OUT');
    if (out.length === 0) return;

    const tierEntries = Object.entries(SIZE_TIERS);
    const buckets = tierEntries.map(([name]) => ({ name, count: 0, total: 0 }));
    const amounts = [];

    for (const t of out) {
        const amt = t.amtQAR || t.amount || 0;
        amounts.push(amt);
        for (let i = 0; i < tierEntries.length; i++) {
            if (amt <= tierEntries[i][1].max) {
                buckets[i].count++;
                buckets[i].total += amt;
                break;
            }
        }
    }

    // Compute median and mean
    amounts.sort((a, b) => a - b);
    const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    const median = amounts.length % 2 === 0
        ? (amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2
        : amounts[Math.floor(amounts.length / 2)];

    const labels = buckets.map(b => b.name);
    const data = buckets.map(b => b.count);
    const isDark = document.body.classList.contains('dark-mode') || window.matchMedia('(prefers-color-scheme: dark)').matches;

    const barColors = tierEntries.map(([, d]) => d.color);

    if (vizCharts.distribution) vizCharts.distribution.destroy();

    // Find which bucket index the mean and median fall into (for annotation)
    const findBucketIdx = (val) => {
        for (let i = 0; i < tierEntries.length; i++) {
            if (val <= tierEntries[i][1].max) return i;
        }
        return tierEntries.length - 1;
    };

    vizCharts.distribution = new Chart(container, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: barColors.map(c => c + 'CC'),
                borderColor: barColors,
                borderWidth: 1,
                borderRadius: 4,
                barPercentage: 0.8,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 15, 15, 0.95)',
                    titleColor: '#F4C44E',
                    bodyColor: '#ffffff',
                    borderColor: '#F4C44E',
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 10,
                    callbacks: {
                        title: (items) => {
                            const idx = items[0]?.dataIndex;
                            if (idx === undefined) return '';
                            const [name, tier] = tierEntries[idx];
                            const prevMax = idx > 0 ? tierEntries[idx - 1][1].max : 0;
                            return tier.max === Infinity
                                ? `${name} (QAR ${formatNum(prevMax)}+)`
                                : `${name} (QAR ${formatNum(prevMax)}-${formatNum(tier.max)})`;
                        },
                        label: (ctx) => {
                            const b = buckets[ctx.dataIndex];
                            return [
                                `${b.count} transactions`,
                                `Total: QAR ${formatNum(b.total)}`,
                                `Avg: QAR ${formatNum(b.count > 0 ? b.total / b.count : 0)}`
                            ];
                        },
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: isDark ? '#888' : '#666', font: { size: 10 } },
                },
                y: {
                    grid: { color: isDark ? '#2A2A2A' : '#E5E5E5' },
                    ticks: { color: isDark ? '#888' : '#666', font: { size: 10 }, precision: 0 },
                    beginAtZero: true,
                    title: { display: true, text: 'Transactions', color: isDark ? '#888' : '#666', font: { size: 10 } },
                },
            },
        },
        plugins: [{
            id: 'annotationLines',
            afterDraw(chart) {
                const { ctx, chartArea, scales } = chart;
                const yMax = scales.y.max;
                if (!yMax) return;

                const drawLine = (bucketIdx, color, label, offsetY) => {
                    const meta = chart.getDatasetMeta(0);
                    const bar = meta.data[bucketIdx];
                    if (!bar) return;
                    const x = bar.x;

                    ctx.save();
                    ctx.setLineDash([4, 4]);
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(x, chartArea.top);
                    ctx.lineTo(x, chartArea.bottom);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    ctx.fillStyle = color;
                    ctx.font = 'bold 9px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(label, x, chartArea.top + offsetY);
                    ctx.restore();
                };

                drawLine(findBucketIdx(median), '#F4C44E', `Median: ${formatNum(median)}`, 10);
                drawLine(findBucketIdx(mean), '#E74C3C', `Mean: ${formatNum(mean)}`, 22);
            }
        }],
    });
}

// ============== 6. MONEY FLOW SANKEY ==============
// Pure SVG: Total spend → Summary groups → Top subcategories
// innerHTML safety: all data computed from STATE (user's own DB transactions).
// Labels are category/group names from hardcoded MERCHANT_TYPES/SUMMARY_GROUPS constants.
export function renderMoneyFlow(STATE, { formatNum, SUMMARY_GROUPS, MERCHANT_TYPES }) {
    const container = document.getElementById('moneyFlowSvg');
    if (!container) return;

    const out = STATE.filtered.filter(t => t.direction === 'OUT');
    if (out.length === 0) {
        // Safe: static string, no external data
        container.textContent = 'No spending data for flow diagram';
        container.className = 'text-xs text-fact-muted p-4 text-center';
        return;
    }

    const totalExpense = out.reduce((s, t) => s + (t.amtQAR || t.amount || 0), 0);

    // Column 2: Summary groups
    const groupTotals = {};
    Object.keys(SUMMARY_GROUPS).forEach(g => groupTotals[g] = 0);
    out.forEach(t => {
        const group = t.summaryGroup || 'Other';
        groupTotals[group] = (groupTotals[group] || 0) + (t.amtQAR || t.amount || 0);
    });
    const activeGroups = Object.entries(groupTotals)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);

    // Column 3: Top subcategories
    const catTotals = {};
    out.forEach(t => {
        const cat = t.merchantType || 'Other';
        catTotals[cat] = (catTotals[cat] || 0) + (t.amtQAR || t.amount || 0);
    });
    const topCats = Object.entries(catTotals)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    // Layout
    const isDark = document.body.classList.contains('dark-mode') || window.matchMedia('(prefers-color-scheme: dark)').matches;
    const W = container.clientWidth || 360;
    const nodeW = 12;
    const pad = 16;
    const colX = [pad, W / 2 - nodeW / 2, W - nodeW - pad];
    const headerH = 20;
    const availH = Math.max(200, activeGroups.length * 40 + 40);

    const leftNode = { x: colX[0], y: headerH + 10, h: availH - headerH - 20, label: 'Spending', value: totalExpense, color: isDark ? '#555' : '#CCC' };

    // Group nodes
    const groupNodes = [];
    let groupY = headerH + 10;
    const groupGap = 6;
    const usableH = availH - headerH - 20;
    const totalGroupVal = activeGroups.reduce((s, [, v]) => s + v, 0);

    for (const [name, val] of activeGroups) {
        const h = Math.max(14, (val / totalGroupVal) * (usableH - groupGap * (activeGroups.length - 1)));
        groupNodes.push({ x: colX[1], y: groupY, h, label: name, value: val, color: SUMMARY_GROUPS[name]?.color || '#999' });
        groupY += h + groupGap;
    }

    // Category nodes
    const catNodes = [];
    let catY = headerH + 10;
    const catGap = 4;
    const totalCatVal = topCats.reduce((s, [, v]) => s + v, 0);

    for (const [name, val] of topCats) {
        const h = Math.max(10, (val / totalCatVal) * (usableH - catGap * (topCats.length - 1)));
        catNodes.push({ x: colX[2], y: catY, h, label: name, value: val, color: MERCHANT_TYPES[name]?.color || '#999' });
        catY += h + catGap;
    }

    // Build SVG via DOM (avoids innerHTML for hook compliance)
    const svgH = availH + 10;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${svgH}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', svgH);
    svg.classList.add('select-none');

    const textColor = isDark ? '#CCC' : '#333';
    const mutedColor = isDark ? '#888' : '#999';

    // Helper: curved flow path between two nodes
    const addFlow = (x1, y1, h1, x2, y2, h2, color, value) => {
        const midX = (x1 + nodeW + x2) / 2;
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', `M${x1 + nodeW},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2} L${x2},${y2 + h2} C${midX},${y2 + h2} ${midX},${y1 + h1} ${x1 + nodeW},${y1 + h1} Z`);
        path.setAttribute('fill', color);
        path.setAttribute('opacity', '0.35');
        const title = document.createElementNS(ns, 'title');
        title.textContent = `QAR ${formatNum(value)}`;
        path.appendChild(title);
        svg.appendChild(path);
    };

    // Left → Middle flows
    let leftOffset = 0;
    for (const gn of groupNodes) {
        const flowH = totalExpense > 0 ? (gn.value / totalExpense) * leftNode.h : 0;
        addFlow(leftNode.x, leftNode.y + leftOffset, flowH, gn.x, gn.y, gn.h, gn.color, gn.value);
        leftOffset += flowH;
    }

    // Middle → Right flows
    for (const gn of groupNodes) {
        const groupTypes = SUMMARY_GROUPS[gn.label]?.types || [];
        const groupCats = topCats.filter(([catName]) => groupTypes.includes(catName));
        let gnOffset = 0;
        for (const [catName, catVal] of groupCats) {
            const catNode = catNodes.find(c => c.label === catName);
            if (!catNode) continue;
            const flowH = gn.value > 0 ? (catVal / gn.value) * gn.h : 0;
            addFlow(gn.x, gn.y + gnOffset, flowH, catNode.x, catNode.y, catNode.h, catNode.color, catVal);
            gnOffset += flowH;
        }
    }

    // Draw node rectangles
    const addRect = (n) => {
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', n.x);
        rect.setAttribute('y', n.y);
        rect.setAttribute('width', nodeW);
        rect.setAttribute('height', n.h);
        rect.setAttribute('rx', '3');
        rect.setAttribute('fill', n.color);
        svg.appendChild(rect);
    };

    addRect(leftNode);
    groupNodes.forEach(addRect);
    catNodes.forEach(addRect);

    // Labels
    const addLabel = (x, y, text, anchor, color, size, weight) => {
        const el = document.createElementNS(ns, 'text');
        el.setAttribute('x', x);
        el.setAttribute('y', y);
        el.setAttribute('fill', color);
        el.setAttribute('font-size', size);
        if (weight) el.setAttribute('font-weight', weight);
        if (anchor) el.setAttribute('text-anchor', anchor);
        el.textContent = text;
        svg.appendChild(el);
    };

    const addNodeLabels = (n, side) => {
        if (side === 'right') {
            addLabel(n.x + nodeW + 4, n.y + n.h / 2 + 3, n.label, null, textColor, '9', '500');
            addLabel(n.x + nodeW + 4, n.y + n.h / 2 + 13, formatNum(n.value), null, mutedColor, '8', null);
        } else {
            addLabel(n.x - 4, n.y + n.h / 2 + 3, n.label, 'end', textColor, '9', '500');
            addLabel(n.x - 4, n.y + n.h / 2 + 13, formatNum(n.value), 'end', mutedColor, '8', null);
        }
    };

    addNodeLabels(leftNode, 'right');
    groupNodes.forEach(n => addNodeLabels(n, 'right'));
    catNodes.forEach(n => addNodeLabels(n, 'left'));

    // Column headers
    addLabel(colX[0], 14, 'TOTAL', null, mutedColor, '9', '600');
    addLabel(colX[1], 14, 'GROUPS', null, mutedColor, '9', '600');
    addLabel(colX[2], 14, 'CATEGORIES', 'end', mutedColor, '9', '600');

    container.replaceChildren(svg);
}

// Cleanup
export function destroyVizCharts() {
    Object.values(vizCharts).forEach(c => { if (c && c.destroy) c.destroy(); });
}
