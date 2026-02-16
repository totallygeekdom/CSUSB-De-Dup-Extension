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
                    clearBadges();
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

    // --- LIST PAGE: CREATE DEPT BADGE ---
    function createDeptBadge(dept) {
        const badge = document.createElement('span');
        badge.className = 'csv-dept-badge';
        badge.textContent = DEPT_LABELS[dept] || dept;
        const colors = DEPT_COLORS[dept] || { bg: '#f5f5f5', fg: '#333' };
        badge.style.cssText = `
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 600;
            margin-left: 8px;
            vertical-align: middle;
            background-color: ${colors.bg};
            color: ${colors.fg};
        `;
        return badge;
    }

    // --- LIST PAGE: CLEAR EXISTING BADGES ---
    // Called when new API data arrives so badges can be re-applied with fresh data.
    function clearBadges() {
        document.querySelectorAll('.csv-dept-badge').forEach(b => b.remove());
    }

    // --- LIST PAGE: ANNOTATE ROWS WITH DEPT BADGES ---
    // Uses the intercepted API data to match each row to its unique ID,
    // then looks up that ID in the CSV database for the dept.
    function annotateDuplicatesList() {
        // Only run on list page — skip if on detail page (has elm-merge-row)
        if (document.querySelector('elm-merge-row')) return;
        // Only run if we have API data with unique IDs
        if (!apiDuplicatesList) return;

        const rows = document.querySelectorAll('elm-row');
        if (rows.length === 0) return;

        const db = getDatabase();

        rows.forEach(row => {
            const nameCell = row.querySelector('.elm-column-name');
            if (!nameCell) return;

            // Skip if already annotated
            if (nameCell.querySelector('.csv-dept-badge')) return;

            // Match by unique ID from intercepted API data
            // Use the row's index cell (e.g., "1.", "26.") to find the right API entry
            const indexCell = row.querySelector('.elm-column-index');
            if (!indexCell) return;

            const indexNum = parseInt(indexCell.textContent.trim().replace('.', ''));
            if (isNaN(indexNum) || !apiDuplicatesList[indexNum - 1]) return;

            const apiEntry = apiDuplicatesList[indexNum - 1];
            if (!apiEntry.uniqueId) return;

            const dbEntry = db.find(e => e.uniqueId === apiEntry.uniqueId);
            if (dbEntry) {
                nameCell.appendChild(createDeptBadge(dbEntry.dept));
            }
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
