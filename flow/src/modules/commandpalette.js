// ─── COMMAND PALETTE (Cmd+K / Ctrl+K) ───────────────────────────
// Fuzzy-searchable command list for quick navigation and actions.
// Note: innerHTML usage is safe here — all content comes from the
// hardcoded COMMANDS array (static icons + labels), not user input.

const COMMANDS = [
    { id: 'sync', label: 'Sync Data', icon: '🔄', action: () => window.syncData() },
    { id: 'chat', label: 'Open Chat', icon: '💬', action: () => window.toggleChat() },
    { id: 'settings', label: 'Settings', icon: '⚙️', action: () => window.openSettings() },
    { id: 'health', label: 'Health Score', icon: '❤️', action: () => window.openHealthScore() },
    { id: 'achievements', label: 'Achievements', icon: '🏆', action: () => window.openAchievements() },
    { id: 'export-csv', label: 'Export CSV', icon: '📊', action: () => window.exportCSV() },
    { id: 'export-xlsx', label: 'Export XLSX', icon: '📑', action: () => window.exportXLSX() },
    { id: 'export-pdf', label: 'Export PDF', icon: '📄', action: () => window.exportPDF() },
    { id: 'dark-mode', label: 'Toggle Dark Mode', icon: '🌙', action: () => window.toggleDarkMode() },
    { id: 'this-month', label: 'This Month', icon: '📅', action: () => window.setPeriod('month') },
    { id: 'last-month', label: 'Last Month', icon: '📅', action: () => window.setPeriod('lastMonth') },
    { id: 'last-90', label: 'Last 90 Days', icon: '📅', action: () => window.setPeriod('90d') },
    { id: 'salary-period', label: 'Salary Period', icon: '💰', action: () => window.setSalaryPeriod() },
    { id: 'all-time', label: 'All Time', icon: '📅', action: () => window.setPeriod('all') },
    { id: 'focus', label: 'Focus Mode', icon: '🎯', action: () => window.toggleFocusMode?.() },
    { id: 'heatmap', label: 'View Heatmap', icon: '🗓️', action: () => { document.querySelector('[onclick*="showVizTab"][onclick*="heatmap"]')?.click(); } },
    { id: 'trend', label: 'View Trends', icon: '📈', action: () => { document.querySelector('[onclick*="showVizTab"][onclick*="trend"]')?.click(); } },
    { id: 'merchants', label: 'Top Merchants', icon: '🏪', action: () => { document.querySelector('[onclick*="showVizTab"][onclick*="merchants"]')?.click(); } },
];

let selectedIndex = 0;
let filteredCommands = [...COMMANDS];

export function openCommandPalette() {
    const el = document.getElementById('commandPalette');
    if (!el) return;
    el.classList.remove('hidden');
    const input = document.getElementById('commandInput');
    if (input) {
        input.value = '';
        input.focus();
    }
    selectedIndex = 0;
    filteredCommands = [...COMMANDS];
    renderResults();
}

export function closeCommandPalette() {
    const el = document.getElementById('commandPalette');
    if (el) el.classList.add('hidden');
}

export function isCommandPaletteOpen() {
    const el = document.getElementById('commandPalette');
    return el && !el.classList.contains('hidden');
}

function renderResults() {
    const container = document.getElementById('commandResults');
    if (!container) return;

    if (!filteredCommands.length) {
        container.innerHTML = '<div class="px-4 py-6 text-center text-sm text-fact-muted">No matching commands</div>';
        return;
    }

    // Safe: all content is from hardcoded COMMANDS array, not user input
    container.innerHTML = filteredCommands.map((cmd, i) => {
        const isSelected = i === selectedIndex;
        return `<button class="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
            isSelected ? 'bg-fact-yellow/10 text-fact-text dark:text-fact-dark-text' : 'text-fact-muted hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }" data-cmd-index="${i}" onclick="window.executeCommand(${i})">
            <span class="text-base shrink-0">${cmd.icon}</span>
            <span class="font-medium">${cmd.label}</span>
        </button>`;
    }).join('');
}

export function handleCommandInput(e) {
    const query = e.target.value.toLowerCase().trim();
    filteredCommands = query
        ? COMMANDS.filter(cmd => cmd.label.toLowerCase().includes(query) || cmd.id.includes(query))
        : [...COMMANDS];
    selectedIndex = 0;
    renderResults();
}

export function handleCommandKeydown(e) {
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, filteredCommands.length - 1);
        renderResults();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        renderResults();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        executeCommand(selectedIndex);
    } else if (e.key === 'Escape') {
        closeCommandPalette();
    }
}

export function executeCommand(index) {
    const cmd = filteredCommands[index];
    if (!cmd) return;
    closeCommandPalette();
    try { cmd.action(); } catch (_e) { /* command may not be available */ }
}

export function initCommandPalette() {
    const input = document.getElementById('commandInput');
    if (input) {
        input.addEventListener('input', handleCommandInput);
        input.addEventListener('keydown', handleCommandKeydown);
    }

    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            if (isCommandPaletteOpen()) {
                closeCommandPalette();
            } else {
                openCommandPalette();
            }
        }
    });
}
