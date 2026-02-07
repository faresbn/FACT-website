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
