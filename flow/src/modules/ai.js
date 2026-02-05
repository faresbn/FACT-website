// ─── AI INTEGRATION ─────────────────────────────────────────────
import dayjs from 'dayjs';

// Conversational AI Chat
const aiChatHistory = [];

export function openAIQuery() {
    const chatInput = document.getElementById('aiChatInput');
    if (chatInput) {
        chatInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => chatInput.focus(), 300);
    }
}

export function closeAIQuery() {
    // No-op - kept for backwards compatibility
}

export function prepareTransactionSummary(STATE, formatNum) {
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

export async function askAIChat(question, STATE, supabaseClient, CONFIG, callbacks) {
    const { formatNum, escapeHtml, sanitizeHTML, getSelectedAiModel, trackAchievement } = callbacks;

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
        const txnSummary = prepareTransactionSummary(STATE, formatNum);
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
                const modeIndicator = data.mode === 'deep' ? ' <span class="text-fact-green">o</span>' : '';
                const ctx = data.contextLoaded;
                const hasContext = ctx && (ctx.income + ctx.payees + ctx.corrections + ctx.preferences + (ctx.rules || 0) > 0);
                const ctxIndicator = hasContext ? ' <span class="text-fact-purple" title="Using your context">*</span>' : '';
                modelEl.innerHTML = escapeHtml(data.model) + modeIndicator + ctxIndicator;
            }
        }

        // Replace loading with answer
        const ctx = data.contextLoaded;
        const hasContext = ctx && (ctx.income + ctx.payees + ctx.corrections + ctx.preferences + (ctx.rules || 0) > 0);
        const modeBadge = data.mode === 'deep'
            ? '<div class="text-[9px] text-fact-green font-medium mb-1">DEEP ANALYSIS</div>'
            : '';
        const ctxParts = [];
        if (ctx?.income) ctxParts.push(`${ctx.income} income`);
        if (ctx?.payees) ctxParts.push(`${ctx.payees} payees`);
        if (ctx?.corrections) ctxParts.push(`${ctx.corrections} corrections`);
        if (ctx?.rules) ctxParts.push(`${ctx.rules} rules`);
        if (ctx?.merchants) ctxParts.push(`${ctx.merchants} merchants`);
        const ctxBadge = hasContext
            ? `<div class="text-[9px] text-fact-purple font-medium mb-1">Using ${ctxParts.join(', ')}</div>`
            : '';

        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) {
            // Simple markdown parser for marked
            const marked = window.marked || { parse: (t) => t };
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

export function clearAIChat() {
    aiChatHistory.length = 0;
    const messagesDiv = document.getElementById('aiChatMessages');
    if (messagesDiv) {
        messagesDiv.innerHTML = `
            <div class="text-fact-muted dark:text-fact-dark-muted text-xs">Ask me anything about your spending...</div>
        `;
    }
}

// ============== QUICK INSIGHTS ==============

export function renderQuickInsights(STATE, callbacks) {
    const { formatNum, escapeHtml, PATTERNS } = callbacks;

    const out = STATE.filtered.filter(t => t.direction === 'OUT');
    const insights = [];

    // Night out patterns
    const nightOuts = out.filter(t => t.dims.pattern === 'Night Out');
    if (nightOuts.length > 0) {
        const total = nightOuts.reduce((s, t) => s + t.amount, 0);
        insights.push({
            icon: 'party',
            text: `${nightOuts.length} Night Out transactions totaling QAR ${formatNum(total)}`,
            filter: 'nightOut'
        });
    }

    // Work expense candidates
    const workExpenses = out.filter(t => t.dims.pattern === 'Work Expense');
    if (workExpenses.length > 0) {
        const total = workExpenses.reduce((s, t) => s + t.amount, 0);
        insights.push({
            icon: 'work',
            text: `${workExpenses.length} potential work expenses (QAR ${formatNum(total)})`,
            filter: 'workHours'
        });
    }

    // Splurges
    const splurges = out.filter(t => t.dims.pattern === 'Splurge');
    if (splurges.length > 0) {
        const total = splurges.reduce((s, t) => s + t.amount, 0);
        insights.push({
            icon: 'money',
            text: `${splurges.length} splurge purchases (QAR ${formatNum(total)})`,
            filter: 'splurge'
        });
    }

    // Subscriptions
    const subs = out.filter(t => t.dims.pattern === 'Subscription');
    if (subs.length > 0) {
        const merchants = [...new Set(subs.map(t => t.consolidated))];
        insights.push({
            icon: 'calendar',
            text: `${merchants.length} detected subscriptions`,
            filter: 'subscription'
        });
    }

    // Late night spending
    const lateNight = out.filter(t => t.isLateNight);
    if (lateNight.length >= 3) {
        const total = lateNight.reduce((s, t) => s + t.amount, 0);
        insights.push({
            icon: 'moon',
            text: `QAR ${formatNum(total)} spent late at night (${lateNight.length} txns)`,
            filter: 'lateNight'
        });
    }

    // Large purchases
    const large = out.filter(t => t.isLarge);
    if (large.length > 0) {
        insights.push({
            icon: 'dots',
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

export function closeAiInsights() {
    const container = document.getElementById('aiInsightsContainer');
    if (container) container.classList.add('hidden');
}

export async function refreshInsights(STATE, supabaseClient, CONFIG, callbacks) {
    const { formatNum, escapeHtml, sanitizeHTML, prepareTransactionSummary } = callbacks;

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
        const txnSummary = prepareTransactionSummary(STATE, formatNum);
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
            .map(line => line.replace(/^[-*]\s*/, '').trim())
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
