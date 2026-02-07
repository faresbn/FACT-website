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

    const out = STATE.filtered.filter(t => t.direction === 'OUT');
    if (out.length === 0) return;

    // Group into weekly buckets by summary group
    const weeks = {};
    const groups = Object.keys(SUMMARY_GROUPS);

    out.forEach(t => {
        const weekStart = t.date.startOf('week').format('YYYY-MM-DD');
        if (!weeks[weekStart]) {
            weeks[weekStart] = {};
            groups.forEach(g => weeks[weekStart][g] = 0);
        }
        weeks[weekStart][t.summaryGroup] = (weeks[weekStart][t.summaryGroup] || 0) + t.amount;
    });

    const sortedWeeks = Object.keys(weeks).sort();
    const labels = sortedWeeks.map(w => dayjs(w).format('MMM D'));
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

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

    const out = STATE.filtered.filter(t => t.direction === 'OUT');
    if (out.length === 0) return;

    // Aggregate by merchant within each summary group
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

    const treeData = Object.values(merchantData)
        .filter(m => m.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 30); // Top 30 merchants

    const groupColors = {};
    Object.entries(SUMMARY_GROUPS).forEach(([name, data]) => {
        groupColors[name] = data.color;
    });

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

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
export function renderPeriodComparison(STATE, { formatNum, SUMMARY_GROUPS }) {
    const container = document.getElementById('periodComparisonChart');
    if (!container) return;

    const { start, end } = STATE.dateRange;
    const periodLength = end.diff(start, 'day');
    const prevStart = start.subtract(periodLength + 1, 'day');
    const prevEnd = start.subtract(1, 'day');

    const currentOut = STATE.allTxns.filter(t =>
        t.direction === 'OUT' && t.date.isBetween(start, end, 'day', '[]')
    );
    const prevOut = STATE.allTxns.filter(t =>
        t.direction === 'OUT' && t.date.isBetween(prevStart, prevEnd, 'day', '[]')
    );

    const groups = Object.keys(SUMMARY_GROUPS);
    const currentByGroup = {};
    const prevByGroup = {};

    groups.forEach(g => { currentByGroup[g] = 0; prevByGroup[g] = 0; });
    currentOut.forEach(t => currentByGroup[t.summaryGroup] = (currentByGroup[t.summaryGroup] || 0) + t.amount);
    prevOut.forEach(t => prevByGroup[t.summaryGroup] = (prevByGroup[t.summaryGroup] || 0) + t.amount);

    const activeGroups = groups.filter(g => currentByGroup[g] > 0 || prevByGroup[g] > 0);
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (vizCharts.comparison) vizCharts.comparison.destroy();

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
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: QAR ${formatNum(ctx.raw)}`,
                    },
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

// ============== 4. TIME-OF-DAY HEATMAP ==============
export function renderTimeHeatmap(STATE, { formatNum }) {
    const container = document.getElementById('timeHeatmapGrid');
    if (!container) return;

    const out = STATE.filtered.filter(t => t.direction === 'OUT');
    if (out.length === 0) {
        container.innerHTML = '<div class="text-xs text-fact-muted p-4 text-center">No spending data for heatmap</div>';
        return;
    }

    // Build heatmap data: 7 days x 24 hours
    const heatData = {};
    const maxAmount = { value: 0 };

    out.forEach(t => {
        const day = t.date.day(); // 0=Sun
        const hour = t.date.hour();
        const key = `${day}-${hour}`;
        heatData[key] = (heatData[key] || 0) + t.amount;
        if (heatData[key] > maxAmount.value) maxAmount.value = heatData[key];
    });

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

// Cleanup
export function destroyVizCharts() {
    Object.values(vizCharts).forEach(c => { if (c && c.destroy) c.destroy(); });
}
