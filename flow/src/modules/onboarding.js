// ─── ONBOARDING WIZARD ──────────────────────────────────────────

const BANK_CONFIG = [
    {
        id: 'qnb',
        name: 'QNB (Qatar National Bank)',
        icon: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>',
        supported: true,
    },
    {
        id: 'other',
        name: 'Other banks',
        icon: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>',
        supported: false,
    }
];

let onboardingStep = 0;
const ONBOARDING_STEPS = ['welcome', 'bank', 'key', 'shortcut', 'test', 'done'];

export async function checkOnboarding(supabaseClient) {
    try {
        const { data: session } = await supabaseClient.auth.getSession();
        if (!session?.session) return;

        const userId = session.session.user.id;

        // Check if user has any transactions or API keys
        const [ledgerRes, keysRes] = await Promise.all([
            supabaseClient.from('raw_ledger').select('id', { count: 'exact', head: true }).eq('user_id', userId),
            supabaseClient.from('user_keys').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('revoked_at', null)
        ]);

        const hasData = (ledgerRes.count || 0) > 0;
        const hasKeys = (keysRes.count || 0) > 0;

        if (!hasData && !hasKeys) {
            openOnboarding();
        }
    } catch (e) {
        // Silently fail - onboarding is not critical
    }
}

export function openOnboarding() {
    onboardingStep = 0;
    renderOnboardingStep();
    document.getElementById('onboardingModal').classList.remove('hidden');
}

export function closeOnboarding() {
    document.getElementById('onboardingModal').classList.add('hidden');
}

export function onboardingNext() {
    if (onboardingStep === ONBOARDING_STEPS.length - 1) {
        closeOnboarding();
        return;
    }
    onboardingStep++;
    renderOnboardingStep();
}

export function onboardingPrev() {
    if (onboardingStep > 0) {
        onboardingStep--;
        renderOnboardingStep();
    }
}

export function renderOnboardingStep(CONFIG) {
    const step = ONBOARDING_STEPS[onboardingStep];
    const content = document.getElementById('onboardingContent');
    const progress = document.getElementById('onboardingProgress');
    const backBtn = document.getElementById('onboardingBack');
    const nextBtn = document.getElementById('onboardingNext');

    const pct = ((onboardingStep + 1) / ONBOARDING_STEPS.length) * 100;
    progress.style.width = pct + '%';

    backBtn.classList.toggle('hidden', onboardingStep === 0);

    const FUNCTIONS_BASE = CONFIG?.FUNCTIONS_BASE || '';
    const SHORTCUT_TEMPLATE_URL = CONFIG?.SHORTCUT_TEMPLATE_URL || '';

    if (step === 'welcome') {
        nextBtn.textContent = 'Get Started';
        content.innerHTML = `
            <div class="flex-1 flex flex-col items-center justify-center text-center space-y-4">
                <div class="w-16 h-16 rounded-xl flex items-center justify-center bg-[#0a0a0a]">
                    <img src="icon-512.png" alt="FACT/Flow" class="w-12 h-12 object-contain">
                </div>
                <h2 class="font-display font-bold text-xl">Welcome to FACT/Flow</h2>
                <p class="text-sm text-fact-muted dark:text-fact-dark-muted max-w-xs">
                    Let's set up automatic transaction tracking. Your bank SMS messages will be securely parsed and categorized.
                </p>
                <div class="flex items-center gap-2 text-xs text-fact-green">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
                    <span>End-to-end encrypted. Your data stays yours.</span>
                </div>
            </div>`;
    } else if (step === 'bank') {
        nextBtn.textContent = 'Next';
        content.innerHTML = `
            <h2 class="font-display font-semibold text-lg">Select Your Bank</h2>
            <p class="text-sm text-fact-muted dark:text-fact-dark-muted">Choose the bank whose SMS alerts you want to track.</p>
            <div class="space-y-3 flex-1">
                ${BANK_CONFIG.map(bank => `
                    <button onclick="selectOnboardingBank('${bank.id}')" id="bankOpt_${bank.id}"
                        class="w-full flex items-center gap-3 p-4 border-2 rounded-xl transition text-left
                            ${bank.id === 'qnb' ? 'border-fact-yellow bg-fact-yellow/5' : 'border-fact-border dark:border-fact-dark-border'}
                            ${!bank.supported ? 'opacity-50' : 'hover:border-fact-yellow cursor-pointer'}">
                        <div class="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                            ${bank.icon}
                        </div>
                        <div class="flex-1">
                            <div class="font-medium text-sm">${bank.name}</div>
                            ${!bank.supported ? '<div class="text-xs text-fact-muted">Coming soon</div>' : '<div class="text-xs text-fact-green">Supported</div>'}
                        </div>
                        ${bank.id === 'qnb' ? '<svg class="w-5 h-5 text-fact-yellow flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>' : ''}
                    </button>
                `).join('')}
            </div>`;
    } else if (step === 'key') {
        nextBtn.textContent = 'Next';
        content.innerHTML = `
            <h2 class="font-display font-semibold text-lg">Generate Your API Key</h2>
            <p class="text-sm text-fact-muted dark:text-fact-dark-muted">This key connects your iOS Shortcut to FACT/Flow securely.</p>
            <div class="flex-1 space-y-4">
                <button onclick="onboardingGenerateKey()" id="onboardingGenKeyBtn"
                    class="w-full px-4 py-3 text-sm bg-fact-ink dark:bg-white text-white dark:text-fact-ink rounded-xl font-medium hover:opacity-90 transition min-h-[48px]">
                    Generate API Key
                </button>
                <div id="onboardingKeyResult" class="hidden space-y-3">
                    <div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                        <label class="block text-xs font-medium text-fact-muted dark:text-fact-dark-muted mb-1">Your API Key</label>
                        <div class="flex items-center gap-2">
                            <input type="text" id="onboardingKeyValue" readonly
                                class="flex-1 text-xs font-mono bg-transparent border-none focus:outline-none select-all">
                            <button onclick="copyOnboardingKey()" class="px-3 py-1.5 text-xs bg-fact-yellow text-fact-ink rounded-lg font-medium hover:opacity-80 transition">
                                Copy
                            </button>
                        </div>
                    </div>
                    <div class="flex items-start gap-2 text-xs text-fact-muted dark:text-fact-dark-muted">
                        <svg class="w-4 h-4 text-fact-yellow flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                        <span>Save this key somewhere safe. You'll paste it into the iOS Shortcut in the next step.</span>
                    </div>
                </div>
                <p id="onboardingKeyStatus" class="text-xs text-fact-muted dark:text-fact-dark-muted"></p>
            </div>`;
    } else if (step === 'shortcut') {
        nextBtn.textContent = 'Next';
        content.innerHTML = `
            <h2 class="font-display font-semibold text-lg">Install the iOS Shortcut</h2>
            <p class="text-sm text-fact-muted dark:text-fact-dark-muted">The Shortcut sends your bank SMS messages to FACT/Flow automatically.</p>
            <div class="flex-1 space-y-4">
                <ol class="space-y-3 text-sm">
                    <li class="flex items-start gap-3">
                        <span class="w-6 h-6 rounded-full bg-fact-yellow/20 text-fact-yellow flex items-center justify-center flex-shrink-0 text-xs font-bold">1</span>
                        <span>Tap the button below to open the Shortcut template on your iPhone.</span>
                    </li>
                    <li class="flex items-start gap-3">
                        <span class="w-6 h-6 rounded-full bg-fact-yellow/20 text-fact-yellow flex items-center justify-center flex-shrink-0 text-xs font-bold">2</span>
                        <span>Tap <strong>"Add Shortcut"</strong> when prompted.</span>
                    </li>
                    <li class="flex items-start gap-3">
                        <span class="w-6 h-6 rounded-full bg-fact-yellow/20 text-fact-yellow flex items-center justify-center flex-shrink-0 text-xs font-bold">3</span>
                        <span>Edit the Shortcut and paste your <strong>API Key</strong> and <strong>Supabase URL</strong> into the text fields.</span>
                    </li>
                </ol>
                <a href="${SHORTCUT_TEMPLATE_URL}" target="_blank"
                    class="inline-flex items-center justify-center w-full px-4 py-3 text-sm bg-fact-ink dark:bg-white text-white dark:text-fact-ink rounded-xl font-medium hover:opacity-90 transition min-h-[48px]">
                    <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                    Get Shortcut Template
                </a>
                <div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <label class="block text-xs font-medium text-fact-muted dark:text-fact-dark-muted mb-1">Supabase URL (paste into Shortcut)</label>
                    <div class="flex items-center gap-2">
                        <input type="text" value="${FUNCTIONS_BASE}/flow-sms" readonly
                            class="flex-1 text-xs font-mono bg-transparent border-none focus:outline-none select-all">
                        <button onclick="navigator.clipboard.writeText('${FUNCTIONS_BASE}/flow-sms')" class="px-3 py-1.5 text-xs bg-fact-yellow text-fact-ink rounded-lg font-medium hover:opacity-80 transition">
                            Copy
                        </button>
                    </div>
                </div>
            </div>`;
    } else if (step === 'test') {
        nextBtn.textContent = 'Next';
        content.innerHTML = `
            <h2 class="font-display font-semibold text-lg">Test Your Setup</h2>
            <p class="text-sm text-fact-muted dark:text-fact-dark-muted">Send a test to make sure everything is connected.</p>
            <div class="flex-1 space-y-4">
                <ol class="space-y-3 text-sm">
                    <li class="flex items-start gap-3">
                        <span class="w-6 h-6 rounded-full bg-fact-green/20 text-fact-green flex items-center justify-center flex-shrink-0 text-xs font-bold">1</span>
                        <span>Open your <strong>Messages</strong> app on iPhone.</span>
                    </li>
                    <li class="flex items-start gap-3">
                        <span class="w-6 h-6 rounded-full bg-fact-green/20 text-fact-green flex items-center justify-center flex-shrink-0 text-xs font-bold">2</span>
                        <span>Find a recent QNB bank SMS (purchase or transfer alert).</span>
                    </li>
                    <li class="flex items-start gap-3">
                        <span class="w-6 h-6 rounded-full bg-fact-green/20 text-fact-green flex items-center justify-center flex-shrink-0 text-xs font-bold">3</span>
                        <span>Long-press the message, tap <strong>Share</strong>, and choose the <strong>FACT/Flow</strong> Shortcut.</span>
                    </li>
                </ol>
                <div class="p-4 bg-fact-yellow/10 rounded-xl text-center">
                    <p class="text-sm font-medium">After sharing, refresh this page to see the transaction appear.</p>
                    <p class="text-xs text-fact-muted mt-1">You can skip this and test later.</p>
                </div>
            </div>`;
    } else if (step === 'done') {
        nextBtn.textContent = 'Start Using FACT/Flow';
        content.innerHTML = `
            <div class="flex-1 flex flex-col items-center justify-center text-center space-y-4">
                <div class="w-16 h-16 rounded-full bg-fact-green/20 flex items-center justify-center">
                    <svg class="w-8 h-8 text-fact-green" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                </div>
                <h2 class="font-display font-bold text-xl">You're All Set!</h2>
                <p class="text-sm text-fact-muted dark:text-fact-dark-muted max-w-xs">
                    Transactions will be tracked automatically whenever you share a bank SMS via the Shortcut.
                </p>
                <div class="space-y-2 text-xs text-fact-muted dark:text-fact-dark-muted">
                    <p>You can always access setup again from <strong>Settings</strong>.</p>
                </div>
            </div>`;
    }
}

export function selectOnboardingBank(bankId) {
    BANK_CONFIG.forEach(b => {
        const el = document.getElementById('bankOpt_' + b.id);
        if (el) {
            el.classList.toggle('border-fact-yellow', b.id === bankId);
            el.classList.toggle('bg-fact-yellow/5', b.id === bankId);
            el.classList.toggle('border-fact-border', b.id !== bankId);
            el.classList.toggle('dark:border-fact-dark-border', b.id !== bankId);
        }
    });
}

export async function onboardingGenerateKey(supabaseClient, CONFIG) {
    const btn = document.getElementById('onboardingGenKeyBtn');
    const status = document.getElementById('onboardingKeyStatus');
    btn.textContent = 'Generating...';
    btn.disabled = true;
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

        document.getElementById('onboardingKeyValue').value = result.key;
        document.getElementById('onboardingKeyResult').classList.remove('hidden');
        btn.classList.add('hidden');
        status.textContent = '';
    } catch (err) {
        status.textContent = 'Error: ' + err.message;
        btn.textContent = 'Generate API Key';
        btn.disabled = false;
    }
}

export function copyOnboardingKey() {
    const input = document.getElementById('onboardingKeyValue');
    navigator.clipboard.writeText(input.value);
    const btn = input.parentElement.querySelector('button');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
}

// Export BANK_CONFIG for external use
export { BANK_CONFIG, ONBOARDING_STEPS };
