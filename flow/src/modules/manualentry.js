// ─── MANUAL QUICK ENTRY ─────────────────────────────────────────
// Slide-up panel for adding single transactions manually.
// innerHTML usage: category dropdown populated from hardcoded MERCHANT_TYPES keys (not user input).

let openedAt = 0;

export function openManualEntry() {
    const panel = document.getElementById('manualEntryPanel');
    const backdrop = document.getElementById('manualEntryBackdrop');
    if (!panel || !backdrop) return;

    // Reset form
    document.getElementById('meAmount').value = '';
    document.getElementById('meCounterparty').value = '';
    document.getElementById('meDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('meCurrency').value = 'QAR';
    document.getElementById('meDirection').value = 'OUT';
    document.getElementById('meNotes').value = '';
    const catSelect = document.getElementById('meCategory');
    if (catSelect) catSelect.value = '';

    openedAt = Date.now();
    backdrop.classList.add('open');
    panel.classList.add('open');
    // Focus amount field
    setTimeout(() => document.getElementById('meAmount').focus(), 300);
}

export function closeManualEntry() {
    // Guard against same-frame close: on mobile, the touch that opens the panel
    // can propagate to the newly-clickable backdrop and immediately close it.
    if (Date.now() - openedAt < 300) return;
    document.getElementById('manualEntryBackdrop').classList.remove('open');
    document.getElementById('manualEntryPanel').classList.remove('open');
}

export async function submitManualEntry(supabaseClient, CONFIG, showToast, syncData) {
    const amount = parseFloat(document.getElementById('meAmount').value);
    const counterparty = document.getElementById('meCounterparty').value.trim();
    const date = document.getElementById('meDate').value;
    const currency = document.getElementById('meCurrency').value || 'QAR';
    const direction = document.getElementById('meDirection').value || 'OUT';
    const category = document.getElementById('meCategory').value || null;
    const notes = document.getElementById('meNotes').value.trim() || null;

    if (!amount || amount <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }
    if (!counterparty) {
        showToast('Please enter a merchant or payee name', 'error');
        return;
    }

    const btn = document.getElementById('meSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Adding...';

    try {
        const { data: session } = await supabaseClient.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) throw new Error('Not authenticated');

        const response = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-import`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                rows: [{ date, amount, counterparty, currency, direction, category, notes }]
            })
        });

        const result = await response.json();
        if (result.error && !result.imported) throw new Error(result.error);

        if (result.imported > 0) {
            showToast('Transaction added', 'success');
            closeManualEntry();
            if (typeof syncData === 'function') syncData();
        } else if (result.skipped > 0) {
            showToast('Duplicate transaction (already exists)', 'info');
        } else {
            showToast('Could not add transaction', 'error');
        }
    } catch (err) {
        showToast('Failed: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Add Transaction';
    }
}

export function initManualEntryCategories(MERCHANT_TYPES) {
    const select = document.getElementById('meCategory');
    if (!select) return;
    // Categories from hardcoded MERCHANT_TYPES constant, not user input
    const cats = Object.keys(MERCHANT_TYPES).filter(c => c !== 'Uncategorized').sort();
    select.innerHTML = '<option value="">Auto-detect</option>' +
        cats.map(c => `<option value="${c}">${c}</option>`).join('');
}
