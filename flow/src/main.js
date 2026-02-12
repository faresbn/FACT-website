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
    fetchWithTimeout,
    friendlyError,
    initGlobalErrorHandler,
    initServiceWorker,
    initPWAInstall,
    installPWA,
    dismissInstall,
    initDarkMode,
    toggleDarkMode,
    showFeatureTip,
    hasSeenTip
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
    normalizeCounterparty,
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
    listKeys,
    renderKeyList as renderKeyListModule,
    renderFxRates as renderFxRatesModule,
    saveFxOverrides as saveFxOverridesModule,
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

// Forecast module
import { renderForecast as renderForecastModule, renderGoalGauges as renderGoalGaugesModule } from './modules/forecast.js';

// Digest module
import { renderDailyDigest as renderDailyDigestModule, dismissDigest as dismissDigestModule } from './modules/digest.js';

// Command palette module
import { initCommandPalette, openCommandPalette, closeCommandPalette, executeCommand } from './modules/commandpalette.js';

// Import module
import { openImportModal, closeImportModal, handleImportFile, updateImportMapping, executeImport as executeImportModule } from './modules/import.js';

// Manual entry module
import { openManualEntry, closeManualEntry, submitManualEntry as submitManualEntryModule, initManualEntryCategories } from './modules/manualentry.js';

// Visualizations module
import {
    renderSpendingTrend,
    renderMerchantTreemap,
    renderPeriodComparison,
    renderTimeHeatmap,
    renderSmartMetrics,
    renderSpendingDistribution,
    renderMoneyFlow,
    toggleCompareMode as toggleCompareModeModule
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
    deleteRecipient as deleteRecipientModule,
    openPeoplePanel as openPeoplePanelModule,
    closePeoplePanel,
    filterPeoplePanel as filterPeoplePanelModule,
    openPersonDrilldown as openPersonDrilldownModule,
    openUnmatchedDrilldown as openUnmatchedDrilldownModule,
    assignUnmatchedTransfer,
    saveRecipientAndRematch as saveRecipientAndRematchModule
} from './modules/recipients.js';

// Features module
import {
    openHeatmap as openHeatmapModule,
    closeHeatmap,
    renderHeatmap as renderHeatmapModule,
    drilldownDate as drilldownDateModule,
    exportCSV as exportCSVModule,
    exportXLSX as exportXLSXModule,
    exportPDF as exportPDFModule,
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
    proactiveInsights: [],
    dailyDigest: null
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
    // Render forecast
    renderForecast();
    // Render daily digest, recurring subscriptions and proactive alerts
    renderDailyDigest();
    renderRecurringSummary();
    renderProactiveInsights();
    // Emit event for any module listening for data changes
    emit(EVENTS.DATA_FILTERED, { count: STATE.filtered.length, period: STATE.period });
}

function renderForecast() {
    renderForecastModule(STATE, { formatNum });
    renderGoalGaugesModule(STATE, { formatNum });
}

function renderDailyDigest() {
    renderDailyDigestModule(STATE, { formatNum, escapeHtml });
}

let activeVizTab = 'trend';
function renderAllVisualizations() {
    // Only render the active viz tab (lazy rendering)
    renderActiveViz();
    renderSmartMetrics(STATE, { formatNum, SUMMARY_GROUPS });
}

function renderActiveViz() {
    switch (activeVizTab) {
        case 'trend': renderSpendingTrend(STATE, { formatNum, SUMMARY_GROUPS }); break;
        case 'compare': renderPeriodComparison(STATE, { formatNum, SUMMARY_GROUPS }); break;
        case 'merchants': renderMerchantTreemap(STATE, { formatNum, SUMMARY_GROUPS }); break;
        case 'heatmap': renderTimeHeatmap(STATE, { formatNum }); break;
        case 'distribution': renderSpendingDistribution(STATE, { formatNum, SIZE_TIERS }); break;
        case 'flow': renderMoneyFlow(STATE, { formatNum, SUMMARY_GROUPS, MERCHANT_TYPES }); break;
    }
}

function switchVizTab(tabId) {
    activeVizTab = tabId;
    // Toggle panels
    document.querySelectorAll('.viz-panel').forEach(p => p.classList.add('hidden'));
    const panel = document.getElementById(`viz${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`);
    if (panel) panel.classList.remove('hidden');
    // Toggle tab buttons
    document.querySelectorAll('.viz-tab').forEach(btn => {
        const isActive = btn.dataset.viz === tabId;
        btn.classList.toggle('bg-fact-ink', isActive);
        btn.classList.toggle('dark:bg-fact-dark-ink', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('dark:text-fact-dark-bg', isActive);
        btn.classList.toggle('text-fact-muted', !isActive);
        btn.classList.toggle('dark:text-fact-dark-muted', !isActive);
    });
    renderActiveViz();
}

let activeMainTab = 'breakdown';
function switchMainTab(tabId) {
    activeMainTab = tabId;
    // Toggle panels
    document.querySelectorAll('.main-tab-panel').forEach(p => p.classList.add('hidden'));
    const panel = document.getElementById(`mainTab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`);
    if (panel) panel.classList.remove('hidden');
    // Toggle tab buttons
    document.querySelectorAll('.main-tab').forEach(btn => {
        const isActive = btn.dataset.mainTab === tabId;
        btn.classList.toggle('bg-fact-ink', isActive);
        btn.classList.toggle('dark:bg-fact-dark-ink', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('dark:text-fact-dark-bg', isActive);
        btn.classList.toggle('text-fact-muted', !isActive);
        btn.classList.toggle('dark:text-fact-dark-muted', !isActive);
    });
    // Show/hide view mode toggle (only on breakdown tab)
    const viewToggle = document.getElementById('viewModeToggle');
    if (viewToggle) viewToggle.classList.toggle('hidden', tabId !== 'breakdown');
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
    openCatModalModule(raw, STATE, { escapeHtml });
}

function openCatModalSafe(el) {
    openCatModalSafeModule(el, openCatModal);
}

async function saveCategorization() {
    await saveCategorizationModule(STATE, supabaseClient, CONFIG, {
        saveLocal: () => saveLocal(CONFIG, STATE),
        filterAndRender,
        detectPatterns: () => detectPatterns(STATE, (t) => isExemptFromSplurge(t, STATE))
    });
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
    refreshKeyList();
    renderFxRates();
}

async function refreshKeyList() {
    const keys = await listKeys(supabaseClient, CONFIG);
    renderKeyListModule(keys, { escapeHtml });
}

async function revokeKeyById(keyId) {
    const statusEl = document.getElementById('shortcutKeyStatus');
    if (statusEl) statusEl.textContent = 'Revoking...';
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

        if (statusEl) statusEl.textContent = 'Key revoked.';
        refreshKeyList();
    } catch (err) {
        if (statusEl) statusEl.textContent = 'Failed: ' + err.message;
    }
}

function renderFxRates() {
    renderFxRatesModule(STATE, escapeHtml);
}

async function saveFxOverrides() {
    await saveFxOverridesModule(supabaseClient, STATE, showToast);
}

async function refreshFxRates() {
    showToast('Refreshing rates...', 'info');
    await syncData(supabaseClient, CONFIG, STATE, {
        showToast, filterAndRender, checkAchievements, renderPatternWarnings, setSalaryPeriod, setPeriod, updateCatDropdowns,
        MERCHANT_TYPES, getSummaryGroup, getTimeContext, getSizeTier,
        categorize: (raw, aiType, counterparty, dbCategory) => categorize(raw, aiType, STATE, MERCHANT_TYPES, counterparty, dbCategory),
        detectPatterns: () => detectPatterns(STATE, (t) => isExemptFromSplurge(t, STATE)),
        matchRecipient: (cp) => matchRecipient(cp, STATE)
    });
    renderFxRates();
    showToast('Rates refreshed', 'success');
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
    // Enhanced save that also re-matches transactions to the updated contact
    await saveRecipientAndRematchModule(STATE, supabaseClient, CONFIG, {
        showToast,
        renderRecipientsList,
        filterAndRender,
        matchRecipient: (cp) => matchRecipient(cp, STATE)
    });
}

async function deleteRecipient(index) {
    await deleteRecipientModule(index, STATE, supabaseClient, CONFIG, { showToast, showConfirm, renderRecipientsList });
}

function openPeoplePanel() {
    openPeoplePanelModule(STATE, { formatNum, escapeHtml });
}

function filterPeoplePanel() {
    filterPeoplePanelModule(STATE, { formatNum, escapeHtml });
}

function openPersonDrilldown(recipientId) {
    openPersonDrilldownModule(recipientId, STATE, { formatNum, escapeHtml, renderTxnRow });
}

function openUnmatchedDrilldown(encodedLabel) {
    openUnmatchedDrilldownModule(encodedLabel, STATE, { formatNum, escapeHtml, renderTxnRow });
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

function exportXLSX() {
    exportXLSXModule(STATE, { formatNum, showToast, trackAchievement });
}

function exportPDF() {
    exportPDFModule(STATE, { formatNum, showToast, trackAchievement });
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
    migrateGoalsToDb(STATE, supabaseClient, CONFIG).catch((err) => {
        console.warn('Goals migration skipped:', err.message);
    });

    checkOnboarding(supabaseClient);
    initManualEntryCategories(MERCHANT_TYPES);

    // Feature discovery tooltips — show one at a time on first use
    setTimeout(() => {
        const chatFab = document.getElementById('chatFab');
        if (chatFab && !hasSeenTip('chat')) {
            showFeatureTip('chat', chatFab, 'Ask me anything about your finances', 'right');
        } else {
            const healthBtn = document.querySelector('[onclick*="openHealthScore"]');
            if (healthBtn && !hasSeenTip('health')) {
                showFeatureTip('health', healthBtn, 'Tap to see your financial health score');
            }
        }
    }, 4000);

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
    initGlobalErrorHandler(showToast);
    initFocusMode(STATE);
    initDarkMode();
    initServiceWorker();
    initPWAInstall();
    initCommandPalette();

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
window.generateShortcutKey = () => generateShortcutKey(supabaseClient, CONFIG, { refreshKeyList });
window.revokeShortcutKey = () => revokeShortcutKey(supabaseClient, CONFIG);
window.revokeKeyById = revokeKeyById;
window.copyShortcutKey = copyShortcutKey;
window.openShortcutSetup = () => openShortcutSetup(CONFIG);
window.closeShortcutSetup = closeShortcutSetup;
window.changePassword = () => changePassword(supabaseClient);
window.runBackfill = () => runBackfill(supabaseClient, CONFIG, showToast);
window.saveProfile = saveProfile;
window.loadProfileTab = loadProfileTab;
window.renderFxRates = renderFxRates;
window.saveFxOverrides = saveFxOverrides;
window.refreshFxRates = refreshFxRates;
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
window.dismissDigest = () => dismissDigestModule(STATE, supabaseClient, CONFIG);
window.openCommandPalette = openCommandPalette;
window.closeCommandPalette = closeCommandPalette;
window.executeCommand = executeCommand;
window.openImportModal = openImportModal;
window.closeImportModal = closeImportModal;
window.handleImportFile = handleImportFile;
window.updateImportMapping = updateImportMapping;
window.executeImport = () => executeImportModule(supabaseClient, CONFIG, showToast, () => window.syncData());
window.openManualEntry = openManualEntry;
window.closeManualEntry = closeManualEntry;
window.submitManualEntry = () => submitManualEntryModule(supabaseClient, CONFIG, showToast, () => window.syncData());
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
window.exportXLSX = exportXLSX;
window.exportPDF = exportPDF;
window.filterByDimension = filterByDimension;
window.openGenerositySettings = openGenerositySettings;
window.openGoals = openGoals;
window.openHeatmap = openHeatmap;
window.switchVizTab = switchVizTab;
window.toggleCompareMode = () => { toggleCompareModeModule(); renderActiveViz(); };
window.switchMainTab = switchMainTab;
window.renderForecast = renderForecast;
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
window.closeGoals = () => closeGoals(closeSettings);
window.closeShortcuts = () => document.getElementById('shortcutsModal')?.classList.add('hidden');
window.saveGoal = saveGoal;
window.deleteGoal = deleteGoal;
window.renderRecipientsList = renderRecipientsList;
window.addNewRecipient = addNewRecipient;
window.editRecipient = editRecipient;
window.closeRecipientModal = closeRecipientModal;
window.saveRecipient = saveRecipient;
window.deleteRecipient = deleteRecipient;
window.filterRecipientsList = () => filterRecipientsList(STATE, { escapeHtml });
window.openPeoplePanel = openPeoplePanel;
window.closePeoplePanel = closePeoplePanel;
window.filterPeoplePanel = filterPeoplePanel;
window.openPersonDrilldown = openPersonDrilldown;
window.openUnmatchedDrilldown = openUnmatchedDrilldown;
window.assignUnmatchedTransfer = assignUnmatchedTransfer;
window.renderHeatmap = renderHeatmap;
window.drilldownDate = drilldownDate;
window.closeCelebration = closeCelebration;
window.confirmResolve = () => {}; // Placeholder, set dynamically in showConfirm

// Merchant modal: open, filter, close
window.closeMerchantModal = () => document.getElementById('merchantModal')?.classList.add('hidden');
window.openMerchantModal = () => {
    document.getElementById('merchantModal')?.classList.remove('hidden');
    document.getElementById('merchantSearch').value = '';
    window.filterMerchantModal();
};
window.filterMerchantModal = () => {
    const searchEl = document.getElementById('merchantSearch');
    const sortEl = document.getElementById('merchantSort');
    const listEl = document.getElementById('merchantModalList');
    const countEl = document.getElementById('merchantModalCount');
    if (!listEl) return;

    const query = (searchEl?.value || '').toLowerCase();
    const sortBy = sortEl?.value || 'amount';

    // Group filtered OUT transactions by consolidated name
    const byMerchant = {};
    (STATE.filtered || []).filter(t => t.direction === 'OUT').forEach(t => {
        const name = t.consolidated || t.display || t.counterparty || 'Unknown';
        if (!byMerchant[name]) byMerchant[name] = { name, total: 0, count: 0, category: t.merchantType };
        byMerchant[name].total += t.amount;
        byMerchant[name].count++;
    });

    let merchants = Object.values(byMerchant);

    // Filter by search query
    if (query) {
        merchants = merchants.filter(m => m.name.toLowerCase().includes(query));
    }

    // Sort
    if (sortBy === 'amount') merchants.sort((a, b) => b.total - a.total);
    else if (sortBy === 'count') merchants.sort((a, b) => b.count - a.count);
    else merchants.sort((a, b) => a.name.localeCompare(b.name));

    if (countEl) countEl.textContent = `${merchants.length} merchants`;

    listEl.innerHTML = merchants.map(m => `
        <div class="p-3 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition"
             onclick="closeMerchantModal(); openMerchantDrilldown('${escapeHtml(m.name.replace(/'/g, "\\'"))}')">
            <div class="flex items-center gap-3 min-w-0">
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-fact-muted font-medium">${escapeHtml(m.category)}</span>
                <span class="text-sm font-medium truncate">${escapeHtml(m.name)}</span>
            </div>
            <div class="flex items-center gap-3 shrink-0">
                <span class="text-[10px] text-fact-muted">${m.count} txns</span>
                <span class="text-sm font-display font-bold">QAR ${formatNum(m.total)}</span>
            </div>
        </div>
    `).join('') || '<div class="p-4 text-center text-sm text-fact-muted">No merchants found</div>';
};
window.closeCmdPalette = () => document.getElementById('cmdPalette')?.classList.remove('active');
window.filterCommands = () => {};
window.handleCmdKeydown = () => {};
