// ─── CHARTS (Donut, Daily, Cumulative) ──────────────────────────
import Chart from 'chart.js/auto';
import dayjs from 'dayjs';

// Charts storage
export const charts = {};

// DONUT CHART
export function renderDonutChart(STATE, callbacks) {
    const { formatNum, CAT_COLORS, SUMMARY_GROUPS } = callbacks;

    const out = STATE.filtered.filter(t => t.direction === 'OUT');

    let labels, data, colors;

    if (STATE.viewMode === 'parent') {
        // Group by summary group (dimension-based)
        const parentSpend = {};
        out.forEach(t => {
            const parent = t.summaryGroup;
            parentSpend[parent] = (parentSpend[parent] || 0) + t.amount;
        });

        // Sort by priority order (matches SUMMARY_GROUPS)
        const parentOrder = ['Essentials', 'Food & Drinks', 'Shopping & Fun', 'Family', 'Other'];
        labels = parentOrder.filter(p => parentSpend[p] > 0);
        data = labels.map(p => parentSpend[p]);
        colors = labels.map(l => CAT_COLORS[l] || '#999');
    } else {
        // Original subcategory view
        const catSpend = {};
        out.forEach(t => catSpend[t.merchantType] = (catSpend[t.merchantType] || 0) + t.amount);

        const sorted = Object.entries(catSpend).sort((a, b) => b[1] - a[1]);
        labels = sorted.map(c => c[0]);
        data = sorted.map(c => c[1]);
        colors = labels.map(l => CAT_COLORS[l] || '#999');
    }

    const total = data.reduce((s, v) => s + v, 0);
    document.getElementById('donutTotal').textContent = formatNum(total);

    const ctx = document.getElementById('donutChart');
    if (charts.donut) charts.donut.destroy();

    charts.donut = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: document.documentElement.classList.contains('dark') ? '#1a1a1a' : '#ffffff',
                hoverOffset: 12,
                hoverBorderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            animation: {
                animateRotate: true,
                duration: 600
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(15, 15, 15, 0.95)',
                    titleColor: '#F4C44E',
                    bodyColor: '#ffffff',
                    borderColor: '#F4C44E',
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 12,
                    displayColors: true,
                    boxPadding: 6,
                    caretSize: 8,
                    caretPadding: 10,
                    yAlign: 'bottom',
                    callbacks: {
                        title: (items) => items[0]?.label || '',
                        label: (ctx) => {
                            const value = ctx.raw;
                            const pct = ((value / total) * 100).toFixed(1);
                            return ` QAR ${formatNum(value)} (${pct}%)`;
                        },
                        afterLabel: () => 'Click to see details ->'
                    }
                }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    if (STATE.viewMode === 'parent') {
                        window.openParentDrilldown(labels[idx]);
                    } else {
                        window.openDrilldown(labels[idx]);
                    }
                }
            },
            onHover: (e, elements) => {
                e.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
            }
        }
    });
}

// INCOME VS EXPENSE BAR
export function renderBudgetProjection(STATE, callbacks) {
    const { calculateBudgetProjection, formatNum } = callbacks;

    const proj = calculateBudgetProjection();

    // Days until salary
    document.getElementById('daysUntilSalary').textContent = proj.daysUntilSalary;
    document.getElementById('nextSalaryDate').textContent = `~${proj.nextSalaryDate.format('MMM D')}`;

    // IN - OUT = NET
    document.getElementById('projIncome').textContent = formatNum(proj.income);
    document.getElementById('projExpense').textContent = formatNum(proj.expenses);
    const netEl = document.getElementById('projNet');
    netEl.textContent = formatNum(proj.net);
    netEl.className = `font-display font-bold text-lg ${proj.net >= 0 ? 'text-fact-green' : 'text-fact-red'}`;

    // Daily budget (compact format)
    document.getElementById('suggestedDaily').textContent = `${formatNum(proj.dailyBudget)}/day`;
    document.getElementById('avgDailySpend').textContent = formatNum(proj.avgDailySpend);

    // Budget status
    const statusEl = document.getElementById('budgetStatus');
    if (proj.onTrack) {
        statusEl.textContent = 'On Track';
        statusEl.className = 'text-[10px] px-2 py-0.5 rounded-full bg-fact-green/20 text-fact-green font-medium';
    } else {
        statusEl.textContent = 'Over Budget';
        statusEl.className = 'text-[10px] px-2 py-0.5 rounded-full bg-fact-red/20 text-fact-red font-medium';
    }
}

// DAILY CHART
export function renderDailyChart(STATE) {
    const out = STATE.filtered.filter(t => t.direction === 'OUT');
    const dailySpend = {};

    out.forEach(t => {
        const key = t.date.format('YYYY-MM-DD');
        dailySpend[key] = (dailySpend[key] || 0) + t.amount;
    });

    const days = [];
    let d = STATE.dateRange.start;
    while (d.isBefore(STATE.dateRange.end) || d.isSame(STATE.dateRange.end, 'day')) {
        days.push(d.format('YYYY-MM-DD'));
        d = d.add(1, 'day');
    }

    const labels = days.map(d => dayjs(d).format('MMM D'));
    const data = days.map(d => dailySpend[d] || 0);

    const ctx = document.getElementById('dailyChart');
    if (charts.daily) charts.daily.destroy();

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    charts.daily = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: '#F4C44E',
                borderRadius: 3,
                barThickness: Math.min(16, Math.max(4, 400 / days.length))
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: isDark ? '#888' : '#666',
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 8
                    }
                },
                y: {
                    grid: { color: isDark ? '#2A2A2A' : '#E5E5E5' },
                    ticks: { color: isDark ? '#888' : '#666' },
                    beginAtZero: true
                }
            }
        }
    });
}

// CUMULATIVE CHART
export function renderCumulativeChart(STATE) {
    const out = STATE.filtered.filter(t => t.direction === 'OUT').sort((a, b) => a.date - b.date);
    const dailySpend = {};

    out.forEach(t => {
        const key = t.date.format('YYYY-MM-DD');
        dailySpend[key] = (dailySpend[key] || 0) + t.amount;
    });

    const days = [];
    let d = STATE.dateRange.start;
    while (d.isBefore(STATE.dateRange.end) || d.isSame(STATE.dateRange.end, 'day')) {
        days.push(d.format('YYYY-MM-DD'));
        d = d.add(1, 'day');
    }

    let cumulative = 0;
    const data = days.map(d => {
        cumulative += (dailySpend[d] || 0);
        return cumulative;
    });

    const labels = days.map(d => dayjs(d).format('MMM D'));

    const ctx = document.getElementById('cumulativeChart');
    if (charts.cumulative) charts.cumulative.destroy();

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    charts.cumulative = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data,
                borderColor: '#B593C6',
                backgroundColor: 'rgba(181, 147, 198, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: isDark ? '#888' : '#666',
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 8
                    }
                },
                y: {
                    grid: { color: isDark ? '#2A2A2A' : '#E5E5E5' },
                    ticks: { color: isDark ? '#888' : '#666' },
                    beginAtZero: true
                }
            }
        }
    });
}
