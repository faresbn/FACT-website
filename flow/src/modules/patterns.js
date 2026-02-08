// ─── PATTERN/SALARY DETECTION ──────────────────────────────────
import dayjs from 'dayjs';

// PATTERN DETECTION - now primarily uses server-computed patterns from DB.
// Patterns are set by detect_spending_patterns() DB function via flow-data sync.
// The server writes pattern values directly to raw_ledger rows, which processTxns
// reads into dims.pattern. This function is kept as a client-side fallback
// for when pattern data is not yet available from the server (e.g., after
// a manual re-categorization before the next sync).
export function detectPatterns(STATE, isExemptFromSplurge) {
    // If patterns were already loaded from server (dims.pattern != 'Normal' for some),
    // skip client-side re-detection to avoid overwriting server values
    const hasServerPatterns = STATE.allTxns.some(t => t.dims.pattern && t.dims.pattern !== 'Normal');
    if (hasServerPatterns) return;

    // Fallback: client-side pattern detection (same logic as before)
    const out = STATE.allTxns.filter(t => t.direction === 'OUT');

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

    out.forEach(t => {
        if (t.isWorkHours && ['Dining', 'Coffee'].includes(t.merchantType) && t.dims.pattern === 'Normal') {
            t.dims.pattern = 'Work Expense';
        }
    });

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
            if (!isExemptFromSplurge(t, STATE)) {
                t.dims.pattern = 'Splurge';
            }
        }
    });

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

// SALARY DETECTION - uses server-provided STATE.salaryInfo when available,
// falls back to client-side detection from transaction data.
export function detectSalary(STATE) {
    // Use server-provided salary info if available
    if (STATE.salaryInfo && STATE.salaryInfo.salary_count > 0) {
        // Build a compatible salaries array from allTxns for setSalaryPeriod
        const modalAmount = parseFloat(STATE.salaryInfo.modal_salary_amount);
        const salaries = STATE.allTxns.filter(t =>
            t.direction === 'IN' && t.isSalary &&
            Math.abs(t.amount - modalAmount) / modalAmount < 0.1
        ).sort((a, b) => b.date - a.date);

        return {
            salaries,
            avgInterval: Math.round(parseFloat(STATE.salaryInfo.avg_interval_days)) || 30
        };
    }

    // Fallback: client-side detection
    const allSalaries = STATE.allTxns.filter(t =>
        t.direction === 'IN' && t.isSalary
    ).sort((a, b) => b.date - a.date);

    if (allSalaries.length === 0) {
        return { salaries: [], avgInterval: 30 };
    }

    const amounts = allSalaries.map(s => Math.round(s.amount / 100) * 100);
    const amountCounts = {};
    amounts.forEach(a => amountCounts[a] = (amountCounts[a] || 0) + 1);
    const mainSalaryAmount = Object.entries(amountCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0];

    const salaries = mainSalaryAmount
        ? allSalaries.filter(s => Math.abs(s.amount - mainSalaryAmount) / mainSalaryAmount < 0.1)
        : allSalaries;

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

// Get projected next salary date - uses server-computed date when available
export function getNextSalaryDate(STATE) {
    // Use server-computed next salary date if available
    if (STATE.salaryInfo?.next_expected_date) {
        return dayjs(STATE.salaryInfo.next_expected_date);
    }

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
