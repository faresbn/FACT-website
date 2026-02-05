// ============== MAIN.JS - THIN ORCHESTRATOR ==============
// This file imports all modules and coordinates the application

import { createClient } from '@supabase/supabase-js';
import Chart from 'chart.js/auto';
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';

// Import styles
import './style.css';

// Initialize dayjs plugins
dayjs.extend(isBetween);

// ─── IMPORTS FROM MODULES ───────────────────────────────────────

// Utils module
import {
    formatNum,
    debounce,
    escapeHtml,
    sanitizeHTML,
    showToast,
    initServiceWorker,
    initPWAInstall,
    installPWA,
    dismissInstall,
    initDarkMode,
    toggleDarkMode
} from './modules/utils.js';

// Onboarding module
import {
    checkOnboarding,
    openOnboarding,
    closeOnboarding,
    onboardingNext,
    onboardingPrev,
    renderOnboardingStep,
    selectOnboardingBank,
    onboardingGenerateKey,
    copyOnboardingKey
} from './modules/onboarding.js';

// Data module
import {
    syncData,
    loadLocal,
    saveLocal,
    processTxns,
    categorize,
    matchRecipient,
    normalizePhone,
    isExemptFromSplurge
} from './modules/data.js';

// Patterns module
import {
    detectPatterns,
    detectSalary,
    getNextSalaryDate,
    setSalaryPeriod as setSalaryPeriodModule,
    calculateBudgetProjection as calculateBudgetProjectionModule
} from './modules/patterns.js';

// Settings module
import {
    setPeriod as setPeriodModule,
    updateDateRangeDisplay as updateDateRangeDisplayModule,
    openDatePicker,
    closeDatePicker,
    applyCustomDate as applyCustomDateModule,
    switchSettingsTab,
    openSettings as openSettingsModule,
    closeSettings,
    saveSettings as saveSettingsModule,
    generateShortcutKey,
    revokeShortcutKey,
    copyShortcutKey,
    openShortcutSetup,
    closeShortcutSetup,
    getSelectedAiModel,
    changePassword
} from './modules/settings.js';

// Render module
import {
    filterAndRender as filterAndRenderModule,
    renderTodaySection as renderTodaySectionModule,
    renderCategoryBreakdown as renderCategoryBreakdownModule,
    sortTransactions as sortTransactionsModule,
    filterTransactions as filterTransactionsModule,
    setViewMode as setViewModeModule,
    renderMetrics
} from './modules/render.js';

// Charts module
import {
    charts,
    renderDonutChart as renderDonutChartModule,
    renderBudgetProjection as renderBudgetProjectionModule,
    renderDailyChart,
    renderCumulativeChart
} from './modules/charts.js';

// Focus module
import {
    isFocusMode,
    toggleFocusMode as toggleFocusModeModule,
    applyFocusMode,
    updateFocusHero as updateFocusHeroModule,
    updateQuickInsight as updateQuickInsightModule,
    initFocusMode,
    detectImpulseBurst,
    checkDailyBudget as checkDailyBudgetModule,
    updateDailyBudgetMeter as updateDailyBudgetMeterModule,
    checkForImpulseBursts as checkForImpulseBurstsModule,
    dismissImpulseBanner as dismissImpulseBannerModule,
    getStreakData as getStreakDataModule,
    saveStreakData,
    updateStreak as updateStreakModule,
    renderStreakBadge as renderStreakBadgeModule
} from './modules/focus.js';

// Goals module
import {
    getGoals as getGoalsModule,
    saveGoals as saveGoalsModule,
    openGoals as openGoalsModule,
    closeGoals,
    renderSettingsGoalsList as renderSettingsGoalsListModule,
    addNewGoal as addNewGoalModule,
    closeAddGoal,
    saveGoal as saveGoalModule,
    deleteGoal as deleteGoalModule
} from './modules/goals.js';

// Modals module
import {
    renderRecentTxns as renderRecentTxnsModule,
    renderTxnRow as renderTxnRowModule,
    openCatModalSafe as openCatModalSafeModule,
    openMerchantDrilldownSafe,
    renderUncatAlert as renderUncatAlertModule,
    CATEGORY_HIERARCHY,
    openDrilldown as openDrilldownModule,
    closeDrilldown,
    openParentDrilldown as openParentDrilldownModule,
    openMerchantDrilldown as openMerchantDrilldownModule,
    openUncatModal as openUncatModalModule,
    closeUncatModal,
    openCatModal as openCatModalModule,
    closeCatModal,
    saveCategorization as saveCategorizationModule,
    updateCatDropdowns as updateCatDropdownsModule,
    openTxnModal as openTxnModalModule,
    closeTxnModal,
    filterTxnModal as filterTxnModalModule,
    renderTxnModal as renderTxnModalModule
} from './modules/modals.js';

// AI module
import {
    openAIQuery,
    closeAIQuery,
    prepareTransactionSummary as prepareTransactionSummaryModule,
    askAIChat as askAIChatModule,
    clearAIChat,
    renderQuickInsights as renderQuickInsightsModule,
    closeAiInsights,
    refreshInsights as refreshInsightsModule
} from './modules/ai.js';

// Filters module
import {
    filterByDimension as filterByDimensionModule,
    showFilteredResults as showFilteredResultsModule,
    closeFilteredModal,
    renderTxnRowEnhanced as renderTxnRowEnhancedModule,
    initVoiceRecognition,
    toggleVoiceInput as toggleVoiceInputModule
} from './modules/filters.js';

// Recipients module
import {
    renderRecipientsList as renderRecipientsListModule,
    filterRecipientsList,
    addNewRecipient,
    editRecipient as editRecipientModule,
    closeRecipientModal,
    saveRecipient as saveRecipientModule,
    deleteRecipient as deleteRecipientModule
} from './modules/recipients.js';

// Features module
import {
    openHeatmap as openHeatmapModule,
    closeHeatmap,
    renderHeatmap as renderHeatmapModule,
    drilldownDate as drilldownDateModule,
    exportCSV as exportCSVModule,
    ACHIEVEMENTS,
    getUnlockedAchievements,
    saveUnlockedAchievements,
    checkAchievements as checkAchievementsModule,
    celebrate,
    closeCelebration,
    openAchievements as openAchievementsModule,
    closeAchievements,
    trackAchievement as trackAchievementModule,
    showConfirm as showConfirmModule,
    DEFAULT_GENEROSITY_CATEGORIES,
    getGenerositySettings,
    saveGenerositySettings as saveGenerositySettingsModule,
    openGenerositySettings as openGenerositySettingsModule,
    closeGenerositySettings,
    renderGenerosityBudget as renderGenerosityBudgetModule,
    openHealthScore as openHealthScoreModule,
    closeHealthScore,
    renderPatternWarnings as renderPatternWarningsModule
} from './modules/features.js';

// ─── CONFIG ─────────────────────────────────────────────────────

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

// ─── DIMENSION-BASED CATEGORIZATION SYSTEM ──────────────────────

// DIMENSION 1: WHAT (merchant type)
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
    'Work Hours': { color: '#3498DB', hours: [7, 16], days: [0, 1, 2, 3, 4], icon: '💼' },
    'Evening': { color: '#9B59B6', hours: [17, 21], icon: '🌆' },
    'Late Night': { color: '#2C3E50', hours: [21, 4], icon: '🌙' },
    'Weekend': { color: '#E74C3C', days: [5, 6], icon: '🎉' },
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

// DIMENSION 4: PATTERN
const PATTERNS = {
    'Routine': { color: '#3498DB', icon: '🔄', description: 'Regular, repeated spending' },
    'Night Out': { color: '#9B59B6', icon: '🎉', description: 'Evening social spending cluster' },
    'Splurge': { color: '#E74C3C', icon: '💸', description: 'Unusually large purchase' },
    'Trip': { color: '#E67E22', icon: '✈️', description: 'Travel-related cluster' },
    'Subscription': { color: '#1ABC9C', icon: '📅', description: 'Recurring fixed amount' },
    'Work Expense': { color: '#3498DB', icon: '💼', description: 'Likely work-related' },
    'Normal': { color: '#95A5A6', icon: '○', description: 'Standard transaction' }
};

// High-level groupings for summary view
const SUMMARY_GROUPS = {
    'Essentials': { color: '#75B876', icon: '🏠', types: ['Groceries', 'Bills', 'Health', 'Transport'] },
    'Food & Drinks': { color: '#F4C44E', icon: '🍽️', types: ['Dining', 'Coffee', 'Delivery', 'Bars & Nightlife'] },
    'Shopping & Fun': { color: '#9B8AC4', icon: '🛍️', types: ['Shopping', 'Entertainment', 'Travel'] },
    'Family': { color: '#E8A4B8', icon: '👨‍👩‍👧‍👦', types: ['Family'] },
    'Other': { color: '#A8B5C4', icon: '📋', types: ['Transfer', 'Other', 'Uncategorized'] }
};

// Build CAT_COLORS from MERCHANT_TYPES and SUMMARY_GROUPS
const CAT_COLORS = {};
Object.entries(MERCHANT_TYPES).forEach(([name, data]) => CAT_COLORS[name] = data.color);
Object.entries(SUMMARY_GROUPS).forEach(([name, data]) => CAT_COLORS[name] = data.color);

// Compute functions
function getSummaryGroup(merchantType) {
    for (const [group, data] of Object.entries(SUMMARY_GROUPS)) {
        if (data.types.includes(merchantType)) return group;
    }
    return 'Other';
}

function getTimeContext(date) {
    const hour = date.hour();
    const day = date.day();
    const contexts = [];

    if (day === 5 || day === 6) contexts.push('Weekend');
    if (hour >= 7 && hour < 16 && day >= 0 && day <= 4) contexts.push('Work Hours');
    if (hour >= 17 && hour < 21) contexts.push('Evening');
    if (hour >= 21 || hour < 5) contexts.push('Late Night');
    if (hour >= 5 && hour < 7) contexts.push('Early Morning');

    return contexts.length > 0 ? contexts : ['Normal'];
}

function getSizeTier(amount) {
    for (const [tier, data] of Object.entries(SIZE_TIERS)) {
        if (amount <= data.max) return tier;
    }
    return 'Major';
}

function getTypeColor(type) {
    return MERCHANT_TYPES[type]?.color || '#95A5A6';
}

function getGroupColor(group) {
    return SUMMARY_GROUPS[group]?.color || '#95A5A6';
}

// ─── STATE ──────────────────────────────────────────────────────

const STATE = {
    allTxns: [],
    filtered: [],
    merchantMap: [],
    recipients: [],
    categories: new Set(),
    fxRates: { ...CONFIG.DEFAULT_FX },
    localMappings: {},
    userContext: [],
    period: 'salary',
    dateRange: { start: dayjs().subtract(60, 'day'), end: dayjs() },
    catTarget: null,
    currentUser: 'default',
    viewMode: 'parent',
    hasLoaded: false
};

// ─── WRAPPER FUNCTIONS ──────────────────────────────────────────
// These wrap module functions with the necessary dependencies

function filterAndRender() {
    filterAndRenderModule(STATE, {
        renderBudgetProjection,
        renderDonutChart,
        renderCategoryBreakdown,
        renderRecentTxns,
        renderUncatAlert,
        renderQuickInsights,
        renderTodaySection,
        checkForImpulseBursts
    });
}

function renderTodaySection() {
    renderTodaySectionModule(STATE, {
        checkDailyBudget,
        formatNum,
        updateDailyBudgetMeter,
        updateStreak,
        renderStreakBadge,
        renderGenerosityBudget,
        updateFocusHero,
        updateQuickInsight,
        isFocusMode
    });
}

function renderCategoryBreakdown() {
    renderCategoryBreakdownModule(STATE, { formatNum, escapeHtml, SUMMARY_GROUPS, MERCHANT_TYPES });
}

function renderDonutChart() {
    renderDonutChartModule(STATE, { formatNum, CAT_COLORS, SUMMARY_GROUPS });
}

function renderBudgetProjection() {
    renderBudgetProjectionModule(STATE, { calculateBudgetProjection, formatNum });
}

function calculateBudgetProjection() {
    return calculateBudgetProjectionModule(STATE);
}

function setSalaryPeriod() {
    setSalaryPeriodModule(STATE, filterAndRender, updateDateRangeDisplay);
}

function setPeriod(period) {
    setPeriodModule(period, STATE, filterAndRender, updateDateRangeDisplay);
}

function updateDateRangeDisplay() {
    updateDateRangeDisplayModule(STATE);
}

function applyCustomDate() {
    applyCustomDateModule(STATE, filterAndRender);
}

function checkDailyBudget() {
    return checkDailyBudgetModule(STATE, calculateBudgetProjection);
}

function updateDailyBudgetMeter() {
    updateDailyBudgetMeterModule(STATE, { checkDailyBudget, formatNum, showToast });
}

function checkForImpulseBursts() {
    checkForImpulseBurstsModule(STATE, formatNum);
}

function dismissImpulseBanner() {
    dismissImpulseBannerModule(STATE);
}

function getStreakData() {
    return getStreakDataModule(STATE);
}

function updateStreak() {
    return updateStreakModule(STATE, checkDailyBudget);
}

function renderStreakBadge() {
    renderStreakBadgeModule(STATE);
}

function getGoals() {
    return getGoalsModule(STATE);
}

function saveGoals(goals) {
    saveGoalsModule(goals, STATE);
}

function toggleFocusMode() {
    toggleFocusModeModule(STATE, showToast);
}

function updateFocusHero() {
    updateFocusHeroModule(STATE, { checkDailyBudget, formatNum, getStreakData });
}

function updateQuickInsight() {
    updateQuickInsightModule(STATE, { checkDailyBudget, formatNum, getStreakData });
}

function renderRecentTxns() {
    renderRecentTxnsModule(STATE, { renderTxnRow });
}

function renderTxnRow(t) {
    return renderTxnRowModule(t, { formatNum, escapeHtml, getTypeColor, MERCHANT_TYPES });
}

function renderUncatAlert() {
    renderUncatAlertModule(STATE, formatNum);
}

function openDrilldown(category) {
    openDrilldownModule(category, STATE, { formatNum, escapeHtml, CAT_COLORS, renderTxnRow, SUMMARY_GROUPS });
}

function openParentDrilldown(parentCategory) {
    openParentDrilldownModule(parentCategory, STATE, { formatNum, escapeHtml, CAT_COLORS, getGroupColor, renderTxnRow, SUMMARY_GROUPS });
}

function openMerchantDrilldown(merchantName) {
    openMerchantDrilldownModule(merchantName, STATE, { formatNum, escapeHtml, CAT_COLORS, renderTxnRow });
}

function openUncatModal() {
    openUncatModalModule(STATE, { formatNum, escapeHtml });
}

function openCatModal(raw) {
    openCatModalModule(raw, STATE);
}

function openCatModalSafe(el) {
    openCatModalSafeModule(el, openCatModal);
}

async function saveCategorization() {
    await saveCategorizationModule(STATE, supabaseClient, CONFIG, { saveLocal: () => saveLocal(CONFIG, STATE), filterAndRender });
}

function updateCatDropdowns() {
    updateCatDropdownsModule(STATE, escapeHtml);
}

function openTxnModal() {
    openTxnModalModule(STATE, renderTxnModal);
}

function renderTxnModal(txns) {
    renderTxnModalModule(txns, renderTxnRow);
}

function filterTxnModal() {
    filterTxnModalModule(STATE, renderTxnModal);
}

function setViewMode(mode) {
    setViewModeModule(mode, STATE, renderCategoryBreakdown, renderDonutChart);
}

function sortTransactions(sortBy) {
    sortTransactionsModule(sortBy, STATE, renderRecentTxns);
}

function filterTransactions(query) {
    filterTransactionsModule(query, STATE, renderRecentTxns);
}

function renderQuickInsights() {
    renderQuickInsightsModule(STATE, { formatNum, escapeHtml, PATTERNS });
}

async function askAIChat(question) {
    await askAIChatModule(question, STATE, supabaseClient, CONFIG, {
        formatNum, escapeHtml, sanitizeHTML, getSelectedAiModel, trackAchievement
    });
}

async function refreshInsights() {
    await refreshInsightsModule(STATE, supabaseClient, CONFIG, {
        formatNum, escapeHtml, sanitizeHTML, prepareTransactionSummary
    });
}

function prepareTransactionSummary() {
    return prepareTransactionSummaryModule(STATE, formatNum);
}

function filterByDimension(dimension) {
    filterByDimensionModule(dimension, STATE, { showFilteredResults });
}

function showFilteredResults(txns, title) {
    showFilteredResultsModule(txns, title, { formatNum, renderTxnRowEnhanced });
}

function renderTxnRowEnhanced(t) {
    return renderTxnRowEnhancedModule(t, { formatNum, escapeHtml, getTypeColor, MERCHANT_TYPES, PATTERNS });
}

function toggleVoiceInput() {
    toggleVoiceInputModule(trackAchievement, askAIChat);
}

function openSettings(tab = null) {
    openSettingsModule(tab, { renderSettingsGoalsList, renderRecipientsList });
}

function saveSettings() {
    saveSettingsModule(showToast);
}

function renderSettingsGoalsList() {
    renderSettingsGoalsListModule(STATE, { formatNum, escapeHtml, MERCHANT_TYPES, showConfirm, showToast });
}

function addNewGoal() {
    addNewGoalModule(MERCHANT_TYPES);
}

function saveGoal() {
    saveGoalModule(STATE, { showToast, renderSettingsGoalsList });
}

async function deleteGoal(index) {
    await deleteGoalModule(index, STATE, { showConfirm, showToast, formatNum, renderSettingsGoalsList });
}

function openGoals() {
    openGoalsModule(openSettings);
}

function renderRecipientsList() {
    renderRecipientsListModule(STATE, { escapeHtml });
}

function editRecipient(index) {
    editRecipientModule(index, STATE);
}

async function saveRecipient() {
    await saveRecipientModule(STATE, supabaseClient, CONFIG, { showToast, renderRecipientsList });
}

async function deleteRecipient(index) {
    await deleteRecipientModule(index, STATE, supabaseClient, CONFIG, { showToast, showConfirm, renderRecipientsList });
}

function openHeatmap() {
    openHeatmapModule(STATE, { renderHeatmap, trackAchievement });
}

function renderHeatmap() {
    renderHeatmapModule(STATE, { formatNum, showFilteredResults });
}

function drilldownDate(dateKey) {
    drilldownDateModule(dateKey, STATE, { showFilteredResults });
}

function exportCSV() {
    exportCSVModule(STATE, { formatNum, showToast, trackAchievement });
}

function checkAchievements() {
    return checkAchievementsModule(STATE, { getGoals, getStreakData, celebrate });
}

function trackAchievement(key) {
    trackAchievementModule(key, checkAchievements);
}

function openAchievements() {
    openAchievementsModule(STATE, { escapeHtml });
}

function showConfirm(options) {
    return showConfirmModule(options, escapeHtml);
}

function openGenerositySettings() {
    openGenerositySettingsModule(STATE);
}

function saveGenerositySettings() {
    saveGenerositySettingsModule(STATE, { showToast, checkAchievements, renderGenerosityBudget });
}

function renderGenerosityBudget() {
    renderGenerosityBudgetModule(STATE, formatNum);
}

function openHealthScore() {
    openHealthScoreModule(STATE, { checkDailyBudget, getStreakData, getGoals, trackAchievement });
}

function renderPatternWarnings() {
    renderPatternWarningsModule(showToast);
}

// ─── AUTH & INIT ────────────────────────────────────────────────

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
            options: { emailRedirectTo: CONFIG.AUTH_REDIRECT_URL }
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
        options: { redirectTo: CONFIG.AUTH_REDIRECT_URL }
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
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');

    STATE.currentUser = user.email || 'user';
    STATE.authToken = null;

    const userDisplay = document.getElementById('currentUserDisplay');
    userDisplay.textContent = (user.email || 'User').split('@')[0];

    const modelEl = document.getElementById('aiModelName');
    if (modelEl) {
        modelEl.textContent = localStorage.getItem('fact_ai_model') || 'gpt-5-mini';
    }

    if (window.location.hash && window.location.hash.includes('access_token')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    loadLocal(CONFIG, STATE);

    // Sync data with callbacks
    await syncData(supabaseClient, CONFIG, STATE, {
        showToast,
        filterAndRender,
        checkAchievements,
        renderPatternWarnings,
        setSalaryPeriod,
        setPeriod,
        updateCatDropdowns,
        MERCHANT_TYPES,
        getSummaryGroup,
        getTimeContext,
        getSizeTier,
        categorize: (raw, aiType) => categorize(raw, aiType, STATE, MERCHANT_TYPES),
        detectPatterns: () => detectPatterns(STATE, (t) => isExemptFromSplurge(t, STATE)),
        matchRecipient: (cp) => matchRecipient(cp, STATE)
    });

    checkOnboarding(supabaseClient);

    const txnSearch = document.getElementById('txnSearch');
    const txnFilter = document.getElementById('txnFilter');
    if (txnSearch) txnSearch.addEventListener('input', debounce(filterTxnModal, 200));
    if (txnFilter) txnFilter.addEventListener('change', filterTxnModal);
}

async function logout() {
    await supabaseClient.auth.signOut();
    location.reload();
}

// Initialize enhancements
document.addEventListener('DOMContentLoaded', () => {
    initFocusMode(STATE);
    initDarkMode();
    initServiceWorker();
    initPWAInstall();
});

// ─── WINDOW EXPORTS ─────────────────────────────────────────────
// Export functions for HTML onclick handlers

window.attemptLogin = attemptLogin;
window.loginWithGoogle = loginWithGoogle;
window.logout = logout;
window.showApp = showApp;
window.syncData = () => syncData(supabaseClient, CONFIG, STATE, {
    showToast, filterAndRender, checkAchievements, renderPatternWarnings, setSalaryPeriod, setPeriod, updateCatDropdowns,
    MERCHANT_TYPES, getSummaryGroup, getTimeContext, getSizeTier,
    categorize: (raw, aiType) => categorize(raw, aiType, STATE, MERCHANT_TYPES),
    detectPatterns: () => detectPatterns(STATE, (t) => isExemptFromSplurge(t, STATE)),
    matchRecipient: (cp) => matchRecipient(cp, STATE)
});
window.setPeriod = setPeriod;
window.setSalaryPeriod = setSalaryPeriod;
window.openDatePicker = () => openDatePicker(STATE);
window.closeDatePicker = closeDatePicker;
window.applyCustomDate = applyCustomDate;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;
window.switchSettingsTab = (tab) => switchSettingsTab(tab, { renderSettingsGoalsList, renderRecipientsList });
window.generateShortcutKey = () => generateShortcutKey(supabaseClient, CONFIG);
window.revokeShortcutKey = () => revokeShortcutKey(supabaseClient, CONFIG);
window.copyShortcutKey = copyShortcutKey;
window.openShortcutSetup = () => openShortcutSetup(CONFIG);
window.closeShortcutSetup = closeShortcutSetup;
window.changePassword = () => changePassword(supabaseClient);
window.setViewMode = setViewMode;
window.sortTransactions = sortTransactions;
window.filterTransactions = filterTransactions;
window.openOnboarding = openOnboarding;
window.closeOnboarding = closeOnboarding;
window.onboardingNext = onboardingNext;
window.onboardingPrev = onboardingPrev;
window.selectOnboardingBank = selectOnboardingBank;
window.onboardingGenerateKey = () => onboardingGenerateKey(supabaseClient, CONFIG);
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

window.renderRecentTxns = renderRecentTxns;
window.openDrilldown = openDrilldown;
window.closeDrilldown = closeDrilldown;
window.openParentDrilldown = openParentDrilldown;
window.openMerchantDrilldown = openMerchantDrilldown;
window.closeUncatModal = closeUncatModal;
window.openCatModal = openCatModal;
window.openCatModalSafe = openCatModalSafe;
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
window.closeAddGoal = closeAddGoal;
window.saveGoal = saveGoal;
window.deleteGoal = deleteGoal;
window.renderRecipientsList = renderRecipientsList;
window.addNewRecipient = addNewRecipient;
window.editRecipient = editRecipient;
window.closeRecipientModal = closeRecipientModal;
window.saveRecipient = saveRecipient;
window.deleteRecipient = deleteRecipient;
window.filterRecipientsList = () => filterRecipientsList(STATE, { escapeHtml });
window.renderHeatmap = renderHeatmap;
window.drilldownDate = drilldownDate;
window.prepareTransactionSummary = prepareTransactionSummary;
window.initVoiceRecognition = () => initVoiceRecognition(askAIChat);
window.closeCelebration = closeCelebration;
window.confirmResolve = () => {}; // Placeholder, set dynamically in showConfirm
