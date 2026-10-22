// ==UserScript==
// @name         Element451 - Database Merge (New Deduplication Layout)
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Adds a "Merge Databases" page to the Database script: combine several exported databases (and this browser's) into one, with a breakdown
// @author       You
// @match        https://*.element451.io/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/totallygeekdom/csusb-de-dup-extension/main/database-merge-v2.js
// @downloadURL  https://raw.githubusercontent.com/totallygeekdom/csusb-de-dup-extension/main/database-merge-v2.js
// ==/UserScript==
//
// Pairs with database-v2.js in only two ways: the "Merge Databases" button is added to the Database section that
// script puts in the settings pane (so the button only exists while the Database script is active), and the current
// database is read straight from localStorage (`elm_csv_database`), so it can be merged without downloading it first.
// Everything else (reading .xlsx files, writing the merged .xlsx) is this script's own code, which is why
// the file-format block below is a copy of the Database script's. The button opens a new tab; the tab is built from this page
// with DOM calls (no inline scripts), so it works whatever the site's content-security policy says, and it needs this
// Element451 tab to stay open while you use it.
(function () {
    'use strict';
    if (window.__elm451DbMergeLoaded) return;
    window.__elm451DbMergeLoaded = true;
    const VERSION = '1.8'; // keep in sync with @version

    // =========================================================
    // STORED DATABASE AND FILE FORMATS
    // =========================================================
    const STORAGE_KEY = 'elm_csv_database'; // the Database script's key
    const ELLIPSIS = '...';
    function trunc3(t) {
        t = (t || '').trim();
        if (t.endsWith(ELLIPSIS)) return t;
        return t.length > 3 ? t.slice(0, 3) + ELLIPSIS : t;
    }
    // =========================================================
    // FILE FORMAT (a copy of the Database script's .xlsx writer and reader). The written .xlsx has
    // preset column widths, a frozen header row and filter / sort buttons on Bolt Score, Dept., Scan Date and Merged.
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
    function dbRows(db) {
        const rows = db.map(e => {
            // Script vs Bolt is only exported for a merged pair
            const r = DB_COLUMNS.map(c => String((c.key === 'choice' && e.merged !== 'Y') ? '' : c.key === 'score' ? capFirst(e.score) : c.key === 'scanDate' ? (e.scanDate || '') : (e[c.key] || '')));
            r.struck = new Set();
            r.dates = new Set(); // columns written as real dates (Scan Date), so the spreadsheet can sort and filter them
            const lostCol = { firstName: 'a', firstName2: 'b', lastName: 'a', lastName2: 'b' };
            DB_COLUMNS.forEach((c, i) => {
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
            DB_COLUMNS.map((c, ci) => xlsxCell(r[ci] == null ? '' : String(r[ci]), colLetter(ci) + (ri + 1), ri === 0 ? 1 : (r.dates && r.dates.has(ci) ? 3 : r.struck && r.struck.has(ci) ? 2 : 0), !!(r.dates && r.dates.has(ci)))).join('') + '</row>').join('');
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
            '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>' +
            '<font><strike/><sz val="11"/><color rgb="FF8A8A8A"/><name val="Calibri"/></font></fonts>' +
            '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FFFDE3CC"/><bgColor indexed="64"/></patternFill></fill></fills>' +
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
            '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
            '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
            '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
            '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
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

    // Reads an .xlsx database file into entries (throws with a message a person can read)
    async function parseDbFile(file) {
        const lower = file.name.toLowerCase();
        let rows;
        if (lower.endsWith('.xlsx')) rows = await xlsxRows(await file.arrayBuffer());
        else throw new Error('Please select an .xlsx file.');
        if (rows.length < 2) throw new Error('The file is empty or has no data rows.');
        const entries = entriesFromRows(rows);
        if (entries.length === 0) throw new Error('No valid entries found in the file.');
        return entries;
    }
    const api = {
        read: () => { try { const d = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(d) ? d : []; } catch (e) { return []; } },
        write: (entries) => localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)), // the Database script re-reads it, and its header counter follows within a second
        parseFile: parseDbFile,
        exportBlob: (entries) => buildXlsx(dbRows(entries)),
        fileName: () => `elm_database_${new Date().toISOString().slice(0, 10)}.xlsx`
    };

    // =========================================================
    // MERGE RULES (pure)
    // =========================================================
    // A pair is identified by its two Spark IDs (either order); entries with none fall back to the two contacts' names.
    function keyOf(e) {
        const ids = [e.sparkId1, e.sparkId2].filter(Boolean).sort().join('|');
        if (ids) return 's:' + ids;
        const name = (a, b) => ((a || '') + '|' + (b || '')).toLowerCase();
        return 'n:' + [name(e.firstName, e.lastName), name(e.firstName2, e.lastName2)].sort().join('~');
    }
    const isMerged = (e) => e.merged === 'Y';
    // Does the incoming entry replace the one already kept? The most up to date copy wins: the later Scan Date (a
    // pair's Scan Date moves to the merge day when it is merged, so a merge is the newest thing that can happen to it; an
    // undated entry loses to a dated one). On the same date a merged copy beats an unmerged one, and after that the
    // earlier source stays.
    function replaces(incoming, kept) {
        const a = incoming.scanDate || '', b = kept.scanDate || '';
        if (a !== b) return a > b;
        return isMerged(incoming) && !isMerged(kept);
    }
    const label = (e) => [[e.firstName, e.lastName], [e.firstName2, e.lastName2]].map(p => p.filter(Boolean).join(' ')).filter(Boolean).join(' / ') || '(no names)';
    // sources: [{ name, entries }] in priority order. Returns { entries, stats: [per source], conflicts, unique, duplicates }.
    function mergeSources(sources) {
        const kept = new Map(); // key -> { entry, from }
        const conflicts = [];
        let seen = 0;
        const stats = sources.map(s => ({ name: s.name, count: s.entries.length, added: 0, replaced: 0, lost: 0 }));
        sources.forEach((src, si) => {
            src.entries.forEach(inc => {
                seen++;
                const key = keyOf(inc), cur = kept.get(key);
                if (!cur) { kept.set(key, { entry: { ...inc }, from: si }); stats[si].added++; return; }
                const win = replaces(inc, cur.entry);
                if ((inc.merged || '') !== (cur.entry.merged || '') || (inc.dept || '') !== (cur.entry.dept || '')) {
                    conflicts.push({
                        names: label(cur.entry),
                        a: { src: sources[cur.from].name, dept: cur.entry.dept, merged: cur.entry.merged, date: cur.entry.scanDate },
                        b: { src: src.name, dept: inc.dept, merged: inc.merged, date: inc.scanDate },
                        winner: win ? src.name : sources[cur.from].name
                    });
                }
                if (win) {
                    const loser = cur.entry;
                    const w = { ...inc };
                    if (!w.score && loser.score) w.score = loser.score; // keep what the other copy knew
                    kept.set(key, { entry: w, from: si });
                    stats[si].replaced++;
                    stats[cur.from].lost++;
                } else {
                    stats[si].lost++;
                }
            });
        });
        const entries = Array.from(kept.values()).map(v => v.entry);
        return { entries, stats, conflicts, unique: entries.length, duplicates: seen - entries.length };
    }

    // =========================================================
    // THE PAGE (a new tab, built with DOM calls), Material 3 Expressive in the orange of the settings pane
    // =========================================================
    const CSS = `
        :root { --primary:#ef6c00; --on-primary:#fff; --primary-text:#a64600; --primary-c:#fde3cc; --on-primary-c:#4a2200;
                --secondary-c:#efe6dc; --on-secondary-c:#2f2418; --tertiary-c:#e4ecd0; --on-tertiary-c:#222d0c; --error-c:#fbe3e0; --on-error-c:#5c1410;
                --surface:#fffbf8; --low:#f8f2ec; --mid:#f1e9e1; --high:#e9dfd5; --on-surface:#1e1b17; --variant:#4f4538; --outline:#85766a;
                --ease:cubic-bezier(.2,0,0,1); }
        @media (prefers-color-scheme: dark) { :root { --primary:#ffb77c; --on-primary:#4a2300; --primary-text:#ffb77c; --primary-c:#5a3000; --on-primary-c:#ffdcc2;
                --secondary-c:#40362c; --on-secondary-c:#f0e0d0; --tertiary-c:#363f20; --on-tertiary-c:#dde7c4; --error-c:#52201c; --on-error-c:#fcdcd8;
                --surface:#17120d; --low:#1f1914; --mid:#251e18; --high:#2f2820; --on-surface:#ece0d8; --variant:#d3c3b8; --outline:#9c8d82; } }
        * { box-sizing:border-box; }
        body { margin:0; background:var(--surface); color:var(--on-surface); font:400 15px/22px system-ui,'Segoe UI',Roboto,sans-serif; }
        main { max-width:860px; margin:0 auto; padding:28px 24px 80px; }
        svg { width:22px; height:22px; fill:currentColor; flex:none; }
        .hero { display:flex; align-items:center; gap:14px; margin:0 0 22px; }
        .hero .badge { width:44px; height:44px; display:grid; place-items:center; border-radius:14px; background:var(--primary-c); color:var(--on-primary-c); }
        h1 { margin:0; font:500 28px/36px system-ui,'Segoe UI',Roboto,sans-serif; }
        .sub { margin:0; color:var(--variant); font-size:14px; }
        h2 { margin:28px 0 10px; font:500 18px/26px system-ui,'Segoe UI',Roboto,sans-serif; }
        .note { font-size:13px; line-height:19px; color:var(--variant); }
        .card { background:var(--low); border-radius:20px; padding:18px 20px; margin:0 0 14px; }
        .card ol { margin:6px 0; padding-left:22px; } .card li { margin:2px 0; }
        .drop { display:flex; flex-direction:column; align-items:center; text-align:center; gap:4px; padding:30px 24px; border-radius:24px; background:var(--low); color:var(--on-surface);
                outline:2px dashed var(--outline); outline-offset:-8px; transition:background-color .2s var(--ease), outline-color .2s var(--ease); }
        .drop .ico { width:48px; height:48px; display:grid; place-items:center; border-radius:50%; background:var(--primary-c); color:var(--on-primary-c); margin-bottom:6px; }
        .drop strong { font:500 17px/24px system-ui,'Segoe UI',Roboto,sans-serif; }
        .drop.over { background:var(--primary-c); outline-color:var(--primary); }
        .btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; height:44px; padding:0 24px; border:none; border-radius:22px; font:500 14px/20px system-ui,'Segoe UI',Roboto,sans-serif; cursor:pointer;
               transition:box-shadow .2s var(--ease), background-color .2s var(--ease); }
        .btn:hover:not(:disabled) { box-shadow:0 1px 2px rgba(0,0,0,.3),0 1px 3px 1px rgba(0,0,0,.15); }
        .btn:disabled { opacity:.38; cursor:default; }
        .filled { background:var(--primary); color:var(--on-primary); } .tonal { background:var(--primary-c); color:var(--on-primary-c); }
        .small { height:40px; padding:0 20px; border-radius:20px; }
        .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:14px; }
        .list { display:flex; flex-direction:column; gap:2px; }
        .item { display:flex; align-items:center; gap:14px; padding:12px 16px; background:var(--low); }
        .item:first-child { border-radius:20px 20px 6px 6px; } .item:last-child { border-radius:6px 6px 20px 20px; } .item:only-child { border-radius:20px; }
        .item .lead { width:40px; height:40px; display:grid; place-items:center; border-radius:12px; background:var(--secondary-c); color:var(--on-secondary-c); }
        .item .lead.mine { background:var(--tertiary-c); color:var(--on-tertiary-c); }
        .item .txt { flex:1; min-width:0; } .item .name { font:500 15px/22px system-ui,'Segoe UI',Roboto,sans-serif; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .icon-btn { width:40px; height:40px; display:grid; place-items:center; border:none; border-radius:50%; background:transparent; color:var(--variant); cursor:pointer; transition:background-color .2s var(--ease); }
        .icon-btn:hover { background:rgba(128,100,70,.16); }
        .chips { display:flex; flex-wrap:wrap; gap:6px; }
        .chip { display:inline-flex; align-items:center; gap:5px; min-height:28px; padding:3px 12px; border-radius:14px; font:400 13px/18px system-ui,'Segoe UI',Roboto,sans-serif; background:var(--secondary-c); color:var(--on-secondary-c); }
        .chip svg { width:16px; height:16px; } .chip.kept { background:var(--tertiary-c); color:var(--on-tertiary-c); }
        .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; margin:0 0 14px; }
        .stat { border-radius:20px; padding:14px 18px; background:var(--low); }
        .stat b { display:block; font:500 30px/36px system-ui,'Segoe UI',Roboto,sans-serif; } .stat span { font-size:13px; color:var(--variant); }
        .s1 { background:var(--primary-c); } .s1 b, .s1 span { color:var(--on-primary-c); } .s4.warn { background:var(--error-c); } .s4.warn b, .s4.warn span { color:var(--on-error-c); }
        .conf { padding:12px 16px; border-radius:16px; background:var(--low); margin:0 0 6px; display:flex; flex-direction:column; gap:8px; }
        .conf .who { font:500 15px/20px system-ui,'Segoe UI',Roboto,sans-serif; }
        .scrim { position:fixed; inset:0; background:rgba(0,0,0,.4); display:grid; place-items:center; padding:24px; }
        .dialog { width:min(420px,100%); background:var(--surface); border-radius:28px; padding:24px; }
        .dialog h3 { margin:0 0 10px; font:500 22px/28px system-ui,'Segoe UI',Roboto,sans-serif; } .dialog p { margin:0 0 20px; color:var(--variant); font-size:14px; }
        .dialog .row { justify-content:flex-end; margin-top:0; } .dialog .text { background:transparent; color:var(--primary-text); }
        .snack { position:fixed; left:50%; bottom:24px; transform:translateX(-50%); max-width:min(520px,calc(100% - 32px)); background:#322f2b; color:#f5eee8; padding:12px 20px; border-radius:12px; font-size:14px; box-shadow:0 3px 8px rgba(0,0,0,.3); animation:fade .2s linear; }
        @keyframes fade { from { opacity:0; } to { opacity:1; } }
        @media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
    `;
    const ICON = {
        merge: 'M17 20.41 18.41 19 15 15.59 13.59 17zM7.5 8H11v5.59L5.59 19 7 20.41l6-6V8h3.5L12 3.5z',
        upload: 'M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96M14 13v4h-4v-4H7l5-5 5 5z',
        file: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zm2 16H8v-2h8zm0-4H8v-2h8zm-3-5V3.5L18.5 9z',
        db: 'M2 20h20v-4H2zm2-3h2v2H4zM2 4v4h20V4zm4 3H4V5h2zm-4 7h20v-4H2zm2-3h2v2H4z',
        close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
        download: 'M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z',
        check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
        swap: 'M6.99 11 3 15l3.99 4v-3H14v-2H6.99zM21 9l-3.99-4v3H10v2h7.01v3z'
    };

    function openMergePage() {
        const w = window.open('', '_blank');
        if (!w) { alert('The browser blocked the new tab. Allow pop-ups for this site and try again.'); return; }
        const doc = w.document;
        doc.title = 'Merge Databases';
        const style = doc.createElement('style'); style.textContent = CSS; (doc.head || doc.documentElement).appendChild(style);
        const h = (tag, props, ...kids) => {
            const el = doc.createElement(tag);
            Object.entries(props || {}).forEach(([k, v]) => { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v); });
            kids.flat().forEach(k => { if (k != null) el.append(k.nodeType ? k : doc.createTextNode(String(k))); });
            return el;
        };
        const icon = (name) => { const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', ICON[name]); svg.appendChild(path); return svg; };
        const fmt = (n) => Number(n).toLocaleString();
        const dmy = (iso) => (/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '') || []).slice(1).reverse().join('/') || '';
        const plural = (n, one, many) => fmt(n) + ' ' + (n === 1 ? one : many);

        const files = [];             // { name, entries }
        let includeMine = true;
        let result = null;            // output of mergeSources
        const mine = () => api.read();

        // ---- Material dialog and snackbar (instead of the browser's confirm / status text)
        function ask(title, text, okLabel) {
            return new Promise(resolve => {
                const done = (v) => { scrim.remove(); resolve(v); };
                const scrim = h('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) done(false); } },
                    h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, h('h3', null, title), h('p', null, text),
                        h('div', { class: 'row' }, h('button', { class: 'btn small text', type: 'button', onclick: () => done(false) }, 'Cancel'),
                            h('button', { class: 'btn small filled', type: 'button', onclick: () => done(true) }, okLabel))));
                doc.body.appendChild(scrim);
            });
        }
        let snackTimer = 0;
        function snack(text) {
            doc.querySelectorAll('.snack').forEach(n => n.remove());
            const n = h('div', { class: 'snack', role: 'status' }, text);
            doc.body.appendChild(n);
            w.clearTimeout(snackTimer);
            snackTimer = w.setTimeout(() => n.remove(), 4200);
        }

        const body = doc.body;
        body.textContent = '';
        const main = h('main');
        body.appendChild(main);

        const fileInput = h('input', { type: 'file', multiple: true, accept: '.xlsx', style: 'display:none' });
        const dropZone = h('div', { class: 'drop' },
            h('div', { class: 'ico' }, icon('upload')),
            h('strong', null, 'Drop database files here'),
            h('span', { class: 'note', style: 'color:inherit;opacity:.8' }, '.xlsx files, as many as you like'),
            h('button', { class: 'btn filled', type: 'button', style: 'margin-top:12px', onclick: () => fileInput.click() }, 'Choose files'));
        const sourceList = h('div', { class: 'list' });
        const sourceNote = h('p', { class: 'note', style: 'margin:10px 4px 0' });
        const rules = h('div', { class: 'card' },
            h('strong', null, 'What happens when the same pair is in more than one file'),
            h('p', { class: 'note', style: 'margin:8px 0 4px' }, 'Two entries are the same pair when they have the same two Spark IDs. When that pair is in several files, only one copy is kept:'),
            h('ol', { class: 'note' },
                h('li', null, 'The newest copy wins (the one with the later Scan Date).'),
                h('li', null, 'If the dates are the same, the merged copy wins.'),
                h('li', null, 'If it is still a tie, the copy from the file higher in the list wins.')),
            h('p', { class: 'note', style: 'margin:0' }, 'Pairs that appear in only one file are all kept. Nothing in this browser changes until you press "Replace my database".'));
        const mergeBtn = h('button', { class: 'btn filled', type: 'button', onclick: runMerge }, icon('merge'), 'Merge');
        const out = h('div');

        main.append(
            h('div', { class: 'hero' }, h('div', { class: 'badge' }, icon('merge')),
                h('div', null, h('h1', null, 'Merge Databases'), h('p', { class: 'sub' }, 'Combine databases from different people or days into one.'))),
            dropZone, fileInput,
            h('h2', null, 'Sources'), sourceList, sourceNote,
            h('div', { class: 'row' }, mergeBtn),
            h('h2', null, 'How it works'), rules,
            out);

        function rangeOf(entries) {
            const ds = entries.map(e => e.scanDate).filter(Boolean).sort();
            return ds.length ? (ds[0] === ds[ds.length - 1] ? dmy(ds[0]) : dmy(ds[0]) + ' – ' + dmy(ds[ds.length - 1])) : 'no dates';
        }
        const summary = (entries) => plural(entries.length, 'entry', 'entries') + ' · ' + fmt(entries.filter(isMerged).length) + ' merged · ' + rangeOf(entries);
        function renderFiles() {
            sourceList.textContent = '';
            const cur = mine();
            sourceList.append(h('div', { class: 'item' },
                h('div', { class: 'lead mine' }, icon('db')),
                h('div', { class: 'txt' }, h('div', { class: 'name' }, 'This browser\'s database'), h('div', { class: 'note' }, summary(cur))),
                h('label', { class: 'note', style: 'display:flex;align-items:center;gap:10px;cursor:pointer' }, 'Include',
                    h('input', { type: 'checkbox', checked: includeMine, style: 'width:22px;height:22px;accent-color:var(--primary)', onchange: (e) => { includeMine = e.target.checked; renderFiles(); } }))));
            files.forEach((f, i) => sourceList.append(h('div', { class: 'item' },
                h('div', { class: 'lead' }, icon('file')),
                h('div', { class: 'txt' }, h('div', { class: 'name', title: f.name }, f.name), h('div', { class: 'note' }, summary(f.entries))),
                h('button', { class: 'icon-btn', type: 'button', title: 'Remove', 'aria-label': 'Remove ' + f.name, onclick: () => { files.splice(i, 1); result = null; out.textContent = ''; renderFiles(); } }, icon('close')))));
            const usable = (includeMine ? 1 : 0) + files.length;
            mergeBtn.disabled = usable < 2;
            sourceNote.textContent = usable < 2 ? 'Add at least one file (with this browser\'s database included), or two files, to merge.' : '';
        }

        async function addFiles(list) {
            const problems = [];
            for (const f of Array.from(list)) {
                try { files.push({ name: f.name, entries: await api.parseFile(f) }); }
                catch (e) { problems.push(f.name + ': ' + e.message); }
            }
            result = null; out.textContent = '';
            renderFiles();
            if (problems.length) snack(problems.join(' · '));
        }
        fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
        ['dragenter', 'dragover'].forEach(t => dropZone.addEventListener(t, (e) => { e.preventDefault(); dropZone.classList.add('over'); }));
        ['dragleave', 'drop'].forEach(t => dropZone.addEventListener(t, (e) => { e.preventDefault(); dropZone.classList.remove('over'); }));
        dropZone.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

        const stat = (cls, n, text) => h('div', { class: 'stat ' + cls }, h('b', null, fmt(n)), h('span', null, text));
        function runMerge() {
            const sources = [];
            if (includeMine) sources.push({ name: 'This browser', entries: mine() });
            files.forEach(f => sources.push({ name: f.name, entries: f.entries }));
            result = mergeSources(sources);
            out.textContent = '';
            const merged = result.entries.filter(isMerged).length;
            out.append(
                h('h2', null, 'Breakdown'),
                h('div', { class: 'stats' },
                    stat('s1', result.unique, 'unique pairs'), stat('s2', result.duplicates, 'duplicates combined'),
                    stat('s3', merged, 'merged'), stat('s4' + (result.conflicts.length ? ' warn' : ''), result.conflicts.length, 'conflicts')),
                h('h2', null, 'By source'),
                h('div', { class: 'list' }, result.stats.map(s => h('div', { class: 'item' },
                    h('div', { class: 'txt' }, h('div', { class: 'name' }, s.name), h('div', { class: 'note' }, plural(s.count, 'entry', 'entries'))),
                    h('div', { class: 'chips' },
                        h('span', { class: 'chip kept' }, icon('check'), plural(s.added, 'new pair', 'new pairs')),
                        h('span', { class: 'chip' }, icon('swap'), fmt(s.replaced) + ' replaced an older copy'),
                        h('span', { class: 'chip' }, fmt(s.lost) + ' had a newer copy elsewhere'))))),
                conflictsBlock(),
                h('div', { class: 'row', style: 'margin-top:28px' },
                    h('button', { class: 'btn filled', type: 'button', onclick: download }, icon('download'), 'Download merged database (.xlsx)'),
                    h('button', { class: 'btn tonal', type: 'button', onclick: apply }, 'Replace my database with this')));
            out.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        function conflictsBlock() {
            const c = result.conflicts;
            if (!c.length) return h('div', null, h('h2', null, 'Conflicts'), h('p', { class: 'note' }, 'No conflicts: no pair was in a different state in two sources.'));
            const side = (x) => (x.merged === 'Y' ? 'merged' : 'not merged') + ' · ' + (x.dept || '?') + (x.date ? ' · ' + dmy(x.date) : '');
            return h('div', null, h('h2', null, 'Conflicts'),
                h('p', { class: 'note', style: 'margin:0 4px 12px' }, 'The same pair was in a different state in two sources. The copy marked "kept" is the newest.'),
                c.slice(0, 200).map(x => h('div', { class: 'conf' }, h('div', { class: 'who' }, x.names),
                    h('div', { class: 'chips' },
                        h('span', { class: 'chip' + (x.winner === x.a.src ? ' kept' : '') }, x.winner === x.a.src ? icon('check') : null, x.a.src + ': ' + side(x.a)),
                        h('span', { class: 'chip' + (x.winner === x.b.src ? ' kept' : '') }, x.winner === x.b.src ? icon('check') : null, x.b.src + ': ' + side(x.b))))),
                c.length > 200 ? h('p', { class: 'note' }, '…and ' + fmt(c.length - 200) + ' more.') : null);
        }
        function download() {
            const a = h('a', { href: URL.createObjectURL(api.exportBlob(result.entries)), download: api.fileName() });
            body.appendChild(a); a.click(); a.remove();
            snack('Downloaded ' + plural(result.unique, 'entry', 'entries') + '.');
        }
        async function apply() {
            if (!result) return;
            const ok = await ask('Replace your database?', 'This browser\'s database will become the merged one (' + plural(result.unique, 'entry', 'entries') + '). This cannot be undone, so download the merged file first if you want a backup.', 'Replace');
            if (!ok) return;
            api.write(result.entries);
            snack('Done: this browser\'s database now has ' + plural(result.unique, 'entry', 'entries') + '.');
            renderFiles();
        }
        renderFiles();
    }

    // =========================================================
    // SETTINGS PANE: the button, and this script's line in the header's version list
    // =========================================================
    function inject() {
        const section = document.getElementById('elm-settings-db-section');
        if (section && !document.getElementById('elm-merge-dbs-btn')) {
            const btn = document.createElement('button');
            btn.id = 'elm-merge-dbs-btn';
            btn.className = 'settings-action-btn';
            btn.type = 'button';
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M17 20.41 18.41 19 15 15.59 13.59 17zM7.5 8H11v5.59L5.59 19 7 20.41l6-6V8h3.5L12 3.5z"/></svg> Merge Databases';
            btn.addEventListener('click', openMergePage);
            const clear = document.getElementById('elm-settings-clear-btn');
            section.insertBefore(btn, clear || null);
        }
        const dbLine = document.getElementById('elm-settings-db-build');
        if (dbLine && !document.getElementById('elm-settings-merge-build')) {
            const line = document.createElement('div');
            line.id = 'elm-settings-merge-build';
            line.className = 'settings-build';
            line.textContent = 'Database merge · v' + VERSION;
            dbLine.insertAdjacentElement('afterend', line);
        }
    }
    setInterval(inject, 1000);
})();
