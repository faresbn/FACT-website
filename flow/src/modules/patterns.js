// ─── PATTERN/SALARY DETECTION ──────────────────────────────────
import dayjs from 'dayjs';

// PATTERN DETECTION - runs on all transactions to find clusters
export function detectPatterns(STATE, isExemptFromSplurge) {
    const out = STATE.allTxns.filter(t => t.direction === 'OUT');

    // Detect Night Out patterns: multiple bar/dining transactions in same evening
    const byDate = {};
    out.forEach(t => {
        const dateKey = t.date.format('YYYY-MM-DD');
        if (!byDate[dateKey]) byDate[dateKey] = [];
        byDate[dateKey].push(t);
    });

    Object.values(byDate).forEach(dayTxns => {
        const lateNightSocial = dayTxns.filter(t =>
            t.isLateNight &&
            ['Bars & Nightlife', 'Dining', 'Coffee'].includes(t.merchantType)
        );
        if (lateNightSocial.length >= 2) {
            lateNightSocial.forEach(t => t.dims.pattern = 'Night Out');
        }
    });

    // Detect Work Expense candidates: work hours dining/coffee
    out.forEach(t => {
        if (t.isWorkHours && ['Dining', 'Coffee'].includes(t.merchantType) && t.dims.pattern === 'Normal') {
            t.dims.pattern = 'Work Expense';
        }
    });

    // Detect Splurges: transactions > 3x average for that merchant type
    const avgByType = {};
    out.forEach(t => {
        if (!avgByType[t.merchantType]) avgByType[t.merchantType] = { sum: 0, count: 0 };
        avgByType[t.merchantType].sum += t.amount;
        avgByType[t.merchantType].count++;
    });
    Object.keys(avgByType).forEach(type => {
        avgByType[type].avg = avgByType[type].sum / avgByType[type].count;
    });

    out.forEach(t => {
        const avg = avgByType[t.merchantType]?.avg || 0;
        if (avg > 0 && t.amount > avg * 3 && t.dims.pattern === 'Normal') {
            // Check if user has exempted this from splurge detection
            if (!isExemptFromSplurge(t, STATE)) {
                t.dims.pattern = 'Splurge';
            }
        }
    });

    // Detect Subscriptions: same merchant, similar amount, ~monthly interval
    const byMerchant = {};
    out.forEach(t => {
        if (!byMerchant[t.consolidated]) byMerchant[t.consolidated] = [];
        byMerchant[t.consolidated].push(t);
    });

    Object.values(byMerchant).forEach(txns => {
        if (txns.length < 2) return;
        txns.sort((a, b) => a.date - b.date);

        const intervals = [];
        for (let i = 1; i < txns.length; i++) {
            intervals.push(txns[i].date.diff(txns[i-1].date, 'day'));
        }

        const avgInterval = intervals.reduce((s, i) => s + i, 0) / intervals.length;
        const amounts = txns.map(t => t.amount);
        const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;
        const amountVariance = amounts.every(a => Math.abs(a - avgAmount) < avgAmount * 0.1);

        if (avgInterval >= 25 && avgInterval <= 35 && amountVariance) {
            txns.forEach(t => t.dims.pattern = 'Subscription');
        }
    });
}

// SALARY DETECTION - Find transactions with SALARY keyword
export function detectSalary(STATE) {
    // Find all transactions flagged as salary
    const allSalaries = STATE.allTxns.filter(t =>
        t.direction === 'IN' && t.isSalary
    ).sort((a, b) => b.date - a.date);

    if (allSalaries.length === 0) {
        return { salaries: [], avgInterval: 30 };
    }

    // Find the most common (modal) salary amount to filter out advances/bonuses
    const amounts = allSalaries.map(s => Math.round(s.amount / 100) * 100); // Round to nearest 100
    const amountCounts = {};
    amounts.forEach(a => amountCounts[a] = (amountCounts[a] || 0) + 1);
    const mainSalaryAmount = Object.entries(amountCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0];

    // Filter to only main salary amounts (within 10% tolerance)
    const salaries = mainSalaryAmount
        ? allSalaries.filter(s => Math.abs(s.amount - mainSalaryAmount) / mainSalaryAmount < 0.1)
        : allSalaries;

    // Calculate average interval between main salaries
    let avgInterval = 30;
    if (salaries.length >= 2) {
        let totalInterval = 0;
        for (let i = 1; i < Math.min(salaries.length, 6); i++) {
            totalInterval += salaries[i-1].date.diff(salaries[i].date, 'day');
        }
        avgInterval = Math.round(totalInterval / (Math.min(salaries.length, 6) - 1));
    }

    return { salaries, avgInterval };
}

export function getIncomeDayFromContext(STATE) {
    if (!STATE.userContext || !STATE.userContext.length) return null;

    const incomeEntries = STATE.userContext.filter(c => c.type === 'income');
    if (!incomeEntries.length) return null;

    const preferred = incomeEntries.find(c => (c.key || '').toLowerCase().includes('salary')) || incomeEntries[0];
    const day = parseInt(preferred.value, 10);
    return isNaN(day) ? null : Math.min(Math.max(day, 1), 31);
}

// Get projected next salary date - detects day-of-month pattern from history
export function getNextSalaryDate(STATE) {
    const { salaries, avgInterval } = detectSalary(STATE);
    const incomeDay = getIncomeDayFromContext(STATE);
    if (incomeDay) {
        let nextDate = dayjs().date(incomeDay);

        if (nextDate.isBefore(dayjs(), 'day')) {
            nextDate = nextDate.add(1, 'month');
        }

        // Handle end-of-month edge cases
        const daysInMonth = nextDate.daysInMonth();
        if (incomeDay > daysInMonth) {
            nextDate = nextDate.date(daysInMonth);
        }

        // Adjust for Qatar weekend (Fri=5, Sat=6) - move to Thursday
        const dow = nextDate.day();
        if (dow === 5) nextDate = nextDate.subtract(1, 'day');
        if (dow === 6) nextDate = nextDate.subtract(2, 'day');

        return nextDate;
    }

    if (salaries.length === 0) return dayjs().add(30, 'day');

    const lastSalary = salaries[0].date;

    // Analyze salary dates to detect day-of-month pattern
    if (salaries.length >= 2) {
        const daysOfMonth = salaries.slice(0, 6).map(s => s.date.date());

        // Check if salaries consistently fall on similar days (within 3 days)
        const avgDay = Math.round(daysOfMonth.reduce((a, b) => a + b, 0) / daysOfMonth.length);
        const allNearAvg = daysOfMonth.every(d => Math.abs(d - avgDay) <= 3);

        if (allNearAvg) {
            // Day-of-month pattern detected (e.g., always around 28th)
            let nextDate = dayjs().date(avgDay);

            // If this month's date has passed, move to next month
            if (nextDate.isBefore(dayjs(), 'day')) {
                nextDate = nextDate.add(1, 'month');
            }

            // Handle end-of-month edge cases (e.g., avgDay=30 in Feb)
            if (avgDay > 28) {
                const daysInMonth = nextDate.daysInMonth();
                if (avgDay > daysInMonth) {
                    nextDate = nextDate.date(daysInMonth);
                }
            }

            // Adjust for Qatar weekend (Fri=5, Sat=6) - move to Thursday
            const dow = nextDate.day();
            if (dow === 5) nextDate = nextDate.subtract(1, 'day'); // Fri -> Thu
            if (dow === 6) nextDate = nextDate.subtract(2, 'day'); // Sat -> Thu

            return nextDate;
        }
    }

    // Fallback: interval-based calculation
    return lastSalary.add(avgInterval, 'day');
}

// Set period to include last 2 salaries
export function setSalaryPeriod(STATE, filterAndRender, updateDateRangeDisplay) {
    const { salaries, avgInterval } = detectSalary(STATE);

    if (salaries.length >= 2) {
        // Start from the day after the 2nd-to-last salary
        STATE.dateRange = {
            start: salaries[1].date,
            end: dayjs()
        };
        STATE.period = 'salary';
    } else if (salaries.length === 1) {
        // One salary found - show from that date
        STATE.dateRange = {
            start: salaries[0].date,
            end: dayjs()
        };
        STATE.period = 'salary';
    } else {
        // No salary detected - fall back to last 60 days
        STATE.dateRange = {
            start: dayjs().subtract(90, 'day'),
            end: dayjs()
        };
        STATE.period = 'last90';
    }

    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.period === STATE.period);
    });

    updateDateRangeDisplay();
    filterAndRender();
}

// Calculate budget projection
export function calculateBudgetProjection(STATE) {
    const { salaries } = detectSalary(STATE);
    const nextSalary = getNextSalaryDate(STATE);
    const today = dayjs().startOf('day');
    const nextSalaryDay = nextSalary.startOf('day');
    const daysUntilSalary = Math.max(0, nextSalaryDay.diff(today, 'day'));

    const income = STATE.filtered.filter(t => t.direction === 'IN').reduce((s, t) => s + t.amount, 0);
    const expenses = STATE.filtered.filter(t => t.direction === 'OUT').reduce((s, t) => s + t.amount, 0);
    const net = income - expenses;

    // Profile-first budget: use monthly_budget from profile if available
    const profileSettings = STATE.profile?.settings || {};
    const monthlyBudget = profileSettings.monthly_budget;
    const daysInMonth = today.daysInMonth();

    let dailyBudget;
    if (monthlyBudget && monthlyBudget > 0) {
        // Profile-based: remaining monthly budget / remaining days
        const daysPassed = today.date();
        const thisMonthExpenses = STATE.allTxns
            .filter(t => t.direction === 'OUT' && t.date.isAfter(today.startOf('month')) && t.date.isBefore(today.add(1, 'day')))
            .reduce((s, t) => s + t.amount, 0);
        const remainingBudget = Math.max(0, monthlyBudget - thisMonthExpenses);
        const remainingDays = daysInMonth - daysPassed + 1;
        dailyBudget = remainingDays > 0 ? remainingBudget / remainingDays : 0;
    } else {
        // Fallback: salary-based calculation
        dailyBudget = daysUntilSalary > 0 ? Math.max(0, net / daysUntilSalary) : 0;
    }

    // Calculate average daily spending from filtered period
    const periodDays = STATE.dateRange.end.diff(STATE.dateRange.start, 'day') + 1;
    const avgDailySpend = periodDays > 0 ? expenses / periodDays : 0;

    // Budget status: are we on track?
    const onTrack = dailyBudget >= avgDailySpend;

    // Use profile salary if available
    const profileSalary = profileSettings.salary_amount;
    const lastSalaryAmount = profileSalary || (salaries.length > 0 ? salaries[0].amount : 0);

    return {
        income,
        expenses,
        net,
        daysUntilSalary,
        nextSalaryDate: nextSalary,
        dailyBudget,
        avgDailySpend,
        onTrack,
        lastSalaryAmount,
        monthlyBudget: monthlyBudget || null
    };
}
