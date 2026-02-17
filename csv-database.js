// ==UserScript==
// @name         Element451 - CSV Database
// @namespace    http://tampermonkey.net/
// @version      3
// @description  Tracks duplicate entries in a CSV database stored in browser localStorage
// @author       You
// @match        https://*.element451.io/*
// @grant        none
// ==/UserScript==

// =========================================================
// CSV DATABASE MODULE
// Stores: Firstname, Lastname, Dept., Row Contents, Unique ID
// Storage key: 'elm_csv_database' in localStorage
//
// Department detection: The main UI Perfection script sets
// document.body.dataset.csvDept ('Grad', 'IA', 'UnderGrad',
// 'Forbidden', 'Ignored'). This script polls for that attribute
// and auto-records when it appears.
//
// Row contents are read from the highlighted row
// (.blocked-row / .blocked-row-critical) set by the main script.
//
// UI elements: This script owns all database-related UI:
//   - #elm-db-size-badge in the header (injected into #elm-controls-wrapper)
//   - Database section in the settings pane (download, upload, clear)
//
// List page annotation: Intercepts the API response that loads
// the duplicates list to get unique IDs for each row, then
// matches those IDs against the database to show dept badges.
// =========================================================
(function () {
    'use strict';

    const STORAGE_KEY = 'elm_csv_database';

    // =========================================================
    // CSS (database-owned styles)
    // =========================================================
    const dbCss = `
        /* --- Database Size Badge --- */
        #elm-db-size-badge {
            font-size: 13px;
            font-weight: 600;
            color: white;
            background: rgba(255,255,255,0.15);
            padding: 4px 10px;
            border-radius: 12px;
            white-space: nowrap;
            cursor: default;
        }
        /* --- Settings Action Buttons (database section) --- */
        .settings-action-btn {
            background: #f5f5f5;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 8px 14px;
            font-size: 13px;
            font-weight: 500;
            color: #333;
            cursor: pointer;
            transition: all 0.15s;
            display: flex;
            align-items: center;
            gap: 6px;
            width: 100%;
            margin-bottom: 6px;
        }
        .settings-action-btn:last-child { margin-bottom: 0; }
        .settings-action-btn:hover {
            background: #e8e8e8;
            border-color: #ccc;
        }
        .settings-action-btn.danger {
            color: #d32f2f;
            border-color: #ffcdd2;
            background: #fff5f5;
        }
        .settings-action-btn.danger:hover {
            background: #ffebee;
            border-color: #ef9a9a;
        }
        /* Hidden file input for upload */
        #elm-db-upload-input { display: none; }
    `;
    // Inject CSS
    (function () {
        const style = document.createElement('style');
        style.textContent = dbCss;
        document.head.appendChild(style);
    })();

    // --- READ BLOCKED ROW FROM DOM ---
    // The main script highlights the triggering row with .blocked-row
    // or .blocked-row-critical classes (deep red). This reads that row's text.
    function getBlockedRowText(dept) {
        const blockedRow = document.querySelector('.blocked-row, .blocked-row-critical');
        if (blockedRow) {
            return blockedRow.textContent.trim().replace(/\s+/g, ' ');
        }
        // No blocked row in DOM — provide context based on dept
        if (dept === 'Ignored') return 'Student has Ignored chip';
        return 'No IA or Grad rows detected';
    }

    // --- NAME EXTRACTION ---
    // Extracts first and last name from the left (master) side of the merge view.
    // Falls back to right side if left is empty.
    function extractNames() {
        const allRows = Array.from(document.querySelectorAll('elm-merge-row'));
        let firstName = '', lastName = '';

        allRows.forEach(row => {
            const text = row.textContent;
            const values = row.querySelectorAll('elm-merge-value');
            if (text.includes('First Name') && values.length >= 2) {
                firstName = values[0].textContent.trim() || values[1].textContent.trim();
            }
            if (text.includes('Last Name') && values.length >= 2) {
                lastName = values[0].textContent.trim() || values[1].textContent.trim();
            }
        });

        return { firstName, lastName };
    }

    // --- UNIQUE ID EXTRACTION ---
    function extractUniqueId() {
        const match = window.location.href.match(/\/duplicates\/([a-f0-9]{24})/i);
        return match ? match[1].toLowerCase() : null;
    }

    // --- DATABASE OPERATIONS ---
    function getDatabase() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('CSV Database: Error reading database', e);
            return [];
        }
    }

    function saveDatabase(db) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
        } catch (e) {
            console.error('CSV Database: Error saving database', e);
        }
    }

    // --- RECORD ENTRY ---
    // Called by the polling loop when data-csv-dept is set on body.
    // Reads the blocked row from DOM for row contents.
    // Deduplicates by unique ID so repeated calls are harmless.
    function recordEntry(dept) {
        if (!dept) return; // Main script must provide dept

        const uniqueId = extractUniqueId();
        if (!uniqueId) return; // Not on a duplicates page

        // Check if names are available (page content loaded)
        const { firstName, lastName } = extractNames();
        if (!firstName && !lastName) {
            console.log('CSV Database: Page content not ready yet, skipping');
            return;
        }

        const db = getDatabase();

        // Read the deep red highlighted row from DOM
        const rowContents = getBlockedRowText(dept);

        const newEntry = {
            firstName,
            lastName,
            dept,
            rowContents,
            uniqueId
        };

        // Check if this unique ID already exists in the database
        const existingIdx = db.findIndex(entry => entry.uniqueId === uniqueId);
        if (existingIdx !== -1) {
            // Update the existing entry with current data instead of adding a duplicate
            const old = db[existingIdx];
            if (old.dept === dept && old.firstName === firstName && old.lastName === lastName && old.rowContents === rowContents) {
                return; // Nothing changed, skip the write
            }
            db[existingIdx] = newEntry;
            saveDatabase(db);
            console.log('CSV Database: Updated existing entry', newEntry);
            return;
        }

        db.push(newEntry);
        saveDatabase(db);
        console.log('CSV Database: Recorded new entry', newEntry);
    }

    // =========================================================
    // LIST PAGE: API INTERCEPTION & ANNOTATION
    // =========================================================

    // Captured duplicate entries from the API response (includes unique IDs)
    let apiDuplicatesList = null;

    // --- INTERCEPT XHR TO CAPTURE DUPLICATES LIST DATA ---
    // When the list page loads, Element451 fetches the duplicate entries via API.
    // We intercept that response to get the unique ID for each row.
    (function interceptXHR() {
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            this._csvDbUrl = url;
            return origOpen.apply(this, arguments);
        };

        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function () {
            this.addEventListener('load', function () {
                try {
                    if (!this._csvDbUrl || typeof this.responseText !== 'string') return;
                    // Match duplicates list endpoint (not individual detail pages)
                    if (!this._csvDbUrl.includes('duplicate')) return;
                    if (this._csvDbUrl.match(/\/[a-f0-9]{24}($|\?|\/)/i)) return;

                    const data = JSON.parse(this.responseText);
                    // Try common response shapes for the array of entries
                    const entries = data.data || data.items || data.results ||
                                    (Array.isArray(data) ? data : null);
                    if (!entries || !Array.isArray(entries) || entries.length === 0) return;

                    // Verify entries have an ID field
                    const sample = entries[0];
                    const idField = sample._id ? '_id' : sample.id ? 'id' : null;
                    if (!idField) {
                        console.log('CSV Database: API entries found but no _id/id field. Keys:', Object.keys(sample));
                        return;
                    }

                    apiDuplicatesList = entries.map(e => ({
                        uniqueId: (e[idField] || '').toLowerCase(),
                        name: e.name || e.full_name || '',
                        duplicateName: e.duplicate_name || ''
                    }));
                    console.log('CSV Database: Captured', apiDuplicatesList.length, 'entries from XHR');
                    // Re-annotate now that we have fresh API data
                    annotateDuplicatesList();
                } catch (e) {
                    // Not the response we're looking for, ignore
                }
            });
            return origSend.apply(this, arguments);
        };
    })();

    // --- INTERCEPT FETCH TO CAPTURE DUPLICATES LIST DATA ---
    // Angular may use fetch instead of XHR. This mirrors the XHR
    // interceptor above so we capture the API data either way.
    (function interceptFetch() {
        const origFetch = window.fetch;
        window.fetch = function (input, init) {
            const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
            return origFetch.apply(this, arguments).then(response => {
                try {
                    if (!url || !url.includes('duplicate')) return response;
                    if (url.match(/\/[a-f0-9]{24}($|\?|\/)/i)) return response;

                    // Clone so the original response body is still consumable
                    response.clone().json().then(data => {
                        const entries = data.data || data.items || data.results ||
                                        (Array.isArray(data) ? data : null);
                        if (!entries || !Array.isArray(entries) || entries.length === 0) return;

                        const sample = entries[0];
                        const idField = sample._id ? '_id' : sample.id ? 'id' : null;
                        if (!idField) return;

                        apiDuplicatesList = entries.map(e => ({
                            uniqueId: (e[idField] || '').toLowerCase(),
                            name: e.name || e.full_name || '',
                            duplicateName: e.duplicate_name || ''
                        }));
                        console.log('CSV Database: Captured', apiDuplicatesList.length, 'entries from fetch');
                        annotateDuplicatesList();
                    }).catch(() => {}); // Not JSON or not the response we want
                } catch (e) {
                    // Ignore errors in interception
                }
                return response;
            });
        };
    })();

    // --- LIST PAGE: DEPT BADGE COLORS ---
    const DEPT_LABELS = {
        Grad:      'Graduate',
        IA:        'International',
        UnderGrad: 'UnderGrad',
        Forbidden: 'Forbidden',
        Ignored:   'Ignored'
    };

    const DEPT_COLORS = {
        Grad:       { bg: '#e3f2fd', fg: '#1565c0' },
        IA:         { bg: '#fff9c4', fg: '#f57f17' },
        UnderGrad:  { bg: '#f3e5f5', fg: '#6a1b9a' },
        Forbidden:  { bg: '#fce4ec', fg: '#c2185b' },
        Ignored:    { bg: '#f5f5f5', fg: '#616161' }
    };

    // --- LIST PAGE: REWRITE elm-chip IN EACH ROW TO SHOW DEPT ---
    // Uses the intercepted API data to match each row to its unique ID,
    // then looks up that ID in the CSV database and rewrites the existing
    // elm-chip (the orange "Unresolved" chip) to show department + color.
    //
    // Angular re-renders can overwrite our chip modifications at any time.
    // Instead of relying on a flag, we check the chip's actual label text
    // AND color each time and re-apply if Angular has reverted anything.
    function annotateDuplicatesList() {
        // Only run on list page — skip if on detail page (has elm-merge-row)
        if (document.querySelector('elm-merge-row')) return;
        // Only run if we have API data with unique IDs
        if (!apiDuplicatesList) return;

        const rows = document.querySelectorAll('elm-row');
        if (rows.length === 0) return;

        const db = getDatabase();

        // Build a quick lookup map from uniqueId -> dbEntry
        const dbMap = {};
        db.forEach(entry => { dbMap[entry.uniqueId] = entry; });

        rows.forEach((row, rowIndex) => {
            // Match row to its unique ID via the intercepted API data.
            // The API returns entries in the same order as the rows on screen.
            if (!apiDuplicatesList || !apiDuplicatesList[rowIndex]) return;
            const uniqueId = apiDuplicatesList[rowIndex].uniqueId;
            if (!uniqueId) return;

            const dbEntry = dbMap[uniqueId];
            if (!dbEntry) return;

            // Find the elm-chip in this row and rewrite it
            const chip = row.querySelector('elm-chip');
            if (!chip) return;

            const desiredLabel = DEPT_LABELS[dbEntry.dept] || dbEntry.dept;
            const colors = DEPT_COLORS[dbEntry.dept] || { bg: '#f5f5f5', fg: '#333' };

            // Check if chip already has our desired label AND color — skip only
            // if both match. This handles partial Angular re-renders that may
            // reset the color but leave the label (or vice versa).
            const label = chip.querySelector('.elm-chip-label');
            const colorDiv = chip.querySelector('.bg-color');
            const labelOk = label && label.textContent.trim() === desiredLabel;
            const colorOk = colorDiv && colorDiv.style.backgroundColor &&
                            colorDiv.getAttribute('data-csv-dept') === dbEntry.dept;
            if (labelOk && colorOk) return;

            // Apply or re-apply annotation
            if (label) {
                label.textContent = ` ${desiredLabel} `;
                label.style.color = colors.fg;
            }

            // Rewrite the chip background color
            if (colorDiv) {
                colorDiv.style.cssText = `background-color: ${colors.bg} !important`;
                colorDiv.setAttribute('data-csv-dept', dbEntry.dept);
            }

            // Also set chip-level styles as a fallback in case .bg-color
            // is missing or gets replaced by Angular
            chip.style.cssText = `background-color: ${colors.bg} !important; color: ${colors.fg} !important`;
        });
    }

    // --- LIST PAGE: MUTATION OBSERVER ---
    // Angular re-renders can overwrite our chip modifications at any time.
    // A MutationObserver reacts immediately to DOM changes so we can
    // re-annotate before the user sees the revert.
    let listAnnotationTimer = null;
    const listObserver = new MutationObserver(() => {
        // Debounce: Angular may fire many mutations in a single render cycle
        if (listAnnotationTimer) clearTimeout(listAnnotationTimer);
        listAnnotationTimer = setTimeout(annotateDuplicatesList, 50);
    });
    // Start observing once we're on a page with elm-row elements
    function startListObserver() {
        // Only observe on list pages, not detail pages
        if (document.querySelector('elm-merge-row')) return;
        const container = document.querySelector('.elm-table-body') ||
                          document.querySelector('elm-duplicates') ||
                          document.body;
        listObserver.observe(container, { childList: true, subtree: true, characterData: true });
    }

    // Run annotation periodically on the list page (fallback for observer)
    setInterval(() => {
        annotateDuplicatesList();
        startListObserver();
    }, 1000);

    // =========================================================
    // CSV EXPORT
    // =========================================================
    function toCSV() {
        const db = getDatabase();
        if (db.length === 0) return '';
        const headers = ['Firstname', 'Lastname', 'Dept.', 'Row Contents', 'Unique ID'];
        const rows = db.map(e => [
            e.firstName, e.lastName, e.dept, e.rowContents, e.uniqueId
        ].map(v => `"${(v || '').replace(/"/g, '""')}"`).join(','));
        return [headers.join(','), ...rows].join('\n');
    }

    // Parse a single CSV line respecting quoted fields
    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (i + 1 < line.length && line[i + 1] === '"') {
                        current += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    current += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',') {
                    result.push(current);
                    current = '';
                } else {
                    current += ch;
                }
            }
        }
        result.push(current);
        return result;
    }

    // =========================================================
    // DATABASE UI
    // Injects badge into header (#elm-controls-wrapper) and
    // database section into the settings pane (#elm-settings-pane).
    // =========================================================
    function updateDbSizeBadge() {
        const badge = document.getElementById('elm-db-size-badge');
        if (!badge) return;
        const count = getDatabase().length;
        badge.textContent = `\u2B07 ${count}`;
        badge.title = `Database: ${count} entries recorded`;
    }

    function injectDbBadge() {
        if (document.getElementById('elm-db-size-badge')) return;
        const controlsWrapper = document.getElementById('elm-controls-wrapper');
        if (!controlsWrapper) return;

        const badge = document.createElement('span');
        badge.id = 'elm-db-size-badge';
        badge.title = 'Database entries recorded';
        badge.textContent = '\u2B07 0';

        // Insert after the settings button (first child)
        const settingsBtn = document.getElementById('elm-settings-btn');
        if (settingsBtn && settingsBtn.nextSibling) {
            controlsWrapper.insertBefore(badge, settingsBtn.nextSibling);
        } else {
            controlsWrapper.appendChild(badge);
        }
        updateDbSizeBadge();
    }

    function injectDbSettingsSection() {
        if (document.getElementById('elm-settings-db-section')) return;
        const settingsBody = document.querySelector('#elm-settings-pane .settings-body');
        if (!settingsBody) return;

        const section = document.createElement('div');
        section.id = 'elm-settings-db-section';
        section.className = 'settings-section';
        section.innerHTML = `
            <div class="settings-section-title">Database</div>
            <button id="elm-settings-download-btn" class="settings-action-btn">\u2B07 Download Database</button>
            <button id="elm-settings-upload-btn" class="settings-action-btn">\u2B06 Upload & Replace Database</button>
            <input type="file" id="elm-db-upload-input" accept=".csv">
            <button id="elm-settings-clear-btn" class="settings-action-btn danger">\u2716 Clear Database</button>
        `;
        settingsBody.appendChild(section);

        // --- Download Database ---
        document.getElementById('elm-settings-download-btn').onclick = () => {
            const csvContent = toCSV();
            if (!csvContent) {
                alert('CSV Database is empty \u2014 no entries have been recorded yet.');
                return;
            }
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `elm_csv_database_${new Date().toISOString().slice(0,10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };

        // --- Upload & Replace Database ---
        const uploadInput = document.getElementById('elm-db-upload-input');
        document.getElementById('elm-settings-upload-btn').onclick = () => {
            uploadInput.click();
        };
        uploadInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (!file.name.endsWith('.csv')) {
                alert('Please select a .csv file.');
                uploadInput.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const text = ev.target.result;
                    const lines = text.trim().split('\n');
                    if (lines.length < 2) {
                        alert('CSV file is empty or has no data rows.');
                        uploadInput.value = '';
                        return;
                    }
                    const entries = [];
                    for (let i = 1; i < lines.length; i++) {
                        const cols = parseCSVLine(lines[i]);
                        if (cols.length >= 5) {
                            entries.push({
                                firstName: cols[0],
                                lastName: cols[1],
                                dept: cols[2],
                                rowContents: cols[3],
                                uniqueId: cols[4]
                            });
                        }
                    }
                    if (entries.length === 0) {
                        alert('No valid entries found in CSV file.');
                        uploadInput.value = '';
                        return;
                    }
                    if (!confirm(`Replace current database with ${entries.length} entries from "${file.name}"?`)) {
                        uploadInput.value = '';
                        return;
                    }
                    saveDatabase(entries);
                    updateDbSizeBadge();
                    alert(`Database replaced with ${entries.length} entries.`);
                } catch (err) {
                    alert('Error parsing CSV file: ' + err.message);
                }
                uploadInput.value = '';
            };
            reader.readAsText(file);
        };

        // --- Clear Database ---
        document.getElementById('elm-settings-clear-btn').onclick = () => {
            const db = getDatabase();
            if (db.length === 0) {
                alert('Database is already empty.');
                return;
            }
            if (confirm(`Are you sure you want to delete all ${db.length} entries from the database? This cannot be undone.`)) {
                saveDatabase([]);
                updateDbSizeBadge();
                alert('Database cleared.');
            }
        };
    }

    // Poll for UI injection (main script elements may not exist yet)
    setInterval(() => {
        injectDbBadge();
        injectDbSettingsSection();
    }, 1000);

    // =========================================================
    // AUTO-RECORD: POLL FOR data-csv-dept ON BODY
    // Main script sets document.body.dataset.csvDept in
    // checkMergeStatus(). We poll for it and auto-record.
    // recordEntry() deduplicates by uniqueId, so repeated
    // calls for the same entry are harmless no-ops.
    // =========================================================
    setInterval(() => {
        const dept = document.body.dataset.csvDept;
        if (dept) {
            recordEntry(dept);
        }
        updateDbSizeBadge();
    }, 1000);

    console.log('CSV Database: Module loaded (polls body[data-csv-dept])');
})();
