import { createClient } from '@supabase/supabase-js';
import Chart from 'chart.js/auto';
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';
import Papa from 'papaparse';
import DOMPurify from 'dompurify';

// Import styles
import './style.css';

// Initialize dayjs plugins
dayjs.extend(isBetween);

// CONFIG
const CONFIG = {
    STORAGE_KEY: 'qnb_tracker_v4',
    DEFAULT_FX: { USD: 3.65, EUR: 3.95, GBP: 4.60, SAR: 0.97 },
    SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
    FUNCTIONS_BASE: import.meta.env.VITE_FUNCTIONS_BASE,
    SHORTCUT_TEMPLATE_URL: 'YOUR_SHORTCUT_TEMPLATE_URL',
    AUTH_REDIRECT_URL: import.meta.env.VITE_AUTH_REDIRECT_URL || window.location.origin + '/flow/'
};

const supabaseClient = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// DIMENSION-BASED CATEGORIZATION SYSTEM
// Instead of rigid hierarchy, use computed dimensions for flexible analysis

// DIMENSION 1: WHAT (merchant type) - the base category
const MERCHANT_TYPES = {
    'Groceries': { color: '#4CAF50', icon: '🛒', essential: true },
    'Dining': { color: '#E67E22', icon: '🍽️', essential: false },
    'Bars & Nightlife': { color: '#AB47BC', icon: '🍸', essential: false },
    'Coffee': { color: '#795548', icon: '☕', essential: false },
    'Delivery': { color: '#FFA726', icon: '📦', essential: false },
    'Shopping': { color: '#42A5F5', icon: '🛍️', essential: false },
    'Transport': { color: '#26C6DA', icon: '🚗', essential: true },
    'Health': { color: '#66BB6A', icon: '💊', essential: true },
    'Bills': { color: '#78909C', icon: '📄', essential: true },
    'Travel': { color: '#FF7043', icon: '✈️', essential: false },
    'Entertainment': { color: '#EC407A', icon: '🎬', essential: false },
    'Transfer': { color: '#8D6E63', icon: '💸', essential: false },
    'Family': { color: '#E91E63', icon: '👨‍👩‍👧‍👦', essential: false },
    'Other': { color: '#95A5A6', icon: '📋', essential: false },
    'Uncategorized': { color: '#E74C3C', icon: '❓', essential: false }
};

// DIMENSION 2: WHEN (time context)
const TIME_CONTEXTS = {
    'Work Hours': { color: '#3498DB', hours: [7, 16], days: [0, 1, 2, 3, 4], icon: '💼' }, // Sun-Thu in Qatar
    'Evening': { color: '#9B59B6', hours: [17, 21], icon: '🌆' },
    'Late Night': { color: '#2C3E50', hours: [21, 4], icon: '🌙' },
    'Weekend': { color: '#E74C3C', days: [5, 6], icon: '🎉' }, // Fri-Sat
    'Early Morning': { color: '#F39C12', hours: [5, 7], icon: '🌅' }
};

// DIMENSION 3: SIZE (amount tier)
const SIZE_TIERS = {
    'Micro': { max: 25, color: '#BDC3C7', icon: '•' },
    'Small': { max: 100, color: '#95A5A6', icon: '••' },
    'Medium': { max: 500, color: '#7F8C8D', icon: '•••' },
    'Large': { max: 2000, color: '#34495E', icon: '••••' },
    'Major': { max: Infinity, color: '#2C3E50', icon: '•••••' }
};

// DIMENSION 4: PATTERN (AI-detected, computed from sequences)
const PATTERNS = {
    'Routine': { color: '#3498DB', icon: '🔄', description: 'Regular, repeated spending' },
    'Night Out': { color: '#9B59B6', icon: '🎉', description: 'Evening social spending cluster' },
    'Splurge': { color: '#E74C3C', icon: '💸', description: 'Unusually large purchase' },
    'Trip': { color: '#E67E22', icon: '✈️', description: 'Travel-related cluster' },
    'Subscription': { color: '#1ABC9C', icon: '📅', description: 'Recurring fixed amount' },
    'Work Expense': { color: '#3498DB', icon: '💼', description: 'Likely work-related' },
    'Normal': { color: '#95A5A6', icon: '○', description: 'Standard transaction' }
};

// High-level groupings for summary view (simplified) - FACT brand colors
const SUMMARY_GROUPS = {
    'Essentials': {
        color: '#75B876', // FACT Green
        icon: '🏠',
        types: ['Groceries', 'Bills', 'Health', 'Transport']
    },
    'Food & Drinks': {
        color: '#F4C44E', // FACT Yellow
        icon: '🍽️',
        types: ['Dining', 'Coffee', 'Delivery', 'Bars & Nightlife']
    },
    'Shopping & Fun': {
        color: '#9B8AC4', // FACT Purple (muted)
        icon: '🛍️',
        types: ['Shopping', 'Entertainment', 'Travel']
    },
    'Family': {
        color: '#E8A4B8', // Soft pink
        icon: '👨‍👩‍👧‍👦',
        types: ['Family']
    },
    'Other': {
        color: '#A8B5C4', // Muted gray-blue
        icon: '📋',
        types: ['Transfer', 'Other', 'Uncategorized']
    }
};

// Build CAT_COLORS from MERCHANT_TYPES and SUMMARY_GROUPS for backwards compatibility
const CAT_COLORS = {};
Object.entries(MERCHANT_TYPES).forEach(([name, data]) => CAT_COLORS[name] = data.color);
Object.entries(SUMMARY_GROUPS).forEach(([name, data]) => CAT_COLORS[name] = data.color);

// Compute summary group from merchant type
function getSummaryGroup(merchantType) {
    for (const [group, data] of Object.entries(SUMMARY_GROUPS)) {
        if (data.types.includes(merchantType)) return group;
    }
    return 'Other';
}

// Compute time context from timestamp
function getTimeContext(date) {
    const hour = date.hour();
    const day = date.day(); // 0 = Sunday

    const contexts = [];

    // Check weekend first (Fri-Sat in Qatar)
    if (day === 5 || day === 6) {
        contexts.push('Weekend');
    }

    // Check time of day
    if (hour >= 7 && hour < 16 && day >= 0 && day <= 4) {
        contexts.push('Work Hours');
    }
    if (hour >= 17 && hour < 21) {
        contexts.push('Evening');
    }
    if (hour >= 21 || hour < 5) {
        contexts.push('Late Night');
    }
    if (hour >= 5 && hour < 7) {
        contexts.push('Early Morning');
    }

    return contexts.length > 0 ? contexts : ['Normal'];
}

// Compute size tier from amount
function getSizeTier(amount) {
    for (const [tier, data] of Object.entries(SIZE_TIERS)) {
        if (amount <= data.max) return tier;
    }
    return 'Major';
}

// COLORS helper
function getTypeColor(type) {
    return MERCHANT_TYPES[type]?.color || '#95A5A6';
}

function getGroupColor(group) {
    return SUMMARY_GROUPS[group]?.color || '#95A5A6';
}

// STATE
const STATE = {
    allTxns: [],
    filtered: [],
    merchantMap: [],
    recipients: [], // Phone/Account to name mapping for transfers
    categories: new Set(),
    fxRates: { ...CONFIG.DEFAULT_FX },
    localMappings: {},
    userContext: [], // User corrections and context from AI
    period: 'salary',
    dateRange: { start: dayjs().subtract(60, 'day'), end: dayjs() },
    catTarget: null,
    currentUser: 'default',
    viewMode: 'parent', // 'parent' or 'subcat'
    hasLoaded: false
};

// CHARTS
const charts = {};

// AUTH & INIT
document.addEventListener('DOMContentLoaded', async () => {
    const { data: session } = await supabaseClient.auth.getSession();
    if (session?.session?.user) {
        showApp(session.session.user);
    } else {
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('mainApp').classList.add('hidden');
    }

    supabaseClient.auth.onAuthStateChange((event, sessionData) => {
        if (event === 'SIGNED_IN' && sessionData?.user) {
            showApp(sessionData.user);
        }
        if (event === 'SIGNED_OUT') {
            document.getElementById('loginScreen').classList.remove('hidden');
            document.getElementById('mainApp').classList.add('hidden');
        }
    });
});

async function attemptLogin() {
    const email = document.getElementById('loginUsername').value.trim();
    if (!email) return showLoginError('Please enter your email');

    const btn = document.getElementById('loginBtn');
    btn.textContent = 'Sending link...';
    btn.disabled = true;

    try {
    const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: {
                emailRedirectTo: CONFIG.AUTH_REDIRECT_URL
        }
    });
        if (error) throw error;
        showLoginError('Magic link sent. Check your email.', false);
    } catch (err) {
        showLoginError(err.message || 'Login failed');
    } finally {
        btn.textContent = 'Send magic link';
        btn.disabled = false;
    }
}

async function loginWithGoogle() {
    await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: CONFIG.AUTH_REDIRECT_URL
        }
    });
}

function showLoginError(msg, isError = true) {
    const el = document.getElementById('loginError');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.toggle('text-fact-red', isError);
    el.classList.toggle('text-fact-green', !isError);
    setTimeout(() => el.classList.add('hidden'), 4000);
}

async function showApp(user) {
    // Hide login, show app
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');

    // Set user context
    STATE.currentUser = user.email || 'user';
    STATE.authToken = null;

    // Update display
    const userDisplay = document.getElementById('currentUserDisplay');
    userDisplay.textContent = (user.email || 'User').split('@')[0];

    // Update AI model display from saved preference
    const modelEl = document.getElementById('aiModelName');
    if (modelEl) {
        modelEl.textContent = localStorage.getItem('fact_ai_model') || 'gpt-5-mini';
    }

    // Clean OAuth hash from URL
    if (window.location.hash && window.location.hash.includes('access_token')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    // Init app
    loadLocal();
    await syncData();

    // Check if onboarding needed
    checkOnboarding();

    // Event listeners
    const txnSearch = document.getElementById('txnSearch');
    const txnFilter = document.getElementById('txnFilter');
    if (txnSearch) txnSearch.addEventListener('input', debounce(filterTxnModal, 200));
    if (txnFilter) txnFilter.addEventListener('change', filterTxnModal);
}

async function logout() {
    await supabaseClient.auth.signOut();
    location.reload();
}

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

async function checkOnboarding() {
    try {
        const { data: session } = await supabaseClient.auth.getSession();
        if (!session?.session) return;

        const token = session.session.access_token;
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

function openOnboarding() {
    onboardingStep = 0;
    renderOnboardingStep();
    document.getElementById('onboardingModal').classList.remove('hidden');
}

function closeOnboarding() {
    document.getElementById('onboardingModal').classList.add('hidden');
}

function onboardingNext() {
    if (onboardingStep === ONBOARDING_STEPS.length - 1) {
        closeOnboarding();
        return;
    }
    onboardingStep++;
    renderOnboardingStep();
}

function onboardingPrev() {
    if (onboardingStep > 0) {
        onboardingStep--;
        renderOnboardingStep();
    }
}

function renderOnboardingStep() {
    const step = ONBOARDING_STEPS[onboardingStep];
    const content = document.getElementById('onboardingContent');
    const progress = document.getElementById('onboardingProgress');
    const backBtn = document.getElementById('onboardingBack');
    const nextBtn = document.getElementById('onboardingNext');

    const pct = ((onboardingStep + 1) / ONBOARDING_STEPS.length) * 100;
    progress.style.width = pct + '%';

    backBtn.classList.toggle('hidden', onboardingStep === 0);

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
                <a href="${CONFIG.SHORTCUT_TEMPLATE_URL}" target="_blank"
                    class="inline-flex items-center justify-center w-full px-4 py-3 text-sm bg-fact-ink dark:bg-white text-white dark:text-fact-ink rounded-xl font-medium hover:opacity-90 transition min-h-[48px]">
                    <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                    Get Shortcut Template
                </a>
                <div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <label class="block text-xs font-medium text-fact-muted dark:text-fact-dark-muted mb-1">Supabase URL (paste into Shortcut)</label>
                    <div class="flex items-center gap-2">
                        <input type="text" value="${CONFIG.FUNCTIONS_BASE}/flow-sms" readonly
                            class="flex-1 text-xs font-mono bg-transparent border-none focus:outline-none select-all">
                        <button onclick="navigator.clipboard.writeText('${CONFIG.FUNCTIONS_BASE}/flow-sms')" class="px-3 py-1.5 text-xs bg-fact-yellow text-fact-ink rounded-lg font-medium hover:opacity-80 transition">
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

function selectOnboardingBank(bankId) {
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

async function onboardingGenerateKey() {
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

function copyOnboardingKey() {
    const input = document.getElementById('onboardingKeyValue');
    navigator.clipboard.writeText(input.value);
    const btn = input.parentElement.querySelector('button');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
}
// ─── END ONBOARDING ─────────────────────────────────────────────

function getStorageKey() {
    return `${CONFIG.STORAGE_KEY}_${STATE.currentUser}`;
}

function loadLocal() {
    try {
        const stored = localStorage.getItem(getStorageKey());
        if (stored) {
            const data = JSON.parse(stored);
            STATE.localMappings = data.mappings || {};
        }
    } catch (e) {}
}

function saveLocal() {
    localStorage.setItem(getStorageKey(), JSON.stringify({
        mappings: STATE.localMappings
    }));
}

// DATA FETCHING - Secure via Supabase Edge Function
async function syncData() {
    document.getElementById('loadingState').classList.remove('hidden');
    document.getElementById('mainContent').classList.add('hidden');

    try {
        const { data: session } = await supabaseClient.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) throw new Error('AUTH_REQUIRED');

        const response = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                sheets: ['RawLedger', 'MerchantMap', 'FXRates', 'UserContext', 'Recipients']
            })
        });

        if (response.status === 401) throw new Error('AUTH_REQUIRED');
        const result = await response.json();
        if (result?.code === 'AUTH_REQUIRED' || result?.error === 'AUTH_REQUIRED') {
            throw new Error('AUTH_REQUIRED');
        }
        if (result?.error) throw new Error(result.error);
        const data = result?.data;
        if (!data) throw new Error('No data returned');

        // Process each sheet (Supabase returns arrays, same format as CSV)
        if (data.FXRates) processFX(data.FXRates.slice(1)); // Skip header
        if (data.MerchantMap) processMerchantMap(data.MerchantMap);
        if (data.UserContext) processUserContext(data.UserContext);
        if (data.Recipients) processRecipients(data.Recipients);
        if (data.RawLedger) processTxns(data.RawLedger);

        document.getElementById('lastSync').textContent = `Synced ${dayjs().format('HH:mm')}`;

        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('mainContent').classList.remove('hidden');

        // Default to salary period on first load, otherwise use current period
        if (STATE.period === 'salary' || !STATE.hasLoaded) {
            STATE.hasLoaded = true;
            setSalaryPeriod();
        } else {
            setPeriod(STATE.period);
        }

        // Show success toast (only after initial load)
        if (STATE.hasLoaded && typeof showToast === 'function') {
            showToast(`Synced ${STATE.allTxns.length} transactions`, 'success');
        }

        // Check for achievements after data loads
        if (typeof checkAchievements === 'function') {
            setTimeout(() => checkAchievements(), 1000);
        }

        // Show pattern-based nudges (delayed to not overwhelm)
        if (typeof renderPatternWarnings === 'function') {
            setTimeout(() => renderPatternWarnings(), 3000);
        }

    } catch (err) {
        console.error('Sync error:', err);
        if (String(err.message || err).includes('AUTH_REQUIRED')) {
            await supabaseClient.auth.signOut();
            document.getElementById('loginScreen').classList.remove('hidden');
            document.getElementById('mainApp').classList.add('hidden');
            return;
        }
        if (typeof showToast === 'function') {
            showToast('Sync failed: ' + err.message, 'error');
        } else {
            alert('Sync failed. Check your connection.');
        }
    }
}

// Legacy CSV fetch (kept for backwards compatibility if needed)
function fetchCSV(url) {
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

function processFX(rows) {
    rows.forEach(r => {
        const cur = clean(r[0]);
        const rate = parseFloat(r[1]);
        if (cur && !isNaN(rate)) STATE.fxRates[cur] = rate;
    });
}

function processMerchantMap(rows) {
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
    updateCatDropdowns();
}

// Process UserContext corrections (Type, Key, Value, Details, DateAdded, Source)
function processUserContext(rows) {
    if (rows.length && rows[0][0]?.toLowerCase().includes('type')) rows.shift();

    STATE.userContext = rows.map(r => ({
        type: clean(r[0]),        // 'correction', 'preference', etc.
        key: clean(r[1]),         // What the correction is about
        value: clean(r[2]),       // The correction value
        details: clean(r[3]),     // Additional details
        dateAdded: clean(r[4]),   // When it was added
        source: clean(r[5])       // 'user' or 'ai'
    })).filter(c => c.type && c.value);

    console.log('[Data] Loaded', STATE.userContext.length, 'user context entries');
}

// Process Recipients sheet for transfer/Fawran name mapping
function processRecipients(rows) {
    // Skip header row if present
    if (rows.length && rows[0][0]?.toString().toLowerCase().includes('phone')) rows.shift();

    STATE.recipients = rows.map(r => ({
        id: clean(r[4]) || null,
        phone: normalizePhone(String(r[0] || '')),
        bankAccount: clean(r[1]),
        shortName: clean(r[2]),
        longName: clean(r[3])
    })).filter(rec => rec.shortName || rec.longName);

    console.log('[Data] Loaded', STATE.recipients.length, 'recipients');
}

// Normalize phone number: remove country code, spaces, dashes
function normalizePhone(phone) {
    if (!phone) return '';
    let digits = phone.replace(/\D/g, '');
    // Remove Qatar country code if present
    if (digits.startsWith('974') && digits.length > 8) {
        digits = digits.slice(3);
    }
    return digits;
}

// Match counterparty to a known recipient
function matchRecipient(counterparty) {
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

        // Priority 3: Name match (words from longName found in counterparty)
        if (rec.longName) {
            const words = rec.longName.toLowerCase().split(/\s+/).filter(w => w.length > 2);
            for (const word of words) {
                if (cpLower.includes(word)) {
                    return { ...rec, matchType: 'name' };
                }
            }
        }

        // Priority 4: ShortName match (exact or partial)
        if (rec.shortName && cpLower.includes(rec.shortName.toLowerCase())) {
            return { ...rec, matchType: 'shortName' };
        }
    }

    return null;
}

// Check if a transaction matches any user context corrections
function getContextForTransaction(txn) {
    const relevantContext = [];

    for (const ctx of STATE.userContext) {
        const keyLower = ctx.key.toLowerCase();
        const valueLower = ctx.value.toLowerCase();

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
function isExemptFromSplurge(txn) {
    const context = getContextForTransaction(txn);

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

// Parse date that might be ISO string or Excel serial number
function parseDate(value) {
    const cleaned = clean(value);

    // Check if it's a number (Excel serial date)
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 40000 && num < 60000) {
        // Excel serial date: days since Dec 30, 1899
        // Excel dates are in local time, so we need to handle this carefully
        // to avoid timezone offset issues
        const days = Math.floor(num);
        const timeFraction = num - days;

        // Calculate date components directly to avoid timezone issues
        // Excel epoch is Dec 30, 1899 (day 0)
        const msPerDay = 24 * 60 * 60 * 1000;
        const excelEpochMs = Date.UTC(1899, 11, 30); // Use UTC to avoid timezone
        const dateMs = excelEpochMs + (days * msPerDay);

        // Extract date parts in UTC
        const utcDate = new Date(dateMs);
        const year = utcDate.getUTCFullYear();
        const month = utcDate.getUTCMonth();
        const day = utcDate.getUTCDate();

        // Calculate time from fraction
        const totalMinutes = Math.round(timeFraction * 24 * 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        // Create dayjs with explicit date/time (local timezone)
        const parsed = dayjs(new Date(year, month, day, hours, minutes));
        return parsed.isValid() ? parsed : dayjs();
    }

    // Otherwise parse as ISO string
    const parsed = dayjs(cleaned);
    return parsed.isValid() ? parsed : dayjs();
}

function processTxns(rows) {
    // Detect schema: old (8 cols) vs enhanced (12 cols)
    const headers = rows[0] || [];
    const hasEnhancedSchema = headers.length >= 10 &&
        (clean(headers[7]) === 'Category' || clean(headers[8]) === 'Category');

    const cols = hasEnhancedSchema
        ? { ts: 0, amount: 1, currency: 2, counterparty: 3, card: 4, direction: 5, txnType: 6, category: 7, subcategory: 8, confidence: 9, context: 10, raw: 11 }
        : { ts: 0, amount: 1, currency: 2, counterparty: 3, card: 4, direction: 5, txnType: 6, raw: 7 };

    const data = rows.filter(r => clean(r[1]) !== 'Amount' && !isNaN(parseFloat(r[1])));

    STATE.allTxns = data.map(r => {
        const raw = clean(r[cols.raw]);
        const counterparty = clean(r[cols.counterparty]) || '';
        const card = clean(r[cols.card]) || '';
        const currency = clean(r[cols.currency]) || 'QAR';
        const amount = parseFloat(r[cols.amount]);
        const rate = STATE.fxRates[currency] || 1;
        const amtQAR = currency === 'QAR' ? amount : amount * rate;
        const txnDate = parseDate(r[cols.ts]);

        // Try to get AI-assigned category from enhanced schema
        let aiMerchantType = null;
        let confidence = null;
        let aiContext = null;

        if (hasEnhancedSchema) {
            aiMerchantType = clean(r[cols.subcategory]) || clean(r[cols.category]) || null;
            confidence = clean(r[cols.confidence]) || null;
            try {
                aiContext = r[cols.context] ? JSON.parse(clean(r[cols.context])) : null;
            } catch (e) {
                aiContext = null;
            }
        }

        // Get merchant type and display info
        const meta = categorize(raw, aiMerchantType);

        // Check if this is a salary transaction (check multiple fields)
        const txnType = clean(r[cols.txnType]);
        const allText = `${raw} ${counterparty} ${card} ${txnType}`.toLowerCase();
        const isSalary = allText.includes('salary');

        // COMPUTE DIMENSIONS
        const dims = {
            what: meta.merchantType,
            when: getTimeContext(txnDate),
            size: getSizeTier(amtQAR),
            pattern: 'Normal' // Will be computed in batch by AI
        };

        // Match recipient for transfers/Fawran
        const isTransferType = ['transfer', 'fawran', 'internal transfer'].some(t =>
            txnType.toLowerCase().includes(t) || raw.toLowerCase().includes(t)
        );
        const recipient = isTransferType ? matchRecipient(counterparty) : null;

        return {
            date: txnDate,
            amount: amtQAR,
            currency,
            raw,
            counterparty,
            card,
            display: meta.display,
            consolidated: meta.consolidated,
            merchantType: meta.merchantType,
            summaryGroup: getSummaryGroup(meta.merchantType),
            direction: clean(r[cols.direction]),
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

function categorize(raw, aiMerchantType = null) {
    const lower = raw.toLowerCase();

    // Priority 1: Local user overrides
    if (STATE.localMappings[lower]) {
        const m = STATE.localMappings[lower];
        return {
            display: m.display,
            consolidated: m.consolidated,
            merchantType: m.merchantType || m.category || 'Other'
        };
    }

    // Priority 2: AI-assigned type (if provided and valid)
    if (aiMerchantType && MERCHANT_TYPES[aiMerchantType]) {
        return { display: raw, consolidated: raw, merchantType: aiMerchantType };
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

    return { display: raw, consolidated: raw, merchantType: 'Uncategorized' };
}

// PATTERN DETECTION - runs on all transactions to find clusters
function detectPatterns() {
    const out = STATE.allTxns.filter(t => t.direction === 'OUT');

    // Detect Night Out patterns: multiple bar/dining transactions in same evening
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

    // Detect Work Expense candidates: work hours dining/coffee
    out.forEach(t => {
        if (t.isWorkHours && ['Dining', 'Coffee'].includes(t.merchantType) && t.dims.pattern === 'Normal') {
            t.dims.pattern = 'Work Expense';
        }
    });

    // Detect Splurges: transactions > 3x average for that merchant type
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
            // Check if user has exempted this from splurge detection
            if (!isExemptFromSplurge(t)) {
                t.dims.pattern = 'Splurge';
            }
        }
    });

    // Detect Subscriptions: same merchant, similar amount, ~monthly interval
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

// SALARY DETECTION - Find transactions with SALARY keyword
function detectSalary() {
    // Find all transactions flagged as salary
    const allSalaries = STATE.allTxns.filter(t =>
        t.direction === 'IN' && t.isSalary
    ).sort((a, b) => b.date - a.date);

    if (allSalaries.length === 0) {
        return { salaries: [], avgInterval: 30 };
    }

    // Find the most common (modal) salary amount to filter out advances/bonuses
    const amounts = allSalaries.map(s => Math.round(s.amount / 100) * 100); // Round to nearest 100
    const amountCounts = {};
    amounts.forEach(a => amountCounts[a] = (amountCounts[a] || 0) + 1);
    const mainSalaryAmount = Object.entries(amountCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0];

    // Filter to only main salary amounts (within 10% tolerance)
    const salaries = mainSalaryAmount
        ? allSalaries.filter(s => Math.abs(s.amount - mainSalaryAmount) / mainSalaryAmount < 0.1)
        : allSalaries;

    // Calculate average interval between main salaries
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

function getIncomeDayFromContext() {
    if (!STATE.userContext || !STATE.userContext.length) return null;

    const incomeEntries = STATE.userContext.filter(c => c.type === 'income');
    if (!incomeEntries.length) return null;

    const preferred = incomeEntries.find(c => (c.key || '').toLowerCase().includes('salary')) || incomeEntries[0];
    const day = parseInt(preferred.value, 10);
    return isNaN(day) ? null : Math.min(Math.max(day, 1), 31);
}

// Get projected next salary date - detects day-of-month pattern from history
function getNextSalaryDate() {
    const { salaries, avgInterval } = detectSalary();
    const incomeDay = getIncomeDayFromContext();
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
        // This accounts for weekend adjustments
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
            if (dow === 5) nextDate = nextDate.subtract(1, 'day'); // Fri → Thu
            if (dow === 6) nextDate = nextDate.subtract(2, 'day'); // Sat → Thu

            return nextDate;
        }
    }

    // Fallback: interval-based calculation
    return lastSalary.add(avgInterval, 'day');
}

// Set period to include last 2 salaries
function setSalaryPeriod() {
    const { salaries, avgInterval } = detectSalary();

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
function calculateBudgetProjection() {
    const { salaries, avgInterval } = detectSalary();
    const nextSalary = getNextSalaryDate();
    const today = dayjs().startOf('day');
    const nextSalaryDay = nextSalary.startOf('day');
    const daysUntilSalary = Math.max(0, nextSalaryDay.diff(today, 'day'));

    const income = STATE.filtered.filter(t => t.direction === 'IN').reduce((s, t) => s + t.amount, 0);
    const expenses = STATE.filtered.filter(t => t.direction === 'OUT').reduce((s, t) => s + t.amount, 0);
    const net = income - expenses;

    // Daily budget = remaining funds / days until next salary
    const dailyBudget = daysUntilSalary > 0 ? Math.max(0, net / daysUntilSalary) : 0;

    // Calculate average daily spending from filtered period
    const periodDays = STATE.dateRange.end.diff(STATE.dateRange.start, 'day') + 1;
    const avgDailySpend = periodDays > 0 ? expenses / periodDays : 0;

    // Budget status: are we on track?
    const onTrack = dailyBudget >= avgDailySpend;

    return {
        income,
        expenses,
        net,
        daysUntilSalary,
        nextSalaryDate: nextSalary,
        dailyBudget,
        avgDailySpend,
        onTrack,
        lastSalaryAmount: salaries.length > 0 ? salaries[0].amount : 0
    };
}

function clean(str) {
    return str ? str.toString().replace(/^"|"$/g, '').trim() : '';
}

// PERIOD
function setPeriod(period) {
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

function updateDateRangeDisplay() {
    const { start, end } = STATE.dateRange;
    const sameYear = start.year() === end.year();
    const format = sameYear ? 'MMM D' : 'MMM D, YY';
    document.getElementById('dateRangeDisplay').textContent =
        `${start.format(format)} → ${end.format('MMM D, YYYY')}`;
}

function openDatePicker() {
    document.getElementById('startDate').value = STATE.dateRange.start.format('YYYY-MM-DD');
    document.getElementById('endDate').value = STATE.dateRange.end.format('YYYY-MM-DD');
    document.getElementById('dateModal').classList.remove('hidden');
}

function closeDatePicker() {
    document.getElementById('dateModal').classList.add('hidden');
}

function applyCustomDate() {
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

function switchSettingsTab(tabId) {
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

function openSettings(tab = null) {
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
    switchSettingsTab(targetTab);
}

function closeSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
}

function saveSettings() {
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

async function generateShortcutKey() {
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

async function revokeShortcutKey() {
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

function copyShortcutKey() {
    const input = document.getElementById('shortcutKeyValue');
    input.select();
    document.execCommand('copy');
}

function openShortcutSetup() {
    const link = document.getElementById('shortcutTemplateLink');
    link.href = CONFIG.SHORTCUT_TEMPLATE_URL;
    document.getElementById('shortcutSetupModal').classList.remove('hidden');
}

function closeShortcutSetup() {
    document.getElementById('shortcutSetupModal').classList.add('hidden');
}

function getSelectedAiModel() {
    return localStorage.getItem('fact_ai_model') || 'gpt-5-mini';
}

async function changePassword() {
    const currentPass = document.getElementById('settingsCurrentPass').value;
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

// FILTER & RENDER
function filterAndRender() {
    const { start, end } = STATE.dateRange;
    STATE.filtered = STATE.allTxns.filter(t => t.date.isBetween(start, end, 'day', '[]'));
    STATE.txnSort = STATE.txnSort || 'date-desc';
    STATE.txnFilter = STATE.txnFilter || '';

    renderBudgetProjection();
    renderDonutChart();
    renderCategoryBreakdown();
    renderRecentTxns();
    renderUncatAlert();
    renderQuickInsights();
    renderTodaySection();
    checkForImpulseBursts();
}

// Render Today section with daily budget meter
function renderTodaySection() {
    // Update date
    document.getElementById('todayDate').textContent = dayjs().format('dddd, MMM D');

    // Calculate today's spending
    const status = checkDailyBudget();
    document.getElementById('todaySpent').textContent = `QAR ${formatNum(status.spent)}`;
    document.getElementById('todayBudget').textContent = `QAR ${formatNum(status.budget)}`;

    // Update meter
    updateDailyBudgetMeter();

    // Update streak
    updateStreak();
    renderStreakBadge();

    // Update generosity budget (if enabled)
    if (typeof renderGenerosityBudget === 'function') {
        renderGenerosityBudget();
    }

    // Update focus mode hero if active
    if (isFocusMode && typeof updateFocusHero === 'function') {
        updateFocusHero();
        updateQuickInsight();
    }
}

// Check for impulse bursts and show warning
function checkForImpulseBursts() {
    const today = dayjs().startOf('day');
    const todayTxns = STATE.allTxns.filter(t =>
        t.direction === 'OUT' &&
        t.date.isAfter(today.subtract(1, 'day'))
    );

    const bursts = detectImpulseBurst(todayTxns);

    if (bursts.length > 0 && !STATE.impulseBannerDismissed) {
        const latest = bursts[bursts.length - 1];
        document.getElementById('impulseMessage').textContent =
            `${latest.count} purchases (QAR ${formatNum(latest.total)}) in 30 minutes`;
        document.getElementById('impulseBanner').style.display = 'block';
    }
}

function dismissImpulseBanner() {
    document.getElementById('impulseBanner').style.display = 'none';
    STATE.impulseBannerDismissed = true;
}

// Category breakdown for left panel
function renderCategoryBreakdown() {
    const out = STATE.filtered.filter(t => t.direction === 'OUT');
    const container = document.getElementById('categoryBreakdown');

    if (STATE.viewMode === 'parent') {
        // Group by summary group
        const byGroup = {};
        out.forEach(t => {
            if (!byGroup[t.summaryGroup]) byGroup[t.summaryGroup] = { total: 0, count: 0 };
            byGroup[t.summaryGroup].total += t.amount;
            byGroup[t.summaryGroup].count++;
        });

        const total = out.reduce((s, t) => s + t.amount, 0);
        const sorted = Object.entries(byGroup).sort((a, b) => b[1].total - a[1].total);

        container.innerHTML = sorted.map(([group, data]) => {
            const pct = total > 0 ? (data.total / total * 100).toFixed(0) : 0;
            const color = SUMMARY_GROUPS[group]?.color || '#999';
            const icon = SUMMARY_GROUPS[group]?.icon || '📋';
            return `
                <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition" onclick="openParentDrilldown('${group}')">
                    <div class="w-8 h-8 rounded-full flex items-center justify-center" style="background: ${color}20">
                        <span>${icon}</span>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between">
                            <span class="text-sm font-medium truncate">${group}</span>
                            <span class="text-sm font-bold">${formatNum(data.total)}</span>
                        </div>
                        <div class="flex items-center gap-2 mt-1">
                            <div class="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                <div class="h-full rounded-full" style="width: ${pct}%; background: ${color}"></div>
                            </div>
                            <span class="text-[10px] text-fact-muted">${pct}%</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        // Group by merchant type
        const byType = {};
        out.forEach(t => {
            if (!byType[t.merchantType]) byType[t.merchantType] = { total: 0, count: 0 };
            byType[t.merchantType].total += t.amount;
            byType[t.merchantType].count++;
        });

        const total = out.reduce((s, t) => s + t.amount, 0);
        const sorted = Object.entries(byType).sort((a, b) => b[1].total - a[1].total);

        container.innerHTML = sorted.slice(0, 10).map(([type, data]) => {
            const pct = total > 0 ? (data.total / total * 100).toFixed(0) : 0;
            const color = MERCHANT_TYPES[type]?.color || '#999';
            const icon = MERCHANT_TYPES[type]?.icon || '📋';
            return `
                <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition" onclick="openDrilldown('${type}')">
                    <div class="w-6 h-6 rounded-full flex items-center justify-center text-xs" style="background: ${color}20">
                        ${icon}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-medium truncate">${type}</span>
                            <span class="text-xs font-bold">${formatNum(data.total)}</span>
                        </div>
                        <div class="flex items-center gap-2 mt-0.5">
                            <div class="flex-1 h-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                <div class="h-full rounded-full" style="width: ${pct}%; background: ${color}"></div>
                            </div>
                            <span class="text-[9px] text-fact-muted">${data.count}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

// Transaction sorting
function sortTransactions(sortBy) {
    STATE.txnSort = sortBy;
    renderRecentTxns();
}

// Transaction filtering
function filterTransactions(query) {
    STATE.txnFilter = query.toLowerCase();
    renderRecentTxns();
}

// VIEW MODE TOGGLE
function setViewMode(mode) {
    STATE.viewMode = mode;

    const parentBtn = document.getElementById('viewParent');
    const subcatBtn = document.getElementById('viewSubcat');

    if (mode === 'parent') {
        parentBtn.classList.add('bg-fact-ink', 'dark:bg-fact-dark-ink', 'text-white', 'dark:text-fact-dark-bg');
        parentBtn.classList.remove('text-fact-muted', 'dark:text-fact-dark-muted');
        subcatBtn.classList.remove('bg-fact-ink', 'dark:bg-fact-dark-ink', 'text-white', 'dark:text-fact-dark-bg');
        subcatBtn.classList.add('text-fact-muted', 'dark:text-fact-dark-muted');
    } else {
        subcatBtn.classList.add('bg-fact-ink', 'dark:bg-fact-dark-ink', 'text-white', 'dark:text-fact-dark-bg');
        subcatBtn.classList.remove('text-fact-muted', 'dark:text-fact-dark-muted');
        parentBtn.classList.remove('bg-fact-ink', 'dark:bg-fact-dark-ink', 'text-white', 'dark:text-fact-dark-bg');
        parentBtn.classList.add('text-fact-muted', 'dark:text-fact-dark-muted');
    }

    renderCategoryBreakdown();
    renderDonutChart();
}

// METRICS
function renderMetrics() {
    const out = STATE.filtered.filter(t => t.direction === 'OUT');
    const inc = STATE.filtered.filter(t => t.direction === 'IN');

    const totalSpend = out.reduce((s, t) => s + t.amount, 0);
    const totalIncome = inc.reduce((s, t) => s + t.amount, 0);
    const net = totalIncome - totalSpend;

    const daysTotal = STATE.dateRange.end.diff(STATE.dateRange.start, 'day') + 1;
    const daysPassed = dayjs().diff(STATE.dateRange.start, 'day') + 1;
    const daysLeft = Math.max(0, daysTotal - daysPassed);
    const dailyBudget = daysLeft > 0 ? net / daysLeft : 0;

    document.getElementById('metricIncome').textContent = formatNum(totalIncome);
    document.getElementById('metricSpent').textContent = formatNum(totalSpend);
    document.getElementById('metricNet').textContent = (net >= 0 ? '+' : '') + formatNum(net);
    document.getElementById('metricDaily').textContent = formatNum(Math.max(0, dailyBudget));
    document.getElementById('metricDaysLeft').textContent = `${daysLeft} days left`;

    const netDot = document.getElementById('netDot');
    netDot.classList.toggle('bg-fact-green', net >= 0);
    netDot.classList.toggle('bg-fact-red', net < 0);
}

// DONUT CHART
function renderDonutChart() {
    const out = STATE.filtered.filter(t => t.direction === 'OUT');

    let labels, data, colors;

    if (STATE.viewMode === 'parent') {
        // Group by summary group (dimension-based)
        const parentSpend = {};
        out.forEach(t => {
            const parent = t.summaryGroup;
            parentSpend[parent] = (parentSpend[parent] || 0) + t.amount;
        });

        // Sort by priority order (matches SUMMARY_GROUPS)
        const parentOrder = ['Essentials', 'Food & Drinks', 'Shopping & Fun', 'Family', 'Other'];
        labels = parentOrder.filter(p => parentSpend[p] > 0);
        data = labels.map(p => parentSpend[p]);
        colors = labels.map(l => CAT_COLORS[l] || '#999');
    } else {
        // Original subcategory view
        const catSpend = {};
        out.forEach(t => catSpend[t.merchantType] = (catSpend[t.merchantType] || 0) + t.amount);

        const sorted = Object.entries(catSpend).sort((a, b) => b[1] - a[1]);
        labels = sorted.map(c => c[0]);
        data = sorted.map(c => c[1]);
        colors = labels.map(l => CAT_COLORS[l] || '#999');
    }

    const total = data.reduce((s, v) => s + v, 0);
    document.getElementById('donutTotal').textContent = formatNum(total);

    const ctx = document.getElementById('donutChart');
    if (charts.donut) charts.donut.destroy();

    charts.donut = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: document.documentElement.classList.contains('dark') ? '#1a1a1a' : '#ffffff',
                hoverOffset: 12,
                hoverBorderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            animation: {
                animateRotate: true,
                duration: 600
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(15, 15, 15, 0.95)',
                    titleColor: '#F4C44E',
                    bodyColor: '#ffffff',
                    borderColor: '#F4C44E',
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 12,
                    displayColors: true,
                    boxPadding: 6,
                    caretSize: 8,
                    caretPadding: 10,
                    // Position tooltip above chart to avoid overlap
                    yAlign: 'bottom',
                    callbacks: {
                        title: (items) => items[0]?.label || '',
                        label: (ctx) => {
                            const value = ctx.raw;
                            const pct = ((value / total) * 100).toFixed(1);
                            return ` QAR ${formatNum(value)} (${pct}%)`;
                        },
                        afterLabel: () => 'Click to see details →'
                    }
                }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    if (STATE.viewMode === 'parent') {
                        openParentDrilldown(labels[idx]);
                    } else {
                        openDrilldown(labels[idx]);
                    }
                }
            },
            onHover: (e, elements) => {
                e.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
            }
        }
    });
}

// INCOME VS EXPENSE BAR
function renderBudgetProjection() {
    const proj = calculateBudgetProjection();

    // Days until salary
    document.getElementById('daysUntilSalary').textContent = proj.daysUntilSalary;
    document.getElementById('nextSalaryDate').textContent = `~${proj.nextSalaryDate.format('MMM D')}`;

    // IN - OUT = NET
    document.getElementById('projIncome').textContent = formatNum(proj.income);
    document.getElementById('projExpense').textContent = formatNum(proj.expenses);
    const netEl = document.getElementById('projNet');
    netEl.textContent = formatNum(proj.net);
    netEl.className = `font-display font-bold text-lg ${proj.net >= 0 ? 'text-fact-green' : 'text-fact-red'}`;

    // Daily budget (compact format)
    document.getElementById('suggestedDaily').textContent = `${formatNum(proj.dailyBudget)}/day`;
    document.getElementById('avgDailySpend').textContent = formatNum(proj.avgDailySpend);

    // Budget status
    const statusEl = document.getElementById('budgetStatus');
    if (proj.onTrack) {
        statusEl.textContent = 'On Track';
        statusEl.className = 'text-[10px] px-2 py-0.5 rounded-full bg-fact-green/20 text-fact-green font-medium';
    } else {
        statusEl.textContent = 'Over Budget';
        statusEl.className = 'text-[10px] px-2 py-0.5 rounded-full bg-fact-red/20 text-fact-red font-medium';
    }
}

// DAILY CHART
function renderDailyChart() {
    const out = STATE.filtered.filter(t => t.direction === 'OUT');
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

    const labels = days.map(d => dayjs(d).format('MMM D'));
    const data = days.map(d => dailySpend[d] || 0);

    const ctx = document.getElementById('dailyChart');
    if (charts.daily) charts.daily.destroy();

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    charts.daily = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: '#F4C44E',
                borderRadius: 3,
                barThickness: Math.min(16, Math.max(4, 400 / days.length))
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: isDark ? '#888' : '#666',
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 8
                    }
                },
                y: {
                    grid: { color: isDark ? '#2A2A2A' : '#E5E5E5' },
                    ticks: { color: isDark ? '#888' : '#666' },
                    beginAtZero: true
                }
            }
        }
    });
}

// CUMULATIVE CHART
function renderCumulativeChart() {
    const out = STATE.filtered.filter(t => t.direction === 'OUT').sort((a, b) => a.date - b.date);
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

    let cumulative = 0;
    const data = days.map(d => {
        cumulative += (dailySpend[d] || 0);
        return cumulative;
    });

    const labels = days.map(d => dayjs(d).format('MMM D'));

    const ctx = document.getElementById('cumulativeChart');
    if (charts.cumulative) charts.cumulative.destroy();

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    charts.cumulative = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data,
                borderColor: '#B593C6',
                backgroundColor: 'rgba(181, 147, 198, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: isDark ? '#888' : '#666',
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 8
                    }
                },
                y: {
                    grid: { color: isDark ? '#2A2A2A' : '#E5E5E5' },
                    ticks: { color: isDark ? '#888' : '#666' },
                    beginAtZero: true
                }
            }
        }
    });
}

// ============== UTILS ==============

function formatNum(n) {
    return Math.round(n).toLocaleString();
}

function debounce(fn, wait) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

// Simple markdown parser fallback (if marked.js not loaded)
const marked = window.marked || {
    parse: (text) => text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>')
};

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Sanitize HTML (for markdown output) using DOMPurify
function sanitizeHTML(html) {
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'code', 'pre', 'blockquote', 'a', 'span', 'div'],
        ALLOWED_ATTR: ['href', 'target', 'class'],
        ALLOW_DATA_ATTR: false
    });
}

// ============== TOAST NOTIFICATIONS ==============

function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '✓',
        error: '✕',
        info: 'ℹ'
    };

    toast.innerHTML = `
        <span>${icons[type] || icons.info}</span>
        <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ============== PWA & SERVICE WORKER ==============

// Register service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/flow/sw.js')
            .then(reg => console.log('[PWA] Service worker registered'))
            .catch(err => console.log('[PWA] Service worker registration failed:', err));
    });
}

// PWA Install handling
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Show install banner if not dismissed before
    if (!localStorage.getItem('pwa_install_dismissed')) {
        setTimeout(() => {
            document.getElementById('installBanner').style.display = 'flex';
        }, 3000);
    }
});

function installPWA() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choice) => {
            if (choice.outcome === 'accepted') {
                console.log('[PWA] User accepted install');
            }
            deferredPrompt = null;
            document.getElementById('installBanner').style.display = 'none';
        });
    }
}

function dismissInstall() {
    document.getElementById('installBanner').style.display = 'none';
    localStorage.setItem('pwa_install_dismissed', 'true');
}

// ============== DARK MODE TOGGLE ==============

function initDarkMode() {
    const saved = localStorage.getItem('fact_dark_mode');
    const toggle = document.getElementById('themeToggle');

    if (saved === 'true') {
        document.body.classList.add('dark-mode');
        toggle.classList.add('dark');
    } else if (saved === 'false') {
        document.body.classList.remove('dark-mode');
        toggle.classList.remove('dark');
    } else {
        // Auto from system
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            toggle.classList.add('dark');
        }
    }
}

function toggleDarkMode() {
    const body = document.body;
    const toggle = document.getElementById('themeToggle');

    if (body.classList.contains('dark-mode')) {
        body.classList.remove('dark-mode');
        toggle.classList.remove('dark');
        localStorage.setItem('fact_dark_mode', 'false');
    } else {
        body.classList.add('dark-mode');
        toggle.classList.add('dark');
        localStorage.setItem('fact_dark_mode', 'true');
    }
}

// ============== FOCUS MODE - ADHD-FRIENDLY UI ==============

let isFocusMode = false;

function toggleFocusMode() {
    isFocusMode = !isFocusMode;
    localStorage.setItem(`fact_focus_mode_${STATE.currentUser}`, isFocusMode);

    applyFocusMode();

    if (isFocusMode) {
        showToast('Focus Mode enabled - simplified view', 'info');
    } else {
        showToast('Full view restored', 'info');
    }
}

function applyFocusMode() {
    const body = document.body;
    const toggle = document.getElementById('focusToggle');
    const focusHero = document.getElementById('focusHero');
    const quickInsight = document.getElementById('quickInsight');

    if (isFocusMode) {
        body.classList.add('focus-mode');
        toggle?.classList.add('active');
        focusHero?.classList.remove('hidden');
        quickInsight?.classList.remove('hidden');
        updateFocusHero();
        updateQuickInsight();
    } else {
        body.classList.remove('focus-mode');
        toggle?.classList.remove('active');
        focusHero?.classList.add('hidden');
        quickInsight?.classList.add('hidden');
    }
}

function updateFocusHero() {
    const budget = checkDailyBudget();
    const focusNumber = document.getElementById('focusHeroNumber');
    const focusDays = document.getElementById('focusDaysToSalary');
    const focusStreak = document.getElementById('focusStreak');

    if (!focusNumber) return;

    // Update the main number
    const remaining = Math.max(0, budget.remaining);
    focusNumber.textContent = `QAR ${formatNum(remaining)}`;

    // Set color based on status
    focusNumber.className = 'focus-hero-number breathe';
    if (budget.status === 'danger') {
        focusNumber.classList.add('danger');
    } else if (budget.status === 'warning') {
        focusNumber.classList.add('warning');
    } else {
        focusNumber.classList.add('positive');
    }

    // Update days to salary
    const daysUntil = document.getElementById('daysUntilSalary')?.textContent || '--';
    if (focusDays) focusDays.textContent = daysUntil;

    // Update streak
    const streak = getStreakData();
    if (focusStreak) focusStreak.textContent = streak.currentStreak || '0';
}

function updateQuickInsight() {
    const insightText = document.getElementById('quickInsightText');
    const insightSubtext = document.getElementById('quickInsightSubtext');
    if (!insightText || !insightSubtext) return;

    const budget = checkDailyBudget();
    const streak = getStreakData();

    // Generate contextual insight
    if (budget.status === 'danger') {
        insightText.textContent = "Budget alert! Consider pausing spending.";
        insightSubtext.textContent = `You've spent ${Math.round((budget.spent / budget.budget) * 100)}% of today's budget`;
    } else if (budget.status === 'warning') {
        insightText.textContent = "Halfway through your daily budget";
        insightSubtext.textContent = `QAR ${formatNum(budget.remaining)} left - spend wisely!`;
    } else if (streak.currentStreak >= 3) {
        insightText.textContent = `🔥 ${streak.currentStreak}-day streak! You're crushing it!`;
        insightSubtext.textContent = "Keep the momentum going";
    } else {
        insightText.textContent = "You're doing great today!";
        insightSubtext.textContent = `QAR ${formatNum(budget.remaining)} left to spend`;
    }
}

function initFocusMode() {
    // Load saved preference
    const saved = localStorage.getItem(`fact_focus_mode_${STATE.currentUser}`);
    if (saved === 'true') {
        isFocusMode = true;
        applyFocusMode();
    }
}

// ============== IMPULSE CONTROL ==============

// Detect impulse burst (multiple transactions in short time)
function detectImpulseBurst(transactions) {
    const bursts = [];
    const sorted = [...transactions].sort((a, b) => a.date.unix() - b.date.unix());

    for (let i = 0; i < sorted.length; i++) {
        const windowStart = sorted[i].date;
        const windowTxns = [sorted[i]];

        for (let j = i + 1; j < sorted.length; j++) {
            const diff = sorted[j].date.diff(windowStart, 'minute');
            if (diff <= 30) { // 30 minute window
                windowTxns.push(sorted[j]);
            } else {
                break;
            }
        }

        if (windowTxns.length >= 3) {
            bursts.push({
                time: windowStart,
                count: windowTxns.length,
                total: windowTxns.reduce((s, t) => s + t.amount, 0),
                transactions: windowTxns
            });
            i += windowTxns.length - 1; // Skip processed transactions
        }
    }

    return bursts;
}

// Check if user is over daily budget
function checkDailyBudget() {
    const today = dayjs().startOf('day');
    const todayTxns = STATE.allTxns.filter(t =>
        t.direction === 'OUT' &&
        t.date.isAfter(today) &&
        t.date.isBefore(today.add(1, 'day'))
    );
    const todaySpent = todayTxns.reduce((s, t) => s + t.amount, 0);

    const proj = calculateBudgetProjection();
    const dailyBudget = proj.recommended || 300; // Default 300 QAR

    const percentage = (todaySpent / dailyBudget) * 100;

    return {
        spent: todaySpent,
        budget: dailyBudget,
        remaining: Math.max(0, dailyBudget - todaySpent),
        percentage,
        status: percentage < 50 ? 'safe' : percentage < 80 ? 'warning' : 'danger'
    };
}

// Track and warn about daily budget
function updateDailyBudgetMeter() {
    const status = checkDailyBudget();
    const meterEl = document.getElementById('dailyBudgetMeter');
    if (!meterEl) return;

    const fillEl = meterEl.querySelector('.budget-meter-fill');
    if (fillEl) {
        fillEl.style.width = `${Math.min(100, status.percentage)}%`;
        fillEl.className = `budget-meter-fill ${status.status}`;
    }

    const labelEl = document.getElementById('dailyBudgetLabel');
    if (labelEl) {
        labelEl.textContent = `${formatNum(status.remaining)} left today`;
        labelEl.className = status.status === 'danger' ? 'text-fact-red' : 'text-fact-muted dark:text-fact-dark-muted';
    }

    // Show warning toast if over 80%
    if (status.percentage >= 80 && status.percentage < 100 && !STATE.dailyWarningShown) {
        showToast(`⚠️ You've used ${status.percentage.toFixed(0)}% of today's budget`, 'info');
        STATE.dailyWarningShown = true;
    } else if (status.percentage >= 100 && !STATE.dailyOverShown) {
        showToast(`🚨 Over budget today! Spent ${formatNum(status.spent)} of ${formatNum(status.budget)}`, 'error');
        STATE.dailyOverShown = true;
    }
}

// ============== STREAK TRACKING ==============

function getStreakData() {
    try {
        return JSON.parse(localStorage.getItem(`fact_streak_${STATE.currentUser}`)) || {
            currentStreak: 0,
            longestStreak: 0,
            lastGoodDay: null
        };
    } catch (e) {
        return { currentStreak: 0, longestStreak: 0, lastGoodDay: null };
    }
}

function saveStreakData(data) {
    localStorage.setItem(`fact_streak_${STATE.currentUser}`, JSON.stringify(data));
}

function updateStreak() {
    const status = checkDailyBudget();
    const streak = getStreakData();
    const today = dayjs().format('YYYY-MM-DD');
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');

    // Only update at end of day or when checking previous days
    if (status.status !== 'danger') {
        if (streak.lastGoodDay === yesterday) {
            streak.currentStreak++;
        } else if (streak.lastGoodDay !== today) {
            streak.currentStreak = 1;
        }
        streak.lastGoodDay = today;
        streak.longestStreak = Math.max(streak.longestStreak, streak.currentStreak);
    } else if (streak.lastGoodDay !== today && streak.lastGoodDay !== yesterday) {
        streak.currentStreak = 0;
    }

    saveStreakData(streak);
    return streak;
}

function renderStreakBadge() {
    const streak = getStreakData();
    const container = document.getElementById('streakContainer');
    if (!container) return;

    if (streak.currentStreak > 0) {
        container.innerHTML = `
            <div class="streak-badge">
                <span>🔥</span>
                <span>${streak.currentStreak} day${streak.currentStreak > 1 ? 's' : ''}</span>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="text-xs text-fact-muted dark:text-fact-dark-muted">
                Stay under budget to start a streak!
            </div>
        `;
    }
}

// ============== GOALS SYSTEM ==============

function getGoals() {
    try {
        return JSON.parse(localStorage.getItem(`fact_goals_${STATE.currentUser}`)) || [];
    } catch (e) {
        return [];
    }
}

function saveGoals(goals) {
    localStorage.setItem(`fact_goals_${STATE.currentUser}`, JSON.stringify(goals));
}

// ============== RECENT TRANSACTIONS ==============

function renderRecentTxns() {
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

function renderTxnRow(t) {
    const isOut = t.direction === 'OUT';
    const color = getTypeColor(t.merchantType);
    const icon = MERCHANT_TYPES[t.merchantType]?.icon || '📋';
    const safeRawData = btoa(unescape(encodeURIComponent(t.raw)));

    // Show resolved name for transfers
    const displayName = t.resolvedName ? `${t.resolvedName}` : t.display;
    const subtitle = t.resolvedLongName || t.counterparty || t.raw;

    return `
        <div class="txn-row p-3 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800" data-raw="${safeRawData}" onclick="openCatModalSafe(this)">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0" style="background:${color}20">${icon}</div>
                <div class="min-w-0">
                    <div class="font-medium text-sm truncate">${escapeHtml(displayName)}</div>
                    <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted truncate">${t.date.format('MMM D, HH:mm')} · ${escapeHtml(t.merchantType)}</div>
                </div>
            </div>
            <div class="text-right flex-shrink-0 ml-2">
                <div class="font-display font-semibold text-sm ${isOut ? '' : 'text-fact-green'}">${isOut ? '' : '+'}${formatNum(t.amount)}</div>
                ${t.currency !== 'QAR' ? `<div class="text-[10px] text-fact-muted">${t.currency}</div>` : ''}
            </div>
        </div>
    `;
}

// Safe modal openers for base64 encoded data
function openCatModalSafe(el) {
    const rawData = el.dataset.raw;
    if (rawData) {
        const raw = decodeURIComponent(escape(atob(rawData)));
        openCatModal(raw);
    }
}

function openMerchantDrilldownSafe(el) {
    const nameData = el.dataset.name;
    if (nameData) {
        const name = decodeURIComponent(escape(atob(nameData)));
        openMerchantDrilldown(name);
    }
}

// UNCATEGORIZED ALERT
function renderUncatAlert() {
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
const CATEGORY_HIERARCHY = {
    'Essentials': { icon: '🏠', subcategories: ['Groceries', 'Bills', 'Health', 'Transport'] },
    'Food & Drinks': { icon: '🍽️', subcategories: ['Dining', 'Coffee', 'Delivery', 'Bars & Nightlife'] },
    'Shopping & Fun': { icon: '🛍️', subcategories: ['Shopping', 'Entertainment', 'Travel'] },
    'Family': { icon: '👨‍👩‍👧‍👦', subcategories: ['Family'] },
    'Other': { icon: '📋', subcategories: ['Transfer', 'Other', 'Uncategorized'] }
};

function openDrilldown(category) {
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
    if (charts.drilldownTimeline) charts.drilldownTimeline.destroy();

    const color = CAT_COLORS[category] || '#999';

    charts.drilldownTimeline = new Chart(ctx, {
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

function closeDrilldown() {
    document.getElementById('drilldownModal').classList.add('hidden');
}

function openParentDrilldown(parentCategory) {
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

    const icon = CATEGORY_HIERARCHY[parentCategory]?.icon || SUMMARY_GROUPS[parentCategory]?.icon || '📦';
    document.getElementById('drilldownTitle').textContent = `${icon} ${parentCategory}`;
    document.getElementById('drilldownSubtitle').textContent = `${out.length} transactions · ${subcats.length} subcategories`;
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
    if (charts.drilldownTimeline) charts.drilldownTimeline.destroy();

    charts.drilldownTimeline = new Chart(ctx, {
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

function openMerchantDrilldown(merchantName) {
    const out = STATE.filtered.filter(t => t.direction === 'OUT' && t.consolidated === merchantName);
    const total = out.reduce((s, t) => s + t.amount, 0);
    const avgTxn = out.length > 0 ? total / out.length : 0;

    document.getElementById('drilldownTitle').textContent = merchantName;
    document.getElementById('drilldownSubtitle').textContent = `${out.length} transactions · Avg: QAR ${formatNum(avgTxn)}`;
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
    if (charts.drilldownTimeline) charts.drilldownTimeline.destroy();

    charts.drilldownTimeline = new Chart(ctx, {
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

function openUncatModal() {
    const uncat = STATE.filtered.filter(t => t.merchantType === 'Uncategorized' && t.direction === 'OUT');

    document.getElementById('uncatList').innerHTML = uncat.map(t => {
        const safeRawData = btoa(unescape(encodeURIComponent(t.raw)));
        return `
            <div class="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer" data-raw="${safeRawData}" onclick="closeUncatModal(); openCatModalSafe(this)">
                <div class="min-w-0">
                    <div class="font-medium text-sm truncate">${escapeHtml(t.raw)}</div>
                    <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted">${t.date.format('MMM D, HH:mm')}</div>
                </div>
                <div class="font-display font-semibold text-sm">${formatNum(t.amount)}</div>
            </div>
        `;
    }).join('');

    document.getElementById('uncatModal').classList.remove('hidden');
}

function closeUncatModal() {
    document.getElementById('uncatModal').classList.add('hidden');
}

// ============== CATEGORIZE MODAL ==============

function openCatModal(raw) {
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
            `Name match`;
        document.getElementById('catModalRecipientDetails').textContent = matchInfo;
        recipientSection.classList.remove('hidden');
    } else if (recipientSection) {
        recipientSection.classList.add('hidden');
    }

    document.getElementById('catModal').classList.remove('hidden');
}

function closeCatModal() {
    document.getElementById('catModal').classList.add('hidden');
}

async function saveCategorization() {
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

    STATE.allTxns.forEach(t => {
        if (t.raw.toLowerCase() === raw.toLowerCase()) {
            t.display = name;
            t.consolidated = name;
            t.merchantType = cat;
        }
    });

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
    } catch (err) {
        console.warn('Failed to sync categorization:', err.message);
    }
}

function updateCatDropdowns() {
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

function openTxnModal() {
    document.getElementById('txnModalCount').textContent = `${STATE.filtered.length} transactions`;
    document.getElementById('txnSearch').value = '';
    document.getElementById('txnFilter').value = '';
    renderTxnModal(STATE.filtered);
    document.getElementById('txnModal').classList.remove('hidden');
}

function closeTxnModal() {
    document.getElementById('txnModal').classList.add('hidden');
}

function filterTxnModal() {
    const search = document.getElementById('txnSearch').value.toLowerCase();
    const cat = document.getElementById('txnFilter').value;

    let txns = STATE.filtered;
    if (search) txns = txns.filter(t => t.display.toLowerCase().includes(search) || t.raw.toLowerCase().includes(search));
    if (cat) txns = txns.filter(t => t.merchantType === cat);

    document.getElementById('txnModalCount').textContent = `${txns.length} transactions`;
    renderTxnModal(txns);
}

function renderTxnModal(txns) {
    document.getElementById('txnModalList').innerHTML = txns.slice(0, 100).map(t => renderTxnRow(t)).join('');
}

// ============== AI INTEGRATION ==============

function openAIQuery() {
    const chatInput = document.getElementById('aiChatInput');
    if (chatInput) {
        chatInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => chatInput.focus(), 300);
    }
}

function closeAIQuery() {
    // No-op - kept for backwards compatibility
}

function prepareTransactionSummary() {
    const txns = STATE.filtered.filter(t => t.direction === 'OUT');

    // Group by merchant type
    const byType = {};
    txns.forEach(t => {
        if (!byType[t.merchantType]) byType[t.merchantType] = { total: 0, count: 0, txns: [] };
        byType[t.merchantType].total += t.amount;
        byType[t.merchantType].count++;
        byType[t.merchantType].txns.push(t);
    });

    // Build summary
    let summary = `Period: ${STATE.dateRange.start.format('MMM D')} - ${STATE.dateRange.end.format('MMM D, YYYY')}\n`;
    summary += `Total Transactions: ${txns.length}\n`;
    summary += `Total Spent: QAR ${formatNum(txns.reduce((s, t) => s + t.amount, 0))}\n\n`;

    summary += `By Type:\n`;
    Object.entries(byType)
        .sort((a, b) => b[1].total - a[1].total)
        .forEach(([type, data]) => {
            summary += `- ${type}: QAR ${formatNum(data.total)} (${data.count} txns)\n`;
        });

    summary += `\nRecent transactions (last 30):\n`;
    txns.slice(0, 30).forEach(t => {
        summary += `${t.date.format('MMM D HH:mm')} | ${t.display} | QAR ${formatNum(t.amount)} | ${t.merchantType} | ${t.dims.when.join(', ')} | ${t.dims.pattern}\n`;
    });

    return summary;
}

// Conversational AI Chat
const aiChatHistory = [];

async function askAIChat(question) {
    const query = question || document.getElementById('aiChatInput')?.value?.trim();
    if (!query) return;

    const messagesDiv = document.getElementById('aiChatMessages');
    const inputEl = document.getElementById('aiChatInput');
    if (inputEl) inputEl.value = '';

    // Add user message to chat
    if (messagesDiv) {
        messagesDiv.innerHTML += `
            <div class="flex justify-end">
                <div class="bg-fact-yellow/20 rounded-lg px-3 py-2 max-w-[85%]">
                    <p class="text-sm">${escapeHtml(query)}</p>
                </div>
            </div>
        `;
    }

    // Add to history
    aiChatHistory.push({ role: 'user', content: query });

    // Show loading
    const loadingId = 'loading-' + Date.now();
    if (messagesDiv) {
        messagesDiv.innerHTML += `
            <div id="${loadingId}" class="flex justify-start">
                <div class="bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2">
                    <p class="text-sm text-fact-muted animate-pulse">Thinking...</p>
                </div>
            </div>
        `;
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    try {
        // Prepare context with transaction data + conversation history
        const txnSummary = prepareTransactionSummary();
        const historyContext = aiChatHistory.slice(-6).map(m =>
            `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
        ).join('\n');

        const fullContext = `Transaction Data:\n${txnSummary}\n\nConversation:\n${historyContext}`;

        const { data: session } = await supabaseClient.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) throw new Error('Not authenticated');

        const response = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-ai`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                q: query,
                data: fullContext,
                model: getSelectedAiModel()
            })
        });
        const data = await response.json();

        if (data.error) throw new Error(data.error);

        // Handle "remember" responses specially
        if (data.remembered) {
            aiChatHistory.push({ role: 'assistant', content: data.message });
            const loadingEl = document.getElementById(loadingId);
            if (loadingEl) {
                loadingEl.innerHTML = `
                    <div class="bg-fact-green/10 border border-fact-green/30 rounded-lg px-3 py-2 max-w-[85%]">
                        <div class="flex items-center gap-1 text-fact-green text-xs font-medium mb-1">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                            </svg>
                            Noted
                        </div>
                        <p class="text-sm">${sanitizeHTML(data.message)}</p>
                    </div>
                `;
            }
            return;
        }

        const answer = data.answer;

        if (!answer || answer.trim() === '') {
            throw new Error('No response received from AI. Please try again.');
        }

        aiChatHistory.push({ role: 'assistant', content: answer });

        // Update model name
        if (data.model) {
            const modelEl = document.getElementById('aiModelName');
            if (modelEl) {
                const modeIndicator = data.mode === 'deep' ? ' <span class="text-fact-green">●</span>' : '';
                const ctx = data.contextLoaded;
                const hasContext = ctx && (ctx.income + ctx.payees + ctx.corrections + ctx.preferences + (ctx.rules || 0) > 0);
                const ctxIndicator = hasContext ? ' <span class="text-fact-purple" title="Using your context">◆</span>' : '';
                modelEl.innerHTML = escapeHtml(data.model) + modeIndicator + ctxIndicator;
            }
        }

        // Replace loading with answer
        const ctx = data.contextLoaded;
        const hasContext = ctx && (ctx.income + ctx.payees + ctx.corrections + ctx.preferences + (ctx.rules || 0) > 0);
        const modeBadge = data.mode === 'deep'
            ? '<div class="text-[9px] text-fact-green font-medium mb-1">✦ DEEP ANALYSIS</div>'
            : '';
        const ctxParts = [];
        if (ctx?.income) ctxParts.push(`${ctx.income} income`);
        if (ctx?.payees) ctxParts.push(`${ctx.payees} payees`);
        if (ctx?.corrections) ctxParts.push(`${ctx.corrections} corrections`);
        if (ctx?.rules) ctxParts.push(`${ctx.rules} rules`);
        if (ctx?.merchants) ctxParts.push(`${ctx.merchants} merchants`);
        const ctxBadge = hasContext
            ? `<div class="text-[9px] text-fact-purple font-medium mb-1">◆ Using ${ctxParts.join(', ')}</div>`
            : '';

        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) {
            // Simple markdown parser for marked
            const parsedAnswer = typeof marked !== 'undefined' && marked.parse
                ? marked.parse(answer)
                : answer.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                       .replace(/\*(.*?)\*/g, '<em>$1</em>')
                       .replace(/\n/g, '<br>');
            loadingEl.innerHTML = `
                <div class="bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 max-w-[85%]">
                    ${modeBadge}${ctxBadge}
                    <div class="text-sm prose prose-sm dark:prose-invert">${sanitizeHTML(parsedAnswer)}</div>
                </div>
            `;
        }

        // Track AI usage achievement
        trackAchievement('fact_asked_ai');

    } catch (err) {
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) {
            loadingEl.innerHTML = `
                <div class="bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2">
                    <p class="text-sm text-fact-red">Error: ${escapeHtml(err.message)}</p>
                </div>
            `;
        }
    }

    if (messagesDiv) messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function clearAIChat() {
    aiChatHistory.length = 0;
    const messagesDiv = document.getElementById('aiChatMessages');
    if (messagesDiv) {
        messagesDiv.innerHTML = `
            <div class="text-fact-muted dark:text-fact-dark-muted text-xs">Ask me anything about your spending...</div>
        `;
    }
}

// ============== QUICK INSIGHTS ==============

function renderQuickInsights() {
    const out = STATE.filtered.filter(t => t.direction === 'OUT');
    const insights = [];

    // Night out patterns
    const nightOuts = out.filter(t => t.dims.pattern === 'Night Out');
    if (nightOuts.length > 0) {
        const total = nightOuts.reduce((s, t) => s + t.amount, 0);
        insights.push({
            icon: '🎉',
            text: `${nightOuts.length} Night Out transactions totaling QAR ${formatNum(total)}`,
            filter: 'nightOut'
        });
    }

    // Work expense candidates
    const workExpenses = out.filter(t => t.dims.pattern === 'Work Expense');
    if (workExpenses.length > 0) {
        const total = workExpenses.reduce((s, t) => s + t.amount, 0);
        insights.push({
            icon: '💼',
            text: `${workExpenses.length} potential work expenses (QAR ${formatNum(total)})`,
            filter: 'workHours'
        });
    }

    // Splurges
    const splurges = out.filter(t => t.dims.pattern === 'Splurge');
    if (splurges.length > 0) {
        const total = splurges.reduce((s, t) => s + t.amount, 0);
        insights.push({
            icon: '💸',
            text: `${splurges.length} splurge purchases (QAR ${formatNum(total)})`,
            filter: 'splurge'
        });
    }

    // Subscriptions
    const subs = out.filter(t => t.dims.pattern === 'Subscription');
    if (subs.length > 0) {
        const merchants = [...new Set(subs.map(t => t.consolidated))];
        insights.push({
            icon: '📅',
            text: `${merchants.length} detected subscriptions`,
            filter: 'subscription'
        });
    }

    // Late night spending
    const lateNight = out.filter(t => t.isLateNight);
    if (lateNight.length >= 3) {
        const total = lateNight.reduce((s, t) => s + t.amount, 0);
        insights.push({
            icon: '🌙',
            text: `QAR ${formatNum(total)} spent late at night (${lateNight.length} txns)`,
            filter: 'lateNight'
        });
    }

    // Large purchases
    const large = out.filter(t => t.isLarge);
    if (large.length > 0) {
        insights.push({
            icon: '••••',
            text: `${large.length} large purchases (500+ QAR each)`,
            filter: 'large'
        });
    }

    // Render insights
    const tagsContainer = document.getElementById('insightsTags');
    const insightsSection = document.getElementById('insightsSection');
    const countEl = document.getElementById('insightsCount');

    if (countEl) countEl.textContent = insights.length;

    if (!insightsSection) return;

    if (insights.length === 0) {
        insightsSection.classList.add('hidden');
    } else {
        insightsSection.classList.remove('hidden');

        const colorMap = {
            'nightOut': 'bg-fact-purple/15 text-fact-purple border-fact-purple/30',
            'workHours': 'bg-fact-yellow/15 text-fact-ink border-fact-yellow/50',
            'splurge': 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800',
            'subscription': 'bg-fact-green/15 text-fact-green border-fact-green/30',
            'lateNight': 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800',
            'large': 'bg-gray-100 dark:bg-gray-800 text-fact-ink dark:text-fact-dark-ink border-fact-border dark:border-fact-dark-border'
        };

        if (tagsContainer) {
            tagsContainer.innerHTML = insights.map(i => {
                const colors = colorMap[i.filter] || 'bg-gray-100 dark:bg-gray-800 text-fact-muted border-fact-border';
                return `<button onclick="filterByDimension('${i.filter}')"
                    class="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full border ${colors} hover:scale-105 transition-transform cursor-pointer">
                    <span>${i.icon}</span>
                    <span>${i.text}</span>
                </button>`;
            }).join('');
        }
    }
}

function closeAiInsights() {
    const container = document.getElementById('aiInsightsContainer');
    if (container) container.classList.add('hidden');
}

async function refreshInsights() {
    const btn = document.getElementById('refreshInsightsBtn');
    const aiContainer = document.getElementById('aiInsightsContainer');
    const aiList = document.getElementById('aiInsightsList');

    if (!btn) return;

    // Show loading state
    btn.disabled = true;
    btn.innerHTML = `
        <svg class="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
        </svg>
        Analyzing...
    `;

    try {
        const txnSummary = prepareTransactionSummary();
        const contextSummary = STATE.userContext.length > 0
            ? '\n\nUser corrections/context: ' + STATE.userContext.map(c => c.value).join('; ')
            : '';

        const { data: session } = await supabaseClient.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) throw new Error('Not authenticated');

        const response = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-ai`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                q: 'Give me 3-5 quick bullet-point insights about this spending data. Be specific with numbers. Focus on patterns, anomalies, and actionable observations. Use emojis for each point. Keep each insight to one short sentence.' + contextSummary,
                data: txnSummary,
                model: 'gpt-5.1'
            })
        });

        const data = await response.json();

        if (data.error) throw new Error(data.error);

        const aiInsights = data.answer
            .split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => line.replace(/^[-*•]\s*/, '').trim())
            .filter(line => line.length > 0)
            .slice(0, 5);

        if (aiInsights.length > 0 && aiContainer && aiList) {
            aiContainer.classList.remove('hidden');
            aiList.innerHTML = aiInsights.map(insight => `
                <div class="px-2.5 py-1.5 text-[11px] bg-gradient-to-r from-fact-purple/5 to-fact-yellow/5 border border-fact-purple/20 rounded-lg text-fact-ink dark:text-fact-dark-ink">
                    ${sanitizeHTML(insight)}
                </div>
            `).join('');
        }

    } catch (err) {
        if (aiContainer && aiList) {
            aiContainer.classList.remove('hidden');
            aiList.innerHTML = `<div class="text-[11px] text-fact-red">Error: ${escapeHtml(err.message)}</div>`;
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = `
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            Refresh
        `;
    }
}

// ============== DIMENSION FILTERING ==============

function filterByDimension(dimension) {
    let filtered = [];
    let title = '';

    const out = STATE.filtered.filter(t => t.direction === 'OUT');

    switch (dimension) {
        case 'workHours':
            filtered = out.filter(t => t.isWorkHours);
            title = '💼 Work Hours Spending';
            break;
        case 'lateNight':
            filtered = out.filter(t => t.isLateNight);
            title = '🌙 Late Night Spending';
            break;
        case 'nightOut':
            filtered = out.filter(t => t.dims.pattern === 'Night Out');
            title = '🎉 Night Out Sessions';
            break;
        case 'splurge':
            filtered = out.filter(t => t.dims.pattern === 'Splurge');
            title = '💸 Splurge Purchases';
            break;
        case 'large':
            filtered = out.filter(t => t.isLarge);
            title = '•••• Large Purchases (500+ QAR)';
            break;
        case 'subscription':
            filtered = out.filter(t => t.dims.pattern === 'Subscription');
            title = '📅 Detected Subscriptions';
            break;
        case 'clear':
            closeFilteredModal();
            return;
        default:
            return;
    }

    showFilteredResults(filtered, title);
}

function showFilteredResults(txns, title) {
    const total = txns.reduce((s, t) => s + t.amount, 0);
    const avg = txns.length > 0 ? total / txns.length : 0;

    document.getElementById('filteredTitle').textContent = title;
    document.getElementById('filteredSubtitle').textContent = `${txns.length} transactions`;
    document.getElementById('filteredTotal').textContent = `QAR ${formatNum(total)}`;
    document.getElementById('filteredCount').textContent = txns.length;
    document.getElementById('filteredAvg').textContent = `QAR ${formatNum(avg)}`;

    document.getElementById('filteredList').innerHTML = txns.map(t => renderTxnRowEnhanced(t)).join('');

    document.getElementById('filteredModal').classList.remove('hidden');
}

function closeFilteredModal() {
    document.getElementById('filteredModal').classList.add('hidden');
}

function renderTxnRowEnhanced(t) {
    const isOut = t.direction === 'OUT';
    const color = getTypeColor(t.merchantType);
    const icon = MERCHANT_TYPES[t.merchantType]?.icon || '📋';
    const patternLabel = escapeHtml(t.dims.pattern);
    const patternBadge = t.dims.pattern !== 'Normal' ?
        `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">${PATTERNS[t.dims.pattern]?.icon || ''} ${patternLabel}</span>` : '';

    return `
        <div class="txn-row p-3 flex items-center justify-between">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center text-sm" style="background:${color}20">${icon}</div>
                <div class="min-w-0">
                    <div class="font-medium text-sm truncate">${escapeHtml(t.display)}</div>
                    <div class="flex items-center gap-2 text-[10px] text-fact-muted dark:text-fact-dark-muted">
                        <span>${t.date.format('MMM D, HH:mm')}</span>
                        <span>·</span>
                        <span>${escapeHtml(t.dims.when.join(', '))}</span>
                        ${patternBadge}
                    </div>
                </div>
            </div>
            <div class="text-right">
                <div class="font-display font-semibold text-sm ${isOut ? '' : 'text-fact-green'}">${isOut ? '' : '+'}${formatNum(t.amount)}</div>
                <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted">${t.dims.size}</div>
            </div>
        </div>
    `;
}

// ============== VOICE INPUT ==============

let recognition = null;
let isListening = false;

function initVoiceRecognition() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
            const transcript = Array.from(event.results)
                .map(result => result[0].transcript)
                .join('');
            const inputEl = document.getElementById('aiChatInput');
            if (inputEl) inputEl.value = transcript;
        };

        recognition.onend = () => {
            isListening = false;
            const voiceBtn = document.getElementById('voiceBtn');
            const voiceStatus = document.getElementById('voiceStatus');
            if (voiceBtn) voiceBtn.classList.remove('listening');
            if (voiceStatus) voiceStatus.classList.add('hidden');
            // Auto-submit if we have text
            const input = document.getElementById('aiChatInput');
            if (input && input.value.trim()) {
                askAIChat();
            }
        };

        recognition.onerror = (event) => {
            console.error('Voice recognition error:', event.error);
            isListening = false;
            const voiceBtn = document.getElementById('voiceBtn');
            const voiceStatus = document.getElementById('voiceStatus');
            if (voiceBtn) voiceBtn.classList.remove('listening');
            if (voiceStatus) voiceStatus.classList.add('hidden');
        };
    }
}

function toggleVoiceInput() {
    if (!recognition) {
        initVoiceRecognition();
    }

    if (!recognition) {
        alert('Voice input is not supported in this browser');
        return;
    }

    const voiceBtn = document.getElementById('voiceBtn');
    const voiceStatus = document.getElementById('voiceStatus');

    if (isListening) {
        recognition.stop();
        isListening = false;
        if (voiceBtn) voiceBtn.classList.remove('listening');
        if (voiceStatus) voiceStatus.classList.add('hidden');
    } else {
        recognition.start();
        isListening = true;
        if (voiceBtn) voiceBtn.classList.add('listening');
        if (voiceStatus) voiceStatus.classList.remove('hidden');
        trackAchievement('fact_used_voice');
        const inputEl = document.getElementById('aiChatInput');
        if (inputEl) inputEl.value = '';
    }
}

// ============== GOALS EXTENDED ==============

function openGoals() {
    openSettings('goals');
}

function closeGoals() {
    closeSettings();
}

function renderSettingsGoalsList() {
    const goals = getGoals();
    const container = document.getElementById('settingsGoalsList');
    if (!container) return;

    if (goals.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8">
                <div class="text-3xl mb-2">🎯</div>
                <p class="text-sm text-fact-muted dark:text-fact-dark-muted">No budget goals set yet</p>
                <p class="text-xs text-fact-muted dark:text-fact-dark-muted mt-1">Set spending limits to track your progress</p>
            </div>
        `;
        return;
    }

    const now = dayjs();
    const monthStart = now.startOf('month');
    const monthTxns = STATE.allTxns.filter(t =>
        t.direction === 'OUT' &&
        t.date.isAfter(monthStart) &&
        t.date.isBefore(now.add(1, 'day'))
    );

    const spendByCategory = {};
    monthTxns.forEach(t => {
        spendByCategory[t.merchantType] = (spendByCategory[t.merchantType] || 0) + t.amount;
    });

    const daysInMonth = now.daysInMonth();
    const daysPassed = now.date();
    const dayProgress = (daysPassed / daysInMonth) * 100;

    container.innerHTML = goals.map((goal, i) => {
        const spent = spendByCategory[goal.category] || 0;
        const pct = Math.min(100, (spent / goal.amount) * 100);
        const remaining = Math.max(0, goal.amount - spent);
        const color = pct > 100 ? '#E57373' : pct > 80 ? '#F4C44E' : '#75B876';
        const typeInfo = MERCHANT_TYPES[goal.category] || {};

        return `
            <div class="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2">
                        <span class="text-lg">${typeInfo.icon || '📋'}</span>
                        <span class="font-medium text-sm">${escapeHtml(goal.category)}</span>
                    </div>
                    <button onclick="deleteGoal(${i})" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-fact-red/10 text-fact-muted hover:text-fact-red transition" aria-label="Delete goal">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                <div class="flex items-baseline justify-between mb-2">
                    <div class="font-display">
                        <span class="text-xl font-bold">${formatNum(spent)}</span>
                        <span class="text-sm text-fact-muted dark:text-fact-dark-muted">/ ${formatNum(goal.amount)}</span>
                    </div>
                    <span class="text-xs ${pct > 100 ? 'text-fact-red' : 'text-fact-green'}">${formatNum(remaining)} left</span>
                </div>
                <div class="goal-progress">
                    <div class="goal-progress-bar" style="width: ${pct}%; background: ${color}"></div>
                    <div class="goal-progress-marker" style="left: ${dayProgress}%" title="Expected pace"></div>
                </div>
                <div class="flex justify-between mt-2 text-[10px] text-fact-muted dark:text-fact-dark-muted">
                    <span>${pct.toFixed(0)}% used</span>
                    <span>${pct > dayProgress ? '⚠️ Ahead of pace' : '✓ On track'}</span>
                </div>
            </div>
        `;
    }).join('');
}

function addNewGoal() {
    const categories = Object.keys(MERCHANT_TYPES).filter(c => c !== 'Uncategorized');
    const goalCategory = document.getElementById('goalCategory');
    if (goalCategory) {
        goalCategory.innerHTML = categories.map(c =>
            `<option value="${c}">${MERCHANT_TYPES[c]?.icon || ''} ${c}</option>`
        ).join('');
    }
    const goalAmount = document.getElementById('goalAmount');
    if (goalAmount) goalAmount.value = '';
    document.getElementById('addGoalModal').classList.remove('hidden');
}

function closeAddGoal() {
    document.getElementById('addGoalModal').classList.add('hidden');
}

function saveGoal() {
    const category = document.getElementById('goalCategory').value;
    const amount = parseFloat(document.getElementById('goalAmount').value);

    if (!category || !amount || amount <= 0) {
        showToast('Please select a category and enter a valid amount', 'error');
        return;
    }

    const goals = getGoals();
    const existing = goals.findIndex(g => g.category === category);
    if (existing >= 0) {
        goals[existing].amount = amount;
        showToast(`Updated ${category} goal`, 'success');
    } else {
        goals.push({ category, amount });
        showToast(`Added ${category} goal`, 'success');
    }
    saveGoals(goals);

    closeAddGoal();
    renderSettingsGoalsList();
}

async function deleteGoal(index) {
    const goals = getGoals();
    const goal = goals[index];

    const confirmed = await showConfirm({
        title: 'Delete Budget Goal',
        message: `Remove the ${goal.category} budget of QAR ${formatNum(goal.amount)}?`,
        confirmText: 'Delete',
        cancelText: 'Keep',
        type: 'danger'
    });

    if (confirmed) {
        goals.splice(index, 1);
        saveGoals(goals);
        renderSettingsGoalsList();
        showToast(`Removed ${goal.category} goal`, 'info');
    }
}

// ============== RECIPIENTS MANAGEMENT ==============

function renderRecipientsList() {
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
                <div class="text-3xl mb-2">👥</div>
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
                    ${r.phone ? `<span>📱 ${escapeHtml(r.phone)}</span>` : ''}
                    ${r.bankAccount ? `<span>🏦 ...${escapeHtml(r.bankAccount.slice(-4))}</span>` : ''}
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

function filterRecipientsList() {
    renderRecipientsList();
}

function addNewRecipient() {
    document.getElementById('recipientModalTitle').textContent = 'Add Contact';
    document.getElementById('recipientEditIndex').value = '-1';
    document.getElementById('recipientPhone').value = '';
    document.getElementById('recipientBankAccount').value = '';
    document.getElementById('recipientShortName').value = '';
    document.getElementById('recipientLongName').value = '';
    document.getElementById('recipientModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('recipientShortName')?.focus(), 100);
}

function editRecipient(index) {
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

function closeRecipientModal() {
    document.getElementById('recipientModal').classList.add('hidden');
}

async function saveRecipient() {
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
        console.error('Save recipient error:', err);
        showToast('Failed to save: ' + err.message, 'error');
    }
}

async function deleteRecipient(index) {
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
        console.error('Delete recipient error:', err);
        showToast('Failed to delete: ' + err.message, 'error');
    }
}

// ============== HEATMAP ==============

function openHeatmap() {
    renderHeatmap();
    document.getElementById('heatmapModal').classList.remove('hidden');
    trackAchievement('fact_viewed_heatmap');
}

function closeHeatmap() {
    document.getElementById('heatmapModal').classList.add('hidden');
}

function renderHeatmap() {
    const container = document.getElementById('heatmapContainer');
    if (!container) return;

    const out = STATE.allTxns.filter(t => t.direction === 'OUT');

    const endDate = dayjs();
    const startDate = endDate.subtract(90, 'day');

    const dailySpend = {};
    out.forEach(t => {
        if (t.date.isAfter(startDate) && t.date.isBefore(endDate.add(1, 'day'))) {
            const key = t.date.format('YYYY-MM-DD');
            dailySpend[key] = (dailySpend[key] || 0) + t.amount;
        }
    });

    const amounts = Object.values(dailySpend);
    const maxSpend = Math.max(...amounts, 1);
    const avgSpend = amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;

    const weeks = [];
    let currentWeek = [];
    let d = startDate;

    const startDow = d.day();
    for (let i = 0; i < startDow; i++) {
        currentWeek.push(null);
    }

    while (d.isBefore(endDate) || d.isSame(endDate, 'day')) {
        const key = d.format('YYYY-MM-DD');
        const amount = dailySpend[key] || 0;
        currentWeek.push({ date: d, amount, key });

        if (d.day() === 6) {
            weeks.push(currentWeek);
            currentWeek = [];
        }
        d = d.add(1, 'day');
    }
    if (currentWeek.length > 0) {
        weeks.push(currentWeek);
    }

    const getColor = (amount) => {
        if (amount === 0) return '#E5E5E5';
        const ratio = amount / maxSpend;
        if (ratio < 0.25) return '#C6E48B';
        if (ratio < 0.5) return '#7BC96F';
        if (ratio < 0.75) return '#239A3B';
        return '#196127';
    };

    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    container.innerHTML = `
        <div class="flex gap-1">
            <div class="flex flex-col gap-1 text-[9px] text-fact-muted dark:text-fact-dark-muted mr-1">
                ${dayLabels.map((l, i) => `<div class="h-3 flex items-center">${i % 2 === 1 ? l : ''}</div>`).join('')}
            </div>
            ${weeks.map((week) => `
                <div class="flex flex-col gap-1">
                    ${[0,1,2,3,4,5,6].map(dow => {
                        const cell = week[dow];
                        if (!cell) return '<div class="heatmap-cell" style="background: transparent"></div>';
                        const color = getColor(cell.amount);
                        const tooltip = `${cell.date.format('MMM D')}: QAR ${formatNum(cell.amount)}`;
                        return `<div class="heatmap-cell" style="background: ${color}" title="${tooltip}" onclick="drilldownDate('${cell.key}')"></div>`;
                    }).join('')}
                </div>
            `).join('')}
        </div>
        <div class="mt-4 grid grid-cols-3 gap-4 text-center text-xs">
            <div>
                <div class="text-lg font-display font-bold">${formatNum(amounts.reduce((a, b) => a + b, 0))}</div>
                <div class="text-fact-muted dark:text-fact-dark-muted">Total (90 days)</div>
            </div>
            <div>
                <div class="text-lg font-display font-bold">${formatNum(avgSpend)}</div>
                <div class="text-fact-muted dark:text-fact-dark-muted">Daily Avg</div>
            </div>
            <div>
                <div class="text-lg font-display font-bold">${formatNum(maxSpend)}</div>
                <div class="text-fact-muted dark:text-fact-dark-muted">Max Day</div>
            </div>
        </div>
    `;
}

function drilldownDate(dateKey) {
    const date = dayjs(dateKey);
    const txns = STATE.allTxns.filter(t =>
        t.direction === 'OUT' &&
        t.date.format('YYYY-MM-DD') === dateKey
    );
    showFilteredResults(txns, `📅 ${date.format('MMM D, YYYY')}`);
    closeHeatmap();
}

// ============== CSV EXPORT ==============

function exportCSV() {
    const icon = document.getElementById('exportIcon');
    if (icon) icon.classList.add('export-spin');

    try {
        const headers = ['Date', 'Time', 'Amount', 'Currency', 'Merchant', 'Category', 'Direction', 'Pattern'];
        const rows = STATE.filtered.map(t => [
            t.date.format('YYYY-MM-DD'),
            t.date.format('HH:mm'),
            t.amount.toFixed(2),
            t.currency,
            `"${t.display.replace(/"/g, '""')}"`,
            t.merchantType,
            t.direction,
            t.dims.pattern
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `fact-flow-${STATE.dateRange.start.format('YYYY-MM-DD')}-to-${STATE.dateRange.end.format('YYYY-MM-DD')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast(`Exported ${rows.length} transactions`, 'success');
        trackAchievement('fact_exported');
    } catch (err) {
        showToast('Export failed: ' + err.message, 'error');
    } finally {
        setTimeout(() => {
            if (icon) icon.classList.remove('export-spin');
        }, 500);
    }
}

// ============== ACHIEVEMENTS ==============

const ACHIEVEMENTS = {
    'first-login': { icon: '🚀', name: 'First Steps', desc: 'Opened FACT/Flow for the first time', check: () => true },
    'first-categorize': { icon: '🏷️', name: 'Organizer', desc: 'Categorized your first transaction', check: () => Object.keys(STATE.localMappings || {}).length > 0 },
    'ten-categorize': { icon: '📋', name: 'Sorting Pro', desc: 'Categorized 10 transactions', check: () => Object.keys(STATE.localMappings || {}).length >= 10 },
    'first-goal': { icon: '🎯', name: 'Goal Setter', desc: 'Set your first budget goal', check: () => getGoals().length > 0 },
    'three-goals': { icon: '🎪', name: 'Triple Threat', desc: 'Set 3 budget goals', check: () => getGoals().length >= 3 },
    'streak-3': { icon: '🔥', name: 'On Fire', desc: '3-day under-budget streak', check: () => getStreakData().longestStreak >= 3 },
    'streak-7': { icon: '⚡', name: 'Week Warrior', desc: '7-day under-budget streak', check: () => getStreakData().longestStreak >= 7 },
    'ask-ai': { icon: '🤖', name: 'AI Explorer', desc: 'Asked AI for spending advice', check: () => localStorage.getItem('fact_asked_ai') === 'true' },
    'voice-input': { icon: '🎤', name: 'Voice Commander', desc: 'Used voice input', check: () => localStorage.getItem('fact_used_voice') === 'true' },
    'dark-mode': { icon: '🌙', name: 'Night Owl', desc: 'Switched to dark mode', check: () => localStorage.getItem('fact_dark_mode') === 'true' },
    'export-data': { icon: '📊', name: 'Data Analyst', desc: 'Exported your data to CSV', check: () => localStorage.getItem('fact_exported') === 'true' },
    'heatmap-view': { icon: '🗓️', name: 'Pattern Seeker', desc: 'Viewed the spending heatmap', check: () => localStorage.getItem('fact_viewed_heatmap') === 'true' },
    'generosity-set': { icon: '💜', name: 'Generous Heart', desc: 'Set a generosity budget', check: () => localStorage.getItem(`fact_generosity_${STATE.currentUser}`) !== null }
};

function getUnlockedAchievements() {
    try {
        return JSON.parse(localStorage.getItem(`fact_achievements_${STATE.currentUser}`)) || [];
    } catch (e) {
        return [];
    }
}

function saveUnlockedAchievements(achievements) {
    localStorage.setItem(`fact_achievements_${STATE.currentUser}`, JSON.stringify(achievements));
}

function checkAchievements() {
    const unlocked = getUnlockedAchievements();
    const newUnlocks = [];

    Object.entries(ACHIEVEMENTS).forEach(([id, achievement]) => {
        if (!unlocked.includes(id) && achievement.check()) {
            unlocked.push(id);
            newUnlocks.push({ id, ...achievement });
        }
    });

    if (newUnlocks.length > 0) {
        saveUnlockedAchievements(unlocked);
        setTimeout(() => celebrate(newUnlocks[0]), 500);
    }

    return unlocked;
}

function celebrate(achievement) {
    const overlay = document.getElementById('celebrationOverlay');
    if (!overlay) return;

    const confettiColors = ['#F4C44E', '#75B876', '#B593C6', '#E57373', '#64B5F6'];
    let confettiHtml = '';
    for (let i = 0; i < 50; i++) {
        const color = confettiColors[Math.floor(Math.random() * confettiColors.length)];
        const left = Math.random() * 100;
        const delay = Math.random() * 2;
        const size = 5 + Math.random() * 10;
        confettiHtml += `<div class="confetti" style="left: ${left}%; background: ${color}; width: ${size}px; height: ${size}px; animation-delay: ${delay}s; border-radius: ${Math.random() > 0.5 ? '50%' : '0'}"></div>`;
    }

    overlay.innerHTML = `
        <div class="celebration-overlay" onclick="closeCelebration()">
            ${confettiHtml}
            <div class="celebration-box" onclick="event.stopPropagation()">
                <div class="celebration-icon">${achievement.icon}</div>
                <h2 class="font-display font-bold text-xl text-fact-ink mt-2">Achievement Unlocked!</h2>
                <h3 class="font-display font-semibold text-lg text-fact-ink mt-1">${achievement.name}</h3>
                <p class="text-sm text-fact-ink/70 mt-2">${achievement.desc}</p>
                <button onclick="closeCelebration()" class="mt-4 px-6 py-2 bg-fact-ink text-white rounded-full font-medium">
                    Awesome! 🎉
                </button>
            </div>
        </div>
    `;
    overlay.classList.remove('hidden');

    setTimeout(closeCelebration, 5000);
}

function closeCelebration() {
    const overlay = document.getElementById('celebrationOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.innerHTML = '';
    }
}

function openAchievements() {
    const unlocked = getUnlockedAchievements();
    const container = document.getElementById('achievementsList');
    const progress = document.getElementById('achievementProgress');

    if (progress) {
        progress.textContent = `${unlocked.length} of ${Object.keys(ACHIEVEMENTS).length} unlocked`;
    }

    if (container) {
        container.innerHTML = Object.entries(ACHIEVEMENTS).map(([id, a]) => {
            const isUnlocked = unlocked.includes(id);
            return `
                <div class="achievement-badge ${isUnlocked ? '' : 'locked'}">
                    <div class="badge-icon">${a.icon}</div>
                    <div class="text-xs font-medium">${a.name}</div>
                    <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mt-1">${isUnlocked ? a.desc : '???'}</div>
                </div>
            `;
        }).join('');
    }

    document.getElementById('achievementsModal').classList.remove('hidden');
}

function closeAchievements() {
    document.getElementById('achievementsModal').classList.add('hidden');
}

function trackAchievement(key) {
    localStorage.setItem(key, 'true');
    setTimeout(checkAchievements, 100);
}

// ============== CONFIRMATION DIALOG ==============

function showConfirm(options) {
    return new Promise((resolve) => {
        const { title, message, confirmText = 'Confirm', cancelText = 'Cancel', type = 'warning' } = options;
        const modal = document.getElementById('confirmModal');
        if (!modal) {
            resolve(false);
            return;
        }

        const colors = {
            warning: { bg: 'bg-fact-yellow', icon: '⚠️' },
            danger: { bg: 'bg-fact-red', icon: '🗑️' },
            info: { bg: 'bg-fact-purple', icon: 'ℹ️' }
        };
        const color = colors[type] || colors.warning;

        modal.innerHTML = `
            <div class="confirm-overlay" onclick="event.target === this && confirmResolve(false)">
                <div class="confirm-box">
                    <div class="text-4xl mb-4">${color.icon}</div>
                    <h3 class="font-display font-semibold text-lg mb-2">${escapeHtml(title)}</h3>
                    <p class="text-sm text-fact-muted dark:text-fact-dark-muted mb-6">${escapeHtml(message)}</p>
                    <div class="flex gap-3">
                        <button onclick="confirmResolve(false)" class="flex-1 px-4 py-2 text-sm rounded-lg border border-fact-border dark:border-fact-dark-border hover:bg-gray-50 dark:hover:bg-gray-800">${cancelText}</button>
                        <button onclick="confirmResolve(true)" class="flex-1 px-4 py-2 text-sm rounded-lg ${color.bg} text-white font-medium">${confirmText}</button>
                    </div>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');

        window.confirmResolve = (result) => {
            modal.classList.add('hidden');
            modal.innerHTML = '';
            resolve(result);
        };
    });
}

// ============== GENEROSITY BUDGET ==============

const DEFAULT_GENEROSITY_CATEGORIES = [
    { id: 'gifts', name: 'Gifts & Presents', default: true },
    { id: 'charity', name: 'Charity & Donations', default: true },
    { id: 'treats', name: 'Treating Others (meals, drinks)', default: true },
    { id: 'social', name: 'Social Outings (I paid for everyone)', default: false },
    { id: 'family', name: 'Family Support', default: false }
];

function getGenerositySettings() {
    try {
        const stored = localStorage.getItem(`fact_generosity_${STATE.currentUser}`);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {}
    return null;
}

function saveGenerositySettings() {
    const budgetInput = document.getElementById('generosityBudgetInput');
    const budget = parseFloat(budgetInput?.value) || 0;

    const selectedCategories = [];
    document.querySelectorAll('#generosityCategories input[type="checkbox"]:checked').forEach(cb => {
        selectedCategories.push(cb.value);
    });

    const settings = {
        budget: budget,
        categories: selectedCategories,
        enabled: budget > 0
    };

    localStorage.setItem(`fact_generosity_${STATE.currentUser}`, JSON.stringify(settings));

    setTimeout(() => checkAchievements(), 500);

    closeGenerositySettings();
    renderGenerosityBudget();
    showToast('Generosity budget saved! 💜', 'success');
}

function openGenerositySettings() {
    const settings = getGenerositySettings() || { budget: 0, categories: ['gifts', 'charity', 'treats'], enabled: false };

    const budgetInput = document.getElementById('generosityBudgetInput');
    if (budgetInput) budgetInput.value = settings.budget || '';

    const container = document.getElementById('generosityCategories');
    if (container) {
        container.innerHTML = DEFAULT_GENEROSITY_CATEGORIES.map(cat => {
            const checked = settings.categories?.includes(cat.id) || (!settings.categories && cat.default);
            return `
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" value="${cat.id}" ${checked ? 'checked' : ''}
                        class="w-4 h-4 rounded border-fact-border text-fact-purple focus:ring-fact-purple">
                    <span>${cat.name}</span>
                </label>
            `;
        }).join('');
    }

    document.getElementById('generosityModal').classList.remove('hidden');
}

function closeGenerositySettings() {
    document.getElementById('generosityModal').classList.add('hidden');
}

function renderGenerosityBudget() {
    const settings = getGenerositySettings();
    const card = document.getElementById('generosityCard');

    if (!card) return;

    if (!settings || !settings.enabled) {
        card.classList.add('hidden');
        return;
    }

    card.classList.remove('hidden');

    // Calculate generosity spending (simplified)
    const now = dayjs();
    const monthStart = now.startOf('month');
    const monthTxns = STATE.allTxns.filter(t =>
        t.direction === 'OUT' &&
        t.date.isAfter(monthStart) &&
        t.date.isBefore(now.add(1, 'day'))
    );

    // For now, just estimate based on Family transfers
    const generosityTxns = monthTxns.filter(t =>
        t.merchantType === 'Family' || t.summaryGroup === 'Family'
    );

    const spent = generosityTxns.reduce((s, t) => s + t.amount, 0);
    const remaining = Math.max(0, settings.budget - spent);
    const percentage = settings.budget > 0 ? Math.min((spent / settings.budget) * 100, 100) : 0;

    const spentEl = document.getElementById('generositySpent');
    const budgetEl = document.getElementById('generosityBudget');
    const fillEl = document.getElementById('generosityMeterFill');
    const statusEl = document.getElementById('generosityStatus');

    if (spentEl) spentEl.textContent = `QAR ${formatNum(spent)}`;
    if (budgetEl) budgetEl.textContent = `QAR ${formatNum(settings.budget)}`;
    if (fillEl) {
        fillEl.style.width = `${percentage}%`;
        fillEl.className = `generosity-meter-fill ${spent > settings.budget ? 'over' : ''}`;
    }
    if (statusEl) {
        if (spent > settings.budget) {
            statusEl.textContent = `Over budget by QAR ${formatNum(spent - settings.budget)}`;
            statusEl.className = 'text-xs text-fact-red';
        } else {
            statusEl.textContent = `QAR ${formatNum(remaining)} left to give 💜`;
            statusEl.className = 'text-xs text-fact-muted dark:text-fact-dark-muted';
        }
    }
}

// ============== HEALTH SCORE ==============

function openHealthScore() {
    const modal = document.getElementById('healthScoreModal');
    if (!modal) return;

    // Calculate simple health score
    const budgetStatus = checkDailyBudget();
    const streak = getStreakData();
    const goals = getGoals();

    let score = 50; // Base score
    if (budgetStatus.status === 'safe') score += 20;
    else if (budgetStatus.status === 'warning') score += 10;
    score += Math.min(20, streak.currentStreak * 4);
    score += Math.min(10, goals.length * 3);

    const scoreEl = document.getElementById('healthScoreNumber');
    if (scoreEl) scoreEl.textContent = score;

    const statusEl = document.getElementById('healthStatusLabel');
    const descEl = document.getElementById('healthStatusDesc');

    if (statusEl && descEl) {
        if (score >= 80) {
            statusEl.textContent = 'Excellent!';
            descEl.textContent = 'Your finances are in great shape';
        } else if (score >= 60) {
            statusEl.textContent = 'Good';
            descEl.textContent = 'You\'re on the right track';
        } else {
            statusEl.textContent = 'Needs Work';
            descEl.textContent = 'Let\'s focus on building better habits';
        }
    }

    modal.classList.remove('hidden');
    trackAchievement('fact_health_score');
}

function closeHealthScore() {
    document.getElementById('healthScoreModal').classList.add('hidden');
}

// ============== PATTERN DETECTION ==============

function renderPatternWarnings() {
    // Analyze patterns and show nudges if relevant
    const now = dayjs();
    const hour = now.hour();

    // Late night nudge
    if ((hour >= 22 || hour < 5) && !sessionStorage.getItem('fact_nudge_shown')) {
        sessionStorage.setItem('fact_nudge_shown', 'true');
        if (Math.random() > 0.7) {
            showToast('🌙 Late night spending? Sleep on it!', 'info');
        }
    }
}

// ============== INIT ENHANCEMENTS ==============

// Initialize all enhancements on load
document.addEventListener('DOMContentLoaded', () => {
    initFocusMode();
    initDarkMode();
});

// Export functions that need to be accessible globally (for onclick handlers in HTML)
window.attemptLogin = attemptLogin;
window.loginWithGoogle = loginWithGoogle;
window.logout = logout;
window.showApp = showApp;
window.syncData = syncData;
window.setPeriod = setPeriod;
window.setSalaryPeriod = setSalaryPeriod;
window.openDatePicker = openDatePicker;
window.closeDatePicker = closeDatePicker;
window.applyCustomDate = applyCustomDate;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;
window.switchSettingsTab = switchSettingsTab;
window.generateShortcutKey = generateShortcutKey;
window.revokeShortcutKey = revokeShortcutKey;
window.copyShortcutKey = copyShortcutKey;
window.openShortcutSetup = openShortcutSetup;
window.closeShortcutSetup = closeShortcutSetup;
window.changePassword = changePassword;
window.setViewMode = setViewMode;
window.sortTransactions = sortTransactions;
window.filterTransactions = filterTransactions;
window.openOnboarding = openOnboarding;
window.closeOnboarding = closeOnboarding;
window.onboardingNext = onboardingNext;
window.onboardingPrev = onboardingPrev;
window.selectOnboardingBank = selectOnboardingBank;
window.onboardingGenerateKey = onboardingGenerateKey;
window.copyOnboardingKey = copyOnboardingKey;
window.toggleDarkMode = toggleDarkMode;
window.toggleFocusMode = toggleFocusMode;
window.dismissImpulseBanner = dismissImpulseBanner;
window.installPWA = installPWA;
window.dismissInstall = dismissInstall;
window.showToast = showToast;
window.formatNum = formatNum;
window.escapeHtml = escapeHtml;
window.sanitizeHTML = sanitizeHTML;
window.getGoals = getGoals;
window.saveGoals = saveGoals;
window.checkDailyBudget = checkDailyBudget;
window.getStreakData = getStreakData;
window.STATE = STATE;
window.CONFIG = CONFIG;
window.supabaseClient = supabaseClient;
window.dayjs = dayjs;
window.Chart = Chart;
window.MERCHANT_TYPES = MERCHANT_TYPES;
window.SUMMARY_GROUPS = SUMMARY_GROUPS;
window.CAT_COLORS = CAT_COLORS;
window.PATTERNS = PATTERNS;

// Additional exports for onclick handlers in HTML
window.askAIChat = askAIChat;
window.clearAIChat = clearAIChat;
window.closeAchievements = closeAchievements;
window.closeAiInsights = closeAiInsights;
window.closeGenerositySettings = closeGenerositySettings;
window.closeHealthScore = closeHealthScore;
window.exportCSV = exportCSV;
window.filterByDimension = filterByDimension;
window.openGenerositySettings = openGenerositySettings;
window.openGoals = openGoals;
window.openHeatmap = openHeatmap;
window.openTxnModal = openTxnModal;
window.openUncatModal = openUncatModal;
window.refreshInsights = refreshInsights;
window.saveGenerositySettings = saveGenerositySettings;
window.toggleVoiceInput = toggleVoiceInput;

// Additional modal and UI function exports
window.renderRecentTxns = renderRecentTxns;
window.openDrilldown = openDrilldown;
window.closeDrilldown = closeDrilldown;
window.openParentDrilldown = openParentDrilldown;
window.openMerchantDrilldown = openMerchantDrilldown;
window.closeUncatModal = closeUncatModal;
window.openCatModal = openCatModal;
window.closeCatModal = closeCatModal;
window.saveCategorization = saveCategorization;
window.closeTxnModal = closeTxnModal;
window.closeFilteredModal = closeFilteredModal;
window.showFilteredResults = showFilteredResults;
window.closeHeatmap = closeHeatmap;
window.openAchievements = openAchievements;
window.openHealthScore = openHealthScore;
window.renderQuickInsights = renderQuickInsights;
window.renderGenerosityBudget = renderGenerosityBudget;
window.renderPatternWarnings = renderPatternWarnings;
window.checkAchievements = checkAchievements;
window.showConfirm = showConfirm;
window.renderSettingsGoalsList = renderSettingsGoalsList;
window.addNewGoal = addNewGoal;
window.saveGoal = saveGoal;
window.deleteGoal = deleteGoal;
window.renderRecipientsList = renderRecipientsList;
window.renderHeatmap = renderHeatmap;
window.prepareTransactionSummary = prepareTransactionSummary;
window.initVoiceRecognition = initVoiceRecognition;
