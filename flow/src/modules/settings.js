// ─── PERIOD & SETTINGS ──────────────────────────────────────────
import dayjs from 'dayjs';

// PERIOD
export function setPeriod(period, STATE, filterAndRender, updateDateRangeDisplay) {
    STATE.period = period;
    const now = dayjs();

    switch (period) {
        case 'thisMonth':
            STATE.dateRange = { start: now.startOf('month'), end: now };
            break;
        case 'lastMonth':
            STATE.dateRange = { start: now.subtract(1, 'month').startOf('month'), end: now.subtract(1, 'month').endOf('month') };
            break;
        case 'last90':
            STATE.dateRange = { start: now.subtract(90, 'day'), end: now };
            break;
        case 'thisYear':
            STATE.dateRange = { start: now.startOf('year'), end: now };
            break;
    }

    // Update UI
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.period === period);
    });

    updateDateRangeDisplay();
    filterAndRender();
}

export function updateDateRangeDisplay(STATE) {
    const { start, end } = STATE.dateRange;
    const sameYear = start.year() === end.year();
    const format = sameYear ? 'MMM D' : 'MMM D, YY';
    document.getElementById('dateRangeDisplay').textContent =
        `${start.format(format)} -> ${end.format('MMM D, YYYY')}`;
}

export function openDatePicker(STATE) {
    document.getElementById('startDate').value = STATE.dateRange.start.format('YYYY-MM-DD');
    document.getElementById('endDate').value = STATE.dateRange.end.format('YYYY-MM-DD');
    document.getElementById('dateModal').classList.remove('hidden');
}

export function closeDatePicker() {
    document.getElementById('dateModal').classList.add('hidden');
}

export function applyCustomDate(STATE, filterAndRender) {
    const start = dayjs(document.getElementById('startDate').value);
    const end = dayjs(document.getElementById('endDate').value);

    if (start.isValid() && end.isValid() && start.isBefore(end)) {
        STATE.period = 'custom';
        STATE.dateRange = { start, end };

        document.querySelectorAll('.period-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.period === 'custom');
        });

        closeDatePicker();
        filterAndRender();
    } else {
        alert('Please select a valid date range');
    }
}

// SETTINGS (Tabbed)
let currentSettingsTab = 'general';

export function switchSettingsTab(tabId, callbacks) {
    const { renderSettingsGoalsList, renderRecipientsList } = callbacks;
    currentSettingsTab = tabId;
    localStorage.setItem('fact_settings_tab', tabId);

    // Update tab button states
    const tabs = ['general', 'goals', 'contacts'];
    tabs.forEach(t => {
        const tabBtn = document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}`);
        const panel = document.getElementById(`panel${t.charAt(0).toUpperCase() + t.slice(1)}`);
        const isActive = t === tabId;

        if (tabBtn) {
            tabBtn.setAttribute('aria-selected', isActive);
            tabBtn.classList.toggle('border-fact-yellow', isActive);
            tabBtn.classList.toggle('border-transparent', !isActive);
            tabBtn.classList.toggle('text-fact-ink', isActive);
            tabBtn.classList.toggle('dark:text-fact-dark-ink', isActive);
            tabBtn.classList.toggle('text-fact-muted', !isActive);
        }

        if (panel) {
            panel.classList.toggle('hidden', !isActive);
        }
    });

    // Show/hide footer (only for General tab)
    const footer = document.getElementById('settingsFooter');
    if (footer) {
        footer.classList.toggle('hidden', tabId !== 'general');
    }

    // Load data for active tab
    if (tabId === 'goals') {
        renderSettingsGoalsList();
    } else if (tabId === 'contacts') {
        renderRecipientsList();
    }
}

export function openSettings(tab = null, callbacks) {
    // Load saved settings
    const savedModel = localStorage.getItem('fact_ai_model') || 'gpt-5-mini';
    document.getElementById('settingsAiModel').value = savedModel;

    // Clear password fields
    document.getElementById('settingsCurrentPass').value = '';
    document.getElementById('settingsNewPass').value = '';
    document.getElementById('settingsConfirmPass').value = '';
    document.getElementById('settingsPassError').classList.add('hidden');
    document.getElementById('settingsPassSuccess').classList.add('hidden');

    // Determine which tab to show
    const targetTab = tab || localStorage.getItem('fact_settings_tab') || 'general';

    // Show modal
    document.getElementById('settingsModal').classList.remove('hidden');

    // Switch to the appropriate tab
    switchSettingsTab(targetTab, callbacks);
}

export function closeSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
}

export function saveSettings(showToast) {
    const selectedModel = document.getElementById('settingsAiModel').value;
    localStorage.setItem('fact_ai_model', selectedModel);

    // Update the model display if visible
    const modelEl = document.getElementById('aiModelName');
    if (modelEl) {
        modelEl.textContent = selectedModel;
    }

    if (typeof showToast === 'function') {
        showToast('Settings saved', 'success');
    }
    closeSettings();
}

export async function generateShortcutKey(supabaseClient, CONFIG) {
    const statusEl = document.getElementById('shortcutKeyStatus');
    statusEl.textContent = 'Generating key...';
    try {
        const { data: session } = await supabaseClient.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) throw new Error('Not authenticated');

        const response = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-keys`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({ action: 'create' })
        });
        const result = await response.json();
        if (result.error) throw new Error(result.error);

        localStorage.setItem('fact_shortcut_key_id', result.keyId || '');

        const box = document.getElementById('shortcutKeyBox');
        const input = document.getElementById('shortcutKeyValue');
        input.value = result.key;
        box.classList.remove('hidden');
        statusEl.textContent = 'Key generated. Paste it into your Shortcut.';
    } catch (err) {
        statusEl.textContent = 'Failed to generate key: ' + err.message;
    }
}

export async function revokeShortcutKey(supabaseClient, CONFIG) {
    const statusEl = document.getElementById('shortcutKeyStatus');
    const keyId = localStorage.getItem('fact_shortcut_key_id');
    if (!keyId) {
        statusEl.textContent = 'No active key to revoke.';
        return;
    }
    statusEl.textContent = 'Revoking key...';
    try {
        const { data: session } = await supabaseClient.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) throw new Error('Not authenticated');

        const response = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-keys`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({ action: 'revoke', keyId })
        });
        const result = await response.json();
        if (result.error) throw new Error(result.error);

        localStorage.removeItem('fact_shortcut_key_id');
        document.getElementById('shortcutKeyBox').classList.add('hidden');
        document.getElementById('shortcutKeyValue').value = '';
        statusEl.textContent = 'Key revoked.';
    } catch (err) {
        statusEl.textContent = 'Failed to revoke key: ' + err.message;
    }
}

export function copyShortcutKey() {
    const input = document.getElementById('shortcutKeyValue');
    input.select();
    document.execCommand('copy');
}

export function openShortcutSetup(CONFIG) {
    const link = document.getElementById('shortcutTemplateLink');
    link.href = CONFIG.SHORTCUT_TEMPLATE_URL;
    document.getElementById('shortcutSetupModal').classList.remove('hidden');
}

export function closeShortcutSetup() {
    document.getElementById('shortcutSetupModal').classList.add('hidden');
}

export function getSelectedAiModel() {
    return localStorage.getItem('fact_ai_model') || 'gpt-5-mini';
}

export async function changePassword(supabaseClient) {
    const newPass = document.getElementById('settingsNewPass').value;
    const confirmPass = document.getElementById('settingsConfirmPass').value;

    const errorEl = document.getElementById('settingsPassError');
    const successEl = document.getElementById('settingsPassSuccess');

    errorEl.classList.add('hidden');
    successEl.classList.add('hidden');

    if (!newPass || !confirmPass) {
        errorEl.textContent = 'Please fill in new password fields';
        errorEl.classList.remove('hidden');
        return;
    }

    if (newPass !== confirmPass) {
        errorEl.textContent = 'New passwords do not match';
        errorEl.classList.remove('hidden');
        return;
    }

    if (newPass.length < 6) {
        errorEl.textContent = 'Password must be at least 6 characters';
        errorEl.classList.remove('hidden');
        return;
    }

    try {
        const { error } = await supabaseClient.auth.updateUser({
            password: newPass
        });

        if (error) {
            errorEl.textContent = error.message;
            errorEl.classList.remove('hidden');
            return;
        }

        successEl.textContent = 'Password updated successfully';
        successEl.classList.remove('hidden');
        document.getElementById('settingsCurrentPass').value = '';
        document.getElementById('settingsNewPass').value = '';
        document.getElementById('settingsConfirmPass').value = '';
    } catch (err) {
        errorEl.textContent = 'Connection error: ' + err.message;
        errorEl.classList.remove('hidden');
    }
}
