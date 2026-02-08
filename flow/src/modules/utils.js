// ─── UTILS, TOAST, PWA ──────────────────────────────────────────
import DOMPurify from 'dompurify';

// ============== UTILS ==============

export function formatNum(n) {
    return Math.round(n).toLocaleString();
}

export function debounce(fn, wait) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

// Simple markdown parser fallback (if marked.js not loaded)
export const marked = window.marked || {
    parse: (text) => text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>')
};

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Sanitize HTML (for markdown output) using DOMPurify
export function sanitizeHTML(html) {
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'code', 'pre', 'blockquote', 'a', 'span', 'div'],
        ALLOWED_ATTR: ['href', 'target', 'class'],
        ALLOW_DATA_ATTR: false
    });
}

// ============== FETCH WITH TIMEOUT + RETRY ==============

/**
 * Fetch wrapper with timeout and automatic retry.
 * - timeoutMs: abort if no response in this many ms (default 30s)
 * - retries: how many times to retry on network/timeout failure (default 1)
 * - retryDelay: ms between retries (default 2000)
 *
 * Does NOT retry on 4xx errors (client errors).
 * Retries on network failures, timeouts, and 5xx server errors.
 */
export async function fetchWithTimeout(url, options = {}, { timeoutMs = 30000, retries = 1, retryDelay = 2000 } = {}) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            // Don't retry client errors (4xx) — they won't succeed on retry
            if (response.status >= 400 && response.status < 500) {
                return response;
            }

            // Retry server errors (5xx) if we have retries left
            if (response.status >= 500 && attempt < retries) {
                lastError = new Error(`Server error: ${response.status}`);
                await new Promise(r => setTimeout(r, retryDelay));
                continue;
            }

            return response;
        } catch (err) {
            clearTimeout(timeoutId);
            lastError = err;

            // Translate AbortError into a user-friendly message
            if (err.name === 'AbortError') {
                lastError = new Error('Request timed out. Please check your internet connection and try again.');
            }

            // Don't retry if this was the last attempt
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, retryDelay));
            }
        }
    }

    throw lastError;
}

/**
 * Translate raw error messages into user-friendly language.
 * Keeps technical details out of user-facing toasts.
 */
export function friendlyError(err) {
    const msg = String(err?.message || err || '');

    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('net::ERR'))
        return 'No internet connection. Please check your network and try again.';
    if (msg.includes('timed out') || msg.includes('AbortError'))
        return 'Request timed out. Please try again.';
    if (msg.includes('RATE_LIMITED') || msg.includes('429'))
        return 'You\'re making requests too quickly. Please wait a moment and try again.';
    if (msg.includes('AUTH_REQUIRED') || msg.includes('401'))
        return 'Your session has expired. Please sign in again.';
    if (msg.includes('500') || msg.includes('Internal Server'))
        return 'Something went wrong on our end. Please try again in a moment.';
    if (msg.includes('Unexpected token') || msg.includes('JSON'))
        return 'Received an unexpected response. Please try again.';

    // If the message is too technical (contains stack trace-like content), simplify it
    if (msg.length > 120 || msg.includes('at ') || msg.includes('Error:'))
        return 'Something went wrong. Please try again.';

    return msg;
}

// ============== GLOBAL ERROR HANDLER ==============

/**
 * Install global handlers for uncaught errors and unhandled promise rejections.
 * Shows user-friendly toast for async failures that would otherwise be invisible.
 */
export function initGlobalErrorHandler(showToastFn) {
    // Unhandled promise rejections (most common in async code)
    window.addEventListener('unhandledrejection', (event) => {
        event.preventDefault(); // Prevent console noise

        const msg = friendlyError(event.reason);
        // Don't toast for non-actionable errors (cancelled requests, etc.)
        if (String(event.reason).includes('AbortError') && !String(event.reason).includes('timed out')) return;

        showToastFn(msg, 'error');
    });

    // Uncaught synchronous errors (rare in modern async code)
    window.addEventListener('error', (event) => {
        // Skip script loading errors (e.g. stale service worker referencing old hashed files)
        if (event.filename && !event.filename.includes(window.location.origin)) return;

        const msg = friendlyError(event.error || event.message);
        showToastFn(msg, 'error');
    });
}

// ============== TOAST NOTIFICATIONS ==============

export function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '?',
        error: '?',
        info: 'i'
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

// Register service worker with update notification
export function initServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', async () => {
            try {
                const registration = await navigator.serviceWorker.register('/flow/sw.js');

                // Check for updates periodically (every 30 min)
                setInterval(() => registration.update(), 30 * 60 * 1000);

                // Notify user when a new version is available
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
                                // New version installed — tell user to refresh
                                showToast('New version available! Refresh to update.', 'info', 8000);
                            }
                        });
                    }
                });
            } catch (err) {
                // Service worker registration failure is non-critical — log but don't alarm user
                console.warn('Service worker registration failed:', err.message);
            }
        });
    }
}

// PWA Install handling
let deferredPrompt;

export function initPWAInstall() {
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
}

export function installPWA() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choice) => {
            deferredPrompt = null;
            document.getElementById('installBanner').style.display = 'none';
        });
    }
}

export function dismissInstall() {
    document.getElementById('installBanner').style.display = 'none';
    localStorage.setItem('pwa_install_dismissed', 'true');
}

// ============== DARK MODE TOGGLE ==============

export function initDarkMode() {
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

export function toggleDarkMode() {
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
