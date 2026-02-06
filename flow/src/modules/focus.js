// ─── FOCUS MODE, IMPULSE CONTROL, STREAKS ──────────────────────
import dayjs from 'dayjs';

// ============== FOCUS MODE - ADHD-FRIENDLY UI ==============

export let isFocusMode = false;

export function toggleFocusMode(STATE, showToast) {
    isFocusMode = !isFocusMode;
    localStorage.setItem(`fact_focus_mode_${STATE.currentUser}`, isFocusMode);

    applyFocusMode(STATE);

    if (isFocusMode) {
        showToast('Focus Mode enabled - simplified view', 'info');
    } else {
        showToast('Full view restored', 'info');
    }
}

export function applyFocusMode(STATE, callbacks) {
    const body = document.body;
    const toggle = document.getElementById('focusToggle');
    const focusHero = document.getElementById('focusHero');
    const quickInsight = document.getElementById('quickInsight');

    if (isFocusMode) {
        body.classList.add('focus-mode');
        toggle?.classList.add('active');
        focusHero?.classList.remove('hidden');
        quickInsight?.classList.remove('hidden');
        if (callbacks) {
            updateFocusHero(STATE, callbacks);
            updateQuickInsight(STATE, callbacks);
        }
    } else {
        body.classList.remove('focus-mode');
        toggle?.classList.remove('active');
        focusHero?.classList.add('hidden');
        quickInsight?.classList.add('hidden');
    }
}

export function updateFocusHero(STATE, callbacks) {
    const { checkDailyBudget, formatNum, getStreakData } = callbacks;

    const budget = checkDailyBudget();
    const focusNumber = document.getElementById('focusHeroNumber');
    const focusDays = document.getElementById('focusDaysToSalary');
    const focusStreak = document.getElementById('focusStreak');

    if (!focusNumber) return;

    // Update the main number
    const remaining = Math.max(0, budget.remaining);
    focusNumber.textContent = `QAR ${formatNum(remaining)}`;

    // Set color based on status
    focusNumber.className = 'focus-hero-number breathe';
    if (budget.status === 'danger') {
        focusNumber.classList.add('danger');
    } else if (budget.status === 'warning') {
        focusNumber.classList.add('warning');
    } else {
        focusNumber.classList.add('positive');
    }

    // Update days to salary
    const daysUntil = document.getElementById('daysUntilSalary')?.textContent || '--';
    if (focusDays) focusDays.textContent = daysUntil;

    // Update streak
    const streak = getStreakData();
    if (focusStreak) focusStreak.textContent = streak.currentStreak || '0';
}

export function updateQuickInsight(STATE, callbacks) {
    const { checkDailyBudget, formatNum, getStreakData } = callbacks;

    const insightText = document.getElementById('quickInsightText');
    const insightSubtext = document.getElementById('quickInsightSubtext');
    if (!insightText || !insightSubtext) return;

    const budget = checkDailyBudget();
    const streak = getStreakData();

    // Generate contextual insight
    if (budget.status === 'danger') {
        insightText.textContent = "Budget alert! Consider pausing spending.";
        insightSubtext.textContent = `You've spent ${Math.round((budget.spent / budget.budget) * 100)}% of today's budget`;
    } else if (budget.status === 'warning') {
        insightText.textContent = "Halfway through your daily budget";
        insightSubtext.textContent = `QAR ${formatNum(budget.remaining)} left - spend wisely!`;
    } else if (streak.currentStreak >= 3) {
        insightText.textContent = `${streak.currentStreak}-day streak! You're crushing it!`;
        insightSubtext.textContent = "Keep the momentum going";
    } else {
        insightText.textContent = "You're doing great today!";
        insightSubtext.textContent = `QAR ${formatNum(budget.remaining)} left to spend`;
    }
}

export function initFocusMode(STATE) {
    // Load saved preference
    const saved = localStorage.getItem(`fact_focus_mode_${STATE.currentUser}`);
    if (saved === 'true') {
        isFocusMode = true;
        applyFocusMode(STATE);
    }
}

// ============== IMPULSE CONTROL ==============

// Detect impulse burst (multiple transactions in short time)
export function detectImpulseBurst(transactions) {
    const bursts = [];
    const sorted = [...transactions].sort((a, b) => a.date.unix() - b.date.unix());

    for (let i = 0; i < sorted.length; i++) {
        const windowStart = sorted[i].date;
        const windowTxns = [sorted[i]];

        for (let j = i + 1; j < sorted.length; j++) {
            const diff = sorted[j].date.diff(windowStart, 'minute');
            if (diff <= 30) { // 30 minute window
                windowTxns.push(sorted[j]);
            } else {
                break;
            }
        }

        if (windowTxns.length >= 3) {
            bursts.push({
                time: windowStart,
                count: windowTxns.length,
                total: windowTxns.reduce((s, t) => s + t.amount, 0),
                transactions: windowTxns
            });
            i += windowTxns.length - 1; // Skip processed transactions
        }
    }

    return bursts;
}

// Check if user is over daily budget
export function checkDailyBudget(STATE, calculateBudgetProjection) {
    const today = dayjs().startOf('day');
    const todayTxns = STATE.allTxns.filter(t =>
        t.direction === 'OUT' &&
        t.date.isAfter(today) &&
        t.date.isBefore(today.add(1, 'day'))
    );
    const todaySpent = todayTxns.reduce((s, t) => s + t.amount, 0);

    const proj = calculateBudgetProjection();
    const dailyBudget = proj.dailyBudget || 300; // Default 300 QAR

    const percentage = (todaySpent / dailyBudget) * 100;

    return {
        spent: todaySpent,
        budget: dailyBudget,
        remaining: Math.max(0, dailyBudget - todaySpent),
        percentage,
        status: percentage < 50 ? 'safe' : percentage < 80 ? 'warning' : 'danger'
    };
}

// Track and warn about daily budget
export function updateDailyBudgetMeter(STATE, callbacks) {
    const { checkDailyBudget, formatNum, showToast } = callbacks;

    const status = checkDailyBudget();
    const meterEl = document.getElementById('dailyBudgetMeter');
    if (!meterEl) return;

    const fillEl = meterEl.querySelector('.budget-meter-fill');
    if (fillEl) {
        fillEl.style.width = `${Math.min(100, status.percentage)}%`;
        fillEl.className = `budget-meter-fill ${status.status}`;
    }

    const labelEl = document.getElementById('dailyBudgetLabel');
    if (labelEl) {
        labelEl.textContent = `${formatNum(status.remaining)} left today`;
        labelEl.className = status.status === 'danger' ? 'text-fact-red' : 'text-fact-muted dark:text-fact-dark-muted';
    }

    // Show warning toast if over 80%
    if (status.percentage >= 80 && status.percentage < 100 && !STATE.dailyWarningShown) {
        showToast(`You've used ${status.percentage.toFixed(0)}% of today's budget`, 'info');
        STATE.dailyWarningShown = true;
    } else if (status.percentage >= 100 && !STATE.dailyOverShown) {
        showToast(`Over budget today! Spent ${formatNum(status.spent)} of ${formatNum(status.budget)}`, 'error');
        STATE.dailyOverShown = true;
    }
}

// Check for impulse bursts and show warning
export function checkForImpulseBursts(STATE, formatNum) {
    const today = dayjs().startOf('day');
    const todayTxns = STATE.allTxns.filter(t =>
        t.direction === 'OUT' &&
        t.date.isAfter(today.subtract(1, 'day'))
    );

    const bursts = detectImpulseBurst(todayTxns);

    if (bursts.length > 0 && !STATE.impulseBannerDismissed) {
        const latest = bursts[bursts.length - 1];
        document.getElementById('impulseMessage').textContent =
            `${latest.count} purchases (QAR ${formatNum(latest.total)}) in 30 minutes`;
        document.getElementById('impulseBanner').style.display = 'block';
    }
}

export function dismissImpulseBanner(STATE) {
    document.getElementById('impulseBanner').style.display = 'none';
    STATE.impulseBannerDismissed = true;
}

// ============== STREAK TRACKING ==============

export function getStreakData(STATE) {
    try {
        return JSON.parse(localStorage.getItem(`fact_streak_${STATE.currentUser}`)) || {
            currentStreak: 0,
            longestStreak: 0,
            lastGoodDay: null
        };
    } catch (e) {
        return { currentStreak: 0, longestStreak: 0, lastGoodDay: null };
    }
}

export function saveStreakData(data, STATE) {
    localStorage.setItem(`fact_streak_${STATE.currentUser}`, JSON.stringify(data));
}

export function updateStreak(STATE, checkDailyBudget) {
    const status = checkDailyBudget();
    const streak = getStreakData(STATE);
    const today = dayjs().format('YYYY-MM-DD');
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');

    // Only update at end of day or when checking previous days
    if (status.status !== 'danger') {
        if (streak.lastGoodDay === yesterday) {
            streak.currentStreak++;
        } else if (streak.lastGoodDay !== today) {
            streak.currentStreak = 1;
        }
        streak.lastGoodDay = today;
        streak.longestStreak = Math.max(streak.longestStreak, streak.currentStreak);
    } else if (streak.lastGoodDay !== today && streak.lastGoodDay !== yesterday) {
        streak.currentStreak = 0;
    }

    saveStreakData(streak, STATE);
    return streak;
}

export function renderStreakBadge(STATE) {
    const streak = getStreakData(STATE);
    const container = document.getElementById('streakContainer');
    if (!container) return;

    if (streak.currentStreak > 0) {
        container.innerHTML = `
            <div class="streak-badge">
                <span>fire</span>
                <span>${streak.currentStreak} day${streak.currentStreak > 1 ? 's' : ''}</span>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="text-xs text-fact-muted dark:text-fact-dark-muted">
                Stay under budget to start a streak!
            </div>
        `;
    }
}
