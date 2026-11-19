// ==UserScript==
// @name         Element451 - Database v2
// @namespace    http://tampermonkey.net/
// @version      2.76
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

    const VERSION = '2.76'; // keep in sync with @version (the build checks it)
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
    // A points total as a whole number, or null when there is none ('' / missing / not a number). Zero and negative totals are real scores.
    function parsePoints(v) {
        if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
        const n = Number(v);
        return isFinite(n) ? Math.round(n) : null;
    }
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
        // Our own score (the Dedup analysis' points, e.g. 80, or -38): the latest one for the pair, kept when the analysis is not on screen
        const seenPoints = parsePoints(document.body.dataset.csvPoints);
        const points = seenPoints !== null ? seenPoints : parsePoints(old && old.points);
        // Scan Date: the day the pair was scanned; it moves to the merge day when the pair is merged
        const scanDate = (old && old.scanDate) || todayStr();
        const newEntry = { firstName, lastName, firstName2, lastName2, dept, rowContents, sparkId1: sparks.a, sparkId2: sparks.b, merged, choice, score, scanDate };
        if (points !== null) newEntry.points = points;
        if (old && old.lostSpark) newEntry.lostSpark = old.lostSpark;
        if (old && old.lostFirst) newEntry.lostFirst = old.lostFirst;
        if (old && old.lostLast) newEntry.lostLast = old.lostLast;
        if (old) {
            if (old.dept === dept && old.firstName === firstName && old.lastName === lastName
                && old.firstName2 === firstName2 && old.lastName2 === lastName2 && old.rowContents === rowContents
                && old.sparkId1 === sparks.a && old.sparkId2 === sparks.b
                && (old.merged || '') === merged && (old.choice || '') === choice && (old.score || '') === score && parsePoints(old.points) === points && (old.scanDate || '') === scanDate) return true;
            db[existingIdx] = newEntry;
            if (!saveDatabase(db)) return 'the browser would not save the database (storage full?)';
            scheduleListAnnotation();
            return true;
        }
        db.push(newEntry);
        if (!saveDatabase(db)) return 'the browser would not save the database (storage full?)';
        scheduleListAnnotation();
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
    // ---- LIST NAMES START (pure helpers, so they can be tested on their own) ----
    // The list call carries no top-level name: a record holds the two contacts as `master` and `duplicate` objects. A person's name is
    // read from one of them (a full-name field, or first + last), looking one object level down when it is not at the top.
    function personName(o, depth) {
        if (!o || typeof o !== 'object' || Array.isArray(o)) return '';
        const pick = (keys) => { for (const k of keys) { const v = o[k]; if (typeof v === 'string' && v.trim()) return v.trim(); } return ''; };
        const full = pick(['name', 'full_name', 'fullName', 'display_name', 'displayName']);
        if (full) return full;
        const joined = [pick(['first_name', 'firstName', 'first', 'given_name', 'givenName']), pick(['last_name', 'lastName', 'last', 'surname', 'family_name', 'familyName'])].filter(Boolean).join(' ');
        if (joined) return joined;
        if (!depth) for (const k of Object.keys(o)) { const n = personName(o[k], 1); if (n) return n; }
        return '';
    }
    // Does the row's text show this name? The whole name, or its first and last word (a middle name or the order "Last, First" is fine).
    function rowShowsName(rowText, name) {
        const n = (name || '').trim().toLowerCase();
        if (n.length <= 3) return false;
        if (rowText.includes(n)) return true;
        const w = n.split(/[\s,]+/).filter(x => x.length > 1);
        return w.length >= 2 && rowText.includes(w[0]) && rowText.includes(w[w.length - 1]);
    }
    // ---- LIST NAMES END ----
    function matchRowToApiEntry(row, apiEntries, usedIndices) {
        const rowText = row.textContent.trim().toLowerCase();
        for (let i = 0; i < apiEntries.length; i++) {
            if (usedIndices.has(i)) continue;
            const entry = apiEntries[i];
            if (rowShowsName(rowText, entry.name) && rowShowsName(rowText, entry.duplicateName)) {
                usedIndices.add(i);
                return entry;
            }
        }
        for (let i = 0; i < apiEntries.length; i++) {
            if (usedIndices.has(i)) continue;
            const entry = apiEntries[i];
            if (rowShowsName(rowText, entry.name) || rowShowsName(rowText, entry.duplicateName)) {
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
    function collectSparkIds(obj, path, out, where) {
        if (obj === null || typeof obj !== 'object') return;
        for (const k of Object.keys(obj)) {
            if (!path && (k === 'ai_analysis' || k === 'feedback')) continue; // free text, not profile data
            const v = obj[k];
            const here = (path ? path + '.' + k : k).replace(/\.\d+/g, '[]');
            if (/spark/i.test(k)) {
                (Array.isArray(v) ? v : [v]).forEach(x => {
                    if (typeof x === 'string' || typeof x === 'number') { out.push(String(x).trim()); if (where) where.add(here); }
                });
            }
            // identities: [{ type: 'Spark_...', <value field>: '<id>' }] -> take the value from the siblings
            if (typeof v === 'string' && /^spark/i.test(v) && !Array.isArray(obj)) {
                ['value', 'id', 'identifier', 'external_id', 'identity', 'key', 'number', 'code'].forEach(f => {
                    if (f !== k && (typeof obj[f] === 'string' || typeof obj[f] === 'number')) { out.push(String(obj[f]).trim()); if (where) where.add((path || '').replace(/\.\d+/g, '[]') + '.' + f); }
                });
            }
            if (typeof v === 'string' && /spark/i.test(v)) {
                let m;
                SPARK_TEXT.lastIndex = 0;
                while ((m = SPARK_TEXT.exec(v))) { out.push(m[1]); if (where) where.add(here + ' (text)'); }
            }
            if (v && typeof v === 'object') collectSparkIds(v, here, out, where);
        }
    }
    function parseApiEntries(entries) {
        const sample = entries[0];
        if (!sample || typeof sample !== 'object') return null;
        const idField = sample._id ? '_id' : sample.id ? 'id' : null;
        const where = new Set();
        const parsed = entries.map((e, i) => {
            const sparks = [];
            collectSparkIds(e, '', sparks, where);
            return {
                uniqueId: ((idField && e[idField]) || 'api-' + i).toString().toLowerCase(),
                name: e.name || e.full_name || personName(e.master),
                duplicateName: e.duplicate_name || personName(e.duplicate),
                sparks: sparks.filter(Boolean),
                raw: sparks.some(Boolean) ? '' : JSON.stringify(e) // only searched when the record gave no Spark IDs (a page of records is not small)
            };
        });
        // what the list call carries, for the console (field names only, never values): where the score chips' Spark IDs come from
        const withIds = parsed.filter(p => p.sparks.length >= 2).length, withNames = parsed.filter(p => p.name.trim().length > 3 && p.duplicateName.trim().length > 3).length;
        const shape = 'records ' + parsed.length + ', with both names ' + withNames + ', with 2+ Spark IDs ' + withIds + (where.size ? ' (from ' + Array.from(where).slice(0, 8).join(', ') + ')' : '') + '; fields of master: ' + (sample.master && typeof sample.master === 'object' ? Object.keys(sample.master).slice(0, 30).join(', ') : '-') + '; fields of a record: ' + Object.keys(sample).slice(0, 30).join(', ');
        if (shape !== lastApiShape) { lastApiShape = shape; console.log('[elm-db] list API: ' + shape); }
        return parsed;
    }
    let lastApiShape = '';
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

    // The row's Spark IDs, for the main script's score chips (it looks the pair's rating up by them). The list API's record is the
    // exact source when it is known to belong to this row; otherwise the database entry the row was matched to (the same match the
    // department chip is drawn from, so the two chips on a row always agree).
    function setRowSparks(row, ids) {
        const list = Array.from(new Set((ids || []).filter(Boolean)));
        if (list.length < 2) { if (row.hasAttribute('data-csv-sparks')) row.removeAttribute('data-csv-sparks'); return; }
        const v = list.join('|');
        if (row.getAttribute('data-csv-sparks') !== v) row.setAttribute('data-csv-sparks', v);
    }
    // Does the row show this record's names? (A record with no usable name cannot be checked: it is taken as fitting.)
    function rowHoldsNames(row, api) {
        const text = row.textContent.trim().toLowerCase();
        if ((api.name || '').trim().length <= 3 && (api.duplicateName || '').trim().length <= 3) return true;
        return rowShowsName(text, api.name) || rowShowsName(text, api.duplicateName);
    }

    // The list stays in the page behind the review sidebar, and its chips follow the profile being viewed, so it is annotated while a
    // profile is open too (it used to be skipped, which left a row without its Spark IDs until the profile was closed).
    function annotateQueueTable() {
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

        if (useDbFallback) {
            if (db.length === 0) { logListTally(rows.length + ' rows, no list data captured and the database is empty: no row has Spark IDs for the score chips'); return; }
            const usedDbIndices = new Set();
            let matched = 0;
            rows.forEach(row => {
                const dbEntry = matchRowToDbEntry(row, db, usedDbIndices);
                if (!dbEntry) { setRowSparks(row, null); return; }
                applyBadge(row, dbEntry.dept);
                setRowSparks(row, [dbEntry.sparkId1, dbEntry.sparkId2]); // no list data was captured (the page loaded it before this script ran): the database entry is the source
                matched++;
            });
            logListTally(rows.length + ' rows, no list data captured: ' + matched + ' matched to the database by name and given its Spark IDs');
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
        // Each row is tied to its record by the names on it (a tie made earlier is checked again: Element451 reuses row elements, so
        // a row can show a different pair than the one it was tied to). Position is only a last resort, and only when most rows
        // matched by name, which shows that the captured data is the data of the page on screen, not of another page.
        const bound = rows.map(row => {
            const uid = row.getAttribute('data-csv-uid');
            const at = uid ? apiDuplicatesList.findIndex(a => a.uniqueId === uid) : -1;
            if (at >= 0 && !usedApiIndices.has(at) && rowHoldsNames(row, apiDuplicatesList[at])) { usedApiIndices.add(at); return apiDuplicatesList[at]; }
            if (uid) row.removeAttribute('data-csv-uid');
            return null;
        });
        rows.forEach((row, i) => {
            if (bound[i]) return;
            const api = matchRowToApiEntry(row, apiDuplicatesList, usedApiIndices);
            if (api) { bound[i] = api; row.setAttribute('data-csv-uid', api.uniqueId); }
        });
        const byName = bound.filter(Boolean).length;
        const tally = { api: 0, apiIds: 0, db: 0, ids: 0 };
        const positionOk = rows.length === apiDuplicatesList.length && byName * 2 >= rows.length;
        rows.forEach((row, rowIndex) => {
            let api = bound[rowIndex];
            if (!api && positionOk && apiDuplicatesList[rowIndex] && !usedApiIndices.has(rowIndex)) {
                api = apiDuplicatesList[rowIndex];
                usedApiIndices.add(rowIndex);
                row.setAttribute('data-csv-uid', api.uniqueId);
            }
            // Spark ID found in the API record first; otherwise name/ID text on the row
            const dbEntry = db.length ? (dbEntryForApi(api, db) || matchRowToDbEntry(row, db, usedDbIndices)) : null;
            // both sources: the list record's IDs and the database entry's (the score chip tries each pair of them against its ratings)
            const ids = [].concat(api ? api.sparks.slice(0, 10) : [], dbEntry ? [dbEntry.sparkId1, dbEntry.sparkId2] : []);
            setRowSparks(row, ids);
            if (api) tally.api++; if (api && api.sparks.length >= 2) tally.apiIds++; if (dbEntry) tally.db++; if (new Set(ids.filter(Boolean)).size >= 2) tally.ids++;
            if (!dbEntry) {
                const b = row.querySelector('.csv-dept-badge'); if (b) b.remove();
                row.removeAttribute('data-csv-dept');
                return;
            }
            applyBadge(row, dbEntry.dept);
        });
        logListTally(rows.length + ' rows: ' + tally.api + ' tied to a list record (' + byName + ' by name), ' + tally.apiIds + ' of those records with Spark IDs, ' + tally.db + ' matched to the database, ' + tally.ids + ' given Spark IDs for the score chips');
    }
    let lastListTally = '';
    function logListTally(line) {
        if (line === lastListTally) return;
        lastListTally = line;
        console.log('[elm-db] list: ' + line);
    }

    let listAnnotationTimer = null;
    // The rows are annotated again shortly after a pair is recorded: the row of the profile being viewed can only be tied to its pair
    // (through the database entry) once the pair is in the database.
    function scheduleListAnnotation() {
        if (listAnnotationTimer) clearTimeout(listAnnotationTimer);
        listAnnotationTimer = setTimeout(annotateQueueTable, 150);
    }
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
        { header: 'Dedup Score', key: 'points', width: 2.6 },
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
            const r = DB_COLUMNS.map(c => c.key === 'points' ? (parsePoints(e.points) === null ? '' : String(parsePoints(e.points))) // 0 and negative totals are scores, not blanks
                : String((c.key === 'choice' && e.merged !== 'Y') ? '' : c.key === 'score' ? capFirst(e.score) : c.key === 'scanDate' ? (e.scanDate || '') : (e[c.key] || '')));
            r.struck = new Set();
            r.nums = new Set(); // columns written as real numbers (Dedup Score), so the spreadsheet can sort and filter them
            r.dates = new Set(); // columns written as real dates (Scan Date), so the spreadsheet can sort and filter them
            const lostCol = { firstName: 'a', firstName2: 'b', lastName: 'a', lastName2: 'b' };
            r.paint = new Map(); // column index -> a key of XL_PAINT: the cell's colour (Bolt Score, Dept., applicant pairs)
            DB_COLUMNS.forEach((c, i) => {
                if (c.key === 'score' && XL_PAINT.some(x => x[0] === 'score:' + r[i].toLowerCase())) r.paint.set(i, 'score:' + r[i].toLowerCase());
                if (c.key === 'dept' && XL_PAINT.some(x => x[0] === 'dept:' + r[i])) r.paint.set(i, 'dept:' + r[i]);
                if (c.key === 'choice' && /^(Applicant|Coyote ID)/i.test(r[i])) r.paint.set(i, 'applicant');
                if (c.key === 'scanDate' && /^\d{4}-\d{2}-\d{2}$/.test(r[i])) r.dates.add(i);
                if (c.key === 'points' && r[i] !== '') r.nums.add(i);
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
            merged: col('merged', -1), choice: col('script vs bolt', -1), score: col('bolt score', -1), points: col('dedup score', -1), scanDate: col('scan date', -1)
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
                ...(parsePoints(get(cols, idx.points)) !== null ? { points: parsePoints(get(cols, idx.points)) } : {}),
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
    function xlsxCell(value, ref, style, isDate, isNum) {
        const attr = ' r="' + ref + '"' + (style ? ' s="' + style + '"' : '');
        if (value === '') return style ? '<c' + attr + '/>' : '';
        if (isNum) return '<c' + attr + '><v>' + Number(value) + '</v></c>';
        if (isDate) return '<c' + attr + '><v>' + excelSerial(value) + '</v></c>';
        return '<c' + attr + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(value) + '</t></is></c>';
    }
    function buildXlsx(rows) {
        const nCols = DB_COLUMNS.length, nRows = rows.length;
        const cols = DB_COLUMNS.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.round(c.width * 5.4 * 10) / 10 + '" customWidth="1"/>').join('');
        const sheetRows = rows.map((r, ri) => '<row r="' + (ri + 1) + '">' +
            DB_COLUMNS.map((c, ci) => xlsxCell(r[ci] == null ? '' : String(r[ci]), colLetter(ci) + (ri + 1), ri === 0 ? 1 : (r.dates && r.dates.has(ci) ? 3 : r.struck && r.struck.has(ci) ? 2 : r.paint && r.paint.has(ci) ? 4 + XL_PAINT.findIndex(x => x[0] === r.paint.get(ci)) : 0), !!(r.dates && r.dates.has(ci)), !!(r.nums && r.nums.has(ci)))).join('') + '</row>').join('');
        // One filter over the whole table, with the buttons hidden on every column except Bolt Score, Dept. and Merged.
        const filterKeys = ['score', 'points', 'dept', 'scanDate', 'merged'];
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

    // ---- Generated passwords (the Generate buttons in the password dialog). Everything comes from crypto.getRandomValues. ----
    // A uniform random whole number 0 .. n-1 (draws past the last full multiple of n are thrown away, so no value is likelier).
    function randomBelow(n) {
        const a = new Uint32Array(1), limit = Math.floor(0x100000000 / n) * n;
        do crypto.getRandomValues(a); while (a[0] >= limit);
        return a[0] % n;
    }
    // Random password: 12 characters from 69 (about 73 bits), at least one of each kind. Characters easy to confuse when the password is
    // read out or typed from a note (l 1 I O 0) are left out, and the symbols are ones every keyboard has.
    const GEN_SETS = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%&*?-_=+'], GEN_LENGTH = 12;
    function randomPassword() {
        const all = GEN_SETS.join('');
        for (;;) {
            let p = '';
            for (let i = 0; i < GEN_LENGTH; i++) p += all[randomBelow(all.length)];
            if (GEN_SETS.every(set => Array.from(p).some(c => set.includes(c)))) return p; // redrawn until every kind is in it
        }
    }
    // Passphrase: three words from the EFF Large Wordlist for Passphrases and a number 100-999, e.g. "maple-orbit-tundra-482"
    // (about 48 bits: weaker than the random password, but easy to say to a coworker and to type).
    // Word list: Electronic Frontier Foundation, https://www.eff.org/dice, CC BY 3.0 US, without its four hyphenated words and without
    // 680 words that could be awkward in a password people share at work (health, disability, bodies, sex, religion, death, violence,
    // crime, politics, insults): 7,092 words.
    // Stored front-coded to keep the script small: each word is a digit (how many letters it shares with the word before) and the rest.
    const EFF_WORDS_FC = '0abacus2ide4ing3lity2laze3e2rasive3east3idge3oad3uptly2sence5tee6ly3inthe3olute5ve3tain4ract3urd1ccent3laim4imate3ompany4unt3uracy6te4stom2etone2id2orn2quaint4ire2re3obat4nym2ting4on4vate7or5e5ism7t6ty3ress3s2utely5ness1eration3obics4sol5pace1far2fair3ected6ing7on3idavit4liate4rm4x3luent3ord3ront2lame3oat3utter2oot2raid2terglow5math6ost5noon1ged3less3ncy4da4t2gregate2hast2ile4ity3ng2reeable8y5d5ing5ment3ound1head2oy1ide2m1jar1labaster3rm2batross3um2falfa2gebra3orithm2ias3bi3enable3ke3ve2kaline6ze2manac3ost2oe3ft3ha3ne4gside3of2phabet2right2though3itude3o2uminum4ni2ways1maretto3ze4ingly2ber3iance4guity6ous4tion7us2endable5ment5s4ity2iable3cably3d3go3no3ss2monia6um2nesty2ong3unt2perage3le4ifier6y4y2uck3let3sable4ed5ment5r4ing1naconda3erobic3gram2chor5vy3ient2droid2ew2gelfish5ic3led5r5s4ing3ular2imal5te6ing7on6or4e2kle2nex3otate4uncer4ying3ually4ity2other2swering2tacid4rctic3eater4lope4nnae3hem4ill4ology3ibody4cs4dote4hero4quely7s6ity4rust4toxic5rust4viral7us3ler3onym3sy2vil2ybody3how3more3one3place3thing4ime3way4here1ppealing5r5se6ing4tite6zer3laud6se4e4iance5cant5ed4y3ointee3raisal7er4ehend4oach5val6e2ricot4l3on2titude3ly1qua3educt1rbitrary7te2dently2ea3na2guable7y4e2ise2madillo3band3chair3ful3hole3oire4red3rest2oma3se3und2range4y3ival5e2t1scend5t4rtain2hen3y2ide2kew2leep2paragus3ect3irate5e5in2tonish4und3ride4ology5naut6omy3ute1tlantic4s2om3nable3p2rium2tach4in3empt4ndant6ee5tion7ve4st3ic4re4tude3ractor4ibute2ypical1uction2dacious6ty3ible6y4ence4o4tion2gmented3ust2thentic4or3ograph4maker6ted7ic4pilot1vailable3lanche3tar2enue3rage4sion4t2iation5or3d2oid1wait3ken3rd4e2hile2kward2ning2oke2ry1xis0babble5ing3ied3oon2ckboard6ned4drop4ed5r4field6re4hand4ing4lands6sh5ess5ight6t5og4pack5edal4rest5oom4shift5ide5lid5pace6in5tage4talk5rack4up4ward6sh6ter4yard3on2dge3land4y3ness2ffle5ing2gel3ful3gage4ed4ie5ness6g4y3pipe3uette2ked4ry4shop3ing2lance6ing3cony3my3samic2mboo2nana3ish5ter3jo3kable4book4ed5r4ing4note4roll3ner4ister3shee3ter2rbecue5d5ll5r3code3ge4raph3ista4tone3ley3n3ometer3rack6uda4el5tte4icade5er3stool3tender5rer2sh3ically5s4l4n4s3ket2tboy3ch3h3on3s3tery4ing2uble1labber3de3h3me4ing3nching4dness4k3st3tancy6tly3zer4ing2each4k3ep3mish3nd2imp3ng4ked6r5ing5s3p3ssful3tz3zzard2ob3g3oming4per3t3use2uff3ish3nderer4t3rb4red5y4t3sh4tery1oaster5ful5ing3t2bbed4ing4le3cat3sled3tail2dacious2gged4le3us2il2k2lster3t2nanza3ded4ing4less3eless5ike4y3fire3net3sai3us3y2ogeyman4ieman3k3ndocks3ted4h4ing4lace5eg4s2rax3ing3ough3rower6ing2ss2tanical6st5y3ch3h3tle5ing2unce5ing5y4ding5less4tiful2vine2xcar3er3ing3like3y1reach4th3eze5y3wery4ing2iar3ck3de4ged3gade4ht3lliant3m3ng4k3sket5ly5ness4tle3ttle2oadband5cast5en5ly5ness5side5ways3iler5ing3ken5r3nco4ze5ing3ok4m3ught3wbeat4se5ing2unch4ette4t3sh4sels1ubble5ing5y2ccaneer3ked5t4le4shot5kin4tooth4wheat2dding4y3get2ffalo4ed5r4ing2ggy2lb3ge4iness4ur3k3ldog6zer4frog4horn4ion5sh4pen4ring4seye2nch3dle3gee3kbed4house4mate3ny3t2sboy3h3ily3load2zz0cabana3bage4ie3driver3le3oose2che3kle3ti4us2ddie4y3et3illac3mium2ge2hoots2ke2lamari3cium4ulate6us3ibrate3m3oric6e3zone2mcorder3eo4ra3isole3per4fire4ing4site4us2nal4ry3cel3died4le4y3e3ine4ster3ned4ing4ot3ola4n4pener5y3teen3yon2pable6y4city3e3ital5ol3ped3ricorn3size4ule3tion5vate4ure2ramel4t4van3bon3dboard4ed4igan5nal4stock3efully4giver4less4ss4taker3go3ing3less4oad3maker3nation4ival6ore3ol3penter7ry4ool5rt3ried4ot5usel4y3tel4load4on5on4ridge4wheel3ve4ing3wash2scade3e3h3ing5o3sette3ually2talog5yst6ze4pult4ract3chable5er5ing5y3erer5ing3fish3like3nap4ip3sup3tail4le3walk2ucus3sal5tion4e4ing3terize4ion6us2valier5ry3iar4ty1edar2lery4stial2ment2nsus2ramics3emony3tainly7ty4ified6y1hafe4fing3in4r3lice4lenge3mber4omile4pion3nce4ge4nel4t3os3perone4ped4s4ter3racter4broil4coal4ger5ing4iot5ty4m4red4ter5ing3se4ing3troom4ter5ing5y2eddar3ek4r4se5y3f3micals5st3risher4ub3ss4t3vron4y3wable4er4ing4y2ief3huahua3ldcare5hood5ish5less6ike4i4l3mp3p3rping5y3tchat3valry4e2loride6ne2oice3mp3oser5ing5y3p3sen3wder4time2rome2uck3g3mmy3nk3rn3te1ider2lantro2nch3ema3namon2rcle5ing4ular7te5s2table4del4tion3izen3ric4us3y2vic4l1lad3im3mbake4my4or4p4shell3ng4king3pped6r5ing3rify5net5ty3sh4p4s3tter3use3vicle3w3y2ean4r4t4ver3ft3nch3rk3ver2icker3ent3mate6ic3ng4ic4king3p3que2oak3bber3ck3ne4ing3sable4ure3thes5ing3ud3ver2ubbed5ing4house3mp4sily5y3nky3stered3tch4ter1oach3stal5er5ing5land6ine3t3uthor2balt3bler3web2coa4nut2d2editor3rce3xist2ffee3ounder2gnition7ve3wheel2herence7t4sive2il2la3d3eslaw3iseum3lage5pse5r4ected7or4ide5e5sion3onial6st6ze5y4ssal3t2me3fort4y3ic4ng3ma4ence6d6t5rce4odity6ore5n5tion4ute6ing3pacted8r7ly7or5nion6y5re4el4ile4ly4onent5sed7r6ite6t6ure5und4ress5ised4uter6ing3rade2ncave4eal5ded5pt5rned6t4h4ierge5se4lude4rete4ur3dense4iment5tion4one4ucive6tor5it3e3fess5tti4idant6ent7r6ing5gure5ned6ing5rm4lict4orm5und4ront4used6ing7on3genial5sted4rats5ess3ical3joined4ure6or3nected7or3sensus6t4ole6ing5nant4table6nt5rain6ict6uct4ult5mer6ing3tact5iner4empt5nd6ted7ly7s5st5xt4ort5ur4rite5ol3vene2partner3e3ied5r4lot4ng4ous3per3y2ral3k3nball5read4cob4ea5d5r4field5lake4husk4meal4stalk4y3poral7te3ral4ect4idor4ode6ing5sive3sage2signer3metics4ic4os3ponsor3t2ttage4on2uch3gh3ld3ntable5down5ing5less5ry5y3rier2venant4r4ted5ing2yness2zily4ness3y1rabbing4grass4like4meat3dle5ing3fter5ily5sman5work5y3nberry4e4k3te3ve4ing3wfish4lers5ing3yfish4on2eamed6r5like4se5ing4table5e5ion6ve5ure3dible7y5t3me3ole3pe4t3scent4ted5ing5less3vice3wless4man6te2ib3cket3ed4r3mp4son3nging4kle6y3sped5ing5ly5ness5y3teria4ter2oak3ck3on3p3ss3uch4ton3wbar4d4n2ucial3dely5ness3mb4miest5y4pet5led3ncher6ing6y3shable5ed6r5ing4t3x2yptic3stal1ubbyhole3e3ical5le2cumber2ddle5y2fflink2linary3minate3pable3tivate4ural6e2pbearer3cake3id3ped4ing2rable4tor3dle3e3few3ing3led5r4iness6g4y3ry3sive4or3tain4ly4sy3vature4e4y2shy3p3tard4odian6y5mary6er6ize6s2t1ycle4ic5ng5st2linder2mbal2toplasm8t0dab2d2ffodil2ily3ntily5y3ry3sy2llying2nce4ing3delion5r4y3ger4le5ing2redevil4s3ingly3kened6ing4ish4ness4room3ling3n3t2sh3tardly2ta3ebook3ing2ughter3nting2wdler3n2ybed4reak3care3dream3light4ong3room3time2zzler5ing1ealer4ing4maker4t3n2batable5e5ing3it3rief3tless4or3ug4nk2cade4f4l4thlon3ember4ncy5t3ibel4dable4mal5eter4pher3k3lared4ine3ode4rated7or4y3rease5e2dicate7or3uce5t2ed3m3pen4ly4ness2face5ing4me4ult3eat4ction7ve4ndant6er5se6ive4rral6ed3iance6t4ne5ite3late6ion6or4ected7or3og4rest3raud4ost3tly3use3y2graded6ing4ease5e2hydrate2jected2lay3egate7or4te5ion3icacy6te5ious4ghted4verer7y3ta3uge4xe2manding3eanor3ote5ion3ystify2natured3iable5l4m3ote3se4ity3tal4ist3y2odorant6ize2parture3ict3lete6ion4ored5y3ose3recate4ive3th3utize5y2rail3by3ived2serve6ing3ignate6ed7r6ing3kbound4top4work3pise5te3tiny4ruct2tached4il3ection7ve6or4rgent4st3oxify3ract2uce2value3iate6ion6or4ce4ous3otedly6e5ion4urer6ing5tly2xterity6ous1iagram3l3meter3ry2ce3ing3tate6ion2fficult4used7r6ion7ve2g2lation3igence7t3l3ute2me3inish3ly3med5r3ness3ple2ner3ghy4iness4o4y3ing3ner2oxide2ploma3ped5r4ing2rected6ion7ve6ly6ory4ness3tiness2sagree4llow4rm5ray4ster3band4elief4urse3card4ern4harge4lose4olor5unt6rse5ver4uss3dain3engage3h3infect3join3k3like6ing4odge3mantle5y4iss4ount3obey4rder4wn3parate6ity5tch4ense5rsal7ed8r4lace6y5ease4osal6e4rove4ute3regard4upt3suade3tance6t5ste4ill5nct4ort4ract5ess5ict5ust2tch3to2vidable5ed6nd6rs5ing4ng4sible8y6on6ve2zzy1oable2cile3k3ument2dge4y2ily3ng2le3lar4house4op4y3phin2main3elike4stic3inion5oes2nated5ion5or3or3ut2odle3rbell4frame4knob4man6t4nail4post4step6op4way3zy2rmitory3sal2sage3e2tted2ubling2ve2wn2ze1rab3gging4onfly6ish4ster3inable6ge5ed6r5pipe3matic7ze3nk3pery3stic3w2eaded5ful5lock4mboat5ily5land6ess6ike5t5y4rily5y3nch3ss3w2ibble3ed4r3ft3ller5ing3nkable5ing3pping5y3vable4en5r5way4ing3zzle6y2one3ol4p3pbox4kick4let4out4per3ve3wsily2udge3m2y1ubbed3iously2chess3kbill4ing4ling4tail4y3t2de2ffel2gout2h2ke2ller4ness3y2mping4ling4ster2o2pe3lex4icate6ity2rable6y4tion3ess3ing2sk3t2tiful3y2vet1welled6r5ing2indle6ing1ynamic6te4sty0each2gle2rdrum3flap4ul3lobe4y3mark4uff3phone4iece4lugs3ring3shot3then5like7ng6y5worm5y3wig2seful4l3iest4ly4ness5g3tbound4coast4ward2table3en4ry3ing3s1bay2ony3ok1card2centric2ho2lair3ipse2ologist6y3nomic7st6y3sphere4ystem1dge3iness5g3y2ition4or2ucated6ion6or1el1ffective6s3icient3ort1ggbeater3ing3nog3plant3shell1ither1ject1laborate3stic3ted2bow2dest2ectable5ion6ve3phant3vate6ing7on6or4en2f2igible7y3minate3te4ism3xir2k2lipse5tic2m2ongated3pe3quence7t2sewhere2ude3sive2ves1mail2bargo5k4ssy4ttled3ellish4r3laze4em3ody4ss3roider2cee2erald4gency2ission3t2ote4icon5on2pathic6y3eror3hases6is7ze5tic3irical3loyed7e7r3orium4wer3tier5ness4y2u1nable3ctment3mel2chanted4ilada3ircle3lose6ure3ode4re4unter5rage3roach4ust4ypt2danger3eared6ing4d3ing3less3note3orphin5se4wment3point3urable6nce5ing2ergetic5ize5y2forced7r2gaged5ing3ine3raved7r6ing4oss3ulf2hance2igmatic2joyable8y5er5ing5ment2larged6ing3ighten4sted2quirer2rage3ich3oll2snare3ure2tail4ngled3ering5tain3icing4re4tle5y3ourage3rap4ee5nch4ust4yway3wine2unciate2velope3iable7y4ous4sion3oy3y2zyme1pic3logue3phany3sode1qual4te5ion5or3inox4pment4ty4vocal1radicate3sable4ed5r4ure2gonomic2rand5t4tic3or2upt1scalate7or4pable6de5ist4rgot2pionage3resso2quire2say3ence5tial2tablish4te3eemed3imate7or3ranged1tching2ernal5ity2hanol3er3ically5s1uphemism1vacuate5ee3de3luate7or3porate3sion5ve2en3rglade5reen4ybody5day5one2idence6t2oke3lution4ve1xact3lted3mple2cavate7or3eeding4ption4ss3hange3itable5ing3laim4ude6ing5sion7ve3ursion4sable8y5e2emplary6ify5tion3rciser4t2foliate2hale4ust2isting3t2odus3nerate2pand5se6ion7ve3ectant4dited8r4l4nd5ses6ive4rt3ire5ing3lain4icit4ode5it5re6ing3onent4rter4sable5e5ure3ress3ulsion2quisite2tended6ing5t5uate4rior5nal3inct3radite5s4overt4ude6ing2uberant0fable3ric3ulous2cebook4cloth4down4less5ift4plate4ted3ial4lity4ng3simile3tion4oid5r4sheet4ual3ulty2de3ing2iling2lcon3l3se4ify2me3iliar5y2ncied5ness4y3fare3g3ning3tasize6tic6y2stball4er4ing4ness2ucet2vorable8y5ed5ing6te2x1east2deral3ora2eble3d3l2isty2line2nce4ing3der2rment3nlike3ocious6ty3ret4is4y3vor2stival6e6ity2tch1iber2ction2ddle5ing3elity3geting6y2fteen4h4ieth4y2gment3ure5ine2ling3led5r4ing3m3ter4rate2nale5ist6ze5ly4nce6ial3ch3eness4r3icky4shed7r6ing4te3less4ike2scally2t2ve1lagman4pole4ship5tick6one3il3kily4y3me4mable3nked5ing4nels3p3ring3shback6ulb5card5ily6ng5y4k3tbed4foot4ly4ness4ten6red8r7y5op4ware5orm3vored6ful6ing3xseed2ed2ick3er3ght3nch4g4t3p2oat3ck3p3ral4ist3ss3under2yable4way3er3ing3over3paper1oam2e2g2il2lic3k3low2ndly4ness4ue3t2od3tage4ball6th5oard4er4gear4hill5old4ing4less4man4note4pad6th5rint4rest4sore4wear5ork2ssil3ter2under5ing4tain2x2yer1raction3gile6ity4ment4rance7t3me4ing3ntic3ternal3yed4ing4s2eckled7s3ebee5ie4dom4fall4hand4ing4load5y4ness4style4ware6y5ill4zable5ing3ight3nch4zied5y3quency7t3sh3tful4ted2iction3day4ge3ed4nd3ghten6ful3ll3nge3sbee4k3tter3volous2olic3m3nt3sted5ily6ng5like5y3th3wn3zen2uctose3gality6ly3it3strate2ying0gab2ffe2infully4ing4s2la3lantly4eria6y5y4on3ore3vanize2me3ing3ma2nder3gly4way2p2rage3bage3den3gle3land4ic3ment3net4ish2s2therer6ing3ing2uging3ntlet3ze2ve2wk2zing1ear2cko2ek2iger2m2neric5ous4tics3re3tleman5y4s2ography3logic7st6y3metric7y2ranium3bil3micide5nate4less4proof2sture2taway3ting3up1iant2bberish3let2ddily5ness4y2ft2gabyte4hertz4ntic3gle5ing5y2lled4s2mmick2veaway4n4r3ing2zmo3zard1lacial5er3de4iator4ly3morous5ur3nce5ing3re4ing3ss3zing2eaming3eful2ider4ing3mmer4pse3sten3tch4ter4zy2oater5ing3omily5y3rified8r6y5ous4y3ss3ve3wing4worm2ucose3e3ten4inous1narly3t1oal3tskin2es2ggles2ing2ldfish4mine4smith3f3iath2ndola3e3g2od3ey3fball4iness4y3gle2pher2rged5ous2sling3sip2thic3ten2wn1rab3ceful5less4ious3dation4ed5r4ient5ng4ually6te3ffiti4ted5ing3in3nddad5kid5ly5ma5pa5son4ite4ny4ola4t4ular3pe4h4ple6ing3sp4s3tified6y5ng5tude4uity3vel5ness4itate6y4y3y3zing2easily3edily5less5y4n4ter5ing3w3yhound2id3ll3mace6ing4e4iness4y3nch4ning3p3stle3t2oggily5y3om4ve5ing5y3und4ped4t3ve3wer4ing4l2ub3dge5ing3eling3ffly3mble6ing6y4pily3nge4t1uacamole2idable5nce4e4ing3leless3se2lf3lible4y3p2mball3drop3miness6g4y2rgle5ing3u2sh3to4y2ts3ter2y2zzler1yration0habitable6nt6t5ual2cked5r4ing4saw2d2ggler2iku2lf3ogen3t3ved5s2mburger3let3mock3per3ster5ring2ndbag6ll5ook5rake4cart5lap7sp5raft4ed4ful4grip4held4iness5work4lebar6d6r5ing4made4off4pick5rint4rail4saw5et5free5hake5tand4wash5ork6ven5rite4yman3gnail4out4up3kering4ie4y2phazard3pening4ier6st5ly5ness4y2rbor3dcopy6re6ver4disk4ened7r6ing4hat5ead4iness4ly4ness4ship4ware5ired5ood4y3mful4less4onica8s7ze6y3ness3pist3sh3vest2sh3sle3te4ily5ness4y2tbox3chback5ery6t5ing5ling3less2unt2ven2zard3elnut3ily4ness5g3y1eadache4band5oard4count4dress4ed5r4first4gear4ing4lamp5ock4phone5iece4rest5oom4scarf5et5tand4way5ear3p3t3ve4ily5ness6g2dge4ing2ftiness4y2lium3met3per4ful4ing4less5ine2mstitch2nce3na2rald3bal4icide4s3itage3mit3oics5sm3ring3self3tz2sitancy7t6te2xagon1ubcap2ddle5ing2ff2g2la3k3l2man3ble5ing5y3id4lity3ming4us3ongous4rist5less5ous3pback3vee2ndredth3ger4rily5y3k3ter4ing4ress4sman2rdle3led5r4ing3ray4icane5ed4y3t2sband3h3ked4iness2t1ybrid2drant5ted6ion4ogen5xide2perlink5text3hen3noses6is5tic7sm8t7ze0ibuprofen1ce2iness4g2ky2on2y1dealism7t6ze5ly5ness3ntical6fy6ty3ology2iom2ly1gloo2nition3ore2uana1llusion6ve1mage4inary6es6g2itate6ion2mature3erse6ion3inent3obile4rtal4vable8y3unity6ze2part4tient3each4ding4nding4rfect5ial3ish3lant4ement4icate6it4ode5sion7ve4y3olite4rtant6er4se5ing4und3recise4int4omptu5per5ve6ing7se4udent3ulse6ive1odine4ze2n1pad2hone2od1rate2k2on2regular3igate4table8y6nt6te1solated6ing7on3tope2sue4ing1talicize6s2em2inerary2unes1vory2y0jab2ckal4et4knife4pot2lapeno2m2nitor3uary2rgon3ring2smine2unt2va2wed3less4ine3s2ybird3walker2zz1eep3ringly2llied4y2rsey2ster2t1iffy2gsaw2mmy2ngle5ing3x2tters6y1ob2ckey2gger4ing2hn2ining2kester3ingly2lliness4y3t2t2vial2yfully3lessly3ous3ride3stick1ubilance7t2dge4ingly3icial7ry3o2ggle5ing2ice4iness4y2jitsu2kebox2ly2mble4o3p2nction5ure3e3ior4per3kman4yard2rist3or3y2stice5fier6y4ly4ness2venile0kabob2ngaroo2raoke4te1ebab2enly4ness3p2g2lp2nnel2pt2rchief3osene2ttle1ick2ln3obyte4gram4meter4watt3t2mono2ndle5ing5y4ness4red3etic3folk3g3ship4man4woman2tchen3e3ten4y2wi1leenex1napsack2ee3lt2oll1oala2oky1rypton1udos2ng0labored6r5ing6ous3rador2dder3ies3le3ybug4like2gged4ing3oon2ir2ke2nce3ded4fall5ill4ing4lady5ess5ine5ord4mark6ss4owner4scape5ide5lide3guage3kiness4y3tern2pdog3el3ped4ing3top2rd3ge3k2sh3so3t2tch3e3her3itude3rine3ter4iced2unch4der5ry3rel2vender3ish2zily4ness3y1ecturer2ft2gacy4l3end3ged4ings3ible6y4slate3o3room3ume3warmer4ork2mon2nd3gth3s3t2otard2sser2tdown3hargic7y3ter4uce2vel4rage5s3itate7or1iability4le2berty3rarian6y2cking3orice2d2fe3ter4ing4off2gament2kely4ness4wise3ing2lac3ly3y2mb3eade4light4s3it3pness2ne3go4uini6st3ing3ked3oleum3seed3t2on2p2quefy5ur4id2st2tigate7or3mus3ter4le2vable3ed4ly4r4stock3idly4ng2zard1ubricant7te2cid3kily5ness4less3rative2dicrous2gged2kewarm2llaby2mber3inance5ous3piness6g5sh2nar3chbox5eon5room5time3g2rch3e3idness3k2shly4ness3ter4rous2xurious5y1yrically5ism7t5s0macarena5oni4w3e3hine6ist2gazine3enta3ical5ian3ma3nesium5tic7sm7ze4ifier6y5tude4olia2hogany2jestic6y3orette5ity2keover4r4shift3ing2lt2ma3mal2nager5ing4tee3darin5te6ory4olin3ger4le4o4y3handle4ole3icotti5ure4festo4la3kind3like3made3ned3or3power3tis4ra3ual3y2p2rathon4uding3bled6s5ing3ch3di3garine7ta4in3igold4na5e4tal5ime3lin3malade3oon3ried4ow4y3shland5y4upial3velous2scot3hed4ing3sager4es4ive3tiff2tador3chbook7x5er5ing5less3erial5nal3h3riarch5mony5x4on3ted5r3urely5ing6ty2uve2verick2ximize5um2ybe3day3flower1obile5ity6ze2cha3ker4up2dified5y3ular6tor5e2isten5ness5ure2lar4sses3d3ecular7e4hill3lusk2m2nastery3day3etary5ize4ybags5less5wise3goose3itor3khood3ogram4logue4poly4rail4tone5ype4xide3sieur4oon4trous3thly3ument2ocher3diness4y3ing3nbeam4ed4light6ke6t4rise4scape5hine5tone4walk2p2rale5ity5ly3phing3se2saic3sy3t2thball4proof3ion4vate7or5e3ocross4r3to2untable6in5ed5ing3se4iness4tache4y3th2vable3e3ie4ng2wer3ing1uch3k2d2g2lberry3ch3e3led5ts3tiple7y5task6ude2mble5ing4o3my2nchkin3dane3icipal2ppet2ral3kiness4y3muring2scular3eum3hily5ness4room4y3ic3kiness4y3tang5rd4er4iness4y2table4te5ion3iny3t3ual2zzle1yself3pace3tified6y2th0nacho2g2il2me3ing2nny3ometer2pe3kin3ped4ing2rrow2stily5ness2tional4ve3ural5e5ist2utical2vigate7or3y1earby4est4ly4ness3tly4ness2bula5izer2ctar2gate5ion6ve3lector4igent3otiate2meses5is2on2phew2rvous4y2st2t2urology5n3tron2ver2xt1ibble2ckname2ece2fty2mble5y2neteen5ieth3ja3tendo4h1uclear5i5us2gget2llify2mber4ing4ly4ness3eral6te7or5ic5ous2rsery4ing3ture2tlike3meg3rient3shell2zzle1ylon0oak2sis2t1bedience7t2ject2ligate5ed4vion7us3ong2oe2scure6ity3ervant6er6ing4ssed6ion7ve3olete3tacle4inate4ruct2tain3rusive3use2vious1ccupancy7t5ier5y2ean3lot2tagon4ne3ober4pus1il2nk3tment1kay1ld2ive2ympics1mega3n2inous3ssion3t2nivore1nboard2coming2going2ion2line3ooker3y2screen3et3hore3laught3tage2to2ward2yx1ops2ze3y1pacity3l2en3rable5te6ing7on7ve6or2ossum2ponent4se5ing6te2t2ulently1smosis1ther2ter1uch2ght2nce2tage3back4id4oard5und4reak4urst3class4ome3dated4oors3er3field5t4lank3going4row3ing3last4et4ine4ook4ying3match4ost3number3played4ost5ur4ut3rage5nk4each4ight3score4ell4hine5oot4ider4kirts4mart4ource4poken3takes4hink3ward4eigh4it1val2en3ract5ll5rch4bid6ll6te5lown5oard6ok5uilt4cast5oat6me6ok5rowd4draft7wn6ess6ive5ue4eager5xert4fed6ed5ill5low5ull4grown4hand7g6ul5ead7r7t5ung4joyed4kill4labor6id6p6y5oad6ok6rd5ying4night4pass6y5lant7y5ower5rice4rate5each8t5ide6pe5ule6n4shoot7t5ight6zed5leep5old5pend5tate7y6ep6ock6uff5weet4take5hrow5ime5ly5one5ure7n4use4value5iew4write1wl1xford2idant5tion4ize6ing2ygen1yster1zone0paced3ific6er6sm7t5y2dded4ing4le5ing3lock2ger3ing2jamas2lace4table3m3pable4itate3try2mpered7r4hlet2nama3cake3da3g3handle3ic3ning3orama7ic3ther4omime4ry4s2parazzi4ya3er3rika3yrus2rabola4chute4de5ox4graph4keet4legal4medic6ter5ount4sail3cel4hed5ment3don3ish3ka4ing4way3lor3mesan3rot3sley4nip3take4ed4ing5tion4ly4ner4ridge4y2ssable7y5ge4code4enger5rby4ing5on5ve6ism4port4word3ta4ed5l4ime4rami4ure4y2tchwork5y3ernal3h3ience6t4o3riot4ol5nage6ize2uper2vement4r4stone3ilion4ng2wing2yable3back3check3day3ee4r3ing3ment3phone3roll1ebble5y2can3tin3uliar2ddling3iatric4cure4gree3ometer2gboard2lican3let3t2nalize5ty3cil3dant4ing3holder3knife3nant4y3pal3sion3tagon2p2rceive5nt4h4olate3ennial3fected7ly4ume3iscope3kiness4y3m3oxide3petual4lexed3severe4uaded8r2sky3o3simism8t3ter4icide2tal3ite5ion3ri4oleum3ted4icoat5ness4y3unia1hantom2oenix3nebook5y4ics5ness4y3sphate3to2rase5ing1lacard5te4idly3nk4ner4t3sma4ter5ic3ted4form4ing6um4onic4ter4ypus3usible8y3yable4back4er4ful4group4house4ing4list4maker6te4off4pen4room4set4thing5ime3za2eading4t3dge3ntiful5y3thora3xiglas2iable2od3p3t3w3y2uck3g3nder4ging3ral3s3tonium2ywood1oach2d2em3t2go2inted6r5ing5less5y3se4on2ker3ing2lar3ice5y4sh4tely3ka3o3yester4gon5raph4mer2ncho3d3y2pcorn3lar3per4y3sicle3ulace6r6te2rcupine3k3ous3ridge3table5l4folio4hole4ion4side2ser3h3ing3sible7y4um3tage5l4box4card4ed5r4ing4ure4war2uch3nce5ing4d3ring3t2wdered6ing6y3er1raising3nce5ing4ker5ish5ster2eamble3cinct5se6ion4ook4ut3dator4efine4ict3face4ix4light4ormed3game3heated3launch5w4ude3miere5ses5um3occupy4rder3paid5y4lan4py3school5ribe4eason5t4how4ident4oak4s4ume6ing3teen5nded8r6se5xt4ty4zel3vail5lent4ent4iew5ous3war5shed2ideful3ed3mal5rily6y5te4er4p3ncess4t3or3sm4sy4tine3vacy5te6ize3ze2oactive3bable7y4e4ing5otic4lem3cedure5ss4laim4urer3digal6y4uce6t3fessed7or4ile4ound4usely3gram5ess3jector3logue5nged3menade4inent4oter6ion4pter6ly3ne4g4ounce4to3ofing5read5s3peller5rly6ty4onent5sal6e4s3rate3tector5gee4on5type5zoan4ract5ude3ud3vable4ed5n4ided7r6ing5nce6g4oke6ing5lone3wess4ling3ximity4y2une4ing2y1ublic5sher2cker2eblo2g2ll3p3sate4e3verize2ma3ice3mel2nch4tual7te6red3gent3isher3k2pil3pet4y2rchase3ebred4ly4ness3ge4ing3ifier5y4st4ty3ple5ish4osely3r3se4uable6nt5it3veyor2shcart5hair4er4iness6g4over4pin4up4y2tdown3t2zzle5ing1yramid2thon0quack3drant3il4ntly3ke4ing3lified8r6y5ty4m3ntum3rrel5y4tered7ly7s6t2ench3ry2icken5ly5ness5sand6tep3et3ll4t3ntet5uple3rk3t3ver3zzical2otable5tion4e0race3ing3k3oon2dar3ial5nce6tly5ted6ion6or4o4sh2ffle3t2ge3ged3ing3weed2ider3lcar4ing4road4way3sin2ke3ing2lly2mble5ing3p3rod2nch4idity3dom3ged5r4ing3ked4ing3sack3ting4s2re3ity2scal3h3ping2vage3en3ine5g4oli4shing1eabsorb3ch4quire4tion6ve5or3ffirm3m3nalyze3ppear5ly5oint5rove3rrange4view3son4sign5ure3ttach3wake2balance4te3el3irth3oot4rn4und3uff4ild6t4rial4ttal2call4nt4pture4st3ede4nt4ss3harger3ipient4tal5e3kless3laim4iner6ing4use6ive3ognize4il4llect5or4ncile5firm5vene4py4rd4unt5p4very3reate3tal5ngle4ified6y3ycled7r6ing2emerge3nact4ter5ry3xamine2ferable5ee6nce3ill4nance5ed6ry5ing6sh3lected7or5x4ux3ocus4ld4rest5mat6ed7r6ist3ract5in4eeze5sh4ied3ueling4nd4rbish5nish4sal5e5ing4table5e2gain4lia5ly3gae3ime4on4ster6rar7y3ress5tful4oup3ular6te7or2heat3ire3ydrate2imburse3ssue3terate2joice6ing5n2kindle2latable5ed5ion6ve4x4y3earn5se4nting3iable7y5nce6t4c4eve6ing4ght4sh4ve3oad4cate5k3uctant3y2make4rk5ry4tch3edial5y4mber3inder6ful4x3nant3odeler4ld4rse4te4vable6l5ed6r5ing2name3derer6ing4ition3egade4wable8y6l5ed3ounce4vate7or3table5l4ed5r2occupy6r3pen3rder2package6ing4int5r4ve4ying5ment3eal5ted7r3hrase3lace5y4ica4y3orter4se5sess5t3ressed4imand5nt5se4oach5cess5duce5gram3s3tile6ian3ulsion4rpose4table8y2quest4ire5site2route3un2sale4mple3cuer3eal5rch4lect5ler4mble4nd5t4t3hape4oot4uffle3idence8y7t5ual6e4gned4lient4stant6ing4ze3olute5ved4nant6te4rt4urce3pect3ubmit4lt4me4pply4rface2tail5ner6ing4ke3ention3hink3inal4red6e5ing3old4ol4rted4uch3race6t5in4ead6t4ial5eval7er4y3urn3ying4pe2union5te3sable4e2veal4ler4nue4rb5ed6nce5sal6e6ing7on5t3isable5e5ion6t4vable6l5er5ing3ocable4ke4lt5ving2ward4sh3ind4re3ord5k3rap4ite1hyme1ibbon3cage2ce3hes4ly4ness3kety3otta2dden3e3ing2fling3t2gging3id3or2mless3med2nd3k3se4ing2pcord3eness5ing3ping4le5ing3tide2se3ing3k3otto2tzy2val3erbank6ed6oat5side4ter5ing1oamer4ing3st2bbing3e3in3otics3ust2ckband4er5t4fish4iness6g4like4slide5tar4y2gue2man3p2pe3ing2ster3y2tten3unda2ulette3nding6sh5ness5up3tine6g2ver3ing2yal1ubbed5r4ing4le3down3y2ckus2dder2g2ined2le2mble5ing3mage3or2naround3down3ner4ing4y3way2ral2se3h3t2t0sadden4lebag6d5ing3ly3ness2fari3eguard4house4ly4ness3fron2ga3e3ging4y2id2ke2lad4mi4ried5y3ine3on4on3sa3t3utary5e3vage6ing2me3ple5ing2nction5uary3dal4bag6nk6r5last5ox4ed4fish4ing4lot4paper5it4stone7rm4worm4y3itary5izer3k3ta2pling3piness4y2rcasm6tic3dine2sh3quatch3sy2tchel3iable4n4rical4sfied6y3urate5day2uciness4y3na2vanna3ed3ings3or2xophone2y1cale4ing4lion5op3m3ndal4ner5ing4t3rce5ity4ecrow5d4f4ily5ness4y3venger2enic2hedule4matic5e5ing3illing3napps3olar2ience5tist3on2off3lding3ne3op4ter3pe3rch4ebook5card5d5less5r4ing4pion3tch3ured5ing4ting5s3wling2rabble4ggly4mbled8r4p4tch3een3ibble5e5ing4mmage4pt3oll4oge4unger3ubbed7r4ffy4nch4tiny2uba3ff3lptor6ure3ttle1ecluded6ing5sion3ond3recy5t3tional4or3urely5ity2dan4te3iment2gment2ismic3zing2ldom3ected6ion7ve6or3f3tzer2mantic3ester3icolon4final4nar4soft5weet2nate5or3d3ior3orita3sation4itive7ze2pia3tember4um2quel5nce5ster2ries3otonin3pent3rated3ve4ice5ng2same3sions2tback3ting4le5ing3up2venfold5teen6h6y4rity1habby3ck3ded4ily5ness6g4ow4y3ft3kable4ily5ness6g4y3le4lot6w3mpoo4rock3nty3pe4ing3re4pener6r5ie5ly5ness3wl2eath3d3ep4t3lf4l4ter4ve5ing3rry2ield3fter5ing5less5y3mmer5y3ndig4e4gle4iness6g4y3p3rt3vering2ock3ne3pper5ing4talk3re4tage5cake6ut5en6r5hand5list6y5ness5s5wave5y3ut3ve3wbiz4case4down4er4ing4man4n4off4piece5lace4room4y2rank3edder6ing4wdly3iek4ll4mp4nk4vel3ouded3ubbery5s4g4nk2ucking3dder3ffle6ing3n3sh3t2y1iberian3ling2ding2erra3sta2ft2ghing2lenced7r5t3ica5on3k3liness4y3o3t3ver2milarly5e3mering3ple5ify5y2ncere6ity3ger4ing4le4ular3uous2p2ren2ster2tcom3ter4ing3uated6ion2xfold3teen4h4ies6th4yfold2zable6y3e3ing3zle5ing1kater4ing2edaddle3leton3ptic3tch3wed5r2id3ed4r4s3ing3lled6t5ful3mmed6r5ing4pily3ncare4less4ning3pper5ing3rmish4t3ttle2ydiver3light5ne3pe3rocket3ward1lab3cked6r5ing5ness5s3m3ng3pping4stick3shed5ing3te4her3w2ed3ek4p4t4ve3pt2iceable5d5r4ing4k3der5show4ing3ghted6ing6ly3mness4y3nging5shot4ky3p3t3ver2obbery3gan3ped4ing4pily5y3t3uching6y2udge3g3rp3sh2y1mall3rtly5ness3sher5ing5up2ell4ting2ile4ingly3rk3th4ten2ock3g3ked5less4iness6g4y3lder3oth2udge5y3gly4ness1nack3gged3king3p3re4l3zzy2eak3er4ze5ing2ide3ff3ppet5ing2ooper4ze3re4ing4kel4t3ut3wbird5oard6und4cap4drift6op4fall5ield5lake4iness4less4man4plow4shoe5torm5uit4y2ub3ff3ggle4ly4ness1peak4rfish5head5man6int3cies5men4ked5led5s4tacle6tor5rum4ulate3ech4d3llbind5er5ing3ndable5er5ing4t3w2here5ical3inx2ider3ed3ffy3ll4t3nach5l4dle4ner5ing4out4y3ral4ited2lashed6ing6y4tter3endid6or3ice5ing4nter3otchy3urge2oilage5ed6r5ing5s3ken5sman3nge5y4sor3of4kily5y4l4n3re4ting5s5y3tless5ight4ted6r5ing5y3usal5e4t2rang4wl4y3ee3ig4ng5kled8r5t4te3out3uce4ng3y2ud3r3tter2yglass1quabble4d4ll4nder4sh4tted7r6ing3eak5ler6ing5mish4egee5ze6ing3id4ggle7y4nt4re5t4shier6y1tability7ze4le3ck3dium3ff3ge4ing4nant6te3inable5ed5ing5less3lemate5ness4ling6on3mina4p3nd4k3ple5ing3rboard4ch4dom5ust4fish4gazer4ing4k4less6t5ight6t4ring5y4ship4ter5ing5le6ing5up3sh3te4ic5stic4ue5re5s5te6ory3unch3ys2eadfast5ier6ly5ying4m3ed4p4rable5ing5sman3gosaur3llar3m3ncil3p3reo4ling4nness3w2ick3ffen5ly5ness4le5ing3llness4t3mulate6i6us3nger5ily6ng5ray5y4king5y3pend4ulate3r3tch2ock3ic3ke3le3mp3newall7re6ork4y3od4l4p3plight4pable6ge5ed6r5ing4watch3rable5ge4eroom5wide4m3ut3ve3waway4ing2raddle4ggler4ined7r6ing4ngely7r4tegic7y5us4w4y3eak5m4et4ngth5uous4ss4tch4wn3ict4de4fe4ke5ing4ve5ing3obe4de4ller4ngbox6ly6man3uck5ture4del4ggle4m4ng4t2ubbed5le6y5orn3cco4k3dent4ied5o4y3ffed5ing5y3mble6ing4p3ng4ned6r5ing4t3rdily5y2yling5shly6t5zed4us1uave2barctic4tomic3divide4ued5ing3floor3group3header3ject3lease5t5vel4ime3marine4erge6sed4itter3panel5r4lot4rime3scribe7pt4ector4ide6ing7ze6y4oil5nic4tance4ystem3text4itle4ly4otal4ract4ype3urb3way4oofer3zero2cculent3h3tion2dden3oku3s2ffice5x4rage2gar3gest2ing3table7y4case4or2lfate4ide5te4ur3k3len3phate5uric2perbowl5glue5hero5ior5jet5man6om5nova5vise3per4lier5y4ort3reme2rcharge3ely4ness3face6ing4board4er3ging3name3pass4lus4rise3real5nder4ound3vey4ival6e6ing6or2shi3pect5nd6se3tained8r1wab3ddling3gger3mpland3n3pping3rm3y2eat3ep3ll3pt3rve2ifter5ly5ness3mmable5er5ing4suit4wear3nging3pe3rl3tch3vel3zzle2ooned4p4sh3re4n2ung1ycamore2mpathy4honic7y2napse3ergy3opses6is3thesis6tic2rup2stem0tabasco3by3leful5s5t5ware4oid2ckiness6g4le5ing4y3o3tful4ical6s5le4less2dpole2ekwondo2g2inted2ke3ing2lcum3isman3l3on2male3eness4r3per2nk3ned5ry4ing3trum2peless4red5ing4stry3ioca3ping3s2rantula3get3mac3nish3tar4ly4ness2sk3sel3te4iness6g4y2ttered4le5ing4oo2unt2vern1hank3t3w2eater5rics3me3orize3rmal5os3saurus4e4is4pian2icken6t5ness3mble3ng4k4ly4ner6ss5ing3rstily7ng6y4teen5y2orn3se3usand2rash3ead5ten4efold3ift4ll4ve5ing3oat4ng4ttle4waway5back5er5ing2ud3mb4ping3rsday3s2warting1iara2bia2dal3bit3iness5gs3y2ger3hten5ly5ness5rope5wad3ress2le3ing3l3t2mid4ng3othy2nderbox3foil3gle5ing5y3ker4ling3sel4mith3t3work3y2poff3ped5r4ing3toeing5p2ring2ssue1race4ing4k4tion5or3de4ing5tion3ffic3gedy3iling5side4n3nce4quil4sfer6orm5late5pire6ort7se3pdoor4eze6oid4ped6r5ing4s3sh3vel5rse5sty3y2eachery4ding5mill4t3ble3e3kker3mble6ing4or3nch4d3spass2iage4l4ngle3besman4unal6e5tary6e3ceps4kery5ily6ng5le5ster5y4olor4ycle3dent3ed3fle4ocals3llion4ogy3mmer5ing4ness3o3pod4ping3umph3vial2odden3lling3mbone3phy4ical6s3uble6ing4gh4sers4t3wel2uce4k3ffle3nks3stable5ee5ful5ing5less3th2y1ubeless3ular2cking2esday2g2ition2lip2mble5ing3my2rbine4ofan5jet4ulent3f3key3moil3ret3tle2sk2tor3u2x1weak3ed4t4zers3lve3ntieth5y2ice3ddle6ing3g3light3ne4s3rl3stable5ed6r5ing5y3tch4ter1ycoon2ing2ke0ultimate7um3ra1mbrella2pire1nabashed4le3dorned4vised3fraid3ired3ligned4tered3rmored3shamed3udited3wake5re2baked4lance3eaten4nd5t3iased4tten3lended4ock3olted4unded4xed3raided4idle4oken3uckled4ndle4rned4tton2canny4pped4ring3ertain3hain5nged5rted4eck3ivil3lad5imed5mped5sp4e4ip4oak5g3oated4iled4lored4mbed5mon4oked4rk5rupt4unted5ple5th4ver3ross5wn4ushed3ured5ious5led4t2damaged4ted4unted3ecided4fined4rcoat7ok6ut5dog7ne5fed7ed6oot5go6rad5hand5line8g5mine6ost5paid7ss7y5rate5take6one7ok7w5use5went4sired3iluted4vided3ocked4ing4ne3rafted4illed3usted3ying2earned5th4se5ily5y4table5en3dited3lected3nding4gaged4vied3qual3thical3ven3xpired5osed2failing5r4sten4zed3eeling3iled5led4tted6ing4xable5ed3lawed3ocused4ld4unded3ramed4eeze4osted5zen3unded2glazed4oved4ue3raded4eased3uarded4ided2happily6y4rmed3eard6ing5ted4lpful3idden4nge4tched3ook2icorn4ycle3fied6r4ormed7ly4y3mpeded3njured4stall4vited3on3quely3son4sued3t3versal7e2justly2kempt3ind3notted5wing6n2laced4tch3eaded5rned5sh4ss4veled3ighted4mited4ned5ked4sted4t4vable3oaded7r4cked6ing4vely5ing3uckily6y2made4naged5ned4pped4rked4sked6ing4tched3indful4xable5ed3olded4vable5ed5ing2namable5ed4tural3eeded4rve6ing3oticed2opened4posed2pack4dded4id5nted5red4ved3eeled3icked4loted4nned3lanned6ted4eased5dged4owed4ug3opular3roven2quote2ranked4ted4veled3eached5d5l4eling4fined4lated4nted4st4tired4vised3igged4pe4valed3oasted4ll3uffled4ly4shed2saddle4fe4id4lted4ved5ory3cathed4ented4rew3ealed5ted4cured4eing5mly5n4lect5fish4nt4ttled3hackle5ken5ved7n4eathe4ipped3ightly5ned3killed3liced3mooth3nap3ocial4iled4ld5ved4rted3poiled5ken3table5ffed5mped4eady5rile4irred5tch4opped4uck5ffed4ylish3ubtle7y4ited4re3worn2tagged4inted4ken4med4ngled4pped4xed3hawed4read3idy4e4l4med6ly4tled3oasted4ld4uched3racked5ined4eated4ied5mmed4ue5th3urned3wist3ying2usable4ed4ual2valued4ried5ying3eiled6ing4nted3iable4sited3ocal2wanted4rlike5y4shed4tched3eave4lcome3ieldy4lling4nd4red4tting3orldly5n5ried4und4ven3rapped4itten2zip1pbeat2coming4untry2date2front2grade2heaval4ld3ill3old2lifted6ing3oad2on2per2right4sing4ver3oar4ot2scale3ide3tage5irs5rt5te4ream5oke3wing2take3ight3own3urned2ward3ind1ranium2ban2chin2ethane2gency5t3ing1sable3ge2eable3d3lessly3r2her2ual1tensil2ility5ze2most2opia2ter0vacancy5t4te5ion2guely5ness2liant4d3ley3uables4e2nilla4sh4ty3quish3tage2porizer2riable7y4ed5ty4ous3mint3nish3sity3ying2scular3tly4ness1eal2gan3gie2hicular2lcro3ocity3vet2nding4or3eering3ture3ue4s2rbalize6ly4ose3dict3ify3se4ion4us3tical5go3y2ssel3t2teran3o2xingly1iability4le2bes2ce3inity3tory2deo2ewable4er4ing4less4point2gorous2llage5in2ndicate3eyard3tage2olet4in2per2ral3tual5ous3us2sa3cosity5us3elike3ible6y4on4ting5or3or3ta2tality6ze5ly4mins2vacious3idly5ness1ocalist6ze5ly4tion2ice4ing3d2latile3ley3tage3umes2ter3ing2ucher2wed4l2yage0wackiness2d2fer3fle2ged4r4s3gle3on2ke3ing2lk3mart3nut3rus3tz2nd3nabe3ted4ing2sabi3hable4basin5oard6wl4cloth4day4ed5r4house4ing4out4room4stand4tub3p3ting2tch3er2viness5g3y1hacking5y3m3rf2eat3never2iff3msical3nny4y3sking2oever3le3mever3opee5ing5s2y1ick2dely4n3get3th2eldable5er2fe3i2kipedia2ldcard6t4er4fire5owl4land5ife5y4ness3led4fully4ing4ow4power3t2nce4ing3d3g3king3ner4ings3ter2pe2red4less3ing3y2sdom3e3h3plike4y3tful2zard1obble5ing5y2k2lf3verine2of3ing3l3zy2rd3k3ried6r5some4y3sening4t2ven2w1rangle2eath3ckage5er5ing3nch2iggle6y3nkle6y3st3ting4ten2onged5ful5ly5ness3ught0xbox1erox0yahoo2m2nking2pping2rd3n1eah3rbook4ling5y4ning3st2lling3p2n2sterday1ield2n2ppee1odel2ga3urt2nder2yo1ummy0zap1ealous2bra2n2ppelin2ro2stfully4y1igzagged2pfile3ping4y3s1odiac2mbie2ne3ing2okeeper3logist6y3m';
    let effWords = null;
    function passphraseWords() {
        if (effWords) return effWords;
        const out = [], re = /(\d)([a-z]*)/g;
        let m, prev = '';
        while ((m = re.exec(EFF_WORDS_FC))) { prev = prev.slice(0, +m[1]) + m[2]; out.push(prev); }
        if (out.length !== 7092) throw new Error('word list damaged (' + out.length + ' words)');
        return (effWords = out);
    }
    function randomPassphrase() {
        const w = passphraseWords();
        return [0, 1, 2].map(() => w[randomBelow(w.length)]).concat(String(100 + randomBelow(900))).join('-');
    }

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
        .elm-dbd-gen { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 8px 0 2px; }
        .elm-dbd-gen > span { font-size: 13px; color: #43474e; }
        .elm-dbd-chip { height: 32px; padding: 0 14px; border: 1px solid #c3c7cf; border-radius: 8px; background: #fff; color: #1a1c20; font: 500 13px/20px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; cursor: pointer; }
        .elm-dbd-chip:hover { border-color: var(--md-primary, #ef6c00); background: #fff4ea; }
        .elm-dbd-chip:focus-visible { outline: 2px solid var(--md-primary, #ef6c00); outline-offset: 2px; }
        .elm-dbd-copy { flex: none; height: 28px; padding: 0 10px; border: none; border-radius: 14px; background: transparent; color: var(--md-primary-text, #b34e00); font: 500 13px/20px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; cursor: pointer; }
        .elm-dbd-copy:hover { background: rgba(239, 108, 0, .08); }
        .elm-dbd-copy:focus-visible { outline: 2px solid var(--md-primary, #ef6c00); outline-offset: 1px; }
        .elm-dbd-copy[hidden] { display: none; }
        .elm-dbd-note { margin: 2px 0 0 4px; font-size: 13px; color: #43474e; min-height: 18px; }
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
                box.append(field);
                // Generate buttons: fill the field with a generated password and show it, so it can be copied and passed on
                if (o.generate && o.generate.length) {
                    const row = el('div', 'elm-dbd-gen'), note = el('div', 'elm-dbd-note');
                    row.appendChild(el('span', '', 'Generate:'));
                    const copy = el('button', 'elm-dbd-copy', 'Copy'); copy.type = 'button'; copy.hidden = true; // in the field, beside Show
                    field.insertBefore(copy, show);
                    o.generate.forEach(g => {
                        const b = el('button', 'elm-dbd-chip', g.label); b.type = 'button'; b.title = g.note;
                        b.addEventListener('click', () => {
                            try { input.value = g.make(); } catch (e) { error.textContent = 'Could not generate one: ' + (e && e.message || e); return; }
                            input.type = 'text'; box2.checked = true; error.textContent = '';
                            note.textContent = g.note + ' Copy it now: coworkers need it to open your files.';
                            copy.hidden = false; copy.textContent = 'Copy';
                            input.focus(); input.select();
                        });
                        row.appendChild(b);
                    });
                    copy.addEventListener('click', () => {
                        const ok = () => { copy.textContent = 'Copied'; }, fail = () => { input.focus(); input.select(); copy.textContent = 'Press Ctrl+C'; };
                        try { (doc.defaultView.navigator.clipboard ? doc.defaultView.navigator.clipboard.writeText(input.value) : Promise.reject()).then(ok, fail); } catch (e) { fail(); }
                    });
                    input.addEventListener('input', () => { copy.textContent = 'Copy'; });
                    box.append(row, note);
                }
                box.append(error);
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
                (current ? 'Changing it affects the files you download from now on. Files made earlier keep the password they were made with. ' : '') + 'Type one (at least ' + PASSWORD_MIN + ' characters) or generate one: a random password is the strongest, a passphrase is easier to say and type.'
            ],
            password: { value: current }, ok: 'Save',
            generate: [
                { label: 'Random password', make: randomPassword, note: GEN_LENGTH + ' random letters, numbers and symbols.' },
                { label: 'Passphrase', make: randomPassphrase, note: 'Three random words and a number.' }
            ],
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
            if (parsePoints(e.points) !== null) out.points = parsePoints(e.points);
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
            signals: { dept: d.csvDept, spark1: d.csvSpark1, spark2: d.csvSpark2, choice: d.csvChoice, score: d.csvScore, points: d.csvPoints },
            // for the personal file: whether the signed-in person was found, where, and a fingerprint that should read the same every time you are signed in
            login: (() => { const w = currentLogin(); return w ? { found: true, from: w.source, kind: w.kind, fingerprint: w.mark || '(working)', changedInLast30Days: loginChangedRecently() } : { found: false }; })(),
            sparksOnPage: sparks, pageNames: extractNames().full,
            lastProblem: problem.reason || 'none'
        };
        console.log('[Database] state', info);
        return info;
    };

})();
