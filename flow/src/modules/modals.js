// ─── TRANSACTIONS & DRILLDOWN MODALS ────────────────────────────
import Chart from 'chart.js/auto';
import dayjs from 'dayjs';

// Charts storage for modals
const modalCharts = {};

// ============== RECENT TRANSACTIONS ==============

export function renderRecentTxns(STATE, callbacks) {
    const { renderTxnRow } = callbacks;

    const container = document.getElementById('recentTxns');
    if (!container) return;

    let txns = [...STATE.filtered];

    // Apply text filter
    if (STATE.txnFilter) {
        txns = txns.filter(t =>
            t.display.toLowerCase().includes(STATE.txnFilter) ||
            t.raw.toLowerCase().includes(STATE.txnFilter) ||
            t.merchantType.toLowerCase().includes(STATE.txnFilter)
        );
    }

    // Apply sort
    switch (STATE.txnSort) {
        case 'date-asc':
            txns.sort((a, b) => a.date - b.date);
            break;
        case 'amount-desc':
            txns.sort((a, b) => b.amount - a.amount);
            break;
        case 'amount-asc':
            txns.sort((a, b) => a.amount - b.amount);
            break;
        case 'date-desc':
        default:
            txns.sort((a, b) => b.date - a.date);
    }

    container.innerHTML = txns.slice(0, 15).map(t => renderTxnRow(t)).join('');
}

export function renderTxnRow(t, callbacks) {
    const { formatNum, escapeHtml, getTypeColor, MERCHANT_TYPES } = callbacks;

    const isOut = t.direction === 'OUT';
    const color = getTypeColor(t.merchantType);
    const icon = MERCHANT_TYPES[t.merchantType]?.icon || '?';
    const safeRawData = btoa(unescape(encodeURIComponent(t.raw)));

    // Show resolved name for transfers
    const displayName = t.resolvedName ? `${t.resolvedName}` : t.display;

    return `
        <div class="txn-row p-3 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800" data-raw="${safeRawData}" onclick="openCatModalSafe(this)">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0" style="background:${color}20">${icon}</div>
                <div class="min-w-0">
                    <div class="font-medium text-sm truncate">${escapeHtml(displayName)}</div>
                    <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted truncate">${t.date.format('MMM D, HH:mm')} - ${escapeHtml(t.merchantType)}</div>
                </div>
            </div>
            <div class="text-right flex-shrink-0 ml-2">
                <div class="font-display font-semibold text-sm ${isOut ? '' : 'text-fact-green'}">${isOut ? '' : '+'}${formatNum(t.amount)}</div>
                ${t.currency !== 'QAR' && t.originalAmount != null ? `<div class="text-[10px] text-fact-muted dark:text-fact-dark-muted">${t.currency} ${t.originalAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>` : ''}
            </div>
        </div>
    `;
}

// Safe modal openers for base64 encoded data
export function openCatModalSafe(el, openCatModal) {
    const rawData = el.dataset.raw;
    if (rawData) {
        const raw = decodeURIComponent(escape(atob(rawData)));
        openCatModal(raw);
    }
}

export function openMerchantDrilldownSafe(el, openMerchantDrilldown) {
    const nameData = el.dataset.name;
    if (nameData) {
        const name = decodeURIComponent(escape(atob(nameData)));
        openMerchantDrilldown(name);
    }
}

// UNCATEGORIZED ALERT
export function renderUncatAlert(STATE, formatNum) {
    const uncat = STATE.filtered.filter(t => t.merchantType === 'Uncategorized' && t.direction === 'OUT');
    const count = uncat.length;
    const amount = uncat.reduce((s, t) => s + t.amount, 0);

    const alert = document.getElementById('uncatAlert');
    if (alert) {
        alert.classList.toggle('hidden', count === 0);
        const countEl = document.getElementById('uncatCount');
        const amountEl = document.getElementById('uncatAmount');
        if (countEl) countEl.textContent = count;
        if (amountEl) amountEl.textContent = formatNum(amount);
    }
}

// ============== DRILLDOWN MODALS ==============

// Category hierarchy for parent drilldown
export const CATEGORY_HIERARCHY = {
    'Essentials': { icon: 'house', subcategories: ['Groceries', 'Bills', 'Health', 'Transport'] },
    'Food & Drinks': { icon: 'food', subcategories: ['Dining', 'Coffee', 'Delivery', 'Bars & Nightlife'] },
    'Shopping & Fun': { icon: 'shopping', subcategories: ['Shopping', 'Entertainment', 'Travel'] },
    'Family': { icon: 'family', subcategories: ['Family'] },
    'Other': { icon: 'other', subcategories: ['Transfer', 'Other', 'Uncategorized'] }
};

export function openDrilldown(category, STATE, callbacks) {
    const { formatNum, escapeHtml, CAT_COLORS, renderTxnRow, SUMMARY_GROUPS } = callbacks;

    const out = STATE.filtered.filter(t => t.direction === 'OUT' && t.merchantType === category);
    const total = out.reduce((s, t) => s + t.amount, 0);

    // Calculate delta vs previous period
    const periodDays = STATE.dateRange.end.diff(STATE.dateRange.start, 'day');
    const prevStart = STATE.dateRange.start.subtract(periodDays + 1, 'day');
    const prevEnd = STATE.dateRange.start.subtract(1, 'day');
    const prevTxns = STATE.allTxns.filter(t => t.direction === 'OUT' && t.merchantType === category && t.date.isBetween(prevStart, prevEnd, 'day', '[]'));
    const prevTotal = prevTxns.reduce((s, t) => s + t.amount, 0);
    const delta = prevTotal > 0 ? ((total - prevTotal) / prevTotal * 100) : 0;

    document.getElementById('drilldownTitle').textContent = category;
    document.getElementById('drilldownSubtitle').textContent = `${out.length} transactions`;
    document.getElementById('drilldownTotal').textContent = `QAR ${formatNum(total)}`;
    document.getElementById('drilldownDelta').textContent = (delta >= 0 ? '+' : '') + delta.toFixed(0) + '%';
    document.getElementById('drilldownDelta').className = `font-display font-bold text-2xl ${delta <= 0 ? 'text-fact-green' : 'text-fact-red'}`;

    // Timeline
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

    const ctx = document.getElementById('drilldownTimeline');
    if (modalCharts.drilldownTimeline) modalCharts.drilldownTimeline.destroy();

    const color = CAT_COLORS[category] || '#999';

    modalCharts.drilldownTimeline = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: days.map(d => dayjs(d).format('D')),
            datasets: [{
                data: days.map(d => dailySpend[d] || 0),
                backgroundColor: color,
                borderRadius: 2,
                barThickness: Math.min(10, Math.max(2, 300 / days.length))
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: { display: false, beginAtZero: true }
            }
        }
    });

    // Merchants with count
    const merchants = {};
    out.forEach(t => {
        if (!merchants[t.consolidated]) {
            merchants[t.consolidated] = { total: 0, count: 0 };
        }
        merchants[t.consolidated].total += t.amount;
        merchants[t.consolidated].count++;
    });
    const sortedMerch = Object.entries(merchants)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);
    const maxMerch = sortedMerch[0]?.total || 1;

    document.getElementById('drilldownMerchants').innerHTML = `
        <p class="text-xs font-medium mb-2">Top Merchants</p>
        ${sortedMerch.map(m => `
            <div class="flex items-center gap-2 cursor-pointer hover:opacity-80" onclick="closeDrilldown(); openMerchantDrilldown('${m.name.replace(/'/g, "\\'")}')">
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between text-xs mb-0.5">
                        <span class="truncate">${escapeHtml(m.name)}</span>
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] text-fact-muted dark:text-fact-dark-muted">${m.count}x</span>
                            <span class="font-medium">${formatNum(m.total)}</span>
                        </div>
                    </div>
                    <div class="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div class="h-full rounded-full" style="width:${(m.total/maxMerch*100)}%;background:${color}"></div>
                    </div>
                </div>
            </div>
        `).join('')}
    `;

    // Transactions
    document.getElementById('drilldownTxns').innerHTML = out.slice(0, 20).map(t => renderTxnRow(t)).join('');

    document.getElementById('drilldownModal').classList.remove('hidden');
}

export function closeDrilldown() {
    document.getElementById('drilldownModal').classList.add('hidden');
}

export function openParentDrilldown(parentCategory, STATE, callbacks) {
    const { formatNum, escapeHtml, CAT_COLORS, getGroupColor, renderTxnRow, SUMMARY_GROUPS } = callbacks;

    const subcats = CATEGORY_HIERARCHY[parentCategory]?.subcategories || SUMMARY_GROUPS[parentCategory]?.types || [];
    const out = STATE.filtered.filter(t => t.direction === 'OUT' && subcats.includes(t.merchantType));
    const total = out.reduce((s, t) => s + t.amount, 0);

    // Calculate delta vs previous period
    const periodDays = STATE.dateRange.end.diff(STATE.dateRange.start, 'day');
    const prevStart = STATE.dateRange.start.subtract(periodDays + 1, 'day');
    const prevEnd = STATE.dateRange.start.subtract(1, 'day');
    const prevTxns = STATE.allTxns.filter(t => t.direction === 'OUT' && subcats.includes(t.merchantType) && t.date.isBetween(prevStart, prevEnd, 'day', '[]'));
    const prevTotal = prevTxns.reduce((s, t) => s + t.amount, 0);
    const delta = prevTotal > 0 ? ((total - prevTotal) / prevTotal * 100) : 0;

    const icon = CATEGORY_HIERARCHY[parentCategory]?.icon || SUMMARY_GROUPS[parentCategory]?.icon || 'box';
    document.getElementById('drilldownTitle').textContent = `${parentCategory}`;
    document.getElementById('drilldownSubtitle').textContent = `${out.length} transactions - ${subcats.length} subcategories`;
    document.getElementById('drilldownTotal').textContent = `QAR ${formatNum(total)}`;
    document.getElementById('drilldownDelta').textContent = (delta >= 0 ? '+' : '') + delta.toFixed(0) + '%';
    document.getElementById('drilldownDelta').className = `font-display font-bold text-2xl ${delta <= 0 ? 'text-fact-green' : 'text-fact-red'}`;

    // Timeline
    const color = CAT_COLORS[parentCategory] || getGroupColor(parentCategory);
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

    const ctx = document.getElementById('drilldownTimeline');
    if (modalCharts.drilldownTimeline) modalCharts.drilldownTimeline.destroy();

    modalCharts.drilldownTimeline = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: days.map(d => dayjs(d).format('D')),
            datasets: [{
                data: days.map(d => dailySpend[d] || 0),
                backgroundColor: color,
                borderRadius: 2,
                barThickness: Math.min(10, Math.max(2, 300 / days.length))
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: { display: false, beginAtZero: true }
            }
        }
    });

    // Subcategory breakdown
    const subcatSpend = {};
    out.forEach(t => {
        subcatSpend[t.merchantType] = (subcatSpend[t.merchantType] || 0) + t.amount;
    });
    const sortedSubs = Object.entries(subcatSpend).sort((a, b) => b[1] - a[1]);
    const maxSub = sortedSubs[0]?.[1] || 1;

    document.getElementById('drilldownMerchants').innerHTML = `
        <p class="text-xs font-medium mb-2 -mt-2">Subcategories</p>
        ${sortedSubs.map(([name, amt]) => {
            const subColor = CAT_COLORS[name] || color;
            return `
                <div class="flex items-center gap-2 cursor-pointer hover:opacity-80" onclick="closeDrilldown(); openDrilldown('${name}')">
                    <div class="flex-1 min-w-0">
                        <div class="flex justify-between text-xs mb-0.5">
                            <span class="truncate">${escapeHtml(name)}</span>
                            <span class="font-medium">${formatNum(amt)}</span>
                        </div>
                        <div class="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div class="h-full rounded-full" style="width:${(amt/maxSub*100)}%;background:${subColor}"></div>
                        </div>
                    </div>
                </div>
            `;
        }).join('')}
    `;

    // Transactions
    document.getElementById('drilldownTxns').innerHTML = out.slice(0, 20).map(t => renderTxnRow(t)).join('');

    document.getElementById('drilldownModal').classList.remove('hidden');
}

export function openMerchantDrilldown(merchantName, STATE, callbacks) {
    const { formatNum, escapeHtml, CAT_COLORS, renderTxnRow } = callbacks;

    const out = STATE.filtered.filter(t => t.direction === 'OUT' && t.consolidated === merchantName);
    const total = out.reduce((s, t) => s + t.amount, 0);
    const avgTxn = out.length > 0 ? total / out.length : 0;

    document.getElementById('drilldownTitle').textContent = merchantName;
    document.getElementById('drilldownSubtitle').textContent = `${out.length} transactions - Avg: QAR ${formatNum(avgTxn)}`;
    document.getElementById('drilldownTotal').textContent = `QAR ${formatNum(total)}`;

    // Calculate delta vs previous period
    const periodDays = STATE.dateRange.end.diff(STATE.dateRange.start, 'day');
    const prevStart = STATE.dateRange.start.subtract(periodDays + 1, 'day');
    const prevEnd = STATE.dateRange.start.subtract(1, 'day');
    const prevTxns = STATE.allTxns.filter(t => t.direction === 'OUT' && t.consolidated === merchantName && t.date.isBetween(prevStart, prevEnd, 'day', '[]'));
    const prevTotal = prevTxns.reduce((s, t) => s + t.amount, 0);
    const delta = prevTotal > 0 ? ((total - prevTotal) / prevTotal * 100) : 0;

    document.getElementById('drilldownDelta').textContent = (delta >= 0 ? '+' : '') + delta.toFixed(0) + '%';
    document.getElementById('drilldownDelta').className = `font-display font-bold text-2xl ${delta <= 0 ? 'text-fact-green' : 'text-fact-red'}`;

    const category = out[0]?.merchantType || 'Other';
    const color = CAT_COLORS[category] || '#999';

    // Timeline
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

    const ctx = document.getElementById('drilldownTimeline');
    if (modalCharts.drilldownTimeline) modalCharts.drilldownTimeline.destroy();

    modalCharts.drilldownTimeline = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: days.map(d => dayjs(d).format('D')),
            datasets: [{
                data: days.map(d => dailySpend[d] || 0),
                backgroundColor: color,
                borderRadius: 2,
                barThickness: Math.min(10, Math.max(2, 300 / days.length))
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: { display: false, beginAtZero: true }
            }
        }
    });

    // Show category & stats instead of merchants
    document.getElementById('drilldownMerchants').innerHTML = `
        <div class="grid grid-cols-3 gap-3">
            <div class="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mb-1">Transactions</div>
                <div class="font-display font-bold">${out.length}</div>
            </div>
            <div class="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mb-1">Average</div>
                <div class="font-display font-bold">${formatNum(avgTxn)}</div>
            </div>
            <div class="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mb-1">Category</div>
                <div class="font-display font-bold text-sm truncate">${escapeHtml(category)}</div>
            </div>
        </div>
    `;

    // Transactions
    document.getElementById('drilldownTxns').innerHTML = out.slice(0, 30).map(t => renderTxnRow(t)).join('');

    document.getElementById('drilldownModal').classList.remove('hidden');
}

// ============== UNCATEGORIZED MODAL ==============

export function openUncatModal(STATE, callbacks) {
    const { formatNum, escapeHtml } = callbacks;

    const uncat = STATE.filtered.filter(t => t.merchantType === 'Uncategorized' && t.direction === 'OUT');

    document.getElementById('uncatList').innerHTML = uncat.map(t => {
        const safeRawData = btoa(unescape(encodeURIComponent(t.raw)));
        return `
            <div class="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer" data-raw="${safeRawData}" onclick="closeUncatModal(); openCatModalSafe(this)">
                <div class="min-w-0">
                    <div class="font-medium text-sm truncate">${escapeHtml(t.display || t.counterparty || t.raw)}</div>
                    ${t.counterparty && t.counterparty !== (t.display || t.counterparty) ? `<div class="text-[10px] text-fact-muted dark:text-fact-dark-muted truncate">${escapeHtml(t.counterparty)}</div>` : ''}
                    <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted">${t.date.format('MMM D, HH:mm')}</div>
                </div>
                <div class="font-display font-semibold text-sm">${formatNum(t.amount)}</div>
            </div>
        `;
    }).join('');

    document.getElementById('uncatModal').classList.remove('hidden');
}

export function closeUncatModal() {
    document.getElementById('uncatModal').classList.add('hidden');
}

// ============== CATEGORIZE MODAL ==============

export function openCatModal(raw, STATE, callbacks = {}) {
    const { escapeHtml: escape } = callbacks;
    const escapeStr = escape || (s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));

    STATE.catTarget = raw;
    // Store previous category for learning feedback loop
    const existingTxn = STATE.allTxns.find(t => t.raw.toLowerCase() === raw.toLowerCase());
    STATE.catTargetPreviousType = existingTxn?.merchantType || null;

    document.getElementById('catModalRaw').textContent = raw;
    document.getElementById('catModalName').value = '';

    // Show recipient info if matched
    const recipientSection = document.getElementById('catModalRecipient');
    if (recipientSection && existingTxn?.recipient) {
        const rec = existingTxn.recipient;
        document.getElementById('catModalRecipientName').textContent =
            rec.longName || rec.shortName;
        const matchInfo = rec.matchType === 'phone' ? `Phone: ${rec.phone}` :
            rec.matchType === 'account' ? `Account: ...${rec.bankAccount.slice(-4)}` :
            rec.matchType === 'manual' ? 'Manually assigned' :
            `Name match`;
        document.getElementById('catModalRecipientDetails').textContent = matchInfo;
        recipientSection.classList.remove('hidden');
    } else if (recipientSection) {
        recipientSection.classList.add('hidden');
    }

    // Show recipient assignment dropdown for transfer-type transactions
    const recipientSelectSection = document.getElementById('catModalRecipientSelect');
    const recipientDropdown = document.getElementById('catModalRecipientDropdown');
    if (recipientSelectSection && recipientDropdown && existingTxn) {
        const isTransferType = ['transfer', 'fawran', 'internal transfer'].some(t =>
            (existingTxn.txnType || '').toLowerCase().includes(t) ||
            existingTxn.raw.toLowerCase().includes(t)
        );

        if (isTransferType || existingTxn.recipient) {
            recipientSelectSection.classList.remove('hidden');

            const recipients = STATE.recipients || [];
            recipientDropdown.innerHTML = '<option value="">None</option>' +
                recipients.map(r => {
                    const label = r.longName ? `${r.shortName} (${r.longName})` : r.shortName;
                    const selected = existingTxn.recipient?.id === r.id ? ' selected' : '';
                    return `<option value="${r.id}"${selected}>${escapeStr(label)}</option>`;
                }).join('');
        } else {
            recipientSelectSection.classList.add('hidden');
        }
    } else if (recipientSelectSection) {
        recipientSelectSection.classList.add('hidden');
    }

    document.getElementById('catModal').classList.remove('hidden');

    // Pre-fill display name and category from existing transaction
    if (existingTxn?.display) {
        document.getElementById('catModalName').value = existingTxn.display;
    }
    if (existingTxn?.merchantType && existingTxn.merchantType !== 'Uncategorized') {
        const catSelect = document.getElementById('catModalCat');
        if (catSelect) catSelect.value = existingTxn.merchantType;
    }
}

export function closeCatModal() {
    document.getElementById('catModal').classList.add('hidden');
}

export async function saveCategorization(STATE, supabaseClient, CONFIG, callbacks) {
    const { saveLocal, filterAndRender, detectPatterns } = callbacks;

    const raw = STATE.catTarget;
    const name = document.getElementById('catModalName').value || raw;
    const cat = document.getElementById('catModalCat').value;

    if (!cat) {
        alert('Please select a category');
        return;
    }

    // Save locally first (for immediate UI update)
    STATE.localMappings[raw.toLowerCase()] = { display: name, consolidated: name, category: cat };
    saveLocal();

    // Check if recipient was reassigned
    const recipientDropdown = document.getElementById('catModalRecipientDropdown');
    const recipientSelectSection = document.getElementById('catModalRecipientSelect');
    let newRecipientId = undefined; // undefined = no change, null = cleared, string = new id
    if (recipientSelectSection && !recipientSelectSection.classList.contains('hidden') && recipientDropdown) {
        const selectedValue = recipientDropdown.value || null;
        // Find the existing txn to compare
        const existingTxn = STATE.allTxns.find(t => t.raw.toLowerCase() === raw.toLowerCase());
        const currentId = existingTxn?.recipient?.id || null;
        if (selectedValue !== currentId) {
            newRecipientId = selectedValue;
        }
    }

    // Update local state for category
    STATE.allTxns.forEach(t => {
        if (t.raw.toLowerCase() === raw.toLowerCase()) {
            t.display = name;
            t.consolidated = name;
            t.merchantType = cat;
        }
    });

    // Update local state for recipient if changed
    if (newRecipientId !== undefined) {
        const matchingRecipient = newRecipientId
            ? STATE.recipients.find(r => r.id === newRecipientId)
            : null;

        STATE.allTxns.forEach(t => {
            if (t.raw.toLowerCase() === raw.toLowerCase()) {
                t.recipient = matchingRecipient ? { ...matchingRecipient, matchType: 'manual' } : null;
                t.resolvedName = matchingRecipient?.shortName || null;
                t.resolvedLongName = matchingRecipient?.longName || null;
            }
        });
    }

    // Re-detect patterns so insights reflect the new category
    if (typeof detectPatterns === 'function') detectPatterns();

    closeCatModal();
    filterAndRender();

    // Sync to MerchantMap via Supabase (fire and forget)
    try {
        const { data: session } = await supabaseClient.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) throw new Error('Not authenticated');

        await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-learn`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                counterparty: raw,
                merchantType: cat,
                consolidated: name,
                previousType: STATE.catTargetPreviousType || null
            })
        });
        STATE.catTargetPreviousType = null;
    } catch (_err) {
        // Silently fail — local mapping is already saved
    }

    // Update recipient_id in DB if changed (fire and forget)
    if (newRecipientId !== undefined) {
        try {
            const dbIds = STATE.allTxns
                .filter(t => t.raw.toLowerCase() === raw.toLowerCase() && t.dbId)
                .map(t => t.dbId);
            if (dbIds.length > 0) {
                await supabaseClient
                    .from('raw_ledger')
                    .update({ recipient_id: newRecipientId || null })
                    .in('id', dbIds);
            }
        } catch (_err) {
            // Silently fail — local state already updated
        }
    }
}

export function updateCatDropdowns(STATE, escapeHtml) {
    const cats = Array.from(STATE.categories).filter(c => c !== 'Uncategorized').sort();

    const catModalCat = document.getElementById('catModalCat');
    if (catModalCat) {
        catModalCat.innerHTML = cats.map(c =>
            `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`
        ).join('');
    }

    const txnFilter = document.getElementById('txnFilter');
    if (txnFilter) {
        txnFilter.innerHTML = '<option value="">All Categories</option>' +
            Array.from(STATE.categories).sort().map(c =>
                `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`
            ).join('');
    }
}

// ============== ALL TRANSACTIONS MODAL ==============

export function openTxnModal(STATE, renderTxnModal) {
    document.getElementById('txnModalCount').textContent = `${STATE.filtered.length} transactions`;
    document.getElementById('txnSearch').value = '';
    document.getElementById('txnFilter').value = '';
    renderTxnModal(STATE.filtered);
    document.getElementById('txnModal').classList.remove('hidden');
}

export function closeTxnModal() {
    document.getElementById('txnModal').classList.add('hidden');
}

export function filterTxnModal(STATE, renderTxnModal) {
    const search = document.getElementById('txnSearch').value.toLowerCase();
    const cat = document.getElementById('txnFilter').value;

    let txns = STATE.filtered;
    if (search) txns = txns.filter(t => t.display.toLowerCase().includes(search) || t.raw.toLowerCase().includes(search) || (t.counterparty && t.counterparty.toLowerCase().includes(search)));
    if (cat) txns = txns.filter(t => t.merchantType === cat);

    document.getElementById('txnModalCount').textContent = `${txns.length} transactions`;
    renderTxnModal(txns);
}

export function renderTxnModal(txns, renderTxnRow) {
    document.getElementById('txnModalList').innerHTML = txns.slice(0, 100).map(t => renderTxnRow(t)).join('');
}
