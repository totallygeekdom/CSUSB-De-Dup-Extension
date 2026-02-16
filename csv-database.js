// ==UserScript==
// @name         Element451 - CSV Database
// @namespace    http://tampermonkey.net/
// @version      2
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

    // --- LIST PAGE: LOOKUP BY NAME ---
    // Searches the database for an entry matching the full name shown on the list page.
    function lookupByName(fullName) {
        const db = getDatabase();
        const normalized = fullName.trim().toLowerCase();
        return db.find(entry => {
            const dbName = `${entry.firstName} ${entry.lastName}`.trim().toLowerCase();
            return dbName === normalized;
        });
    }

    // --- LIST PAGE: DEPT BADGE COLORS ---
    const DEPT_COLORS = {
        Grad:       { bg: '#e3f2fd', fg: '#1565c0' },
        IA:         { bg: '#fff3e0', fg: '#e65100' },
        UnderGrad:  { bg: '#e8f5e9', fg: '#2e7d32' },
        Forbidden:  { bg: '#ffebee', fg: '#c62828' },
        Ignored:    { bg: '#f5f5f5', fg: '#616161' }
    };

    // --- LIST PAGE: CREATE DEPT BADGE ---
    function createDeptBadge(dept) {
        const badge = document.createElement('span');
        badge.className = 'csv-dept-badge';
        badge.textContent = dept;
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

    // --- LIST PAGE: ANNOTATE ROWS WITH DEPT BADGES ---
    // Scans elm-row elements on the duplicates list page and adds dept badges
    // to names that have been previously recorded in the database.
    function annotateDuplicatesList() {
        // Only run on list page — skip if on detail page (has elm-merge-row)
        if (document.querySelector('elm-merge-row')) return;

        const rows = document.querySelectorAll('elm-row');
        if (rows.length === 0) return;

        rows.forEach(row => {
            const nameCell = row.querySelector('.elm-column-name');
            if (!nameCell) return;

            // Skip if already annotated
            if (nameCell.querySelector('.csv-dept-badge')) return;

            const fullName = nameCell.textContent.trim();
            if (!fullName) return;

            const entry = lookupByName(fullName);
            if (entry) {
                nameCell.appendChild(createDeptBadge(entry.dept));
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
