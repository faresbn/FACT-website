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

// Register service worker
export function initServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/flow/sw.js')
                .then(reg => console.log('[PWA] Service worker registered'))
                .catch(err => console.log('[PWA] Service worker registration failed:', err));
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
            if (choice.outcome === 'accepted') {
                console.log('[PWA] User accepted install');
            }
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
