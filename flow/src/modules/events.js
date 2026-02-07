// ─── LIGHTWEIGHT EVENT BUS ─────────────────────────────────────
// Replaces callback-passing between modules with decoupled events

const bus = new EventTarget();

export function emit(name, detail = {}) {
    bus.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on(name, fn) {
    bus.addEventListener(name, (e) => fn(e.detail));
}

export function off(name, fn) {
    bus.removeEventListener(name, fn);
}

// Common event names as constants to prevent typos
export const EVENTS = {
    DATA_SYNCED: 'data:synced',
    DATA_FILTERED: 'data:filtered',
    CATEGORY_CHANGED: 'category:changed',
    CHAT_OPENED: 'chat:opened',
    CHAT_CLOSED: 'chat:closed',
    CHAT_MESSAGE: 'chat:message',
    PERIOD_CHANGED: 'period:changed',
    THEME_CHANGED: 'theme:changed',
    TOAST: 'ui:toast',
};
