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
// Department detection is handled by the main UI Perfection
// script, which passes the dept string to recordEntry().
// Row contents are read from the deep red highlighted row
// (.blocked-row / .blocked-row-critical) set by the main script.
//
// List page annotation: Intercepts the API response that loads
// the duplicates list to get unique IDs for each row, then
// matches those IDs against the database to show dept badges.
// =========================================================
(function () {
    'use strict';

    const STORAGE_KEY = 'elm_csv_database';

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
    // Called by the main script with the detected department.
    // Reads the blocked row from DOM for row contents.
    // Deduplicates by unique ID so revisiting an entry won't create duplicates.
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

        // Deduplicate by unique ID
        if (db.some(entry => entry.uniqueId === uniqueId)) {
            return; // Already recorded
        }

        // Read the deep red highlighted row from DOM
        const rowContents = getBlockedRowText(dept);

        const entry = {
            firstName,
            lastName,
            dept,
            rowContents,
            uniqueId
        };

        db.push(entry);
        saveDatabase(db);
        console.log('CSV Database: Recorded entry', entry);
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

                    // Log ALL XHR URLs so we can see what endpoints Element451 hits
                    console.log('CSV Database [XHR]:', this._csvDbUrl);

                    // Match duplicates list endpoint (not individual detail pages)
                    if (!this._csvDbUrl.includes('duplicate')) return;
                    if (this._csvDbUrl.match(/\/[a-f0-9]{24}($|\?|\/)/i)) {
                        console.log('CSV Database [XHR]: Skipped — looks like a detail endpoint');
                        return;
                    }

                    console.log('CSV Database [XHR]: Matched duplicates list endpoint');
                    const data = JSON.parse(this.responseText);
                    console.log('CSV Database [XHR]: Response top-level keys:', Object.keys(data));

                    // Try common response shapes for the array of entries
                    const entries = data.data || data.items || data.results ||
                                    (Array.isArray(data) ? data : null);
                    if (!entries || !Array.isArray(entries) || entries.length === 0) {
                        console.log('CSV Database [XHR]: No entries array found in response');
                        return;
                    }

                    // Verify entries have an ID field
                    const sample = entries[0];
                    console.log('CSV Database [XHR]: Sample entry keys:', Object.keys(sample));
                    console.log('CSV Database [XHR]: Sample entry:', JSON.stringify(sample).slice(0, 500));
                    const idField = sample._id ? '_id' : sample.id ? 'id' : null;
                    if (!idField) {
                        console.log('CSV Database [XHR]: No _id or id field found!');
                        return;
                    }

                    apiDuplicatesList = entries.map(e => ({
                        uniqueId: (e[idField] || '').toLowerCase(),
                        name: e.name || e.full_name || '',
                        duplicateName: e.duplicate_name || ''
                    }));
                    console.log('CSV Database [XHR]: Captured', apiDuplicatesList.length, 'entries. First 3:', apiDuplicatesList.slice(0, 3));
                    // Re-annotate now that we have fresh API data
                    document.querySelectorAll('elm-row[data-csv-dept-done]').forEach(r => delete r.dataset.csvDeptDone);
                    annotateDuplicatesList();
                } catch (e) {
                    console.log('CSV Database [XHR]: Parse error for', this._csvDbUrl, e.message);
                }
            });
            return origSend.apply(this, arguments);
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
        IA:         { bg: '#fce4ec', fg: '#c2185b' },
        UnderGrad:  { bg: '#e8f5e9', fg: '#2e7d32' },
        Forbidden:  { bg: '#ffebee', fg: '#c62828' },
        Ignored:    { bg: '#f5f5f5', fg: '#616161' }
    };

    // --- LIST PAGE: REWRITE elm-chip IN EACH ROW TO SHOW DEPT ---
    // Uses the intercepted API data to match each row to its unique ID,
    // then looks up that ID in the CSV database and rewrites the existing
    // elm-chip (the orange "Unresolved" chip) to show department + color.
    let _annotateLogOnce = false;
    function annotateDuplicatesList() {
        // Only run on list page — skip if on detail page (has elm-merge-row)
        if (document.querySelector('elm-merge-row')) return;
        // Only run if we have API data with unique IDs
        if (!apiDuplicatesList) {
            if (!_annotateLogOnce) { console.log('CSV Database [Annotate]: Waiting for API data...'); _annotateLogOnce = true; }
            return;
        }

        const rows = document.querySelectorAll('elm-row');
        if (rows.length === 0) return;

        const db = getDatabase();

        rows.forEach((row, rowIdx) => {
            // Skip if already annotated
            if (row.dataset.csvDeptDone) return;

            // Match by unique ID from intercepted API data
            const indexCell = row.querySelector('.elm-column-index');
            if (!indexCell) {
                console.log(`CSV Database [Annotate]: Row ${rowIdx} — no .elm-column-index found`);
                return;
            }

            const indexNum = parseInt(indexCell.textContent.trim().replace('.', ''));
            if (isNaN(indexNum) || !apiDuplicatesList[indexNum - 1]) {
                console.log(`CSV Database [Annotate]: Row ${rowIdx} — index "${indexCell.textContent.trim()}" → parsed ${indexNum}, API entry: ${!!apiDuplicatesList[indexNum - 1]}`);
                return;
            }

            const apiEntry = apiDuplicatesList[indexNum - 1];
            if (!apiEntry.uniqueId) {
                console.log(`CSV Database [Annotate]: Row ${rowIdx} — API entry has no uniqueId`);
                return;
            }

            const dbEntry = db.find(e => e.uniqueId === apiEntry.uniqueId);
            if (!dbEntry) {
                console.log(`CSV Database [Annotate]: Row ${rowIdx} — ID ${apiEntry.uniqueId} not in DB (${db.length} entries)`);
                return;
            }

            // Find the elm-chip in this row and rewrite it
            const chip = row.querySelector('elm-chip');
            if (!chip) {
                console.log(`CSV Database [Annotate]: Row ${rowIdx} — no elm-chip found. Row HTML:`, row.innerHTML.slice(0, 300));
                return;
            }

            const desiredLabel = DEPT_LABELS[dbEntry.dept] || dbEntry.dept;
            const colors = DEPT_COLORS[dbEntry.dept] || { bg: '#f5f5f5', fg: '#333' };

            // Rewrite the chip label text
            const label = chip.querySelector('.elm-chip-label');
            if (label) {
                label.textContent = ` ${desiredLabel} `;
                console.log(`CSV Database [Annotate]: Row ${rowIdx} — chip label → "${desiredLabel}"`);
            } else {
                console.log(`CSV Database [Annotate]: Row ${rowIdx} — elm-chip found but no .elm-chip-label. Chip HTML:`, chip.innerHTML.slice(0, 300));
            }

            // Rewrite the chip background color
            const colorDiv = chip.querySelector('.bg-color');
            if (colorDiv) {
                colorDiv.style.backgroundColor = colors.fg;
            } else {
                console.log(`CSV Database [Annotate]: Row ${rowIdx} — elm-chip found but no .bg-color. Chip HTML:`, chip.innerHTML.slice(0, 300));
            }

            row.dataset.csvDeptDone = '1';
        });
    }

    // Run annotation periodically on the list page
    setInterval(annotateDuplicatesList, 1000);

    // --- PUBLIC API ---
    // Exposed on window for main script integration
    window.elmCsvDatabase = {
        recordEntry,
        getDatabase,
        annotateDuplicatesList,
        clearDatabase() {
            localStorage.removeItem(STORAGE_KEY);
            console.log('CSV Database: Cleared');
        },
        getEntryCount() {
            return getDatabase().length;
        },
        toCSV() {
            const db = getDatabase();
            if (db.length === 0) return '';
            const headers = ['Firstname', 'Lastname', 'Dept.', 'Row Contents', 'Unique ID'];
            const rows = db.map(e => [
                e.firstName,
                e.lastName,
                e.dept,
                e.rowContents,
                e.uniqueId
            ].map(v => `"${(v || '').replace(/"/g, '""')}"`).join(','));
            return [headers.join(','), ...rows].join('\n');
        }
    };

    console.log('CSV Database: Module loaded');
})();
