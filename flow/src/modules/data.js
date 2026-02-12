// ─── DATA FETCHING ──────────────────────────────────────────────
import Papa from 'papaparse';
import dayjs from 'dayjs';
import { fetchWithTimeout, friendlyError } from './utils.js';

// Parse date that might be ISO string or Excel serial number
export function parseDate(value) {
    const cleaned = clean(value);

    // Check if it's a number (Excel serial date)
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 40000 && num < 60000) {
        // Excel serial date: days since Dec 30, 1899
        const days = Math.floor(num);
        const timeFraction = num - days;

        const msPerDay = 24 * 60 * 60 * 1000;
        const excelEpochMs = Date.UTC(1899, 11, 30);
        const dateMs = excelEpochMs + (days * msPerDay);

        const utcDate = new Date(dateMs);
        const year = utcDate.getUTCFullYear();
        const month = utcDate.getUTCMonth();
        const day = utcDate.getUTCDate();

        const totalMinutes = Math.round(timeFraction * 24 * 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        const parsed = dayjs(new Date(year, month, day, hours, minutes));
        return parsed.isValid() ? parsed : dayjs();
    }

    // Otherwise parse as ISO string
    const parsed = dayjs(cleaned);
    return parsed.isValid() ? parsed : dayjs();
}

export function clean(str) {
    return str ? str.toString().replace(/^"|"$/g, '').trim() : '';
}

// Incremental sync: store last sync timestamp per user
function getLastSyncKey(STATE) {
    return `fact_last_sync_${STATE.currentUser}`;
}

function getLastSync(STATE) {
    try { return localStorage.getItem(getLastSyncKey(STATE)) || null; } catch (_e) { return null; }
}

function setLastSync(STATE) {
    try { localStorage.setItem(getLastSyncKey(STATE), new Date().toISOString()); } catch (_e) {}
}

// Sync progress bar helpers
const SYNC_STAGES = [
    { pct: 15, label: 'Connecting...' },
    { pct: 35, label: 'Fetching transactions...' },
    { pct: 55, label: 'Computing patterns...' },
    { pct: 75, label: 'Analyzing trends...' },
    { pct: 90, label: 'Finalizing...' },
];

function showSyncProgress(isFirstLoad) {
    const el = document.getElementById('syncProgress');
    const bar = document.getElementById('syncProgressBar');
    const label = document.getElementById('syncProgressLabel');
    if (!el || !bar || !label) return null;

    el.classList.remove('hidden');
    bar.style.width = '0%';
    label.textContent = SYNC_STAGES[0].label;

    let stageIndex = 0;
    const interval = setInterval(() => {
        stageIndex++;
        if (stageIndex < SYNC_STAGES.length) {
            bar.style.width = SYNC_STAGES[stageIndex].pct + '%';
            label.textContent = SYNC_STAGES[stageIndex].label;
        }
    }, isFirstLoad ? 1500 : 600);

    // Start first stage
    requestAnimationFrame(() => { bar.style.width = SYNC_STAGES[0].pct + '%'; });

    return interval;
}

function hideSyncProgress(interval) {
    if (interval) clearInterval(interval);
    const el = document.getElementById('syncProgress');
    const bar = document.getElementById('syncProgressBar');
    if (bar) bar.style.width = '100%';
    setTimeout(() => {
        if (el) el.classList.add('hidden');
        if (bar) bar.style.width = '0%';
    }, 600);
}

// DATA FETCHING - Secure via Supabase Edge Function
export async function syncData(supabaseClient, CONFIG, STATE, callbacks) {
    const { showToast, filterAndRender, checkAchievements, renderPatternWarnings, setSalaryPeriod, setPeriod } = callbacks;

    // Only show full loading skeleton on first load
    const isFirstLoad = !STATE.hasLoaded;
    if (isFirstLoad) {
        document.getElementById('loadingState').classList.remove('hidden');
        document.getElementById('mainContent').classList.add('hidden');
    }

    // Show progress bar
    const progressInterval = showSyncProgress(isFirstLoad);

    try {
        // Use passed session if available (avoids getSession() race condition),
        // otherwise fall back to getSession()
        let accessToken = callbacks.session?.access_token;
        if (!accessToken) {
            const { data: sessionData } = await supabaseClient.auth.getSession();
            accessToken = sessionData?.session?.access_token;
        }
        if (!accessToken) throw new Error('AUTH_REQUIRED');

        // Use incremental sync on subsequent loads
        const lastSync = isFirstLoad ? null : getLastSync(STATE);
        const requestBody = {
            sheets: ['RawLedger', 'MerchantMap', 'FXRates', 'UserContext', 'Recipients', 'Profile', 'Goals', 'Insights', 'Streaks', 'Recurring', 'HourlySpend', 'Proactive', 'Patterns', 'SalaryInfo', 'Forecast', 'ChartData', 'DailyDigest'],
        };
        if (lastSync) requestBody.last_sync = lastSync;

        const response = await fetchWithTimeout(`${CONFIG.FUNCTIONS_BASE}/flow-data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify(requestBody)
        }, { timeoutMs: 45000, retries: 1, retryDelay: 3000 });

        if (response.status === 401) throw new Error('AUTH_REQUIRED');
        if (response.status === 429) {
            const retryData = await response.json().catch(() => ({}));
            throw new Error('RATE_LIMITED');
        }
        const result = await response.json();
        if (result?.code === 'AUTH_REQUIRED' || result?.error === 'AUTH_REQUIRED') {
            throw new Error('AUTH_REQUIRED');
        }
        if (result?.error) throw new Error(result.error);
        const data = result?.data;
        if (!data) throw new Error('No data returned');

        const meta = result?.meta || {};

        // Process each sheet
        if (data.FXRates) processFX(data.FXRates.slice(1), STATE);
        if (data.MerchantMap) processMerchantMap(data.MerchantMap, STATE, callbacks.updateCatDropdowns);
        if (data.UserContext) processUserContext(data.UserContext, STATE);
        if (data.Recipients) processRecipients(data.Recipients, STATE);

        // RawLedger: on incremental sync, merge new rows into existing data;
        // on full sync (first load), replace entirely.
        if (data.RawLedger) {
            if (meta.is_incremental && data.RawLedger.length === 0) {
                // No new data — keep existing STATE.allTxns, skip re-processing
            } else if (meta.is_incremental && data.RawLedger.length > 0 && STATE.allTxns.length > 0) {
                // Merge: process new rows then prepend to existing
                const prevTxns = STATE.allTxns;
                processTxns(data.RawLedger, STATE, callbacks);
                const newTxns = STATE.allTxns;
                STATE.allTxns = [...newTxns, ...prevTxns].sort((a, b) => b.date - a.date);
            } else {
                // Full sync or first load: replace entirely
                processTxns(data.RawLedger, STATE, callbacks);
            }
        }

        // Process new data types
        if (data.Profile) {
            STATE.profile = data.Profile;
        }
        if (data.Goals) {
            STATE.dbGoals = data.Goals;
        }
        if (data.Insights) {
            STATE.dbInsights = data.Insights;
        }
        if (data.Streaks) {
            STATE.dbStreaks = data.Streaks;
        }
        if (data.Recurring) {
            STATE.recurring = data.Recurring;
        }
        if (data.HourlySpend) {
            STATE.hourlySpend = data.HourlySpend;
        }
        if (data.Proactive) {
            STATE.proactiveInsights = data.Proactive;
        }
        if (data.SalaryInfo) {
            STATE.salaryInfo = data.SalaryInfo;
        }
        if (data.Forecast) {
            STATE.forecastData = data.Forecast;
        }
        if (data.ChartData) {
            STATE.chartData = data.ChartData;
        }
        if (data.DailyDigest) {
            STATE.dailyDigest = data.DailyDigest;
        }

        // Save sync timestamp for next incremental sync
        setLastSync(STATE);

        const syncText = `Synced ${dayjs().format('HH:mm')}`;
        document.getElementById('lastSync').textContent = syncText;
        const footerSync = document.getElementById('lastSyncFooter');
        if (footerSync) footerSync.textContent = syncText;

        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('mainContent').classList.remove('hidden');

        // Default to salary period on first load, otherwise use current period
        if (STATE.period === 'salary' || !STATE.hasLoaded) {
            STATE.hasLoaded = true;
            setSalaryPeriod();
        } else {
            setPeriod(STATE.period);
        }

        // Build toast message
        if (STATE.hasLoaded && typeof showToast === 'function') {
            const count = meta.total_count || STATE.allTxns.length;
            const extra = [];
            if (meta.is_incremental) extra.push('incremental');
            if (meta.backfill_applied) extra.push('auto-categorized');
            const suffix = extra.length ? ` (${extra.join(', ')})` : '';
            showToast(`Synced ${count} transactions${suffix}`, 'success');
        }

        // Check for achievements after data loads
        if (typeof checkAchievements === 'function') {
            setTimeout(() => checkAchievements(), 1000);
        }

        // Show pattern-based nudges (delayed to not overwhelm)
        if (typeof renderPatternWarnings === 'function') {
            setTimeout(() => renderPatternWarnings(), 3000);
        }

        // Complete the progress bar
        hideSyncProgress(progressInterval);

    } catch (err) {
        const errMsg = String(err.message || err);

        // Auth failure — sign out and show login
        if (errMsg.includes('AUTH_REQUIRED')) {
            await supabaseClient.auth.signOut();
            document.getElementById('loginScreen').classList.remove('hidden');
            document.getElementById('mainApp').classList.add('hidden');
            return;
        }

        // Rate limited — show specific helpful message
        if (errMsg.includes('RATE_LIMITED')) {
            if (typeof showToast === 'function') {
                showToast('You\'re syncing too frequently. Please wait a moment and try again.', 'info');
            }
            return;
        }

        // Show user-friendly error (translated from technical message)
        if (typeof showToast === 'function') {
            showToast(friendlyError(err), 'error');
        }

        // On first load failure, still show the app shell so user isn't stuck on loading screen
        if (!STATE.hasLoaded) {
            document.getElementById('loadingState').classList.add('hidden');
            document.getElementById('mainContent').classList.remove('hidden');
        }

        // Hide the progress bar on error
        hideSyncProgress(progressInterval);
    }
}

// Legacy CSV fetch (kept for backwards compatibility if needed)
export function fetchCSV(url) {
    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            download: true,
            header: false,
            skipEmptyLines: true,
            complete: res => resolve(res.data),
            error: err => reject(err)
        });
    });
}

export function processFX(rows, STATE) {
    rows.forEach(r => {
        const cur = clean(r[0]);
        const rate = parseFloat(r[1]);
        if (cur && !isNaN(rate)) STATE.fxRates[cur] = rate;
    });
}

export function processMerchantMap(rows, STATE, updateCatDropdowns) {
    if (rows.length && rows[0][0]?.toLowerCase().includes('pattern')) rows.shift();

    STATE.merchantMap = [];
    STATE.categories.clear();

    rows.forEach(r => {
        const pattern = clean(r[0]).toLowerCase();
        const display = clean(r[1]);
        const consolidated = clean(r[2]) || display;
        const category = clean(r[3]);

        if (pattern && category) {
            STATE.merchantMap.push({ pattern, display, consolidated, category });
            STATE.categories.add(category);
        }
    });

    STATE.categories.add('Uncategorized');
    if (updateCatDropdowns) updateCatDropdowns();
}

// Process UserContext corrections (Type, Key, Value, Details, DateAdded, Source)
export function processUserContext(rows, STATE) {
    if (rows.length && rows[0][0]?.toLowerCase().includes('type')) rows.shift();

    STATE.userContext = rows.map(r => ({
        type: clean(r[0]),        // 'correction', 'preference', etc.
        key: clean(r[1]),         // What the correction is about
        value: clean(r[2]),       // The correction value
        details: clean(r[3]),     // Additional details
        dateAdded: clean(r[4]),   // When it was added
        source: clean(r[5])       // 'user' or 'ai'
    })).filter(c => c.type && c.value);
}

/**
 * Normalize counterparty names for consistent display.
 * - Title-cases ALL-CAPS names (ANTHROPIC -> Anthropic)
 * - Strips trailing branch/location suffixes (Woqod Al Wakra -> Woqod)
 * - Collapses extra whitespace
 */
export function normalizeCounterparty(name) {
    if (!name) return '';
    let n = name.trim();

    // Collapse whitespace
    n = n.replace(/\s+/g, ' ');

    // Title-case if entirely uppercase (e.g. ANTHROPIC -> Anthropic)
    if (n === n.toUpperCase() && n.length > 2) {
        n = n.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }

    // Known brand consolidations (exact prefix matching)
    const consolidations = [
        { prefixes: ['Woqod', 'Woqood', 'WOQOD'], canonical: 'Woqod' },
        { prefixes: ['Carrefour', 'CARREFOUR'], canonical: 'Carrefour' },
        { prefixes: ['Lulu ', 'LULU '], canonical: 'Lulu Hypermarket' },
        { prefixes: ['Al Meera', 'AL MEERA'], canonical: 'Al Meera' },
        { prefixes: ['Jarir', 'JARIR'], canonical: 'Jarir Bookstore' },
    ];

    const nLower = n.toLowerCase();
    for (const rule of consolidations) {
        for (const prefix of rule.prefixes) {
            if (nLower.startsWith(prefix.toLowerCase())) {
                return rule.canonical;
            }
        }
    }

    return n;
}

// Normalize phone number: remove country code, spaces, dashes
export function normalizePhone(phone) {
    if (!phone) return '';
    let digits = phone.replace(/\D/g, '');
    // Remove Qatar country code if present
    if (digits.startsWith('974') && digits.length > 8) {
        digits = digits.slice(3);
    }
    return digits;
}

// Process Recipients sheet for transfer/Fawran name mapping
export function processRecipients(rows, STATE) {
    // Skip header row if present
    if (rows.length && rows[0][0]?.toString().toLowerCase().includes('phone')) rows.shift();

    STATE.recipients = rows.map(r => ({
        id: clean(r[4]) || null,
        phone: normalizePhone(String(r[0] || '')),
        bankAccount: clean(r[1]),
        shortName: clean(r[2]),
        longName: clean(r[3])
    })).filter(rec => rec.shortName || rec.longName);
}

// Match counterparty to a known recipient
export function matchRecipient(counterparty, STATE) {
    if (!counterparty || !STATE.recipients.length) {
        return null;
    }

    const cpLower = counterparty.toLowerCase();
    const cpDigits = counterparty.replace(/\D/g, '');

    for (const rec of STATE.recipients) {
        // Priority 1: Phone match (digits in counterparty contain recipient phone)
        if (rec.phone && cpDigits.includes(rec.phone)) {
            return { ...rec, matchType: 'phone' };
        }

        // Priority 2: Bank account match (full or last 4 digits)
        if (rec.bankAccount) {
            const acctLower = rec.bankAccount.toLowerCase();
            const last4 = rec.bankAccount.slice(-4);
            if (cpLower.includes(acctLower) || cpDigits.includes(last4)) {
                return { ...rec, matchType: 'account' };
            }
        }

        // Priority 3a: Name match (ALL significant words from longName must appear in counterparty)
        if (rec.longName) {
            const words = rec.longName.toLowerCase().split(/\s+/).filter(w => w.length > 2);
            if (words.length > 0 && words.every(word => cpLower.includes(word))) {
                return { ...rec, matchType: 'name' };
            }
        }

        // Priority 3b: Reverse name match (all counterparty words found in longName)
        // Handles: counterparty "Afif Bou Nassif" matching longName "AFIF BOU NASSIF OR NICOLE DAOU"
        if (rec.longName) {
            const cpWords = cpLower.split(/\s+/).filter(w => w.length > 2);
            if (cpWords.length >= 2) {
                const lnLower = rec.longName.toLowerCase();
                if (cpWords.every(word => lnLower.includes(word))) {
                    return { ...rec, matchType: 'name' };
                }
            }
        }

        // Priority 4: ShortName match (word boundary, min 3 chars)
        if (rec.shortName && rec.shortName.length >= 3) {
            const escaped = rec.shortName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(`\\b${escaped}\\b`, 'i').test(counterparty)) {
                return { ...rec, matchType: 'shortName' };
            }
        }
    }

    return null;
}

// Check if a transaction matches any user context corrections
export function getContextForTransaction(txn, STATE) {
    const relevantContext = [];

    for (const ctx of STATE.userContext) {
        const keyLower = ctx.key.toLowerCase();

        // Check if the key matches transaction details
        const txnText = `${txn.raw} ${txn.counterparty} ${txn.display}`.toLowerCase();
        const amountStr = `qar ${Math.round(txn.amount)}`;

        if (txnText.includes(keyLower) ||
            amountStr === keyLower.replace(/\s+/g, ' ').trim() ||
            (keyLower.includes('to ') && txn.counterparty.toLowerCase().includes(keyLower.replace('to ', '')))) {
            relevantContext.push(ctx);
        }
    }

    return relevantContext;
}

// Check if transaction should NOT be marked as splurge based on user context
export function isExemptFromSplurge(txn, STATE) {
    const context = getContextForTransaction(txn, STATE);

    for (const ctx of context) {
        const valueLower = ctx.value.toLowerCase();
        // User said "not a splurge" or explained it's something else
        if (valueLower.includes('not a splurge') ||
            valueLower.includes('not splurge') ||
            valueLower.includes('is my') ||
            valueLower.includes('is actually') ||
            valueLower.includes('bill') ||
            valueLower.includes('rent') ||
            valueLower.includes('subscription') ||
            valueLower.includes('regular')) {
            return true;
        }
    }

    return false;
}

export function processTxns(rows, STATE, callbacks) {
    const { MERCHANT_TYPES, getSummaryGroup, getTimeContext, getSizeTier, categorize, detectPatterns, matchRecipient: matchRecipientFn } = callbacks;

    // rows is now an array of JSON objects from flow-data
    const data = rows.filter(r => r.amount != null && !isNaN(parseFloat(r.amount)));

    STATE.allTxns = data.map(r => {
        const raw = r.raw_text || '';
        const counterparty = normalizeCounterparty(r.counterparty || '');
        const card = r.card || '';
        const currency = r.currency || 'QAR';
        const amount = parseFloat(r.amount);
        const txnDate = parseDate(r.txn_timestamp);

        // Use server-computed amount_qar if available, else compute client-side
        let amtQAR;
        if (r.amount_qar != null) {
            amtQAR = parseFloat(r.amount_qar);
        } else {
            const rate = STATE.fxRates[currency] || 1;
            const amtQARApprox = r.amount_qar_approx ? parseFloat(r.amount_qar_approx) : null;
            amtQAR = currency === 'QAR' ? amount : (amtQARApprox || amount * rate);
        }

        // DB category fields
        const dbCategory = r.category || null;
        const aiMerchantType = r.subcategory || dbCategory || null;
        const confidence = r.confidence || null;
        let aiContext = null;
        try {
            aiContext = r.context ? (typeof r.context === 'string' ? JSON.parse(r.context) : r.context) : null;
        } catch (e) {
            aiContext = null;
        }

        // Get merchant type and display info (pass counterparty as clean display name)
        const meta = categorize(raw, aiMerchantType, counterparty, dbCategory);

        // Use server-computed is_salary if available, else compute client-side
        const isSalary = r.is_salary != null ? r.is_salary : (() => {
            const txnType = r.txn_type || '';
            const allText = `${raw} ${counterparty} ${card} ${txnType}`.toLowerCase();
            return allText.includes('salary');
        })();

        // Use server-computed dimensions if available, else compute client-side
        const timeContext = (r.time_context && r.time_context.length > 0)
            ? r.time_context
            : getTimeContext(txnDate);
        const sizeTier = r.size_tier || getSizeTier(amtQAR);

        // COMPUTE DIMENSIONS — use server-provided pattern if available
        const dims = {
            what: meta.merchantType,
            when: timeContext,
            size: sizeTier,
            pattern: r.pattern || 'Normal'
        };

        // Use server-resolved recipient_id if available, else fallback to client matching
        const txnType = r.txn_type || '';
        let recipient = null;
        if (r.recipient_id) {
            // Server matched this transaction to a recipient at INSERT time
            const rec = STATE.recipients.find(rc => rc.id === r.recipient_id);
            if (rec) {
                recipient = { ...rec, matchType: 'server' };
            }
        }
        if (!recipient) {
            // Fallback: client-side matching for rows without server recipient_id
            const isTransferType = ['transfer', 'fawran', 'internal transfer'].some(t =>
                txnType.toLowerCase().includes(t) || raw.toLowerCase().includes(t)
            );
            if (isTransferType) {
                recipient = matchRecipientFn(counterparty);
                if (!recipient) recipient = matchRecipientFn(raw);
            } else if (r.direction === 'OUT') {
                const cpDigits = counterparty.replace(/\D/g, '');
                if (cpDigits.length >= 8) {
                    recipient = matchRecipientFn(counterparty);
                }
            }
        }

        return {
            dbId: r.id,
            date: txnDate,
            amount: amtQAR,
            originalAmount: amount,
            currency,
            raw,
            counterparty,
            card,
            display: meta.display,
            consolidated: meta.consolidated,
            merchantType: meta.merchantType,
            summaryGroup: getSummaryGroup(meta.merchantType),
            direction: r.direction || '',
            txnType: txnType,
            confidence,
            aiContext,
            isSalary,
            // Recipient matching for transfers
            recipient,
            resolvedName: recipient?.shortName || null,
            resolvedLongName: recipient?.longName || null,
            // Dimensions
            dims,
            // Computed flags for quick filtering
            isWorkHours: dims.when.includes('Work Hours'),
            isLateNight: dims.when.includes('Late Night'),
            isWeekend: dims.when.includes('Weekend'),
            isLarge: dims.size === 'Large' || dims.size === 'Major',
            isEssential: MERCHANT_TYPES[meta.merchantType]?.essential || false
        };
    }).sort((a, b) => b.date - a.date);

    // After loading, detect patterns
    detectPatterns();
}

export function categorize(raw, aiMerchantType, STATE, MERCHANT_TYPES, counterparty, dbCategory) {
    const lower = raw.toLowerCase();
    // Use counterparty as the clean display name when available (parsed by AI on ingest)
    const cleanName = counterparty || raw;

    // Priority 1: Local user overrides
    if (STATE.localMappings[lower]) {
        const m = STATE.localMappings[lower];
        return {
            display: m.display,
            consolidated: m.consolidated,
            merchantType: m.merchantType || m.category || 'Other'
        };
    }

    // Priority 2: DB category — trust the database if a category was set
    if (dbCategory && dbCategory.trim()) {
        // Map DB subcategory values to MERCHANT_TYPES keys (handles legacy/alternate names)
        const subcatMap = {
            'Bars & Hotels': 'Bars & Nightlife',
            'Hobbies': 'Entertainment',
            'Transfers': 'Transfer',
            'Income': 'Transfer',
            'Family Transfers': 'Family',
            'Fees': 'Transfer'
        };
        const mappedType = subcatMap[aiMerchantType] || aiMerchantType;
        // Use mapped subcategory if it matches a known MERCHANT_TYPES key
        const merchantType = (mappedType && MERCHANT_TYPES[mappedType])
            ? mappedType
            : (subcatMap[dbCategory] || (MERCHANT_TYPES[dbCategory] ? dbCategory : 'Other'));
        return { display: cleanName, consolidated: cleanName, merchantType };
    }

    // Priority 3: MerchantMap patterns
    const match = STATE.merchantMap.find(m => lower.includes(m.pattern));
    if (match) {
        // Map old categories to new merchant types
        const typeMap = {
            'Groceries': 'Groceries',
            'Dining': 'Dining',
            'Bars & Hotels': 'Bars & Nightlife',
            'Delivery': 'Delivery',
            'Shopping': 'Shopping',
            'Hobbies': 'Entertainment',
            'Bills': 'Bills',
            'Transport': 'Transport',
            'Travel': 'Travel',
            'Health': 'Health',
            'Family Transfers': 'Family',
            'Family': 'Family',
            'Transfers': 'Transfer',
            'Fees': 'Transfer'
        };
        const merchantType = typeMap[match.category] || match.category || 'Other';
        return { display: match.display, consolidated: match.consolidated, merchantType };
    }

    return { display: cleanName, consolidated: cleanName, merchantType: 'Uncategorized' };
}

export function getStorageKey(CONFIG, STATE) {
    return `${CONFIG.STORAGE_KEY}_${STATE.currentUser}`;
}

export function loadLocal(CONFIG, STATE) {
    try {
        const stored = localStorage.getItem(getStorageKey(CONFIG, STATE));
        if (stored) {
            const data = JSON.parse(stored);
            STATE.localMappings = data.mappings || {};
        }
    } catch (e) {
        console.warn('Failed to load local settings:', e.message);
        // Non-critical — continue with default empty mappings
    }
}

export function saveLocal(CONFIG, STATE) {
    localStorage.setItem(getStorageKey(CONFIG, STATE), JSON.stringify({
        mappings: STATE.localMappings
    }));
}
