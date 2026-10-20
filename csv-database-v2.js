// ==UserScript==
// @name         Element451 - CSV Database (New Deduplication Layout)
// @namespace    http://tampermonkey.net/
// @version      2.29
// @description  Tracks duplicate entries in a database stored in browser localStorage (exports an .ods spreadsheet) — adapted for the redesigned Deduplication review-queue UI
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
    const UI_KEY = 'elm_show_db_ui';
    function showDbUi() { try { return localStorage.getItem(UI_KEY) !== 'false'; } catch (e) { return true; } }
    function applyDbUiSetting() { if (document.body) document.body.classList.toggle('csv-db-ui-off', !showDbUi()); }

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
        /* right-align the badges so they line up down the column whatever their width:
           the badge's parent becomes a flex row and the badge takes the free space on its left
           (float covers a parent that stays a block) */
        :has(> .csv-dept-badge) { display: flex; align-items: center; }
        .csv-dept-badge { margin-left: auto; float: right; }
        .csv-dept-badge[data-dept="Grad/IA"]      { background: #e3f2fd; color: #1565c0; }
        .csv-dept-badge[data-dept="UnderGrad"]    { background: #f3e5f5; color: #6a1b9a; }
        .csv-dept-badge[data-dept="Forbidden"]    { background: #fce4ec; color: #c2185b; }
        .csv-dept-badge[data-dept="Appeal"]       { background: #fff8e1; color: #f57f17; }
        .csv-dept-badge[data-dept="Ignored"]      { background: #f5f5f5; color: #616161; }

        /* Shared toast stack (same rules as in the main script; whichever loads first creates it) */
        #elm2-toast-stack { position: fixed; left: 16px; bottom: 16px; z-index: 10000; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
        .elm2-toast { display: flex; align-items: center; gap: 12px; box-sizing: border-box; min-height: 48px; max-width: 340px; padding: 8px 16px 8px 12px; border-radius: 4px; background: #2f3236; color: #f1f3f7; font: 400 14px/20px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; letter-spacing: .25px; box-shadow: 0 1px 3px rgba(0,0,0,.3), 0 4px 8px 3px rgba(0,0,0,.15); opacity: 0; transform: translateY(8px); transition: opacity .25s cubic-bezier(.2, 0, 0, 1), transform .25s cubic-bezier(.2, 0, 0, 1); }
        .elm2-toast.visible { opacity: 1; transform: none; }
        .csv-toast-dot { position: relative; width: 18px; height: 18px; flex-shrink: 0; }
        .csv-toast-dot-inner { position: absolute; top: 50%; left: 50%; width: 8px; height: 8px; border-radius: 50%; transform: translate(-50%, -50%); }
        .csv-toast-dot-outer { position: absolute; top: 50%; left: 50%; width: 16px; height: 16px; border-radius: 50%; transform: translate(-50%, -50%); animation: csvPulse 1.8s ease-in-out infinite; }
          .csv-toast.success .csv-toast-dot-inner { background: #2e7d32; }
          .csv-toast.success .csv-toast-dot-outer { background: rgba(46, 125, 50, 0.3); }
          .csv-toast.fallback .csv-toast-dot-inner { background: #e65100; }
          .csv-toast.fallback .csv-toast-dot-outer { background: rgba(230, 81, 0, 0.3); }
          .csv-toast.error .csv-toast-dot-inner { background: #c62828; }
          .csv-toast.error .csv-toast-dot-outer { background: rgba(198, 40, 40, 0.3); }
        @keyframes csvPulse { 0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.6; } 50% { transform: translate(-50%, -50%) scale(1.5); opacity: 0.2; } }

        /* tonal assist-chip style pill, matches the merge counter */
        #elm-db-size-badge { display: flex; align-items: center; height: 32px; box-sizing: border-box; padding: 0 12px; background: #e6e1db; border: none; border-radius: 8px; white-space: nowrap; cursor: default; }
        #elm-db-size-label { font: 500 14px/20px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; letter-spacing: .1px; color: #1a1c20; padding: 0; }
        /* Material 3 buttons: Download/Upload are tonal, Clear is an outlined error button */
        .settings-action-btn {
            display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 40px; margin: 8px 0; padding: 0 24px; box-sizing: border-box;
            border: none; border-radius: 20px; background: var(--md-primary-container, #fde3cc); color: var(--md-on-primary-container, #5a2800);
            font: 500 14px/20px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; letter-spacing: .1px; cursor: pointer;
            transition: box-shadow .2s cubic-bezier(.2, 0, 0, 1), background-color .2s cubic-bezier(.2, 0, 0, 1);
        }
        .settings-action-btn:hover { box-shadow: 0 1px 2px rgba(0,0,0,.3), 0 1px 3px 1px rgba(0,0,0,.15); background: color-mix(in srgb, var(--md-primary, #ef6c00) 24%, #fff); }
        .settings-action-btn:active { background: color-mix(in srgb, var(--md-primary, #ef6c00) 30%, #fff); box-shadow: none; }
        .settings-action-btn:focus-visible { outline: 2px solid var(--md-primary, #ef6c00); outline-offset: 2px; }
        .settings-action-btn.danger { background: transparent; border: 1px solid #73777f; color: #b3261e; }
        .settings-action-btn.danger:hover { background: rgba(179, 38, 30, .08); box-shadow: none; }
        #elm-db-upload-input { display: none; }
        /* "Show Database UI" off: hide the header counter and the list-view chips only */
        body.csv-db-ui-off #elm-db-size-badge, body.csv-db-ui-off .csv-dept-badge { display: none !important; }
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
        if (!dept) return false;
        const sparks = getDomSparkIds();
        if (!sparks.a && !sparks.b) return false;
        // stale signal mid-navigation: the main script's Spark IDs must match the page
        if (document.body.dataset.csvSpark1 !== sparks.a || document.body.dataset.csvSpark2 !== sparks.b) return false;
        const { firstName, lastName, firstName2, lastName2, full } = extractNames();
        if (!firstName && !lastName) return false; // page content not ready
        const db = getDatabase();
        const rowContents = maskNames(getBlockedRowText(dept), ...full);
        const existingIdx = db.findIndex(entry => sameSparkPair(entry, sparks.a, sparks.b));
        const old = existingIdx !== -1 ? db[existingIdx] : null;
        // Merged (Y/N) and "Script vs Bolt" come from the main script: the choice is what it chose over Bolt on
        // the pair on screen; Merged turns Y when the merge is confirmed (see 'elm2-pair-merged' below).
        const merged = old && old.merged === 'Y' ? 'Y' : 'N';
        // Script vs Bolt is only kept for a merged pair (it is filled in by the 'elm2-pair-merged' event below)
        const choice = merged === 'Y' ? (old.choice || '') : '';
        const newEntry = { firstName, lastName, firstName2, lastName2, dept, rowContents, sparkId1: sparks.a, sparkId2: sparks.b, merged, choice };
        if (old && old.lostSpark) newEntry.lostSpark = old.lostSpark;
        if (old) {
            if (old.dept === dept && old.firstName === firstName && old.lastName === lastName
                && old.firstName2 === firstName2 && old.lastName2 === lastName2 && old.rowContents === rowContents
                && old.sparkId1 === sparks.a && old.sparkId2 === sparks.b
                && (old.merged || '') === merged && (old.choice || '') === choice) return true;
            db[existingIdx] = newEntry;
            saveDatabase(db);
            return true;
        }
        db.push(newEntry);
        saveDatabase(db);
        return true;
    }
    // The main script asks for the current pair to be recorded right before it skips it, so a
    // fast skip can't beat the 1-second poll. It keeps asking until this reports success.
    document.addEventListener('elm2-record-pair', (e) => {
        if (!e.detail) return;
        e.detail.handled = true;
        e.detail.recorded = recordEntry(document.body.dataset.csvDept);
    });

    // The main script reports a confirmed merge (the Merge completed card): the pair's entry gets Merged = Y
    // and the "Script vs Bolt" line worked out at the Merge click.
    document.addEventListener('elm2-pair-merged', (e) => {
        const d = e.detail;
        if (!d) return;
        const db = getDatabase();
        const idx = db.findIndex(entry => sameSparkPair(entry, d.a || '', d.b || ''));
        if (idx === -1) { console.log('[csv] merged pair is not in the database:', d.a, d.b); return; }
        db[idx].merged = 'Y';
        if (d.choice) db[idx].choice = d.choice;
        if (d.lost) db[idx].lostSpark = d.lost; // the Spark ID merged away: struck through in the export
        saveDatabase(db);
    });

    // =========================================================
    // API STATUS TOAST
    // =========================================================
    // Shared toast stack with the main script (bottom-left, newest at the bottom, stacks upward).
    function toastStack() {
        let st = document.getElementById('elm2-toast-stack');
        if (!st) { st = document.createElement('div'); st.id = 'elm2-toast-stack'; document.body.appendChild(st); }
        return st;
    }
    function showApiToast(message, type) {
        if (!SHOW_API_STATUS_TOAST) return;
        const st = toastStack();
        // the same message again just refreshes the existing toast instead of stacking a copy
        let el = Array.from(st.children).find(c => c.dataset.key === 'csv:' + message);
        if (!el) {
            el = document.createElement('div');
            el.dataset.key = 'csv:' + message;
            st.appendChild(el);
            requestAnimationFrame(() => el.classList.add('visible'));
            while (st.children.length > 4) st.firstChild.remove();
        }
        el.className = 'elm2-toast csv-toast ' + type + ' visible';
        el.innerHTML =
            '<span class="csv-toast-dot"><span class="csv-toast-dot-outer"></span><span class="csv-toast-dot-inner"></span></span>' +
            '<span class="csv-toast-text"></span>';
        el.querySelector('.csv-toast-text').textContent = message;
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 250); }, 4000);
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
        // The list URL no longer changes per page, so a page change can't be detected from it any
        // more. Each capture of fresh list data is the signal instead: toast every time.
        if (!isReviewDetailPage()) {
            lastAnnotationSource = 'api';
            showApiToast('API: data captured successfully', 'success');
        }
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
    // string value.
    const SPARK_TEXT = /spark[\s_-]*id\W{0,3}([A-Za-z0-9-]{4,})/gi;
    function collectSparkIds(obj, path, out) {
        if (obj === null || typeof obj !== 'object') return;
        for (const k of Object.keys(obj)) {
            if (!path && (k === 'ai_analysis' || k === 'feedback')) continue; // free text, not profile data
            const v = obj[k];
            const here = (path ? path + '.' + k : k).replace(/\.\d+/g, '[]');
            if (/spark/i.test(k)) {
                (Array.isArray(v) ? v : [v]).forEach(x => {
                    if (typeof x === 'string' || typeof x === 'number') { out.push(String(x).trim()); }
                });
            }
            // identities: [{ type: 'Spark_...', <value field>: '<id>' }] -> take the value from the siblings
            if (typeof v === 'string' && /^spark/i.test(v) && !Array.isArray(obj)) {
                ['value', 'id', 'identifier', 'external_id', 'identity', 'key', 'number', 'code'].forEach(f => {
                    if (f !== k && (typeof obj[f] === 'string' || typeof obj[f] === 'number')) out.push(String(obj[f]).trim());
                });
            }
            if (typeof v === 'string' && /spark/i.test(v)) {
                let m;
                SPARK_TEXT.lastIndex = 0;
                while ((m = SPARK_TEXT.exec(v))) out.push(m[1]);
            }
            if (v && typeof v === 'object') collectSparkIds(v, here, out);
        }
    }
    function parseApiEntries(entries) {
        const sample = entries[0];
        if (!sample || typeof sample !== 'object') return null;
        const idField = sample._id ? '_id' : sample.id ? 'id' : null;
        const parsed = entries.map((e, i) => {
            const sparks = [];
            collectSparkIds(e, '', sparks);
            return {
                uniqueId: ((idField && e[idField]) || 'api-' + i).toString().toLowerCase(),
                name: e.name || e.full_name || '',
                duplicateName: e.duplicate_name || '',
                sparks: sparks.filter(Boolean),
                raw: JSON.stringify(e)
            };
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
                    if (!/duplicate|dedup/i.test(this._csvDbUrl) || /\/duplicates\/history(\?|$)/.test(this._csvDbUrl)) return;
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
                    if (!url || !/duplicate|dedup/i.test(url) || /\/duplicates\/history(\?|$)/.test(url)) return response;
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
            const match = entries.slice().reverse().find(e => /duplicate|dedup/i.test(e.name) && !/\/duplicates\/history(\?|$)/.test(e.name) && !e.name.match(/\/duplicates?\/[a-f0-9]{24}/i));
            if (!match) return;
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
    // EXPORT / IMPORT: an .ods spreadsheet (column widths, bold header, filter buttons on every
    // column); .csv files from earlier versions still import.
    // =========================================================
    // Columns in file order. Dept. and Merged are side by side (they are the two columns with filter buttons);
    // Merged and Script vs Bolt sit between Spark ID 2 and Row Contents.
    // width is in cm, as the spreadsheet stores it (the columns can be resized there).
    const DB_COLUMNS = [
        { header: 'Firstname', key: 'firstName', width: 2.6 },
        { header: 'Lastname', key: 'lastName', width: 2.6 },
        { header: 'Firstname 2', key: 'firstName2', width: 2.6 },
        { header: 'Lastname 2', key: 'lastName2', width: 2.6 },
        { header: 'Spark ID 1', key: 'sparkId1', width: 3.8 },
        { header: 'Spark ID 2', key: 'sparkId2', width: 3.8 },
        { header: 'Dept.', key: 'dept', width: 2.8 },
        { header: 'Merged', key: 'merged', width: 2.2 },
        { header: 'Script vs Bolt', key: 'choice', width: 9 },
        { header: 'Row Contents', key: 'rowContents', width: 15 }
    ];
    // Each data row carries .struck, the set of column indexes to strike through: the Spark ID that was merged
    // away (lostSpark) when the pair was merged.
    function dbRows(db) {
        const rows = db.map(e => {
            // Script vs Bolt is only exported for a merged pair
            const r = DB_COLUMNS.map(c => String((c.key === 'choice' && e.merged !== 'Y') ? '' : (e[c.key] || '')));
            r.struck = new Set();
            DB_COLUMNS.forEach((c, i) => { if ((c.key === 'sparkId1' || c.key === 'sparkId2') && e.lostSpark && r[i] === e.lostSpark) r.struck.add(i); });
            return r;
        });
        return [DB_COLUMNS.map(c => c.header), ...rows];
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
    // Rows (first = header) -> database entries. Columns are found by header name, so files exported by any
    // earlier version (different column order, no Merged / Script vs Bolt, or the old 5-column "Unique ID"
    // format with no Spark IDs) still import.
    function entriesFromRows(rows) {
        if (rows.length < 2) return [];
        const header = rows[0].map(h => String(h).trim().toLowerCase());
        const col = (name, fallback) => { const i = header.indexOf(name); return i !== -1 ? i : fallback; };
        const idx = {
            first: col('firstname', 0), last: col('lastname', 1),
            first2: col('firstname 2', -1), last2: col('lastname 2', -1),
            dept: col('dept.', 2), rows: col('row contents', 3),
            s1: col('spark id 1', -1), s2: col('spark id 2', -1),
            merged: col('merged', -1), choice: col('script vs bolt', -1)
        };
        const get = (cols, i) => (i >= 0 && i < cols.length ? String(cols[i] == null ? '' : cols[i]) : '');
        const entries = [];
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i];
            if (cols.length < 4) continue;
            const m = get(cols, idx.merged).trim().toUpperCase().charAt(0);
            const lost = cols.struck && cols.struck.has(idx.s1) ? get(cols, idx.s1) : cols.struck && cols.struck.has(idx.s2) ? get(cols, idx.s2) : '';
            entries.push({
                firstName: trunc3(get(cols, idx.first)), lastName: trunc3(get(cols, idx.last)),
                firstName2: trunc3(get(cols, idx.first2)), lastName2: trunc3(get(cols, idx.last2)),
                dept: get(cols, idx.dept), rowContents: get(cols, idx.rows),
                sparkId1: get(cols, idx.s1), sparkId2: get(cols, idx.s2),
                merged: m === 'Y' || m === 'N' ? m : '', choice: m === 'Y' ? get(cols, idx.choice) : '',
                ...(lost ? { lostSpark: lost } : {})
            });
        }
        return entries;
    }

    // ---- minimal ZIP (stored, no compression) writer and reader: an .ods is a zip of XML files
    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
        return t;
    })();
    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    // files: [{ name, text }] in the order given (the ODF mimetype file must be first)
    function zipStore(files) {
        const enc = new TextEncoder();
        const now = new Date();
        const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
        const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
        const parts = [], central = [];
        let offset = 0;
        files.forEach(f => {
            const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
            const lh = new DataView(new ArrayBuffer(30));
            lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
            lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
            lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
            parts.push(new Uint8Array(lh.buffer), name, data);
            const ch = new DataView(new ArrayBuffer(46));
            ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
            ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
            ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
            ch.setUint32(42, offset, true);
            central.push(new Uint8Array(ch.buffer), name);
            offset += 30 + name.length + data.length;
        });
        const cdSize = central.reduce((n, a) => n + a.length, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
        end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
        return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.oasis.opendocument.spreadsheet' });
    }
    // Reads one file out of a zip (stored or deflated) as text.
    async function zipReadText(buf, wanted) {
        const v = new DataView(buf), u8 = new Uint8Array(buf);
        let eocd = -1;
        for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) { if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
        if (eocd < 0) throw new Error('not a zip file');
        const count = v.getUint16(eocd + 10, true);
        let p = v.getUint32(eocd + 16, true);
        for (let n = 0; n < count; n++) {
            if (v.getUint32(p, true) !== 0x02014b50) break;
            const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
            const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
            const local = v.getUint32(p + 42, true);
            const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
            if (name === wanted) {
                const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
                const raw = u8.subarray(start, start + csize);
                if (method === 0) return new TextDecoder().decode(raw);
                if (method !== 8) throw new Error('unsupported zip compression');
                const out = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
                return new TextDecoder().decode(out);
            }
            p += 46 + nameLen + extraLen + commentLen;
        }
        throw new Error(wanted + ' not found in the file');
    }

    // ---- the spreadsheet itself
    const NS = {
        office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0', table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
        text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
    };
    const xmlEsc = (t) => String(t).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    function odsCell(value, style) {
        const attrs = style ? ' table:style-name="' + style + '"' : '';
        if (value === '') return '<table:table-cell' + attrs + '/>';
        // text never wraps, but a value that already has line breaks keeps them (one paragraph per line)
        const paras = String(value).split(/\r?\n/).map(l => '<text:p>' + xmlEsc(l) + '</text:p>').join('');
        return '<table:table-cell' + attrs + ' office:value-type="string" calcext:value-type="string">' + paras + '</table:table-cell>';
    }
    function buildOds(rows) {
        const ns = 'xmlns:office="' + NS.office + '" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="' + NS.text + '" xmlns:table="' + NS.table +
            '" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:calcext="urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0"';
        const colStyles = DB_COLUMNS.map((c, i) => '<style:style style:name="co' + i + '" style:family="table-column"><style:table-column-properties style:column-width="' + c.width + 'cm"/></style:style>').join('');
        const cellStyles =
            '<style:style style:name="head" style:family="table-cell"><style:table-cell-properties fo:background-color="#fde3cc" fo:padding="0.1cm" fo:wrap-option="no-wrap" style:vertical-align="middle"/><style:text-properties fo:font-weight="bold"/></style:style>' +
            '<style:style style:name="lost" style:family="table-cell"><style:table-cell-properties fo:wrap-option="no-wrap" style:vertical-align="middle"/><style:text-properties style:text-line-through-style="solid" style:text-line-through-type="single" fo:color="#8a8a8a"/></style:style>' +
            '<style:style style:name="body" style:family="table-cell"><style:table-cell-properties fo:wrap-option="no-wrap" style:vertical-align="middle"/></style:style>';
        const body = rows.map((r, ri) => '<table:table-row>' + DB_COLUMNS.map((c, ci) => odsCell(r[ci] == null ? '' : r[ci], ri === 0 ? 'head' : (r.struck && r.struck.has(ci) ? 'lost' : 'body'))).join('') + '</table:table-row>').join('');
        // Filter buttons on Dept. and Merged only: the filter range spans just those two columns.
        const colLetter = (key) => String.fromCharCode(65 + DB_COLUMNS.findIndex(c => c.key === key));
        const filterRange = colLetter('dept') + '1:' + colLetter('merged') + rows.length;
        const content = '<?xml version="1.0" encoding="UTF-8"?><office:document-content ' + ns + ' office:version="1.2">' +
            '<office:automatic-styles>' + colStyles + cellStyles + '</office:automatic-styles>' +
            '<office:body><office:spreadsheet><table:table table:name="Database">' +
            DB_COLUMNS.map((c, i) => '<table:table-column table:style-name="co' + i + '"/>').join('') + body + '</table:table>' +
            '<table:database-ranges><table:database-range table:name="__Anonymous_Sheet_DB__0" table:target-range-address="Database.' + filterRange.replace(':', ':Database.') + '" table:display-filter-buttons="true"/></table:database-ranges>' +
            '</office:spreadsheet></office:body></office:document-content>';
        const manifest = '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
            '<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>' +
            '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
            '<manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/></manifest:manifest>';
        // View settings: the header row is frozen (a vertical split below row 1) so it stays put when scrolling.
        const item = (name, type, val) => '<config:config-item config:name="' + name + '" config:type="' + type + '">' + val + '</config:config-item>';
        const settings = '<?xml version="1.0" encoding="UTF-8"?><office:document-settings xmlns:office="' + NS.office + '" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" office:version="1.2">' +
            '<office:settings><config:config-item-set config:name="ooo:view-settings"><config:config-item-map-indexed config:name="Views"><config:config-item-map-entry>' +
            item('ViewId', 'string', 'view1') +
            '<config:config-item-map-named config:name="Tables"><config:config-item-map-entry config:name="Database">' +
            item('HorizontalSplitMode', 'short', 0) + item('VerticalSplitMode', 'short', 2) + item('HorizontalSplitPosition', 'int', 0) + item('VerticalSplitPosition', 'int', 1) +
            item('ActiveSplitRange', 'short', 2) + item('PositionLeft', 'int', 0) + item('PositionRight', 'int', 0) + item('PositionTop', 'int', 0) + item('PositionBottom', 'int', 1) +
            '</config:config-item-map-entry></config:config-item-map-named>' +
            item('ActiveTable', 'string', 'Database') +
            '</config:config-item-map-entry></config:config-item-map-indexed></config:config-item-set></office:settings></office:document-settings>';
        return zipStore([
            { name: 'mimetype', text: 'application/vnd.oasis.opendocument.spreadsheet' },
            { name: 'META-INF/manifest.xml', text: manifest },
            { name: 'content.xml', text: content },
            { name: 'settings.xml', text: settings }
        ]);
    }
    function odsRows(xml) {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error('the spreadsheet could not be read');
        const sheet = doc.getElementsByTagNameNS(NS.table, 'table')[0];
        if (!sheet) throw new Error('no sheet found');
        // cell styles with a strike-through (the merged-away Spark ID), by style name
        const STYLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
        const struckStyles = new Set();
        Array.from(doc.getElementsByTagNameNS(STYLE_NS, 'style')).forEach(st => {
            Array.from(st.getElementsByTagNameNS(STYLE_NS, 'text-properties')).forEach(tp => {
                const v = tp.getAttributeNS(STYLE_NS, 'text-line-through-style');
                if (v && v !== 'none') struckStyles.add(st.getAttributeNS(STYLE_NS, 'name'));
            });
        });
        const rows = [];
        Array.from(sheet.getElementsByTagNameNS(NS.table, 'table-row')).forEach(tr => {
            const cells = [];
            cells.struck = new Set();
            Array.from(tr.children).forEach(td => {
                if (td.localName !== 'table-cell' && td.localName !== 'covered-table-cell') return;
                if (struckStyles.has(td.getAttributeNS(NS.table, 'style-name'))) cells.struck.add(cells.length);
                const text = Array.from(td.getElementsByTagNameNS(NS.text, 'p')).map(p => p.textContent).join('\n');
                const rep = Math.min(parseInt(td.getAttributeNS(NS.table, 'number-columns-repeated'), 10) || 1, text ? 50 : 1);
                for (let k = 0; k < rep; k++) cells.push(text);
            });
            while (cells.length && cells[cells.length - 1] === '') cells.pop();
            if (cells.length) rows.push(cells);
        });
        return rows;
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
            <button id="elm-settings-download-btn" class="settings-action-btn"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg> Download Database</button>
            <button id="elm-settings-upload-btn" class="settings-action-btn"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M5 20h14v-2H5v2zm0-10h4v6h6v-6h4l-7-7-7 7z"/></svg> Upload &amp; Replace Database</button>
            <input type="file" id="elm-db-upload-input" accept=".ods,.csv">
            <button id="elm-settings-clear-btn" class="settings-action-btn danger"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg> Clear Database</button>
        `;
        settingsBody.appendChild(section);
        document.getElementById('elm-settings-download-btn').onclick = () => {
            const db = getDatabase();
            if (db.length === 0) { alert('The database is empty — no entries have been recorded yet.'); return; }
            const blob = buildOds(dbRows(db));
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `elm_database_${new Date().toISOString().slice(0, 10)}.ods`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };
        const uploadInput = document.getElementById('elm-db-upload-input');
        document.getElementById('elm-settings-upload-btn').onclick = () => uploadInput.click();
        uploadInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const lower = file.name.toLowerCase();
            try {
                let rows;
                if (lower.endsWith('.ods')) rows = odsRows(await zipReadText(await file.arrayBuffer(), 'content.xml'));
                else if (lower.endsWith('.csv')) rows = (await file.text()).trim().split('\n').map(l => parseCSVLine(l.replace(/\r$/, '')));
                else { alert('Please select an .ods or .csv file.'); uploadInput.value = ''; return; }
                if (rows.length < 2) { alert('The file is empty or has no data rows.'); uploadInput.value = ''; return; }
                const entries = entriesFromRows(rows);
                if (entries.length === 0) { alert('No valid entries found in the file.'); uploadInput.value = ''; return; }
                if (!confirm(`Replace current database with ${entries.length} entries from "${file.name}"?`)) { uploadInput.value = ''; return; }
                saveDatabase(entries);
                updateDbSizeBadge();
                clearStaleAnnotations();
                annotateQueueTable();
                alert(`Database replaced with ${entries.length} entries.`);
            } catch (err) {
                alert('Error reading the file: ' + err.message);
            }
            uploadInput.value = '';
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
    // "Show Database UI" lives under Display, right after the "Highlight Rows" toggle.
    function injectDbUiToggle() {
        if (document.getElementById('elm-show-db-ui')) return;
        const highlight = document.getElementById('elm-highlight-rows');
        const anchor = highlight && highlight.closest('.setting-row');
        if (!anchor) return;
        const row = document.createElement('div');
        row.className = 'setting-row';
        row.innerHTML = '<label>Show Database UI</label><label class="elm-toggle-switch"><input type="checkbox" id="elm-show-db-ui"><span class="elm-toggle-slider"></span></label>';
        anchor.insertAdjacentElement('afterend', row);
        const uiToggle = document.getElementById('elm-show-db-ui');
        uiToggle.checked = showDbUi();
        uiToggle.addEventListener('change', () => {
            try { localStorage.setItem(UI_KEY, String(uiToggle.checked)); } catch (e) { /* ignore */ }
            applyDbUiSetting();
        });
    }
    setInterval(() => { applyDbUiSetting(); injectDbBadge(); injectDbSettingsSection(); injectDbUiToggle(); }, 1000);

    // =========================================================
    // AUTO-RECORD: poll body[data-csv-dept] set by UI-Perfection-v2
    // =========================================================
    setInterval(() => {
        const dept = document.body.dataset.csvDept;
        if (dept) recordEntry(dept);
        updateDbSizeBadge();
    }, 1000);

    console.log('%cCSV Database (new layout) v2.29 loaded — polls body[data-csv-dept]', 'color:#6a1b9a;font-weight:bold;');
})();
