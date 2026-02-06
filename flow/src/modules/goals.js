// ─── GOALS SYSTEM ──────────────────────────────────────────────
import dayjs from 'dayjs';

// ============== GOALS SYSTEM ==============

export function getGoals(STATE) {
    // DB-first: prefer dbGoals if loaded
    if (STATE.dbGoals && STATE.dbGoals.length > 0) {
        return STATE.dbGoals.map(g => ({
            id: g.id,
            category: g.category,
            amount: Number(g.monthly_limit),
        }));
    }
    // Fallback to localStorage
    try {
        return JSON.parse(localStorage.getItem(`fact_goals_${STATE.currentUser}`)) || [];
    } catch (e) {
        return [];
    }
}

export function saveGoals(goals, STATE) {
    // Keep localStorage as cache
    localStorage.setItem(`fact_goals_${STATE.currentUser}`, JSON.stringify(goals));
}

// Migrate localStorage goals to DB on first load
export async function migrateGoalsToDb(STATE, supabaseClient, CONFIG) {
    const localKey = `fact_goals_${STATE.currentUser}`;
    const localGoals = JSON.parse(localStorage.getItem(localKey) || '[]');

    if (!localGoals.length || (STATE.dbGoals && STATE.dbGoals.length > 0)) return;

    try {
        const { data: session } = await supabaseClient.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) return;

        for (const goal of localGoals) {
            await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-profile`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    action: 'goals.save',
                    goal: { category: goal.category, monthly_limit: goal.amount }
                })
            });
        }
        // Mark as migrated
        localStorage.setItem(`${localKey}_migrated`, 'true');
    } catch (err) {
        // Goals migration is non-critical — silently skip
    }
}

// ============== GOALS EXTENDED ==============

export function openGoals(openSettings) {
    openSettings('goals');
}

export function closeGoals(closeSettings) {
    closeSettings();
}

export function renderSettingsGoalsList(STATE, callbacks) {
    const { formatNum, escapeHtml, MERCHANT_TYPES, showConfirm, showToast } = callbacks;

    const goals = getGoals(STATE);
    const container = document.getElementById('settingsGoalsList');
    if (!container) return;

    if (goals.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8">
                <div class="text-3xl mb-2">target</div>
                <p class="text-sm text-fact-muted dark:text-fact-dark-muted">No budget goals set yet</p>
                <p class="text-xs text-fact-muted dark:text-fact-dark-muted mt-1">Set spending limits to track your progress</p>
            </div>
        `;
        return;
    }

    const now = dayjs();
    const monthStart = now.startOf('month');
    const monthTxns = STATE.allTxns.filter(t =>
        t.direction === 'OUT' &&
        t.date.isAfter(monthStart) &&
        t.date.isBefore(now.add(1, 'day'))
    );

    const spendByCategory = {};
    monthTxns.forEach(t => {
        spendByCategory[t.merchantType] = (spendByCategory[t.merchantType] || 0) + t.amount;
    });

    const daysInMonth = now.daysInMonth();
    const daysPassed = now.date();
    const dayProgress = (daysPassed / daysInMonth) * 100;

    container.innerHTML = goals.map((goal, i) => {
        const spent = spendByCategory[goal.category] || 0;
        const pct = Math.min(100, (spent / goal.amount) * 100);
        const remaining = Math.max(0, goal.amount - spent);
        const color = pct > 100 ? '#E57373' : pct > 80 ? '#F4C44E' : '#75B876';
        const typeInfo = MERCHANT_TYPES[goal.category] || {};

        return `
            <div class="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2">
                        <span class="text-lg">${typeInfo.icon || '?'}</span>
                        <span class="font-medium text-sm">${escapeHtml(goal.category)}</span>
                    </div>
                    <button onclick="deleteGoal(${i})" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-fact-red/10 text-fact-muted hover:text-fact-red transition" aria-label="Delete goal">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                <div class="flex items-baseline justify-between mb-2">
                    <div class="font-display">
                        <span class="text-xl font-bold">${formatNum(spent)}</span>
                        <span class="text-sm text-fact-muted dark:text-fact-dark-muted">/ ${formatNum(goal.amount)}</span>
                    </div>
                    <span class="text-xs ${pct > 100 ? 'text-fact-red' : 'text-fact-green'}">${formatNum(remaining)} left</span>
                </div>
                <div class="goal-progress">
                    <div class="goal-progress-bar" style="width: ${pct}%; background: ${color}"></div>
                    <div class="goal-progress-marker" style="left: ${dayProgress}%" title="Expected pace"></div>
                </div>
                <div class="flex justify-between mt-2 text-[10px] text-fact-muted dark:text-fact-dark-muted">
                    <span>${pct.toFixed(0)}% used</span>
                    <span>${pct > dayProgress ? 'Ahead of pace' : 'On track'}</span>
                </div>
            </div>
        `;
    }).join('');
}

export function addNewGoal(MERCHANT_TYPES) {
    const categories = Object.keys(MERCHANT_TYPES).filter(c => c !== 'Uncategorized');
    const goalCategory = document.getElementById('goalCategory');
    if (goalCategory) {
        goalCategory.innerHTML = categories.map(c =>
            `<option value="${c}">${MERCHANT_TYPES[c]?.icon || ''} ${c}</option>`
        ).join('');
    }
    const goalAmount = document.getElementById('goalAmount');
    if (goalAmount) goalAmount.value = '';
    document.getElementById('addGoalModal').classList.remove('hidden');
}

export function closeAddGoal() {
    document.getElementById('addGoalModal').classList.add('hidden');
}

export function saveGoal(STATE, callbacks) {
    const { showToast, renderSettingsGoalsList } = callbacks;

    const category = document.getElementById('goalCategory').value;
    const amount = parseFloat(document.getElementById('goalAmount').value);

    if (!category || !amount || amount <= 0) {
        showToast('Please select a category and enter a valid amount', 'error');
        return;
    }

    const goals = getGoals(STATE);
    const existing = goals.findIndex(g => g.category === category);
    if (existing >= 0) {
        goals[existing].amount = amount;
        showToast(`Updated ${category} goal`, 'success');
    } else {
        goals.push({ category, amount });
        showToast(`Added ${category} goal`, 'success');
    }
    saveGoals(goals, STATE);

    closeAddGoal();
    renderSettingsGoalsList();
}

export async function deleteGoal(index, STATE, callbacks) {
    const { showConfirm, showToast, formatNum, renderSettingsGoalsList } = callbacks;

    const goals = getGoals(STATE);
    const goal = goals[index];

    const confirmed = await showConfirm({
        title: 'Delete Budget Goal',
        message: `Remove the ${goal.category} budget of QAR ${formatNum(goal.amount)}?`,
        confirmText: 'Delete',
        cancelText: 'Keep',
        type: 'danger'
    });

    if (confirmed) {
        goals.splice(index, 1);
        saveGoals(goals, STATE);
        renderSettingsGoalsList();
        showToast(`Removed ${goal.category} goal`, 'info');
    }
}
