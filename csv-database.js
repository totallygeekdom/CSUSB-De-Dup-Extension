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
// Download button: Owned entirely by this script. Injects into
// #elm-counter-wrapper created by the main script's merge counter.
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
                    console.log('CSV Database: Captured', apiDuplicatesList.length, 'entries from API');
                    // Re-annotate now that we have fresh API data
                    document.querySelectorAll('elm-row[data-csv-dept-done]').forEach(r => delete r.dataset.csvDeptDone);
                    annotateDuplicatesList();
                } catch (e) {
                    // Not the response we're looking for, ignore
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
    function annotateDuplicatesList() {
        // Only run on list page — skip if on detail page (has elm-merge-row)
        if (document.querySelector('elm-merge-row')) return;
        // Only run if we have API data with unique IDs
        if (!apiDuplicatesList) return;

        const rows = document.querySelectorAll('elm-row');
        if (rows.length === 0) return;

        const db = getDatabase();

        rows.forEach(row => {
            // Skip if already annotated
            if (row.dataset.csvDeptDone) return;

            // Match by unique ID from intercepted API data
            const indexCell = row.querySelector('.elm-column-index');
            if (!indexCell) return;

            const indexNum = parseInt(indexCell.textContent.trim().replace('.', ''));
            if (isNaN(indexNum) || !apiDuplicatesList[indexNum - 1]) return;

            const apiEntry = apiDuplicatesList[indexNum - 1];
            if (!apiEntry.uniqueId) return;

            const dbEntry = db.find(e => e.uniqueId === apiEntry.uniqueId);
            if (!dbEntry) return;

            // Find the elm-chip in this row and rewrite it
            const chip = row.querySelector('elm-chip');
            if (!chip) return;

            const desiredLabel = DEPT_LABELS[dbEntry.dept] || dbEntry.dept;
            const colors = DEPT_COLORS[dbEntry.dept] || { bg: '#f5f5f5', fg: '#333' };

            // Rewrite the chip label text
            const label = chip.querySelector('.elm-chip-label');
            if (label) {
                label.textContent = ` ${desiredLabel} `;
            }

            // Rewrite the chip background color
            const colorDiv = chip.querySelector('.bg-color');
            if (colorDiv) {
                colorDiv.style.backgroundColor = colors.fg;
            }

            row.dataset.csvDeptDone = '1';
        });
    }

    // Run annotation periodically on the list page
    setInterval(annotateDuplicatesList, 1000);

    // =========================================================
    // CSV EXPORT
    // =========================================================
    function toCSV() {
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

    // =========================================================
    // DOWNLOAD BUTTON
    // Injected into #elm-counter-wrapper (created by main script).
    // =========================================================
    function updateDownloadButton() {
        const btn = document.getElementById('elm-download-db-btn');
        if (!btn) return;
        const count = getDatabase().length;
        btn.innerHTML = `\u2B07 ${count}`;
        btn.title = `Download CSV Database (${count} entries recorded)`;
    }

    function injectDownloadButton() {
        if (document.getElementById('elm-download-db-btn')) return;
        const wrapper = document.getElementById('elm-counter-wrapper');
        if (!wrapper) return;

        const btn = document.createElement('button');
        btn.id = 'elm-download-db-btn';
        const count = getDatabase().length;
        btn.innerHTML = `\u2B07 ${count}`;
        btn.title = `Download CSV Database (${count} entries recorded)`;
        btn.onclick = (e) => {
            e.stopPropagation();
            const csvContent = toCSV();
            if (!csvContent) {
                alert('CSV Database is empty \u2014 no entries have been recorded yet.\n\nCheck the browser console (F12) for "CSV Database:" messages to diagnose.');
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
        wrapper.prepend(btn);
    }

    // Poll for download button injection (wrapper may not exist yet)
    setInterval(injectDownloadButton, 1000);

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
            updateDownloadButton();
        }
    }, 1000);

    console.log('CSV Database: Module loaded (polls body[data-csv-dept])');
})();
