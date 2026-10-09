// ==UserScript==
// @name         Element451 - CSV Database (New Deduplication Layout)
// @namespace    http://tampermonkey.net/
// @version      2.8
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

        /* Material 3 snackbar */
        #csv-api-toast {
            position: fixed; bottom: 16px; left: 16px; display: flex; align-items: center; gap: 12px;
            min-height: 48px; box-sizing: border-box; padding: 8px 16px 8px 12px; border-radius: 4px;
            background: #322f35; color: #f5eff7; font: 400 14px/20px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; letter-spacing: .25px;
            z-index: 9999; opacity: 0; transition: opacity .3s cubic-bezier(.2, 0, 0, 1);
            pointer-events: none; max-width: 340px;
            box-shadow: 0 1px 3px rgba(0,0,0,.3), 0 4px 8px 3px rgba(0,0,0,.15);
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

        /* tonal assist-chip style pill, matches the merge counter */
        #elm-db-size-badge { display: flex; align-items: center; height: 32px; box-sizing: border-box; padding: 0 12px; background: #e6e0e9; border: none; border-radius: 8px; white-space: nowrap; cursor: default; }
        #elm-db-size-label { font: 500 14px/20px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; letter-spacing: .1px; color: #1d1b20; padding: 0; }
        /* Material 3 buttons: Download/Upload are tonal, Clear is an outlined error button */
        .settings-action-btn {
            display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 40px; margin: 8px 0; padding: 0 24px; box-sizing: border-box;
            border: none; border-radius: 20px; background: #dce8f9; color: #0b2a4a;
            font: 500 14px/20px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; letter-spacing: .1px; cursor: pointer;
            transition: box-shadow .2s cubic-bezier(.2, 0, 0, 1), background-color .2s cubic-bezier(.2, 0, 0, 1);
        }
        .settings-action-btn:hover { box-shadow: 0 1px 2px rgba(0,0,0,.3), 0 1px 3px 1px rgba(0,0,0,.15); background: #d2e1f6; }
        .settings-action-btn:active { background: #c6d8f1; box-shadow: none; }
        .settings-action-btn:focus-visible { outline: 2px solid #1976d2; outline-offset: 2px; }
        .settings-action-btn.danger { background: transparent; border: 1px solid #79747e; color: #b3261e; }
        .settings-action-btn.danger:hover { background: rgba(179, 38, 30, .08); box-shadow: none; }
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
    // The review queue URL never changes per profile, so the database is keyed on
    // the Spark ID of each contact in the pair (Spark ID 1 = left/A, Spark ID 2 =
    // right/B), read from the "Spark Id: ..." diff row.
    function getDomSparkIds() {
        const re = /Spark Id:\s*([^\s,|]+)/i;
        const rows = document.querySelectorAll('elm-duplicate-field-diff-form .diff-row');
        for (const row of rows) {
            const btns = row.querySelectorAll(':scope > .diff-value-button');
            const l = btns[0] && btns[0].textContent.match(re);
            const r = btns[1] && btns[1].textContent.match(re);
            if (l || r) return { a: l ? l[1] : '', b: r ? r[1] : '' };
        }
        return { a: '', b: '' };
    }
    function sameSparkPair(e, a, b) {
        const x = [e.sparkId1 || '', e.sparkId2 || ''].filter(Boolean).sort().join('|');
        const y = [a, b].filter(Boolean).sort().join('|');
        return !!x && x === y;
    }
    function escRe(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function containsId(text, id) {
        return !!id && id.length >= 4 && new RegExp('(^|[^A-Za-z0-9])' + escRe(id) + '($|[^A-Za-z0-9])').test(text);
    }
    // Privacy: only the first 3 letters of the first and last name are ever stored.
    // A cut-off name is stored as "Jon..." so it reads as shortened; names of 3 letters
    // or fewer are kept as-is, and an already-shortened name is left alone.
    const ELLIPSIS = '...';
    function trunc3(t) {
        t = (t || '').trim();
        if (t.endsWith(ELLIPSIS)) return t;
        return t.length > 3 ? t.slice(0, 3) + ELLIPSIS : t;
    }
    function nameBase(t) { return (t || '').trim().replace(/\.\.\.$/, ''); }
    function needsShortening(t) { t = (t || '').trim(); return t.length > 3 && !t.endsWith(ELLIPSIS); }
    function maskNames(text, ...names) {
        let out = text || '';
        names.forEach(n => {
            n = (n || '').trim();
            if (n.length > 3) out = out.replace(new RegExp(escRe(n), 'gi'), trunc3(n));
        });
        return out;
    }
    // Both contacts' names (card A and card B), already cut to 3 letters, plus the
    // full text so it can be masked out of row contents. Contact 1 is the first
    // non-empty card, as before.
    function splitName(full) {
        const parts = (full || '').trim().split(/\s+/).filter(Boolean);
        return { first: parts[0] || '', last: parts.slice(1).join(' ') };
    }
    function extractNames() {
        const form = document.querySelector('elm-duplicate-field-diff-form');
        if (!form) return { firstName: '', lastName: '' };
        const nameEls = form.querySelectorAll('.contact-card-name');
        const n1 = splitName(nameEls[0] && nameEls[0].textContent);
        const n2 = splitName(nameEls[1] && nameEls[1].textContent);
        const c1 = n1.first ? n1 : n2;
        const c2 = n1.first ? n2 : { first: '', last: '' };
        return {
            firstName: trunc3(c1.first), lastName: trunc3(c1.last),
            firstName2: trunc3(c2.first), lastName2: trunc3(c2.last),
            full: [c1.first, c1.last, c2.first, c2.last]
        };
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
            const db = data ? JSON.parse(data) : [];
            // entries saved before name truncation existed are shortened (and re-saved) here
            let changed = false;
            db.forEach(e => {
                if ([e.firstName, e.lastName, e.firstName2, e.lastName2].some(needsShortening)) {
                    e.rowContents = maskNames(e.rowContents, e.firstName, e.lastName, e.firstName2, e.lastName2);
                    e.firstName = trunc3(e.firstName); e.lastName = trunc3(e.lastName); e.firstName2 = trunc3(e.firstName2); e.lastName2 = trunc3(e.lastName2);
                    changed = true;
                }
            });
            if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
            return db;
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
        const sparks = getDomSparkIds();
        if (!sparks.a && !sparks.b) return;
        // stale signal mid-navigation: the main script's Spark IDs must match the page
        if (document.body.dataset.csvSpark1 !== sparks.a || document.body.dataset.csvSpark2 !== sparks.b) return;
        const { firstName, lastName, firstName2, lastName2, full } = extractNames();
        if (!firstName && !lastName) return; // page content not ready
        const db = getDatabase();
        const rowContents = maskNames(getBlockedRowText(dept), ...full);
        const newEntry = { firstName, lastName, firstName2, lastName2, dept, rowContents, sparkId1: sparks.a, sparkId2: sparks.b };
        const existingIdx = db.findIndex(entry => sameSparkPair(entry, sparks.a, sparks.b));
        if (existingIdx !== -1) {
            const old = db[existingIdx];
            if (old.dept === dept && old.firstName === firstName && old.lastName === lastName
                && old.firstName2 === firstName2 && old.lastName2 === lastName2 && old.rowContents === rowContents
                && old.sparkId1 === sparks.a && old.sparkId2 === sparks.b) return;
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
    function startsWord(text, prefix) { return new RegExp('(^|[^a-z0-9])' + escRe(prefix)).test(text); }
    function matchRowToDbEntry(row, db, usedDbIndices) {
        const rowText = row.textContent.trim().toLowerCase();
        for (let i = 0; i < db.length; i++) {
            if (usedDbIndices.has(i)) continue;
            const entry = db[i];
            if (containsId(row.textContent, entry.sparkId1) || containsId(row.textContent, entry.sparkId2)) {
                usedDbIndices.add(i);
                return entry;
            }
            // The list rows don't show Spark IDs, so rows are matched on names. Only
            // 3-letter prefixes are stored, so require BOTH contacts of the pair (the
            // master and the duplicate columns) to match, not just one name.
            const has = (f, l) => f.length >= 2 && l.length >= 2 && startsWord(rowText, f) && startsWord(rowText, l);
            const f1 = nameBase(entry.firstName).toLowerCase(), l1 = nameBase(entry.lastName).toLowerCase();
            const f2 = nameBase(entry.firstName2).toLowerCase(), l2 = nameBase(entry.lastName2).toLowerCase();
            const second = f2 && l2;
            if (has(f1, l1) && (!second || has(f2, l2))) {
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
    // Collects Spark IDs from an API record, wherever they live: scalars under a key
    // containing "spark" (e.g. master.spark_id), and "Spark Id: <id>" text inside any
    // string value. Also records shapes (never real values) for diagnosis.
    const SPARK_TEXT = /spark[\s_-]*id\W{0,3}([A-Za-z0-9-]{4,})/gi;
    function sparkShape(str, idx) {
        // letters -> x, digits -> 9, except the word "spark"
        return str.slice(Math.max(0, idx - 15), idx + 40).replace(/spark/gi, '\u0001')
            .replace(/[A-Za-z]/g, 'x').replace(/\d/g, '9').replace(/\u0001/g, 'Spark');
    }
    function collectSparkIds(obj, path, out, found) {
        if (obj === null || typeof obj !== 'object') return;
        for (const k of Object.keys(obj)) {
            if (!path && (k === 'ai_analysis' || k === 'feedback')) continue; // free text, not profile data
            const v = obj[k];
            const here = (path ? path + '.' + k : k).replace(/\.\d+/g, '[]');
            if (/spark/i.test(k)) {
                (Array.isArray(v) ? v : [v]).forEach(x => {
                    if (typeof x === 'string' || typeof x === 'number') { out.push(String(x).trim()); found.keys.add(here); }
                });
            }
            // identities: [{ type: 'Spark_...', <value field>: '<id>' }] -> take the value from the siblings
            if (typeof v === 'string' && /^spark/i.test(v) && !Array.isArray(obj)) {
                found.ident.add(Object.keys(obj).join(', '));
                ['value', 'id', 'identifier', 'external_id', 'identity', 'key', 'number', 'code'].forEach(f => {
                    if (f !== k && (typeof obj[f] === 'string' || typeof obj[f] === 'number')) out.push(String(obj[f]).trim());
                });
            }
            if (typeof v === 'string' && /spark/i.test(v)) {
                let m;
                SPARK_TEXT.lastIndex = 0;
                while ((m = SPARK_TEXT.exec(v))) out.push(m[1]);
                if (found.text.size < 4) found.text.add(here + ' -> ' + sparkShape(v, v.search(/spark/i)));
            }
            if (v && typeof v === 'object') collectSparkIds(v, here, out, found);
        }
    }
    function parseApiEntries(entries) {
        const sample = entries[0];
        if (!sample || typeof sample !== 'object') return null;
        const idField = sample._id ? '_id' : sample.id ? 'id' : null;
        const found = { keys: new Set(), text: new Set(), ident: new Set() };
        const parsed = entries.map((e, i) => {
            const sparks = [];
            collectSparkIds(e, '', sparks, found);
            return {
                uniqueId: ((idField && e[idField]) || 'api-' + i).toString().toLowerCase(),
                name: e.name || e.full_name || '',
                duplicateName: e.duplicate_name || '',
                sparks: sparks.filter(Boolean),
                raw: JSON.stringify(e)
            };
        });
        // Diagnostics (paths and shapes only, never real values)
        console.log('CSV Database: Spark ID key fields in list API:', found.keys.size ? Array.from(found.keys).join(', ') : 'none',
            '| records with Spark IDs:', parsed.filter(x => x.sparks.length).length + '/' + parsed.length);
        if (found.ident.size) console.log('CSV Database: Spark identity object fields:', Array.from(found.ident).slice(0, 3));
        if (found.text.size) console.log('CSV Database: "spark" text in list API values (shape only):', Array.from(found.text));
        ['master', 'duplicate'].forEach(k => {
            if (sample[k] && typeof sample[k] === 'object') console.log('CSV Database: list API ' + k + ' fields:', Object.keys(sample[k]).join(', '));
        });
        return parsed;
    }
    // A list record matches a database entry when it carries all of the entry's
    // Spark IDs (both contacts of the pair; a contact can be in several pairs, so
    // one shared ID alone isn't enough when the entry has two).
    function dbEntryForApi(api, db) {
        if (!api) return null;
        for (const entry of db) {
            const ids = [entry.sparkId1, entry.sparkId2].filter(Boolean);
            if (!ids.length) continue;
            if (api.sparks.length) {
                if (ids.every(id => api.sparks.includes(id))) return entry;
            } else if (ids.some(id => containsId(api.raw, id))) {
                return entry;
            }
        }
        return null;
    }

    // Diagnostic: path + top-level key names only (no values, no query string).
    function logApiShape(url, data) {
        try {
            const path = String(url).split('?')[0].replace(/^https?:\/\/[^/]+/, '').replace(/[a-f0-9]{24}/gi, ':id');
            const top = Array.isArray(data) ? '[array of ' + data.length + ']' : Object.keys(data || {}).join(', ');
            console.log('CSV Database: saw API response', path, '| top-level:', top);
        } catch (e) { /* ignore */ }
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
                    logApiShape(this._csvDbUrl, data);
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
                        logApiShape(url, data);
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
                logApiShape(match.name, data);
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
        const usedApiIndices = new Set();
        const usedDbIndices = new Set();
        const indexFallbackSafe = apiDuplicatesList && rows.length === apiDuplicatesList.length;
        rows.forEach((row, rowIndex) => {
            let uniqueId = row.getAttribute('data-csv-uid');
            let api = uniqueId ? apiDuplicatesList.find(a => a.uniqueId === uniqueId) : null;
            if (!api && apiDuplicatesList) {
                api = matchRowToApiEntry(row, apiDuplicatesList, usedApiIndices);
                if (!api && indexFallbackSafe && apiDuplicatesList[rowIndex] && !usedApiIndices.has(rowIndex)) {
                    api = apiDuplicatesList[rowIndex];
                    usedApiIndices.add(rowIndex);
                }
                if (api) row.setAttribute('data-csv-uid', api.uniqueId);
            }
            // Spark ID found in the API record first; otherwise name/ID text on the row
            const dbEntry = dbEntryForApi(api, db) || matchRowToDbEntry(row, db, usedDbIndices);
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
        const headers = ['Firstname', 'Lastname', 'Firstname 2', 'Lastname 2', 'Dept.', 'Row Contents', 'Spark ID 1', 'Spark ID 2'];
        const rows = db.map(e => [e.firstName, e.lastName, e.firstName2, e.lastName2, e.dept, e.rowContents, e.sparkId1, e.sparkId2]
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
                    // Columns are found by header name, so files exported by any earlier
                    // version (different column order, or the old 5-column "Unique ID"
                    // format with no Spark IDs) still import.
                    const header = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
                    const col = (name, fallback) => { const i = header.indexOf(name); return i !== -1 ? i : fallback; };
                    const idx = {
                        first: col('firstname', 0), last: col('lastname', 1),
                        first2: col('firstname 2', -1), last2: col('lastname 2', -1),
                        dept: col('dept.', 2), rows: col('row contents', 3),
                        s1: col('spark id 1', -1), s2: col('spark id 2', -1)
                    };
                    const get = (cols, i) => (i >= 0 && i < cols.length ? cols[i] : '');
                    for (let i = 1; i < lines.length; i++) {
                        const cols = parseCSVLine(lines[i]);
                        if (cols.length < 4) continue;
                        entries.push({
                            firstName: trunc3(get(cols, idx.first)), lastName: trunc3(get(cols, idx.last)),
                            firstName2: trunc3(get(cols, idx.first2)), lastName2: trunc3(get(cols, idx.last2)),
                            dept: get(cols, idx.dept), rowContents: get(cols, idx.rows),
                            sparkId1: get(cols, idx.s1), sparkId2: get(cols, idx.s2)
                        });
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

    console.log('%cCSV Database (new layout) v2.8 loaded — polls body[data-csv-dept]', 'color:#6a1b9a;font-weight:bold;');
})();
