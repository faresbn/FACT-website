// ─── RECIPIENTS MANAGEMENT ──────────────────────────────────────

import { normalizePhone } from './data.js';

// ============== RECIPIENTS MANAGEMENT ==============

export function renderRecipientsList(STATE, callbacks) {
    const { escapeHtml } = callbacks;

    const container = document.getElementById('recipientsList');
    if (!container) return;

    const searchTerm = (document.getElementById('recipientSearch')?.value || '').toLowerCase();
    let recipients = STATE.recipients || [];

    if (searchTerm) {
        recipients = recipients.filter(r =>
            r.shortName?.toLowerCase().includes(searchTerm) ||
            r.longName?.toLowerCase().includes(searchTerm) ||
            r.phone?.includes(searchTerm) ||
            r.bankAccount?.toLowerCase().includes(searchTerm)
        );
    }

    if (recipients.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8">
                <div class="text-3xl mb-2">people</div>
                <p class="text-sm text-fact-muted dark:text-fact-dark-muted">
                    ${searchTerm ? 'No contacts match your search' : 'No contacts added yet'}
                </p>
                <p class="text-xs text-fact-muted dark:text-fact-dark-muted mt-1">
                    Add contacts to see friendly names on transfers
                </p>
            </div>
        `;
        return;
    }

    container.innerHTML = recipients.map((r, i) => `
        <div class="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-xl group">
            <div class="flex-1 min-w-0">
                <div class="font-medium text-sm truncate">${escapeHtml(r.shortName || 'Unnamed')}</div>
                ${r.longName ? `<div class="text-xs text-fact-muted truncate">${escapeHtml(r.longName)}</div>` : ''}
                <div class="flex gap-3 mt-1 text-[10px] text-fact-muted">
                    ${r.phone ? `<span>phone ${escapeHtml(r.phone)}</span>` : ''}
                    ${r.bankAccount ? `<span>bank ...${escapeHtml(r.bankAccount.slice(-4))}</span>` : ''}
                </div>
            </div>
            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                <button onclick="editRecipient(${i})" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition" aria-label="Edit contact">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                    </svg>
                </button>
                <button onclick="deleteRecipient(${i})" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-fact-red/10 text-fact-muted hover:text-fact-red transition" aria-label="Delete contact">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

export function filterRecipientsList(STATE, callbacks) {
    renderRecipientsList(STATE, callbacks);
}

export function addNewRecipient() {
    document.getElementById('recipientModalTitle').textContent = 'Add Contact';
    document.getElementById('recipientEditIndex').value = '-1';
    document.getElementById('recipientPhone').value = '';
    document.getElementById('recipientBankAccount').value = '';
    document.getElementById('recipientShortName').value = '';
    document.getElementById('recipientLongName').value = '';
    document.getElementById('recipientModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('recipientShortName')?.focus(), 100);
}

export function editRecipient(index, STATE) {
    const recipient = STATE.recipients[index];
    if (!recipient) return;

    document.getElementById('recipientModalTitle').textContent = 'Edit Contact';
    document.getElementById('recipientEditIndex').value = index;
    document.getElementById('recipientPhone').value = recipient.phone || '';
    document.getElementById('recipientBankAccount').value = recipient.bankAccount || '';
    document.getElementById('recipientShortName').value = recipient.shortName || '';
    document.getElementById('recipientLongName').value = recipient.longName || '';
    document.getElementById('recipientModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('recipientShortName')?.focus(), 100);
}

export function closeRecipientModal() {
    document.getElementById('recipientModal').classList.add('hidden');
}

export async function saveRecipient(STATE, supabaseClient, CONFIG, callbacks) {
    const { showToast, renderRecipientsList } = callbacks;

    const index = parseInt(document.getElementById('recipientEditIndex').value);
    const phone = document.getElementById('recipientPhone').value.trim();
    const bankAccount = document.getElementById('recipientBankAccount').value.trim();
    const shortName = document.getElementById('recipientShortName').value.trim();
    const longName = document.getElementById('recipientLongName').value.trim();

    if (!shortName) {
        showToast('Short name is required', 'error');
        document.getElementById('recipientShortName')?.focus();
        return;
    }

    if (!phone && !bankAccount) {
        showToast('Phone or bank account is required', 'error');
        return;
    }

    try {
        const { data: session } = await supabaseClient.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) throw new Error('Not authenticated');

        const existing = index >= 0 ? STATE.recipients[index] : null;
        const response = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-recipients`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                subAction: index >= 0 ? 'update' : 'add',
                data: {
                    id: existing?.id || null,
                    phone: phone,
                    bankAccount: bankAccount,
                    shortName: shortName,
                    longName: longName
                }
            })
        });

        const result = await response.json();
        if (result.error) throw new Error(result.error);

        const newRecipient = {
            id: existing?.id || result.id || null,
            phone: normalizePhone(phone),
            bankAccount: bankAccount,
            shortName: shortName,
            longName: longName
        };

        if (index >= 0) {
            STATE.recipients[index] = newRecipient;
            showToast('Contact updated', 'success');
        } else {
            STATE.recipients.push(newRecipient);
            showToast('Contact added', 'success');
        }

        closeRecipientModal();
        renderRecipientsList();

    } catch (err) {
        // Save failed — user notified via toast
        showToast('Failed to save: ' + err.message, 'error');
    }
}

export async function deleteRecipient(index, STATE, supabaseClient, CONFIG, callbacks) {
    const { showToast, showConfirm, renderRecipientsList } = callbacks;

    const recipient = STATE.recipients[index];
    if (!recipient) return;

    const confirmed = await showConfirm({
        title: 'Delete Contact',
        message: `Remove ${recipient.shortName}?`,
        confirmText: 'Delete',
        cancelText: 'Keep',
        type: 'danger'
    });

    if (!confirmed) return;

    try {
        const { data: session } = await supabaseClient.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) throw new Error('Not authenticated');

        const response = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-recipients`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                subAction: 'delete',
                data: { id: recipient.id }
            })
        });

        const result = await response.json();
        if (result.error) throw new Error(result.error);

        STATE.recipients.splice(index, 1);
        showToast(`Removed ${recipient.shortName}`, 'info');
        renderRecipientsList();

    } catch (err) {
        // Delete failed — user notified via toast
        showToast('Failed to delete: ' + err.message, 'error');
    }
}

// ============== PEOPLE PANEL (Transfer Contacts Overview) ==============
// Note: All HTML rendered via innerHTML uses escapeHtml() on user-supplied data
// to prevent XSS. This follows the same pattern used across the entire codebase.

// Check if a transaction is a transfer (person-to-person money movement)
function isTransferTxn(t) {
    return t.merchantType === 'Transfer' || t.merchantType === 'Family' ||
        ['transfer', 'fawran', 'internal transfer'].some(k =>
            (t.txnType || '').toLowerCase().includes(k) || t.raw.toLowerCase().includes(k)
        );
}

// Group all transfer transactions by recipient
function groupTransfersByPerson(STATE) {
    const transfers = STATE.allTxns.filter(isTransferTxn);

    const matched = {};   // recipientId -> { recipient, txns[], totalIn, totalOut }
    const unmatched = [];  // txns with no recipient match

    for (const t of transfers) {
        if (t.recipient?.id) {
            const id = t.recipient.id;
            if (!matched[id]) {
                matched[id] = { recipient: t.recipient, txns: [], totalIn: 0, totalOut: 0 };
            }
            matched[id].txns.push(t);
            if (t.direction === 'IN') matched[id].totalIn += t.amount;
            else matched[id].totalOut += t.amount;
        } else {
            unmatched.push(t);
        }
    }

    // Sort matched people by most recent transaction
    const people = Object.values(matched).sort((a, b) => {
        const aLatest = Math.max(...a.txns.map(t => t.date.valueOf()));
        const bLatest = Math.max(...b.txns.map(t => t.date.valueOf()));
        return bLatest - aLatest;
    });

    // Group unmatched by counterparty text (collapse same counterparty)
    const unmatchedGroups = {};
    for (const t of unmatched) {
        const key = (t.counterparty || t.display || t.raw).toLowerCase().trim();
        if (!unmatchedGroups[key]) {
            unmatchedGroups[key] = { label: t.counterparty || t.display || t.raw, txns: [], totalIn: 0, totalOut: 0 };
        }
        unmatchedGroups[key].txns.push(t);
        if (t.direction === 'IN') unmatchedGroups[key].totalIn += t.amount;
        else unmatchedGroups[key].totalOut += t.amount;
    }

    const unmatchedPeople = Object.values(unmatchedGroups).sort((a, b) => {
        const aLatest = Math.max(...a.txns.map(t => t.date.valueOf()));
        const bLatest = Math.max(...b.txns.map(t => t.date.valueOf()));
        return bLatest - aLatest;
    });

    return { people, unmatchedPeople, totalTransfers: transfers.length };
}

// Extract phone/account from counterparty text for pre-filling
function extractIdentifier(counterparty) {
    if (!counterparty) return { phone: '', bankAccount: '', guessedName: '' };
    const digits = counterparty.replace(/\D/g, '');
    // IBAN pattern
    const ibanMatch = counterparty.match(/[A-Z]{2}\d{2}[A-Z0-9]{4,}/i);
    if (ibanMatch) return { phone: '', bankAccount: ibanMatch[0], guessedName: '' };
    // Phone-like (7-10 digits)
    if (digits.length >= 7 && digits.length <= 12) return { phone: digits, bankAccount: '', guessedName: '' };
    // Probably a name
    return { phone: '', bankAccount: '', guessedName: counterparty };
}

export function openPeoplePanel(STATE, callbacks) {
    const { formatNum, escapeHtml } = callbacks;
    const { people, unmatchedPeople, totalTransfers } = groupTransfersByPerson(STATE);

    const panel = document.getElementById('peoplePanel');
    const backdrop = document.getElementById('peoplePanelBackdrop');
    if (!panel || !backdrop) return;

    document.getElementById('peoplePanelCount').textContent =
        `${people.length} contacts, ${totalTransfers} transfers`;

    const searchInput = document.getElementById('peoplePanelSearch');
    if (searchInput) searchInput.value = '';

    renderPeopleList(people, unmatchedPeople, STATE, callbacks);

    backdrop.classList.add('open');
    panel.classList.add('open');
}

export function closePeoplePanel() {
    document.getElementById('peoplePanelBackdrop')?.classList.remove('open');
    document.getElementById('peoplePanel')?.classList.remove('open');
}

export function filterPeoplePanel(STATE, callbacks) {
    const { people, unmatchedPeople } = groupTransfersByPerson(STATE);
    renderPeopleList(people, unmatchedPeople, STATE, callbacks);
}

function renderPeopleList(people, unmatchedPeople, STATE, callbacks) {
    const { formatNum, escapeHtml } = callbacks;
    const container = document.getElementById('peoplePanelList');
    if (!container) return;

    const searchTerm = (document.getElementById('peoplePanelSearch')?.value || '').toLowerCase();

    let filteredPeople = people;
    let filteredUnmatched = unmatchedPeople;

    if (searchTerm) {
        filteredPeople = people.filter(p =>
            p.recipient.shortName?.toLowerCase().includes(searchTerm) ||
            p.recipient.longName?.toLowerCase().includes(searchTerm) ||
            p.recipient.phone?.includes(searchTerm) ||
            p.recipient.bankAccount?.toLowerCase().includes(searchTerm)
        );
        filteredUnmatched = unmatchedPeople.filter(g =>
            g.label.toLowerCase().includes(searchTerm)
        );
    }

    let html = '';

    // Matched people
    if (filteredPeople.length > 0) {
        html += filteredPeople.map(p => {
            const r = p.recipient;
            const lastTxn = p.txns[0];
            const lastDate = lastTxn ? lastTxn.date.format('MMM D') : '';
            const net = p.totalIn - p.totalOut;
            const netLabel = net >= 0 ? `+${formatNum(net)}` : `-${formatNum(Math.abs(net))}`;
            const netColor = net >= 0 ? 'text-fact-green' : 'text-fact-red';
            const safeId = escapeHtml(r.id);

            return `
                <div class="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl transition" onclick="openPersonDrilldown('${safeId}')">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-10 h-10 rounded-full bg-[#8D6E63]/15 flex items-center justify-center text-sm flex-shrink-0 font-medium" style="color:#8D6E63">
                            ${escapeHtml((r.shortName || '?')[0].toUpperCase())}
                        </div>
                        <div class="min-w-0">
                            <div class="font-medium text-sm truncate">${escapeHtml(r.shortName)}</div>
                            <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted">
                                ${p.txns.length} transfer${p.txns.length !== 1 ? 's' : ''} &middot; Last ${escapeHtml(lastDate)}
                            </div>
                        </div>
                    </div>
                    <div class="text-right flex-shrink-0 ml-2">
                        <div class="font-display font-semibold text-sm ${netColor}">${escapeHtml(netLabel)}</div>
                        <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted">
                            ${p.totalOut > 0 ? `sent ${escapeHtml(formatNum(p.totalOut))}` : ''}${p.totalOut > 0 && p.totalIn > 0 ? ' / ' : ''}${p.totalIn > 0 ? `got ${escapeHtml(formatNum(p.totalIn))}` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Unmatched transfers
    if (filteredUnmatched.length > 0) {
        html += `
            <div class="mt-4 mb-2 px-4">
                <p class="text-xs font-medium text-fact-muted dark:text-fact-dark-muted uppercase tracking-wider">
                    Unmatched Transfers (${filteredUnmatched.reduce((s, g) => s + g.txns.length, 0)})
                </p>
            </div>
        `;

        html += filteredUnmatched.map(g => {
            const lastTxn = g.txns[0];
            const lastDate = lastTxn ? lastTxn.date.format('MMM D') : '';
            const net = g.totalIn - g.totalOut;
            const netLabel = net >= 0 ? `+${formatNum(net)}` : `-${formatNum(Math.abs(net))}`;
            const netColor = net >= 0 ? 'text-fact-green' : 'text-fact-red';
            const safeLabel = btoa(unescape(encodeURIComponent(g.label)));

            return `
                <div class="p-4 flex items-center justify-between rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition group">
                    <div class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer" onclick="openUnmatchedDrilldown('${safeLabel}')">
                        <div class="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm flex-shrink-0 text-fact-muted">
                            ?
                        </div>
                        <div class="min-w-0">
                            <div class="font-medium text-sm truncate">${escapeHtml(g.label)}</div>
                            <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted">
                                ${g.txns.length} transfer${g.txns.length !== 1 ? 's' : ''} &middot; Last ${escapeHtml(lastDate)}
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <div class="text-right flex-shrink-0">
                            <div class="font-display font-semibold text-sm ${netColor}">${escapeHtml(netLabel)}</div>
                        </div>
                        <button onclick="assignUnmatchedTransfer('${safeLabel}')" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-fact-yellow/20 text-fact-muted hover:text-fact-ink transition opacity-0 group-hover:opacity-100 flex-shrink-0" aria-label="Assign to contact" title="Assign to contact">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    if (!html) {
        html = `
            <div class="text-center py-12">
                <p class="text-sm text-fact-muted dark:text-fact-dark-muted">
                    ${searchTerm ? 'No matches found' : 'No transfers yet'}
                </p>
            </div>
        `;
    }

    container.innerHTML = html;
}

// Open person drilldown (all transfers for a specific contact)
export function openPersonDrilldown(recipientId, STATE, callbacks) {
    const { formatNum, escapeHtml, renderTxnRow } = callbacks;

    const recipient = STATE.recipients.find(r => r.id === recipientId);
    if (!recipient) return;

    const transfers = STATE.allTxns.filter(t => t.recipient?.id === recipientId);
    const totalIn = transfers.filter(t => t.direction === 'IN').reduce((s, t) => s + t.amount, 0);
    const totalOut = transfers.filter(t => t.direction === 'OUT').reduce((s, t) => s + t.amount, 0);

    // Re-show the timeline area in case it was hidden by a previous person drilldown
    const timelineContainer = document.getElementById('drilldownTimeline')?.parentElement;
    if (timelineContainer) timelineContainer.style.display = '';

    // Populate drilldown (reuse the existing drilldown panel)
    document.getElementById('drilldownTitle').textContent = recipient.shortName;
    const subtitle = [
        transfers.length + ' transfer' + (transfers.length !== 1 ? 's' : ''),
        recipient.phone ? `Phone: ${recipient.phone}` : null,
        recipient.bankAccount ? `Acct: ...${recipient.bankAccount.slice(-4)}` : null,
    ].filter(Boolean).join(' \u00b7 ');
    document.getElementById('drilldownSubtitle').textContent = subtitle;

    const net = totalIn - totalOut;
    document.getElementById('drilldownTotal').textContent = `QAR ${formatNum(Math.abs(net))}`;
    document.getElementById('drilldownDelta').textContent = net >= 0 ? 'Net received' : 'Net sent';
    document.getElementById('drilldownDelta').className = `font-display font-bold text-lg ${net >= 0 ? 'text-fact-green' : 'text-fact-red'}`;

    // Stats
    document.getElementById('drilldownMerchants').innerHTML = `
        <div class="grid grid-cols-3 gap-3">
            <div class="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mb-1">Sent</div>
                <div class="font-display font-bold text-fact-red">${escapeHtml(formatNum(totalOut))}</div>
            </div>
            <div class="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mb-1">Received</div>
                <div class="font-display font-bold text-fact-green">${escapeHtml(formatNum(totalIn))}</div>
            </div>
            <div class="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mb-1">Transfers</div>
                <div class="font-display font-bold">${transfers.length}</div>
            </div>
        </div>
    `;

    // Transaction list (show all, not just filtered period)
    document.getElementById('drilldownTxns').innerHTML = transfers.slice(0, 50).map(t => renderTxnRow(t)).join('');

    document.getElementById('drilldownBackdrop').classList.add('open');
    document.getElementById('drilldownModal').classList.add('open');
}

// Open drilldown for unmatched transfers grouped by counterparty
export function openUnmatchedDrilldown(encodedLabel, STATE, callbacks) {
    const { formatNum, escapeHtml, renderTxnRow } = callbacks;
    const label = decodeURIComponent(escape(atob(encodedLabel)));

    const transfers = STATE.allTxns.filter(t => {
        if (!isTransferTxn(t)) return false;
        if (t.recipient?.id) return false;
        const cpText = (t.counterparty || t.display || t.raw).toLowerCase().trim();
        return cpText === label.toLowerCase().trim();
    });

    if (transfers.length === 0) return;

    // Re-show the timeline area in case it was hidden
    const timelineContainer = document.getElementById('drilldownTimeline')?.parentElement;
    if (timelineContainer) timelineContainer.style.display = '';

    const totalIn = transfers.filter(t => t.direction === 'IN').reduce((s, t) => s + t.amount, 0);
    const totalOut = transfers.filter(t => t.direction === 'OUT').reduce((s, t) => s + t.amount, 0);

    document.getElementById('drilldownTitle').textContent = label;
    document.getElementById('drilldownSubtitle').textContent = `${transfers.length} unmatched transfer${transfers.length !== 1 ? 's' : ''}`;

    const net = totalIn - totalOut;
    document.getElementById('drilldownTotal').textContent = `QAR ${formatNum(Math.abs(net))}`;
    document.getElementById('drilldownDelta').textContent = net >= 0 ? 'Net received' : 'Net sent';
    document.getElementById('drilldownDelta').className = `font-display font-bold text-lg ${net >= 0 ? 'text-fact-green' : 'text-fact-red'}`;

    const safeLabel = btoa(unescape(encodeURIComponent(label)));
    document.getElementById('drilldownMerchants').innerHTML = `
        <div class="grid grid-cols-3 gap-3">
            <div class="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mb-1">Sent</div>
                <div class="font-display font-bold text-fact-red">${escapeHtml(formatNum(totalOut))}</div>
            </div>
            <div class="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mb-1">Received</div>
                <div class="font-display font-bold text-fact-green">${escapeHtml(formatNum(totalIn))}</div>
            </div>
            <div class="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mb-1">Transfers</div>
                <div class="font-display font-bold">${transfers.length}</div>
            </div>
        </div>
        <button onclick="assignUnmatchedTransfer('${safeLabel}')"
            class="w-full mt-3 px-4 py-3 text-sm font-medium text-fact-ink bg-fact-yellow rounded-xl hover:bg-fact-yellow/80 transition">
            Assign to Contact
        </button>
    `;

    document.getElementById('drilldownTxns').innerHTML = transfers.slice(0, 50).map(t => renderTxnRow(t)).join('');

    document.getElementById('drilldownBackdrop').classList.add('open');
    document.getElementById('drilldownModal').classList.add('open');
}

// Assign unmatched transfers to an existing or new contact
export function assignUnmatchedTransfer(encodedLabel) {
    const label = decodeURIComponent(escape(atob(encodedLabel)));
    const { phone, bankAccount, guessedName } = extractIdentifier(label);

    // Open the recipient modal pre-filled with what we can extract
    document.getElementById('recipientModalTitle').textContent = 'Assign to Contact';
    document.getElementById('recipientEditIndex').value = '-1';
    document.getElementById('recipientPhone').value = phone;
    document.getElementById('recipientBankAccount').value = bankAccount;
    document.getElementById('recipientShortName').value = guessedName;
    document.getElementById('recipientLongName').value = guessedName ? label : '';

    // Store the source label so after save we can re-match
    document.getElementById('recipientModal').dataset.assignSource = label;

    document.getElementById('recipientModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('recipientShortName')?.focus(), 100);
}

// Enhanced save that re-matches transactions after assigning
export async function saveRecipientAndRematch(STATE, supabaseClient, CONFIG, callbacks) {
    const { showToast, renderRecipientsList, filterAndRender, matchRecipient: matchRecipientFn } = callbacks;

    const modal = document.getElementById('recipientModal');
    const assignSource = modal?.dataset.assignSource || null;

    // Delegate to normal save
    await saveRecipient(STATE, supabaseClient, CONFIG, { showToast, renderRecipientsList });

    // After save, re-match all transfer transactions against the updated recipients list
    let changed = 0;
    for (const t of STATE.allTxns) {
        if (!isTransferTxn(t)) continue;
        if (t.recipient?.matchType === 'manual') continue; // don't override manual assignments

        const newMatch = matchRecipientFn(t.counterparty) || matchRecipientFn(t.raw);
        if (newMatch && newMatch.id !== t.recipient?.id) {
            t.recipient = newMatch;
            t.resolvedName = newMatch.shortName;
            t.resolvedLongName = newMatch.longName;
            changed++;
        }
    }

    if (changed > 0) {
        showToast(`Matched ${changed} transfer${changed !== 1 ? 's' : ''} to this contact`, 'success');
        if (filterAndRender) filterAndRender();
    }

    // Clear the assign source
    if (modal) delete modal.dataset.assignSource;
}
