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
let currentSettingsTab = 'account';

export function switchSettingsTab(tabId, callbacks) {
    const { renderSettingsGoalsList, renderRecipientsList, loadProfileTab } = callbacks;
    currentSettingsTab = tabId;
    localStorage.setItem('fact_settings_tab', tabId);

    // Update tab button states
    const tabs = ['account', 'budget', 'goals', 'contacts', 'data'];
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

    // Show/hide footer (only for Account tab)
    const footer = document.getElementById('settingsFooter');
    if (footer) {
        footer.classList.toggle('hidden', tabId !== 'account');
    }

    // Load data for active tab
    if (tabId === 'goals') {
        renderSettingsGoalsList();
    } else if (tabId === 'contacts') {
        renderRecipientsList();
    } else if (tabId === 'budget' && typeof loadProfileTab === 'function') {
        loadProfileTab();
    }
}

export function openSettings(tab = null, callbacks) {
    // Load saved settings
    const savedModel = localStorage.getItem('fact_ai_model') || 'claude-sonnet';
    document.getElementById('settingsAiModel').value = savedModel;

    // Clear password fields
    document.getElementById('settingsCurrentPass').value = '';
    document.getElementById('settingsNewPass').value = '';
    document.getElementById('settingsConfirmPass').value = '';
    document.getElementById('settingsPassError').classList.add('hidden');
    document.getElementById('settingsPassSuccess').classList.add('hidden');

    // Determine which tab to show
    // Map old tab names to new ones for localStorage compatibility
    const savedTab = localStorage.getItem('fact_settings_tab');
    const tabMap = { general: 'account', profile: 'budget' };
    const resolvedSaved = savedTab ? (tabMap[savedTab] || savedTab) : 'account';
    const targetTab = tab ? (tabMap[tab] || tab) : resolvedSaved;

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

export async function generateShortcutKey(supabaseClient, CONFIG, callbacks = {}) {
    const statusEl = document.getElementById('shortcutKeyStatus');
    statusEl.textContent = 'Generating key...';
    try {
        const { data: session } = await supabaseClient.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) throw new Error('Not authenticated');

        const labelEl = document.getElementById('shortcutKeyLabel');
        const label = labelEl ? labelEl.value.trim() : '';

        const response = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-keys`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({ action: 'create', label: label || null })
        });
        const result = await response.json();
        if (result.error) throw new Error(result.error);

        localStorage.setItem('fact_shortcut_key_id', result.keyId || '');

        const box = document.getElementById('shortcutKeyBox');
        const input = document.getElementById('shortcutKeyValue');
        input.value = result.key;
        box.classList.remove('hidden');
        statusEl.textContent = 'Key generated. Copy it now — it won\'t be shown again.';

        // Clear label input
        if (labelEl) labelEl.value = '';

        // Refresh key list if callback provided
        if (typeof callbacks.refreshKeyList === 'function') {
            callbacks.refreshKeyList();
        }
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
    const url = CONFIG.SHORTCUT_TEMPLATE_URL;
    if (!url || url === 'YOUR_SHORTCUT_TEMPLATE_URL') {
        link.href = '#';
        link.classList.add('opacity-50', 'pointer-events-none');
        link.textContent = 'Shortcut Template Not Configured';
    } else {
        link.href = url;
        link.classList.remove('opacity-50', 'pointer-events-none');
        link.textContent = 'Open Shortcut Template';
    }
    document.getElementById('shortcutSetupModal').classList.remove('hidden');
}

export function closeShortcutSetup() {
    document.getElementById('shortcutSetupModal').classList.add('hidden');
}

// ─── KEY LIST ───────────────────────────────────────────────────

export async function listKeys(supabaseClient, CONFIG) {
    try {
        const { data: session } = await supabaseClient.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) return [];

        const response = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-keys`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({ action: 'list' })
        });
        const result = await response.json();
        return result.keys || [];
    } catch (_err) {
        return [];
    }
}

export function renderKeyList(keys, callbacks) {
    const { escapeHtml } = callbacks;
    const container = document.getElementById('keyListContainer');
    if (!container) return;

    if (!keys.length) {
        container.innerHTML = '<p class="text-xs text-fact-muted dark:text-fact-dark-muted py-2">No keys yet. Generate one to connect your iOS Shortcut.</p>';
        return;
    }

    container.innerHTML = keys.map(k => {
        const isActive = !k.revoked_at;
        const lastUsed = k.last_used_at
            ? dayjs(k.last_used_at).format('MMM D, HH:mm')
            : 'Never';
        const created = dayjs(k.created_at).format('MMM D, YYYY');
        const label = k.label ? escapeHtml(k.label) : 'Unlabeled';

        return `<div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl flex items-center justify-between gap-3">
            <div class="min-w-0">
                <div class="flex items-center gap-2">
                    <span class="font-mono text-xs">${escapeHtml(k.key_prefix)}...</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? 'bg-fact-green/20 text-fact-green' : 'bg-fact-red/20 text-fact-red'}">${isActive ? 'Active' : 'Revoked'}</span>
                </div>
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mt-0.5">${label} · Created ${created}</div>
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted">Last used: ${lastUsed}</div>
            </div>
            ${isActive ? `<button onclick="revokeKeyById('${k.id}')" class="text-[10px] text-fact-red hover:underline flex-shrink-0">Revoke</button>` : ''}
        </div>`;
    }).join('');
}

export function getSelectedAiModel() {
    return localStorage.getItem('fact_ai_model') || 'claude-sonnet';
}

// ─── FX RATES ───────────────────────────────────────────────────

export function renderFxRates(STATE, escapeHtml) {
    const container = document.getElementById('fxRatesContainer');
    if (!container) return;

    const rates = STATE.fxRates || {};
    const currencies = Object.keys(rates).filter(c => c !== 'QAR').sort();

    if (!currencies.length) {
        container.innerHTML = '<p class="text-xs text-fact-muted dark:text-fact-dark-muted py-2">No exchange rates loaded yet. Sync data to fetch rates.</p>';
        return;
    }

    container.innerHTML = currencies.map(currency => {
        const rate = Number(rates[currency]) || 1;
        return `<div class="flex items-center gap-3 py-1.5">
            <span class="text-xs font-mono w-10 text-fact-ink dark:text-fact-dark-ink">${escapeHtml(currency)}</span>
            <span class="text-[10px] text-fact-muted dark:text-fact-dark-muted">=</span>
            <input type="number" step="0.0001" min="0" value="${rate}"
                data-fx-currency="${escapeHtml(currency)}"
                class="fx-rate-input flex-1 px-3 py-1.5 border border-fact-border dark:border-fact-dark-border rounded-lg bg-white dark:bg-fact-dark-card text-xs font-mono focus:outline-none focus:ring-2 focus:ring-fact-yellow text-right">
            <span class="text-[10px] text-fact-muted dark:text-fact-dark-muted">QAR</span>
        </div>`;
    }).join('');
}

export async function saveFxOverrides(supabaseClient, STATE, showToast) {
    const inputs = document.querySelectorAll('.fx-rate-input');
    if (!inputs.length) return;

    const updates = [];
    inputs.forEach(input => {
        const currency = input.dataset.fxCurrency;
        const newRate = parseFloat(input.value);
        const currentRate = STATE.fxRates[currency];
        if (currency && Number.isFinite(newRate) && newRate > 0 && newRate !== currentRate) {
            updates.push({ currency, rate: newRate });
        }
    });

    if (!updates.length) {
        if (typeof showToast === 'function') showToast('No changes to save', 'info');
        return;
    }

    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        for (const { currency, rate } of updates) {
            const { error } = await supabaseClient
                .from('fx_rates')
                .upsert({ user_id: user.id, currency, rate_to_qar: rate, updated_at: new Date().toISOString() }, { onConflict: 'user_id,currency' });
            if (error) throw error;

            // Update local state
            STATE.fxRates[currency] = rate;
        }

        if (typeof showToast === 'function') showToast(`${updates.length} rate(s) updated`, 'success');
    } catch (err) {
        if (typeof showToast === 'function') showToast('Failed to save rates: ' + err.message, 'error');
    }
}

// ─── BACKFILL ────────────────────────────────────────────────────
export async function runBackfill(supabaseClient, CONFIG, showToast) {
    const btn = document.getElementById('backfillBtn');
    const status = document.getElementById('backfillStatus');
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = 'Running...';
    if (status) status.textContent = 'Categorizing transactions...';

    try {
        const { data: session } = await supabaseClient.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) throw new Error('Not authenticated');

        const response = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-backfill`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({})
        });
        const result = await response.json();
        if (result.error) throw new Error(result.error);

        const msg = result.message || `Done: ${result.matched} matched, ${result.ai_categorized} AI-categorized`;
        if (status) status.textContent = msg;
        if (typeof showToast === 'function') showToast(msg, 'success');

        // Hide backfill section if no more uncategorized
        if (result.total === 0 || (result.matched + result.ai_categorized === result.total)) {
            const section = document.getElementById('backfillSection');
            if (section) section.classList.add('hidden');
        }
    } catch (err) {
        if (status) status.textContent = 'Error: ' + err.message;
        if (typeof showToast === 'function') showToast('Backfill failed: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Run Backfill';
    }
}

// ─── PROFILE ─────────────────────────────────────────────────────
export function loadProfileTab(STATE) {
    const settings = STATE.profile?.settings || {};

    const salaryDay = document.getElementById('profileSalaryDay');
    const salaryAmount = document.getElementById('profileSalaryAmount');
    const monthlyBudget = document.getElementById('profileMonthlyBudget');
    const familyNames = document.getElementById('profileFamilyNames');

    if (salaryDay) salaryDay.value = settings.salary_day || '';
    if (salaryAmount) salaryAmount.value = settings.salary_amount || '';
    if (monthlyBudget) monthlyBudget.value = settings.monthly_budget || '';
    if (familyNames) familyNames.value = (settings.family_patterns || []).join(', ');
}

export async function saveProfile(supabaseClient, CONFIG, STATE, showToast) {
    const salaryDay = parseInt(document.getElementById('profileSalaryDay')?.value) || null;
    const salaryAmount = parseFloat(document.getElementById('profileSalaryAmount')?.value) || null;
    const monthlyBudget = parseFloat(document.getElementById('profileMonthlyBudget')?.value) || null;
    const familyNamesRaw = document.getElementById('profileFamilyNames')?.value || '';
    const familyPatterns = familyNamesRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    const settings = {
        ...(STATE.profile?.settings || {}),
        salary_day: salaryDay,
        salary_amount: salaryAmount,
        monthly_budget: monthlyBudget,
        family_patterns: familyPatterns,
    };

    try {
        const { data: session } = await supabaseClient.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) throw new Error('Not authenticated');

        const response = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-profile`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({ action: 'save', settings })
        });
        const result = await response.json();
        if (result.error) throw new Error(result.error);

        STATE.profile = { ...STATE.profile, settings };
        if (typeof showToast === 'function') showToast('Profile saved', 'success');
    } catch (err) {
        if (typeof showToast === 'function') showToast('Failed to save profile: ' + err.message, 'error');
    }
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

    if (newPass.length < 8) {
        errorEl.textContent = 'Password must be at least 8 characters';
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
