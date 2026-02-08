// ─── STREAMING CHAT MODULE ─────────────────────────────────────
// Docked chat panel with SSE streaming to flow-chat edge function

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { fetchWithTimeout, friendlyError } from './utils.js';

// Configure marked for safe rendering
marked.setOptions({
    breaks: true,
    gfm: true,
});

let currentConversationId = null;
let isStreaming = false;
let chatExpanded = false;
let chatCallbacks = {};

const QUICK_ACTIONS = [
    { label: 'This month summary', query: 'Give me a summary of my spending this month' },
    { label: 'Where am I overspending?', query: 'Where am I overspending compared to my usual patterns?' },
    { label: 'Predict end-of-month', query: 'Predict my end-of-month balance based on current spending trends' },
    { label: 'Compare to last month', query: 'Compare my spending this month to last month. What changed?' },
    { label: 'Top merchants', query: 'What are my top 5 merchants by spending and how often do I visit each?' },
    { label: 'Anomalies', query: 'Are there any unusual or anomalous transactions recently?' },
];

export function initChat(CONFIG, supabaseClient, callbacks = {}) {
    chatCallbacks = callbacks;
    const panel = document.getElementById('chatPanel');
    if (!panel) return;

    renderChatUI(panel);
    setupChatEvents(CONFIG, supabaseClient);
    loadConversationList(CONFIG, supabaseClient);
}

function renderChatUI(panel) {
    panel.innerHTML = `
        <!-- Chat Panel Header -->
        <div class="chat-panel-header">
            <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full bg-fact-green animate-pulse"></div>
                <span class="text-sm font-medium">AI Assistant</span>
                <span class="text-[10px] text-fact-muted dark:text-fact-dark-muted">Sonnet</span>
            </div>
            <div class="flex items-center gap-1">
                <button id="chatNewBtn" class="text-[10px] text-fact-muted hover:text-fact-ink dark:hover:text-fact-dark-ink transition px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" title="New conversation">
                    + New
                </button>
                <button id="chatHistoryToggle" class="text-[10px] text-fact-muted hover:text-fact-ink dark:hover:text-fact-dark-ink transition px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" title="History">
                    History
                </button>
                <button id="chatCloseBtn" class="p-1 text-fact-muted hover:text-fact-ink dark:hover:text-fact-dark-ink transition rounded hover:bg-gray-100 dark:hover:bg-gray-800" title="Close">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        </div>

        <!-- Conversation History Panel -->
        <div id="chatHistoryPanel" class="chat-history-panel hidden">
            <div class="p-3 border-b border-fact-border dark:border-fact-dark-border">
                <div class="text-xs font-medium text-fact-muted dark:text-fact-dark-muted">Recent Conversations</div>
            </div>
            <div id="chatHistoryList" class="p-2 space-y-1 overflow-y-auto max-h-[300px]">
                <!-- Populated dynamically -->
            </div>
        </div>

        <!-- Chat Body -->
        <div id="chatBody" class="chat-body">
            <!-- Messages -->
            <div id="chatMessages" class="chat-messages">
                <div class="chat-welcome">
                    <div class="text-lg font-display font-semibold mb-1">Hi! I'm your financial assistant.</div>
                    <div class="text-sm text-fact-muted dark:text-fact-dark-muted mb-4">I have access to all your transaction data. Ask me anything about your spending.</div>
                    <div id="chatQuickActions" class="flex flex-wrap gap-2">
                        ${QUICK_ACTIONS.map(a => `
                            <button class="chat-quick-action" data-query="${a.query}">
                                ${a.label}
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>

            <!-- Input -->
            <div class="chat-input-area">
                <div class="flex items-end gap-2">
                    <textarea id="chatInput"
                        class="chat-input"
                        placeholder="Ask about your spending..."
                        rows="1"
                        maxlength="2000"></textarea>
                    <button id="chatSendBtn" class="chat-send-btn" disabled>
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19V5m0 0l-7 7m7-7l7 7"/>
                        </svg>
                    </button>
                </div>
                <div class="flex items-center justify-between mt-1">
                    <span class="text-[9px] text-fact-muted dark:text-fact-dark-muted">Powered by Claude Sonnet</span>
                    <span id="chatCharCount" class="text-[9px] text-fact-muted dark:text-fact-dark-muted hidden">0/2000</span>
                </div>
            </div>
        </div>
    `;
}

function setupChatEvents(CONFIG, supabaseClient) {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSendBtn');
    const newBtn = document.getElementById('chatNewBtn');
    const historyToggle = document.getElementById('chatHistoryToggle');
    const closeBtn = document.getElementById('chatCloseBtn');

    // Close button
    closeBtn?.addEventListener('click', () => {
        closeChat();
    });

    // Auto-resize textarea
    input?.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        sendBtn.disabled = !input.value.trim() || isStreaming;
        const charCount = document.getElementById('chatCharCount');
        if (charCount) {
            charCount.textContent = `${input.value.length}/2000`;
            charCount.classList.toggle('hidden', input.value.length === 0);
        }
    });

    // Send on Enter (Shift+Enter for newline)
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (input.value.trim() && !isStreaming) {
                sendMessage(input.value.trim(), CONFIG, supabaseClient);
                input.value = '';
                input.style.height = 'auto';
                sendBtn.disabled = true;
            }
        }
    });

    // Send button click
    sendBtn?.addEventListener('click', () => {
        if (input?.value.trim() && !isStreaming) {
            sendMessage(input.value.trim(), CONFIG, supabaseClient);
            input.value = '';
            input.style.height = 'auto';
            sendBtn.disabled = true;
        }
    });

    // Quick action chips (delegate on chatMessages so it survives innerHTML replacement)
    document.getElementById('chatMessages')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.chat-quick-action');
        if (btn) {
            const query = btn.dataset.query;
            sendMessage(query, CONFIG, supabaseClient);
        }
    });

    // New conversation
    newBtn?.addEventListener('click', () => {
        startNewConversation();
    });

    // History toggle
    historyToggle?.addEventListener('click', () => {
        const historyPanel = document.getElementById('chatHistoryPanel');
        historyPanel?.classList.toggle('hidden');
        if (!historyPanel?.classList.contains('hidden')) {
            loadConversationList(CONFIG, supabaseClient);
        }
    });
}

function startNewConversation() {
    currentConversationId = null;
    const messages = document.getElementById('chatMessages');
    if (messages) {
        messages.innerHTML = `
            <div class="chat-welcome">
                <div class="text-lg font-display font-semibold mb-1">New conversation</div>
                <div class="text-sm text-fact-muted dark:text-fact-dark-muted mb-4">Ask me anything about your spending.</div>
                <div id="chatQuickActions" class="flex flex-wrap gap-2">
                    ${QUICK_ACTIONS.map(a => `
                        <button class="chat-quick-action" data-query="${a.query}">
                            ${a.label}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    }
}

async function loadConversationList(CONFIG, supabaseClient) {
    const list = document.getElementById('chatHistoryList');
    if (!list) return;

    try {
        const { data: session } = await supabaseClient.auth.getSession();
        const token = session?.session?.access_token;
        if (!token) return;

        const res = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ action: 'list_conversations' }),
        });
        const data = await res.json();
        const convos = data.conversations || [];

        if (convos.length === 0) {
            list.innerHTML = '<div class="text-xs text-fact-muted dark:text-fact-dark-muted p-2">No conversations yet</div>';
            return;
        }

        list.innerHTML = convos.map(c => {
            const date = new Date(c.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const isActive = c.id === currentConversationId;
            return `
                <button class="w-full text-left p-2 rounded-lg text-xs hover:bg-gray-100 dark:hover:bg-gray-800 transition truncate ${isActive ? 'bg-fact-yellow/10 text-fact-ink dark:text-fact-dark-ink' : 'text-fact-muted dark:text-fact-dark-muted'}"
                    data-convo-id="${c.id}">
                    <div class="font-medium truncate">${DOMPurify.sanitize(c.title)}</div>
                    <div class="text-[9px] text-fact-muted mt-0.5">${date}</div>
                </button>
            `;
        }).join('');

        // Click handlers for conversation items
        list.querySelectorAll('[data-convo-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                loadConversation(btn.dataset.convoId, CONFIG, supabaseClient);
                document.getElementById('chatHistoryPanel')?.classList.add('hidden');
            });
        });
    } catch (_e) {
        list.innerHTML = '<div class="text-xs text-fact-red p-2">Failed to load history</div>';
    }
}

async function loadConversation(convoId, CONFIG, supabaseClient) {
    currentConversationId = convoId;
    const messagesDiv = document.getElementById('chatMessages');
    if (!messagesDiv) return;

    messagesDiv.innerHTML = '<div class="text-center text-fact-muted text-xs py-4 animate-pulse">Loading...</div>';

    try {
        const { data: session } = await supabaseClient.auth.getSession();
        const token = session?.session?.access_token;

        const res = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ action: 'get_conversation', conversation_id: convoId }),
        });
        const data = await res.json();
        const msgs = data.messages || [];

        messagesDiv.innerHTML = msgs.map(m => {
            if (m.role === 'user') {
                return `<div class="flex justify-end"><div class="chat-user-msg">${DOMPurify.sanitize(m.content)}</div></div>`;
            } else {
                const html = DOMPurify.sanitize(marked.parse(m.content));
                return `<div class="flex justify-start"><div class="chat-ai-msg"><div class="prose prose-sm dark:prose-invert">${html}</div></div></div>`;
            }
        }).join('');

        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        // Open chat if not already
        if (!chatExpanded) {
            openChat();
        }
    } catch (_e) {
        messagesDiv.innerHTML = '<div class="text-center text-fact-red text-xs py-4">Failed to load conversation</div>';
    }
}

async function sendMessage(message, CONFIG, supabaseClient) {
    if (isStreaming) return;
    isStreaming = true;

    const messagesDiv = document.getElementById('chatMessages');
    const sendBtn = document.getElementById('chatSendBtn');
    if (sendBtn) sendBtn.disabled = true;

    // Open panel if not already open
    if (!chatExpanded) {
        openChat();
    }

    // Clear welcome if present
    const welcome = messagesDiv?.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    // Add user message
    if (messagesDiv) {
        messagesDiv.insertAdjacentHTML('beforeend', `
            <div class="flex justify-end">
                <div class="chat-user-msg">${DOMPurify.sanitize(message)}</div>
            </div>
        `);
    }

    // Add AI message placeholder
    const aiMsgId = 'ai-msg-' + Date.now();
    if (messagesDiv) {
        messagesDiv.insertAdjacentHTML('beforeend', `
            <div class="flex justify-start" id="${aiMsgId}">
                <div class="chat-ai-msg">
                    <div class="flex items-center gap-2 text-fact-muted text-xs">
                        <div class="w-1.5 h-1.5 rounded-full bg-fact-green animate-pulse"></div>
                        Thinking...
                    </div>
                </div>
            </div>
        `);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    try {
        const { data: session } = await supabaseClient.auth.getSession();
        const token = session?.session?.access_token;
        if (!token) throw new Error('Not authenticated');

        const response = await fetchWithTimeout(`${CONFIG.FUNCTIONS_BASE}/flow-chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
                message,
                conversation_id: currentConversationId,
            }),
        }, { timeoutMs: 90000, retries: 0 }); // SSE streaming: long timeout, no retry

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${response.status}`);
        }

        // Read SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';

        const aiMsgEl = document.getElementById(aiMsgId);

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const event = JSON.parse(line.slice(6));

                    if (event.type === 'text') {
                        fullText += event.content;
                        if (aiMsgEl) {
                            const html = DOMPurify.sanitize(marked.parse(fullText));
                            aiMsgEl.innerHTML = `<div class="chat-ai-msg"><div class="prose prose-sm dark:prose-invert">${html}</div></div>`;
                        }
                        if (messagesDiv) messagesDiv.scrollTop = messagesDiv.scrollHeight;
                    }

                    if (event.type === 'done') {
                        if (event.conversation_id) {
                            currentConversationId = event.conversation_id;
                        }
                        // If chat used tools that modified data (goals, context), trigger re-sync
                        if (event.remembered || event.tools_used) {
                            if (typeof chatCallbacks?.onDataChanged === 'function') {
                                chatCallbacks.onDataChanged();
                            }
                        }
                    }
                } catch (_e) {
                    // Skip unparseable
                }
            }
        }

        // If no text was received
        if (!fullText && aiMsgEl) {
            aiMsgEl.innerHTML = `<div class="chat-ai-msg"><div class="text-sm text-fact-muted">No response received. Try again.</div></div>`;
        }

    } catch (err) {
        const aiMsgEl = document.getElementById(aiMsgId);
        if (aiMsgEl) {
            const userMsg = friendlyError(err);
            aiMsgEl.innerHTML = `<div class="chat-ai-msg"><div class="text-sm text-fact-red">${DOMPurify.sanitize(userMsg)}</div></div>`;
        }
    } finally {
        isStreaming = false;
        if (sendBtn) sendBtn.disabled = false;
        document.getElementById('chatInput')?.focus();
    }
}

// Toggle chat side panel (for external callers / FAB)
export function toggleChat() {
    if (chatExpanded) {
        closeChat();
    } else {
        openChat();
    }
}

export function openChat() {
    if (!chatExpanded) {
        chatExpanded = true;
        const panel = document.getElementById('chatPanel');
        panel?.classList.add('open');
        document.body.classList.add('chat-open');
        // Hide FAB when panel is open
        const fab = document.getElementById('chatFab');
        if (fab) fab.style.display = 'none';
        document.getElementById('chatInput')?.focus();
    }
}

export function closeChat() {
    if (chatExpanded) {
        chatExpanded = false;
        const panel = document.getElementById('chatPanel');
        panel?.classList.remove('open');
        document.body.classList.remove('chat-open');
        // Show FAB again
        const fab = document.getElementById('chatFab');
        if (fab) fab.style.display = 'flex';
        // Close history panel too
        document.getElementById('chatHistoryPanel')?.classList.add('hidden');
    }
}
