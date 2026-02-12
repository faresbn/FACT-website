// ─── CSV IMPORT ─────────────────────────────────────────────────
// Handles CSV file upload, column mapping, and server import.
// Note: innerHTML usage in this module renders content from:
// 1. Hardcoded field labels/icons (static, not user input)
// 2. CSV column headers from user's own uploaded file (self-XSS only)
// 3. Numeric import results from our own server response
// This matches existing codebase patterns (digest.js, modals.js, features.js).
import Papa from 'papaparse';

let parsedRows = [];
let columnMapping = { date: null, amount: null, counterparty: null, currency: null, direction: null };

export function openImportModal() {
    parsedRows = [];
    columnMapping = { date: null, amount: null, counterparty: null, currency: null, direction: null };
    document.getElementById('importModal').classList.remove('hidden');
    document.getElementById('importStep1').classList.remove('hidden');
    document.getElementById('importStep2').classList.add('hidden');
    document.getElementById('importStep3').classList.add('hidden');
    document.getElementById('importDropZone').classList.remove('border-fact-green');
    document.getElementById('importFileName').textContent = '';
    document.getElementById('importFileInput').value = '';
}

export function closeImportModal() {
    document.getElementById('importModal').classList.add('hidden');
    parsedRows = [];
}

export function handleImportFile(file) {
    if (!file) return;
    document.getElementById('importFileName').textContent = file.name;
    document.getElementById('importDropZone').classList.add('border-fact-green');

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
            if (!results.data.length) {
                document.getElementById('importFileName').textContent = 'No data found in file';
                return;
            }
            parsedRows = results.data;
            renderColumnMapper(results.meta.fields || [], results.data.slice(0, 3));
        },
        error: () => {
            document.getElementById('importFileName').textContent = 'Error reading file';
        }
    });
}

function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderColumnMapper(headers, sampleRows) {
    // Auto-detect columns by name heuristics
    const detect = (patterns) => headers.find(h => patterns.some(p => h.toLowerCase().includes(p))) || '';
    columnMapping.date = detect(['date', 'time', 'timestamp']);
    columnMapping.amount = detect(['amount', 'sum', 'value', 'total']);
    columnMapping.counterparty = detect(['merchant', 'counterparty', 'description', 'payee', 'name', 'vendor']);
    columnMapping.currency = detect(['currency', 'curr', 'ccy']);
    columnMapping.direction = detect(['direction', 'type', 'debit', 'credit']);

    const opts = (selected) => headers.map(h =>
        `<option value="${escapeAttr(h)}" ${h === selected ? 'selected' : ''}>${escapeAttr(h)}</option>`
    ).join('');

    const fields = [
        { key: 'date', label: 'Date *' },
        { key: 'amount', label: 'Amount *' },
        { key: 'counterparty', label: 'Merchant/Payee *' },
        { key: 'currency', label: 'Currency' },
        { key: 'direction', label: 'Direction (IN/OUT)' },
    ];

    document.getElementById('importMappingFields').innerHTML = fields.map(f =>
        `<div class="flex items-center gap-3">
            <label class="text-xs font-medium w-32 flex-shrink-0">${f.label}</label>
            <select data-map="${f.key}" onchange="updateImportMapping(this)"
                class="flex-1 px-3 py-2 border border-fact-border dark:border-fact-dark-border rounded-lg bg-white dark:bg-fact-dark-card text-sm focus:outline-none focus:ring-2 focus:ring-fact-yellow">
                <option value="">-- Skip --</option>
                ${opts(columnMapping[f.key])}
            </select>
        </div>`
    ).join('');

    // Preview table (CSV headers/data from user's own file)
    const previewHeaders = headers.slice(0, 5);
    document.getElementById('importPreview').innerHTML = `
        <table class="w-full text-[10px]">
            <thead><tr>${previewHeaders.map(h => `<th class="text-left p-1 font-medium text-fact-muted">${escapeAttr(h)}</th>`).join('')}</tr></thead>
            <tbody>${sampleRows.map(row => `<tr>${previewHeaders.map(h => `<td class="p-1 truncate max-w-[100px]">${escapeAttr(row[h] || '')}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
    `;

    document.getElementById('importRowCount').textContent = `${parsedRows.length} rows detected`;

    // Show step 2
    document.getElementById('importStep1').classList.add('hidden');
    document.getElementById('importStep2').classList.remove('hidden');
}

export function updateImportMapping(selectEl) {
    const key = selectEl.dataset.map;
    if (key) columnMapping[key] = selectEl.value || null;
}

export async function executeImport(supabaseClient, CONFIG, showToast, syncData) {
    if (!columnMapping.date || !columnMapping.amount || !columnMapping.counterparty) {
        showToast('Please map Date, Amount, and Merchant columns', 'error');
        return;
    }

    const btn = document.getElementById('importExecuteBtn');
    btn.disabled = true;
    btn.textContent = 'Importing...';

    try {
        const { data: session } = await supabaseClient.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) throw new Error('Not authenticated');

        // Map CSV rows to import format
        const rows = parsedRows.map(row => ({
            date: row[columnMapping.date] || '',
            amount: parseFloat(row[columnMapping.amount]) || 0,
            counterparty: row[columnMapping.counterparty] || '',
            currency: columnMapping.currency ? (row[columnMapping.currency] || 'QAR') : 'QAR',
            direction: columnMapping.direction ? (row[columnMapping.direction] || 'OUT').toUpperCase() : 'OUT',
        })).filter(r => r.date && r.amount && r.counterparty);

        if (!rows.length) {
            showToast('No valid rows to import', 'error');
            btn.disabled = false;
            btn.textContent = 'Import';
            return;
        }

        // Send in batches of 100
        let totalImported = 0, totalSkipped = 0, totalCategorized = 0, totalErrors = 0;
        const batchSize = 100;

        for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            btn.textContent = `Importing ${i + 1}-${Math.min(i + batchSize, rows.length)} of ${rows.length}...`;

            const response = await fetch(`${CONFIG.FUNCTIONS_BASE}/flow-import`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify({ rows: batch })
            });

            const result = await response.json();
            if (result.error && !result.imported) throw new Error(result.error);

            totalImported += result.imported || 0;
            totalSkipped += result.skipped || 0;
            totalCategorized += result.categorized || 0;
            totalErrors += (result.errors || []).length;
        }

        // Show results (all numbers from our own server response, safe)
        document.getElementById('importStep2').classList.add('hidden');
        document.getElementById('importStep3').classList.remove('hidden');
        document.getElementById('importResults').innerHTML = `
            <div class="grid grid-cols-2 gap-3 text-center">
                <div class="p-3 bg-fact-green/10 rounded-lg">
                    <div class="font-bold text-lg text-fact-green">${totalImported}</div>
                    <div class="text-[10px] text-fact-muted">Imported</div>
                </div>
                <div class="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
                    <div class="font-bold text-lg">${totalSkipped}</div>
                    <div class="text-[10px] text-fact-muted">Duplicates skipped</div>
                </div>
                <div class="p-3 bg-fact-yellow/10 rounded-lg">
                    <div class="font-bold text-lg text-fact-yellow">${totalCategorized}</div>
                    <div class="text-[10px] text-fact-muted">Auto-categorized</div>
                </div>
                <div class="p-3 ${totalErrors ? 'bg-fact-red/10' : 'bg-gray-100 dark:bg-gray-800'} rounded-lg">
                    <div class="font-bold text-lg ${totalErrors ? 'text-fact-red' : ''}">${totalErrors}</div>
                    <div class="text-[10px] text-fact-muted">Errors</div>
                </div>
            </div>
        `;

        showToast(`Imported ${totalImported} transactions`, 'success');

        if (totalImported > 0 && typeof syncData === 'function') {
            syncData();
        }
    } catch (err) {
        showToast('Import failed: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Import';
    }
}
