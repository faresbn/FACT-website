// ─── DIMENSION-BASED CATEGORIZATION SYSTEM ──────────────────────

// DIMENSION 1: WHAT (merchant type)
export const MERCHANT_TYPES = {
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
export const TIME_CONTEXTS = {
    'Work Hours': { color: '#3498DB', hours: [7, 16], days: [0, 1, 2, 3, 4], icon: '💼' },
    'Evening': { color: '#9B59B6', hours: [17, 21], icon: '🌆' },
    'Late Night': { color: '#2C3E50', hours: [21, 4], icon: '🌙' },
    'Weekend': { color: '#E74C3C', days: [5, 6], icon: '🎉' },
    'Early Morning': { color: '#F39C12', hours: [5, 7], icon: '🌅' }
};

// DIMENSION 3: SIZE (amount tier)
export const SIZE_TIERS = {
    'Micro': { max: 25, color: '#BDC3C7', icon: '•' },
    'Small': { max: 100, color: '#95A5A6', icon: '••' },
    'Medium': { max: 500, color: '#7F8C8D', icon: '•••' },
    'Large': { max: 2000, color: '#34495E', icon: '••••' },
    'Major': { max: Infinity, color: '#2C3E50', icon: '•••••' }
};

// DIMENSION 4: PATTERN
export const PATTERNS = {
    'Routine': { color: '#3498DB', icon: '🔄', description: 'Regular, repeated spending' },
    'Night Out': { color: '#9B59B6', icon: '🎉', description: 'Evening social spending cluster' },
    'Splurge': { color: '#E74C3C', icon: '💸', description: 'Unusually large purchase' },
    'Trip': { color: '#E67E22', icon: '✈️', description: 'Travel-related cluster' },
    'Subscription': { color: '#1ABC9C', icon: '📅', description: 'Recurring fixed amount' },
    'Work Expense': { color: '#3498DB', icon: '💼', description: 'Likely work-related' },
    'Normal': { color: '#95A5A6', icon: '○', description: 'Standard transaction' }
};

// High-level groupings for summary view
export const SUMMARY_GROUPS = {
    'Essentials': { color: '#75B876', icon: '🏠', types: ['Groceries', 'Bills', 'Health', 'Transport'] },
    'Food & Drinks': { color: '#F4C44E', icon: '🍽️', types: ['Dining', 'Coffee', 'Delivery', 'Bars & Nightlife'] },
    'Shopping & Fun': { color: '#9B8AC4', icon: '🛍️', types: ['Shopping', 'Entertainment', 'Travel'] },
    'Family': { color: '#E8A4B8', icon: '👨‍👩‍👧‍👦', types: ['Family'] },
    'Other': { color: '#A8B5C4', icon: '📋', types: ['Transfer', 'Other', 'Uncategorized'] }
};

// Build CAT_COLORS from MERCHANT_TYPES and SUMMARY_GROUPS
export const CAT_COLORS = {};
Object.entries(MERCHANT_TYPES).forEach(([name, data]) => CAT_COLORS[name] = data.color);
Object.entries(SUMMARY_GROUPS).forEach(([name, data]) => CAT_COLORS[name] = data.color);

// Compute functions
export function getSummaryGroup(merchantType) {
    for (const [group, data] of Object.entries(SUMMARY_GROUPS)) {
        if (data.types.includes(merchantType)) return group;
    }
    return 'Other';
}

export function getTimeContext(date) {
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

export function getSizeTier(amount) {
    for (const [tier, data] of Object.entries(SIZE_TIERS)) {
        if (amount <= data.max) return tier;
    }
    return 'Major';
}

export function getTypeColor(type) {
    return MERCHANT_TYPES[type]?.color || '#95A5A6';
}

export function getGroupColor(group) {
    return SUMMARY_GROUPS[group]?.color || '#95A5A6';
}
