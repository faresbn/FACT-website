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
    initOnboarding,
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
    changePassword,
    runBackfill,
    loadProfileTab as loadProfileTabModule,
    saveProfile as saveProfileModule
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
    deleteGoal as deleteGoalModule,
    migrateGoalsToDb
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

// Insights module
import {
    prepareTransactionSummary as prepareTransactionSummaryModule,
    renderQuickInsights as renderQuickInsightsModule,
    closeAiInsights,
    refreshInsights as refreshInsightsModule,
    renderRecurringSummary as renderRecurringSummaryModule,
    renderProactiveInsights as renderProactiveInsightsModule
} from './modules/insights.js';

// Chat module (new streaming chat)
import { initChat, toggleChat, openChat, closeChat } from './modules/chat.js';

// Visualizations module
import {
    renderSpendingTrend,
    renderMerchantTreemap,
    renderPeriodComparison,
    renderTimeHeatmap,
    renderSmartMetrics
} from './modules/visualizations.js';

// Event bus
import { emit, on, EVENTS } from './modules/events.js';

// Filters module
import {
    filterByDimension as filterByDimensionModule,
    showFilteredResults as showFilteredResultsModule,
    closeFilteredModal,
    renderTxnRowEnhanced as renderTxnRowEnhancedModule,
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

const supabaseClient = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        autoRefreshToken: true,
        persistSession: true
    }
});

// Initialize modules that need CONFIG
initOnboarding(CONFIG);

// Constants module
import {
    MERCHANT_TYPES, TIME_CONTEXTS, SIZE_TIERS, PATTERNS,
    SUMMARY_GROUPS, CAT_COLORS,
    getSummaryGroup, getTimeContext, getSizeTier, getTypeColor, getGroupColor
} from './modules/constants.js';

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
    hasLoaded: false,
    profile: null,
    dbGoals: null,
    dbInsights: null,
    dbStreaks: null,
    recurring: [],
    hourlySpend: [],
    proactiveInsights: []
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
    // Render new visualizations after filter
    renderAllVisualizations();
    // Render recurring subscriptions and proactive alerts
    renderRecurringSummary();
    renderProactiveInsights();
    // Emit event for any module listening for data changes
    emit(EVENTS.DATA_FILTERED, { count: STATE.filtered.length, period: STATE.period });
}

function renderAllVisualizations() {
    renderSpendingTrend(STATE, { formatNum, SUMMARY_GROUPS });
    renderMerchantTreemap(STATE, { formatNum, SUMMARY_GROUPS });
    renderPeriodComparison(STATE, { formatNum, SUMMARY_GROUPS });
    renderTimeHeatmap(STATE, { formatNum });
    renderSmartMetrics(STATE, { formatNum, SUMMARY_GROUPS });
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
    emit(EVENTS.PERIOD_CHANGED, { period, dateRange: STATE.dateRange });
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

async function refreshInsights() {
    await refreshInsightsModule(STATE, supabaseClient, CONFIG, {
        formatNum, escapeHtml, sanitizeHTML, prepareTransactionSummary
    });
}

function prepareTransactionSummary() {
    return prepareTransactionSummaryModule(STATE, formatNum);
}

function renderRecurringSummary() {
    renderRecurringSummaryModule(STATE, { formatNum, escapeHtml });
}

function renderProactiveInsights() {
    renderProactiveInsightsModule(STATE, { formatNum, escapeHtml });
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

function loadProfileTab() {
    loadProfileTabModule(STATE);
}

async function saveProfile() {
    await saveProfileModule(supabaseClient, CONFIG, STATE, showToast);
}

function openSettings(tab = null) {
    openSettingsModule(tab, { renderSettingsGoalsList, renderRecipientsList, loadProfileTab });
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

let appInitialised = false;

// Remove the pre-render auth guard and let normal CSS classes take over
function removeAuthGuard() {
    const guard = document.getElementById('authGuardCSS');
    if (guard) guard.remove();
}

function showLogin() {
    removeAuthGuard();
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', async () => {
    // Check for auth error params in URL FIRST (e.g. expired OAuth state)
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace('#', '?'));
    const authError = params.get('error_description') || hashParams.get('error_description');

    if (authError) {
        history.replaceState(null, '', window.location.pathname);
        showLogin();
        showLoginError(authError === 'OAuth callback with invalid state'
            ? 'Login link expired. Please try again.'
            : authError);
        return;
    }

    // Set up auth state listener.
    // With flowType:'pkce' and detectSessionInUrl:true, Supabase will
    // automatically detect ?code= in the URL, exchange it for a session,
    // and fire SIGNED_IN through this listener. No manual exchange needed.
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((event, sessionData) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            if (sessionData?.user && !appInitialised) {
                appInitialised = true;
                // Clean auth params from URL after successful auth
                if (window.location.search.includes('code=') || window.location.hash.includes('access_token')) {
                    history.replaceState(null, '', window.location.pathname);
                }
                showApp(sessionData.user, sessionData);
            }
        }

        if (event === 'INITIAL_SESSION') {
            if (sessionData?.user) {
                if (!appInitialised) {
                    appInitialised = true;
                    showApp(sessionData.user, sessionData);
                }
            } else {
                // No existing session and no code exchange happened — show login
                // (If ?code= is present, detectSessionInUrl will handle it and
                // fire SIGNED_IN shortly after this INITIAL_SESSION event)
                if (!window.location.search.includes('code=')) {
                    showLogin();
                }
            }
        }

        if (event === 'SIGNED_OUT') {
            appInitialised = false;
            showLogin();
        }
    });
});

async function attemptLogin() {
    const email = document.getElementById('loginUsername').value.trim();
    if (!email) return showLoginError('Please enter your email');

    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginBtn');
    btn.disabled = true;

    if (password) {
        // Email + password login
        btn.textContent = 'Signing in...';
        try {
            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;
        } catch (err) {
            showLoginError(err.message || 'Login failed');
        } finally {
            btn.textContent = 'Sign in';
            btn.disabled = false;
        }
    } else {
        // Magic link login
        btn.textContent = 'Sending link...';
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
            btn.textContent = 'Sign in';
            btn.disabled = false;
        }
    }
}

async function loginWithGoogle() {
    const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: CONFIG.AUTH_REDIRECT_URL,
            skipBrowserRedirect: false,
        }
    });
    if (error) showLoginError(error.message);
}

function showLoginError(msg, isError = true) {
    const el = document.getElementById('loginError');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.toggle('text-fact-red', isError);
    el.classList.toggle('text-fact-green', !isError);
    setTimeout(() => el.classList.add('hidden'), 4000);
}

async function showApp(user, session) {
    removeAuthGuard();
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');

    STATE.currentUser = user.email || 'user';
    const userDisplay = document.getElementById('currentUserDisplay');
    userDisplay.textContent = (user.email || 'User').split('@')[0];

    const modelEl = document.getElementById('aiModelName');
    if (modelEl) {
        modelEl.textContent = localStorage.getItem('fact_ai_model') || 'claude-sonnet';
    }

    // Clean auth tokens from URL (hash-based implicit flow)
    if (window.location.hash && window.location.hash.includes('access_token')) {
        history.replaceState(null, '', window.location.pathname);
    }

    loadLocal(CONFIG, STATE);

    // Sync data with callbacks (pass session to avoid getSession() race condition)
    await syncData(supabaseClient, CONFIG, STATE, {
        session,
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
        categorize: (raw, aiType, counterparty, dbCategory) => categorize(raw, aiType, STATE, MERCHANT_TYPES, counterparty, dbCategory),
        detectPatterns: () => detectPatterns(STATE, (t) => isExemptFromSplurge(t, STATE)),
        matchRecipient: (cp) => matchRecipient(cp, STATE)
    });

    // Emit data synced event for decoupled modules
    emit(EVENTS.DATA_SYNCED, { count: STATE.allTxns.length });

    // Initialize streaming chat panel
    initChat(CONFIG, supabaseClient, {
        onDataChanged: () => window.syncData()
    });

    // Migrate localStorage goals to DB if needed
    migrateGoalsToDb(STATE, supabaseClient, CONFIG).catch(() => {});

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

    // Event bus: listen for toast events from any module
    on(EVENTS.TOAST, ({ message, type }) => showToast(message, type || 'info'));
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
    categorize: (raw, aiType, counterparty, dbCategory) => categorize(raw, aiType, STATE, MERCHANT_TYPES, counterparty, dbCategory),
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
window.switchSettingsTab = (tab) => switchSettingsTab(tab, { renderSettingsGoalsList, renderRecipientsList, loadProfileTab });
window.generateShortcutKey = () => generateShortcutKey(supabaseClient, CONFIG);
window.revokeShortcutKey = () => revokeShortcutKey(supabaseClient, CONFIG);
window.copyShortcutKey = copyShortcutKey;
window.openShortcutSetup = () => openShortcutSetup(CONFIG);
window.closeShortcutSetup = closeShortcutSetup;
window.changePassword = () => changePassword(supabaseClient);
window.runBackfill = () => runBackfill(supabaseClient, CONFIG, showToast);
window.saveProfile = saveProfile;
window.loadProfileTab = loadProfileTab;
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
window.toggleChat = toggleChat;
window.openChat = openChat;
window.closeChat = closeChat;
window.STATE = STATE;
window.CONFIG = CONFIG;
window.supabaseClient = supabaseClient;
window.dayjs = dayjs;
window.Chart = Chart;
window.MERCHANT_TYPES = MERCHANT_TYPES;
window.SUMMARY_GROUPS = SUMMARY_GROUPS;
window.CAT_COLORS = CAT_COLORS;
window.PATTERNS = PATTERNS;

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
window.closeCelebration = closeCelebration;
window.confirmResolve = () => {}; // Placeholder, set dynamically in showConfirm
