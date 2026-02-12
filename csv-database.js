// ==UserScript==
// @name         Element451 - CSV Database
// @namespace    http://tampermonkey.net/
// @version      1
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
// Integration: This script exposes window.elmCsvDatabase
// The main UI Perfection script calls recordEntry() during
// its page load cycle to capture each duplicate entry.
// =========================================================
(function () {
    'use strict';

    const STORAGE_KEY = 'elm_csv_database';

    // --- DEPARTMENT DETECTION ---
    // Detects the ACTUAL department of an entry, independent of ALLOWED_DEPARTMENT.
    // Priority: Forbidden > Ignored > Grad > IA > UnderGrad
    function detectDepartment() {
        const allRows = Array.from(document.querySelectorAll('elm-merge-row'));

        // --- Check Forbidden (test names / forbidden name combos) ---
        let firstNameLeft = '', firstNameRight = '';
        let lastNameLeft = '', lastNameRight = '';
        let firstNameRow = null, lastNameRow = null;

        allRows.forEach(row => {
            const text = row.textContent;
            const values = row.querySelectorAll('elm-merge-value');
            if (text.includes('First Name') && values.length >= 2) {
                firstNameLeft = values[0].textContent.trim();
                firstNameRight = values[1].textContent.trim();
                firstNameRow = row;
            }
            if (text.includes('Last Name') && values.length >= 2) {
                lastNameLeft = values[0].textContent.trim();
                lastNameRight = values[1].textContent.trim();
                lastNameRow = row;
            }
        });

        // Check for "test" in name fields
        if (firstNameLeft.toLowerCase().includes('test')) {
            return { dept: 'Forbidden', rowText: firstNameRow ? firstNameRow.textContent.trim().replace(/\s+/g, ' ') : 'test in first name' };
        }
        if (lastNameLeft.toLowerCase().includes('test')) {
            return { dept: 'Forbidden', rowText: lastNameRow ? lastNameRow.textContent.trim().replace(/\s+/g, ' ') : 'test in last name' };
        }
        if (firstNameRight.toLowerCase().includes('test')) {
            return { dept: 'Forbidden', rowText: firstNameRow ? firstNameRow.textContent.trim().replace(/\s+/g, ' ') : 'test in first name' };
        }
        if (lastNameRight.toLowerCase().includes('test')) {
            return { dept: 'Forbidden', rowText: lastNameRow ? lastNameRow.textContent.trim().replace(/\s+/g, ' ') : 'test in last name' };
        }

        // Check for forbidden name combinations
        const forbiddenNames = ['angela armstrong', 'gillespie armstrong', 'mariah armstrong'];
        const fullNameLeft = `${firstNameLeft} ${lastNameLeft}`.toLowerCase().trim();
        const fullNameRight = `${firstNameRight} ${lastNameRight}`.toLowerCase().trim();
        if (forbiddenNames.includes(fullNameLeft)) {
            return { dept: 'Forbidden', rowText: firstNameRow ? firstNameRow.textContent.trim().replace(/\s+/g, ' ') : `forbidden name: ${fullNameLeft}` };
        }
        if (forbiddenNames.includes(fullNameRight)) {
            return { dept: 'Forbidden', rowText: firstNameRow ? firstNameRow.textContent.trim().replace(/\s+/g, ' ') : `forbidden name: ${fullNameRight}` };
        }

        // --- Check Ignored (elm-chip with "ignored" label) ---
        const chips = document.querySelectorAll('elm-chip');
        for (const chip of chips) {
            const label = chip.querySelector('.elm-chip-label');
            if (label && label.textContent.trim().toLowerCase() === 'ignored') {
                return { dept: 'Ignored', rowText: 'Student has Ignored chip' };
            }
        }

        // --- Check Grad and IA patterns in relevant rows ---
        const isGradText = (t) => t.includes('GRAD_') || /grad student/i.test(t);
        const isIAText = (t) => t.includes('IA_') || t.includes('_IA_') || t.includes('_IA ');

        for (const row of allRows) {
            const text = row.textContent;
            const isRelevantRow = text.includes('Workflows') ||
                text.includes('Application') ||
                text.includes('Program') ||
                text.includes('type:') ||
                text.includes('status:') ||
                text.includes('Outreach_');
            if (!isRelevantRow) continue;

            if (isGradText(text)) {
                return { dept: 'Grad', rowText: text.trim().replace(/\s+/g, ' ') };
            }
            if (isIAText(text)) {
                return { dept: 'IA', rowText: text.trim().replace(/\s+/g, ' ') };
            }
        }

        // --- Default: UnderGrad ---
        return { dept: 'UnderGrad', rowText: 'No IA or Grad rows detected' };
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
    // Called by the main script during page load cycle.
    // Deduplicates by unique ID so revisiting an entry won't create duplicates.
    function recordEntry() {
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

        const { dept, rowText } = detectDepartment();

        const entry = {
            firstName,
            lastName,
            dept,
            rowContents: rowText,
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
