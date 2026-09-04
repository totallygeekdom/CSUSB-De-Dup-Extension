// ==UserScript==
// @name         Element451 - CSV Database (New Deduplication Layout)
// @namespace    http://tampermonkey.net/
// @version      1
// @description  Tracks duplicate entries in a CSV database stored in browser localStorage — adapted for the redesigned Deduplication review-queue UI
// @author       You
// @match        https://*.element451.io/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/totallygeekdom/csusb-de-dup-extension/main/csv-database-v2.js
// @downloadURL  https://raw.githubusercontent.com/totallygeekdom/csusb-de-dup-extension/main/csv-database-v2.js
// ==/UserScript==
//
// PORTING NOTES (read before tuning this file live):
// Companion to Element451-UI-Perfection-v2.user.js. Ported from the same
// single static, PII-redacted HTML snapshot of the new "Deduplication"
// review-queue UI, so anything touching content that was redacted in that
// snapshot — the actual master/duplicate/signals/flagged cell contents on
// the queue table, and whether an "Ignored" chip still exists — is a
// best-effort guess. Verify against the live site.
//
// What changed vs. the classic script:
//   - List page rows: <elm-row> -> <bolt-row class="cdk-row"> inside
//     <elm-review-queue-table>, with columns keyed by class
//     cdk-column-select/score/master/duplicate/signals/flagged/actions
//     instead of a single chip per row.
//   - Detail/review page: <elm-merge-row> -> <elm-duplicate-field-diff-form>
//     .diff-row, opened in a sidebar rather than a full page.
//   - Because we don't know if the flagged/signals cell already renders its
//     own chip, this script APPENDS a small badge rather than rewriting an
//     assumed existing element (safer than the classic script's approach of
//     restyling elm-chip in place).
(function () {
    'use strict';

    const STORAGE_KEY = 'elm_csv_database';
    const SHOW_API_STATUS_TOAST = true;

    // =========================================================
    // CSS
    // =========================================================
    const dbCss = `
        .csv-dept-badge {
            display: inline-flex;
            align-items: center;
            margin-left: 6px;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
            vertical-align: middle;
        }
        .csv-dept-badge[data-dept="Grad/IA"]      { background: #e3f2fd; color: #1565c0; }
        .csv-dept-badge[data-dept="UnderGrad"]    { background: #f3e5f5; color: #6a1b9a; }
        .csv-dept-badge[data-dept="Forbidden"]    { background: #fce4ec; color: #c2185b; }
        .csv-dept-badge[data-dept="Appeal"]       { background: #fff8e1; color: #f57f17; }
        .csv-dept-badge[data-dept="Ignored"]      { background: #f5f5f5; color: #616161; }

        #csv-api-toast {
            position: fixed; bottom: 16px; left: 16px; display: flex; align-items: center; gap: 10px;
            padding: 8px 16px 8px 12px; border-radius: 10px; background: rgba(255, 255, 255, 0.75);
            font-size: 12px; font-weight: 500; color: #333; z-index: 9999; opacity: 0;
            transition: opacity 0.35s ease; pointer-events: none; max-width: 340px; box-shadow: 0 2px 12px rgba(0,0,0,0.1);
        }
        #csv-api-toast.visible { opacity: 1; }
        .csv-toast-dot { position: relative; width: 18px; height: 18px; flex-shrink: 0; }
        .csv-toast-dot-inner { position: absolute; top: 50%; left: 50%; width: 8px; height: 8px; border-radius: 50%; transform: translate(-50%, -50%); }
        .csv-toast-dot-outer { position: absolute; top: 50%; left: 50%; width: 16px; height: 16px; border-radius: 50%; transform: translate(-50%, -50%); animation: csvPulse 1.8s ease-in-out infinite; }
        #csv-api-toast.success .csv-toast-dot-inner { background: #2e7d32; }
        #csv-api-toast.success .csv-toast-dot-outer { background: rgba(46, 125, 50, 0.3); }
        #csv-api-toast.fallback .csv-toast-dot-inner { background: #e65100; }
        #csv-api-toast.fallback .csv-toast-dot-outer { background: rgba(230, 81, 0, 0.3); }
        #csv-api-toast.error .csv-toast-dot-inner { background: #c62828; }
        #csv-api-toast.error .csv-toast-dot-outer { background: rgba(198, 40, 40, 0.3); }
        @keyframes csvPulse { 0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.6; } 50% { transform: translate(-50%, -50%) scale(1.5); opacity: 0.2; } }

        #elm-db-size-badge { display: flex; align-items: center; background: #f5f5f5; border-radius: 20px; border: 1px solid #ddd; padding: 2px; white-space: nowrap; cursor: default; }
        #elm-db-size-label { font-weight: 600; font-size: 14px; color: #555; padding: 4px 12px; }
        .settings-action-btn { display: block; width: 100%; text-align: left; padding: 8px 10px; margin: 6px 0; border: 1px solid #ddd; border-radius: 8px; background: #fafafa; cursor: pointer; font-size: 13px; }
        .settings-action-btn:hover { background: #f0f0f0; }
        .settings-action-btn.danger { color: #c62828; border-color: #f2c2c2; }
        #elm-db-upload-input { display: none; }
    `;
    const styleEl = document.createElement('style');
    styleEl.textContent = dbCss;
    document.head.appendChild(styleEl);

    // =========================================================
    // PAGE DETECTION
    // =========================================================
    function isReviewDetailPage() {
        return !!document.querySelector('elm-duplicate-field-diff-form');
    }
    function getQueueTable() {
        return document.querySelector('elm-review-queue-table');
    }
    function getQueueRows() {
        const table = getQueueTable();
        if (!table) return [];
        return Array.from(table.querySelectorAll('bolt-row.cdk-row'));
    }

    // =========================================================
    // ID / NAME EXTRACTION (detail page)
    // =========================================================
    function extractUniqueId() {
        const url = window.location.href;
        const patterns = [
            /\/duplicates?\/([a-f0-9]{24})/i,
            /\/deduplication[a-z-]*\/([a-f0-9]{24})/i,
            /[?&](?:id|contactId|duplicateId)=([a-f0-9]{24})/i
        ];
        for (const p of patterns) {
            const m = url.match(p);
            if (m) return m[1].toLowerCase();
        }
        return null;
    }
    function extractNames() {
        const form = document.querySelector('elm-duplicate-field-diff-form');
        if (!form) return { firstName: '', lastName: '' };
        const nameEls = form.querySelectorAll('.contact-card-name');
        const fullName = nameEls[0] ? nameEls[0].textContent.trim() : (nameEls[1] ? nameEls[1].textContent.trim() : '');
        if (!fullName) return { firstName: '', lastName: '' };
        const parts = fullName.split(/\s+/);
        return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
    }
    // Row(s) highlighted by Element451-UI-Perfection-v2.user.js as the trigger
    // for the current lockdown (mirrors the classic .blocked-row read).
    function getBlockedRowText(dept) {
        const rows = document.querySelectorAll('.diff-row.elm2-blocked-row');
        if (rows.length > 0) {
            return Array.from(rows).map(r => r.textContent.trim().replace(/\s+/g, ' ')).join(' | ');
        }
        if (dept === 'Ignored') return 'Student has Ignored chip';
        return 'No IA/Grad Keywords Found';
    }

    // =========================================================
    // DATABASE OPERATIONS (unchanged data model/storage)
    // =========================================================
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
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
        catch (e) { console.error('CSV Database: Error saving database', e); }
    }
    function recordEntry(dept) {
        if (!dept) return;
        const uniqueId = extractUniqueId();
        if (!uniqueId) return;
        const bodyUid = document.body.dataset.csvUid;
        if (bodyUid && bodyUid !== uniqueId) return; // stale signal mid-navigation
        const { firstName, lastName } = extractNames();
        if (!firstName && !lastName) return; // page content not ready
        const db = getDatabase();
        const rowContents = getBlockedRowText(dept);
        const newEntry = { firstName, lastName, dept, rowContents, uniqueId };
        const existingIdx = db.findIndex(entry => entry.uniqueId === uniqueId);
        if (existingIdx !== -1) {
            const old = db[existingIdx];
            if (old.dept === dept && old.firstName === firstName && old.lastName === lastName && old.rowContents === rowContents) return;
            db[existingIdx] = newEntry;
            saveDatabase(db);
            return;
        }
        db.push(newEntry);
        saveDatabase(db);
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
            '<span class="csv-toast-dot"><span class="csv-toast-dot-outer"></span><span class="csv-toast-dot-inner"></span></span>' +
            '<span class="csv-toast-text"></span>';
        toastEl.querySelector('.csv-toast-text').textContent = message;
        toastEl.className = type + ' visible';
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastEl.classList.remove('visible'); }, 4000);
    }
    let lastAnnotationSource = null; // 'api' | 'db-fallback' | null

    // =========================================================
    // ROW MATCHING (name-text based — same approach as the classic script)
    // =========================================================
    function matchRowToDbEntry(row, db, usedDbIndices) {
        const rowText = row.textContent.trim().toLowerCase();
        for (let i = 0; i < db.length; i++) {
            if (usedDbIndices.has(i)) continue;
            const entry = db[i];
            const first = (entry.firstName || '').trim().toLowerCase();
            const last = (entry.lastName || '').trim().toLowerCase();
            if (first.length > 1 && last.length > 1 && rowText.includes(first) && rowText.includes(last)) {
                usedDbIndices.add(i);
                return entry;
            }
        }
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
    function matchRowToApiEntry(row, apiEntries, usedIndices) {
        const rowText = row.textContent.trim().toLowerCase();
        for (let i = 0; i < apiEntries.length; i++) {
            if (usedIndices.has(i)) continue;
            const entry = apiEntries[i];
            const name = (entry.name || '').trim().toLowerCase();
            const dupName = (entry.duplicateName || '').trim().toLowerCase();
            if (name.length > 3 && dupName.length > 3 && rowText.includes(name) && rowText.includes(dupName)) {
                usedIndices.add(i);
                return entry;
            }
        }
        for (let i = 0; i < apiEntries.length; i++) {
            if (usedIndices.has(i)) continue;
            const entry = apiEntries[i];
            const name = (entry.name || '').trim().toLowerCase();
            const dupName = (entry.duplicateName || '').trim().toLowerCase();
            if ((name.length > 3 && rowText.includes(name)) || (dupName.length > 3 && rowText.includes(dupName))) {
                usedIndices.add(i);
                return entry;
            }
        }
        return null;
    }

    // =========================================================
    // LIST PAGE (review queue table): API INTERCEPTION & ANNOTATION
    // =========================================================
    let apiDuplicatesList = null;
    let apiCapturedPageKey = null;
    let apiGeneration = 0;
    const apiPageCache = new Map();
    const MAX_CACHED_PAGES = 20;
    let lastKnownListUrl = window.location.href;

    function getPageKey() { return window.location.pathname + window.location.search; }

    function onFreshApiData(entries, source) {
        apiDuplicatesList = entries;
        apiCapturedPageKey = getPageKey();
        apiGeneration++;
        apiPageCache.set(apiCapturedPageKey, { entries, generation: apiGeneration });
        if (apiPageCache.size > MAX_CACHED_PAGES) {
            const oldestKey = apiPageCache.keys().next().value;
            apiPageCache.delete(oldestKey);
        }
        clearStaleAnnotations();
        annotateQueueTable();
        setTimeout(annotateQueueTable, 100);
        setTimeout(annotateQueueTable, 500);
    }
    function clearStaleAnnotations() {
        getQueueRows().forEach(row => {
            row.removeAttribute('data-csv-uid');
            row.removeAttribute('data-csv-dept');
            const badge = row.querySelector('.csv-dept-badge');
            if (badge) badge.remove();
        });
    }
    function parseApiEntries(entries) {
        const sample = entries[0];
        const idField = sample._id ? '_id' : sample.id ? 'id' : null;
        if (!idField) return null;
        return entries.map(e => ({
            uniqueId: (e[idField] || '').toLowerCase(),
            name: e.name || e.full_name || '',
            duplicateName: e.duplicate_name || ''
        }));
    }

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
                    if (!/duplicate|dedup/i.test(this._csvDbUrl)) return;
                    if (this._csvDbUrl.match(/\/duplicates?\/[a-f0-9]{24}/i)) return;
                    const data = JSON.parse(this.responseText);
                    const entries = data.data || data.items || data.results || (Array.isArray(data) ? data : null);
                    if (!entries || !Array.isArray(entries) || entries.length === 0) return;
                    const parsed = parseApiEntries(entries);
                    if (parsed) onFreshApiData(parsed, 'XHR');
                } catch (e) { /* not the response we want */ }
            });
            return origSend.apply(this, arguments);
        };
    })();
    (function interceptFetch() {
        const origFetch = window.fetch;
        window.fetch = function (input, init) {
            const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
            return origFetch.apply(this, arguments).then(response => {
                try {
                    if (!url || !/duplicate|dedup/i.test(url)) return response;
                    if (url.match(/\/duplicates?\/[a-f0-9]{24}/i)) return response;
                    response.clone().json().then(data => {
                        const entries = data.data || data.items || data.results || (Array.isArray(data) ? data : null);
                        if (!entries || !Array.isArray(entries) || entries.length === 0) return;
                        const parsed = parseApiEntries(entries);
                        if (parsed) onFreshApiData(parsed, 'fetch');
                    }).catch(() => {});
                } catch (e) { /* ignore */ }
                return response;
            });
        };
    })();

    let firstPageFetchAttempted = false;
    function attemptFirstPageFetch() {
        if (firstPageFetchAttempted) return;
        if (apiDuplicatesList) return;
        if (isReviewDetailPage()) return;
        const rows = getQueueRows();
        if (rows.length === 0) return;
        firstPageFetchAttempted = true;
        try {
            const entries = performance.getEntriesByType('resource');
            const match = entries.slice().reverse().find(e => /duplicate|dedup/i.test(e.name) && !e.name.match(/\/duplicates?\/[a-f0-9]{24}/i));
            if (!match) return;
            console.log('CSV Database: Re-fetching first page data from', match.name);
            fetch(match.name).then(r => r.json()).then(data => {
                const entries2 = data.data || data.items || data.results || (Array.isArray(data) ? data : null);
                if (!entries2 || !Array.isArray(entries2) || entries2.length === 0) return;
                const parsed = parseApiEntries(entries2);
                if (parsed) onFreshApiData(parsed, 'first-page-refetch');
            }).catch(() => {});
        } catch (e) { /* Resource Timing API unavailable */ }
    }

    // Appends a small colored badge into the row's "flagged" column (or the
    // row itself as a fallback) rather than assuming/rewriting existing
    // content there, since that cell's real markup is unknown (redacted in
    // the reference snapshot).
    function applyBadge(row, dept) {
        if (dept === 'Ignored') { const b = row.querySelector('.csv-dept-badge'); if (b) b.remove(); row.removeAttribute('data-csv-dept'); return; }
        const chipIsIgnored = Array.from(row.querySelectorAll('.bolt-chip, elm-chip')).some(el => el.textContent.trim().toLowerCase() === 'ignored');
        if (chipIsIgnored) { const b = row.querySelector('.csv-dept-badge'); if (b) b.remove(); row.removeAttribute('data-csv-dept'); return; }
        if (row.getAttribute('data-csv-dept') === dept) return;
        row.setAttribute('data-csv-dept', dept);
        let badge = row.querySelector('.csv-dept-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'csv-dept-badge';
            const target = row.querySelector('.cdk-column-flagged') || row.querySelector('.cdk-column-signals') || row;
            target.appendChild(badge);
        }
        badge.dataset.dept = dept;
        const labels = { 'Grad/IA': 'Grad/IA', 'UnderGrad': 'UnderGrad', 'Forbidden': 'Forbidden', 'Appeal': 'Appeal' };
        badge.textContent = labels[dept] || dept;
    }

    function annotateQueueTable() {
        if (isReviewDetailPage()) return;
        const currentPageKey = getPageKey();
        let useDbFallback = false;
        if (!apiDuplicatesList) {
            const cached = apiPageCache.get(currentPageKey);
            if (cached) {
                apiDuplicatesList = cached.entries;
                apiCapturedPageKey = currentPageKey;
                apiGeneration++;
                clearStaleAnnotations();
            } else {
                useDbFallback = true;
            }
        }
        if (!useDbFallback && apiCapturedPageKey && apiCapturedPageKey !== currentPageKey) {
            const cached = apiPageCache.get(currentPageKey);
            if (cached) {
                apiDuplicatesList = cached.entries;
                apiCapturedPageKey = currentPageKey;
                apiGeneration++;
                clearStaleAnnotations();
            } else {
                apiDuplicatesList = null;
                apiCapturedPageKey = null;
                clearStaleAnnotations();
                useDbFallback = true;
            }
        }
        const rows = getQueueRows();
        if (rows.length === 0) return;
        const db = getDatabase();
        if (db.length === 0) return;

        if (useDbFallback) {
            const usedDbIndices = new Set();
            let matched = 0;
            rows.forEach(row => {
                const dbEntry = matchRowToDbEntry(row, db, usedDbIndices);
                if (!dbEntry) return;
                applyBadge(row, dbEntry.dept);
                matched++;
            });
            if (matched > 0 && lastAnnotationSource !== 'db-fallback') {
                lastAnnotationSource = 'db-fallback';
                showApiToast('API: unavailable, using database fallback', 'fallback');
            }
            return;
        }

        if (lastAnnotationSource !== 'api') {
            lastAnnotationSource = 'api';
            showApiToast('API: data captured successfully', 'success');
        }
        const dbMap = {};
        db.forEach(entry => { dbMap[entry.uniqueId] = entry; });
        const usedApiIndices = new Set();
        const indexFallbackSafe = apiDuplicatesList && rows.length === apiDuplicatesList.length;
        rows.forEach((row, rowIndex) => {
            let uniqueId = row.getAttribute('data-csv-uid');
            if (!uniqueId && apiDuplicatesList) {
                const matched = matchRowToApiEntry(row, apiDuplicatesList, usedApiIndices);
                if (matched) uniqueId = matched.uniqueId;
                if (!uniqueId && indexFallbackSafe && apiDuplicatesList[rowIndex] && !usedApiIndices.has(rowIndex)) {
                    uniqueId = apiDuplicatesList[rowIndex].uniqueId;
                    usedApiIndices.add(rowIndex);
                }
                if (uniqueId) row.setAttribute('data-csv-uid', uniqueId);
            }
            if (!uniqueId) return;
            const dbEntry = dbMap[uniqueId];
            if (!dbEntry) {
                const b = row.querySelector('.csv-dept-badge'); if (b) b.remove();
                row.removeAttribute('data-csv-dept');
                return;
            }
            applyBadge(row, dbEntry.dept);
        });
    }

    let listAnnotationTimer = null;
    const listObserver = new MutationObserver((mutations) => {
        let rowsChanged = false;
        for (const m of mutations) {
            if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) { rowsChanged = true; break; }
        }
        if (!rowsChanged) return;
        if (listAnnotationTimer) clearTimeout(listAnnotationTimer);
        listAnnotationTimer = setTimeout(annotateQueueTable, 150);
    });
    let currentObserverTarget = null;
    function startListObserver() {
        if (isReviewDetailPage()) return;
        const container = getQueueTable() || document.body;
        if (container !== currentObserverTarget) {
            listObserver.disconnect();
            listObserver.observe(container, { childList: true, subtree: true, characterData: true });
            currentObserverTarget = container;
        }
    }
    function checkListUrlChange() {
        const currentUrl = window.location.href;
        if (currentUrl !== lastKnownListUrl) {
            lastKnownListUrl = currentUrl;
            firstPageFetchAttempted = false;
            lastAnnotationSource = null;
            if (listAnnotationTimer) clearTimeout(listAnnotationTimer);
            listAnnotationTimer = setTimeout(() => {
                attemptFirstPageFetch();
                annotateQueueTable();
                listObserver.disconnect();
                currentObserverTarget = null;
                startListObserver();
                setTimeout(annotateQueueTable, 300);
            }, 150);
        }
    }
    setInterval(() => { attemptFirstPageFetch(); annotateQueueTable(); startListObserver(); }, 2000);
    setInterval(checkListUrlChange, 500);

    // =========================================================
    // CSV EXPORT / IMPORT (unchanged)
    // =========================================================
    function toCSV() {
        const db = getDatabase();
        if (db.length === 0) return '';
        const headers = ['Firstname', 'Lastname', 'Dept.', 'Row Contents', 'Unique ID'];
        const rows = db.map(e => [e.firstName, e.lastName, e.dept, e.rowContents, e.uniqueId]
            .map(v => `"${(v || '').replace(/"/g, '""')}"`).join(','));
        return [headers.join(','), ...rows].join('\n');
    }
    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
                    else { inQuotes = false; }
                } else { current += ch; }
            } else {
                if (ch === '"') inQuotes = true;
                else if (ch === ',') { result.push(current); current = ''; }
                else current += ch;
            }
        }
        result.push(current);
        return result;
    }

    // =========================================================
    // DATABASE UI (badge in header, section in settings pane — same
    // injection targets as the classic script, provided by UI-Perfection-v2)
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
        const settingsBtn = document.getElementById('elm-settings-btn');
        if (settingsBtn && settingsBtn.nextSibling) controlsWrapper.insertBefore(badge, settingsBtn.nextSibling);
        else controlsWrapper.appendChild(badge);
        updateDbSizeBadge();
    }
    function injectDbSettingsSection() {
        if (document.getElementById('elm-settings-db-section')) return;
        const settingsBody = document.querySelector('#elm-settings-pane .settings-body');
        if (!settingsBody) return;
        const section = document.createElement('div');
        section.id = 'elm-settings-db-section';
        section.innerHTML = `
            <div class="settings-section-title">Database</div>
            <button id="elm-settings-download-btn" class="settings-action-btn">⬇ Download Database</button>
            <button id="elm-settings-upload-btn" class="settings-action-btn">⬆ Upload &amp; Replace Database</button>
            <input type="file" id="elm-db-upload-input" accept=".csv">
            <button id="elm-settings-clear-btn" class="settings-action-btn danger">✖ Clear Database</button>
        `;
        settingsBody.appendChild(section);
        document.getElementById('elm-settings-download-btn').onclick = () => {
            const csvContent = toCSV();
            if (!csvContent) { alert('CSV Database is empty — no entries have been recorded yet.'); return; }
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `elm_csv_database_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };
        const uploadInput = document.getElementById('elm-db-upload-input');
        document.getElementById('elm-settings-upload-btn').onclick = () => uploadInput.click();
        uploadInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (!file.name.endsWith('.csv')) { alert('Please select a .csv file.'); uploadInput.value = ''; return; }
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const text = ev.target.result;
                    const lines = text.trim().split('\n');
                    if (lines.length < 2) { alert('CSV file is empty or has no data rows.'); uploadInput.value = ''; return; }
                    const entries = [];
                    for (let i = 1; i < lines.length; i++) {
                        const cols = parseCSVLine(lines[i]);
                        if (cols.length >= 5) entries.push({ firstName: cols[0], lastName: cols[1], dept: cols[2], rowContents: cols[3], uniqueId: cols[4] });
                    }
                    if (entries.length === 0) { alert('No valid entries found in CSV file.'); uploadInput.value = ''; return; }
                    if (!confirm(`Replace current database with ${entries.length} entries from "${file.name}"?`)) { uploadInput.value = ''; return; }
                    saveDatabase(entries);
                    updateDbSizeBadge();
                    clearStaleAnnotations();
                    annotateQueueTable();
                    alert(`Database replaced with ${entries.length} entries.`);
                } catch (err) {
                    alert('Error parsing CSV file: ' + err.message);
                }
                uploadInput.value = '';
            };
            reader.readAsText(file);
        };
        document.getElementById('elm-settings-clear-btn').onclick = () => {
            const db = getDatabase();
            if (db.length === 0) { alert('Database is already empty.'); return; }
            if (confirm(`Are you sure you want to delete all ${db.length} entries from the database? This cannot be undone.`)) {
                saveDatabase([]);
                updateDbSizeBadge();
                clearStaleAnnotations();
                alert('Database cleared.');
            }
        };
    }
    setInterval(() => { injectDbBadge(); injectDbSettingsSection(); }, 1000);

    // =========================================================
    // AUTO-RECORD: poll body[data-csv-dept] set by UI-Perfection-v2
    // =========================================================
    setInterval(() => {
        const dept = document.body.dataset.csvDept;
        if (dept) recordEntry(dept);
        updateDbSizeBadge();
    }, 1000);

    console.log('%cCSV Database (new layout) loaded — polls body[data-csv-dept]', 'color:#6a1b9a;font-weight:bold;');
})();
