// ─── HEATMAP, EXPORT, ACHIEVEMENTS, CONFIRMATION, GENEROSITY, HEALTH SCORE ──
import dayjs from 'dayjs';

// ============== HEATMAP ==============

export function openHeatmap(STATE, callbacks) {
    const { renderHeatmap, trackAchievement } = callbacks;
    renderHeatmap();
    document.getElementById('heatmapModal').classList.remove('hidden');
    trackAchievement('fact_viewed_heatmap');
}

export function closeHeatmap() {
    document.getElementById('heatmapModal').classList.add('hidden');
}

export function renderHeatmap(STATE, callbacks) {
    const { formatNum, showFilteredResults } = callbacks;

    const container = document.getElementById('heatmapContainer');
    if (!container) return;

    const out = STATE.allTxns.filter(t => t.direction === 'OUT');

    const endDate = dayjs();
    const startDate = endDate.subtract(90, 'day');

    const dailySpend = {};
    out.forEach(t => {
        if (t.date.isAfter(startDate) && t.date.isBefore(endDate.add(1, 'day'))) {
            const key = t.date.format('YYYY-MM-DD');
            dailySpend[key] = (dailySpend[key] || 0) + t.amount;
        }
    });

    const amounts = Object.values(dailySpend);
    const maxSpend = Math.max(...amounts, 1);
    const avgSpend = amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;

    const weeks = [];
    let currentWeek = [];
    let d = startDate;

    const startDow = d.day();
    for (let i = 0; i < startDow; i++) {
        currentWeek.push(null);
    }

    while (d.isBefore(endDate) || d.isSame(endDate, 'day')) {
        const key = d.format('YYYY-MM-DD');
        const amount = dailySpend[key] || 0;
        currentWeek.push({ date: d, amount, key });

        if (d.day() === 6) {
            weeks.push(currentWeek);
            currentWeek = [];
        }
        d = d.add(1, 'day');
    }
    if (currentWeek.length > 0) {
        weeks.push(currentWeek);
    }

    const getColor = (amount) => {
        if (amount === 0) return '#E5E5E5';
        const ratio = amount / maxSpend;
        if (ratio < 0.25) return '#C6E48B';
        if (ratio < 0.5) return '#7BC96F';
        if (ratio < 0.75) return '#239A3B';
        return '#196127';
    };

    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    container.innerHTML = `
        <div class="flex gap-1">
            <div class="flex flex-col gap-1 text-[9px] text-fact-muted dark:text-fact-dark-muted mr-1">
                ${dayLabels.map((l, i) => `<div class="h-3 flex items-center">${i % 2 === 1 ? l : ''}</div>`).join('')}
            </div>
            ${weeks.map((week) => `
                <div class="flex flex-col gap-1">
                    ${[0,1,2,3,4,5,6].map(dow => {
                        const cell = week[dow];
                        if (!cell) return '<div class="heatmap-cell" style="background: transparent"></div>';
                        const color = getColor(cell.amount);
                        const tooltip = `${cell.date.format('MMM D')}: QAR ${formatNum(cell.amount)}`;
                        return `<div class="heatmap-cell" style="background: ${color}" title="${tooltip}" onclick="drilldownDate('${cell.key}')"></div>`;
                    }).join('')}
                </div>
            `).join('')}
        </div>
        <div class="mt-4 grid grid-cols-3 gap-4 text-center text-xs">
            <div>
                <div class="text-lg font-display font-bold">${formatNum(amounts.reduce((a, b) => a + b, 0))}</div>
                <div class="text-fact-muted dark:text-fact-dark-muted">Total (90 days)</div>
            </div>
            <div>
                <div class="text-lg font-display font-bold">${formatNum(avgSpend)}</div>
                <div class="text-fact-muted dark:text-fact-dark-muted">Daily Avg</div>
            </div>
            <div>
                <div class="text-lg font-display font-bold">${formatNum(maxSpend)}</div>
                <div class="text-fact-muted dark:text-fact-dark-muted">Max Day</div>
            </div>
        </div>
    `;
}

export function drilldownDate(dateKey, STATE, callbacks) {
    const { showFilteredResults } = callbacks;

    const date = dayjs(dateKey);
    const txns = STATE.allTxns.filter(t =>
        t.direction === 'OUT' &&
        t.date.format('YYYY-MM-DD') === dateKey
    );
    showFilteredResults(txns, `${date.format('MMM D, YYYY')}`);
    closeHeatmap();
}

// ============== CSV EXPORT ==============

export function exportCSV(STATE, callbacks) {
    const { formatNum, showToast, trackAchievement } = callbacks;

    const icon = document.getElementById('exportIcon');
    if (icon) icon.classList.add('export-spin');

    try {
        const headers = ['Date', 'Time', 'Amount', 'Currency', 'Merchant', 'Category', 'Direction', 'Pattern'];
        const rows = STATE.filtered.map(t => [
            t.date.format('YYYY-MM-DD'),
            t.date.format('HH:mm'),
            t.amount.toFixed(2),
            t.currency,
            `"${t.display.replace(/"/g, '""')}"`,
            t.merchantType,
            t.direction,
            t.dims.pattern
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `fact-flow-${STATE.dateRange.start.format('YYYY-MM-DD')}-to-${STATE.dateRange.end.format('YYYY-MM-DD')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast(`Exported ${rows.length} transactions`, 'success');
        trackAchievement('fact_exported');
    } catch (err) {
        showToast('Export failed: ' + err.message, 'error');
    } finally {
        setTimeout(() => {
            if (icon) icon.classList.remove('export-spin');
        }, 500);
    }
}

// ============== XLSX EXPORT ==============

/**
 * Export transactions as a proper .xlsx file (Office Open XML).
 * Uses a lightweight XML builder — no external library needed.
 */
export function exportXLSX(STATE, callbacks) {
    const { formatNum, showToast, trackAchievement } = callbacks;

    try {
        const headers = ['Date', 'Time', 'Amount (QAR)', 'Original Amount', 'Currency', 'Merchant', 'Category', 'Direction', 'Pattern', 'Type'];
        const rows = STATE.filtered.map(t => [
            t.date.format('YYYY-MM-DD'),
            t.date.format('HH:mm'),
            t.amount.toFixed(2),
            t.originalAmount.toFixed(2),
            t.currency,
            t.display || t.counterparty || '',
            t.merchantType,
            t.direction,
            t.dims?.pattern || '',
            t.txnType || ''
        ]);

        // Build xlsx XML
        const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const sheetRows = [headers, ...rows].map((row, ri) => {
            const cells = row.map((cell, ci) => {
                const ref = String.fromCharCode(65 + ci) + (ri + 1);
                // Numbers: try to parse as number for proper Excel handling
                const num = parseFloat(cell);
                if (!isNaN(num) && String(cell).trim() === String(num)) {
                    return `<c r="${ref}"><v>${num}</v></c>`;
                }
                return `<c r="${ref}" t="inlineStr"><is><t>${escXml(cell)}</t></is></c>`;
            }).join('');
            return `<row r="${ri + 1}">${cells}</row>`;
        }).join('');

        const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${sheetRows}</sheetData>
</worksheet>`;

        const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

        const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Transactions" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

        const relsRoot = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

        const relsWb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

        // Build ZIP using Blob (minimal zip structure)
        const zip = buildSimpleZip({
            '[Content_Types].xml': contentTypes,
            '_rels/.rels': relsRoot,
            'xl/workbook.xml': workbook,
            'xl/_rels/workbook.xml.rels': relsWb,
            'xl/worksheets/sheet1.xml': sheetXml,
        });

        const blob = new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        downloadBlob(blob, `fact-flow-${STATE.dateRange.start.format('YYYY-MM-DD')}-to-${STATE.dateRange.end.format('YYYY-MM-DD')}.xlsx`);

        showToast(`Exported ${rows.length} transactions as Excel`, 'success');
        trackAchievement('fact_exported');
    } catch (err) {
        showToast('Excel export failed: ' + err.message, 'error');
    }
}

// ============== PDF EXPORT ==============

/**
 * Export transactions as a printable PDF using a new window.
 * Uses the browser's built-in print-to-PDF capability for clean formatting.
 */
export function exportPDF(STATE, callbacks) {
    const { formatNum, showToast, trackAchievement } = callbacks;

    try {
        const dateLabel = `${STATE.dateRange.start.format('MMM D, YYYY')} – ${STATE.dateRange.end.format('MMM D, YYYY')}`;
        const totalOut = STATE.filtered.filter(t => t.direction === 'OUT').reduce((s, t) => s + t.amount, 0);
        const totalIn = STATE.filtered.filter(t => t.direction === 'IN').reduce((s, t) => s + t.amount, 0);

        // Category summary
        const catSummary = {};
        STATE.filtered.filter(t => t.direction === 'OUT').forEach(t => {
            catSummary[t.merchantType] = (catSummary[t.merchantType] || 0) + t.amount;
        });
        const sortedCats = Object.entries(catSummary).sort((a, b) => b[1] - a[1]);

        const txnRows = STATE.filtered.map(t => `
            <tr>
                <td>${t.date.format('MMM D')}</td>
                <td>${t.date.format('HH:mm')}</td>
                <td style="text-align:right; color:${t.direction === 'IN' ? '#4CAF50' : '#333'}">${t.direction === 'IN' ? '+' : '-'}${formatNum(t.amount)}</td>
                <td>${escapeForPdf(t.display || t.counterparty)}</td>
                <td>${t.merchantType}</td>
            </tr>`).join('');

        const catRows = sortedCats.map(([cat, amt]) => `
            <tr><td>${cat}</td><td style="text-align:right">QAR ${formatNum(amt)}</td>
            <td style="text-align:right">${totalOut > 0 ? Math.round((amt / totalOut) * 100) : 0}%</td></tr>`).join('');

        const html = `<!DOCTYPE html><html><head><title>FACT/Flow Report</title>
<style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 40px; color: #1a1a1a; font-size: 11px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    h2 { font-size: 14px; margin-top: 24px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    .subtitle { color: #888; font-size: 12px; margin-bottom: 20px; }
    .summary { display: flex; gap: 32px; margin-bottom: 20px; }
    .summary-item { text-align: center; }
    .summary-item .value { font-size: 18px; font-weight: 700; }
    .summary-item .label { color: #888; font-size: 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #eee; }
    th { font-weight: 600; font-size: 10px; color: #888; text-transform: uppercase; border-bottom: 2px solid #ddd; }
    @media print { body { margin: 20px; } .no-print { display: none; } }
</style></head><body>
<h1>FACT/Flow Transaction Report</h1>
<div class="subtitle">${dateLabel} &middot; ${STATE.filtered.length} transactions</div>
<div class="summary">
    <div class="summary-item"><div class="value" style="color:#E57373">QAR ${formatNum(totalOut)}</div><div class="label">Total Spent</div></div>
    <div class="summary-item"><div class="value" style="color:#4CAF50">QAR ${formatNum(totalIn)}</div><div class="label">Total Income</div></div>
    <div class="summary-item"><div class="value">QAR ${formatNum(totalIn - totalOut)}</div><div class="label">Net</div></div>
</div>
<h2>Spending by Category</h2>
<table><thead><tr><th>Category</th><th style="text-align:right">Amount</th><th style="text-align:right">%</th></tr></thead>
<tbody>${catRows}</tbody></table>
<h2>All Transactions</h2>
<table><thead><tr><th>Date</th><th>Time</th><th style="text-align:right">Amount (QAR)</th><th>Merchant</th><th>Category</th></tr></thead>
<tbody>${txnRows}</tbody></table>
<div class="no-print" style="margin-top:24px;text-align:center">
    <button onclick="window.print()" style="padding:10px 24px;font-size:14px;background:#1a1a1a;color:#fff;border:none;border-radius:8px;cursor:pointer">
        Save as PDF
    </button>
</div>
<script>setTimeout(()=>window.print(), 500);</script>
</body></html>`;

        const pdfWindow = window.open('', '_blank');
        if (pdfWindow) {
            pdfWindow.document.write(html);
            pdfWindow.document.close();
            showToast('PDF report opened — use Save as PDF in the print dialog', 'info', 5000);
        } else {
            showToast('Pop-up blocked. Please allow pop-ups for this site.', 'error');
        }

        trackAchievement('fact_exported');
    } catch (err) {
        showToast('PDF export failed: ' + err.message, 'error');
    }
}

// Helper: escape text for PDF HTML
function escapeForPdf(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Helper: download a blob as a file
function downloadBlob(blob, filename) {
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Minimal ZIP file builder (for XLSX)
function buildSimpleZip(files) {
    const encoder = new TextEncoder();
    const entries = Object.entries(files).map(([name, content]) => ({
        name: encoder.encode(name),
        data: encoder.encode(content),
    }));

    const parts = [];
    const centralDir = [];
    let offset = 0;

    for (const entry of entries) {
        // Local file header
        const header = new Uint8Array(30 + entry.name.length);
        const view = new DataView(header.buffer);
        view.setUint32(0, 0x04034b50, true);  // signature
        view.setUint16(4, 20, true);           // version needed
        view.setUint16(6, 0, true);            // flags
        view.setUint16(8, 0, true);            // compression (none)
        view.setUint16(10, 0, true);           // mod time
        view.setUint16(12, 0, true);           // mod date
        view.setUint32(14, crc32(entry.data), true);
        view.setUint32(18, entry.data.length, true);  // compressed
        view.setUint32(22, entry.data.length, true);  // uncompressed
        view.setUint16(26, entry.name.length, true);
        view.setUint16(28, 0, true);           // extra field length
        header.set(entry.name, 30);

        // Central directory entry
        const cdEntry = new Uint8Array(46 + entry.name.length);
        const cdView = new DataView(cdEntry.buffer);
        cdView.setUint32(0, 0x02014b50, true);
        cdView.setUint16(4, 20, true);
        cdView.setUint16(6, 20, true);
        cdView.setUint16(8, 0, true);
        cdView.setUint16(10, 0, true);
        cdView.setUint16(12, 0, true);
        cdView.setUint16(14, 0, true);
        cdView.setUint32(16, crc32(entry.data), true);
        cdView.setUint32(20, entry.data.length, true);
        cdView.setUint32(24, entry.data.length, true);
        cdView.setUint16(28, entry.name.length, true);
        cdView.setUint16(30, 0, true);
        cdView.setUint16(32, 0, true);
        cdView.setUint16(34, 0, true);
        cdView.setUint16(36, 0, true);
        cdView.setUint32(38, 0, true);
        cdView.setUint32(42, offset, true);
        cdEntry.set(entry.name, 46);

        centralDir.push(cdEntry);
        parts.push(header, entry.data);
        offset += header.length + entry.data.length;
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const cd of centralDir) {
        parts.push(cd);
        cdSize += cd.length;
    }

    // End of central directory
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(4, 0, true);
    eocdView.setUint16(6, 0, true);
    eocdView.setUint16(8, entries.length, true);
    eocdView.setUint16(10, entries.length, true);
    eocdView.setUint32(12, cdSize, true);
    eocdView.setUint32(16, cdOffset, true);
    eocdView.setUint16(20, 0, true);
    parts.push(eocd);

    // Combine all parts
    const totalLength = parts.reduce((s, p) => s + p.length, 0);
    const result = new Uint8Array(totalLength);
    let pos = 0;
    for (const part of parts) {
        result.set(part, pos);
        pos += part.length;
    }
    return result;
}

// CRC32 table and function
const crc32Table = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c;
    }
    return table;
})();

function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ============== ACHIEVEMENTS ==============

export const ACHIEVEMENTS = {
    'first-login': { icon: 'rocket', name: 'First Steps', desc: 'Opened FACT/Flow for the first time', check: () => true },
    'first-categorize': { icon: 'tag', name: 'Organizer', desc: 'Categorized your first transaction', check: (STATE) => Object.keys(STATE.localMappings || {}).length > 0 },
    'ten-categorize': { icon: 'list', name: 'Sorting Pro', desc: 'Categorized 10 transactions', check: (STATE) => Object.keys(STATE.localMappings || {}).length >= 10 },
    'first-goal': { icon: 'target', name: 'Goal Setter', desc: 'Set your first budget goal', check: (STATE, getGoals) => getGoals(STATE).length > 0 },
    'three-goals': { icon: 'circus', name: 'Triple Threat', desc: 'Set 3 budget goals', check: (STATE, getGoals) => getGoals(STATE).length >= 3 },
    'streak-3': { icon: 'fire', name: 'On Fire', desc: '3-day under-budget streak', check: (STATE, _, getStreakData) => getStreakData(STATE).longestStreak >= 3 },
    'streak-7': { icon: 'lightning', name: 'Week Warrior', desc: '7-day under-budget streak', check: (STATE, _, getStreakData) => getStreakData(STATE).longestStreak >= 7 },
    'ask-ai': { icon: 'robot', name: 'AI Explorer', desc: 'Asked AI for spending advice', check: () => localStorage.getItem('fact_asked_ai') === 'true' },
    'voice-input': { icon: 'mic', name: 'Voice Commander', desc: 'Used voice input', check: () => localStorage.getItem('fact_used_voice') === 'true' },
    'dark-mode': { icon: 'moon', name: 'Night Owl', desc: 'Switched to dark mode', check: () => localStorage.getItem('fact_dark_mode') === 'true' },
    'export-data': { icon: 'chart', name: 'Data Analyst', desc: 'Exported your data to CSV', check: () => localStorage.getItem('fact_exported') === 'true' },
    'heatmap-view': { icon: 'calendar', name: 'Pattern Seeker', desc: 'Viewed the spending heatmap', check: () => localStorage.getItem('fact_viewed_heatmap') === 'true' },
    'generosity-set': { icon: 'heart', name: 'Generous Heart', desc: 'Set a generosity budget', check: (STATE) => localStorage.getItem(`fact_generosity_${STATE.currentUser}`) !== null }
};

export function getUnlockedAchievements(STATE) {
    try {
        return JSON.parse(localStorage.getItem(`fact_achievements_${STATE.currentUser}`)) || [];
    } catch (e) {
        return [];
    }
}

export function saveUnlockedAchievements(achievements, STATE) {
    localStorage.setItem(`fact_achievements_${STATE.currentUser}`, JSON.stringify(achievements));
}

export function checkAchievements(STATE, callbacks) {
    const { getGoals, getStreakData, celebrate } = callbacks;

    const unlocked = getUnlockedAchievements(STATE);
    const newUnlocks = [];

    Object.entries(ACHIEVEMENTS).forEach(([id, achievement]) => {
        if (!unlocked.includes(id) && achievement.check(STATE, getGoals, getStreakData)) {
            unlocked.push(id);
            newUnlocks.push({ id, ...achievement });
        }
    });

    if (newUnlocks.length > 0) {
        saveUnlockedAchievements(unlocked, STATE);
        setTimeout(() => celebrate(newUnlocks[0]), 500);
    }

    return unlocked;
}

export function celebrate(achievement) {
    const overlay = document.getElementById('celebrationOverlay');
    if (!overlay) return;

    const confettiColors = ['#F4C44E', '#75B876', '#B593C6', '#E57373', '#64B5F6'];
    let confettiHtml = '';
    for (let i = 0; i < 50; i++) {
        const color = confettiColors[Math.floor(Math.random() * confettiColors.length)];
        const left = Math.random() * 100;
        const delay = Math.random() * 2;
        const size = 5 + Math.random() * 10;
        confettiHtml += `<div class="confetti" style="left: ${left}%; background: ${color}; width: ${size}px; height: ${size}px; animation-delay: ${delay}s; border-radius: ${Math.random() > 0.5 ? '50%' : '0'}"></div>`;
    }

    overlay.innerHTML = `
        <div class="celebration-overlay" onclick="closeCelebration()">
            ${confettiHtml}
            <div class="celebration-box" onclick="event.stopPropagation()">
                <div class="celebration-icon">${achievement.icon}</div>
                <h2 class="font-display font-bold text-xl text-fact-ink mt-2">Achievement Unlocked!</h2>
                <h3 class="font-display font-semibold text-lg text-fact-ink mt-1">${achievement.name}</h3>
                <p class="text-sm text-fact-ink/70 mt-2">${achievement.desc}</p>
                <button onclick="closeCelebration()" class="mt-4 px-6 py-2 bg-fact-ink text-white rounded-full font-medium">
                    Awesome!
                </button>
            </div>
        </div>
    `;
    overlay.classList.remove('hidden');

    setTimeout(closeCelebration, 5000);
}

export function closeCelebration() {
    const overlay = document.getElementById('celebrationOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.innerHTML = '';
    }
}

export function openAchievements(STATE, callbacks) {
    const { escapeHtml } = callbacks;

    const unlocked = getUnlockedAchievements(STATE);
    const container = document.getElementById('achievementsList');
    const progress = document.getElementById('achievementProgress');

    if (progress) {
        progress.textContent = `${unlocked.length} of ${Object.keys(ACHIEVEMENTS).length} unlocked`;
    }

    if (container) {
        container.innerHTML = Object.entries(ACHIEVEMENTS).map(([id, a]) => {
            const isUnlocked = unlocked.includes(id);
            return `
                <div class="achievement-badge ${isUnlocked ? '' : 'locked'}">
                    <div class="badge-icon">${a.icon}</div>
                    <div class="text-xs font-medium">${a.name}</div>
                    <div class="text-[10px] text-fact-muted dark:text-fact-dark-muted mt-1">${isUnlocked ? a.desc : '???'}</div>
                </div>
            `;
        }).join('');
    }

    document.getElementById('achievementsModal').classList.remove('hidden');
}

export function closeAchievements() {
    document.getElementById('achievementsModal').classList.add('hidden');
}

export function trackAchievement(key, checkAchievementsFn) {
    localStorage.setItem(key, 'true');
    if (checkAchievementsFn) {
        setTimeout(checkAchievementsFn, 100);
    }
}

// ============== CONFIRMATION DIALOG ==============

export function showConfirm(options, escapeHtml) {
    return new Promise((resolve) => {
        const { title, message, confirmText = 'Confirm', cancelText = 'Cancel', type = 'warning' } = options;
        const modal = document.getElementById('confirmModal');
        if (!modal) {
            resolve(false);
            return;
        }

        const colors = {
            warning: { bg: 'bg-fact-yellow', icon: 'warning' },
            danger: { bg: 'bg-fact-red', icon: 'trash' },
            info: { bg: 'bg-fact-purple', icon: 'info' }
        };
        const color = colors[type] || colors.warning;

        modal.innerHTML = `
            <div class="confirm-overlay" onclick="event.target === this && confirmResolve(false)">
                <div class="confirm-box">
                    <div class="text-4xl mb-4">${color.icon}</div>
                    <h3 class="font-display font-semibold text-lg mb-2">${escapeHtml(title)}</h3>
                    <p class="text-sm text-fact-muted dark:text-fact-dark-muted mb-6">${escapeHtml(message)}</p>
                    <div class="flex gap-3">
                        <button onclick="confirmResolve(false)" class="flex-1 px-4 py-2 text-sm rounded-lg border border-fact-border dark:border-fact-dark-border hover:bg-gray-50 dark:hover:bg-gray-800">${cancelText}</button>
                        <button onclick="confirmResolve(true)" class="flex-1 px-4 py-2 text-sm rounded-lg ${color.bg} text-white font-medium">${confirmText}</button>
                    </div>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');

        window.confirmResolve = (result) => {
            modal.classList.add('hidden');
            modal.innerHTML = '';
            resolve(result);
        };
    });
}

// ============== GENEROSITY BUDGET ==============

export const DEFAULT_GENEROSITY_CATEGORIES = [
    { id: 'gifts', name: 'Gifts & Presents', default: true },
    { id: 'charity', name: 'Charity & Donations', default: true },
    { id: 'treats', name: 'Treating Others (meals, drinks)', default: true },
    { id: 'social', name: 'Social Outings (I paid for everyone)', default: false },
    { id: 'family', name: 'Family Support', default: false }
];

export function getGenerositySettings(STATE) {
    try {
        const stored = localStorage.getItem(`fact_generosity_${STATE.currentUser}`);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {}
    return null;
}

export function saveGenerositySettings(STATE, callbacks) {
    const { showToast, checkAchievements, renderGenerosityBudget } = callbacks;

    const budgetInput = document.getElementById('generosityBudgetInput');
    const budget = parseFloat(budgetInput?.value) || 0;

    const selectedCategories = [];
    document.querySelectorAll('#generosityCategories input[type="checkbox"]:checked').forEach(cb => {
        selectedCategories.push(cb.value);
    });

    const settings = {
        budget: budget,
        categories: selectedCategories,
        enabled: budget > 0
    };

    localStorage.setItem(`fact_generosity_${STATE.currentUser}`, JSON.stringify(settings));

    setTimeout(() => checkAchievements(), 500);

    closeGenerositySettings();
    renderGenerosityBudget();
    showToast('Generosity budget saved!', 'success');
}

export function openGenerositySettings(STATE) {
    const settings = getGenerositySettings(STATE) || { budget: 0, categories: ['gifts', 'charity', 'treats'], enabled: false };

    const budgetInput = document.getElementById('generosityBudgetInput');
    if (budgetInput) budgetInput.value = settings.budget || '';

    const container = document.getElementById('generosityCategories');
    if (container) {
        container.innerHTML = DEFAULT_GENEROSITY_CATEGORIES.map(cat => {
            const checked = settings.categories?.includes(cat.id) || (!settings.categories && cat.default);
            return `
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" value="${cat.id}" ${checked ? 'checked' : ''}
                        class="w-4 h-4 rounded border-fact-border text-fact-purple focus:ring-fact-purple">
                    <span>${cat.name}</span>
                </label>
            `;
        }).join('');
    }

    document.getElementById('generosityModal').classList.remove('hidden');
}

export function closeGenerositySettings() {
    document.getElementById('generosityModal').classList.add('hidden');
}

export function renderGenerosityBudget(STATE, formatNum) {
    const settings = getGenerositySettings(STATE);
    const card = document.getElementById('generosityCard');

    if (!card) return;

    if (!settings || !settings.enabled) {
        card.classList.add('hidden');
        return;
    }

    card.classList.remove('hidden');

    // Calculate generosity spending (simplified)
    const now = dayjs();
    const monthStart = now.startOf('month');
    const monthTxns = STATE.allTxns.filter(t =>
        t.direction === 'OUT' &&
        t.date.isAfter(monthStart) &&
        t.date.isBefore(now.add(1, 'day'))
    );

    // For now, just estimate based on Family transfers
    const generosityTxns = monthTxns.filter(t =>
        t.merchantType === 'Family' || t.summaryGroup === 'Family'
    );

    const spent = generosityTxns.reduce((s, t) => s + t.amount, 0);
    const remaining = Math.max(0, settings.budget - spent);
    const percentage = settings.budget > 0 ? Math.min((spent / settings.budget) * 100, 100) : 0;

    const spentEl = document.getElementById('generositySpent');
    const budgetEl = document.getElementById('generosityBudget');
    const fillEl = document.getElementById('generosityMeterFill');
    const statusEl = document.getElementById('generosityStatus');

    if (spentEl) spentEl.textContent = `QAR ${formatNum(spent)}`;
    if (budgetEl) budgetEl.textContent = `QAR ${formatNum(settings.budget)}`;
    if (fillEl) {
        fillEl.style.width = `${percentage}%`;
        fillEl.className = `generosity-meter-fill ${spent > settings.budget ? 'over' : ''}`;
    }
    if (statusEl) {
        if (spent > settings.budget) {
            statusEl.textContent = `Over budget by QAR ${formatNum(spent - settings.budget)}`;
            statusEl.className = 'text-xs text-fact-red';
        } else {
            statusEl.textContent = `QAR ${formatNum(remaining)} left to give`;
            statusEl.className = 'text-xs text-fact-muted dark:text-fact-dark-muted';
        }
    }
}

// ============== HEALTH SCORE ==============

export function openHealthScore(STATE, callbacks) {
    const { checkDailyBudget, getStreakData, getGoals, trackAchievement } = callbacks;

    const modal = document.getElementById('healthScoreModal');
    if (!modal) return;

    // Calculate simple health score
    const budgetStatus = checkDailyBudget();
    const streak = getStreakData(STATE);
    const goals = getGoals(STATE);

    let score = 50; // Base score
    if (budgetStatus.status === 'safe') score += 20;
    else if (budgetStatus.status === 'warning') score += 10;
    score += Math.min(20, streak.currentStreak * 4);
    score += Math.min(10, goals.length * 3);

    const scoreEl = document.getElementById('healthScoreNumber');
    if (scoreEl) scoreEl.textContent = score;

    const statusEl = document.getElementById('healthStatusLabel');
    const descEl = document.getElementById('healthStatusDesc');

    if (statusEl && descEl) {
        if (score >= 80) {
            statusEl.textContent = 'Excellent!';
            descEl.textContent = 'Your finances are in great shape';
        } else if (score >= 60) {
            statusEl.textContent = 'Good';
            descEl.textContent = 'You\'re on the right track';
        } else {
            statusEl.textContent = 'Needs Work';
            descEl.textContent = 'Let\'s focus on building better habits';
        }
    }

    modal.classList.remove('hidden');
    trackAchievement('fact_health_score');
}

export function closeHealthScore() {
    document.getElementById('healthScoreModal').classList.add('hidden');
}

// ============== PATTERN DETECTION ==============

export function renderPatternWarnings(showToast) {
    // Analyze patterns and show nudges if relevant
    const now = dayjs();
    const hour = now.hour();

    // Late night nudge
    if ((hour >= 22 || hour < 5) && !sessionStorage.getItem('fact_nudge_shown')) {
        sessionStorage.setItem('fact_nudge_shown', 'true');
        if (Math.random() > 0.7) {
            showToast('Late night spending? Sleep on it!', 'info');
        }
    }
}
