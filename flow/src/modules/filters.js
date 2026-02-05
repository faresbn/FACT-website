// ─── DIMENSION FILTERING, VOICE ─────────────────────────────────

// ============== DIMENSION FILTERING ==============

export function filterByDimension(dimension, STATE, callbacks) {
    const { showFilteredResults } = callbacks;

    let filtered = [];
    let title = '';

    const out = STATE.filtered.filter(t => t.direction === 'OUT');

    switch (dimension) {
        case 'workHours':
            filtered = out.filter(t => t.isWorkHours);
            title = 'Work Hours Spending';
            break;
        case 'lateNight':
            filtered = out.filter(t => t.isLateNight);
            title = 'Late Night Spending';
            break;
        case 'nightOut':
            filtered = out.filter(t => t.dims.pattern === 'Night Out');
            title = 'Night Out Sessions';
            break;
        case 'splurge':
            filtered = out.filter(t => t.dims.pattern === 'Splurge');
            title = 'Splurge Purchases';
            break;
        case 'large':
            filtered = out.filter(t => t.isLarge);
            title = 'Large Purchases (500+ QAR)';
            break;
        case 'subscription':
            filtered = out.filter(t => t.dims.pattern === 'Subscription');
            title = 'Detected Subscriptions';
            break;
        case 'clear':
            closeFilteredModal();
            return;
        default:
            return;
    }

    showFilteredResults(filtered, title);
}

export function showFilteredResults(txns, title, callbacks) {
    const { formatNum, renderTxnRowEnhanced } = callbacks;

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

export function closeFilteredModal() {
    document.getElementById('filteredModal').classList.add('hidden');
}

export function renderTxnRowEnhanced(t, callbacks) {
    const { formatNum, escapeHtml, getTypeColor, MERCHANT_TYPES, PATTERNS } = callbacks;

    const isOut = t.direction === 'OUT';
    const color = getTypeColor(t.merchantType);
    const icon = MERCHANT_TYPES[t.merchantType]?.icon || '?';
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
                        <span>-</span>
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

export function initVoiceRecognition(askAIChat) {
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

export function toggleVoiceInput(trackAchievement, askAIChat) {
    if (!recognition) {
        initVoiceRecognition(askAIChat);
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
