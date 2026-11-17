// ==UserScript==
// @name         Element451 - Database v2
// @namespace    http://tampermonkey.net/
// @version      2.69
// @description  Tracks duplicate entries in a database stored in browser localStorage (exports a password-protected .xlsx spreadsheet to share, or a personal .elmdb file locked to your Element451 login) — adapted for the redesigned Deduplication review-queue UI
// @author       You
// @match        https://*.element451.io/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/totallygeekdom/csusb-de-dup-extension/main/database-v2.js
// @downloadURL  https://raw.githubusercontent.com/totallygeekdom/csusb-de-dup-extension/main/database-v2.js
// ==/UserScript==
(function () {
    'use strict';
    // Runs once per page even if it is installed twice (e.g. in Tampermonkey and in the Chrome extension).
    if (window.__elm451CsvDatabaseLoaded) return;
    window.__elm451CsvDatabaseLoaded = true;

    const VERSION = '2.69'; // keep in sync with @version (the build checks it)
    const STORAGE_KEY = 'elm_csv_database';
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
        #elm-db-size-badge { order: 1; display: flex; align-items: center; gap: 8px; height: 36px; box-sizing: border-box; padding: 0 16px 0 4px; background: var(--md-primary-container, #fde3cc); border: none; border-radius: 18px; white-space: nowrap; cursor: default; }
        /* with the merge counter showing, the two form one pair: big outer corners, small inner ones */
        #elm-controls-wrapper:has(#elm-counter-wrapper) #elm-db-size-badge { border-radius: 18px 4px 4px 18px; }
        #elm-db-size-icon { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--md-primary, #ef6c00); color: #fff; }
        #elm-db-size-icon svg { width: 16px; height: 16px; }
        #elm-db-size-label b { font-weight: 700; font-size: 15px; font-variant-numeric: tabular-nums; }
        #elm-db-size-label { font: 500 14px/20px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; letter-spacing: .1px; color: var(--md-on-primary-container, #5a2800); padding: 0; }
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
        /* the Database section's buttons as M3 Expressive list rows: separate containers 2px apart, large outer corners */
        #elm-settings-db-section { display: flex; flex-direction: column; gap: 2px; }
        #elm-settings-db-section .settings-action-btn { justify-content: flex-start; height: 56px; margin: 0; padding: 0 16px; border: none; border-radius: 6px; background: var(--md-item-container, #fffbf8); color: var(--md-on-surface, #1a1c20); box-shadow: none; }
        #elm-settings-db-section .settings-action-btn:first-of-type { border-radius: 20px 20px 6px 6px; }
        #elm-settings-db-section .settings-action-btn:last-of-type { border-radius: 6px 6px 20px 20px; }
        #elm-settings-db-section .settings-action-btn:hover { background: color-mix(in srgb, var(--md-primary, #ef6c00) 8%, var(--md-item-container, #fffbf8)); box-shadow: none; }
        #elm-settings-db-section .settings-action-btn svg { color: var(--md-primary-text, #b34e00); }
        #elm-settings-db-section .settings-action-btn.danger { color: var(--md-error, #b3261e); }
        #elm-settings-db-section .settings-action-btn.danger svg { color: inherit; }
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
    // Is the merge panel (the review sidebar) open? The diff form can be missing for a moment while the panel
    // loads or moves on to the next pair, so the sidebar itself counts too, as long as it is on screen.
    function mergePanelOpen() {
        if (isReviewDetailPage()) return true;
        const sb = document.querySelector('elm-review-duplicates-sidebar');
        if (!sb) return false;
        const r = sb.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth;
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
    // Tolerant of the colon, the capitalisation and the spacing; a row labelled "Spark Id" that holds just the value works too
    // (the main script reads it the same way).
    const SPARK_RE = /spark[\s_-]*id\s*[:=]?\s*([^\s,|:=]+)/i;
    function sparkFrom(text, label) {
        const m = (text || '').match(SPARK_RE);
        if (m) return m[1];
        const v = (text || '').trim();
        return /^spark[\s_-]*id\s*:?$/i.test((label || '').trim()) && /^[^\s,|]{3,}$/.test(v) ? v : '';
    }
    function getDomSparkIds() {
        const rows = document.querySelectorAll('elm-duplicate-field-diff-form .diff-row');
        for (const row of rows) {
            const btns = row.querySelectorAll('.diff-value-button'); // the value buttons sit in <div class="diff-value"> wrappers now
            const title = row.querySelector(':scope > .diff-title');
            const label = title ? title.textContent : '';
            const l = sparkFrom(btns[0] && btns[0].textContent, label), r = sparkFrom(btns[1] && btns[1].textContent, label);
            if (l || r) return { a: l, b: r };
        }
        return { a: '', b: '' };
    }
    function sameSparkPair(e, a, b) {
        const x = [e.sparkId1 || '', e.sparkId2 || ''].filter(Boolean).sort().join('|');
        const y = [a, b].filter(Boolean).sort().join('|');
        return !!x && x === y;
    }
    // The key of a pair of Spark IDs (unordered), as sameSparkPair compares them; '' when there are none.
    function pairKey(a, b) { return [a || '', b || ''].filter(Boolean).sort().join('|'); }
    // Lookup tables over the cached database, built the first time they are needed after a change (a list page asks for 50 rows, a row against
    // thousands of entries, every couple of seconds, so nothing here may scan the whole database per row):
    //   byPair: the key of the Spark ID pair -> the first entry with it; byId: a Spark ID -> the entries that have it;
    //   byName: a first name's (lower-case, 2 to 3 letter) prefix -> the entries that start with it; slow: entries whose names or IDs hold characters
    //   other than letters and digits, which the word lookups cannot place, so they are always checked in full.
    function dbIndex(db) {
        if (dbCache && dbCache.db === db && dbCache.index) return dbCache.index;
        const index = { byPair: new Map(), byId: new Map(), byName: new Map(), slow: [], maxName: 0 };
        const plain = (t) => /^[a-z0-9]+$/i.test(t);
        db.forEach((e, i) => {
            const key = pairKey(e.sparkId1, e.sparkId2);
            if (key && !index.byPair.has(key)) index.byPair.set(key, i);
            let odd = false;
            [e.sparkId1, e.sparkId2].forEach(id => {
                if (!id) return;
                if (!plain(id)) odd = true;
                const list = index.byId.get(id);
                if (list) list.push(i); else index.byId.set(id, [i]);
            });
            const f1 = nameBase(e.firstName).toLowerCase(), l1 = nameBase(e.lastName).toLowerCase();
            const f2 = nameBase(e.firstName2).toLowerCase() || f1, l2 = nameBase(e.lastName2).toLowerCase() || l1;
            if (![f1, l1, f2, l2].every(n => n === '' || plain(n))) odd = true;
            if (odd) { index.slow.push(i); return; }
            if (f1.length < 2 || l1.length < 2) return; // no name match is possible (it needs two letters of each name), only the Spark IDs above
            const list = index.byName.get(f1);
            if (list) list.push(i); else index.byName.set(f1, [i]);
            if (f1.length > index.maxName) index.maxName = f1.length;
        });
        if (dbCache && dbCache.db === db) dbCache.index = index;
        return index;
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
        return 'No IA/Grad Keywords Found';
    }

    // =========================================================
    // DATABASE OPERATIONS (unchanged data model/storage)
    // =========================================================
    // The database is read every second (the counter, the recording) and, on the list page, for every row, so with thousands of entries the parsed
    // copy is kept in memory and only read again when the stored text has changed (the other scripts and tabs can change it); saveDatabase refreshes it.
    // dbCache.index is built when it is first needed (see dbIndex).
    let dbCache = null; // { raw: the stored text, db: the parsed entries, index: lookup tables or null }
    function getDatabase() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (dbCache && dbCache.raw === data) return dbCache.db;
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
            let raw = data;
            if (changed) { raw = JSON.stringify(db); localStorage.setItem(STORAGE_KEY, raw); }
            dbCache = { raw, db, index: null };
            return db;
        } catch (e) {
            console.error('Database: Error reading database', e);
            dbCache = null;
            return [];
        }
    }
    let saveErrorLogged = false; // the failure is logged once, not on every retry
    let saveWarnedAt = 0;        // ...and shown on the page at most once a minute while it lasts
    function saveDatabase(db) {
        try { const raw = JSON.stringify(db); localStorage.setItem(STORAGE_KEY, raw); dbCache = { raw, db, index: null }; saveErrorLogged = false; return true; }
        catch (e) {
            dbCache = null; // the entries may have been changed in memory but not saved: read them again
            if (!saveErrorLogged) { saveErrorLogged = true; console.error('Database: Error saving database (is the browser storage full?)', e); }
            // Pairs are not being recorded: that has to be seen on the page, not only in the console.
            if (Date.now() - saveWarnedAt > 60000) { saveWarnedAt = Date.now(); showDbWarning('Database not saved: the browser storage is full. Download the database, then clear it.'); }
            return false;
        }
    }
    // The browser gives a site about 5 million characters of storage in all. Past this size the database is close to it.
    const DB_NEARLY_FULL = 4000000;
    let nearlyFullWarned = false;
    // Quiet by design: nothing is logged while recording works. When a pair on screen has not been recorded for a
    // few seconds, one line says why (again only if the reason changes). elm451Debug() prints the whole state.
    const problem = { reason: '', since: 0, logged: false };
    function trackRecording(reason) {
        if (!reason) { problem.reason = ''; return; }
        if (problem.reason !== reason) { problem.reason = reason; problem.since = Date.now(); problem.logged = false; return; }
        if (!problem.logged && Date.now() - problem.since > 5000) {
            problem.logged = true;
            console.warn('[Database] the pair on screen is not being recorded: ' + reason + ' (run elm451Debug() for details)');
        }
    }
    // Local date as YYYY-MM-DD, how Scan Date is stored (it sorts and compares correctly); the spreadsheet shows DD/MM/YYYY
    function todayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function recordEntry(dept) {
        const ok = recordEntryNow(dept);
        trackRecording(ok === true ? '' : ok);
        return ok === true;
    }
    // true when the pair is in the database, otherwise the reason it is not
    function recordEntryNow(dept) {
        if (!dept) return 'the main script has not reported this pair yet (no department signal)';
        const sparks = getDomSparkIds();
        if (!sparks.a && !sparks.b) return 'no Spark IDs found on the page';
        // stale signal mid-navigation: the main script's Spark IDs must match the page
        if (document.body.dataset.csvSpark1 !== sparks.a || document.body.dataset.csvSpark2 !== sparks.b) return 'the Spark IDs the main script reported do not match the page';
        const names = extractNames();
        const { firstName, lastName, full } = names;
        if (!firstName && !lastName) return 'the contact names have not loaded'; // page content not ready
        // When both contacts have the same name, the second one is left blank (Firstname 2 / Lastname 2): the name adds
        // nothing, and the Spark ID that was merged away already shows which contact lost. Compared in full, ignoring
        // capitals, one field at a time. Matching treats a blank second name as the same as the first (matchRowToDbEntry).
        const sameName = (a, b) => !!a && (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
        const firstName2 = sameName(full[0], full[2]) ? '' : names.firstName2;
        const lastName2 = sameName(full[1], full[3]) ? '' : names.lastName2;
        const db = getDatabase();
        const rowContents = maskNames(getBlockedRowText(dept), ...full);
        const pairAt = pairKey(sparks.a, sparks.b) ? dbIndex(db).byPair.get(pairKey(sparks.a, sparks.b)) : undefined;
        const existingIdx = pairAt === undefined ? -1 : pairAt;
        const old = existingIdx !== -1 ? db[existingIdx] : null;
        // Merged (Y/N) and "Script vs Bolt" come from the main script: the choice is what it chose over Bolt on
        // the pair on screen; Merged turns Y when the merge is confirmed (see 'elm2-pair-merged' below).
        const merged = old && old.merged === 'Y' ? 'Y' : 'N';
        // Script vs Bolt is only kept for a merged pair (it is filled in by the 'elm2-pair-merged' event below)
        const choice = merged === 'Y' ? (old.choice || '') : '';
        // Bolt's score (high / medium / low) as read from the score chip by the main script; kept once seen
        const score = document.body.dataset.csvScore || (old && old.score) || '';
        // Scan Date: the day the pair was scanned; it moves to the merge day when the pair is merged
        const scanDate = (old && old.scanDate) || todayStr();
        const newEntry = { firstName, lastName, firstName2, lastName2, dept, rowContents, sparkId1: sparks.a, sparkId2: sparks.b, merged, choice, score, scanDate };
        if (old && old.lostSpark) newEntry.lostSpark = old.lostSpark;
        if (old && old.lostFirst) newEntry.lostFirst = old.lostFirst;
        if (old && old.lostLast) newEntry.lostLast = old.lostLast;
        if (old) {
            if (old.dept === dept && old.firstName === firstName && old.lastName === lastName
                && old.firstName2 === firstName2 && old.lastName2 === lastName2 && old.rowContents === rowContents
                && old.sparkId1 === sparks.a && old.sparkId2 === sparks.b
                && (old.merged || '') === merged && (old.choice || '') === choice && (old.score || '') === score && (old.scanDate || '') === scanDate) return true;
            db[existingIdx] = newEntry;
            return saveDatabase(db) ? true : 'the browser would not save the database (storage full?)';
        }
        db.push(newEntry);
        return saveDatabase(db) ? true : 'the browser would not save the database (storage full?)';
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
        const at = pairKey(d.a, d.b) ? dbIndex(db).byPair.get(pairKey(d.a, d.b)) : undefined;
        const idx = at === undefined ? -1 : at;
        if (idx === -1) { console.log('[csv] merged pair is not in the database:', d.a, d.b); return; }
        db[idx].merged = 'Y';
        db[idx].scanDate = todayStr();
        if (d.choice) db[idx].choice = d.choice;
        if (d.lost) db[idx].lostSpark = d.lost; // the Spark ID merged away: struck through in the export
        // the first / last name that was not kept ('a' = Contact A = the Firstname / Lastname columns, 'b' = the "2" columns)
        if (d.names && d.names.first) db[idx].lostFirst = d.names.first;
        if (d.names && d.names.last) db[idx].lostLast = d.names.last;
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
    function putToast(message, type, ms, keep) {
        if (!document.body) return;
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
        if (keep) el.dataset.keep = '1';
        el.className = 'elm2-toast csv-toast ' + type + ' visible';
        el.textContent = '';
        const dot = document.createElement('span'), outer = document.createElement('span'), inner = document.createElement('span'), text = document.createElement('span');
        dot.className = 'csv-toast-dot'; outer.className = 'csv-toast-dot-outer'; inner.className = 'csv-toast-dot-inner'; text.className = 'csv-toast-text';
        dot.append(outer, inner);
        text.textContent = message;
        el.append(dot, text);
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 250); }, ms);
    }
    function showApiToast(message, type) {
        if (mergePanelOpen()) return; // these toasts are for the queue, never over the merge panel
        putToast(message, type, 4000, false);
    }
    // A problem with the database itself (not saved, nearly full): shown wherever you are, the merge panel included, and for longer.
    function showDbWarning(message) { putToast(message, 'error', 12000, true); }
    function showDbWarningOk(message) { putToast(message, 'success', 4000, true); }
    let lastAnnotationSource = null; // 'api' | 'db-fallback' | null

    // =========================================================
    // ROW MATCHING (name-text based — same approach as the classic script)
    // =========================================================
    function startsWord(text, prefix) { return new RegExp('(^|[^a-z0-9])' + escRe(prefix)).test(text); }
    function matchRowToDbEntry(row, db, usedDbIndices) {
        const rowTextRaw = row.textContent;
        const rowText = rowTextRaw.trim().toLowerCase();
        // only the entries that could match are looked at, in database order: those with a Spark ID that is a word of the row, those whose first name
        // starts a word of the row, and the odd ones (see dbIndex)
        const index = dbIndex(db);
        const found = new Set(index.slow);
        (rowTextRaw.match(/[A-Za-z0-9]{4,}/g) || []).forEach(w => { const l = index.byId.get(w); if (l) l.forEach(k => found.add(k)); });
        (rowText.match(/[a-z0-9]{2,}/g) || []).forEach(w => {
            for (let n = 2; n <= Math.min(w.length, index.maxName); n++) { const l = index.byName.get(w.slice(0, n)); if (l) l.forEach(k => found.add(k)); }
        });
        const candidates = Array.from(found).sort((a, b) => a - b);
        for (const i of candidates) {
            if (usedDbIndices.has(i)) continue;
            const entry = db[i];
            if (containsId(rowTextRaw, entry.sparkId1) || containsId(rowTextRaw, entry.sparkId2)) {
                usedDbIndices.add(i);
                return entry;
            }
            // The list rows don't show Spark IDs, so rows are matched on names. Only
            // 3-letter prefixes are stored, so require BOTH contacts of the pair (the
            // master and the duplicate columns) to match, not just one name.
            const has = (f, l) => f.length >= 2 && l.length >= 2 && startsWord(rowText, f) && startsWord(rowText, l);
            const f1 = nameBase(entry.firstName).toLowerCase(), l1 = nameBase(entry.lastName).toLowerCase();
            // A blank second name means "same as the first" (the recorder leaves it blank when both contacts share a name)
            const f2 = nameBase(entry.firstName2).toLowerCase() || f1, l2 = nameBase(entry.lastName2).toLowerCase() || l1;
            // a name the two contacts share has to appear twice in the row (once per contact), not just once
            const occurrences = (t) => (rowText.match(new RegExp('(^|[^a-z0-9])' + escRe(t), 'g')) || []).length;
            const sharedTwice = (a, b) => a !== b || occurrences(a) >= 2;
            if (has(f1, l1) && has(f2, l2) && sharedTwice(f1, f2) && sharedTwice(l1, l2)) {
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
        lastAnnotationSource = 'api';
        if (!mergePanelOpen()) showApiToast('API: data captured successfully', 'success');
        annotateQueueTable();
        setTimeout(annotateQueueTable, 100);
        setTimeout(annotateQueueTable, 500);
    }
    function clearStaleAnnotations() {
        getQueueRows().forEach(row => {
            row.removeAttribute('data-csv-uid');
            row.removeAttribute('data-csv-sparks');
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
                raw: sparks.some(Boolean) ? '' : JSON.stringify(e) // only searched when the record gave no Spark IDs (a page of records is not small)
            };
        });
        return parsed;
    }
    // A list record matches a database entry when it carries all of the entry's
    // Spark IDs (both contacts of the pair; a contact can be in several pairs, so
    // one shared ID alone isn't enough when the entry has two).
    function dbEntryForApi(api, db) {
        if (!api) return null;
        const index = dbIndex(db);
        // the entries that have one of the record's Spark IDs (or, without them, an ID that is a word of the record), in database order
        const found = new Set(index.slow);
        const words = api.sparks.length ? api.sparks : (api.raw.match(/[A-Za-z0-9]{4,}/g) || []);
        words.forEach(w => { const l = index.byId.get(w); if (l) l.forEach(k => found.add(k)); });
        for (const i of Array.from(found).sort((a, b) => a - b)) {
            const entry = db[i];
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
        // who is signed in (for the personal database file): read from the sign-in token the page sends with its own
        // deduplication calls. Only the person's ID is kept, in memory; the token itself is not.
        const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
        XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
            try { if (/^authorization$/i.test(name)) noteAuthorization(this._csvDbUrl, value); } catch (e) { /* never in the page's way */ }
            return origSetHeader.apply(this, arguments);
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
            const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input instanceof URL ? input.href : '';
            try {
                const h = (init && init.headers) || (input instanceof Request ? input.headers : null);
                const auth = h ? (typeof h.get === 'function' ? h.get('Authorization') : (h.Authorization || h.authorization)) : null;
                if (auth) noteAuthorization(url, auth);
            } catch (e) { /* never in the page's way */ }
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
            if (!mergePanelOpen()) showApiToast('API: data captured successfully', 'success');
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
            // the record's Spark IDs, for the main script's score chips (it matches them to the pair it rated)
            if (api && api.sparks.length) row.setAttribute('data-csv-sparks', Array.from(new Set(api.sparks)).join('|'));
            else row.removeAttribute('data-csv-sparks');
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
    // Watches the queue table only. (It used to fall back to the whole page, so on every Element451 page, the ones with no
    // queue included, each change anywhere re-ran the annotation.) The table is looked for twice a second instead.
    function startListObserver() {
        if (isReviewDetailPage()) return;
        const container = getQueueTable();
        if (container === currentObserverTarget) return;
        listObserver.disconnect();
        currentObserverTarget = container;
        if (!container) return;
        listObserver.observe(container, { childList: true, subtree: true, characterData: true });
        if (listAnnotationTimer) clearTimeout(listAnnotationTimer);
        listAnnotationTimer = setTimeout(annotateQueueTable, 150); // a table that just appeared: its rows are annotated right away
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
    // A timer step that fails (Element451 changed its markup, say) is logged once and tried again on the next tick; it
    // never takes the other timers' work down with it.
    const stepErrors = new Set();
    const safely = (name, fn) => () => {
        try { fn(); }
        catch (e) {
            const key = name + ': ' + (e && e.message || e);
            if (stepErrors.has(key) || stepErrors.size >= 50) return;
            stepErrors.add(key);
            console.error('[Database] ' + name + ' failed (logged once):', e);
        }
    };
    setInterval(safely('list annotation', () => { attemptFirstPageFetch(); annotateQueueTable(); }), 2000);
    setInterval(safely('list watch', () => { checkListUrlChange(); startListObserver(); }), 500);
    // a toast that was already showing when the merge panel opened goes away with it (database warnings stay)
    setInterval(safely('toast clean-up', () => {
        const toasts = document.querySelectorAll('#elm2-toast-stack .csv-toast:not([data-keep])');
        if (!toasts.length || !mergePanelOpen()) return; // nothing to remove: skip the layout read
        toasts.forEach(t => t.remove());
    }), 300);

    // =========================================================
    // EXPORT / IMPORT: an .xlsx spreadsheet (column widths, frozen bold header, filter / sort buttons on Bolt Score, Dept.,
    // Scan Date and Merged).
    // =========================================================
    // Columns in file order. Merged and Script vs Bolt sit between Spark ID 2 and Row Contents.
    // width is in cm, as the spreadsheet stores it (the columns can be resized there).
    const DB_COLUMNS = [
        { header: 'Bolt Score', key: 'score', width: 2.6 },
        { header: 'Firstname', key: 'firstName', width: 2.6 },
        { header: 'Lastname', key: 'lastName', width: 2.6 },
        { header: 'Firstname 2', key: 'firstName2', width: 2.6 },
        { header: 'Lastname 2', key: 'lastName2', width: 2.6 },
        { header: 'Spark ID 1', key: 'sparkId1', width: 3.8 },
        { header: 'Spark ID 2', key: 'sparkId2', width: 3.8 },
        { header: 'Dept.', key: 'dept', width: 2.8 },
        { header: 'Scan Date', key: 'scanDate', width: 3 },
        { header: 'Merged', key: 'merged', width: 2.2 },
        { header: 'Script vs Bolt', key: 'choice', width: 9 },
        { header: 'Row Contents', key: 'rowContents', width: 15 }
    ];
    // Each data row carries .struck, the set of column indexes to strike through: the Spark ID that was merged
    // away (lostSpark) when the pair was merged.
    // Scan Date in the spreadsheet is DD/MM/YYYY; stored as YYYY-MM-DD. Reading accepts both, and an Excel date
    // serial (what a cell becomes if it is retyped as a date).
    function parseDate(text) {
        const t = String(text || '').trim();
        let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
        if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
        if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
        if (/^\d{5}$/.test(t)) { const d = new Date(Date.UTC(1899, 11, 30) + parseInt(t, 10) * 86400000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
        return '';
    }
    const capFirst = (t) => { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(); };
    // Cell colours in the spreadsheet: Bolt Score in soft versions of the list view's chip colours (green / orange / red),
    // Dept. in the list view's chip colours, and Script vs Bolt in the light yellow of the applicant band (with dark yellow
    // text) when the script found an applicant. [key, fill, text]; the cell style number is 4 + the position here.
    const XL_PAINT = [
        ['score:high', 'C8E6C9', '1B5E20'], ['score:medium', 'FFE0B2', 'BF360C'], ['score:low', 'FFCDD2', 'B71C1C'],
        ['dept:Grad/IA', 'E3F2FD', '1565C0'], ['dept:UnderGrad', 'F3E5F5', '6A1B9A'], ['dept:Forbidden', 'FCE4EC', 'C2185B'], ['dept:Appeal', 'FFF8E1', 'F57F17'],
        ['applicant', 'FFF9C4', '9A6700']
    ];
    function dbRows(db) {
        const rows = db.map(e => {
            // Script vs Bolt is only exported for a merged pair
            const r = DB_COLUMNS.map(c => String((c.key === 'choice' && e.merged !== 'Y') ? '' : c.key === 'score' ? capFirst(e.score) : c.key === 'scanDate' ? (e.scanDate || '') : (e[c.key] || '')));
            r.struck = new Set();
            r.dates = new Set(); // columns written as real dates (Scan Date), so the spreadsheet can sort and filter them
            const lostCol = { firstName: 'a', firstName2: 'b', lastName: 'a', lastName2: 'b' };
            r.paint = new Map(); // column index -> a key of XL_PAINT: the cell's colour (Bolt Score, Dept., applicant pairs)
            DB_COLUMNS.forEach((c, i) => {
                if (c.key === 'score' && XL_PAINT.some(x => x[0] === 'score:' + r[i].toLowerCase())) r.paint.set(i, 'score:' + r[i].toLowerCase());
                if (c.key === 'dept' && XL_PAINT.some(x => x[0] === 'dept:' + r[i])) r.paint.set(i, 'dept:' + r[i]);
                if (c.key === 'choice' && /^Applicant/i.test(r[i])) r.paint.set(i, 'applicant');
                if (c.key === 'scanDate' && /^\d{4}-\d{2}-\d{2}$/.test(r[i])) r.dates.add(i);
                if ((c.key === 'sparkId1' || c.key === 'sparkId2') && e.lostSpark && r[i] === e.lostSpark) r.struck.add(i);
                if (r[i] && e.merged === 'Y' && (c.key === 'firstName' || c.key === 'firstName2') && e.lostFirst === lostCol[c.key]) r.struck.add(i);
                if (r[i] && e.merged === 'Y' && (c.key === 'lastName' || c.key === 'lastName2') && e.lostLast === lostCol[c.key]) r.struck.add(i);
            });
            return r;
        });
        return [DB_COLUMNS.map(c => c.header), ...rows];
    }
    // Rows (first = header) -> database entries. Columns are found by header name.
    function entriesFromRows(rows) {
        if (rows.length < 2) return [];
        const header = rows[0].map(h => String(h).trim().toLowerCase());
        const col = (name, fallback) => { const i = header.indexOf(name); return i !== -1 ? i : fallback; };
        const idx = {
            first: col('firstname', -1), last: col('lastname', -1),
            first2: col('firstname 2', -1), last2: col('lastname 2', -1),
            dept: col('dept.', -1), rows: col('row contents', -1),
            s1: col('spark id 1', -1), s2: col('spark id 2', -1),
            merged: col('merged', -1), choice: col('script vs bolt', -1), score: col('bolt score', -1), scanDate: col('scan date', -1)
        };
        const get = (cols, i) => (i >= 0 && i < cols.length ? String(cols[i] == null ? '' : cols[i]) : '');
        const entries = [];
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i];
            if (cols.length < 4) continue;
            const m = get(cols, idx.merged).trim().toUpperCase().charAt(0);
            const lost = cols.struck && cols.struck.has(idx.s1) ? get(cols, idx.s1) : cols.struck && cols.struck.has(idx.s2) ? get(cols, idx.s2) : '';
            const st = (i) => !!(cols.struck && i >= 0 && cols.struck.has(i));
            const lostFirst = st(idx.first) ? 'a' : st(idx.first2) ? 'b' : '';
            const lostLast = st(idx.last) ? 'a' : st(idx.last2) ? 'b' : '';
            entries.push({
                firstName: trunc3(get(cols, idx.first)), lastName: trunc3(get(cols, idx.last)),
                firstName2: trunc3(get(cols, idx.first2)), lastName2: trunc3(get(cols, idx.last2)),
                dept: get(cols, idx.dept), rowContents: get(cols, idx.rows),
                sparkId1: get(cols, idx.s1), sparkId2: get(cols, idx.s2),
                merged: m === 'Y' || m === 'N' ? m : '', choice: m === 'Y' ? get(cols, idx.choice) : '', score: get(cols, idx.score).trim().toLowerCase(), scanDate: parseDate(get(cols, idx.scanDate)),
                ...(lost ? { lostSpark: lost } : {}),
                ...(lostFirst ? { lostFirst } : {}), ...(lostLast ? { lostLast } : {})
            });
        }
        return entries;
    }

    // ---- minimal ZIP (stored, no compression) writer and reader: an .xlsx is a zip of XML files
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
    function zipStore(files, mime) {
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
        return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: mime });
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
    const xmlEsc = (t) => String(t).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // ---- .xlsx writer (what the Download button produces: Excel reads it natively)
    const colLetter = (i) => String.fromCharCode(65 + i);
    // YYYY-MM-DD -> Excel's day number (days since 1899-12-30)
    const excelSerial = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
    function xlsxCell(value, ref, style, isDate) {
        const attr = ' r="' + ref + '"' + (style ? ' s="' + style + '"' : '');
        if (value === '') return style ? '<c' + attr + '/>' : '';
        if (isDate) return '<c' + attr + '><v>' + excelSerial(value) + '</v></c>';
        return '<c' + attr + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(value) + '</t></is></c>';
    }
    function buildXlsx(rows) {
        const nCols = DB_COLUMNS.length, nRows = rows.length;
        const cols = DB_COLUMNS.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.round(c.width * 5.4 * 10) / 10 + '" customWidth="1"/>').join('');
        const sheetRows = rows.map((r, ri) => '<row r="' + (ri + 1) + '">' +
            DB_COLUMNS.map((c, ci) => xlsxCell(r[ci] == null ? '' : String(r[ci]), colLetter(ci) + (ri + 1), ri === 0 ? 1 : (r.dates && r.dates.has(ci) ? 3 : r.struck && r.struck.has(ci) ? 2 : r.paint && r.paint.has(ci) ? 4 + XL_PAINT.findIndex(x => x[0] === r.paint.get(ci)) : 0), !!(r.dates && r.dates.has(ci)))).join('') + '</row>').join('');
        // One filter over the whole table, with the buttons hidden on every column except Bolt Score, Dept. and Merged.
        const filterKeys = ['score', 'dept', 'scanDate', 'merged'];
        const filterRef = 'A1:' + colLetter(nCols - 1) + nRows;
        const hiddenButtons = DB_COLUMNS.map((c, i) => filterKeys.includes(c.key) ? '' : '<filterColumn colId="' + i + '" hiddenButton="1"/>').join('');
        const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
            '<dimension ref="A1:' + colLetter(nCols - 1) + nRows + '"/>' +
            '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>' +
            '<sheetFormatPr defaultRowHeight="15"/><cols>' + cols + '</cols><sheetData>' + sheetRows + '</sheetData>' +
            '<autoFilter ref="' + filterRef + '">' + hiddenButtons + '</autoFilter></worksheet>';
        const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
            '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>' +
            '<fonts count="' + (3 + XL_PAINT.length) + '"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>' +
            '<font><strike/><sz val="11"/><color rgb="FF8A8A8A"/><name val="Calibri"/></font>' +
            XL_PAINT.map(x => x[2] ? '<font><sz val="11"/><color rgb="FF' + x[2] + '"/><name val="Calibri"/></font>' : '<font><sz val="11"/><name val="Calibri"/></font>').join('') + '</fonts>' +
            '<fills count="' + (3 + XL_PAINT.length) + '"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FFFDE3CC"/><bgColor indexed="64"/></patternFill></fill>' +
            XL_PAINT.map(x => '<fill><patternFill patternType="solid"><fgColor rgb="FF' + x[1] + '"/><bgColor indexed="64"/></patternFill></fill>').join('') + '</fills>' +
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
            '<cellXfs count="' + (4 + XL_PAINT.length) + '"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
            '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
            '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
            '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
            XL_PAINT.map((x, i) => '<xf numFmtId="0" fontId="' + (3 + i) + '" fillId="' + (3 + i) + '" borderId="0" xfId="0" applyFont="1" applyFill="1"/>').join('') + '</cellXfs>' +
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
        const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
            '<sheets><sheet name="Database" sheetId="1" r:id="rId1"/></sheets>' +
            '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Database!$A$1:$' + colLetter(nCols - 1) + '$' + nRows + '</definedName></definedNames></workbook>';
        const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
        const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
        const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
        return zipStore([
            { name: '[Content_Types].xml', text: types },
            { name: '_rels/.rels', text: rels },
            { name: 'xl/workbook.xml', text: wb },
            { name: 'xl/_rels/workbook.xml.rels', text: wbRels },
            { name: 'xl/styles.xml', text: styles },
            { name: 'xl/worksheets/sheet1.xml', text: sheet }
        ], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
    // ---- .xlsx reader: shared or inline strings, and which cells have a strike-through font
    async function xlsxRows(buf) {
        const parse = (t) => { const d = new DOMParser().parseFromString(t, 'application/xml'); if (d.getElementsByTagName('parsererror').length) throw new Error('the spreadsheet could not be read'); return d; };
        const txt = (el) => Array.from(el.getElementsByTagName('t')).map(t => t.textContent).join('');
        let shared = [];
        try { shared = Array.from(parse(await zipReadText(buf, 'xl/sharedStrings.xml')).getElementsByTagName('si')).map(txt); } catch (e) { /* none */ }
        const struckXf = new Set(), dateXf = new Set();
        try {
            const st = parse(await zipReadText(buf, 'xl/styles.xml'));
            const fonts = Array.from(st.getElementsByTagName('fonts')[0].getElementsByTagName('font')).map(f => { const k = f.getElementsByTagName('strike')[0]; return !!k && k.getAttribute('val') !== '0' && k.getAttribute('val') !== 'false'; });
            const customDate = new Set();
            Array.from(st.getElementsByTagName('numFmt')).forEach(n => { if (/[dmy]/i.test((n.getAttribute('formatCode') || '').replace(/"[^"]*"|\[[^\]]*\]/g, ''))) customDate.add(n.getAttribute('numFmtId')); });
            Array.from(st.getElementsByTagName('cellXfs')[0].getElementsByTagName('xf')).forEach((xf, i) => {
                if (fonts[parseInt(xf.getAttribute('fontId'), 10) || 0]) struckXf.add(String(i));
                const nf = parseInt(xf.getAttribute('numFmtId'), 10);
                if ((nf >= 14 && nf <= 22) || (nf >= 45 && nf <= 47) || customDate.has(String(nf))) dateXf.add(String(i));
            });
        } catch (e) { /* no styles */ }
        const sheet = parse(await zipReadText(buf, 'xl/worksheets/sheet1.xml'));
        const colIndex = (ref) => { const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
        const rows = [];
        Array.from(sheet.getElementsByTagName('row')).forEach(tr => {
            const cells = [];
            cells.struck = new Set();
            Array.from(tr.getElementsByTagName('c')).forEach(c => {
                const i = colIndex(c.getAttribute('r'));
                if (i < 0 || i > 60) return;
                let v = '';
                const t = c.getAttribute('t');
                if (t === 'inlineStr') v = txt(c);
                else {
                    const ve = c.getElementsByTagName('v')[0]; v = ve ? ve.textContent : '';
                    if (t === 's') v = shared[parseInt(v, 10)] || '';
                    else if (v !== '' && dateXf.has(c.getAttribute('s')) && !isNaN(Number(v))) v = parseDate(String(Math.floor(Number(v)))); // a date cell: its day number -> YYYY-MM-DD
                }
                while (cells.length < i) cells.push('');
                cells[i] = v;
                if (v !== '' && struckXf.has(c.getAttribute('s'))) cells.struck.add(i);
            });
            while (cells.length && cells[cells.length - 1] === '') cells.pop();
            if (cells.length) rows.push(cells);
        });
        return rows;
    }


    // ---- PROTECTED FILES START (bytes and a password in, bytes out: no page access, so it can be tested on its own) ----
    // Two protected forms of the database:
    //   1. a password-protected .xlsx, the way Excel itself does it ("Encrypt with Password": ECMA-376 agile encryption, AES-256-CBC with
    //      SHA-512, inside a compound file), so Excel asks for the password and opens it;
    //   2. an .elmdb file only these scripts read: the entries as JSON, gzipped, AES-256-GCM, key by PBKDF2 from a secret the caller
    //      gives (the signed-in person's Element451 identity: a personal file, with no password to type).
    const u8cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; }); return out; };
    const le32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
    const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    const unb64 = (t) => Uint8Array.from(atob(String(t || '')), c => c.charCodeAt(0));
    const randBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
    const utf16le = (t) => { const b = new Uint8Array(t.length * 2); for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); b[i * 2] = c & 255; b[i * 2 + 1] = c >> 8; } return b; };
    const digest = async (name, ...parts) => new Uint8Array(await crypto.subtle.digest(name, u8cat(...parts)));
    // cut to n bytes, or filled up to n with 0x36 (how the format sizes keys and IVs)
    const fit = (u8, n) => { if (u8.length >= n) return u8.subarray(0, n); const out = new Uint8Array(n).fill(0x36); out.set(u8); return out; };
    const sameBytes = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
    const fileError = (message, code) => { const e = new Error(message); e.code = code; return e; };

    // AES-CBC without padding (the format pads with zeros itself). The browser's AES-CBC always adds a padding block when
    // encrypting (dropped here) and expects one when decrypting (made here: it is the encryption of nothing, chained on the last block).
    const cbcKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['encrypt', 'decrypt']);
    const pad16 = (u8) => u8.length % 16 ? u8cat(u8, new Uint8Array(16 - u8.length % 16)) : u8;
    async function cbcEnc(key, iv, data) { const p = pad16(data); return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, p)).subarray(0, p.length); }
    async function cbcDec(key, iv, data) {
        if (!data.length || data.length % 16) throw fileError('The file is damaged.', 'damaged');
        const tail = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: data.slice(data.length - 16) }, key, new Uint8Array(0)));
        return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, u8cat(data, tail)));
    }

    // ---- compound file (the container Office keeps an encrypted document in): a writer and a reader
    const CFB_MAGIC = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    const isCfb = (u8) => u8.length > 512 && CFB_MAGIC.every((b, i) => u8[i] === b);
    function cfbWrite(streams) {
        const SEC = 512, MINI = 64, CUT = 4096, END = 0xFFFFFFFE, FREE = 0xFFFFFFFF, FATSECT = 0xFFFFFFFD, DIFSECT = 0xFFFFFFFC;
        const secsOf = (n) => Math.ceil(n / SEC);
        // streams under 4096 bytes live in the "mini stream" (64-byte sectors, held by the root entry)
        const miniFat = [], miniParts = [];
        streams.forEach(s => {
            s.mini = s.data.length < CUT;
            if (!s.mini) return;
            const n = Math.ceil(s.data.length / MINI);
            s.start = n ? miniFat.length : END;
            for (let k = 0; k < n; k++) miniFat.push(k < n - 1 ? miniFat.length + 1 : END);
            const padded = new Uint8Array(n * MINI); padded.set(s.data); miniParts.push(padded);
        });
        const mini = u8cat(...miniParts);
        // sector plan: big streams, the mini stream, the mini FAT, the directory, then the FAT (and the DIFAT when the FAT is long)
        let next = 0;
        const place = (n) => { const at = n ? next : END; next += n; return at; };
        streams.forEach(s => { if (!s.mini) s.start = place(secsOf(s.data.length)); });
        const miniStart = place(secsOf(mini.length));
        const miniFatSecs = Math.ceil(miniFat.length / 128), miniFatStart = place(miniFatSecs);
        const dirSecs = Math.ceil((streams.length + 1) / 4), dirStart = place(dirSecs);
        let fatSecs = 0, difSecs = 0;
        for (;;) {
            const f = Math.ceil((next + fatSecs + difSecs) / 128), d = f > 109 ? Math.ceil((f - 109) / 127) : 0;
            if (f === fatSecs && d === difSecs) break;
            fatSecs = f; difSecs = d;
        }
        const fatStart = place(fatSecs), difStart = place(difSecs), total = next;
        const out = new Uint8Array(SEC + total * SEC), dv = new DataView(out.buffer);
        const at = (sec) => SEC + sec * SEC;
        const fat = new Uint32Array(fatSecs * 128).fill(FREE);
        const chain = (start, n) => { for (let k = 0; k < n; k++) fat[start + k] = k < n - 1 ? start + k + 1 : END; };
        streams.forEach(s => { if (!s.mini) { chain(s.start, secsOf(s.data.length)); out.set(s.data, at(s.start)); } });
        if (mini.length) { chain(miniStart, secsOf(mini.length)); out.set(mini, at(miniStart)); }
        if (miniFatSecs) {
            chain(miniFatStart, miniFatSecs);
            for (let k = 0; k < miniFatSecs * 128; k++) dv.setUint32(at(miniFatStart) + k * 4, k < miniFat.length ? miniFat[k] : FREE, true);
        }
        chain(dirStart, dirSecs);
        for (let k = 0; k < fatSecs; k++) fat[fatStart + k] = FATSECT;
        for (let k = 0; k < difSecs; k++) fat[difStart + k] = DIFSECT;
        fat.forEach((v, k) => dv.setUint32(at(fatStart) + k * 4, v, true));
        // the directory: entry 0 is the root, then one entry per stream, arranged as a balanced red-black tree in the format's name order
        const order = streams.map((s, i) => i + 1).sort((a, b) => { const x = streams[a - 1].name, y = streams[b - 1].name; return x.length - y.length || (x.toUpperCase() < y.toUpperCase() ? -1 : 1); });
        const node = {}; let deepest = 0;
        const build = (lo, hi, depth) => { if (lo > hi) return FREE; const mid = (lo + hi) >> 1, id = order[mid]; deepest = Math.max(deepest, depth); node[id] = { depth, left: build(lo, mid - 1, depth + 1), right: build(mid + 1, hi, depth + 1) }; return id; };
        const treeRoot = build(0, order.length - 1, 0);
        const entry = (i, name, type, o) => {
            const p = at(dirStart) + i * 128;
            for (let k = 0; k < name.length; k++) dv.setUint16(p + k * 2, name.charCodeAt(k), true);
            dv.setUint16(p + 64, name ? (name.length + 1) * 2 : 0, true);
            out[p + 66] = type; out[p + 67] = o.red ? 0 : 1;
            dv.setUint32(p + 68, o.left, true); dv.setUint32(p + 72, o.right, true); dv.setUint32(p + 76, o.child, true);
            dv.setUint32(p + 116, o.start, true); dv.setUint32(p + 120, o.size, true);
        };
        entry(0, 'Root Entry', 5, { left: FREE, right: FREE, child: treeRoot, start: miniStart, size: mini.length });
        streams.forEach((s, i) => { const n = node[i + 1]; entry(i + 1, s.name, 2, { red: deepest > 0 && n.depth === deepest, left: n.left, right: n.right, child: FREE, start: s.start, size: s.data.length }); });
        for (let i = streams.length + 1; i < dirSecs * 4; i++) entry(i, '', 0, { left: FREE, right: FREE, child: FREE, start: 0, size: 0 });
        // the header
        out.set(CFB_MAGIC, 0);
        dv.setUint16(24, 0x3E, true); dv.setUint16(26, 3, true); dv.setUint16(28, 0xFFFE, true); dv.setUint16(30, 9, true); dv.setUint16(32, 6, true);
        dv.setUint32(44, fatSecs, true); dv.setUint32(48, dirStart, true); dv.setUint32(56, CUT, true);
        dv.setUint32(60, miniFatSecs ? miniFatStart : END, true); dv.setUint32(64, miniFatSecs, true);
        dv.setUint32(68, difSecs ? difStart : END, true); dv.setUint32(72, difSecs, true);
        for (let k = 0; k < 109; k++) dv.setUint32(76 + k * 4, k < fatSecs ? fatStart + k : FREE, true);
        for (let d = 0; d < difSecs; d++) {
            for (let k = 0; k < 127; k++) { const f = 109 + d * 127 + k; dv.setUint32(at(difStart + d) + k * 4, f < fatSecs ? fatStart + f : FREE, true); }
            dv.setUint32(at(difStart + d) + 127 * 4, d < difSecs - 1 ? difStart + d + 1 : END, true);
        }
        return out;
    }
    // -> { name: bytes } of the streams in the file's root
    function cfbRead(u8) {
        if (!isCfb(u8)) throw fileError('The file is damaged.', 'damaged');
        const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), END = 0xFFFFFFFE, FREE = 0xFFFFFFFF;
        const SEC = 1 << dv.getUint16(30, true), MINI = 1 << dv.getUint16(32, true), CUT = dv.getUint32(56, true);
        if (SEC !== 512 && SEC !== 4096) throw fileError('The file is damaged.', 'damaged');
        const at = (sec) => SEC + sec * SEC, maxSecs = Math.ceil(u8.length / SEC) + 1, perSec = SEC / 4;
        const u32 = (p) => { if (p < 0 || p + 4 > u8.length) throw fileError('The file is damaged.', 'damaged'); return dv.getUint32(p, true); };
        // the FAT's own sectors: 109 in the header, the rest through the DIFAT chain
        const fatSecs = [];
        for (let k = 0; k < 109; k++) { const s = u32(76 + k * 4); if (s < END - 2) fatSecs.push(s); }
        for (let d = u32(68), n = 0; d < END - 2 && n < maxSecs; n++) {
            for (let k = 0; k < perSec - 1; k++) { const s = u32(at(d) + k * 4); if (s < END - 2) fatSecs.push(s); }
            d = u32(at(d) + (perSec - 1) * 4);
        }
        const fat = (sec) => { const f = fatSecs[Math.floor(sec / perSec)]; if (f === undefined) throw fileError('The file is damaged.', 'damaged'); return u32(at(f) + (sec % perSec) * 4); };
        const readChain = (start, size) => {
            const out = new Uint8Array(size);
            for (let s = start, o = 0, n = 0; o < size; s = fat(s), n++) {
                if (s >= END - 2 || n > maxSecs || at(s) >= u8.length) throw fileError('The file is damaged.', 'damaged');
                out.set(u8.subarray(at(s), Math.min(at(s) + Math.min(SEC, size - o), u8.length)), o); o += SEC;
            }
            return out;
        };
        const chainLength = (start) => { let n = 0; for (let s = start; s < END - 2 && n <= maxSecs; s = fat(s)) n++; return n; };
        const dir = readChain(u32(48), chainLength(u32(48)) * SEC), ddv = new DataView(dir.buffer);
        const entries = [];
        for (let p = 0; p + 128 <= dir.length; p += 128) {
            const type = dir[p + 66], len = Math.max(0, Math.min(64, ddv.getUint16(p + 64, true)) - 2);
            let name = ''; for (let k = 0; k < len; k += 2) name += String.fromCharCode(ddv.getUint16(p + k, true));
            entries.push({ name, type, start: ddv.getUint32(p + 116, true), size: ddv.getUint32(p + 120, true) });
        }
        const root = entries.find(e => e.type === 5);
        if (!root) throw fileError('The file is damaged.', 'damaged');
        const miniStream = root.size ? readChain(root.start, root.size) : new Uint8Array(0);
        const miniFatStart = u32(60), miniFat = miniFatStart < END - 2 ? readChain(miniFatStart, chainLength(miniFatStart) * SEC) : new Uint8Array(0);
        const mdv = new DataView(miniFat.buffer);
        const readMini = (start, size) => {
            const out = new Uint8Array(size);
            for (let s = start, o = 0, n = 0; o < size; s = mdv.getUint32(s * 4, true), n++) {
                if (s * 4 + 4 > miniFat.length || n > miniFat.length) throw fileError('The file is damaged.', 'damaged');
                out.set(miniStream.subarray(s * MINI, s * MINI + Math.min(MINI, size - o)), o); o += MINI;
            }
            return out;
        };
        const streams = {};
        entries.forEach(e => { if (e.type === 2 && e.size <= u8.length) streams[e.name] = e.size < CUT ? readMini(e.start, e.size) : readChain(e.start, e.size); });
        return streams;
    }

    // ---- Excel's password protection (ECMA-376 "agile" encryption)
    const AGILE = { spin: 100000, input: [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79], value: [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e], key: [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6],
        hmacKey: [0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6], hmacValue: [0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33] };
    const AGILE_HASH = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA384: 'SHA-384', SHA512: 'SHA-512' };
    // the password, hashed with the salt and then hashed again spin times (what makes guessing slow)
    async function agilePasswordHash(hash, password, salt, spin) {
        let h = await digest(hash, salt, utf16le(password));
        const buf = new Uint8Array(4 + h.length), dv = new DataView(buf.buffer);
        for (let i = 0; i < spin; i++) { dv.setUint32(0, i, true); buf.set(h, 4); h = new Uint8Array(await crypto.subtle.digest(hash, buf)); }
        return h;
    }
    const agileKey = async (hash, pwHash, blockKey, bytes) => cbcKey(fit(await digest(hash, pwHash, new Uint8Array(blockKey)), bytes));
    async function agileEncrypt(pkg, password) {
        const H = 'SHA-512', keySalt = randBytes(16), pwSalt = randBytes(16), pkgKeyRaw = randBytes(32), verifier = randBytes(16), hmacKeyRaw = randBytes(64);
        const pkgKey = await cbcKey(pkgKeyRaw);
        // the package: its length, then 4096-byte segments, each encrypted with its own IV
        const size = new Uint8Array(8); new DataView(size.buffer).setUint32(0, pkg.length, true);
        const segs = [size];
        for (let i = 0, n = 0; i < pkg.length; i += 4096, n++) segs.push(await cbcEnc(pkgKey, (await digest(H, keySalt, le32(n))).subarray(0, 16), pkg.subarray(i, i + 4096)));
        const stream = u8cat(...segs);
        // integrity: an HMAC over the encrypted package, itself stored encrypted
        const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', hmacKeyRaw, { name: 'HMAC', hash: H }, false, ['sign']), stream));
        const encHmacKey = await cbcEnc(pkgKey, (await digest(H, keySalt, new Uint8Array(AGILE.hmacKey))).subarray(0, 16), hmacKeyRaw);
        const encHmacValue = await cbcEnc(pkgKey, (await digest(H, keySalt, new Uint8Array(AGILE.hmacValue))).subarray(0, 16), hmac);
        // the package key, locked with the password, plus a verifier that tells a wrong password from a right one
        const pw = await agilePasswordHash(H, password, pwSalt, AGILE.spin);
        const encInput = await cbcEnc(await agileKey(H, pw, AGILE.input, 32), pwSalt, verifier);
        const encValue = await cbcEnc(await agileKey(H, pw, AGILE.value, 32), pwSalt, await digest(H, verifier));
        const encKey = await cbcEnc(await agileKey(H, pw, AGILE.key, 32), pwSalt, pkgKeyRaw);
        const algo = 'saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512"';
        const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password" xmlns:c="http://schemas.microsoft.com/office/2006/keyEncryptor/certificate">' +
            '<keyData ' + algo + ' saltValue="' + b64(keySalt) + '"/>' +
            '<dataIntegrity encryptedHmacKey="' + b64(encHmacKey) + '" encryptedHmacValue="' + b64(encHmacValue) + '"/>' +
            '<keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">' +
            '<p:encryptedKey spinCount="' + AGILE.spin + '" ' + algo + ' saltValue="' + b64(pwSalt) + '" encryptedVerifierHashInput="' + b64(encInput) + '" encryptedVerifierHashValue="' + b64(encValue) + '" encryptedKeyValue="' + b64(encKey) + '"/>' +
            '</keyEncryptor></keyEncryptors></encryption>';
        const info = u8cat(new Uint8Array([4, 0, 4, 0, 0x40, 0, 0, 0]), new TextEncoder().encode(xml));
        return cfbWrite([{ name: 'EncryptionInfo', data: info }, { name: 'EncryptedPackage', data: stream }]);
    }
    // -> the .xlsx bytes; throws code 'password' for a wrong password
    async function agileDecrypt(u8, password) {
        const cfb = cfbRead(u8), info = cfb.EncryptionInfo, stream = cfb.EncryptedPackage;
        if (!info || !stream || stream.length < 8) throw fileError('This is not a password-protected spreadsheet.', 'damaged');
        if (info[0] !== 4 || info[2] !== 4) throw fileError('This spreadsheet uses an older kind of password protection. Open it in Excel and save it again.', 'unsupported');
        const xml = new TextDecoder().decode(info.subarray(8));
        const tag = (name) => (xml.match(new RegExp('<(?:\\w+:)?' + name + '\\b[^>]*>')) || [''])[0];
        const attr = (t, a) => (t.match(new RegExp('\\s' + a + '="([^"]*)"')) || [])[1] || '';
        const kd = tag('keyData'), ek = tag('encryptedKey'), di = tag('dataIntegrity');
        const H = AGILE_HASH[attr(kd, 'hashAlgorithm')], PH = AGILE_HASH[attr(ek, 'hashAlgorithm')];
        const keyBytes = parseInt(attr(kd, 'keyBits'), 10) / 8, pwKeyBytes = parseInt(attr(ek, 'keyBits'), 10) / 8, spin = parseInt(attr(ek, 'spinCount'), 10);
        const plain = (t) => attr(t, 'cipherAlgorithm') === 'AES' && attr(t, 'cipherChaining') === 'ChainingModeCBC' && attr(t, 'blockSize') === '16';
        if (!H || !PH || !plain(kd) || !plain(ek) || ![16, 32].includes(keyBytes) || ![16, 32].includes(pwKeyBytes) || !(spin >= 0 && spin <= 10000000)) throw fileError('This spreadsheet is protected in a way these scripts cannot read.', 'unsupported');
        const keySalt = unb64(attr(kd, 'saltValue')), pwSalt = unb64(attr(ek, 'saltValue')), iv = fit(pwSalt, 16);
        const pw = await agilePasswordHash(PH, password, pwSalt, spin);
        const verifier = (await cbcDec(await agileKey(PH, pw, AGILE.input, pwKeyBytes), iv, unb64(attr(ek, 'encryptedVerifierHashInput')))).subarray(0, parseInt(attr(ek, 'saltSize'), 10) || 16);
        const hashSize = parseInt(attr(ek, 'hashSize'), 10) || 64;
        const want = (await cbcDec(await agileKey(PH, pw, AGILE.value, pwKeyBytes), iv, unb64(attr(ek, 'encryptedVerifierHashValue')))).subarray(0, hashSize);
        if (!sameBytes(want, (await digest(PH, verifier)).subarray(0, hashSize))) throw fileError('Wrong password.', 'password');
        const pkgKeyRaw = (await cbcDec(await agileKey(PH, pw, AGILE.key, pwKeyBytes), iv, unb64(attr(ek, 'encryptedKeyValue')))).subarray(0, keyBytes);
        const pkgKey = await cbcKey(pkgKeyRaw);
        // integrity first (when the file carries it), then the package itself
        if (attr(di, 'encryptedHmacKey') && attr(di, 'encryptedHmacValue')) {
            const kdHash = parseInt(attr(kd, 'hashSize'), 10) || 64;
            const hmacKeyRaw = (await cbcDec(pkgKey, fit(await digest(H, keySalt, new Uint8Array(AGILE.hmacKey)), 16), unb64(attr(di, 'encryptedHmacKey')))).subarray(0, kdHash);
            const hmacWant = (await cbcDec(pkgKey, fit(await digest(H, keySalt, new Uint8Array(AGILE.hmacValue)), 16), unb64(attr(di, 'encryptedHmacValue')))).subarray(0, kdHash);
            const ok = await crypto.subtle.verify('HMAC', await crypto.subtle.importKey('raw', hmacKeyRaw, { name: 'HMAC', hash: H }, false, ['verify']), hmacWant, stream);
            if (!ok) throw fileError('The file is damaged (its contents were changed after it was protected).', 'damaged');
        }
        const dv = new DataView(stream.buffer, stream.byteOffset, stream.byteLength), size = dv.getUint32(0, true);
        if (dv.getUint32(4, true) || size > stream.length) throw fileError('The file is damaged.', 'damaged');
        const out = new Uint8Array(size);
        for (let i = 8, n = 0, o = 0; o < size; i += 4096, n++) {
            const seg = stream.subarray(i, Math.min(i + 4096, stream.length));
            const dec = await cbcDec(pkgKey, fit(await digest(H, keySalt, le32(n)), 16), seg);
            out.set(dec.subarray(0, Math.min(dec.length, size - o)), o); o += 4096;
        }
        return out;
    }

    // ---- the scripts' own encrypted file (.elmdb): locked with a secret string instead of a typed password
    const ELMDB_FORMAT = 'elm451-database', ELMDB_ITERATIONS = 600000;
    const isElmdb = (u8) => { try { const head = new TextDecoder().decode(u8.subarray(0, 300)); return /^\s*\{/.test(head) && head.includes(ELMDB_FORMAT); } catch (e) { return false; } };
    const pipeBytes = async (u8, transform) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(transform)).arrayBuffer());
    const elmdbKey = async (password, salt, iterations) => crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
        await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    async function elmdbEncrypt(entries, secret) {
        const salt = randBytes(16), iv = randBytes(12);
        const packed = await pipeBytes(new TextEncoder().encode(JSON.stringify({ entries })), new CompressionStream('gzip'));
        const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await elmdbKey(secret, salt, ELMDB_ITERATIONS), packed));
        return JSON.stringify({ format: ELMDB_FORMAT, version: 1, lock: 'login', about: 'Element451 Dedup database, personal copy: it opens with Upload or Merge Databases in the Element451 Dedup scripts, for the person who downloaded it, signed in to Element451.',
            kdf: 'PBKDF2-SHA256', iterations: ELMDB_ITERATIONS, cipher: 'AES-256-GCM', salt: b64(salt), iv: b64(iv), data: b64(data) });
    }
    // -> the entries as stored; throws code 'password' when the secret is not the one the file was locked with
    async function elmdbDecrypt(u8, secret) {
        let box;
        try { box = JSON.parse(new TextDecoder().decode(u8)); } catch (e) { throw fileError('The file is damaged.', 'damaged'); }
        const iterations = Number(box.iterations);
        if (!box || box.format !== ELMDB_FORMAT || box.version !== 1 || !(iterations >= 1000 && iterations <= 10000000)) throw fileError('This database file was made by a newer version of the scripts.', 'unsupported');
        let packed;
        try { packed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, await elmdbKey(secret, unb64(box.salt), iterations), unb64(box.data))); }
        catch (e) { throw fileError('Locked to a different login.', 'password'); }
        try { const d = JSON.parse(new TextDecoder().decode(await pipeBytes(packed, new DecompressionStream('gzip')))); if (!Array.isArray(d.entries)) throw 0; return d.entries; }
        catch (e) { throw fileError('The file is damaged.', 'damaged'); }
    }
    // ---- PROTECTED FILES END ----

    // =========================================================
    // PROTECTED DOWNLOADS AND UPLOADS
    // A database file is never written unprotected. Download offers the two protected forms above:
    //   - the Excel file is the one to share: protected with a password that is set once and kept in this browser
    //     (localStorage `elm_db_password`), so your own files open without asking and a file made with another password asks;
    //   - the .elmdb is personal: locked to the Element451 login of the person who downloads it, no password at all.
    // Upload reads both, and still reads an old plain .xlsx. The Merge Databases script uses the same reader and writer
    // through window.__elm451DbFiles.
    // =========================================================
    // ---- who is signed in. The page sends a sign-in token with its calls to Element451; when that token is a JWT, its
    // payload names the person (sub / user_id / ...). That ID, not the token, is what a personal file is locked to. It is an
    // identifier rather than a secret, so this lock is lighter than a password: it keeps the file closed to anyone who does
    // not know the person's Element451 ID, and to coworkers using these scripts under their own login.
    const LOGIN_PREFIX = 'elm451-login:', LOGIN_MARK_KEY = 'elm_db_login_mark';
    const JWT_RE = /^(?:Bearer\s+)?([A-Za-z0-9_-]{4,})\.([A-Za-z0-9_-]{4,})\.([A-Za-z0-9_-]*)$/;
    let login = null; // { id, kind: 'id' | 'email', source: 'request' | 'storage', mark }
    function identityFromClaims(c) {
        if (!c || typeof c !== 'object') return null;
        const u = c.user && typeof c.user === 'object' ? c.user : null;
        const pick = [c.sub, c.user_id, c.userId, c.uid, u && (u._id || u.id), typeof c.user === 'string' ? c.user : null, c.id, c._id, c.email, u && u.email, c.username]
            .find(v => (typeof v === 'string' && v.trim().length >= 3) || (typeof v === 'number' && isFinite(v)));
        if (pick === undefined) return null;
        const id = String(pick).trim().toLowerCase();
        return { id, kind: id.includes('@') ? 'email' : 'id' };
    }
    function identityFromToken(t) {
        const m = JWT_RE.exec(String(t || '').trim());
        if (!m) return null;
        try { return identityFromClaims(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(m[2].replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0))))); }
        catch (e) { return null; }
    }
    // Fallback when no deduplication call has been seen yet: the page's own stored session (a token, or a user object).
    // Used only when everything found there names one and the same person.
    function identityFromStorage() {
        const found = new Map();
        const add = (who) => { if (who) found.set(who.id, who); };
        const userLike = (o) => o && typeof o === 'object' && !Array.isArray(o) && (o._id || o.id) && o.email ? identityFromClaims({ sub: o._id || o.id }) : null;
        [localStorage, sessionStorage].forEach(store => {
            try {
                for (let i = 0; i < store.length; i++) {
                    const key = store.key(i);
                    if (/^(elm2?_|__elm)/.test(key)) continue; // our own keys
                    const raw = store.getItem(key) || '';
                    if (raw.length < 20 || raw.length > 20000) continue;
                    add(identityFromToken(raw.replace(/^"|"$/g, '')));
                    if (raw[0] !== '{') continue;
                    let o; try { o = JSON.parse(raw); } catch (e) { continue; }
                    ['access_token', 'accessToken', 'id_token', 'idToken', 'token', 'jwt'].forEach(k => { if (typeof o[k] === 'string') add(identityFromToken(o[k])); });
                    [o, o.user, o.currentUser, o.profile, o.me].forEach(x => add(userLike(x)));
                }
            } catch (e) { /* storage unavailable */ }
        });
        return found.size === 1 ? Array.from(found.values())[0] : null;
    }
    function setLogin(who, source) {
        if (!who || (login && login.id === who.id)) return;
        if (login && login.source === 'request' && source !== 'request') return; // the page's own call is the better witness
        const mine = login = { id: who.id, kind: who.kind, source, mark: '' };
        // a short fingerprint of the ID, kept in this browser: it shows when the login this browser sees has changed
        digest('SHA-256', new TextEncoder().encode(LOGIN_PREFIX + who.id)).then(h => {
            mine.mark = Array.from(h.subarray(0, 4), b => b.toString(16).padStart(2, '0')).join('');
            let rec = null;
            try { rec = JSON.parse(localStorage.getItem(LOGIN_MARK_KEY) || 'null'); } catch (e) { /* ignore */ }
            if (rec && rec.m === mine.mark) return;
            try { localStorage.setItem(LOGIN_MARK_KEY, JSON.stringify({ m: mine.mark, t: Date.now(), c: rec ? Date.now() : 0 })); } catch (e) { /* ignore */ }
        }).catch(() => {});
    }
    function noteAuthorization(url, value) {
        if (!/duplicate|dedup/i.test(String(url || ''))) return; // Element451's own deduplication API, not some other service on the page
        setLogin(identityFromToken(value), 'request');
    }
    function currentLogin() {
        if (!login) setLogin(identityFromStorage(), 'storage');
        return login;
    }
    // The login this browser sees changed in the last 30 days (another person signed in here, or the ID is not a steady one)
    function loginChangedRecently() {
        try { const rec = JSON.parse(localStorage.getItem(LOGIN_MARK_KEY) || 'null'); return !!(rec && rec.c && Date.now() - rec.c < 30 * 86400000); } catch (e) { return false; }
    }
    const PASSWORD_KEY = 'elm_db_password', PASSWORD_MIN = 8;
    let unsavedPassword = ''; // only used when the browser refuses to store it (storage full): it then lasts until the page is closed
    function savedPassword() { try { return localStorage.getItem(PASSWORD_KEY) || unsavedPassword; } catch (e) { return unsavedPassword; } }
    function storePassword(p) { unsavedPassword = p; try { localStorage.setItem(PASSWORD_KEY, p); return true; } catch (e) { return false; } }
    const workedPasswords = []; // passwords that opened a file since the page loaded (a coworker's file can have another one)

    // A small dialog built with DOM calls in whichever document asks (this page, or the Merge Databases tab).
    // o: { title, text: [..], password: { value }, error, ok, options: [{ value, label, sub }] } -> { value } | { choice } | null (cancelled)
    const DIALOG_CSS = `
        .elm-dbd-scrim { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; background: rgba(0, 0, 0, .4); font: 400 14px/20px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; letter-spacing: .25px; }
        .elm-dbd { box-sizing: border-box; width: min(440px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 24px; border-radius: 28px; background: #fffbf8; color: #1a1c20; box-shadow: 0 8px 28px rgba(0, 0, 0, .3); text-align: left; }
        .elm-dbd h2 { margin: 0 0 12px; font: 400 22px/28px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1a1c20; }
        .elm-dbd p { margin: 0 0 12px; color: #43474e; }
        .elm-dbd-field { display: flex; align-items: center; gap: 8px; height: 48px; margin: 4px 0 4px; padding: 0 8px 0 16px; border: 1px solid #73777f; border-radius: 8px; background: #fff; }
        .elm-dbd-field:focus-within { border: 2px solid var(--md-primary, #ef6c00); padding: 0 7px 0 15px; }
        .elm-dbd-field input[type="password"], .elm-dbd-field input[type="text"] { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font: 400 16px/24px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1a1c20; }
        .elm-dbd-show { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #43474e; cursor: pointer; user-select: none; }
        .elm-dbd-error { min-height: 20px; margin: 0 0 4px 16px; font-size: 13px; color: #b3261e; }
        .elm-dbd-option { display: block; width: 100%; box-sizing: border-box; margin: 0 0 8px; padding: 12px 16px; border: 1px solid #c3c7cf; border-radius: 16px; background: #fff; color: #1a1c20; text-align: left; cursor: pointer; font: inherit; }
        .elm-dbd-option.off { opacity: .6; cursor: default; background: #f4f0ec; }
        .elm-dbd-option:not(.off):hover, .elm-dbd-option:not(.off):focus-visible { border-color: var(--md-primary, #ef6c00); background: #fff4ea; outline: none; }
        .elm-dbd-option b { display: block; font-weight: 600; font-size: 15px; }
        .elm-dbd-option span { display: block; color: #43474e; font-size: 13px; }
        .elm-dbd-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
        .elm-dbd-btn { height: 40px; padding: 0 24px; border: none; border-radius: 20px; background: transparent; color: var(--md-primary-text, #b34e00); font: 500 14px/20px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; letter-spacing: .1px; cursor: pointer; }
        .elm-dbd-btn:hover { background: rgba(239, 108, 0, .08); }
        .elm-dbd-btn.filled { background: var(--md-primary, #ef6c00); color: #fff; }
        .elm-dbd-btn.filled:hover { box-shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 1px 3px 1px rgba(0, 0, 0, .15); }
        .elm-dbd-btn:focus-visible { outline: 2px solid var(--md-primary, #ef6c00); outline-offset: 2px; }
        .elm-dbd-busy { display: flex; align-items: center; gap: 16px; }
        .elm-dbd-spin { flex: none; width: 24px; height: 24px; border-radius: 50%; border: 3px solid #fde3cc; border-top-color: var(--md-primary, #ef6c00); animation: elmDbdSpin .8s linear infinite; }
        @keyframes elmDbdSpin { to { transform: rotate(360deg); } }
    `;
    function dialogShell(doc) {
        if (!doc.getElementById('elm-dbd-style')) { const st = doc.createElement('style'); st.id = 'elm-dbd-style'; st.textContent = DIALOG_CSS; (doc.head || doc.documentElement).appendChild(st); }
        const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
        const scrim = el('div', 'elm-dbd-scrim'), box = el('div', 'elm-dbd');
        box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
        scrim.appendChild(box);
        return { el, scrim, box };
    }
    function dbDialog(doc, o) {
        return new Promise(resolve => {
            const { el, scrim, box } = dialogShell(doc);
            box.appendChild(el('h2', '', o.title));
            (o.text || []).forEach(t => box.appendChild(el('p', '', t)));
            let input = null, error = null;
            const done = (v) => { doc.removeEventListener('keydown', onKey, true); scrim.remove(); resolve(v); };
            const accept = () => {
                if (!input) { done({}); return; }
                const problem = o.validate ? o.validate(input.value) : (input.value ? '' : 'Type the password.');
                if (problem) { error.textContent = problem; input.focus(); return; }
                done({ value: input.value });
            };
            const onKey = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
                else if (e.key === 'Enter' && input && doc.activeElement === input) { e.preventDefault(); e.stopPropagation(); accept(); }
            };
            if (o.password) {
                const field = el('label', 'elm-dbd-field');
                input = el('input'); input.type = 'password'; input.value = o.password.value || ''; input.autocomplete = 'off'; input.spellcheck = false;
                input.setAttribute('aria-label', 'Password');
                const show = el('label', 'elm-dbd-show'), box2 = el('input'); box2.type = 'checkbox';
                box2.addEventListener('change', () => { input.type = box2.checked ? 'text' : 'password'; });
                show.append(box2, doc.createTextNode('Show'));
                field.append(input, show);
                error = el('div', 'elm-dbd-error', o.error || '');
                box.append(field, error);
            }
            (o.options || []).forEach(opt => {
                const b = el('button', 'elm-dbd-option'); b.type = 'button';
                b.append(el('b', '', opt.label), el('span', '', opt.sub));
                if (opt.disabled) { b.disabled = true; b.classList.add('off'); }
                b.addEventListener('click', () => done({ choice: opt.value }));
                box.appendChild(b);
            });
            const actions = el('div', 'elm-dbd-actions');
            const cancel = el('button', 'elm-dbd-btn', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', () => done(null));
            actions.appendChild(cancel);
            if (o.ok) { const ok = el('button', 'elm-dbd-btn filled', o.ok); ok.type = 'button'; ok.addEventListener('click', accept); actions.appendChild(ok); }
            box.appendChild(actions);
            doc.addEventListener('keydown', onKey, true);
            (doc.body || doc.documentElement).appendChild(scrim);
            const first = input || box.querySelector('.elm-dbd-option:not(.off)') || cancel;
            first.focus();
            if (input) input.select();
        });
    }
    // "Working..." while a file is locked or unlocked (the password is deliberately slow to check: about a second or two)
    function busyNote(doc, text) {
        const { el, scrim, box } = dialogShell(doc);
        const row = el('div', 'elm-dbd-busy'); row.append(el('div', 'elm-dbd-spin'), el('div', '', text));
        box.appendChild(row);
        (doc.body || doc.documentElement).appendChild(scrim);
        return () => scrim.remove();
    }
    // Set or change the saved password -> the password, or null when cancelled
    async function passwordDialog(doc) {
        const current = savedPassword();
        const r = await dbDialog(doc, {
            title: current ? 'Database password' : 'Set a database password',
            text: [
'The Excel file you download, the one for sharing, is always protected with this password. It is kept in this browser, so you type it once. Coworkers need the same password to open your files, so agree on one and give it to them some other way than with the file.',
                current ? 'Changing it affects the files you download from now on. Files made earlier keep the password they were made with.' : 'Use at least ' + PASSWORD_MIN + ' characters.'
            ],
            password: { value: current }, ok: 'Save',
            validate: (v) => v.length < PASSWORD_MIN ? 'Use at least ' + PASSWORD_MIN + ' characters.' : ''
        });
        if (!r) return null;
        storePassword(r.value);
        return r.value;
    }
    // Opens a protected file: the saved password first, then any that worked earlier, then it asks (again after a wrong one)
    async function openWithPassword(name, doc, open) {
        const tried = new Set();
        const attempt = async (p) => { const stop = busyNote(doc, 'Opening ' + name + '…'); try { return await open(p); } finally { stop(); } };
        for (const p of [savedPassword(), ...workedPasswords]) {
            if (!p || tried.has(p)) continue;
            tried.add(p);
            try { return { entries: await attempt(p) }; } catch (e) { if (e.code !== 'password') throw e; }
        }
        for (let wrong = false; ;) {
            const r = await dbDialog(doc, {
                title: 'Password needed',
                text: ['"' + name + '" is protected' + (tried.size ? ' with a different password from the one saved in this browser.' : ' with a password.')],
                password: { value: '' }, ok: 'Open', error: wrong ? 'That password did not open the file.' : ''
            });
            if (!r) throw fileError('No password was given.', 'cancel');
            try { const entries = await attempt(r.value); if (!workedPasswords.includes(r.value)) workedPasswords.push(r.value); return { entries }; }
            catch (e) { if (e.code !== 'password') throw e; wrong = true; }
        }
    }
    // Entries read from an .elmdb file, brought to the stored shape (the same one entriesFromRows gives)
    function cleanEntries(list) {
        const str = (v) => v == null ? '' : String(v);
        return list.filter(e => e && typeof e === 'object' && !Array.isArray(e)).map(e => {
            const m = str(e.merged).trim().toUpperCase().charAt(0);
            const out = {
                firstName: trunc3(str(e.firstName)), lastName: trunc3(str(e.lastName)), firstName2: trunc3(str(e.firstName2)), lastName2: trunc3(str(e.lastName2)),
                dept: str(e.dept), rowContents: str(e.rowContents), sparkId1: str(e.sparkId1), sparkId2: str(e.sparkId2),
                merged: m === 'Y' || m === 'N' ? m : '', choice: m === 'Y' ? str(e.choice) : '', score: str(e.score).trim().toLowerCase(), scanDate: parseDate(str(e.scanDate))
            };
            if (e.lostSpark) out.lostSpark = str(e.lostSpark);
            if (e.lostFirst === 'a' || e.lostFirst === 'b') out.lostFirst = e.lostFirst;
            if (e.lostLast === 'a' || e.lostLast === 'b') out.lostLast = e.lostLast;
            return out;
        });
    }
    // Reads a database file of any kind into entries (throws with a message a person can read; code 'cancel' when no password was given)
    async function readDbFile(file, doc) {
        const buf = await file.arrayBuffer(), u8 = new Uint8Array(buf);
        const fromRows = (rows) => { if (rows.length < 2) throw new Error('The file is empty or has no data rows.'); return entriesFromRows(rows); };
        let entries;
        if (u8[0] === 0x50 && u8[1] === 0x4B) entries = fromRows(await xlsxRows(buf)); // a plain .xlsx (how downloads were before they were protected)
        else if (isCfb(u8)) entries = (await openWithPassword(file.name, doc || document, async (p) => { const x = await agileDecrypt(u8, p); return fromRows(await xlsxRows(x.buffer.slice(x.byteOffset, x.byteOffset + x.length))); })).entries;
        else if (isElmdb(u8)) {
            // a personal file: it opens for the login it was locked to, and there is no password to ask for
            const who = currentLogin();
            if (!who) throw new Error('This is a personal file, locked to an Element451 login, and the script has not seen who is signed in yet. Open the Deduplication list, then try again.');
            const stop = busyNote(doc || document, 'Opening ' + file.name + '…');
            try { entries = cleanEntries(await elmdbDecrypt(u8, LOGIN_PREFIX + who.id)); }
            catch (e) { if (e.code !== 'password') throw e; throw new Error('This personal file is locked to a different Element451 login. Only the person who downloaded it can open it, signed in as themselves. To share a database, download the Excel file.'); }
            finally { stop(); }
        }
        else throw new Error('Please select a database file (.xlsx or .elmdb).');
        if (entries.length === 0) throw new Error('No valid entries found in the file.');
        return entries;
    }
    // Asks which protected form, builds it and hands it to the browser as a download -> true when a file was downloaded
    async function downloadDatabase(entries, doc) {
        doc = doc || document;
        const who = currentLogin();
        const r = await dbDialog(doc, {
            title: 'Download the database',
            options: [
                { value: 'xlsx', label: 'Excel file, to share (.xlsx)', sub: 'Protected with the database password. Excel asks for it, then opens the file; coworkers open it with Upload or Merge Databases.' },
                { value: 'elmdb', label: 'Personal file (.elmdb)', disabled: !who,
                  sub: !who ? 'Not available yet: the script has not seen who is signed in. Open the Deduplication list and try again.'
                      : 'Locked to your Element451 login, with no password. Only you can open it, with Upload or Merge Databases while signed in. No other program opens it.' +
                        (loginChangedRecently() ? ' Note: a different login was seen in this browser in the last 30 days. If that was not another person, check that a personal file uploads back before relying on it.' : '') }
            ]
        });
        if (!r) return false;
        let password = '';
        if (r.choice === 'xlsx') { password = savedPassword() || await passwordDialog(doc); if (!password) return false; }
        const stop = busyNote(doc, 'Protecting the file…');
        let blob;
        try {
            if (r.choice === 'xlsx') blob = new Blob([await agileEncrypt(new Uint8Array(await buildXlsx(dbRows(entries)).arrayBuffer()), password)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            else blob = new Blob([await elmdbEncrypt(entries, LOGIN_PREFIX + who.id)], { type: 'application/octet-stream' });
        } finally { stop(); }
        const url = URL.createObjectURL(blob), a = doc.createElement('a');
        a.href = url;
        a.download = `elm_database_${new Date().toISOString().slice(0, 10)}.${r.choice}`;
        (doc.body || doc.documentElement).appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return true;
    }
    // For the Merge Databases script: the same reader and protected writer, in its own tab's document
    window.__elm451DbFiles = { version: 1, read: readDbFile, download: downloadDatabase };

    // =========================================================
    // DATABASE UI (badge in header, section in settings pane — same
    // injection targets as the classic script, provided by UI-Perfection-v2)
    // =========================================================
    // "Database 128" with the number in bold
    function setDbLabel(label, n) {
        const b = document.createElement('b');
        b.textContent = String(n);
        label.textContent = 'Database ';
        label.appendChild(b);
    }
    function updateDbSizeBadge() {
        const label = document.getElementById('elm-db-size-label');
        if (!label) return;
        const count = getDatabase().length;
        setDbLabel(label, count);
        const badge = document.getElementById('elm-db-size-badge');
        const nearlyFull = !!(dbCache && dbCache.raw && dbCache.raw.length > DB_NEARLY_FULL);
        if (badge) badge.title = `Database: ${count} entries recorded` + (nearlyFull ? '. Nearly full: download it, then clear it, or new pairs will stop being recorded.' : '');
        if (nearlyFull && !nearlyFullWarned) { nearlyFullWarned = true; showDbWarning('Database nearly full: download it, then clear it, so new pairs keep being recorded.'); }
        if (!nearlyFull) nearlyFullWarned = false;
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
        setDbLabel(label, 0);
        const icon = document.createElement('span');
        icon.id = 'elm-db-size-icon';
        icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3C7.58 3 4 4.79 4 7v10c0 2.21 3.58 4 8 4s8-1.79 8-4V7c0-2.21-3.58-4-8-4m0 2c3.87 0 6 1.5 6 2s-2.13 2-6 2-6-1.5-6-2 2.13-2 6-2m6 12c0 .5-2.13 2-6 2s-6-1.5-6-2v-2.23c1.61.78 3.72 1.23 6 1.23s4.39-.45 6-1.23zm0-4.55c-1.3.95-3.58 1.55-6 1.55s-4.7-.6-6-1.55V9.64c1.47.83 3.61 1.36 6 1.36s4.53-.53 6-1.36z"/></svg>';
        badge.appendChild(icon);
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
            <input type="file" id="elm-db-upload-input" accept=".xlsx,.elmdb">
            <button id="elm-settings-password-btn" class="settings-action-btn"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2m-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2m3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1z"/></svg> Database Password</button>
            <button id="elm-settings-clear-btn" class="settings-action-btn danger"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg> Clear Database</button>
        `;
        // above the Info section when there is one (it stays last), else at the end
        const infoSection = document.getElementById('elm-settings-info');
        if (infoSection) infoSection.insertAdjacentElement('beforebegin', section); else settingsBody.appendChild(section);
        // The Info section lists the versions in use; this adds the database script's line under the main script's.
        const build = document.querySelector('#elm-settings-pane .settings-build');
        if (build && !document.getElementById('elm-settings-db-build')) {
            const line = document.createElement('div');
            line.id = 'elm-settings-db-build';
            line.className = 'settings-build';
            line.textContent = 'Database script \u00b7 v' + VERSION;
            build.insertAdjacentElement('afterend', line);
        }
        document.getElementById('elm-settings-download-btn').onclick = () => {
            const db = getDatabase();
            if (db.length === 0) { alert('The database is empty — no entries have been recorded yet.'); return; }
            // always protected: a password-protected .xlsx or an encrypted .elmdb (see downloadDatabase)
            downloadDatabase(db, document).catch(err => alert('The database could not be downloaded: ' + (err && err.message || err)));
        };
        document.getElementById('elm-settings-password-btn').onclick = () => {
            passwordDialog(document).then(p => { if (p && savedPassword() === p) showDbWarningOk('Database password saved in this browser.'); });
        };
        const uploadInput = document.getElementById('elm-db-upload-input');
        document.getElementById('elm-settings-upload-btn').onclick = () => uploadInput.click();
        uploadInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const entries = await readDbFile(file, document);
                if (!confirm(`Replace current database with ${entries.length} entries from "${file.name}"?`)) { uploadInput.value = ''; return; }
                if (!saveDatabase(entries)) { alert('The database could not be saved (the browser storage is full or blocked), so nothing was replaced.'); uploadInput.value = ''; return; }
                updateDbSizeBadge();
                clearStaleAnnotations();
                annotateQueueTable();
                alert(`Database replaced with ${entries.length} entries.`);
            } catch (err) {
                if (!err || err.code !== 'cancel') alert('Error reading the file: ' + (err && err.message || err)); // cancel: the password dialog was closed
            }
            uploadInput.value = '';
        };
        document.getElementById('elm-settings-clear-btn').onclick = () => {
            const db = getDatabase();
            if (db.length === 0) { alert('Database is already empty.'); return; }
            if (confirm(`Are you sure you want to delete all ${db.length} entries from the database? This cannot be undone.`)) {
                if (!saveDatabase([])) { alert('The database could not be cleared (the browser storage is blocked).'); return; }
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
        // its own list container when the pane uses them (M3 Expressive list), else right after the Highlight Rows row
        const item = anchor.closest('.elm-item');
        if (item) { const box = document.createElement('div'); box.className = 'elm-item'; box.appendChild(row); item.insertAdjacentElement('afterend', box); }
        else anchor.insertAdjacentElement('afterend', row);
        const uiToggle = document.getElementById('elm-show-db-ui');
        uiToggle.checked = showDbUi();
        uiToggle.addEventListener('change', () => {
            try { localStorage.setItem(UI_KEY, String(uiToggle.checked)); } catch (e) { /* ignore */ }
            applyDbUiSetting();
        });
    }
    setInterval(safely('settings and badge', () => { applyDbUiSetting(); injectDbBadge(); injectDbSettingsSection(); injectDbUiToggle(); }), 1000);

    // =========================================================
    // AUTO-RECORD: poll body[data-csv-dept] set by UI-Perfection-v2
    // =========================================================
    setInterval(safely('recording', () => {
        const dept = document.body.dataset.csvDept;
        if (dept) recordEntry(dept);
        else if (isReviewDetailPage()) trackRecording('the main script has not reported this pair yet (no department signal)');
        else trackRecording('');
        updateDbSizeBadge();
    }), 1000);

    // elm451Debug() in the console prints everything needed to work out why a pair is not being recorded
    window.elm451Debug = function () {
        const d = document.body.dataset;
        let raw = '', n;
        try { raw = localStorage.getItem(STORAGE_KEY) || ''; n = JSON.parse(raw || '[]').length; } catch (e) { n = 'unreadable: ' + e.message; }
        let storageWritable = true;
        try { localStorage.setItem('__elm_probe', 'x'.repeat(200000)); localStorage.removeItem('__elm_probe'); } catch (e) { storageWritable = false; }
        const sparks = getDomSparkIds();
        const info = {
            databaseScript: VERSION, entries: n, storedKB: Math.round(raw.length / 1024), storageWritable,
            onReviewPage: isReviewDetailPage(), mergePanelOpen: mergePanelOpen(),
            mainScriptLoaded: !!window.__elm451UiPerfectionLoaded, viaExtension: window.__elm451Extension || false,
            signals: { dept: d.csvDept, spark1: d.csvSpark1, spark2: d.csvSpark2, choice: d.csvChoice, score: d.csvScore },
            // for the personal file: whether the signed-in person was found, where, and a fingerprint that should read the same every time you are signed in
            login: (() => { const w = currentLogin(); return w ? { found: true, from: w.source, kind: w.kind, fingerprint: w.mark || '(working)', changedInLast30Days: loginChangedRecently() } : { found: false }; })(),
            sparksOnPage: sparks, pageNames: extractNames().full,
            lastProblem: problem.reason || 'none'
        };
        console.log('[Database] state', info);
        return info;
    };

})();
