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

    // --- PUBLIC API ---
    // Exposed on window for main script integration
    window.elmCsvDatabase = {
        recordEntry,
        getDatabase,
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
