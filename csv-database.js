// ==UserScript==
// @name         Element451 - CSV Database
// @namespace    http://tampermonkey.net/
// @version      8
// @description  Tracks duplicate entries in a CSV database stored in browser localStorage
// @author       You
// @match        https://*.element451.io/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/totallygeekdom/csusb-de-dup-extension/main/csv-database.js
// @downloadURL  https://raw.githubusercontent.com/totallygeekdom/csusb-de-dup-extension/main/csv-database.js
// ==/UserScript==

// =========================================================
// CSV DATABASE MODULE
// Stores: Firstname, Lastname, Dept., Row Contents, Unique ID
// Storage key: 'elm_csv_database' in localStorage
//
// Department detection: The main UI Perfection script sets
// document.body.dataset.csvDept ('Grad/IA', 'UnderGrad',
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
    // FLAGS
    // =========================================================
    // Set to false to disable the small toast that shows API fetch status
    const SHOW_API_STATUS_TOAST = true;

    // =========================================================
    // CSS (database-owned styles)
    // =========================================================
    const dbCss = `
        /* --- Chip annotation via CSS-only approach ---
         * All visual changes (text, colors, backgrounds) are driven purely
         * by the data-csv-dept attribute on elm-row elements.  JavaScript
         * only sets/removes that single attribute — it never touches
         * textContent, style.cssText, or other Angular-managed properties.
         * This prevents the DOM-modification war with Angular's change
         * detection that caused annotations to disappear after ~60 seconds.
         */

        /* --- Grad/IA --- */
        elm-row[data-csv-dept="Grad/IA"] elm-chip,
        elm-row[data-csv-dept="Grad/IA"] elm-chip .bg-color {
            background-color: #e3f2fd !important;
        }
        elm-row[data-csv-dept="Grad/IA"] elm-chip .elm-chip-label {
            font-size: 0 !important;
            line-height: 0 !important;
            color: transparent !important;
        }
        elm-row[data-csv-dept="Grad/IA"] elm-chip .elm-chip-label::after {
            content: " Grad/IA ";
            font-size: 12px !important;
            line-height: normal !important;
            color: #1565c0 !important;
            white-space: nowrap;
        }

        /* --- UnderGrad --- */
        elm-row[data-csv-dept="UnderGrad"] elm-chip,
        elm-row[data-csv-dept="UnderGrad"] elm-chip .bg-color {
            background-color: #f3e5f5 !important;
        }
        elm-row[data-csv-dept="UnderGrad"] elm-chip .elm-chip-label {
            font-size: 0 !important;
            line-height: 0 !important;
            color: transparent !important;
        }
        elm-row[data-csv-dept="UnderGrad"] elm-chip .elm-chip-label::after {
            content: " UnderGrad ";
            font-size: 12px !important;
            line-height: normal !important;
            color: #6a1b9a !important;
            white-space: nowrap;
        }

        /* --- Forbidden --- */
        elm-row[data-csv-dept="Forbidden"] elm-chip,
        elm-row[data-csv-dept="Forbidden"] elm-chip .bg-color {
            background-color: #fce4ec !important;
        }
        elm-row[data-csv-dept="Forbidden"] elm-chip .elm-chip-label {
            font-size: 0 !important;
            line-height: 0 !important;
            color: transparent !important;
        }
        elm-row[data-csv-dept="Forbidden"] elm-chip .elm-chip-label::after {
            content: " Forbidden ";
            font-size: 12px !important;
            line-height: normal !important;
            color: #c2185b !important;
            white-space: nowrap;
        }
        /* --- Appeal --- */
        elm-row[data-csv-dept="Appeal"] elm-chip,
        elm-row[data-csv-dept="Appeal"] elm-chip .bg-color {
            background-color: #fff8e1 !important;
        }
        elm-row[data-csv-dept="Appeal"] elm-chip .elm-chip-label {
            font-size: 0 !important;
            line-height: 0 !important;
            color: transparent !important;
        }
        elm-row[data-csv-dept="Appeal"] elm-chip .elm-chip-label::after {
            content: " Appeal ";
            font-size: 12px !important;
            line-height: normal !important;
            color: #f57f17 !important;
            white-space: nowrap;
        }

        /* --- API Status Toast --- */
        #csv-api-toast {
            position: fixed;
            bottom: 16px;
            left: 16px;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 16px 8px 12px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.75);
            font-size: 12px;
            font-weight: 500;
            color: #333;
            z-index: 9999;
            opacity: 0;
            transition: opacity 0.35s ease;
            pointer-events: none;
            max-width: 340px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.1);
        }
        #csv-api-toast.visible { opacity: 1; }
        /* Pulse dot container */
        .csv-toast-dot {
            position: relative;
            width: 18px;
            height: 18px;
            flex-shrink: 0;
        }
        .csv-toast-dot-inner {
            position: absolute;
            top: 50%; left: 50%;
            width: 8px; height: 8px;
            border-radius: 50%;
            transform: translate(-50%, -50%);
        }
        .csv-toast-dot-outer {
            position: absolute;
            top: 50%; left: 50%;
            width: 16px; height: 16px;
            border-radius: 50%;
            transform: translate(-50%, -50%);
            animation: csvPulse 1.8s ease-in-out infinite;
        }
        /* Green (success) */
        #csv-api-toast.success .csv-toast-dot-inner { background: #2e7d32; }
        #csv-api-toast.success .csv-toast-dot-outer { background: rgba(46, 125, 50, 0.3); }
        /* Orange (fallback) */
        #csv-api-toast.fallback .csv-toast-dot-inner { background: #e65100; }
        #csv-api-toast.fallback .csv-toast-dot-outer { background: rgba(230, 81, 0, 0.3); }
        /* Red (error) */
        #csv-api-toast.error .csv-toast-dot-inner { background: #c62828; }
        #csv-api-toast.error .csv-toast-dot-outer { background: rgba(198, 40, 40, 0.3); }
        @keyframes csvPulse {
            0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.6; }
            50%      { transform: translate(-50%, -50%) scale(1.5); opacity: 0.2; }
        }
        /* --- Database Size Badge (matches merge counter pill) --- */
        #elm-db-size-badge {
            display: flex;
            align-items: center;
            background: #f5f5f5;
            border-radius: 20px;
            border: 1px solid #ddd;
            padding: 2px;
            white-space: nowrap;
            cursor: default;
        }
        #elm-db-size-label {
            font-weight: 600;
            font-size: 14px;
            color: #555;
            padding: 4px 12px 4px 8px;
            white-space: nowrap;
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
        // For undergrad entries the main script marks the applicant keyword row
        // with .applicant-keyword-row. This may initially be absent (placeholder)
        // and update once the FAB fires and the row is highlighted.
        const kwRow = document.querySelector('.applicant-keyword-row');
        if (kwRow) {
            return kwRow.textContent.trim().replace(/\s+/g, ' ');
        }
        const blockedRow = document.querySelector('.blocked-row, .blocked-row-critical');
        if (blockedRow) {
            return blockedRow.textContent.trim().replace(/\s+/g, ' ');
        }
        // No highlighted row in DOM — provide context based on dept
        if (dept === 'Ignored') return 'Student has Ignored chip';
        return 'No IA/Grad Keywords Found';
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

        // Verify the body's csvUid matches the current URL's unique ID.
        // During fast navigation (e.g., auto-skip), the URL may have changed
        // to the NEXT entry while data-csv-dept still reflects the PREVIOUS
        // entry. Without this check, the old dept/names would be stored with
        // the new unique ID, corrupting the database.
        const bodyUid = document.body.dataset.csvUid;
        if (bodyUid && bodyUid !== uniqueId) {
            console.log('CSV Database: Skipping record — URL unique ID (' + uniqueId + ') does not match body csvUid (' + bodyUid + '), likely mid-navigation');
            return;
        }

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
    // API STATUS TOAST
    // =========================================================
    let toastEl = null;
    let toastTimer = null;
    function showApiToast(message, type) {
        if (!SHOW_API_STATUS_TOAST) return;
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.id = 'csv-api-toast';
            document.body.appendChild(toastEl);
        }
        toastEl.innerHTML =
            '<span class="csv-toast-dot">' +
                '<span class="csv-toast-dot-outer"></span>' +
                '<span class="csv-toast-dot-inner"></span>' +
            '</span>' +
            '<span class="csv-toast-text"></span>';
        toastEl.querySelector('.csv-toast-text').textContent = message;
        toastEl.className = type + ' visible';
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toastEl.classList.remove('visible');
        }, 4000);
    }

    // Track whether API data was used or DB fallback for the current page
    let lastAnnotationSource = null; // 'api' | 'db-fallback' | null

    // =========================================================
    // DB-DIRECT MATCHING (FALLBACK)
    // When API data is unavailable, match DOM row names directly
    // against the database's firstName/lastName fields to find
    // department info without needing the unique ID from the API.
    // =========================================================
    function matchRowToDbEntry(row, db, usedDbIndices) {
        const rowText = row.textContent.trim().toLowerCase();

        // Pass 1: Precise — match on both firstName AND lastName
        for (let i = 0; i < db.length; i++) {
            if (usedDbIndices.has(i)) continue;
            const entry = db[i];
            const first = (entry.firstName || '').trim().toLowerCase();
            const last = (entry.lastName || '').trim().toLowerCase();
            if (first.length > 1 && last.length > 1 &&
                rowText.includes(first) && rowText.includes(last)) {
                usedDbIndices.add(i);
                return entry;
            }
        }

        // Pass 2: Single name — lastName only (more unique than firstName)
        for (let i = 0; i < db.length; i++) {
            if (usedDbIndices.has(i)) continue;
            const entry = db[i];
            const last = (entry.lastName || '').trim().toLowerCase();
            if (last.length > 3 && rowText.includes(last)) {
                usedDbIndices.add(i);
                return entry;
            }
        }
        return null;
    }

    // =========================================================
    // LIST PAGE: API INTERCEPTION & ANNOTATION
    // =========================================================

    // Captured duplicate entries from the API response (includes unique IDs)
    let apiDuplicatesList = null;
    let apiCapturedPageKey = null; // Tracks which page the API data belongs to
    let apiGeneration = 0;         // Increments on each fresh API capture

    // Page-keyed cache of API data.
    // Element451 caches previously viewed list pages and may serve them
    // without making a fresh API call. When that happens, our XHR/fetch
    // interceptors never fire and apiDuplicatesList stays null. This cache
    // stores intercepted data per page key so we can restore it when the
    // user navigates back to a previously-viewed page.
    const apiPageCache = new Map();
    const MAX_CACHED_PAGES = 20;

    // Track last known URL for SPA navigation detection on list pages
    let lastKnownListUrl = window.location.href;

    // --- HELPER: PAGE KEY FOR STALENESS DETECTION ---
    // Returns a string representing the current list page (path + pagination params).
    // Used to detect when the user navigates to a different page so we can
    // invalidate stale API data and prevent wrong chip annotations.
    function getPageKey() {
        return window.location.pathname + window.location.search;
    }

    // --- HELPER: PROCESS INTERCEPTED API DATA ---
    // Called by both XHR and fetch interceptors when fresh duplicates list data arrives.
    function onFreshApiData(entries, source) {
        apiDuplicatesList = entries;
        apiCapturedPageKey = getPageKey();
        apiGeneration++;

        // Cache this data so we can restore it when the user navigates back
        // to this page and Element serves it from its internal cache without
        // making a new API call.
        apiPageCache.set(apiCapturedPageKey, {
            entries: entries,
            generation: apiGeneration
        });
        // Evict oldest entries if cache grows too large
        if (apiPageCache.size > MAX_CACHED_PAGES) {
            const oldestKey = apiPageCache.keys().next().value;
            apiPageCache.delete(oldestKey);
        }

        console.log('CSV Database: Captured', entries.length, 'entries from', source, '(gen ' + apiGeneration + ', page cached: ' + apiCapturedPageKey + ')');
        // Clear stale annotations from previous page/data before re-annotating
        clearStaleAnnotations();
        annotateDuplicatesList();
        // Follow-up passes to catch rows that Angular renders after the API
        // response arrives (common with pagination and filter changes)
        setTimeout(annotateDuplicatesList, 100);
        setTimeout(annotateDuplicatesList, 500);
    }

    // --- HELPER: CLEAR STALE CHIP ANNOTATIONS ---
    // Removes data attributes from rows so CSS-driven annotations disappear.
    // Only touches custom data-* attributes — never modifies Angular-owned
    // properties (textContent, style, etc.) to avoid change-detection fights.
    function clearStaleAnnotations() {
        document.querySelectorAll('elm-row').forEach(row => {
            row.removeAttribute('data-csv-uid');
            row.removeAttribute('data-csv-dept');
        });
    }

    // --- HELPER: PARSE API ENTRIES INTO STANDARD FORMAT ---
    function parseApiEntries(entries) {
        const sample = entries[0];
        const idField = sample._id ? '_id' : sample.id ? 'id' : null;
        if (!idField) {
            console.log('CSV Database: API entries found but no _id/id field. Keys:', Object.keys(sample));
            return null;
        }
        return entries.map(e => ({
            uniqueId: (e[idField] || '').toLowerCase(),
            name: e.name || e.full_name || '',
            duplicateName: e.duplicate_name || ''
        }));
    }

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
                    // Match duplicates list endpoint — only skip detail pages
                    // where the ID comes right after /duplicates/ in the path
                    if (!this._csvDbUrl.includes('duplicate')) return;
                    if (this._csvDbUrl.match(/\/duplicates\/[a-f0-9]{24}/i)) return;

                    const data = JSON.parse(this.responseText);
                    const entries = data.data || data.items || data.results ||
                                    (Array.isArray(data) ? data : null);
                    if (!entries || !Array.isArray(entries) || entries.length === 0) return;

                    const parsed = parseApiEntries(entries);
                    if (parsed) onFreshApiData(parsed, 'XHR');
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
                    if (url.match(/\/duplicates\/[a-f0-9]{24}/i)) return response;

                    // Clone so the original response body is still consumable
                    response.clone().json().then(data => {
                        const entries = data.data || data.items || data.results ||
                                        (Array.isArray(data) ? data : null);
                        if (!entries || !Array.isArray(entries) || entries.length === 0) return;

                        const parsed = parseApiEntries(entries);
                        if (parsed) onFreshApiData(parsed, 'fetch');
                    }).catch(() => {}); // Not JSON or not the response we want
                } catch (e) {
                    // Ignore errors in interception
                }
                return response;
            });
        };
    })();

    // --- FIRST PAGE BOOTSTRAP ---
    // Both userscripts run at document-idle (the default). By that time,
    // Angular has already made the initial API call for page 1 and our
    // XHR/fetch interceptors missed it. Use the Performance Resource
    // Timing API to find the already-completed duplicates API URL and
    // re-fetch it so the first page gets annotated too.
    let firstPageFetchAttempted = false;
    function attemptFirstPageFetch() {
        if (firstPageFetchAttempted) return;
        if (apiDuplicatesList) return; // Already have data
        if (document.querySelector('elm-merge-row')) return; // Detail page, not list
        const rows = document.querySelectorAll('elm-row');
        if (rows.length === 0) return; // No rows visible yet

        firstPageFetchAttempted = true;

        // Search performance entries for the duplicates API call that already completed
        const perfEntries = performance.getEntriesByType('resource');
        // Find the most recent matching entry (last one wins)
        let apiUrl = null;
        for (let i = perfEntries.length - 1; i >= 0; i--) {
            const entry = perfEntries[i];
            if (entry.name.includes('duplicate') &&
                !entry.name.match(/\/duplicates\/[a-f0-9]{24}/i)) {
                apiUrl = entry.name;
                break;
            }
        }

        if (!apiUrl) return;
        console.log('CSV Database: Re-fetching first page data from', apiUrl);
        fetch(apiUrl)
            .then(r => r.json())
            .then(data => {
                const entries = data.data || data.items || data.results ||
                                (Array.isArray(data) ? data : null);
                if (!entries || !Array.isArray(entries) || entries.length === 0) return;
                const parsed = parseApiEntries(entries);
                if (parsed) onFreshApiData(parsed, 'first-page-bootstrap');
            })
            .catch(() => {}); // Silently fail — interceptors will catch future pages
    }

    // --- HELPER: CONTENT-BASED ROW-TO-API MATCHING ---
    // Matches a DOM row to an API entry by comparing the visible name text
    // in the row against the API's name/duplicate_name fields. This is more
    // reliable than index-based matching because it survives Angular
    // re-ordering and DOM caching.
    //
    // Uses a two-pass strategy to handle duplicate names:
    //   Pass 1 (precise): Require BOTH name AND duplicateName present in the
    //           row text. This distinguishes "John Smith / Jane Doe" from
    //           "John Smith / Bob Jones" even when they share the primary name.
    //   Pass 2 (single): Fall back to matching on either name alone, for
    //           entries where only one name field is available.
    //
    // usedIndices tracks which API entries have already been claimed by
    // other rows, preventing two rows from matching the same entry.
    function matchRowToApiEntry(row, apiEntries, usedIndices) {
        const rowText = row.textContent.trim().toLowerCase();

        // Pass 1: Precise match — require BOTH name and duplicateName
        for (let i = 0; i < apiEntries.length; i++) {
            if (usedIndices.has(i)) continue;
            const entry = apiEntries[i];
            const name = (entry.name || '').trim().toLowerCase();
            const dupName = (entry.duplicateName || '').trim().toLowerCase();
            // Only attempt dual match when both fields are meaningful
            if (name.length > 3 && dupName.length > 3) {
                if (rowText.includes(name) && rowText.includes(dupName)) {
                    usedIndices.add(i);
                    return entry;
                }
            }
        }

        // Pass 2: Single-name match — for entries with only one name field
        // or where the dual match didn't find anything
        for (let i = 0; i < apiEntries.length; i++) {
            if (usedIndices.has(i)) continue;
            const entry = apiEntries[i];
            const name = (entry.name || '').trim().toLowerCase();
            const dupName = (entry.duplicateName || '').trim().toLowerCase();
            // Require minimum length to avoid false matches on short/empty names
            if (name.length > 3 && rowText.includes(name)) {
                usedIndices.add(i);
                return entry;
            }
            if (dupName.length > 3 && rowText.includes(dupName)) {
                usedIndices.add(i);
                return entry;
            }
        }
        return null;
    }

    // --- LIST PAGE: ANNOTATE elm-row WITH DEPT DATA ATTRIBUTES ---
    // Uses the intercepted API data to match each row to its unique ID,
    // then looks up that ID in the CSV database and sets data-csv-dept
    // on the elm-row element. CSS rules handle all visual changes (text
    // replacement, background colors, label colors) based on that attribute.
    //
    // This CSS-only approach avoids modifying Angular-owned properties
    // (textContent, style.cssText) which previously caused a feedback loop
    // with Angular's change detection, making annotations vanish after ~60s.
    //
    // STALENESS PROTECTION: Tracks which page the API data belongs to and
    // uses a page-keyed cache to restore data for previously-viewed pages.
    function annotateDuplicatesList() {
        // Only run on list page — skip if on detail page (has elm-merge-row)
        if (document.querySelector('elm-merge-row')) return;

        const currentPageKey = getPageKey();
        let useDbFallback = false;

        // If we have no API data, try to restore from cache for this page
        if (!apiDuplicatesList) {
            const cached = apiPageCache.get(currentPageKey);
            if (cached) {
                console.log('CSV Database: No API data — restoring from cache for', currentPageKey);
                apiDuplicatesList = cached.entries;
                apiCapturedPageKey = currentPageKey;
                apiGeneration++;
                clearStaleAnnotations();
                // Fall through to annotate with restored data
            } else {
                // No API data at all — try DB-direct fallback
                useDbFallback = true;
            }
        }

        // Handle page change: API data belongs to a different page
        if (!useDbFallback && apiCapturedPageKey && apiCapturedPageKey !== currentPageKey) {
            // Try to restore from cache for the new page
            const cached = apiPageCache.get(currentPageKey);
            if (cached) {
                console.log('CSV Database: Page changed (' + apiCapturedPageKey + ' → ' + currentPageKey + '), restoring from cache');
                apiDuplicatesList = cached.entries;
                apiCapturedPageKey = currentPageKey;
                apiGeneration++;
                clearStaleAnnotations();
                // Fall through to annotate with restored data
            } else {
                console.log('CSV Database: Page changed (' + apiCapturedPageKey + ' → ' + currentPageKey + '), no cache — using DB fallback');
                apiDuplicatesList = null;
                apiCapturedPageKey = null;
                clearStaleAnnotations();
                useDbFallback = true;
            }
        }

        const rows = document.querySelectorAll('elm-row');
        if (rows.length === 0) return;

        const db = getDatabase();
        if (db.length === 0) return; // Nothing to annotate with

        // ---- DB-DIRECT FALLBACK PATH ----
        // When API data is unavailable, match DOM rows directly against
        // database entries by firstName/lastName. Less precise (no unique ID
        // confirmation) but ensures chips still show department colors.
        // Only sets data-csv-dept on elm-row — CSS handles all visual changes.
        if (useDbFallback) {
            const usedDbIndices = new Set();
            let matched = 0;
            rows.forEach(row => {
                const dbEntry = matchRowToDbEntry(row, db, usedDbIndices);
                if (!dbEntry) return;
                if (dbEntry.dept === 'Ignored') return;

                // If Element451 already shows this chip as "Ignored", don't overwrite it.
                const chip = row.querySelector('elm-chip');
                const label = chip ? chip.querySelector('.elm-chip-label') : null;
                if (label && label.textContent.trim().toLowerCase() === 'ignored') {
                    row.removeAttribute('data-csv-dept');
                    return;
                }

                // Check if already annotated correctly
                if (row.getAttribute('data-csv-dept') === dbEntry.dept) return;

                row.setAttribute('data-csv-dept', dbEntry.dept);
                matched++;
            });
            if (matched > 0 && lastAnnotationSource !== 'db-fallback') {
                lastAnnotationSource = 'db-fallback';
                showApiToast('API: unavailable, using database fallback', 'fallback');
            }
            return;
        }

        // ---- PRIMARY PATH (API data available) ----
        // Only sets data-csv-uid and data-csv-dept on elm-row elements.
        // All visual changes (text, colors, backgrounds) are handled by CSS
        // rules keyed on data-csv-dept. This avoids modifying Angular-owned
        // properties (textContent, style) which caused a change-detection
        // feedback loop that made annotations disappear after ~60 seconds.
        if (lastAnnotationSource !== 'api') {
            lastAnnotationSource = 'api';
            showApiToast('API: data captured successfully', 'success');
        }

        // Build a quick lookup map from uniqueId -> dbEntry
        const dbMap = {};
        db.forEach(entry => { dbMap[entry.uniqueId] = entry; });

        const usedApiIndices = new Set(); // Track which API entries have been claimed

        // Check if row count matches API count — only allow index fallback
        // when they match, indicating no filtering or reordering happened.
        const indexFallbackSafe = apiDuplicatesList && rows.length === apiDuplicatesList.length;

        rows.forEach((row, rowIndex) => {
            // Get the unique ID for this row. Priority order:
            // 1. Previously stamped data-csv-uid (survives Angular re-renders)
            // 2. Content-based matching (both names, then single name)
            // 3. Index-based fallback (ONLY when row count matches API count,
            //    meaning no filtering/reordering — safe to assume same order)
            let uniqueId = row.getAttribute('data-csv-uid');
            if (!uniqueId && apiDuplicatesList) {
                // Primary: match by visible name text in the row
                const matched = matchRowToApiEntry(row, apiDuplicatesList, usedApiIndices);
                if (matched) {
                    uniqueId = matched.uniqueId;
                }
                // Index fallback: only when row count matches API count
                // (no filtering/reordering) and this index hasn't been claimed
                if (!uniqueId && indexFallbackSafe &&
                    apiDuplicatesList[rowIndex] && !usedApiIndices.has(rowIndex)) {
                    uniqueId = apiDuplicatesList[rowIndex].uniqueId;
                    usedApiIndices.add(rowIndex);
                }
                if (uniqueId) row.setAttribute('data-csv-uid', uniqueId);
            }
            if (!uniqueId) return;

            const dbEntry = dbMap[uniqueId];

            // If entry is NOT in database, clean up any stale annotation
            if (!dbEntry) {
                row.removeAttribute('data-csv-dept');
                return;
            }

            // Ignored entries should keep their original chip unmodified
            if (dbEntry.dept === 'Ignored') {
                row.removeAttribute('data-csv-dept');
                return;
            }

            // If Element451 already shows this chip as "Ignored", don't overwrite it.
            const chip = row.querySelector('elm-chip');
            const label = chip ? chip.querySelector('.elm-chip-label') : null;
            if (label && label.textContent.trim().toLowerCase() === 'ignored') {
                row.removeAttribute('data-csv-dept');
                return;
            }

            // Set the data attribute — CSS handles all visual changes
            if (row.getAttribute('data-csv-dept') !== dbEntry.dept) {
                row.setAttribute('data-csv-dept', dbEntry.dept);
            }
        });
    }

    // --- LIST PAGE: MUTATION OBSERVER ---
    // Angular re-renders can replace elm-row elements, losing our data-csv-uid
    // and data-csv-dept attributes. The observer detects when rows or chips are
    // added/replaced so we can re-stamp the data attributes.
    //
    // Because we now only set data-* attributes (no textContent/style changes),
    // our own modifications rarely trigger the observer, breaking the feedback
    // loop that previously caused annotations to vanish after ~60 seconds.
    let listAnnotationTimer = null;
    const listObserver = new MutationObserver((mutations) => {
        // Only re-annotate if rows or chips were actually added/replaced.
        // Ignore attribute-only mutations (which are likely our own data-* changes).
        let rowsChanged = false;
        for (const m of mutations) {
            if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
                rowsChanged = true;
                break;
            }
        }
        if (!rowsChanged) return;

        if (listAnnotationTimer) clearTimeout(listAnnotationTimer);
        listAnnotationTimer = setTimeout(annotateDuplicatesList, 150);
    });
    // Track current observer target to detect when the container changes
    // (e.g., Angular replaces .elm-table-body during navigation).
    // Without this, the observer would be watching a detached node.
    let currentObserverTarget = null;
    // Start observing once we're on a page with elm-row elements
    function startListObserver() {
        // Only observe on list pages, not detail pages
        if (document.querySelector('elm-merge-row')) return;
        const container = document.querySelector('.elm-table-body') ||
                          document.querySelector('elm-duplicates') ||
                          document.body;
        // Only reconnect if the container has changed (avoids accumulating
        // dead observations on detached nodes)
        if (container !== currentObserverTarget) {
            listObserver.disconnect();
            listObserver.observe(container, { childList: true, subtree: true, characterData: true });
            currentObserverTarget = container;
        }
    }

    // --- LIST PAGE: URL CHANGE DETECTION ---
    // Element451 is an SPA — page navigation changes the URL without a full
    // reload. When the user navigates away from the list page and back, or
    // paginates, Element may serve the cached DOM without making a new API
    // call. We detect URL changes and trigger re-annotation from our cache.
    function checkListUrlChange() {
        const currentUrl = window.location.href;
        if (currentUrl !== lastKnownListUrl) {
            lastKnownListUrl = currentUrl;
            console.log('CSV Database: List URL changed to', currentUrl);

            // Reset first page bootstrap flag so navigating back to page 1
            // (or changing filters which alter the URL) can re-fetch data
            firstPageFetchAttempted = false;
            // Reset annotation source so toast shows for the new page
            lastAnnotationSource = null;

            // URL changed — trigger re-annotation (will use page cache if
            // no fresh API data is available for this page)
            if (listAnnotationTimer) clearTimeout(listAnnotationTimer);
            listAnnotationTimer = setTimeout(() => {
                attemptFirstPageFetch();
                annotateDuplicatesList();
                // Reconnect observer to new container (Angular may have
                // replaced the DOM element)
                listObserver.disconnect();
                currentObserverTarget = null;
                startListObserver();
                // Second pass after Angular is fully settled — catches cases
                // where the first pass ran before all rows were in the DOM
                setTimeout(annotateDuplicatesList, 300);
            }, 150); // Slightly longer delay to let Angular finish rendering
        }
    }

    // Run annotation periodically on the list page (fallback for observer).
    // 2-second interval is sufficient now that we only set data attributes
    // (no constant style/textContent fight with Angular).
    setInterval(() => {
        attemptFirstPageFetch();
        annotateDuplicatesList();
        startListObserver();
    }, 2000);

    // Poll for SPA navigation (URL changes without full reload)
    setInterval(checkListUrlChange, 500);

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
        const label = document.getElementById('elm-db-size-label');
        if (!label) return;
        const count = getDatabase().length;
        label.textContent = `DB: ${count}`;
        const badge = document.getElementById('elm-db-size-badge');
        if (badge) badge.title = `Database: ${count} entries recorded`;
    }

    function injectDbBadge() {
        if (document.getElementById('elm-db-size-badge')) return;
        const controlsWrapper = document.getElementById('elm-controls-wrapper');
        if (!controlsWrapper) return;

        const badge = document.createElement('div');
        badge.id = 'elm-db-size-badge';
        badge.title = 'Database entries recorded';

        const label = document.createElement('span');
        label.id = 'elm-db-size-label';
        label.textContent = 'DB: 0';
        badge.appendChild(label);

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
                    // Refresh list page annotations with the new database
                    clearStaleAnnotations();
                    annotateDuplicatesList();
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
                // Clear list page annotations since the database is now empty
                clearStaleAnnotations();
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
