// ─── HEATMAP, EXPORT, ACHIEVEMENTS, CONFIRMATION, GENEROSITY, HEALTH SCORE ──
import dayjs from 'dayjs';

// ============== HEATMAP ==============

export function openHeatmap(STATE, callbacks) {
    const { renderHeatmap, trackAchievement } = callbacks;
    renderHeatmap();
    document.getElementById('heatmapModal').classList.remove('hidden');
    trackAchievement('fact_viewed_heatmap');
}

export function closeHeatmap() {
    document.getElementById('heatmapModal').classList.add('hidden');
}

export function renderHeatmap(STATE, callbacks) {
    const { formatNum, showFilteredResults } = callbacks;

    const container = document.getElementById('heatmapContainer');
    if (!container) return;

    const out = STATE.allTxns.filter(t => t.direction === 'OUT');

    const endDate = dayjs();
    const startDate = endDate.subtract(90, 'day');

    const dailySpend = {};
    out.forEach(t => {
        if (t.date.isAfter(startDate) && t.date.isBefore(endDate.add(1, 'day'))) {
            const key = t.date.format('YYYY-MM-DD');
            dailySpend[key] = (dailySpend[key] || 0) + t.amount;
        }
    });

    const amounts = Object.values(dailySpend);
    const maxSpend = Math.max(...amounts, 1);
    const avgSpend = amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;

    const weeks = [];
    let currentWeek = [];
    let d = startDate;

    const startDow = d.day();
    for (let i = 0; i < startDow; i++) {
        currentWeek.push(null);
    }

    while (d.isBefore(endDate) || d.isSame(endDate, 'day')) {
        const key = d.format('YYYY-MM-DD');
        const amount = dailySpend[key] || 0;
        currentWeek.push({ date: d, amount, key });

        if (d.day() === 6) {
            weeks.push(currentWeek);
            currentWeek = [];
        }
        d = d.add(1, 'day');
    }
    if (currentWeek.length > 0) {
        weeks.push(currentWeek);
    }

    const getColor = (amount) => {
        if (amount === 0) return '#E5E5E5';
        const ratio = amount / maxSpend;
        if (ratio < 0.25) return '#C6E48B';
        if (ratio < 0.5) return '#7BC96F';
        if (ratio < 0.75) return '#239A3B';
        return '#196127';
    };

    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    container.innerHTML = `
        <div class="flex gap-1">
            <div class="flex flex-col gap-1 text-[9px] text-fact-muted dark:text-fact-dark-muted mr-1">
                ${dayLabels.map((l, i) => `<div class="h-3 flex items-center">${i % 2 === 1 ? l : ''}</div>`).join('')}
            </div>
            ${weeks.map((week) => `
                <div class="flex flex-col gap-1">
                    ${[0,1,2,3,4,5,6].map(dow => {
                        const cell = week[dow];
                        if (!cell) return '<div class="heatmap-cell" style="background: transparent"></div>';
                        const color = getColor(cell.amount);
                        const tooltip = `${cell.date.format('MMM D')}: QAR ${formatNum(cell.amount)}`;
                        return `<div class="heatmap-cell" style="background: ${color}" title="${tooltip}" onclick="drilldownDate('${cell.key}')"></div>`;
                    }).join('')}
                </div>
            `).join('')}
        </div>
        <div class="mt-4 grid grid-cols-3 gap-4 text-center text-xs">
            <div>
                <div class="text-lg font-display font-bold">${formatNum(amounts.reduce((a, b) => a + b, 0))}</div>
                <div class="text-fact-muted dark:text-fact-dark-muted">Total (90 days)</div>
            </div>
            <div>
                <div class="text-lg font-display font-bold">${formatNum(avgSpend)}</div>
                <div class="text-fact-muted dark:text-fact-dark-muted">Daily Avg</div>
            </div>
            <div>
                <div class="text-lg font-display font-bold">${formatNum(maxSpend)}</div>
                <div class="text-fact-muted dark:text-fact-dark-muted">Max Day</div>
            </div>
        </div>
    `;
}

export function drilldownDate(dateKey, STATE, callbacks) {
    const { showFilteredResults } = callbacks;

    const date = dayjs(dateKey);
    const txns = STATE.allTxns.filter(t =>
        t.direction === 'OUT' &&
        t.date.format('YYYY-MM-DD') === dateKey
    );
    showFilteredResults(txns, `${date.format('MMM D, YYYY')}`);
    closeHeatmap();
}

// ============== CSV EXPORT ==============

export function exportCSV(STATE, callbacks) {
    const { formatNum, showToast, trackAchievement } = callbacks;

    const icon = document.getElementById('exportIcon');
    if (icon) icon.classList.add('export-spin');

    try {
        const headers = ['Date', 'Time', 'Amount', 'Currency', 'Merchant', 'Category', 'Direction', 'Pattern'];
        const rows = STATE.filtered.map(t => [
            t.date.format('YYYY-MM-DD'),
            t.date.format('HH:mm'),
            t.amount.toFixed(2),
            t.currency,
            `"${t.display.replace(/"/g, '""')}"`,
            t.merchantType,
            t.direction,
            t.dims.pattern
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `fact-flow-${STATE.dateRange.start.format('YYYY-MM-DD')}-to-${STATE.dateRange.end.format('YYYY-MM-DD')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast(`Exported ${rows.length} transactions`, 'success');
        trackAchievement('fact_exported');
    } catch (err) {
        showToast('Export failed: ' + err.message, 'error');
    } finally {
        setTimeout(() => {
            if (icon) icon.classList.remove('export-spin');
        }, 500);
    }
}

// ============== ACHIEVEMENTS ==============

export const ACHIEVEMENTS = {
    'first-login': { icon: 'rocket', name: 'First Steps', desc: 'Opened FACT/Flow for the first time', check: () => true },
    'first-categorize': { icon: 'tag', name: 'Organizer', desc: 'Categorized your first transaction', check: (STATE) => Object.keys(STATE.localMappings || {}).length > 0 },
    'ten-categorize': { icon: 'list', name: 'Sorting Pro', desc: 'Categorized 10 transactions', check: (STATE) => Object.keys(STATE.localMappings || {}).length >= 10 },
    'first-goal': { icon: 'target', name: 'Goal Setter', desc: 'Set your first budget goal', check: (STATE, getGoals) => getGoals(STATE).length > 0 },
    'three-goals': { icon: 'circus', name: 'Triple Threat', desc: 'Set 3 budget goals', check: (STATE, getGoals) => getGoals(STATE).length >= 3 },
    'streak-3': { icon: 'fire', name: 'On Fire', desc: '3-day under-budget streak', check: (STATE, _, getStreakData) => getStreakData(STATE).longestStreak >= 3 },
    'streak-7': { icon: 'lightning', name: 'Week Warrior', desc: '7-day under-budget streak', check: (STATE, _, getStreakData) => getStreakData(STATE).longestStreak >= 7 },
    'ask-ai': { icon: 'robot', name: 'AI Explorer', desc: 'Asked AI for spending advice', check: () => localStorage.getItem('fact_asked_ai') === 'true' },
    'voice-input': { icon: 'mic', name: 'Voice Commander', desc: 'Used voice input', check: () => localStorage.getItem('fact_used_voice') === 'true' },
    'dark-mode': { icon: 'moon', name: 'Night Owl', desc: 'Switched to dark mode', check: () => localStorage.getItem('fact_dark_mode') === 'true' },
    'export-data': { icon: 'chart', name: 'Data Analyst', desc: 'Exported your data to CSV', check: () => localStorage.getItem('fact_exported') === 'true' },
    'heatmap-view': { icon: 'calendar', name: 'Pattern Seeker', desc: 'Viewed the spending heatmap', check: () => localStorage.getItem('fact_viewed_heatmap') === 'true' },
    'generosity-set': { icon: 'heart', name: 'Generous Heart', desc: 'Set a generosity budget', check: (STATE) => localStorage.getItem(`fact_generosity_${STATE.currentUser}`) !== null }
};

export function getUnlockedAchievements(STATE) {
    try {
        return JSON.parse(localStorage.getItem(`fact_achievements_${STATE.currentUser}`)) || [];
    } catch (e) {
        return [];
    }
}

export function saveUnlockedAchievements(achievements, STATE) {
    localStorage.setItem(`fact_achievements_${STATE.currentUser}`, JSON.stringify(achievements));
}

export function checkAchievements(STATE, callbacks) {
    const { getGoals, getStreakData, celebrate } = callbacks;

    const unlocked = getUnlockedAchievements(STATE);
    const newUnlocks = [];

    Object.entries(ACHIEVEMENTS).forEach(([id, achievement]) => {
        if (!unlocked.includes(id) && achievement.check(STATE, getGoals, getStreakData)) {
            unlocked.push(id);
            newUnlocks.push({ id, ...achievement });
        }
    });

    if (newUnlocks.length > 0) {
        saveUnlockedAchievements(unlocked, STATE);
        setTimeout(() => celebrate(newUnlocks[0]), 500);
    }

    return unlocked;
}

export function celebrate(achievement) {
    const overlay = document.getElementById('celebrationOverlay');
    if (!overlay) return;

    const confettiColors = ['#F4C44E', '#75B876', '#B593C6', '#E57373', '#64B5F6'];
    let confettiHtml = '';
    for (let i = 0; i < 50; i++) {
        const color = confettiColors[Math.floor(Math.random() * confettiColors.length)];
        const left = Math.random() * 100;
        const delay = Math.random() * 2;
        const size = 5 + Math.random() * 10;
        confettiHtml += `<div class="confetti" style="left: ${left}%; background: ${color}; width: ${size}px; height: ${size}px; animation-delay: ${delay}s; border-radius: ${Math.random() > 0.5 ? '50%' : '0'}"></div>`;
    }

    overlay.innerHTML = `
        <div class="celebration-overlay" onclick="closeCelebration()">
            ${confettiHtml}
            <div class="celebration-box" onclick="event.stopPropagation()">
                <div class="celebration-icon">${achievement.icon}</div>
                <h2 class="font-display font-bold text-xl text-fact-ink mt-2">Achievement Unlocked!</h2>
                <h3 class="font-display font-semibold text-lg text-fact-ink mt-1">${achievement.name}</h3>
                <p class="text-sm text-fact-ink/70 mt-2">${achievement.desc}</p>
                <button onclick="closeCelebration()" class="mt-4 px-6 py-2 bg-fact-ink text-white rounded-full font-medium">
                    Awesome!
                </button>
            </div>
        </div>
    `;
    overlay.classList.remove('hidden');

    setTimeout(closeCelebration, 5000);
}

export function closeCelebration() {
    const overlay = document.getElementById('celebrationOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.innerHTML = '';
    }
}

export function openAchievements(STATE, callbacks) {
    const { escapeHtml } = callbacks;

    const unlocked = getUnlockedAchievements(STATE);
    const container = document.getElementById('achievementsList');
    const progress = document.getElementById('achievementProgress');

    if (progress) {
        progress.textContent = `${unlocked.length} of ${Object.keys(ACHIEVEMENTS).length} unlocked`;
    }

    if (container) {
        container.innerHTML = Object.entries(ACHIEVEMENTS).map(([id, a]) => {
            const isUnlocked = unlocked.includes(id);
            return `
                <div class="achievement-badge ${isUnlocked ? '' : 'locked'}">
                    <div class="badge-icon">${a.icon}</div>
                    <div class="text-xs font-medium">${a.name}</div>
                    <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mt-1">${isUnlocked ? a.desc : '???'}</div>
                </div>
            `;
        }).join('');
    }

    document.getElementById('achievementsModal').classList.remove('hidden');
}

export function closeAchievements() {
    document.getElementById('achievementsModal').classList.add('hidden');
}

export function trackAchievement(key, checkAchievementsFn) {
    localStorage.setItem(key, 'true');
    if (checkAchievementsFn) {
        setTimeout(checkAchievementsFn, 100);
    }
}

// ============== CONFIRMATION DIALOG ==============

export function showConfirm(options, escapeHtml) {
    return new Promise((resolve) => {
        const { title, message, confirmText = 'Confirm', cancelText = 'Cancel', type = 'warning' } = options;
        const modal = document.getElementById('confirmModal');
        if (!modal) {
            resolve(false);
            return;
        }

        const colors = {
            warning: { bg: 'bg-fact-yellow', icon: 'warning' },
            danger: { bg: 'bg-fact-red', icon: 'trash' },
            info: { bg: 'bg-fact-purple', icon: 'info' }
        };
        const color = colors[type] || colors.warning;

        modal.innerHTML = `
            <div class="confirm-overlay" onclick="event.target === this && confirmResolve(false)">
                <div class="confirm-box">
                    <div class="text-4xl mb-4">${color.icon}</div>
                    <h3 class="font-display font-semibold text-lg mb-2">${escapeHtml(title)}</h3>
                    <p class="text-sm text-fact-muted dark:text-fact-dark-muted mb-6">${escapeHtml(message)}</p>
                    <div class="flex gap-3">
                        <button onclick="confirmResolve(false)" class="flex-1 px-4 py-2 text-sm rounded-lg border border-fact-border dark:border-fact-dark-border hover:bg-gray-50 dark:hover:bg-gray-800">${cancelText}</button>
                        <button onclick="confirmResolve(true)" class="flex-1 px-4 py-2 text-sm rounded-lg ${color.bg} text-white font-medium">${confirmText}</button>
                    </div>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');

        window.confirmResolve = (result) => {
            modal.classList.add('hidden');
            modal.innerHTML = '';
            resolve(result);
        };
    });
}

// ============== GENEROSITY BUDGET ==============

export const DEFAULT_GENEROSITY_CATEGORIES = [
    { id: 'gifts', name: 'Gifts & Presents', default: true },
    { id: 'charity', name: 'Charity & Donations', default: true },
    { id: 'treats', name: 'Treating Others (meals, drinks)', default: true },
    { id: 'social', name: 'Social Outings (I paid for everyone)', default: false },
    { id: 'family', name: 'Family Support', default: false }
];

export function getGenerositySettings(STATE) {
    try {
        const stored = localStorage.getItem(`fact_generosity_${STATE.currentUser}`);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {}
    return null;
}

export function saveGenerositySettings(STATE, callbacks) {
    const { showToast, checkAchievements, renderGenerosityBudget } = callbacks;

    const budgetInput = document.getElementById('generosityBudgetInput');
    const budget = parseFloat(budgetInput?.value) || 0;

    const selectedCategories = [];
    document.querySelectorAll('#generosityCategories input[type="checkbox"]:checked').forEach(cb => {
        selectedCategories.push(cb.value);
    });

    const settings = {
        budget: budget,
        categories: selectedCategories,
        enabled: budget > 0
    };

    localStorage.setItem(`fact_generosity_${STATE.currentUser}`, JSON.stringify(settings));

    setTimeout(() => checkAchievements(), 500);

    closeGenerositySettings();
    renderGenerosityBudget();
    showToast('Generosity budget saved!', 'success');
}

export function openGenerositySettings(STATE) {
    const settings = getGenerositySettings(STATE) || { budget: 0, categories: ['gifts', 'charity', 'treats'], enabled: false };

    const budgetInput = document.getElementById('generosityBudgetInput');
    if (budgetInput) budgetInput.value = settings.budget || '';

    const container = document.getElementById('generosityCategories');
    if (container) {
        container.innerHTML = DEFAULT_GENEROSITY_CATEGORIES.map(cat => {
            const checked = settings.categories?.includes(cat.id) || (!settings.categories && cat.default);
            return `
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" value="${cat.id}" ${checked ? 'checked' : ''}
                        class="w-4 h-4 rounded border-fact-border text-fact-purple focus:ring-fact-purple">
                    <span>${cat.name}</span>
                </label>
            `;
        }).join('');
    }

    document.getElementById('generosityModal').classList.remove('hidden');
}

export function closeGenerositySettings() {
    document.getElementById('generosityModal').classList.add('hidden');
}

export function renderGenerosityBudget(STATE, formatNum) {
    const settings = getGenerositySettings(STATE);
    const card = document.getElementById('generosityCard');

    if (!card) return;

    if (!settings || !settings.enabled) {
        card.classList.add('hidden');
        return;
    }

    card.classList.remove('hidden');

    // Calculate generosity spending (simplified)
    const now = dayjs();
    const monthStart = now.startOf('month');
    const monthTxns = STATE.allTxns.filter(t =>
        t.direction === 'OUT' &&
        t.date.isAfter(monthStart) &&
        t.date.isBefore(now.add(1, 'day'))
    );

    // For now, just estimate based on Family transfers
    const generosityTxns = monthTxns.filter(t =>
        t.merchantType === 'Family' || t.summaryGroup === 'Family'
    );

    const spent = generosityTxns.reduce((s, t) => s + t.amount, 0);
    const remaining = Math.max(0, settings.budget - spent);
    const percentage = settings.budget > 0 ? Math.min((spent / settings.budget) * 100, 100) : 0;

    const spentEl = document.getElementById('generositySpent');
    const budgetEl = document.getElementById('generosityBudget');
    const fillEl = document.getElementById('generosityMeterFill');
    const statusEl = document.getElementById('generosityStatus');

    if (spentEl) spentEl.textContent = `QAR ${formatNum(spent)}`;
    if (budgetEl) budgetEl.textContent = `QAR ${formatNum(settings.budget)}`;
    if (fillEl) {
        fillEl.style.width = `${percentage}%`;
        fillEl.className = `generosity-meter-fill ${spent > settings.budget ? 'over' : ''}`;
    }
    if (statusEl) {
        if (spent > settings.budget) {
            statusEl.textContent = `Over budget by QAR ${formatNum(spent - settings.budget)}`;
            statusEl.className = 'text-xs text-fact-red';
        } else {
            statusEl.textContent = `QAR ${formatNum(remaining)} left to give`;
            statusEl.className = 'text-xs text-fact-muted dark:text-fact-dark-muted';
        }
    }
}

// ============== HEALTH SCORE ==============

export function openHealthScore(STATE, callbacks) {
    const { checkDailyBudget, getStreakData, getGoals, trackAchievement } = callbacks;

    const modal = document.getElementById('healthScoreModal');
    if (!modal) return;

    // Calculate simple health score
    const budgetStatus = checkDailyBudget();
    const streak = getStreakData(STATE);
    const goals = getGoals(STATE);

    let score = 50; // Base score
    if (budgetStatus.status === 'safe') score += 20;
    else if (budgetStatus.status === 'warning') score += 10;
    score += Math.min(20, streak.currentStreak * 4);
    score += Math.min(10, goals.length * 3);

    const scoreEl = document.getElementById('healthScoreNumber');
    if (scoreEl) scoreEl.textContent = score;

    const statusEl = document.getElementById('healthStatusLabel');
    const descEl = document.getElementById('healthStatusDesc');

    if (statusEl && descEl) {
        if (score >= 80) {
            statusEl.textContent = 'Excellent!';
            descEl.textContent = 'Your finances are in great shape';
        } else if (score >= 60) {
            statusEl.textContent = 'Good';
            descEl.textContent = 'You\'re on the right track';
        } else {
            statusEl.textContent = 'Needs Work';
            descEl.textContent = 'Let\'s focus on building better habits';
        }
    }

    modal.classList.remove('hidden');
    trackAchievement('fact_health_score');
}

export function closeHealthScore() {
    document.getElementById('healthScoreModal').classList.add('hidden');
}

// ============== PATTERN DETECTION ==============

export function renderPatternWarnings(showToast) {
    // Analyze patterns and show nudges if relevant
    const now = dayjs();
    const hour = now.hour();

    // Late night nudge
    if ((hour >= 22 || hour < 5) && !sessionStorage.getItem('fact_nudge_shown')) {
        sessionStorage.setItem('fact_nudge_shown', 'true');
        if (Math.random() > 0.7) {
            showToast('Late night spending? Sleep on it!', 'info');
        }
    }
}
