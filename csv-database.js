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
// Database size badge: Updates #elm-db-size-badge in the header
// (created by the main script). Download/upload/clear are in the
// settings pane (also in the main script).
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
    // DATABASE SIZE BADGE
    // Updates #elm-db-size-badge (created by main script's
    // settings pane). Download functionality is now in the
    // settings pane in the main script.
    // =========================================================
    function updateDbSizeBadge() {
        const badge = document.getElementById('elm-db-size-badge');
        if (!badge) return;
        const count = getDatabase().length;
        badge.textContent = `\u2B07 ${count}`;
        badge.title = `Database: ${count} entries recorded`;
    }

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
