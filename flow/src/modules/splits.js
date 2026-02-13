// ─── SPLITS SYSTEM ──────────────────────────────────────────────
// Note: All HTML rendered via innerHTML uses escapeHtml() on user-supplied data
// to prevent XSS. This follows the same pattern used across the entire codebase
// (see recipients.js, goals.js, features.js for identical usage).
import dayjs from 'dayjs';

// ============== HELPERS ==============

function getAccessToken(supabaseClient) {
    return supabaseClient.auth.getSession().then(({ data }) => data?.session?.access_token);
}

async function splitsApi(subAction, data, supabaseClient, CONFIG) {
    const accessToken = await getAccessToken(supabaseClient);
    if (!accessToken) throw new Error('Not authenticated');

    const response = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-splits`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ subAction, data })
    });

    if (response.status === 429) throw new Error('Too many requests. Please slow down.');
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    return result;
}

// Compute summary stats from splits array
function computeSplitsSummary(splits) {
    let totalOwed = 0;
    let totalSettled = 0;
    let activeSplits = 0;

    for (const split of splits) {
        if (split.status === 'cancelled') continue;
        if (split.status === 'active') activeSplits++;

        for (const item of (split.split_items || [])) {
            for (const p of (item.split_participants || [])) {
                if (p.is_self) continue;
                totalOwed += Number(p.computed_amount) || 0;
                totalSettled += Number(p.amount_settled) || 0;
            }
        }
    }

    return {
        totalOwed,
        totalSettled,
        outstanding: totalOwed - totalSettled,
        activeSplits,
        totalSplits: splits.length
    };
}

// Get display name for a participant
function participantName(p, recipients) {
    if (p.is_self) return 'You';
    if (p.recipient_id) {
        const r = recipients.find(r => r.id === p.recipient_id);
        if (r) return r.shortName || r.longName || 'Unknown';
    }
    return p.ad_hoc_name || 'Unknown';
}

// ============== SPLITS PANEL ==============

export function openSplitsPanel(STATE, callbacks) {
    const panel = document.getElementById('splitsPanel');
    const backdrop = document.getElementById('splitsPanelBackdrop');
    if (!panel || !backdrop) return;

    renderSplitsList(STATE, callbacks);

    backdrop.classList.add('open');
    panel.classList.add('open');
}

export function closeSplitsPanel() {
    document.getElementById('splitsPanelBackdrop')?.classList.remove('open');
    document.getElementById('splitsPanel')?.classList.remove('open');
}

export function renderSplitsList(STATE, callbacks) {
    const { formatNum, escapeHtml } = callbacks;
    const container = document.getElementById('splitsPanelList');
    if (!container) return;

    const splits = STATE.splits || [];
    const searchTerm = (document.getElementById('splitsPanelSearch')?.value || '').toLowerCase();

    let filtered = splits;
    if (searchTerm) {
        filtered = splits.filter(s =>
            s.title.toLowerCase().includes(searchTerm) ||
            (s.description || '').toLowerCase().includes(searchTerm)
        );
    }

    if (filtered.length === 0) {
        container.textContent = '';
        const empty = document.createElement('div');
        empty.className = 'text-center py-12';

        const icon = document.createElement('div');
        icon.className = 'text-4xl mb-3 opacity-50';
        icon.textContent = '\u2702\uFE0F';
        empty.appendChild(icon);

        const msg = document.createElement('p');
        msg.className = 'text-sm text-fact-muted dark:text-fact-dark-muted';
        msg.textContent = searchTerm ? 'No splits match your search' : 'No splits yet';
        empty.appendChild(msg);

        const sub = document.createElement('p');
        sub.className = 'text-xs text-fact-muted dark:text-fact-dark-muted mt-1';
        sub.textContent = 'Split expenses with friends and track who owes what';
        empty.appendChild(sub);

        if (!searchTerm) {
            const btn = document.createElement('button');
            btn.className = 'mt-4 px-4 py-2 text-sm font-medium bg-fact-yellow text-fact-ink rounded-xl hover:bg-fact-yellow/80 transition';
            btn.textContent = 'Create First Split';
            btn.onclick = () => window.openCreateSplit();
            empty.appendChild(btn);
        }

        container.appendChild(empty);
        return;
    }

    // Group by status
    const active = filtered.filter(s => s.status === 'active');
    const settled = filtered.filter(s => s.status === 'settled');
    const cancelled = filtered.filter(s => s.status === 'cancelled');

    const frag = document.createDocumentFragment();

    function addSection(label, items) {
        if (items.length === 0) return;
        const header = document.createElement('div');
        header.className = 'mb-2 px-1' + (label !== 'Active' ? ' mt-4' : '');
        const p = document.createElement('p');
        p.className = 'text-xs font-medium text-fact-muted dark:text-fact-dark-muted uppercase tracking-wider';
        p.textContent = `${label} (${items.length})`;
        header.appendChild(p);
        frag.appendChild(header);

        for (const s of items) {
            frag.appendChild(buildSplitCard(s, STATE, callbacks));
        }
    }

    addSection('Active', active);
    addSection('Settled', settled);
    addSection('Cancelled', cancelled);

    container.textContent = '';
    container.appendChild(frag);
}

function buildSplitCard(split, STATE, callbacks) {
    const { formatNum, escapeHtml } = callbacks;
    const recipients = STATE.recipients || [];

    const items = split.split_items || [];
    const allParticipants = items.flatMap(i => i.split_participants || []);
    const nonSelf = allParticipants.filter(p => !p.is_self);
    const totalOwed = nonSelf.reduce((s, p) => s + (Number(p.computed_amount) || 0), 0);
    const totalSettled = nonSelf.reduce((s, p) => s + (Number(p.amount_settled) || 0), 0);
    const pct = totalOwed > 0 ? Math.min(100, (totalSettled / totalOwed) * 100) : 100;
    const outstanding = totalOwed - totalSettled;

    const date = dayjs(split.split_date).format('MMM D');
    const names = [...new Set(nonSelf.map(p => participantName(p, recipients)))];
    const namesStr = names.length <= 3
        ? names.join(', ')
        : names.slice(0, 2).join(', ') + ` +${names.length - 2}`;

    const barColor = pct >= 100 ? '#75B876' : pct > 50 ? '#F4C44E' : '#E57373';

    const card = document.createElement('div');
    card.className = 'p-4 mb-2 bg-gray-50 dark:bg-gray-800 rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/80 transition';
    card.onclick = () => window.openSplitDetail(split.id);

    // Header row
    const headerRow = document.createElement('div');
    headerRow.className = 'flex items-start justify-between mb-2';

    const titleArea = document.createElement('div');
    titleArea.className = 'min-w-0 flex-1';
    const titleEl = document.createElement('div');
    titleEl.className = 'font-medium text-sm truncate';
    titleEl.textContent = split.title;
    titleArea.appendChild(titleEl);
    const metaEl = document.createElement('div');
    metaEl.className = 'text-[10px] text-fact-muted dark:text-fact-dark-muted mt-0.5';
    metaEl.textContent = `${date} \u00b7 ${items.length} item${items.length !== 1 ? 's' : ''} \u00b7 ${namesStr}`;
    titleArea.appendChild(metaEl);
    headerRow.appendChild(titleArea);

    const statusBadge = document.createElement('span');
    const statusColors = {
        active: 'bg-fact-yellow/20 text-fact-yellow',
        settled: 'bg-fact-green/20 text-fact-green',
        cancelled: 'bg-gray-200 dark:bg-gray-700 text-fact-muted'
    };
    statusBadge.className = `text-[10px] px-2 py-0.5 rounded-full ${statusColors[split.status] || statusColors.active} font-medium ml-2 flex-shrink-0`;
    statusBadge.textContent = split.status;
    headerRow.appendChild(statusBadge);
    card.appendChild(headerRow);

    // Amounts row
    const amountRow = document.createElement('div');
    amountRow.className = 'flex items-baseline justify-between mb-1.5';
    const totalEl = document.createElement('span');
    totalEl.className = 'font-display font-bold text-sm';
    totalEl.textContent = `QAR ${formatNum(split.total_amount)}`;
    amountRow.appendChild(totalEl);
    const outstandingEl = document.createElement('span');
    outstandingEl.className = outstanding > 0 ? 'text-xs text-fact-red font-medium' : 'text-xs text-fact-green font-medium';
    outstandingEl.textContent = outstanding > 0 ? `${formatNum(outstanding)} outstanding` : 'Fully settled';
    amountRow.appendChild(outstandingEl);
    card.appendChild(amountRow);

    // Progress bar
    const barOuter = document.createElement('div');
    barOuter.className = 'w-full h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden';
    const barInner = document.createElement('div');
    barInner.className = 'h-full rounded-full transition-all';
    barInner.style.width = pct + '%';
    barInner.style.background = barColor;
    barOuter.appendChild(barInner);
    card.appendChild(barOuter);

    return card;
}

// ============== SPLIT DETAIL ==============

export function openSplitDetail(splitId, STATE, callbacks) {
    const { formatNum, escapeHtml } = callbacks;
    const split = (STATE.splits || []).find(s => s.id === splitId);
    if (!split) return;

    const recipients = STATE.recipients || [];
    const panel = document.getElementById('splitDetailPanel');
    const backdrop = document.getElementById('splitDetailBackdrop');
    if (!panel || !backdrop) return;

    panel.dataset.splitId = splitId;

    document.getElementById('splitDetailTitle').textContent = split.title;
    document.getElementById('splitDetailDate').textContent = dayjs(split.split_date).format('MMM D, YYYY');
    document.getElementById('splitDetailTotal').textContent = `QAR ${formatNum(split.total_amount)}`;

    const statusEl = document.getElementById('splitDetailStatus');
    statusEl.textContent = split.status;
    statusEl.className = `text-[10px] px-2 py-0.5 rounded-full font-medium ${
        split.status === 'active' ? 'bg-fact-yellow/20 text-fact-yellow' :
        split.status === 'settled' ? 'bg-fact-green/20 text-fact-green' :
        'bg-gray-200 dark:bg-gray-700 text-fact-muted'
    }`;

    // Build items using DOM methods
    const itemsContainer = document.getElementById('splitDetailItems');
    itemsContainer.textContent = '';
    const items = split.split_items || [];

    for (const item of items) {
        const participants = item.split_participants || [];
        const itemCard = document.createElement('div');
        itemCard.className = 'p-3 bg-gray-50 dark:bg-gray-800 rounded-xl mb-2';

        // Item header
        const itemHeader = document.createElement('div');
        itemHeader.className = 'flex items-center justify-between mb-2';
        const itemTitle = document.createElement('span');
        itemTitle.className = 'font-medium text-sm';
        itemTitle.textContent = item.title;
        itemHeader.appendChild(itemTitle);
        const itemAmt = document.createElement('span');
        itemAmt.className = 'font-display font-bold text-sm';
        itemAmt.textContent = `QAR ${formatNum(item.amount)}`;
        itemHeader.appendChild(itemAmt);
        itemCard.appendChild(itemHeader);

        // Participants
        const partList = document.createElement('div');
        partList.className = 'space-y-1.5';

        for (const p of participants) {
            const name = participantName(p, recipients);
            const owed = Number(p.computed_amount) || 0;
            const paid = Number(p.amount_settled) || 0;
            const isSettled = p.settled_at || (paid >= owed && !p.is_self);

            const row = document.createElement('div');
            row.className = 'flex items-center justify-between text-xs';

            const left = document.createElement('div');
            left.className = 'flex items-center gap-2 min-w-0';

            const avatar = document.createElement('span');
            avatar.className = `w-6 h-6 rounded-full ${p.is_self ? 'bg-fact-yellow/20' : 'bg-gray-200 dark:bg-gray-700'} flex items-center justify-center text-[10px] flex-shrink-0`;
            avatar.textContent = name[0].toUpperCase();
            left.appendChild(avatar);

            const nameEl = document.createElement('span');
            nameEl.className = 'truncate';
            nameEl.textContent = name;
            left.appendChild(nameEl);

            if (!p.is_self && !p.recipient_id && p.ad_hoc_name) {
                const unlinked = document.createElement('span');
                unlinked.className = 'text-[10px] text-fact-muted';
                unlinked.textContent = '(unlinked)';
                left.appendChild(unlinked);
            }

            row.appendChild(left);

            const right = document.createElement('div');
            right.className = 'flex items-center gap-2 flex-shrink-0';
            const amtEl = document.createElement('span');
            amtEl.className = `font-display ${isSettled && !p.is_self ? 'text-fact-green' : ''}`;
            amtEl.textContent = formatNum(owed);
            right.appendChild(amtEl);

            if (!p.is_self) {
                if (isSettled) {
                    const check = document.createElement('span');
                    check.className = 'text-[10px] text-fact-green';
                    check.textContent = '\u2713';
                    right.appendChild(check);
                } else {
                    const settleBtn = document.createElement('button');
                    settleBtn.className = 'text-[10px] px-2 py-0.5 rounded-full bg-fact-yellow/20 text-fact-yellow hover:bg-fact-yellow/40 transition';
                    settleBtn.textContent = 'Settle';
                    settleBtn.onclick = (e) => {
                        e.stopPropagation();
                        window.openSettleModal(p.id, owed, paid);
                    };
                    right.appendChild(settleBtn);
                }
            } else {
                const youLabel = document.createElement('span');
                youLabel.className = 'text-[10px] text-fact-muted';
                youLabel.textContent = 'you';
                right.appendChild(youLabel);
            }

            row.appendChild(right);
            partList.appendChild(row);
        }

        itemCard.appendChild(partList);
        itemsContainer.appendChild(itemCard);
    }

    // Action buttons
    const actionsEl = document.getElementById('splitDetailActions');
    actionsEl.textContent = '';

    if (split.status === 'active') {
        const suggestBtn = document.createElement('button');
        suggestBtn.className = 'flex-1 px-3 py-2 text-xs font-medium bg-fact-green/10 text-fact-green rounded-xl hover:bg-fact-green/20 transition';
        suggestBtn.textContent = 'Suggest Matches';
        suggestBtn.onclick = () => window.checkSettlementSuggestions(splitId);
        actionsEl.appendChild(suggestBtn);

        const addBtn = document.createElement('button');
        addBtn.className = 'flex-1 px-3 py-2 text-xs font-medium bg-gray-100 dark:bg-gray-700 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition';
        addBtn.textContent = 'Add Item';
        addBtn.onclick = () => window.openAddItemModal(splitId);
        actionsEl.appendChild(addBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'px-3 py-2 text-xs font-medium text-fact-red hover:bg-fact-red/10 rounded-xl transition';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => window.cancelSplit(splitId);
        actionsEl.appendChild(cancelBtn);
    } else {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'px-3 py-2 text-xs font-medium text-fact-red hover:bg-fact-red/10 rounded-xl transition';
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = () => window.deleteSplit(splitId);
        actionsEl.appendChild(deleteBtn);
    }

    backdrop.classList.add('open');
    panel.classList.add('open');
}

export function closeSplitDetail() {
    document.getElementById('splitDetailBackdrop')?.classList.remove('open');
    document.getElementById('splitDetailPanel')?.classList.remove('open');
}

// ============== CREATE SPLIT MODAL ==============

let createSplitItems = [];

export function openCreateSplit(STATE, callbacks) {
    const modal = document.getElementById('createSplitModal');
    if (!modal) return;

    document.getElementById('splitTitle').value = '';
    document.getElementById('splitDescription').value = '';
    document.getElementById('splitDate').value = dayjs().format('YYYY-MM-DD');
    document.getElementById('splitTxnLink').value = '';

    createSplitItems = [{ title: '', amount: '', participants: [] }];
    renderCreateSplitItems(STATE, callbacks);

    modal.classList.remove('hidden');
}

export function closeCreateSplit() {
    document.getElementById('createSplitModal')?.classList.add('hidden');
    createSplitItems = [];
}

export function addSplitItem(STATE, callbacks) {
    createSplitItems.push({ title: '', amount: '', participants: [] });
    renderCreateSplitItems(STATE, callbacks);
}

export function removeSplitItem(index, STATE, callbacks) {
    if (createSplitItems.length <= 1) return;
    createSplitItems.splice(index, 1);
    renderCreateSplitItems(STATE, callbacks);
}

export function addParticipantToItem(itemIndex, STATE, callbacks) {
    createSplitItems[itemIndex].participants.push({
        recipient_id: null,
        ad_hoc_name: '',
        is_self: false,
        share_type: 'equal',
        share_value: null
    });
    renderCreateSplitItems(STATE, callbacks);
}

export function removeParticipantFromItem(itemIndex, partIndex, STATE, callbacks) {
    createSplitItems[itemIndex].participants.splice(partIndex, 1);
    renderCreateSplitItems(STATE, callbacks);
}

export function addSelfToItem(itemIndex, STATE, callbacks) {
    const hasSelf = createSplitItems[itemIndex].participants.some(p => p.is_self);
    if (hasSelf) return;

    createSplitItems[itemIndex].participants.push({
        is_self: true,
        share_type: 'equal',
        share_value: null
    });
    renderCreateSplitItems(STATE, callbacks);
}

function renderCreateSplitItems(STATE, callbacks) {
    const { escapeHtml } = callbacks;
    const container = document.getElementById('splitItemsList');
    if (!container) return;

    const recipients = STATE.recipients || [];
    container.textContent = '';

    createSplitItems.forEach((item, i) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'p-3 bg-gray-50 dark:bg-gray-800 rounded-xl mb-3';
        itemDiv.dataset.itemIndex = i;

        // Item name + amount row
        const topRow = document.createElement('div');
        topRow.className = 'flex items-center gap-2 mb-2';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Item name (e.g. Nespresso Machine)';
        nameInput.value = item.title || '';
        nameInput.className = 'flex-1 px-3 py-2 text-sm rounded-lg border border-fact-border dark:border-fact-dark-border bg-white dark:bg-gray-900 focus:ring-2 focus:ring-fact-yellow/50 outline-none';
        nameInput.onchange = () => { createSplitItems[i].title = nameInput.value; };
        topRow.appendChild(nameInput);

        const amtInput = document.createElement('input');
        amtInput.type = 'number';
        amtInput.placeholder = 'Amount';
        amtInput.value = item.amount || '';
        amtInput.step = '0.01';
        amtInput.className = 'w-28 px-3 py-2 text-sm rounded-lg border border-fact-border dark:border-fact-dark-border bg-white dark:bg-gray-900 focus:ring-2 focus:ring-fact-yellow/50 outline-none';
        amtInput.onchange = () => { createSplitItems[i].amount = amtInput.value; };
        topRow.appendChild(amtInput);

        if (createSplitItems.length > 1) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'w-8 h-8 flex items-center justify-center rounded-lg hover:bg-fact-red/10 text-fact-muted hover:text-fact-red transition';
            removeBtn.setAttribute('aria-label', 'Remove item');
            removeBtn.textContent = '\u00d7';
            removeBtn.onclick = () => window.removeSplitItem(i);
            topRow.appendChild(removeBtn);
        }

        itemDiv.appendChild(topRow);

        // Participants header
        const partHeader = document.createElement('div');
        partHeader.className = 'text-[10px] text-fact-muted dark:text-fact-dark-muted font-medium uppercase tracking-wider mb-1.5';
        partHeader.textContent = 'Participants';
        itemDiv.appendChild(partHeader);

        // Participant rows
        const partContainer = document.createElement('div');
        partContainer.className = 'space-y-1.5 mb-2';

        item.participants.forEach((p, j) => {
            const partRow = document.createElement('div');
            partRow.className = 'flex items-center gap-2';

            if (p.is_self) {
                const selfLabel = document.createElement('div');
                selfLabel.className = 'flex-1 px-3 py-1.5 text-sm bg-fact-yellow/10 rounded-lg font-medium';
                selfLabel.textContent = 'You';
                partRow.appendChild(selfLabel);
            } else {
                const contactSelect = document.createElement('select');
                contactSelect.className = 'flex-1 px-3 py-1.5 text-sm rounded-lg border border-fact-border dark:border-fact-dark-border bg-white dark:bg-gray-900';
                const defaultOpt = document.createElement('option');
                defaultOpt.value = '';
                defaultOpt.textContent = 'Choose contact or type below';
                contactSelect.appendChild(defaultOpt);
                for (const r of recipients) {
                    const opt = document.createElement('option');
                    opt.value = r.id;
                    opt.textContent = r.shortName;
                    if (p.recipient_id === r.id) opt.selected = true;
                    contactSelect.appendChild(opt);
                }
                contactSelect.onchange = () => {
                    createSplitItems[i].participants[j].recipient_id = contactSelect.value || null;
                    if (contactSelect.value) createSplitItems[i].participants[j].ad_hoc_name = '';
                };
                partRow.appendChild(contactSelect);

                const adHocInput = document.createElement('input');
                adHocInput.type = 'text';
                adHocInput.placeholder = 'Or name';
                adHocInput.value = p.ad_hoc_name || '';
                adHocInput.className = 'w-28 px-3 py-1.5 text-sm rounded-lg border border-fact-border dark:border-fact-dark-border bg-white dark:bg-gray-900';
                adHocInput.onchange = () => { createSplitItems[i].participants[j].ad_hoc_name = adHocInput.value; };
                partRow.appendChild(adHocInput);
            }

            // Share type select
            const shareSelect = document.createElement('select');
            shareSelect.className = 'w-20 px-2 py-1.5 text-[10px] rounded-lg border border-fact-border dark:border-fact-dark-border bg-white dark:bg-gray-900';
            ['equal', 'fixed', 'percentage'].forEach(type => {
                const opt = document.createElement('option');
                opt.value = type;
                opt.textContent = type === 'percentage' ? '%' : type.charAt(0).toUpperCase() + type.slice(1);
                if (p.share_type === type) opt.selected = true;
                shareSelect.appendChild(opt);
            });
            shareSelect.onchange = () => {
                createSplitItems[i].participants[j].share_type = shareSelect.value;
                renderCreateSplitItems(STATE, callbacks);
            };
            partRow.appendChild(shareSelect);

            if (p.share_type !== 'equal') {
                const valInput = document.createElement('input');
                valInput.type = 'number';
                valInput.placeholder = p.share_type === 'percentage' ? '%' : 'QAR';
                valInput.value = p.share_value || '';
                valInput.step = '0.01';
                valInput.className = 'w-20 px-2 py-1.5 text-sm rounded-lg border border-fact-border dark:border-fact-dark-border bg-white dark:bg-gray-900';
                valInput.onchange = () => {
                    createSplitItems[i].participants[j].share_value = valInput.value ? parseFloat(valInput.value) : null;
                };
                partRow.appendChild(valInput);
            }

            const removePartBtn = document.createElement('button');
            removePartBtn.className = 'w-6 h-6 flex items-center justify-center rounded hover:bg-fact-red/10 text-fact-muted hover:text-fact-red transition text-xs';
            removePartBtn.setAttribute('aria-label', 'Remove');
            removePartBtn.textContent = '\u00d7';
            removePartBtn.onclick = () => window.removeParticipantFromItem(i, j);
            partRow.appendChild(removePartBtn);

            partContainer.appendChild(partRow);
        });

        itemDiv.appendChild(partContainer);

        // Add participant buttons
        const btnRow = document.createElement('div');
        btnRow.className = 'flex gap-2';

        const addPersonBtn = document.createElement('button');
        addPersonBtn.className = 'text-[10px] px-3 py-1 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition';
        addPersonBtn.textContent = '+ Person';
        addPersonBtn.onclick = () => window.addParticipantToItem(i);
        btnRow.appendChild(addPersonBtn);

        if (!item.participants.some(p => p.is_self)) {
            const addSelfBtn = document.createElement('button');
            addSelfBtn.className = 'text-[10px] px-3 py-1 rounded-full bg-fact-yellow/20 text-fact-yellow hover:bg-fact-yellow/40 transition';
            addSelfBtn.textContent = '+ You';
            addSelfBtn.onclick = () => window.addSelfToItem(i);
            btnRow.appendChild(addSelfBtn);
        }

        itemDiv.appendChild(btnRow);
        container.appendChild(itemDiv);
    });
}

export function updateSplitItemField(index, field, value) {
    if (createSplitItems[index]) {
        createSplitItems[index][field] = value;
    }
}

export function updateParticipantField(itemIndex, partIndex, field, value) {
    const item = createSplitItems[itemIndex];
    if (!item) return;
    const p = item.participants[partIndex];
    if (!p) return;

    if (field === 'share_value') {
        p.share_value = value ? parseFloat(value) : null;
    } else if (field === 'recipient_id') {
        p.recipient_id = value || null;
        if (value) p.ad_hoc_name = '';
    } else {
        p[field] = value;
    }
}

export async function submitCreateSplit(STATE, supabaseClient, CONFIG, callbacks) {
    const { showToast } = callbacks;

    const title = document.getElementById('splitTitle')?.value.trim();
    const description = document.getElementById('splitDescription')?.value.trim();
    const splitDate = document.getElementById('splitDate')?.value;
    const txnLinkId = document.getElementById('splitTxnLink')?.value.trim();

    if (!title) {
        showToast('Split title is required', 'error');
        return;
    }

    const items = [];
    let totalAmount = 0;
    for (const item of createSplitItems) {
        if (!item.title || !item.amount || parseFloat(item.amount) <= 0) {
            showToast('Each item needs a name and amount', 'error');
            return;
        }
        if (item.participants.length === 0) {
            showToast(`Add at least one participant to "${item.title}"`, 'error');
            return;
        }

        const amount = parseFloat(item.amount);
        totalAmount += amount;

        items.push({
            title: item.title,
            amount,
            participants: item.participants.map(p => ({
                recipient_id: p.recipient_id || null,
                ad_hoc_name: p.ad_hoc_name || null,
                is_self: p.is_self || false,
                share_type: p.share_type || 'equal',
                share_value: p.share_value
            }))
        });
    }

    try {
        const result = await splitsApi('create', {
            title,
            description: description || null,
            total_amount: totalAmount,
            split_date: splitDate || new Date().toISOString(),
            transaction_id: txnLinkId || null,
            items
        }, supabaseClient, CONFIG);

        if (result.split) {
            STATE.splits = STATE.splits || [];
            STATE.splits.unshift(result.split);
        }

        closeCreateSplit();
        showToast('Split created', 'success');
        renderSplitsList(STATE, callbacks);
        renderSplitsWidget(STATE, callbacks);
    } catch (err) {
        showToast('Failed to create split: ' + err.message, 'error');
    }
}

// ============== SETTLE MODAL ==============

export function openSettleModal(participantId, owed, paid) {
    const modal = document.getElementById('settleModal');
    if (!modal) return;

    const remaining = owed - paid;
    document.getElementById('settleParticipantId').value = participantId;
    document.getElementById('settleOwed').textContent = owed.toFixed(2);
    document.getElementById('settlePaid').textContent = paid.toFixed(2);
    document.getElementById('settleRemaining').textContent = remaining.toFixed(2);
    document.getElementById('settleAmount').value = remaining.toFixed(2);
    document.getElementById('settleTxnId').value = '';

    modal.classList.remove('hidden');
}

export function closeSettleModal() {
    document.getElementById('settleModal')?.classList.add('hidden');
}

export async function submitSettle(STATE, supabaseClient, CONFIG, callbacks) {
    const { showToast } = callbacks;

    const participantId = document.getElementById('settleParticipantId')?.value;
    const amount = parseFloat(document.getElementById('settleAmount')?.value);
    const txnId = document.getElementById('settleTxnId')?.value.trim();

    if (!participantId || isNaN(amount) || amount <= 0) {
        showToast('Enter a valid settlement amount', 'error');
        return;
    }

    try {
        await splitsApi('settle', {
            participant_id: participantId,
            amount,
            settlement_txn_id: txnId || null
        }, supabaseClient, CONFIG);

        updateParticipantLocally(STATE, participantId, amount, txnId);

        closeSettleModal();
        showToast('Settlement recorded', 'success');

        const detailPanel = document.getElementById('splitDetailPanel');
        const splitId = detailPanel?.dataset.splitId;
        if (splitId) openSplitDetail(splitId, STATE, callbacks);

        renderSplitsList(STATE, callbacks);
        renderSplitsWidget(STATE, callbacks);
    } catch (err) {
        showToast('Failed to settle: ' + err.message, 'error');
    }
}

function updateParticipantLocally(STATE, participantId, amount, txnId) {
    for (const split of (STATE.splits || [])) {
        for (const item of (split.split_items || [])) {
            for (const p of (item.split_participants || [])) {
                if (p.id === participantId) {
                    p.amount_settled = amount;
                    if (txnId) p.settlement_txn_id = txnId;
                    if (amount >= (Number(p.computed_amount) || 0)) {
                        p.settled_at = new Date().toISOString();
                    } else {
                        p.settled_at = null;
                    }

                    const allItems = split.split_items || [];
                    const allParticipants = allItems.flatMap(i => i.split_participants || []);
                    const allSettled = allParticipants
                        .filter(pp => !pp.is_self)
                        .every(pp => pp.settled_at);
                    if (allSettled) split.status = 'settled';

                    return;
                }
            }
        }
    }
}

// ============== SETTLEMENT SUGGESTIONS ==============

export async function checkSettlementSuggestions(splitId, STATE, supabaseClient, CONFIG, callbacks) {
    const { showToast, formatNum, escapeHtml } = callbacks;

    try {
        showToast('Looking for matching transfers...', 'info');
        const result = await splitsApi('suggest', {}, supabaseClient, CONFIG);
        const suggestions = (result.suggestions || []).filter(s => s.split_title);

        if (suggestions.length === 0) {
            showToast('No matching transfers found', 'info');
            return;
        }

        const overlay = document.getElementById('settleSuggestionsOverlay');
        if (!overlay) return;

        const list = overlay.querySelector('.suggestions-list');
        list.textContent = '';

        for (const s of suggestions) {
            const confidenceColors = {
                exact: 'bg-fact-green/20 text-fact-green',
                high: 'bg-fact-green/10 text-fact-green',
                medium: 'bg-fact-yellow/20 text-fact-yellow',
                low: 'bg-gray-200 text-fact-muted'
            };

            const card = document.createElement('div');
            card.className = 'p-3 bg-gray-50 dark:bg-gray-800 rounded-xl mb-2';

            const headerRow = document.createElement('div');
            headerRow.className = 'flex items-center justify-between mb-1';
            const headerLabel = document.createElement('span');
            headerLabel.className = 'text-xs font-medium';
            headerLabel.textContent = `${s.split_title} \u2192 ${s.item_title}`;
            headerRow.appendChild(headerLabel);
            const confBadge = document.createElement('span');
            confBadge.className = `text-[10px] px-2 py-0.5 rounded-full ${confidenceColors[s.confidence] || ''}`;
            confBadge.textContent = s.confidence;
            headerRow.appendChild(confBadge);
            card.appendChild(headerRow);

            const detailRow = document.createElement('div');
            detailRow.className = 'flex items-center justify-between text-xs text-fact-muted';
            const amounts = document.createElement('span');
            amounts.textContent = `Owed: QAR ${formatNum(s.owed)} \u00b7 Transfer: QAR ${formatNum(s.transaction.amount)}`;
            detailRow.appendChild(amounts);
            const dateEl = document.createElement('span');
            dateEl.textContent = dayjs(s.transaction.date).format('MMM D');
            detailRow.appendChild(dateEl);
            card.appendChild(detailRow);

            const cpEl = document.createElement('div');
            cpEl.className = 'text-xs mt-1';
            cpEl.textContent = s.transaction.counterparty;
            card.appendChild(cpEl);

            const applyBtn = document.createElement('button');
            applyBtn.className = 'mt-2 w-full px-3 py-1.5 text-xs font-medium bg-fact-green/10 text-fact-green rounded-lg hover:bg-fact-green/20 transition';
            applyBtn.textContent = 'Apply Settlement';
            applyBtn.onclick = () => window.applySuggestion(s.participant_id, s.owed, s.transaction.id);
            card.appendChild(applyBtn);

            list.appendChild(card);
        }

        overlay.classList.remove('hidden');
    } catch (err) {
        showToast('Failed to check suggestions: ' + err.message, 'error');
    }
}

export function closeSettleSuggestions() {
    document.getElementById('settleSuggestionsOverlay')?.classList.add('hidden');
}

export async function applySuggestion(participantId, amount, txnId, STATE, supabaseClient, CONFIG, callbacks) {
    const { showToast } = callbacks;

    try {
        await splitsApi('settle', {
            participant_id: participantId,
            amount,
            settlement_txn_id: txnId
        }, supabaseClient, CONFIG);

        updateParticipantLocally(STATE, participantId, amount, txnId);

        showToast('Settlement applied', 'success');
        closeSettleSuggestions();

        const detailPanel = document.getElementById('splitDetailPanel');
        const splitId = detailPanel?.dataset.splitId;
        if (splitId) openSplitDetail(splitId, STATE, callbacks);

        renderSplitsList(STATE, callbacks);
        renderSplitsWidget(STATE, callbacks);
    } catch (err) {
        showToast('Failed to apply: ' + err.message, 'error');
    }
}

// ============== ADD ITEM TO EXISTING SPLIT ==============

export function openAddItemModal(splitId) {
    const modal = document.getElementById('addItemModal');
    if (!modal) return;

    modal.dataset.splitId = splitId;
    document.getElementById('addItemTitle').value = '';
    document.getElementById('addItemAmount').value = '';
    modal.classList.remove('hidden');
}

export function closeAddItemModal() {
    document.getElementById('addItemModal')?.classList.add('hidden');
}

export async function submitAddItem(STATE, supabaseClient, CONFIG, callbacks) {
    const { showToast } = callbacks;

    const modal = document.getElementById('addItemModal');
    const splitId = modal?.dataset.splitId;
    const title = document.getElementById('addItemTitle')?.value.trim();
    const amount = parseFloat(document.getElementById('addItemAmount')?.value);

    if (!splitId || !title || isNaN(amount) || amount <= 0) {
        showToast('Item name and amount are required', 'error');
        return;
    }

    try {
        await splitsApi('addItem', {
            split_id: splitId,
            title,
            amount
        }, supabaseClient, CONFIG);

        await refreshSplits(STATE, supabaseClient, CONFIG);

        closeAddItemModal();
        showToast('Item added', 'success');

        openSplitDetail(splitId, STATE, callbacks);
        renderSplitsList(STATE, callbacks);
        renderSplitsWidget(STATE, callbacks);
    } catch (err) {
        showToast('Failed to add item: ' + err.message, 'error');
    }
}

// ============== CANCEL / DELETE ==============

export async function cancelSplit(splitId, STATE, supabaseClient, CONFIG, callbacks) {
    const { showToast, showConfirm } = callbacks;

    const confirmed = await showConfirm({
        title: 'Cancel Split',
        message: 'This will mark the split as cancelled. Are you sure?',
        confirmText: 'Cancel Split',
        cancelText: 'Keep',
        type: 'danger'
    });

    if (!confirmed) return;

    try {
        await splitsApi('update', { id: splitId, status: 'cancelled' }, supabaseClient, CONFIG);

        const split = (STATE.splits || []).find(s => s.id === splitId);
        if (split) split.status = 'cancelled';

        closeSplitDetail();
        showToast('Split cancelled', 'info');
        renderSplitsList(STATE, callbacks);
        renderSplitsWidget(STATE, callbacks);
    } catch (err) {
        showToast('Failed to cancel: ' + err.message, 'error');
    }
}

export async function deleteSplit(splitId, STATE, supabaseClient, CONFIG, callbacks) {
    const { showToast, showConfirm } = callbacks;

    const confirmed = await showConfirm({
        title: 'Delete Split',
        message: 'This will permanently delete this split and all its data. Continue?',
        confirmText: 'Delete',
        cancelText: 'Keep',
        type: 'danger'
    });

    if (!confirmed) return;

    try {
        await splitsApi('delete', { id: splitId }, supabaseClient, CONFIG);

        STATE.splits = (STATE.splits || []).filter(s => s.id !== splitId);

        closeSplitDetail();
        showToast('Split deleted', 'info');
        renderSplitsList(STATE, callbacks);
        renderSplitsWidget(STATE, callbacks);
    } catch (err) {
        showToast('Failed to delete: ' + err.message, 'error');
    }
}

// ============== REFRESH FROM SERVER ==============

async function refreshSplits(STATE, supabaseClient, CONFIG) {
    try {
        const result = await splitsApi('list', {}, supabaseClient, CONFIG);
        STATE.splits = result.splits || [];
    } catch (err) {
        console.error('Failed to refresh splits:', err);
    }
}

// ============== DASHBOARD WIDGET ==============

export function renderSplitsWidget(STATE, callbacks) {
    const { formatNum } = callbacks;
    const container = document.getElementById('splitsWidget');
    if (!container) return;

    const splits = STATE.splits || [];
    if (splits.length === 0) {
        container.classList.add('hidden');
        return;
    }

    const { outstanding, activeSplits } = computeSplitsSummary(splits);

    if (outstanding <= 0 && activeSplits === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.textContent = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'flex items-center justify-between cursor-pointer';
    wrapper.onclick = () => window.openSplitsPanel();

    const left = document.createElement('div');
    left.className = 'flex items-center gap-2';

    const icon = document.createElement('span');
    icon.className = 'text-lg';
    icon.textContent = '\u2702\uFE0F';
    left.appendChild(icon);

    const info = document.createElement('div');
    const countLine = document.createElement('div');
    countLine.className = 'text-xs font-medium';
    countLine.textContent = `${activeSplits} active split${activeSplits !== 1 ? 's' : ''}`;
    info.appendChild(countLine);
    const amtLine = document.createElement('div');
    amtLine.className = 'text-[10px] text-fact-muted dark:text-fact-dark-muted';
    amtLine.textContent = `QAR ${formatNum(outstanding)} outstanding`;
    info.appendChild(amtLine);
    left.appendChild(info);

    wrapper.appendChild(left);

    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('class', 'w-4 h-4 text-fact-muted');
    chevron.setAttribute('fill', 'none');
    chevron.setAttribute('stroke', 'currentColor');
    chevron.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('d', 'M9 5l7 7-7 7');
    chevron.appendChild(path);
    wrapper.appendChild(chevron);

    container.appendChild(wrapper);
}

// ============== PERSON DRILLDOWN INTEGRATION ==============

export function renderPersonSplits(recipientId, STATE, callbacks) {
    const { formatNum } = callbacks;

    const splits = STATE.splits || [];
    const relevantSplits = [];

    for (const split of splits) {
        const items = split.split_items || [];
        const involvedItems = items.filter(item =>
            (item.split_participants || []).some(p => p.recipient_id === recipientId)
        );
        if (involvedItems.length > 0) {
            relevantSplits.push({ split, items: involvedItems });
        }
    }

    if (relevantSplits.length === 0) return null;

    let totalOwedByPerson = 0;
    let totalSettledByPerson = 0;

    const frag = document.createDocumentFragment();

    const wrapper = document.createElement('div');
    wrapper.className = 'mt-4 pt-3 border-t border-fact-border dark:border-fact-dark-border';

    const header = document.createElement('p');
    header.className = 'text-xs font-medium text-fact-muted dark:text-fact-dark-muted uppercase tracking-wider mb-2';
    header.textContent = 'Splits';
    wrapper.appendChild(header);

    for (const { split, items } of relevantSplits) {
        for (const item of items) {
            const p = (item.split_participants || []).find(pp => pp.recipient_id === recipientId);
            if (!p) continue;

            const owed = Number(p.computed_amount) || 0;
            const settled = Number(p.amount_settled) || 0;
            totalOwedByPerson += owed;
            totalSettledByPerson += settled;
            const isSettled = p.settled_at;

            const row = document.createElement('div');
            row.className = 'flex items-center justify-between py-1.5 text-xs';

            const leftDiv = document.createElement('div');
            leftDiv.className = 'min-w-0';
            const titleSpan = document.createElement('span');
            titleSpan.className = 'font-medium truncate';
            titleSpan.textContent = split.title;
            leftDiv.appendChild(titleSpan);
            const itemSpan = document.createElement('span');
            itemSpan.className = 'text-fact-muted';
            itemSpan.textContent = ` \u00b7 ${item.title}`;
            leftDiv.appendChild(itemSpan);
            row.appendChild(leftDiv);

            const rightDiv = document.createElement('div');
            rightDiv.className = 'flex items-center gap-2 flex-shrink-0 ml-2';
            const amtSpan = document.createElement('span');
            amtSpan.className = `font-display ${isSettled ? 'text-fact-green' : 'text-fact-red'}`;
            amtSpan.textContent = formatNum(owed);
            rightDiv.appendChild(amtSpan);

            if (isSettled) {
                const checkSpan = document.createElement('span');
                checkSpan.className = 'text-fact-green text-[10px]';
                checkSpan.textContent = '\u2713';
                rightDiv.appendChild(checkSpan);
            } else {
                const dueSpan = document.createElement('span');
                dueSpan.className = 'text-[10px] text-fact-red';
                dueSpan.textContent = `${formatNum(owed - settled)} due`;
                rightDiv.appendChild(dueSpan);
            }

            row.appendChild(rightDiv);
            wrapper.appendChild(row);
        }
    }

    const netSplits = totalOwedByPerson - totalSettledByPerson;
    if (netSplits > 0) {
        const summary = document.createElement('div');
        summary.className = 'flex items-center justify-between pt-2 mt-1 border-t border-fact-border/50 text-xs font-medium';
        const label = document.createElement('span');
        label.textContent = 'Split balance';
        summary.appendChild(label);
        const value = document.createElement('span');
        value.className = 'text-fact-red font-display';
        value.textContent = `QAR ${formatNum(netSplits)} owed`;
        summary.appendChild(value);
        wrapper.appendChild(summary);
    }

    frag.appendChild(wrapper);
    return frag;
}

// ============== FILTER FOR SEARCH ==============

export function filterSplitsPanel(STATE, callbacks) {
    renderSplitsList(STATE, callbacks);
}
