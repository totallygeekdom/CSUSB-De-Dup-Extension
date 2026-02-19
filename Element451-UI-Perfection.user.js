// ==UserScript==
// @name         Element451 - UI Perfection
// @namespace    http://tampermonkey.net/
// @version      126
// @description  Merge workflow with auto-selection, smart links, and UI enhancements
// @author       You
// @match        https://*.element451.io/*
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/totallygeekdom/csusb-de-dup-extension/main/Element451-UI-Perfection.user.js
// @downloadURL  https://raw.githubusercontent.com/totallygeekdom/csusb-de-dup-extension/main/Element451-UI-Perfection.user.js
// ==/UserScript==
(function () {
    'use strict';
    // CONFIGURATION
    const HEADER_OFFSET = 64;
    // Settings are stored in localStorage and configurable via the Settings pane.
    // Each getter reads the live value so changes take effect without a full reload.
    function getBoolSetting(key, defaultValue) {
        const val = localStorage.getItem(key);
        if (val === null) return defaultValue;
        return val === 'true';
    }
    const CONFLICT_ROW_THRESHOLD = 2; // Number of conflicting rows before warning about possible twins/different people (0 = disabled)
    // Settings object with live getters (defaults match original hardcoded values)
    const CFG = Object.defineProperties({}, {
        REQUIRE_SCROLL_TO_BOTTOM: { get() { return getBoolSetting('elm_require_scroll_to_bottom', true); } },
        AUTO_CLICK_FAB:           { get() { return getBoolSetting('elm_auto_click_fab', true); } },
        AUTO_NAVIGATE_AFTER_MERGE:{ get() { return getBoolSetting('elm_auto_navigate_after_merge', true); } },
        SHOW_MERGE_COUNTER:       { get() { return getBoolSetting('elm_show_merge_counter', true); } },
        AUTO_SKIP_BLOCKED:        { get() { return getBoolSetting('elm_auto_skip_blocked', true); } },
        ALLOWED_DEPARTMENT:       { get() { return localStorage.getItem('elm_allowed_department') || 'UnderGrad'; } },
    });
    // =========================================================
    // PART 1: CSS
    // =========================================================
    const css = `
        /* --- 1. FORBIDDEN ENTRY LOCKDOWN --- */
        body.forbidden-entry .elm-page-action-floating button {
            background-color: #d32f2f !important;
            padding-right: 16px !important;
            width: 56px !important;
        }
        body.forbidden-entry .elm-page-action-floating button *,
        body.forbidden-entry .fab-merge-text {
            display: none !important;
        }
        body.forbidden-entry .elm-page-action-floating button::after {
            content: "∅";
            color: white; font-size: 28px; line-height: 1; font-weight: bold; display: block; margin: auto;
        }
        /* --- 2. DEPARTMENT LOCKDOWN --- */
        body.wrong-department .elm-page-action-floating button {
            background-color: #d32f2f !important;
            padding-right: 16px !important;
            width: 56px !important;
        }
        body.wrong-department .elm-page-action-floating button *,
        body.wrong-department .fab-merge-text {
            display: none !important;
        }
        body.wrong-department .elm-page-action-floating button::after {
            content: "∅";
            color: white; font-size: 28px; line-height: 1; font-weight: bold; display: block; margin: auto;
        }
        /* --- 2b. STUDENT ID MISMATCH LOCKDOWN --- */
        body.student-id-mismatch .elm-page-action-floating button {
            background-color: #d32f2f !important;
            padding-right: 16px !important;
            width: 56px !important;
        }
        body.student-id-mismatch .elm-page-action-floating button *,
        body.student-id-mismatch .fab-merge-text {
            display: none !important;
        }
        body.student-id-mismatch .elm-page-action-floating button::after {
            content: "∅";
            color: white; font-size: 28px; line-height: 1; font-weight: bold; display: block; margin: auto;
        }
        /* --- 2c. BLOCKED ROW HIGHLIGHTING --- */
        /* Deep red for all blocked rows (student ID mismatch, dept block, forbidden entry) */
        elm-merge-row.blocked-row-critical,
        elm-merge-row.blocked-row {
            background-color: #ffcdd2 !important;
            border: 3px solid #b71c1c !important;
            box-shadow: 0 0 8px rgba(183, 28, 28, 0.4) !important;
        }
        elm-merge-row.blocked-row-critical:hover,
        elm-merge-row.blocked-row:hover {
            background-color: #ef9a9a !important;
        }
        elm-merge-row.blocked-row-critical .elm-merge-row-input,
        elm-merge-row.blocked-row .elm-merge-row-input {
            background-color: #ffcdd2 !important;
        }
        elm-merge-row.blocked-row-critical:hover .elm-merge-row-input,
        elm-merge-row.blocked-row:hover .elm-merge-row-input {
            background-color: #ef9a9a !important;
        }
        elm-merge-row.blocked-row-critical *,
        elm-merge-row.blocked-row * {
            color: #b71c1c !important;
        }
        /* --- 3. GHOST TOOLTIPS --- */
        .cdk-overlay-container,
        .mat-mdc-tooltip-panel,
        .mat-mdc-tooltip {
            pointer-events: none !important;
        }
        .cdk-overlay-pane:not(.mat-mdc-tooltip-panel) {
            pointer-events: auto !important;
        }
        /* Force Merge Toggles to be clickable */
        elm-merge-row mat-button-toggle-group,
        elm-merge-row mat-button-toggle,
        elm-merge-row button {
            position: relative !important;
            cursor: pointer !important;
            pointer-events: auto !important;
        }
        /* Pagination Buttons */
        elm-merge-pagination button,
        .mat-mdc-paginator-range-actions button {
            position: relative !important;
            cursor: pointer !important;
        }
        /* --- 4. FAB STYLING --- */
        .elm-page-action-floating button,
        .elm-page-action button,
        .elm-page-action-floating {
            border-radius: 16px !important;
            transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
            display: flex !important;
            align-items: center !important;
            padding: 0 16px !important;
            min-width: 56px !important;
        }
        
        /* Review Required State (Grey with down arrow) */
        body.review-required .elm-page-action-floating button {
            background-color: #757575 !important;
            padding-right: 16px !important;
            width: 56px !important;
        }
        body.review-required .elm-page-action-floating button *,
        body.review-required .fab-merge-text {
            display: none !important;
        }
        body.review-required .elm-page-action-floating button::after {
            content: "↓";
            color: white; font-size: 32px; line-height: 1; font-weight: bold; display: block; margin: auto;
        }
        /* --- 5. RED/GREEN STATES --- */
        /* Red - Unresolved conflicts */
        elm-merge-row.has-error:has(.ng-invalid),
        elm-merge-row.has-error:not(:has(.ng-valid)) {
            background-color: #ffe6e6 !important;
            border: 2px solid #d32f2f !important;
            position: relative;
        }
        elm-merge-row.has-error:has(.ng-invalid):hover,
        elm-merge-row.has-error:not(:has(.ng-valid)):hover {
            background-color: #ffcccc !important;
        }
        elm-merge-row.has-error:has(.ng-invalid) .elm-merge-row-input,
        elm-merge-row.has-error:has(.ng-invalid) mat-button-toggle-group,
        elm-merge-row.has-error:not(:has(.ng-valid)) .elm-merge-row-input,
        elm-merge-row.has-error:not(:has(.ng-valid)) mat-button-toggle-group {
             background-color: transparent !important;
             border-color: #ef9a9a !important;
        }
        elm-merge-row.has-error:has(.ng-invalid) *,
        elm-merge-row.has-error:not(:has(.ng-valid)) * {
            color: #b71c1c !important;
        }
        /* Green - Resolved conflicts */
        elm-merge-row.has-error:has(.ng-valid) {
            background-color: #e8f5e9 !important;
            border: 2px solid #2e7d32 !important;
            position: relative;
        }
        elm-merge-row.has-error:has(.ng-valid):hover {
            background-color: #c8e6c9 !important;
        }
        elm-merge-row.has-error:has(.ng-valid) .elm-merge-row-input,
        elm-merge-row.has-error:has(.ng-valid) mat-button-toggle-group {
            background-color: transparent !important;
            border-color: #a5d6a7 !important;
        }
        elm-merge-row.has-error:has(.ng-valid) * {
            color: #1b5e20 !important;
        }
        /* --- 6. YELLOW APPLICANT SIDE HIGHLIGHT OVERLAY --- */
        #elm-applicant-highlight {
            position: absolute;
            background-color: #fff9c4; /* Pastel Yellow (Material Yellow 100) */
            border: 2px solid #fbc02d; /* Darker Yellow Border */
            border-radius: 4px;
            pointer-events: none;
            transition: all 0.2s ease;
            mix-blend-mode: multiply; /* This allows text underneath to show through clearly on top */
        }
        /* Text Styling for Applicant Side Columns to match Red/Green style */
        .applicant-side-left elm-merge-row > div:nth-child(2),
        .applicant-side-left elm-merge-row > div:nth-child(2) *,
        .applicant-side-right elm-merge-row > div:nth-child(4),
        .applicant-side-right elm-merge-row > div:nth-child(4) * {
            color: #e65100 !important; /* Dark Orange/Amber text */
            font-weight: 500 !important;
        }
        /* No borders mode (High Contrast OFF) */
        body.no-highlight-borders elm-merge-row.has-error:has(.ng-invalid),
        body.no-highlight-borders elm-merge-row.has-error:not(:has(.ng-valid)),
        body.no-highlight-borders elm-merge-row.has-error:has(.ng-valid) {
            border: none !important;
        }
        body.no-highlight-borders elm-merge-row.blocked-row-critical,
        body.no-highlight-borders elm-merge-row.blocked-row {
            border: none !important;
            box-shadow: none !important;
        }
        body.no-highlight-borders #elm-applicant-highlight {
            border: none !important;
        }
        /* --- 7. UI COMPONENTS --- */
        .elm-smart-link { color: #1976d2 !important; text-decoration: underline; font-weight: bold; cursor: pointer; }
        .elm-phone-formatted { font-weight: 500; color: #333 !important; white-space: nowrap; }
        .fab-merge-text {
            max-width: 0; opacity: 0; white-space: nowrap; overflow: hidden;
            transition: all 0.3s ease; font-weight: 600; font-size: 14px; margin-left: 0;
        }
        .ready-to-merge .elm-page-action-floating button { padding-right: 24px !important; background-color: #2e7d32 !important; width: auto !important; }
        .ready-to-merge .fab-merge-text { max-width: 100px; opacity: 1; margin-left: 12px; }
        /* --- 8. PAGE CONTROLS --- */
        .elm-page-control-container { display: flex; align-items: center; margin: 0 8px; gap: 4px; }
        .elm-unified-input { width: 40px; text-align: center; border: 1px solid #ccc; border-radius: 4px; padding: 4px; font-size: 13px; font-weight: 500; color: #333; background-color: white; }
        .elm-go-btn { background: #3f51b5; color: white; border: none; border-radius: 4px; width: 24px; height: 24px; text-align: center; cursor: pointer; font-size: 10px; font-weight: bold; display: flex; align-items: center; justify-content: center; }
        .mat-mdc-paginator-page-size-value { font-size: 0 !important; display: flex !important; align-items: center !important; gap: 8px !important; }
        /* --- 9. MERGE COUNTER & HIGH CONTRAST TOGGLE --- */
        #elm-controls-wrapper {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-right: 16px;
            position: relative;
        }
        
        #elm-counter-wrapper { 
            display: flex; 
            align-items: center; 
            background: #f5f5f5; 
            border-radius: 20px; 
            border: 1px solid #ddd; 
            padding: 2px; 
            transition: all 0.2s ease-out; 
        }
        #elm-reset-btn { 
            background: transparent; 
            border: none; 
            color: #999; 
            cursor: pointer; 
            font-size: 14px; 
            padding: 4px 8px; 
            border-radius: 50%; 
            transition: all 0.2s; 
            line-height: 1; 
        }
        #elm-reset-btn:hover {
            color: #d32f2f;
            background-color: rgba(211, 47, 47, 0.1);
        }
        #elm-merge-counter {
            font-weight: 600;
            font-size: 14px;
            color: #555;
            padding: 4px 12px 4px 4px;
            white-space: nowrap;
        }
        /* --- Settings Button --- */
        #elm-settings-btn {
            background: transparent;
            border: 1px solid rgba(255,255,255,0.3);
            color: white;
            cursor: pointer;
            font-size: 18px;
            padding: 4px 8px;
            border-radius: 8px;
            transition: all 0.2s;
            line-height: 1;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        #elm-settings-btn:hover {
            background-color: rgba(255,255,255,0.15);
            border-color: rgba(255,255,255,0.5);
        }
        /* --- Settings Pane --- */
        #elm-settings-overlay {
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.35);
            z-index: 9998;
        }
        #elm-settings-overlay.open { display: block; }
        #elm-settings-pane {
            display: none;
            position: fixed;
            width: 320px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08);
            z-index: 9999;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            flex-direction: column;
        }
        #elm-settings-pane.open { display: flex; }
        #elm-settings-pane .settings-header {
            background: #3f51b5;
            color: white;
            padding: 16px 20px;
            font-size: 16px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        #elm-settings-close-btn {
            margin-left: auto;
            background: transparent;
            border: none;
            color: white;
            font-size: 20px;
            cursor: pointer;
            padding: 0 4px;
            line-height: 1;
            opacity: 0.7;
            transition: opacity 0.2s;
        }
        #elm-settings-close-btn:hover {
            opacity: 1;
        }
        #elm-settings-pane .settings-body {
            padding: 12px 16px;
            overflow-y: auto;
            min-height: 0;
        }
        #elm-settings-pane .settings-section {
            margin-bottom: 16px;
        }
        #elm-settings-pane .settings-section:last-child {
            margin-bottom: 8px;
        }
        #elm-settings-pane .settings-section-title {
            font-size: 11px;
            font-weight: 700;
            color: #999;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
        }
        #elm-settings-pane .settings-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 0;
        }
        #elm-settings-pane .settings-row + .settings-row {
            border-top: 1px solid #f0f0f0;
        }
        #elm-settings-pane .settings-row-label {
            font-size: 14px;
            color: #333;
            font-weight: 500;
        }
        #elm-settings-pane .settings-row-desc {
            font-size: 11px;
            color: #999;
            margin-top: 2px;
        }
        /* Toggle Switch */
        .elm-toggle {
            position: relative;
            width: 40px;
            height: 22px;
            background: #ccc;
            border-radius: 11px;
            cursor: pointer;
            transition: background 0.2s;
            flex-shrink: 0;
        }
        .elm-toggle.active { background: #3f51b5; }
        .elm-toggle::after {
            content: "";
            position: absolute;
            top: 2px;
            left: 2px;
            width: 18px;
            height: 18px;
            background: white;
            border-radius: 50%;
            transition: transform 0.2s;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .elm-toggle.active::after { transform: translateX(18px); }
        /* Settings Select Dropdown */
        .elm-select {
            padding: 4px 8px;
            border: 1px solid #ccc;
            border-radius: 6px;
            font-size: 13px;
            color: #333;
            background: white;
            cursor: pointer;
            outline: none;
            transition: border-color 0.2s;
            flex-shrink: 0;
        }
        .elm-select:focus { border-color: #3f51b5; }

        .counter-pop { animation: subtlePop 0.3s ease-in-out; }
        .counter-pop #elm-merge-counter { color: #2e7d32; }
        @keyframes subtlePop {
            0% { transform: scale(1); }
            50% { transform: scale(1.1); background-color: #f1f8e9; border-color: #a5d6a7; }
            100% { transform: scale(1); }
        }
    `;
    try {
        if (typeof GM_addStyle !== "undefined") {
            GM_addStyle(css);
        } else {
            const style = document.createElement("style");
            style.textContent = css;
            document.head.appendChild(style);
        }
    } catch (e) { console.error("CSS Injection failed", e); }
    // =========================================================
    // PART 2: ADDRESS COMPARER
    // =========================================================
    const AddressComparer = {
        countryVariations: [
            'united states of america', 'united states', 'usa', 'us', 'u.s.a.', 'u.s.'
        ],
        // Check if original address has country info (before stripping)
        hasCountry(rawAddress) {
            if (!rawAddress) return false;
            const lower = rawAddress.toLowerCase();
            return this.countryVariations.some(country => lower.includes(country));
        },
        cleanAddress(rawAddress) {
            if (!rawAddress) return '';
            let addr = rawAddress.trim();
            addr = addr.replace(/^Home,\s*/i, '');
            addr = addr.replace(/^[,\s]+|[,\s]+$/g, '');
            // Strip country variations
            for (const country of this.countryVariations) {
                const regex = new RegExp(',?\\s*' + country.replace(/\./g, '\\.') + '\\s*,?\\s*$', 'i');
                addr = addr.replace(regex, '');
            }
            // Aggressive whitespace normalization - remove extra spaces everywhere
            addr = addr.replace(/\s+/g, ' ');
            addr = addr.replace(/\s*,\s*/g, ', ');
            addr = addr.replace(/,\s*,/g, ',');
            addr = addr.replace(/\s*\.\s*/g, '. ');
            addr = addr.trim().replace(/[,\s]+$/, '');
            return addr;
        },
        normalizeStreet(street) {
            if (!street) return '';
            let s = street.toLowerCase().trim();
            const directions = {
                'north': 'n', 'south': 's', 'east': 'e', 'west': 'w',
                'northeast': 'ne', 'northwest': 'nw', 'southeast': 'se', 'southwest': 'sw'
            };
            const streetTypes = {
                'street': 'st', 'avenue': 'ave', 'boulevard': 'blvd', 'drive': 'dr',
                'road': 'rd', 'lane': 'ln', 'court': 'ct', 'circle': 'cir',
                'trail': 'trl', 'way': 'way', 'place': 'pl', 'parkway': 'pkwy',
                'highway': 'hwy', 'terrace': 'ter'
            };
            for (const [full, abbr] of Object.entries(directions)) {
                s = s.replace(new RegExp('\\b' + full + '\\b', 'g'), abbr);
            }
            for (const [full, abbr] of Object.entries(streetTypes)) {
                s = s.replace(new RegExp('\\b' + full + '\\b', 'g'), abbr);
            }
            // Remove periods and extra spaces for comparison
            s = s.replace(/\./g, '').replace(/\s+/g, ' ').trim();
            return s;
        },
        // Normalize string for fuzzy comparison (handles typos like "Las Cruces" vs "Las Cruses")
        normalizeForFuzzy(str) {
            if (!str) return '';
            return str.toLowerCase()
                .replace(/[^a-z0-9]/g, '') // Remove non-alphanumeric
                .trim();
        },
        // Levenshtein edit distance (for reliable fuzzy comparison)
        editDistance(a, b) {
            if (a === b) return 0;
            if (!a.length) return b.length;
            if (!b.length) return a.length;
            const matrix = [];
            for (let i = 0; i <= b.length; i++) matrix[i] = [i];
            for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
            for (let i = 1; i <= b.length; i++) {
                for (let j = 1; j <= a.length; j++) {
                    const cost = a[j - 1] === b[i - 1] ? 0 : 1;
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j - 1] + cost
                    );
                }
            }
            return matrix[b.length][a.length];
        },
        // Calculate similarity between two strings (0-1) using edit distance
        stringSimilarity(str1, str2) {
            const s1 = this.normalizeForFuzzy(str1);
            const s2 = this.normalizeForFuzzy(str2);
            if (s1 === s2) return 1;
            if (!s1 || !s2) return 0;
            const maxLen = Math.max(s1.length, s2.length);
            return 1 - (this.editDistance(s1, s2) / maxLen);
        },
        extractUnit(addressStr) {
            if (!addressStr) return null;
            const str = addressStr.toLowerCase();
            const patterns = [
                /(?:apt|apartment)\.?\s*#?\s*([a-z0-9-]+)/i,
                /(?:unit|ste|suite)\.?\s*#?\s*([a-z0-9-]+)/i,
                /(?:spc|space)\.?\s*#?\s*([a-z0-9-]+)/i,
                /(?:bldg|building|fl|floor|rm|room)\.?\s*#?\s*([a-z0-9-]+)/i,
                /#\s*([a-z0-9-]+)/i
            ];
            for (const pattern of patterns) {
                const match = str.match(pattern);
                if (match) return match[1].replace(/^#/, '').trim();
            }
            return null;
        },
        hasUnitInfo(addressStr) {
            if (!addressStr) return false;
            // More comprehensive unit detection including "Apt B", "Apt 7", "#5", etc.
            return /(?:apt|apartment|unit|ste|suite|spc|space)\.?\s*#?\s*[a-z0-9]/i.test(addressStr) ||
                   /#\s*[a-z0-9]/i.test(addressStr);
        },
        // Extract city name from address for duplicate checking
        extractCity(addressStr) {
            if (!addressStr) return null;
            const cleaned = this.cleanAddress(addressStr);
            const parts = cleaned.split(',').map(p => p.trim()).filter(p => p);
            // City is usually the second-to-last or third-to-last part
            // Look for a part that's just a city name (no numbers, not a state abbrev)
            for (let i = parts.length - 1; i >= 0; i--) {
                const part = parts[i];
                // Skip state abbreviations (2 letters) and parts with numbers
                if (part.length === 2 || /\d/.test(part)) continue;
                // Skip parts that look like street addresses
                if (/\b(st|ave|blvd|dr|rd|ln|ct|cir|trl|way|pl)\b/i.test(part)) continue;
                // This is likely the city
                return part.toLowerCase().trim();
            }
            return null;
        },
        hasDuplicateComponents(addressStr) {
            if (!addressStr) return false;
            const cleaned = this.cleanAddress(addressStr);
            // Normalize the whole string so "Street"/"St", "Avenue"/"Ave" etc. collapse
            const normalized = this.normalizeStreet(cleaned);
            // Split on commas if present; otherwise tokenize into segments heuristically
            let parts;
            if (cleaned.includes(',')) {
                parts = normalized.split(',').map(p => p.trim().toLowerCase()).filter(p => p);
            } else {
                // No commas — split around the street type to get logical segments
                // e.g. "1234 main st san bernardino ca 92407" -> ["1234 main st", "san bernardino ca 92407"]
                const typeBreak = normalized.match(/^(.+?\b(?:st|ave|blvd|dr|rd|ln|ct|cir|trl|way|pl|pkwy|hwy|ter)\b\.?)(\s+.+)?$/i);
                if (typeBreak && typeBreak[2]) {
                    parts = [typeBreak[1].trim().toLowerCase(), typeBreak[2].trim().toLowerCase()];
                } else {
                    parts = [normalized.toLowerCase()];
                }
            }

            // Check for duplicate parts (exact or fuzzy, catches typos like "Bernardino" vs "Bernadino")
            const seenParts = [];
            for (const part of parts) {
                if (part.length <= 3) { seenParts.push(part); continue; }
                for (const prev of seenParts) {
                    if (prev.length <= 3) continue;
                    if (part === prev || this.stringSimilarity(part, prev) > 0.8) {
                        console.log('🔴 Duplicate component:', prev, 'vs', part);
                        return true;
                    }
                }
                seenParts.push(part);
            }

            // Check for duplicate street patterns (number + one or more words)
            // Broader regex: captures "1234 n main st", "1234 san antonio blvd", etc.
            const streetPattern = /(\d+[a-z]?\s+(?:[a-z]+\.?\s+)*[a-z]+)/gi;
            const streetMatches = normalized.match(streetPattern) || [];
            if (streetMatches.length >= 2) {
                for (let i = 0; i < streetMatches.length; i++) {
                    for (let j = i + 1; j < streetMatches.length; j++) {
                        const sim = this.stringSimilarity(streetMatches[i], streetMatches[j]);
                        if (sim > 0.75) {
                            console.log('🔴 Duplicate street (fuzzy):', streetMatches[i], 'vs', streetMatches[j], 'similarity:', sim);
                            return true;
                        }
                    }
                }
            }

            // Check for city appearing multiple times (works with or without commas)
            // Fuzzy: catches typos like "Bernardino" vs "Bernadino" and spacing variants
            const city = this.extractCity(addressStr);
            if (city && city.length > 3) {
                const cityNorm = this.normalizeForFuzzy(city);
                let cityCount = 0;
                for (const part of parts) {
                    const partNorm = this.normalizeForFuzzy(part);
                    if (partNorm.includes(cityNorm) || cityNorm.includes(partNorm) ||
                        this.stringSimilarity(partNorm, cityNorm) > 0.8) {
                        cityCount++;
                    }
                }
                // Also scan the full string for repeated city name even without parts
                if (cityCount < 2) {
                    const cityRegex = new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                    const fullMatches = normalized.match(cityRegex);
                    if (fullMatches && fullMatches.length >= 2) cityCount = fullMatches.length;
                }
                if (cityCount >= 2) {
                    console.log('🔴 Duplicate city:', city, 'appears', cityCount, 'times');
                    return true;
                }
            }

            // Check for duplicate unit numbers
            const unitPattern = /(?:apt|apartment|unit|spc|space|ste|suite|#)\s*#?\s*([a-z0-9]+)/gi;
            const unitMatches = [];
            let match;
            while ((match = unitPattern.exec(normalized)) !== null) {
                unitMatches.push(match[1].toLowerCase());
            }
            if (unitMatches.length >= 2 && new Set(unitMatches).size < unitMatches.length) {
                console.log('🔴 Duplicate units:', unitMatches);
                return true;
            }

            return false;
        },
        parseAddress(addressStr) {
            const cleaned = this.cleanAddress(addressStr);
            let parsed = {};
            // Built-in US address parser (no external library needed)
            // Handles both comma-separated and non-comma-separated addresses
            const parts = cleaned.split(',').map(p => p.trim()).filter(p => p);
            // Helper: parse the street portion (number, prefix, street name, type, suffix)
            const parseStreetPart = (streetPart) => {
                // Strip unit info before parsing
                const unitPatterns = [
                    /\s+(?:apt|apartment|unit|ste|suite|spc|space)\.?\s*#?\s*[a-z0-9-]+$/i,
                    /\s+#\s*[a-z0-9-]+$/i
                ];
                for (const up of unitPatterns) {
                    streetPart = streetPart.replace(up, '');
                }
                const streetMatch = streetPart.match(/^(\d+[A-Za-z]?)\s+(.+)/);
                if (streetMatch) {
                    parsed.number = streetMatch[1];
                    let remainder = streetMatch[2].trim();
                    // Check for prefix direction (N, S, E, W, etc.)
                    const prefixMatch = remainder.match(/^(N|S|E|W|NE|NW|SE|SW|North|South|East|West|Northeast|Northwest|Southeast|Southwest)\.?\s+(.+)/i);
                    if (prefixMatch) {
                        parsed.prefix = prefixMatch[1];
                        remainder = prefixMatch[2];
                    }
                    // Extract street type from end of remainder
                    const typePattern = /\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|cir|circle|trl|trail|way|pl|place|pkwy|parkway|hwy|highway|ter|terrace)\.?\s*$/i;
                    const typeMatch = remainder.match(typePattern);
                    if (typeMatch) {
                        parsed.type = typeMatch[1];
                        parsed.street = remainder.substring(0, remainder.lastIndexOf(typeMatch[0])).trim();
                    } else {
                        // Check for type + suffix direction like "St N"
                        const typeSuffixPattern = /\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|cir|circle|trl|trail|way|pl|place|pkwy|parkway|hwy|highway|ter|terrace)\.?\s+(N|S|E|W|NE|NW|SE|SW)\s*$/i;
                        const typeSuffixMatch = remainder.match(typeSuffixPattern);
                        if (typeSuffixMatch) {
                            parsed.type = typeSuffixMatch[1];
                            parsed.suffix = typeSuffixMatch[2];
                            parsed.street = remainder.substring(0, remainder.lastIndexOf(typeSuffixMatch[0])).trim();
                        } else {
                            parsed.street = remainder;
                        }
                    }
                }
            };
            if (parts.length >= 2) {
                // Comma-separated: extract state/zip/city from trailing parts
                const lastPart = parts[parts.length - 1];
                const stateZipMatch = lastPart.match(/^\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
                if (stateZipMatch) {
                    parsed.state = stateZipMatch[1];
                    parsed.zip = stateZipMatch[2];
                    if (parts.length >= 3) {
                        parsed.city = parts[parts.length - 2];
                    }
                } else {
                    const combinedMatch = lastPart.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
                    if (combinedMatch) {
                        parsed.city = combinedMatch[1];
                        parsed.state = combinedMatch[2];
                        parsed.zip = combinedMatch[3];
                    } else {
                        const stateOnly = lastPart.match(/^\s*([A-Za-z]{2})\s*$/);
                        if (stateOnly && parts.length >= 3) {
                            parsed.state = stateOnly[1];
                            parsed.city = parts[parts.length - 2];
                        } else if (parts.length >= 2 && !/\d/.test(lastPart)) {
                            parsed.city = lastPart;
                        }
                    }
                }
                parseStreetPart(parts[0]);
            } else {
                // No commas (or single segment) — parse the whole string
                // Try to extract state + zip from the end first
                let remainder = cleaned;
                const szMatch = remainder.match(/\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
                if (szMatch) {
                    parsed.state = szMatch[1];
                    parsed.zip = szMatch[2];
                    remainder = remainder.substring(0, szMatch.index).trim();
                }
                // Try to extract city: text between street type and state
                // e.g. "1234 Main St San Bernardino" -> city = "San Bernardino"
                const streetTypeInLine = /\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|cir|circle|trl|trail|way|pl|place|pkwy|parkway|hwy|highway|ter|terrace)\.?\s+/i;
                const stMatch = remainder.match(streetTypeInLine);
                if (stMatch) {
                    const afterType = remainder.substring(stMatch.index + stMatch[0].length).trim();
                    // Everything after the street type (minus state/zip already stripped) is city
                    if (afterType && !/^\d/.test(afterType)) {
                        parsed.city = afterType;
                        // Pass only up through street type to street parser
                        parseStreetPart(remainder.substring(0, stMatch.index + stMatch[0].length).trim());
                    } else {
                        parseStreetPart(remainder);
                    }
                } else {
                    parseStreetPart(remainder);
                }
            }
            // Unit extraction
            if (!parsed.sec_unit_num) {
                const unit = this.extractUnit(cleaned);
                if (unit) parsed.sec_unit_num = unit;
            }
            parsed._original = addressStr;
            parsed._cleaned = cleaned;
            return parsed;
        },
        createComparisonKey(parsed) {
            // Only house number + street name determine "same address"
            // (type/city/state differ too often between duplicate entries for the same person)
            const parts = [];
            if (parsed.number) parts.push(parsed.number.toLowerCase());
            if (parsed.street) parts.push(this.normalizeStreet(parsed.street));
            return parts.join('|');
        },
        calculateCompleteness(parsed, originalStr) {
            let score = 0;
            if (parsed.number) score += 10;
            if (parsed.street) score += 10;
            if (parsed.type) score += 5;
            if (parsed.city) score += 10;
            if (parsed.state) score += 10;
            if (parsed.zip) score += 10;
            // Unit/apartment number is valuable
            if (parsed.sec_unit_num || parsed.sec_unit_type) {
                score += 15;
            } else if (this.hasUnitInfo(originalStr)) {
                score += 15;
            }
            if (parsed.prefix) score += 3;
            if (parsed.suffix) score += 3;
            // Bonus for having country info (checked before stripping)
            if (this.hasCountry(originalStr)) {
                score += 5;
            }
            // Heavy penalty for duplicates
            if (this.hasDuplicateComponents(originalStr)) score -= 100;
            // Penalty for malformed (number not at start)
            if (originalStr && !parsed.number) {
                if (/\s\d{4,5}\s*,/.test(originalStr)) score -= 20;
            }
            return score;
        },
        compareAddresses(leftAddr, rightAddr) {
            const result = {
                areSame: false,
                winner: 'tie',
                reason: '',
                leftScore: 0,
                rightScore: 0
            };

            // Check for duplicates first
            const leftHasDupes = this.hasDuplicateComponents(leftAddr);
            const rightHasDupes = this.hasDuplicateComponents(rightAddr);
            if (leftHasDupes && rightHasDupes) {
                result.winner = 'neither';
                result.reason = 'Both have duplicates';
                return result;
            }
            if (leftHasDupes) {
                result.winner = 'right';
                result.reason = 'Left has duplicates';
                result.areSame = false;
                return result;
            }
            if (rightHasDupes) {
                result.winner = 'left';
                result.reason = 'Right has duplicates';
                result.areSame = false;
                return result;
            }

            // Parse and compare
            const leftParsed = this.parseAddress(leftAddr);
            const rightParsed = this.parseAddress(rightAddr);
            const leftKey = this.createComparisonKey(leftParsed);
            const rightKey = this.createComparisonKey(rightParsed);
            result.areSame = leftKey === rightKey && leftKey.length > 0;
            // Fallback: if structured keys didn't match or were empty,
            // extract and compare just the leading "number + street name" from
            // the cleaned address strings (handles missing commas, odd formatting)
            if (!result.areSame) {
                const extractNumberAndStreet = (addr) => {
                    let s = this.cleanAddress(addr);
                    s = this.normalizeStreet(s);
                    // Grab leading "number streetname" before any comma, city, state, zip
                    const m = s.match(/^(\d+[a-z]?)\s+(.+?)(?:\s*,|\s+\d{5}|\s+[a-z]{2}\s+\d{5}|$)/i);
                    if (!m) return '';
                    return (m[1] + ' ' + m[2]).replace(/[^a-z0-9]/g, '');
                };
                const leftNorm = extractNumberAndStreet(leftAddr);
                const rightNorm = extractNumberAndStreet(rightAddr);
                if (leftNorm && rightNorm && leftNorm === rightNorm && leftNorm.length > 3) {
                    result.areSame = true;
                }
            }
            result.leftScore = this.calculateCompleteness(leftParsed, leftAddr);
            result.rightScore = this.calculateCompleteness(rightParsed, rightAddr);

            // IMPORTANT: Only pick winner based on completeness if addresses are THE SAME
            // If addresses are different, don't auto-select - leave for email tiebreaker or manual review
            if (result.areSame) {
                if (result.leftScore > result.rightScore) {
                    result.winner = 'left';
                    result.reason = `Same address, left more complete (${result.leftScore} vs ${result.rightScore})`;
                } else if (result.rightScore > result.leftScore) {
                    result.winner = 'right';
                    result.reason = `Same address, right more complete (${result.rightScore} vs ${result.leftScore})`;
                } else {
                    // Same address with equal completeness - default to left
                    result.winner = 'left';
                    result.reason = 'Same address, equal completeness - defaulting to left';
                }
            } else {
                // Different addresses - don't auto-select based on completeness
                result.winner = 'tie';
                result.reason = 'Different addresses - manual review or follow email';
            }

            return result;
        },
        pickBetterAddress(leftAddr, rightAddr) {
            const comparison = this.compareAddresses(leftAddr, rightAddr);
            console.log('📍 Address comparison:', { left: leftAddr, right: rightAddr, ...comparison });
            return comparison.winner;
        }
    };
    // =========================================================
    // PART 3: LOGIC
    // =========================================================
    let lastKnownUrl = window.location.href; // Track URL for navigation detection
    let fabHasBeenClicked = false; // Track if user has clicked FAB this session (for smart links/highlight)
    let lastSparkIds = ''; // Track Spark IDs to detect content changes
    let hasScrolledToBottom = false; // Track if user has scrolled to bottom to review all fields
    let autoClickAttempted = false; // Track if auto-click was attempted this page
    // NEW: Smart reload tracking
    let seenDuplicateIds = new Set(); // Session-scoped duplicate ID tracking (limited to 10 most recent)
    const MAX_SEEN_DUPLICATES = 10;   // Maximum number of duplicate IDs to remember
    let currentDuplicateId = null;    // Current page's duplicate ID
    let previousDuplicateId = null;   // Previous page's duplicate ID (for Spark ID change detection)
    // NEW: Merge success tracking
    let mergeSuccessProcessed = false; // Track if we've processed the current merge success
    let awaitingMergeSuccess = false; // Track if we're waiting for merge success (green FAB was clicked)
    // NEW: Conflict warning tracking
    let conflictWarningShown = false; // Track if we've shown the conflict warning for this page
    // NEW: Auto-skip blocked tracking
    let autoSkipAttempted = false; // Track if we've attempted auto-skip for this page
    // --- HELPER: EXTRACT DUPLICATE ID FROM URL ---
    function extractDuplicateId(url) {
        const match = url.match(/\/duplicates\/([a-f0-9]{24})/i);
        const id = match ? match[1].toLowerCase() : null;
        // Debug logging for extraction failures
        if (url.includes('/duplicates/') && !id) {
            console.error('⚠️ Failed to extract duplicate ID from:', url);
        }
        return id;
    }
    // --- HELPER: ADD DUPLICATE ID TO SET WITH LIMIT ---
    function addSeenDuplicateId(id) {
        if (!id) return;
        // If already in set, delete and re-add to move to end (most recent)
        if (seenDuplicateIds.has(id)) {
            seenDuplicateIds.delete(id);
        }
        seenDuplicateIds.add(id);
        // Remove oldest entries if over limit
        while (seenDuplicateIds.size > MAX_SEEN_DUPLICATES) {
            const oldest = seenDuplicateIds.values().next().value;
            seenDuplicateIds.delete(oldest);
        }
    }
    // --- HELPER: GET CURRENT SPARK IDS ---
    function getCurrentSparkIds() {
        const rows = document.querySelectorAll('elm-merge-row');
        for (const row of rows) {
            const text = row.textContent;
            if (text.includes('Spark Id:')) {
                const values = row.querySelectorAll('elm-merge-value');
                if (values.length >= 2) {
                    const leftId = values[0].textContent.replace('Spark Id:', '').trim();
                    const rightId = values[1].textContent.replace('Spark Id:', '').trim();
                    return `${leftId}|${rightId}`;
                }
            }
        }
        return '';
    }
    // --- HELPER: CHECK IF STUDENT IS IGNORED ---
    function isStudentIgnored() {
        const chips = document.querySelectorAll('elm-chip');
        for (const chip of chips) {
            const label = chip.querySelector('.elm-chip-label');
            if (label && label.textContent.trim().toLowerCase() === 'ignored') {
                return true;
            }
        }
        return false;
    }
    // --- HELPER: CHECK IF FORBIDDEN ENTRY ---
    function isForbiddenEntry() {
        const allRows = Array.from(document.querySelectorAll('elm-merge-row'));
        let firstNameLeft = '';
        let firstNameRight = '';
        let lastNameLeft = '';
        let lastNameRight = '';
        let firstNameRow = null;
        let lastNameRow = null;
        // Extract name values from BOTH sides
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
        // Check LEFT side for "test" in either name field
        if (firstNameLeft.toLowerCase().includes('test')) {
            return { forbidden: true, row: firstNameRow, reason: 'test in first name' };
        }
        if (lastNameLeft.toLowerCase().includes('test')) {
            return { forbidden: true, row: lastNameRow, reason: 'test in last name' };
        }
        // Check RIGHT side for "test" in either name field
        if (firstNameRight.toLowerCase().includes('test')) {
            return { forbidden: true, row: firstNameRow, reason: 'test in first name' };
        }
        if (lastNameRight.toLowerCase().includes('test')) {
            return { forbidden: true, row: lastNameRow, reason: 'test in last name' };
        }
        // Check LEFT side for forbidden name combinations (exact match)
        const fullNameLeft = `${firstNameLeft} ${lastNameLeft}`.toLowerCase().trim();
        const forbiddenNames = [
            'angela armstrong',
            'gillespie armstrong',
            'mariah armstrong'
        ];
        if (forbiddenNames.includes(fullNameLeft)) {
            return { forbidden: true, row: firstNameRow, reason: 'forbidden name' };
        }
        // Check RIGHT side for forbidden name combinations (exact match)
        const fullNameRight = `${firstNameRight} ${lastNameRight}`.toLowerCase().trim();
        if (forbiddenNames.includes(fullNameRight)) {
            return { forbidden: true, row: firstNameRow, reason: 'forbidden name' };
        }
        return { forbidden: false };
    }
    // --- HELPER: CHECK IF AUTO-CLICK FAB SHOULD HAPPEN ---
    function shouldAutoClickFAB() {
        // Check if feature is enabled
        if (!CFG.AUTO_CLICK_FAB) return false;
        // Check if already attempted this page
        if (autoClickAttempted) return false;
        // Check if already clicked this page (manual or auto)
        if (fabHasBeenClicked) return false;
        // Check for Spark IDs (page loaded indicator)
        const sparkIds = getCurrentSparkIds();
        if (!sparkIds) {
            console.log('⏳ Auto-click waiting: Spark IDs not loaded yet');
            return false;
        }
        // If we just navigated, ensure Spark IDs have CHANGED from previous page
        if (previousDuplicateId && lastSparkIds === sparkIds) {
            console.log('⏳ Auto-click waiting: Spark IDs not updated yet (still showing previous page)');
            return false;
        }
        // Update lastSparkIds now that we've confirmed they changed
        if (lastSparkIds !== sparkIds) {
            console.log('🔄 Spark IDs changed - page content updated:', sparkIds);
            lastSparkIds = sparkIds;
        }
        // Check forbidden entry (highest priority block)
        if (isForbiddenEntry().forbidden) {
            console.log('⛔ Auto-click blocked: Forbidden entry detected');
            autoClickAttempted = true; // Don't retry
            return false;
        }
        // Check department lockdown
        if (isWrongDepartment().wrongDept) {
            console.log('⛔ Auto-click blocked: Wrong department detected');
            autoClickAttempted = true; // Don't retry
            return false;
        }
        // Check student ID mismatch
        if (isStudentIdMismatch().mismatch) {
            console.log('⛔ Auto-click blocked: Student ID mismatch detected');
            autoClickAttempted = true; // Don't retry
            return false;
        }
        // Check ignored student
        if (isStudentIgnored()) {
            console.log('⛔ Auto-click blocked: Ignored student detected');
            autoClickAttempted = true; // Don't retry
            return false;
        }
        return true;
    }
    // --- HELPER: CHECK FOR POSSIBLE TWINS/DIFFERENT PEOPLE ---
    function checkForConflictingRecords() {
        // Skip if disabled
        if (CONFLICT_ROW_THRESHOLD === 0) return { conflictCount: 0, shouldWarn: false };
        // Wait for Spark IDs to ensure page is fully loaded
        const currentSparkIds = getCurrentSparkIds();
        if (!currentSparkIds) {
            console.log('⏳ Conflict check waiting: Spark IDs not loaded yet');
            return { conflictCount: 0, shouldWarn: false };
        }
        const rows = document.querySelectorAll('elm-merge-row');
        let conflictCount = 0;
        const conflicts = [];
        // Helper to normalize names (case-insensitive, remove spaces and hyphens)
        const normalizeName = (name) => {
            if (!name) return '';
            return name.toLowerCase().replace(/[\s-]/g, '').trim();
        };
        // Helper to check if year is valid
        const isValidYear = (yearStr) => {
            if (!yearStr) return false;
            return !yearStr.startsWith('0') && parseInt(yearStr) >= 1900;
        };
        for (const row of rows) {
            const text = row.textContent || '';
            const textLower = text.toLowerCase();
            const values = row.querySelectorAll('elm-merge-value');
            if (values.length < 2) continue;
            const leftText = values[0]?.textContent?.trim() || '';
            const rightText = values[1]?.textContent?.trim() || '';
            // Skip if either side is empty
            if (!leftText || !rightText) continue;
            // Check First Name conflicts
            if (textLower.includes('first name')) {
                const leftNorm = normalizeName(leftText);
                const rightNorm = normalizeName(rightText);
                if (leftNorm && rightNorm && leftNorm !== rightNorm) {
                    conflictCount++;
                    conflicts.push('First Name');
                    console.log('⚠️ Conflict detected - First Name:', leftText, 'vs', rightText);
                }
                continue;
            }
            // Check Last Name conflicts
            if (textLower.includes('last name')) {
                const leftNorm = normalizeName(leftText);
                const rightNorm = normalizeName(rightText);
                if (leftNorm && rightNorm && leftNorm !== rightNorm) {
                    conflictCount++;
                    conflicts.push('Last Name');
                    console.log('⚠️ Conflict detected - Last Name:', leftText, 'vs', rightText);
                }
                continue;
            }
            // Check Date of Birth conflicts
            if (textLower.includes('date of birth') || textLower.includes('birth date')) {
                const leftYear = leftText.match(/\b(\d{4})\b/);
                const rightYear = rightText.match(/\b(\d{4})\b/);
                // Only compare if both have valid years
                if (leftYear && rightYear && isValidYear(leftYear[1]) && isValidYear(rightYear[1])) {
                    // Compare full dates if possible, or just years
                    const leftDateNorm = leftText.replace(/\s+/g, '').toLowerCase();
                    const rightDateNorm = rightText.replace(/\s+/g, '').toLowerCase();
                    if (leftDateNorm !== rightDateNorm) {
                        conflictCount++;
                        conflicts.push('Date of Birth');
                        console.log('⚠️ Conflict detected - Date of Birth:', leftText, 'vs', rightText);
                    }
                }
                continue;
            }
            // Check Address conflicts (using existing AddressComparer)
            if (textLower.includes('home,') || /\d+\s+[A-Za-z]+\s+(St|Ave|Blvd|Dr|Rd|Ln|Ct|Cir|Trl|Way|Pl)\b/i.test(text)) {
                const comparison = AddressComparer.compareAddresses(leftText, rightText);
                // If addresses are NOT the same, it's a conflict
                if (!comparison.areSame && leftText.length > 10 && rightText.length > 10) {
                    conflictCount++;
                    conflicts.push('Address');
                    console.log('⚠️ Conflict detected - Address:', leftText, 'vs', rightText);
                }
                continue;
            }
        }
        const shouldWarn = conflictCount >= CONFLICT_ROW_THRESHOLD;
        if (shouldWarn) {
            console.log('🔴 High conflict count detected:', conflictCount, 'conflicts in:', conflicts.join(', '));
        }
        return { conflictCount, shouldWarn, conflicts };
    }
    // --- HELPER: ATTEMPT AUTO-CLICK FAB ---
    function attemptAutoClickFAB() {
        if (!shouldAutoClickFAB()) {
            // If blocked, attempt auto-skip to next entry
            attemptAutoSkipBlocked();
            return;
        }
        // Check for conflicting records before auto-clicking (possible twins/different people)
        if (!conflictWarningShown && CONFLICT_ROW_THRESHOLD > 0) {
            const { conflictCount, shouldWarn, conflicts } = checkForConflictingRecords();
            if (shouldWarn) {
                conflictWarningShown = true; // Don't show again for this page
                alert(`⚠️ Warning: ${conflictCount} conflicting rows detected!\n\nConflicts found in: ${conflicts.join(', ')}\n\nThese entries might be twins or two different people. Please review carefully before merging.`);
            }
        }
        const actionWrapper = document.querySelector('.elm-page-action-floating');
        const btn = actionWrapper ? actionWrapper.querySelector('button') : null;
        if (btn) {
            console.log('🤖 Auto-clicking FAB (triggered by page load)...');
            autoClickAttempted = true; // Mark as attempted
            btn.click();
        } else {
            console.log('⚠️ Auto-click failed: FAB button not found');
        }
    }
    // --- AUTO-SKIP BLOCKED ENTRIES ---
    function attemptAutoSkipBlocked() {
        // Check if feature is enabled
        if (!CFG.AUTO_SKIP_BLOCKED) return;
        // Check if already attempted this page
        if (autoSkipAttempted) return;
        // Only skip if auto-click was attempted and blocked (not just waiting for page load)
        if (!autoClickAttempted) return;
        // Verify the entry is actually blocked
        const isBlocked = isForbiddenEntry().forbidden ||
                          isWrongDepartment().wrongDept ||
                          isStudentIdMismatch().mismatch ||
                          isStudentIgnored();
        if (!isBlocked) return;
        autoSkipAttempted = true;
        // Check if csv-database.js is installed by looking for its localStorage key.
        // The database script creates this key on first record. If it has never been
        // created, the script is not installed — skip immediately without waiting.
        const dbInstalled = localStorage.getItem('elm_csv_database') !== null;
        if (!dbInstalled) {
            console.log('⏭️ Auto-skip: Blocked entry detected (database script not installed), skipping to next...');
            // Brief delay so the blocked state is visible before skipping
            setTimeout(navigateToNext, 1500);
            return;
        }
        console.log('⏭️ Auto-skip: Blocked entry detected, waiting for database to record before skipping...');
        // Wait for csv-database.js to record this entry before navigating.
        // The database script polls body[data-csv-dept] every 1s and writes to localStorage.
        // We poll localStorage to confirm the current entry's unique ID has been recorded.
        const uniqueIdMatch = window.location.href.match(/\/duplicates\/([a-f0-9]{24})/i);
        const currentUniqueId = uniqueIdMatch ? uniqueIdMatch[1].toLowerCase() : null;
        let pollCount = 0;
        const maxPolls = 20; // Up to 10 seconds (20 × 500ms)
        const pollInterval = 500;
        function waitForDatabaseThenSkip() {
            pollCount++;
            // Re-check if entry is still actually blocked. New merge rows may have
            // loaded since the initial check (e.g., grad rows appearing after Spark IDs),
            // which changes the department detection result. Without this re-check,
            // a grad entry would be permanently skipped when allowed dept is Grad
            // because the initial scan (before grad rows loaded) defaulted to UnderGrad.
            const stillBlocked = isForbiddenEntry().forbidden ||
                                 isWrongDepartment().wrongDept ||
                                 isStudentIdMismatch().mismatch ||
                                 isStudentIgnored();
            if (!stillBlocked) {
                console.log('⏭️ Auto-skip aborted: Entry is no longer blocked (new rows changed detection)');
                autoClickAttempted = false;
                autoSkipAttempted = false;
                attemptAutoClickFAB();
                return;
            }
            // Check if the database has recorded this entry
            let recorded = false;
            if (currentUniqueId) {
                try {
                    const dbData = localStorage.getItem('elm_csv_database');
                    const db = dbData ? JSON.parse(dbData) : [];
                    recorded = db.some(entry => entry.uniqueId === currentUniqueId);
                } catch (e) {
                    console.warn('⏭️ Auto-skip: Error reading database', e);
                }
            }
            if (recorded) {
                console.log('⏭️ Auto-skip: Database confirmed entry recorded, navigating to next...');
                navigateToNext();
            } else if (pollCount >= maxPolls) {
                // Safety fallback: skip anyway after max wait so we don't get stuck
                console.warn('⏭️ Auto-skip: Database did not record entry after ' + (maxPolls * pollInterval / 1000) + 's, skipping anyway');
                navigateToNext();
            } else {
                if (pollCount % 4 === 0) { // Log every 2 seconds
                    console.log('⏭️ Auto-skip: Waiting for database to record entry... (poll ' + pollCount + '/' + maxPolls + ')');
                }
                setTimeout(waitForDatabaseThenSkip, pollInterval);
            }
        }
        function navigateToNext() {
            const nextBtn = document.querySelector('button[mattooltip="Next"]:not([disabled])') ||
                            document.querySelector('.mat-mdc-paginator-navigation-next:not([disabled])');
            if (nextBtn) {
                console.log('⏭️ Auto-skip: Navigating to next duplicate...');
                nextBtn.click();
            } else {
                console.log('⚠️ Auto-skip: No next page available - end of list or button disabled');
            }
        }
        // Start polling after a brief delay so the blocked state is visible
        setTimeout(waitForDatabaseThenSkip, 500);
    }
    // --- MERGE SUCCESS DETECTION ---
    function checkForMergeSuccess() {
        // Only check if we're awaiting merge success (green FAB was clicked)
        if (!awaitingMergeSuccess) return;
        // Already processed this merge success
        if (mergeSuccessProcessed) return;
        // Look for the merge success element by checking for success message text
        let mergeSuccess = null;
        const emptyStates = document.querySelectorAll('elm-empty-state');
        for (const state of emptyStates) {
            if (state.textContent.includes('Duplicate user is now merged with master')) {
                mergeSuccess = state;
                break;
            }
        }
        if (!mergeSuccess) return;
        // Mark as processed to prevent duplicate triggers
        mergeSuccessProcessed = true;
        awaitingMergeSuccess = false; // No longer waiting
        // Increment merge counter
        if (CFG.SHOW_MERGE_COUNTER) {
            incrementMergeCount();
            console.log('✅ Merge successful - counter incremented');
        }
        // Auto-navigate to next duplicate if enabled
        if (CFG.AUTO_NAVIGATE_AFTER_MERGE) {
            setTimeout(() => {
                // Try multiple selectors for the next button
                const nextBtn = document.querySelector('button[mattooltip="Next"]:not([disabled])') ||
                                document.querySelector('.mat-mdc-paginator-navigation-next:not([disabled])');
                if (nextBtn) {
                    console.log('➡️ Auto-navigating to next duplicate...');
                    nextBtn.click();
                } else {
                    console.log('⚠️ No next page available - end of list or button disabled');
                }
            }, 1000); // 1 second delay to let user see success message
        }
    }
    // --- URL CHANGE DETECTION WITH SMART RELOAD ---
    function checkUrlChange() {
        const currentUrl = window.location.href;
        if (currentUrl !== lastKnownUrl) {
            const newDuplicateId = extractDuplicateId(currentUrl);
            console.log('🔍 URL changed:', {
                from: lastKnownUrl,
                to: currentUrl,
                extractedId: newDuplicateId,
                seenBefore: newDuplicateId ? seenDuplicateIds.has(newDuplicateId) : 'N/A',
                sessionHistory: Array.from(seenDuplicateIds)
            });
            // Case 1: Navigated to duplicate page
            if (newDuplicateId) {
                // Case 1a: Revisiting a previously seen duplicate
                if (seenDuplicateIds.has(newDuplicateId)) {
                    console.log('🔄 Revisiting duplicate', newDuplicateId, '- forcing reload for clean state');
                    lastKnownUrl = currentUrl;
                    window.location.reload();
                    return;
                }
                // Case 1b: First time seeing this duplicate
                console.log('✅ New duplicate', newDuplicateId, '- allowing fast navigation');
                previousDuplicateId = currentDuplicateId; // Remember where we came from
                addSeenDuplicateId(newDuplicateId);
                currentDuplicateId = newDuplicateId;
                hasScrolledToBottom = false; // Reset scroll flag for new page
                fabHasBeenClicked = false; // Reset FAB click flag for new page
                autoClickAttempted = false; // Reset auto-click flag for new page
                mergeSuccessProcessed = false; // Reset merge success flag for new page
                awaitingMergeSuccess = false; // Reset awaiting merge flag for new page
                conflictWarningShown = false; // Reset conflict warning flag for new page
                autoSkipAttempted = false; // Reset auto-skip flag for new page
                lastKnownUrl = currentUrl;
                runLogic();
                // Auto-click will be triggered by mutation observer when Spark IDs change
                // This ensures we don't click on the old page's data
            }
            // Case 2: Navigated away from duplicates (e.g., to contacts list)
            else {
                console.log('📋 Non-duplicate page - allowing navigation');
                currentDuplicateId = null;
                lastKnownUrl = currentUrl;
                runLogic();
            }
        }
    }
    // Check for URL changes periodically (for SPA navigation)
    setInterval(checkUrlChange, 500);
    // --- DEBOUNCED OBSERVER ---
    let debounceTimer = null;
    const observer = new MutationObserver((mutations) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            checkUrlChange();
            runLogic();
            // Check for merge success (for auto-navigation and counter)
            checkForMergeSuccess();
            // Attempt auto-click if not yet attempted
            if (!autoClickAttempted && !fabHasBeenClicked) {
                attemptAutoClickFAB();
            }
        }, 50);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Initialize with current page ID on first load
    const initialDuplicateId = extractDuplicateId(window.location.href);
    if (initialDuplicateId) {
        addSeenDuplicateId(initialDuplicateId);
        currentDuplicateId = initialDuplicateId;
        console.log('🎯 Initial page load - added duplicate ID to Set:', initialDuplicateId);
    }
    // Also run logic immediately on load and then periodically for the first few seconds
    runLogic();
    setTimeout(runLogic, 500);
    setTimeout(runLogic, 1000);
    setTimeout(runLogic, 2000);
    setTimeout(runLogic, 3000);
    // Attempt auto-click after giving page time to fully load
    setTimeout(attemptAutoClickFAB, 1000);
    setTimeout(attemptAutoClickFAB, 2000);
    setTimeout(attemptAutoClickFAB, 3500);
    // --- HELPER: DETECT ACTUAL DEPARTMENT ---
    // Returns the actual department of the entry: 'Grad', 'IA', or 'UnderGrad'
    // Independent of CFG.ALLOWED_DEPARTMENT - always scans for patterns.
    function detectActualDepartment() {
        const allRows = Array.from(document.querySelectorAll('elm-merge-row'));
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
            if (isGradText(text)) return 'Grad';
            if (isIAText(text)) return 'IA';
            // Outreach_ without UGRD is ambiguous — not clearly Grad or UnderGrad
            if (text.includes('Outreach_') && !text.includes('UGRD')) return 'Non-Undergrad';
        }
        return 'UnderGrad';
    }
    // --- HELPER: CHECK IF WRONG DEPARTMENT ---
    function isWrongDepartment() {
        const dept = CFG.ALLOWED_DEPARTMENT.toLowerCase();
        // "All" = no department filtering, allow everything
        if (dept === 'all') return { wrongDept: false };
        // "None" = block all departments
        if (dept === 'none') {
            const actualDept = detectActualDepartment();
            // Find the row that matches the detected department to highlight it
            const allRows = Array.from(document.querySelectorAll('elm-merge-row'));
            const isGradTextNone = (t) => t.includes('GRAD_') || /grad student/i.test(t);
            const isIATextNone = (t) => t.includes('IA_') || t.includes('_IA_') || t.includes('_IA ');
            let deptMatchRow = null;
            let fallbackRow = null;
            for (const row of allRows) {
                const text = row.textContent;
                const isRelevantRow = text.includes('Workflows') || text.includes('Application') ||
                    text.includes('Program') || text.includes('type:') ||
                    text.includes('status:') || text.includes('Outreach_');
                if (!isRelevantRow) continue;
                fallbackRow = row;
                // Prefer the row that actually matches the detected department
                if (!deptMatchRow) {
                    if (actualDept === 'Grad' && isGradTextNone(text)) deptMatchRow = row;
                    else if (actualDept === 'IA' && isIATextNone(text)) deptMatchRow = row;
                    else if (actualDept === 'Non-Undergrad' && text.includes('Outreach_') && !text.includes('UGRD')) deptMatchRow = row;
                }
            }
            const relevantRow = deptMatchRow || fallbackRow || (allRows.length > 0 ? allRows[0] : null);
            return { wrongDept: true, row: relevantRow, reason: actualDept };
        }
        const allRows = Array.from(document.querySelectorAll('elm-merge-row'));
        const isGradText = (t) => t.includes('GRAD_') || /grad student/i.test(t);
        const isIAText = (t) => t.includes('IA_') || t.includes('_IA_') || t.includes('_IA ');
        let lastRelevantRow = null;
        for (const row of allRows) {
            const text = row.textContent;
            const isRelevantRow = text.includes('Workflows') ||
                text.includes('Application') ||
                text.includes('Program') ||
                text.includes('type:') ||
                text.includes('status:') ||
                text.includes('Outreach_');
            if (!isRelevantRow) continue;
            lastRelevantRow = row;

            // Outreach_ without UGRD is ambiguous — block for ALL specific departments
            if (text.includes('Outreach_') && !text.includes('UGRD')) {
                return { wrongDept: true, row, reason: 'Non-Undergrad' };
            }

            if (dept === 'undergrad') {
                // Block GRAD and IA, allow everything else
                if (isGradText(text)) return { wrongDept: true, row, reason: 'GRAD' };
                if (isIAText(text)) return { wrongDept: true, row, reason: 'IA' };
            } else if (dept === 'grad') {
                // GRAD allowed - block IA and UnderGrad
                if (isIAText(text)) return { wrongDept: true, row, reason: 'IA' };
            } else if (dept === 'ia') {
                // IA allowed - block GRAD and UnderGrad
                if (isGradText(text)) return { wrongDept: true, row, reason: 'GRAD' };
            }
        }
        // Final check: compare detected actual department against allowed department.
        // This catches entries that default to UnderGrad (no GRAD/IA markers) when
        // the allowed department is Grad or IA, and vice versa.
        const actualDept = detectActualDepartment();
        if (actualDept.toLowerCase() !== dept) {
            // Fallback: if no keyword-matched row found, highlight the first available row
            const rowToHighlight = lastRelevantRow || (allRows.length > 0 ? allRows[0] : null);
            return { wrongDept: true, row: rowToHighlight, reason: actualDept };
        }
        return { wrongDept: false };
    }
    // --- HELPER: CHECK IF STUDENT IDS MISMATCH ---
    function isStudentIdMismatch() {
        const allRows = Array.from(document.querySelectorAll('elm-merge-row'));
        for (const row of allRows) {
            const text = row.textContent;
            // Look for "School Id:" in the Identities section
            if (text.includes('School Id:')) {
                const values = row.querySelectorAll('elm-merge-value');
                if (values.length >= 2) {
                    // Extract the School ID values (format: "School Id: 008545544")
                    const leftText = values[0].textContent.trim();
                    const rightText = values[1].textContent.trim();
                    // Extract just the ID number after "School Id:"
                    const leftMatch = leftText.match(/School Id:\s*(\d+)/i);
                    const rightMatch = rightText.match(/School Id:\s*(\d+)/i);
                    if (leftMatch && rightMatch) {
                        const leftId = leftMatch[1];
                        const rightId = rightMatch[1];
                        // If both have School IDs and they don't match, these are different students
                        if (leftId !== rightId) {
                            return { mismatch: true, row: row, leftId: leftId, rightId: rightId };
                        }
                    }
                }
            }
        }
        return { mismatch: false };
    }
    // --- MAIN LOOP ---
    function runLogic() {
        killPaginationTooltips();
        // Smart links and highlight only run after FAB has been clicked
        if (fabHasBeenClicked) {
            processSmartLinks();
            highlightApplicantSide();
        }
        checkMergeStatus();
        setupSmartNavButton();
        setupScrollDetection();
        suppressToasts();
        injectNativePagination();
        injectMergeCounter();
    }
    // --- RUN AUTO-RESOLUTION (called after FAB click) ---
    function runAutoResolution() {
        console.log('🚀 Running auto-resolution...');
        // Schedule auto-resolution with delays to allow DOM to update
        setTimeout(() => {
            autoResolveRows();
            autoDualPersonalEmails();
            autoResolveAddresses();
            checkMergeStatus();
            processSmartLinks();
            highlightApplicantSide();
            suppressToasts(); // Suppress any toasts that appeared
        }, 100);
        setTimeout(() => {
            autoResolveRows();
            autoDualPersonalEmails();
            autoResolveAddresses();
            checkMergeStatus();
            processSmartLinks();
            highlightApplicantSide();
            suppressToasts(); // Suppress any toasts that appeared
        }, 300);
        setTimeout(() => {
            autoResolveRows();
            autoDualPersonalEmails();
            autoResolveAddresses();
            checkMergeStatus();
            processSmartLinks();
            highlightApplicantSide();
            suppressToasts(); // Suppress any toasts that appeared
            console.log('✅ Auto-resolution complete');
        }, 500);
    }
    // --- FEATURE: HIGHLIGHT APPLICANT SIDE ---
    let lastHighlightUrl = '';
    function highlightApplicantSide() {
        const applicantSide = getCSUApplicationSide() || getApplicantRecordSide();
        // Remove existing highlight if no applicant side found or URL changed
        const existingHighlight = document.getElementById('elm-applicant-highlight');
        const currentUrl = window.location.href;
        // Cleanup function for container classes if status changes
        const cleanupClasses = () => {
            const existingContainer = document.querySelector('.applicant-side-left, .applicant-side-right');
            if (existingContainer) existingContainer.classList.remove('applicant-side-left', 'applicant-side-right');
        };
        if (!applicantSide) {
            if (existingHighlight) existingHighlight.remove();
            cleanupClasses();
            lastHighlightUrl = '';
            return;
        }
        // Find all merge rows
        const allRows = document.querySelectorAll('elm-merge-row');
        if (allRows.length === 0) {
            if (existingHighlight) existingHighlight.remove();
            cleanupClasses();
            return;
        }
        // Get the first and last row
        const firstRow = allRows[0];
        const lastRow = allRows[allRows.length - 1];
        // Find the scrollable container that holds all the rows
        const mergeContainer = firstRow.closest('elm-merge-container') ||
            firstRow.closest('.elm-merge-container') ||
            firstRow.closest('[class*="merge"]') ||
            firstRow.parentElement;
        if (!mergeContainer) return;
        // Find the actual scroll parent for proper positioning
        let container = mergeContainer;
        while (container && container !== document.body) {
            const style = window.getComputedStyle(container);
            if (style.position !== 'static') break;
            container = container.parentElement;
        }
        if (!container || container === document.body) {
            container = mergeContainer;
        }
        // Make sure container is positioned
        const containerStyle = window.getComputedStyle(mergeContainer);
        if (containerStyle.position === 'static') {
            mergeContainer.style.position = 'relative';
        }
        // Toggle Container Classes for Text Coloring
        mergeContainer.classList.remove('applicant-side-left', 'applicant-side-right');
        if (applicantSide === 'left') {
            mergeContainer.classList.add('applicant-side-left');
        } else {
            mergeContainer.classList.add('applicant-side-right');
        }
        // Get the bounding rectangles relative to the merge container
        const containerRect = mergeContainer.getBoundingClientRect();
        const firstRowRect = firstRow.getBoundingClientRect();
        const lastRowRect = lastRow.getBoundingClientRect();
        // Get the first row's structure to calculate width
        // Structure: [label 124px] [left value 50%] [arrow 118px] [right value 50%] [trailing 124px]
        const firstRowDivs = firstRow.querySelectorAll(':scope > div');
        if (firstRowDivs.length < 3) return;
        let highlightLeft, highlightWidth;
        if (applicantSide === 'left') {
            // Highlight from left edge to the arrow container (first two divs)
            const labelDiv = firstRowDivs[0];
            const leftValueDiv = firstRowDivs[1];
            const labelRect = labelDiv.getBoundingClientRect();
            const leftValueRect = leftValueDiv.getBoundingClientRect();
            highlightLeft = labelRect.left - containerRect.left;
            highlightWidth = (leftValueRect.right - labelRect.left);
        } else {
            // Highlight from after arrow container to right edge (last two divs)
            const rightValueDiv = firstRowDivs[3];
            const trailingDiv = firstRowDivs[4];
            if (!rightValueDiv || !trailingDiv) return;
            const rightValueRect = rightValueDiv.getBoundingClientRect();
            const trailingRect = trailingDiv.getBoundingClientRect();
            highlightLeft = rightValueRect.left - containerRect.left;
            highlightWidth = (trailingRect.right - rightValueRect.left);
        }
        // Calculate top and height relative to the container
        const highlightTop = firstRowRect.top - containerRect.top + mergeContainer.scrollTop;
        const highlightHeight = lastRowRect.bottom - firstRowRect.top;
        // Create or update the highlight overlay
        let highlight = existingHighlight;
        if (!highlight) {
            highlight = document.createElement('div');
            highlight.id = 'elm-applicant-highlight';
            mergeContainer.appendChild(highlight);
        } else if (highlight.parentElement !== mergeContainer) {
            // Move highlight to correct container if it changed
            mergeContainer.appendChild(highlight);
        }
        highlight.style.left = `${highlightLeft}px`;
        highlight.style.top = `${highlightTop}px`;
        highlight.style.width = `${highlightWidth}px`;
        highlight.style.height = `${highlightHeight}px`;
        lastHighlightUrl = currentUrl;
    }
    // Helper to get applicant record side (from Application type entries)
    function getApplicantRecordSide() {
        const rows = document.querySelectorAll('elm-merge-row[data-applicant-record]');
        for (const row of rows) {
            return row.dataset.applicantRecord;
        }
        return null;
    }
    // --- FEATURE: AUTO-RESOLVE ADDRESSES ---
    function autoResolveAddresses() {
        // Check if applicant side was detected (highest priority)
        const applicantSide = getCSUApplicationSide() || getApplicantRecordSide();
        // ONLY process rows that Element has marked as conflicts (has-error class)
        const rows = document.querySelectorAll('elm-merge-row.has-error:not([data-address-resolved])');
        rows.forEach(row => {
            const text = row.textContent || '';
            // Only process rows that look like addresses
            const isAddressRow = text.includes('Home,') ||
                /\d+\s+[A-Za-z]+\s+(St|Ave|Blvd|Dr|Rd|Ln|Ct|Cir|Trl|Way|Pl)\b/i.test(text);
            if (!isAddressRow) return;
            // Skip if this looks like an email row or other non-address
            if (text.includes('@') && !text.includes('Home,')) return;
            const values = row.querySelectorAll('elm-merge-value');
            if (values.length !== 2) return;
            const leftText = values[0].textContent.trim();
            const rightText = values[1].textContent.trim();
            // Skip if either is empty
            if (!leftText || !rightText) return;
            // Both must look like addresses
            const leftIsAddress = leftText.includes('Home,') || /\d+\s+\w+/.test(leftText);
            const rightIsAddress = rightText.includes('Home,') || /\d+\s+\w+/.test(rightText);
            if (!leftIsAddress && !rightIsAddress) return;
            // Mark as processed
            row.dataset.addressResolved = "true";
            // HIGHEST PRIORITY: If applicant side was found, follow it
            if (applicantSide) {
                clickSide(row, applicantSide);
                console.log('📍 Address following applicant side:', applicantSide);
                return;
            }
            // ONLY if no applicant side: Compare addresses
            const comparison = AddressComparer.compareAddresses(leftText, rightText);
            let winner = comparison.winner;
            console.log('📍 Address comparison:', { left: leftText, right: rightText, ...comparison });
            // If it's a tie, follow the email selection
            if (winner === 'tie') {
                const emailSide = getSelectedEmailSide();
                if (emailSide) {
                    winner = emailSide;
                    console.log('📍 Address tie-breaker: following email selection ->', emailSide);
                }
            }
            if (winner === 'left') {
                clickSide(row, 'left');
            } else if (winner === 'right') {
                clickSide(row, 'right');
            } else if (winner === 'neither') {
                console.log('⚠️ Neither address is good - manual review needed');
            }
            // If still 'tie' (no email selection available), don't auto-select either
        });
    }
    // --- FEATURE: AUTO-RESOLVE ROWS ---
    function autoResolveRows() {
        // STEP 1: DISCOVERY - Scan ALL rows (not just conflicts) to find applicant side
        const allRows = document.querySelectorAll('elm-merge-row');
        let applicantSide = getCSUApplicationSide();
        if (!applicantSide) {
            for (const row of allRows) {
                const text = row.textContent || "";
                const values = row.querySelectorAll('elm-merge-value');
                if (values.length !== 2) continue;
                const leftText = values[0].textContent.trim();
                const rightText = values[1].textContent.trim();
                // Check for Cal State Apply Application (highest priority)
                if (text.includes('Cal State Apply Application')) {
                    const leftHasCSU = leftText.includes('Cal State Apply Application');
                    const rightHasCSU = rightText.includes('Cal State Apply Application');
                    console.log('🎓 Cal State Apply found:', { leftHasCSU, rightHasCSU });
                    if (leftHasCSU && !rightHasCSU) {
                        applicantSide = 'left';
                        row.dataset.csuApplication = "left";
                    }
                    else if (rightHasCSU && !leftHasCSU) {
                        applicantSide = 'right';
                        row.dataset.csuApplication = "right";
                    }
                    else if (leftHasCSU && rightHasCSU) {
                        // Both have Cal State Apply - pick the one with most recent date
                        const leftDate = parseApplicationDate(leftText);
                        const rightDate = parseApplicationDate(rightText);
                        console.log('🎓 Both have Cal State Apply, comparing dates:', { leftDate, rightDate });
                        if (leftDate && rightDate) {
                            applicantSide = (leftDate >= rightDate) ? 'left' : 'right';
                        } else if (leftDate) {
                            applicantSide = 'left';
                        } else if (rightDate) {
                            applicantSide = 'right';
                        } else {
                            applicantSide = 'left'; // Default to left if no dates
                        }
                        row.dataset.csuApplication = applicantSide;
                    }
                    if (applicantSide) {
                        console.log('🎓 Applicant side determined (CSU):', applicantSide);
                        break; // Found it, stop scanning
                    }
                }
                // Check for Application type entries (Application Start, Submit, Complete, Admit)
                const applicationPattern = /type:\s*(Application Start|Application Submit|Application Complete|Admit)/i;
                const leftHasApplication = applicationPattern.test(leftText);
                const rightHasApplication = applicationPattern.test(rightText);
                if (leftHasApplication || rightHasApplication) {
                    console.log('📋 Application type entries found:', { leftHasApplication, rightHasApplication });
                    if (leftHasApplication && !rightHasApplication) {
                        applicantSide = 'left';
                        row.dataset.applicantRecord = "left";
                        console.log('📋 Applicant side determined (Application entries): left');
                        break;
                    }
                    else if (rightHasApplication && !leftHasApplication) {
                        applicantSide = 'right';
                        row.dataset.applicantRecord = "right";
                        console.log('📋 Applicant side determined (Application entries): right');
                        break;
                    }
                    else if (leftHasApplication && rightHasApplication) {
                        // Both have application entries - count them or compare dates
                        const leftCount = (leftText.match(/type:\s*(Application|Admit)/gi) || []).length;
                        const rightCount = (rightText.match(/type:\s*(Application|Admit)/gi) || []).length;
                        console.log('📋 Both have application entries:', { leftCount, rightCount });
                        if (rightCount > leftCount) {
                            applicantSide = 'right';
                        } else if (leftCount > rightCount) {
                            applicantSide = 'left';
                        } else {
                            // Same count - try to find most recent date
                            const leftDate = parseApplicationDate(leftText);
                            const rightDate = parseApplicationDate(rightText);
                            if (leftDate && rightDate) {
                                applicantSide = (rightDate > leftDate) ? 'right' : 'left';
                            } else {
                                applicantSide = 'right'; // Default to right if tied
                            }
                        }
                        row.dataset.applicantRecord = applicantSide;
                        console.log('📋 Applicant side determined (more entries):', applicantSide);
                        break;
                    }
                }
            }
        }
        // STEP 2: ACTION - Apply to only conflict rows (has-error class)
        const conflictRows = document.querySelectorAll('elm-merge-row.has-error:not([data-auto-resolved])');
        conflictRows.forEach(row => {
            const text = row.textContent || "";
            const values = row.querySelectorAll('elm-merge-value');
            // Skip rows where we don't have two values to compare
            if (values.length !== 2) return;
            const leftText = values[0].textContent.trim();
            const rightText = values[1].textContent.trim();
            // HIGHEST PRIORITY: If applicant side was found, ALL conflict rows follow it
            if (applicantSide) {
                row.dataset.autoResolved = "true";
                if (applicantSide === 'left') {
                    clickSide(row, 'left');
                    console.log('✅ Following applicant side (LEFT) for row:', text.substring(0, 50));
                } else {
                    clickSide(row, 'right');
                    console.log('✅ Following applicant side (RIGHT) for row:', text.substring(0, 50));
                }
                return;
            }
            // === BELOW ONLY RUNS IF NO APPLICANT RECORD WAS FOUND ===
            // NEW FEATURE 1: Milestone Type Matching
            if (text.match(/type:\s*\w+,\s*\w{3}\s+\d{1,2},\s*\d{4}/i)) {
                const typePattern = /type:\s*(\w+),/i;
                const leftTypeMatch = leftText.match(typePattern);
                const rightTypeMatch = rightText.match(typePattern);
                if (leftTypeMatch && rightTypeMatch) {
                    const leftType = leftTypeMatch[1].toLowerCase();
                    const rightType = rightTypeMatch[1].toLowerCase();
                    // If both types are the same, prefer left side
                    if (leftType === rightType) {
                        row.dataset.autoResolved = "true";
                        row.dataset.milestoneTypeMatch = "true";
                        clickSide(row, 'left');
                        console.log('✅ Milestone type match - selected left:', leftType);
                        return;
                    }
                }
            }
            // Special handling for Email rows - prefer personal domains
            if (text.toLowerCase().includes('email')) {
                // Added outlook.com and live.com
                const personalDomains = ['gmail.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'aol.com', 'me.com', 'outlook.com', 'live.com', 'msn.com', 'protonmail.com', 'proton.me'];
                const leftIsPersonal = personalDomains.some(domain => leftText.toLowerCase().includes('@' + domain));
                const rightIsPersonal = personalDomains.some(domain => rightText.toLowerCase().includes('@' + domain));
                if (leftIsPersonal && !rightIsPersonal) {
                    row.dataset.autoResolved = "true";
                    row.dataset.emailSelection = "left";
                    clickSide(row, 'left');
                    return;
                }
                else if (rightIsPersonal && !leftIsPersonal) {
                    row.dataset.autoResolved = "true";
                    row.dataset.emailSelection = "right";
                    clickSide(row, 'right');
                    return;
                }
                if (leftIsPersonal && rightIsPersonal) {
                    console.log('✅ Found dual personal emails, marking row:', leftText, rightText);
                    row.dataset.autoResolved = "true";
                    row.dataset.dualPersonal = "true";
                    return;
                }
            }
            // NEW FEATURE 2: csusb.major Preference
            if (text.match(/csusb\.major\./i)) {
                const leftHasCsusbMajor = /csusb\.major\./i.test(leftText);
                const rightHasCsusbMajor = /csusb\.major\./i.test(rightText);
                // If only one side has csusb.major, select that side
                if (leftHasCsusbMajor && !rightHasCsusbMajor) {
                    row.dataset.autoResolved = "true";
                    row.dataset.csusbMajorSelection = "left";
                    clickSide(row, 'left');
                    console.log('✅ csusb.major - only left has it, selected left');
                    return;
                }
                else if (rightHasCsusbMajor && !leftHasCsusbMajor) {
                    row.dataset.autoResolved = "true";
                    row.dataset.csusbMajorSelection = "right";
                    clickSide(row, 'right');
                    console.log('✅ csusb.major - only right has it, selected right');
                    return;
                }
                // If BOTH sides have csusb.major, follow email selection
                if (leftHasCsusbMajor && rightHasCsusbMajor) {
                    const emailSide = getSelectedEmailSide();
                    if (emailSide) {
                        row.dataset.autoResolved = "true";
                        row.dataset.csusbMajorFollowEmail = "true";
                        clickSide(row, emailSide);
                        console.log('✅ csusb.major - both have it, following email selection:', emailSide);
                        return;
                    } else {
                        // No email selection exists - leave for manual review
                        console.log('⚠️ csusb.major - both have it but no email selection, leaving for manual review');
                        return;
                    }
                }
            }
            // NEW FEATURE 3: Encoura ID Preference - Always select left when both sides have Encoura Id
            if (/Encoura Id:/i.test(leftText) && /Encoura Id:/i.test(rightText)) {
                row.dataset.autoResolved = "true";
                row.dataset.encouraIdSelection = "left";
                clickSide(row, 'left');
                console.log('✅ Encoura ID - both sides have Encoura Id, selected left');
                return;
            }
            // NEW FEATURE: College Board ID Preference - Always select left when both sides have College Board Id
            if (/College Board Id:/i.test(leftText) && /College Board Id:/i.test(rightText)) {
                row.dataset.autoResolved = "true";
                row.dataset.collegeBoardIdSelection = "left";
                clickSide(row, 'left');
                console.log('✅ College Board ID - both sides have College Board Id, selected left');
                return;
            }
            // NEW FEATURE 4: csusb.school Preference for Student Type rows
            if (text.includes('Student Type') && /csusb\.school\.\d+/i.test(text)) {
                const schoolPattern = /csusb\.school\.\d+/i;
                const leftHasCsusbSchool = schoolPattern.test(leftText);
                const rightHasCsusbSchool = schoolPattern.test(rightText);
                // If only one side has csusb.school, select that side
                if (leftHasCsusbSchool && !rightHasCsusbSchool) {
                    row.dataset.autoResolved = "true";
                    row.dataset.csusbSchoolSelection = "left";
                    clickSide(row, 'left');
                    console.log('✅ csusb.school - only left has it, selected left');
                    return;
                }
                else if (rightHasCsusbSchool && !leftHasCsusbSchool) {
                    row.dataset.autoResolved = "true";
                    row.dataset.csusbSchoolSelection = "right";
                    clickSide(row, 'right');
                    console.log('✅ csusb.school - only right has it, selected right');
                    return;
                }
                // If NEITHER side has csusb.school - do NOT auto-resolve (manual review required)
                if (!leftHasCsusbSchool && !rightHasCsusbSchool) {
                    console.log('⚠️ csusb.school - neither side has it, leaving for manual review');
                    return;
                }
                // If BOTH sides have csusb.school, follow email selection
                if (leftHasCsusbSchool && rightHasCsusbSchool) {
                    const emailSide = getSelectedEmailSide();
                    if (emailSide) {
                        row.dataset.autoResolved = "true";
                        row.dataset.csusbSchoolFollowEmail = "true";
                        clickSide(row, emailSide);
                        console.log('✅ csusb.school - both have it, following email selection:', emailSide);
                        return;
                    } else {
                        // No email selection exists - leave for manual review
                        console.log('⚠️ csusb.school - both have it but no email selection, leaving for manual review');
                        return;
                    }
                }
            }
            // Special handling for Date of Birth rows with invalid years
            if (text.toLowerCase().includes('date of birth') || text.toLowerCase().includes('birth date')) {
                const leftYear = leftText.match(/\b(\d{4})\b/);
                const rightYear = rightText.match(/\b(\d{4})\b/);
                const leftHasInvalidYear = leftYear && (leftYear[1].startsWith('0') || parseInt(leftYear[1]) < 1900);
                const rightHasInvalidYear = rightYear && (rightYear[1].startsWith('0') || parseInt(rightYear[1]) < 1900);
                if (leftHasInvalidYear && !rightHasInvalidYear) {
                    row.dataset.autoResolved = "true";
                    clickSide(row, 'right');
                    return;
                }
                else if (rightHasInvalidYear && !leftHasInvalidYear) {
                    row.dataset.autoResolved = "true";
                    clickSide(row, 'left');
                    return;
                }
            }
            // NEW FEATURE: First Generation Student - always prefer "Yes" over "No"
            if (text.toLowerCase().includes('first generation student')) {
                const leftIsYes = /\byes\b/i.test(leftText);
                const rightIsYes = /\byes\b/i.test(rightText);
                const leftIsNo = /\bno\b/i.test(leftText);
                const rightIsNo = /\bno\b/i.test(rightText);
                if (leftIsYes && rightIsNo) {
                    row.dataset.autoResolved = "true";
                    row.dataset.firstGenSelection = "left";
                    clickSide(row, 'left');
                    console.log('✅ First Generation Student - selected left (Yes over No)');
                    return;
                }
                else if (rightIsYes && leftIsNo) {
                    row.dataset.autoResolved = "true";
                    row.dataset.firstGenSelection = "right";
                    clickSide(row, 'right');
                    console.log('✅ First Generation Student - selected right (Yes over No)');
                    return;
                }
            }
            // NEW FEATURE: Intended Term - always prefer later date
            if (text.toLowerCase().includes('intended term')) {
                // Parse term codes like "Spring 2027 (2274)" or "Fall 2027 (2278)"
                // Term code format: YYTT where YY = year (last 2 digits + 20), TT = term (74 = Spring, 78 = Fall, etc.)
                const termCodePattern = /\((\d{4})\)/;
                const leftCodeMatch = leftText.match(termCodePattern);
                const rightCodeMatch = rightText.match(termCodePattern);
                if (leftCodeMatch && rightCodeMatch) {
                    const leftCode = parseInt(leftCodeMatch[1]);
                    const rightCode = parseInt(rightCodeMatch[1]);
                    if (rightCode > leftCode) {
                        row.dataset.autoResolved = "true";
                        row.dataset.intendedTermSelection = "right";
                        clickSide(row, 'right');
                        console.log('✅ Intended Term - selected right (later term code:', rightCode, '>', leftCode + ')');
                        return;
                    }
                    else if (leftCode > rightCode) {
                        row.dataset.autoResolved = "true";
                        row.dataset.intendedTermSelection = "left";
                        clickSide(row, 'left');
                        console.log('✅ Intended Term - selected left (later term code:', leftCode, '>', rightCode + ')');
                        return;
                    }
                    // If codes are equal, don't auto-resolve
                    console.log('⚠️ Intended Term - same term codes, leaving for manual review');
                }
            }
            // Special handling for Name rows - prefer Title Case over ALL CAPS or all lowercase
            if (text.toLowerCase().includes('first name') || text.toLowerCase().includes('last name') ||
                (text.toLowerCase().includes('name') && !text.toLowerCase().includes('email'))) {
                // Check if names are the same (case-insensitive)
                if (leftText.toLowerCase() === rightText.toLowerCase() && leftText !== rightText) {
                    const isAllUpper = (str) => str === str.toUpperCase() && str !== str.toLowerCase();
                    const isAllLower = (str) => str === str.toLowerCase() && str !== str.toUpperCase();
                    const isTitleCase = (str) => !isAllUpper(str) && !isAllLower(str);
                    const leftIsTitleCase = isTitleCase(leftText);
                    const rightIsTitleCase = isTitleCase(rightText);
                    if (rightIsTitleCase && !leftIsTitleCase) {
                        row.dataset.autoResolved = "true";
                        clickSide(row, 'right');
                        console.log('✅ Name case preference: chose right (Title Case) over', isAllUpper(leftText) ? 'ALL CAPS' : 'all lowercase');
                        return;
                    }
                    else if (leftIsTitleCase && !rightIsTitleCase) {
                        row.dataset.autoResolved = "true";
                        clickSide(row, 'left');
                        console.log('✅ Name case preference: chose left (Title Case) over', isAllUpper(rightText) ? 'ALL CAPS' : 'all lowercase');
                        return;
                    }
                }
            }
            // Patterns that should default to LEFT side (legacy behavior)
            const legacyPatterns = [
                /Spark Id:/i,
                /type:\s*Created,\s*name:\s*Record Created/i,
                /type:\s*Custom/i,
                /type:.*name:/i,
                /type:\s*Web/i,
                /\[ACUx\]/i,
                /Outreach_UGRD_/i
            ];
            // Legacy patterns - only if no applicant context
            const isLegacyMatch = legacyPatterns.some(p => p.test(text));
            if (isLegacyMatch) {
                row.dataset.autoResolved = "true";
                clickSide(row, 'left');
                return;
            }
        });
    }
    // Helper to safely click a side
    function clickSide(row, side) {
        const selector = side === 'left' ? 'mat-button-toggle:first-of-type' : 'mat-button-toggle:last-of-type';
        const toggle = row.querySelector(selector);
        // If the toggle exists and is NOT already checked
        if (toggle && !toggle.classList.contains('mat-button-toggle-checked')) {
            const btn = toggle.querySelector('button');
            if (btn) {
                btn.click();
            }
            // Fallback: sometimes Angular ignores the inner button click if propagation is blocked
            // Check after a tiny delay if it worked, if not click the host element
            setTimeout(() => {
                if (!toggle.classList.contains('mat-button-toggle-checked')) {
                    toggle.click();
                }
            }, 0);
        }
    }
    // Helper function to parse dates from Cal State Apply Application text
    function parseApplicationDate(text) {
        // Match patterns like "Apr 17, 2025 - 1:49 AM" or "updated at Apr 17, 2025 - 2:36 AM"
        const dateMatch = text.match(/(?:updated at\s*)?(\w{3})\s+(\d{1,2}),?\s+(\d{4})\s*-?\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (!dateMatch) return null;
        const months = {
            'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
            'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
        };
        const month = months[dateMatch[1].toLowerCase()];
        const day = parseInt(dateMatch[2]);
        const year = parseInt(dateMatch[3]);
        let hour = parseInt(dateMatch[4]);
        const minute = parseInt(dateMatch[5]);
        const ampm = dateMatch[6].toUpperCase();
        if (ampm === 'PM' && hour !== 12) hour += 12;
        if (ampm === 'AM' && hour === 12) hour = 0;
        return new Date(year, month, day, hour, minute);
    }
    // Helper function to get the currently selected email side
    function getSelectedEmailSide() {
        const emailRows = document.querySelectorAll('elm-merge-row');
        for (const row of emailRows) {
            const text = row.textContent || '';
            if (text.toLowerCase().includes('email') && !text.toLowerCase().includes('email open')) {
                // Check for auto-selected email
                if (row.dataset.emailSelection) {
                    return row.dataset.emailSelection;
                }
                // Check for dual-resolved email
                if (row.dataset.dualResolved) {
                    const leftToggle = row.querySelector('mat-button-toggle:first-of-type');
                    if (leftToggle && leftToggle.classList.contains('mat-button-toggle-checked')) {
                        return 'left';
                    }
                    const rightToggle = row.querySelector('mat-button-toggle:last-of-type');
                    if (rightToggle && rightToggle.classList.contains('mat-button-toggle-checked')) {
                        return 'right';
                    }
                }
                // Check for user-selected email (manually clicked)
                const leftToggle = row.querySelector('mat-button-toggle:first-of-type');
                if (leftToggle && leftToggle.classList.contains('mat-button-toggle-checked')) {
                    return 'left';
                }
                const rightToggle = row.querySelector('mat-button-toggle:last-of-type');
                if (rightToggle && rightToggle.classList.contains('mat-button-toggle-checked')) {
                    return 'right';
                }
            }
        }
        return null;
    }
    // Helper function to get the Cal State Apply Application selected side
    function getCSUApplicationSide() {
        // Return existing dataset value if we found it earlier
        const rows = document.querySelectorAll('elm-merge-row[data-csu-application]');
        for (const row of rows) {
            return row.dataset.csuApplication;
        }
        return null;
    }
    // --- FEATURE: DUAL PERSONAL EMAIL PRIORITY ---
    function autoDualPersonalEmails() {
        // ONLY process rows that Element has marked as conflicts (has-error class)
        const dualEmailRows = document.querySelectorAll('elm-merge-row.has-error[data-dual-personal]:not([data-dual-resolved])');
        if (dualEmailRows.length > 0) {
            console.log('🔍 autoDualPersonalEmails running, found', dualEmailRows.length, 'dual personal email rows');
        }
        dualEmailRows.forEach(row => {
            const values = row.querySelectorAll('elm-merge-value');
            if (values.length !== 2) return;
            const leftText = values[0].textContent.trim();
            const rightText = values[1].textContent.trim();
            const leftLower = leftText.toLowerCase();
            const rightLower = rightText.toLowerCase();
            // Get BOTH names and birth years from other rows
            const allRows = document.querySelectorAll('elm-merge-row');
            let firstNameLeft = '';
            let firstNameRight = '';
            let lastNameLeft = '';
            let lastNameRight = '';
            let birthYearLeft = '';
            let birthYearRight = '';
            let leftYearIsValid = false;
            let rightYearIsValid = false;
            allRows.forEach(r => {
                const rowText = r.textContent;
                if (rowText.includes('First Name')) {
                    const nameValues = r.querySelectorAll('elm-merge-value');
                    if (nameValues.length >= 2) {
                        firstNameLeft = nameValues[0].textContent.trim().toLowerCase();
                        firstNameRight = nameValues[1].textContent.trim().toLowerCase();
                    }
                }
                if (rowText.includes('Last Name')) {
                    const nameValues = r.querySelectorAll('elm-merge-value');
                    if (nameValues.length >= 2) {
                        lastNameLeft = nameValues[0].textContent.trim().toLowerCase();
                        lastNameRight = nameValues[1].textContent.trim().toLowerCase();
                    }
                }
                if (rowText.includes('Date of Birth')) {
                    const dobValues = r.querySelectorAll('elm-merge-value');
                    if (dobValues.length >= 2) {
                        const leftDobText = dobValues[0].textContent.trim();
                        const rightDobText = dobValues[1].textContent.trim();
                        const leftYearMatch = leftDobText.match(/\b(\d{4})\b/);
                        const rightYearMatch = rightDobText.match(/\b(\d{4})\b/);
                        if (leftYearMatch) {
                            birthYearLeft = leftYearMatch[1];
                            // Validate left year (must not start with 0 and must be >= 1900)
                            leftYearIsValid = !birthYearLeft.startsWith('0') && parseInt(birthYearLeft) >= 1900;
                        }
                        if (rightYearMatch) {
                            birthYearRight = rightYearMatch[1];
                            // Validate right year (must not start with 0 and must be >= 1900)
                            rightYearIsValid = !birthYearRight.startsWith('0') && parseInt(birthYearRight) >= 1900;
                        }
                    }
                }
            });
            // Priority 1: Email opens
            let leftOpens = 0;
            let rightOpens = 0;
            const userActivityArray = Array.from(document.querySelectorAll('elm-merge-array-row')).find(arr => {
                return arr.textContent.includes('User Activity');
            });
            if (userActivityArray) {
                const arrayRows = userActivityArray.querySelectorAll('elm-merge-row');
                arrayRows.forEach(arrayRow => {
                    const rowText = arrayRow.textContent;
                    if (rowText.includes('email open')) {
                        const openValues = arrayRow.querySelectorAll('elm-merge-value');
                        if (openValues.length >= 2) {
                            const leftOpenText = openValues[0].textContent.trim();
                            const rightOpenText = openValues[1].textContent.trim();
                            const leftOpenMatch = leftOpenText.match(/(\d+)\s*email opens?/);
                            const rightOpenMatch = rightOpenText.match(/(\d+)\s*email opens?/);
                            if (leftOpenMatch) leftOpens = parseInt(leftOpenMatch[1]);
                            if (rightOpenMatch) rightOpens = parseInt(rightOpenMatch[1]);
                            console.log('📧 Email opens found in User Activity:', { leftOpens, rightOpens });
                        }
                    }
                });
            }
            if (leftOpens > rightOpens) {
                row.dataset.dualResolved = "true";
                clickSide(row, 'left');
                return;
            } else if (rightOpens > leftOpens) {
                row.dataset.dualResolved = "true";
                clickSide(row, 'right');
                return;
            }
            // Helper: Check if email contains name or any part of multi-word name (min 3 chars)
            const emailContainsName = (email, name) => {
                if (!name || !email) return false;
                // Check full name first
                if (email.includes(name)) return true;
                // Check individual parts of multi-word names (e.g., "Hernandez Maravilla" -> check "hernandez" and "maravilla")
                const nameParts = name.split(/[\s-]+/).filter(part => part.length >= 3);
                return nameParts.some(part => email.includes(part));
            };

            // Priority 2: First name - check BOTH emails against BOTH first names
            if (firstNameLeft || firstNameRight) {
                const leftEmailMatchesLeftFirstName = emailContainsName(leftLower, firstNameLeft);
                const leftEmailMatchesRightFirstName = emailContainsName(leftLower, firstNameRight);
                const rightEmailMatchesLeftFirstName = emailContainsName(rightLower, firstNameLeft);
                const rightEmailMatchesRightFirstName = emailContainsName(rightLower, firstNameRight);
                const leftEmailHasFirstNameMatch = leftEmailMatchesLeftFirstName || leftEmailMatchesRightFirstName;
                const rightEmailHasFirstNameMatch = rightEmailMatchesLeftFirstName || rightEmailMatchesRightFirstName;
                if (leftEmailHasFirstNameMatch && !rightEmailHasFirstNameMatch) {
                    row.dataset.dualResolved = "true";
                    clickSide(row, 'left');
                    console.log('✅ Email selected by first name match: left');
                    return;
                } else if (rightEmailHasFirstNameMatch && !leftEmailHasFirstNameMatch) {
                    row.dataset.dualResolved = "true";
                    clickSide(row, 'right');
                    console.log('✅ Email selected by first name match: right');
                    return;
                }
            }
            // Priority 3: Last name - check BOTH emails against BOTH last names
            if (lastNameLeft || lastNameRight) {
                const leftEmailMatchesLeftLastName = emailContainsName(leftLower, lastNameLeft);
                const leftEmailMatchesRightLastName = emailContainsName(leftLower, lastNameRight);
                const rightEmailMatchesLeftLastName = emailContainsName(rightLower, lastNameLeft);
                const rightEmailMatchesRightLastName = emailContainsName(rightLower, lastNameRight);
                const leftEmailHasLastNameMatch = leftEmailMatchesLeftLastName || leftEmailMatchesRightLastName;
                const rightEmailHasLastNameMatch = rightEmailMatchesLeftLastName || rightEmailMatchesRightLastName;
                if (leftEmailHasLastNameMatch && !rightEmailHasLastNameMatch) {
                    row.dataset.dualResolved = "true";
                    clickSide(row, 'left');
                    console.log('✅ Email selected by last name match: left');
                    return;
                } else if (rightEmailHasLastNameMatch && !leftEmailHasLastNameMatch) {
                    row.dataset.dualResolved = "true";
                    clickSide(row, 'right');
                    console.log('✅ Email selected by last name match: right');
                    return;
                }
            }
            // Priority 4: Birth year - check BOTH emails against BOTH valid birth years
            const checkYearInEmail = (email, year) => {
                if (!year) return false;
                const year4 = year;
                const year3 = year.slice(1);
                const year2 = year.slice(2);
                return email.includes(year4) || email.includes(year3) || email.includes(year2);
            };
            if (birthYearLeft || birthYearRight) {
                const leftEmailHasLeftYear = leftYearIsValid && checkYearInEmail(leftLower, birthYearLeft);
                const leftEmailHasRightYear = rightYearIsValid && checkYearInEmail(leftLower, birthYearRight);
                const rightEmailHasLeftYear = leftYearIsValid && checkYearInEmail(rightLower, birthYearLeft);
                const rightEmailHasRightYear = rightYearIsValid && checkYearInEmail(rightLower, birthYearRight);
                const leftEmailHasYearMatch = leftEmailHasLeftYear || leftEmailHasRightYear;
                const rightEmailHasYearMatch = rightEmailHasLeftYear || rightEmailHasRightYear;
                if (leftEmailHasYearMatch && !rightEmailHasYearMatch) {
                    row.dataset.dualResolved = "true";
                    clickSide(row, 'left');
                    console.log('✅ Email selected by birth year match: left');
                    return;
                } else if (rightEmailHasYearMatch && !leftEmailHasYearMatch) {
                    row.dataset.dualResolved = "true";
                    clickSide(row, 'right');
                    console.log('✅ Email selected by birth year match: right');
                    return;
                }
            }
            // No tiebreaker could resolve - mark as resolved but don't select
            row.dataset.dualResolved = "true";
        });
    }
    // --- UTILS ---
    function killPaginationTooltips() {
        const triggers = document.querySelectorAll('.mat-mdc-paginator-range-actions .mat-mdc-tooltip-trigger:not(.tooltip-silenced)');
        triggers.forEach(el => {
            el.addEventListener('mouseenter', (e) => { e.stopImmediatePropagation(); }, true);
            el.classList.add('tooltip-silenced');
        });
    }
    function injectMergeCounter() {
        const navRight = document.querySelector('.bolt-navigation-right');
        const searchBox = document.querySelector('elm-universal-search') || document.querySelector('.bolt-navigation-universal-search');
        if (navRight && searchBox && !document.getElementById('elm-controls-wrapper')) {
            // Load saved setting - High Contrast is ON by default (borders shown)
            const highContrastEnabled = localStorage.getItem('elm_high_contrast') !== 'false';
            if (!highContrastEnabled) {
                document.body.classList.add('no-highlight-borders');
            }
            // Main controls wrapper
            const controlsWrapper = document.createElement('div');
            controlsWrapper.id = 'elm-controls-wrapper';

            // Settings Button (gear icon)
            const settingsBtn = document.createElement('button');
            settingsBtn.id = 'elm-settings-btn';
            settingsBtn.innerHTML = '\u2699';
            settingsBtn.title = 'Settings';
            settingsBtn.onclick = (e) => {
                e.stopPropagation();
                toggleSettingsPane();
            };
            controlsWrapper.appendChild(settingsBtn);

            // Merge Counter (conditionally shown)
            if (CFG.SHOW_MERGE_COUNTER) {
                const count = localStorage.getItem('elm_merge_count') || 0;
                const counterWrapper = document.createElement('div');
                counterWrapper.id = 'elm-counter-wrapper';
                const resetBtn = document.createElement('button');
                resetBtn.id = 'elm-reset-btn';
                resetBtn.innerHTML = '\u21BB';
                resetBtn.title = "Reset Counter";
                resetBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (confirm("Reset your merge count to 0?")) {
                        localStorage.setItem('elm_merge_count', 0);
                        document.getElementById('elm-merge-counter').innerText = `Merges: 0`;
                    }
                };
                const counterText = document.createElement('span');
                counterText.id = 'elm-merge-counter';
                counterText.innerText = `Merges: ${count}`;
                counterWrapper.appendChild(resetBtn);
                counterWrapper.appendChild(counterText);
                controlsWrapper.appendChild(counterWrapper);
            }

            navRight.insertBefore(controlsWrapper, searchBox);

            // --- Settings Pane (overlay + panel) ---
            injectSettingsPane(highContrastEnabled);
        }
    }

    // =========================================================
    // SETTINGS PANE
    // =========================================================
    function injectSettingsPane(highContrastEnabled) {
        if (document.getElementById('elm-settings-pane')) return;

        // Load saved settings (defaults match original hardcoded values)
        const scrollToBottomEnabled = localStorage.getItem('elm_require_scroll_to_bottom') !== 'false';
        const autoClickFabEnabled = localStorage.getItem('elm_auto_click_fab') !== 'false';
        const autoNavEnabled = localStorage.getItem('elm_auto_navigate_after_merge') !== 'false';
        const mergeCounterEnabled = localStorage.getItem('elm_show_merge_counter') !== 'false';
        const autoSkipEnabled = localStorage.getItem('elm_auto_skip_blocked') !== 'false';
        const allowedDept = localStorage.getItem('elm_allowed_department') || 'UnderGrad';

        // Overlay (click to close)
        const overlay = document.createElement('div');
        overlay.id = 'elm-settings-overlay';
        overlay.onclick = () => toggleSettingsPane(false);

        // Panel
        const pane = document.createElement('div');
        pane.id = 'elm-settings-pane';

        pane.innerHTML = `
            <div class="settings-header">\u2699 Settings<button id="elm-settings-close-btn" title="Close">\u2715</button></div>
            <div class="settings-body">
                <div class="settings-section">
                    <div class="settings-section-title">Display</div>
                    <div class="settings-row">
                        <div>
                            <div class="settings-row-label">High Contrast</div>
                            <div class="settings-row-desc">Show colored borders on conflict rows</div>
                        </div>
                        <div id="elm-settings-contrast-toggle" class="elm-toggle ${highContrastEnabled ? 'active' : ''}"></div>
                    </div>
                    <div class="settings-row">
                        <div>
                            <div class="settings-row-label">Merge Counter</div>
                            <div class="settings-row-desc">Show merge counter in the navbar</div>
                        </div>
                        <div id="elm-settings-merge-counter-toggle" class="elm-toggle ${mergeCounterEnabled ? 'active' : ''}"></div>
                    </div>
                </div>
                <div class="settings-section">
                    <div class="settings-section-title">Automation</div>
                    <div class="settings-row">
                        <div>
                            <div class="settings-row-label">Auto-Click FAB</div>
                            <div class="settings-row-desc">Auto-click merge button on page load</div>
                        </div>
                        <div id="elm-settings-auto-click-toggle" class="elm-toggle ${autoClickFabEnabled ? 'active' : ''}"></div>
                    </div>
                    <div class="settings-row">
                        <div>
                            <div class="settings-row-label">Auto-Navigate</div>
                            <div class="settings-row-desc">Go to next duplicate after merge</div>
                        </div>
                        <div id="elm-settings-auto-nav-toggle" class="elm-toggle ${autoNavEnabled ? 'active' : ''}"></div>
                    </div>
                    <div class="settings-row">
                        <div>
                            <div class="settings-row-label">Auto-Skip Blocked</div>
                            <div class="settings-row-desc">Skip forbidden/wrong dept entries</div>
                        </div>
                        <div id="elm-settings-auto-skip-toggle" class="elm-toggle ${autoSkipEnabled ? 'active' : ''}"></div>
                    </div>
                    <div class="settings-row">
                        <div>
                            <div class="settings-row-label">Scroll to Review</div>
                            <div class="settings-row-desc">Require scrolling to bottom before merge</div>
                        </div>
                        <div id="elm-settings-scroll-toggle" class="elm-toggle ${scrollToBottomEnabled ? 'active' : ''}"></div>
                    </div>
                </div>
                <div class="settings-section">
                    <div class="settings-section-title">Department</div>
                    <div class="settings-row">
                        <div>
                            <div class="settings-row-label">Allowed Department</div>
                            <div class="settings-row-desc">Filter entries by department</div>
                        </div>
                        <select id="elm-settings-dept-select" class="elm-select">
                            <option value="All" ${allowedDept === 'All' ? 'selected' : ''}>All</option>
                            <option value="UnderGrad" ${allowedDept === 'UnderGrad' ? 'selected' : ''}>UnderGrad</option>
                            <option value="Grad" ${allowedDept === 'Grad' ? 'selected' : ''}>Grad</option>
                            <option value="IA" ${allowedDept === 'IA' ? 'selected' : ''}>IA</option>
                            <option value="None" ${allowedDept === 'None' ? 'selected' : ''}>None</option>
                        </select>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(pane);

        // --- Close Button ---
        document.getElementById('elm-settings-close-btn').onclick = (e) => {
            e.stopPropagation();
            toggleSettingsPane(false);
        };

        // --- High Contrast Toggle ---
        const contrastToggle = document.getElementById('elm-settings-contrast-toggle');
        contrastToggle.onclick = () => {
            contrastToggle.classList.toggle('active');
            const isActive = contrastToggle.classList.contains('active');
            if (isActive) {
                document.body.classList.remove('no-highlight-borders');
                localStorage.setItem('elm_high_contrast', 'true');
            } else {
                document.body.classList.add('no-highlight-borders');
                localStorage.setItem('elm_high_contrast', 'false');
            }
        };

        // --- Helper for simple boolean toggles ---
        function setupToggle(elementId, storageKey) {
            const toggle = document.getElementById(elementId);
            toggle.onclick = () => {
                toggle.classList.toggle('active');
                localStorage.setItem(storageKey, toggle.classList.contains('active') ? 'true' : 'false');
            };
        }

        setupToggle('elm-settings-merge-counter-toggle', 'elm_show_merge_counter');
        setupToggle('elm-settings-auto-click-toggle', 'elm_auto_click_fab');
        setupToggle('elm-settings-auto-nav-toggle', 'elm_auto_navigate_after_merge');
        setupToggle('elm-settings-auto-skip-toggle', 'elm_auto_skip_blocked');
        setupToggle('elm-settings-scroll-toggle', 'elm_require_scroll_to_bottom');

        // --- Department Select ---
        document.getElementById('elm-settings-dept-select').onchange = (e) => {
            localStorage.setItem('elm_allowed_department', e.target.value);
        };
    }

    function toggleSettingsPane(forceState) {
        const overlay = document.getElementById('elm-settings-overlay');
        const pane = document.getElementById('elm-settings-pane');
        if (!overlay || !pane) return;
        const shouldOpen = forceState !== undefined ? forceState : !pane.classList.contains('open');
        if (shouldOpen) {
            // Position pane below the settings button
            const settingsBtn = document.getElementById('elm-settings-btn');
            if (settingsBtn) {
                const rect = settingsBtn.getBoundingClientRect();
                const topPos = rect.bottom + 6;
                pane.style.top = topPos + 'px';
                pane.style.right = (window.innerWidth - rect.right) + 'px';
                pane.style.maxHeight = (window.innerHeight - topPos - 16) + 'px';
            }
            overlay.classList.add('open');
            pane.classList.add('open');
        } else {
            overlay.classList.remove('open');
            pane.classList.remove('open');
        }
    }
    function incrementMergeCount() {
        let count = parseInt(localStorage.getItem('elm_merge_count') || 0);
        count++;
        localStorage.setItem('elm_merge_count', count);
        const wrapperEl = document.getElementById('elm-counter-wrapper');
        const counterEl = document.getElementById('elm-merge-counter');
        if (wrapperEl && counterEl) {
            counterEl.innerText = `Merges: ${count}`;
            wrapperEl.classList.remove('counter-pop');
            void wrapperEl.offsetWidth;
            wrapperEl.classList.add('counter-pop');
            setTimeout(() => { wrapperEl.classList.remove('counter-pop'); }, 300);
        }
    }
    function setupSmartNavButton() {
        const actionWrapper = document.querySelector('.elm-page-action-floating');
        const btn = actionWrapper ? actionWrapper.querySelector('button') : null;
        if (btn && !btn.dataset.smartNavAttached) {
            btn.dataset.smartNavAttached = "true";
            let hasScrolledToFirstError = false;
            btn.addEventListener('click', (e) => {
                console.log('FAB clicked');
                // Check forbidden entry FIRST (highest priority)
                if (document.body.classList.contains('forbidden-entry')) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    alert("Forbidden entry");
                    return;
                }
                // Then check department
                if (document.body.classList.contains('wrong-department')) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    const deptInfo = isWrongDepartment();
                    alert("For other department: " + deptInfo.reason);
                    return;
                }
                // Then check student ID mismatch
                if (document.body.classList.contains('student-id-mismatch')) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    alert("Student IDs do not match. Entries are two different people.");
                    return;
                }
                // Check if review is required (scroll to bottom not completed)
                if (document.body.classList.contains('review-required')) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    alert("Please scroll to the bottom to review all fields before merging");
                    return;
                }
                // Mark FAB as clicked to enable smart links and highlight
                fabHasBeenClicked = true;
                const existingErrorRows = document.querySelectorAll('elm-merge-row.has-error');
                console.log('Existing error rows:', existingErrorRows.length);
                if (existingErrorRows.length === 0) {
                    console.log('First click - letting native behavior create error rows');
                    // Run auto-resolution after FAB click creates error rows
                    setTimeout(() => {
                        runAutoResolution();
                        const redRows = Array.from(document.querySelectorAll('elm-merge-row.has-error')).filter(row => {
                            return row.querySelector('.ng-invalid') || !row.querySelector('.ng-valid');
                        });
                        console.log('After delay, red rows found:', redRows.length);
                        if (redRows.length > 0) {
                            const activeContainer = document.querySelector('.elm-content') || document.querySelector('.mat-drawer-content') || document.body;
                            const firstRow = redRows[0];
                            const rect = firstRow.getBoundingClientRect();
                            const topPos = rect.top + activeContainer.scrollTop - HEADER_OFFSET;
                            console.log('Scrolling to first row at position:', topPos);
                            activeContainer.scrollTo({ top: topPos, behavior: 'smooth' });
                            hasScrolledToFirstError = true;
                        }
                    }, 50);
                    return;
                }
                const redRows = Array.from(document.querySelectorAll('elm-merge-row.has-error')).filter(row => {
                    return row.querySelector('.ng-invalid') || !row.querySelector('.ng-valid');
                });
                console.log('Red rows found:', redRows.length, 'First scroll flag:', !hasScrolledToFirstError);
                if (redRows.length > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    const activeContainer = document.querySelector('.elm-content') || document.querySelector('.mat-drawer-content') || document.body;
                    let nextRow;
                    if (!hasScrolledToFirstError) {
                        nextRow = redRows[0];
                        hasScrolledToFirstError = true;
                        console.log('First scroll - going to first row');
                    } else {
                        nextRow = redRows.find(row => {
                            const rect = row.getBoundingClientRect();
                            return rect.top > (HEADER_OFFSET + 5);
                        });
                        if (!nextRow) nextRow = redRows[0];
                        console.log('Subsequent click - going to next row');
                    }
                    if (activeContainer && nextRow) {
                        const rect = nextRow.getBoundingClientRect();
                        const topPos = rect.top + activeContainer.scrollTop - HEADER_OFFSET;
                        console.log('Scrolling to position:', topPos);
                        activeContainer.scrollTo({ top: topPos, behavior: 'smooth' });
                    }
                }
                else if (document.body.classList.contains('ready-to-merge')) {
                    console.log('Ready to merge - green FAB clicked, now awaiting merge success');
                    hasScrolledToFirstError = false;
                    awaitingMergeSuccess = true; // Start watching for merge success
                    // Counter will increment when merge success is detected
                }
            }, true);
        }
    }
    function injectNativePagination() {
        const paginatorElements = document.querySelectorAll('.mat-mdc-paginator-container');
        paginatorElements.forEach((paginator, index) => {
            // Skip if already processed
            if (paginator.dataset.elmPaginatorSetup) return;
            paginator.dataset.elmPaginatorSetup = 'true';

            const urlParams = new URLSearchParams(window.location.search);
            const currentLimit = parseInt(urlParams.get('limit')) || 50;
            const currentOffset = parseInt(urlParams.get('offset')) || 0;
            const currentPage = currentOffset + 1;

            // Create limit input
            const pageSizeContainer = paginator.querySelector('.mat-mdc-paginator-page-size-value');
            let limitInput = null;
            if (pageSizeContainer) {
                pageSizeContainer.innerText = '';
                limitInput = document.createElement('input');
                limitInput.className = 'elm-unified-input elm-limit-input';
                limitInput.type = 'number';
                limitInput.value = currentLimit;
                pageSizeContainer.appendChild(limitInput);
            }

            // Create page input and GO button
            const prevButton = paginator.querySelector('.mat-mdc-paginator-navigation-previous');
            const actionsGroup = paginator.querySelector('.mat-mdc-paginator-range-actions');
            let pageInput = null;
            if (actionsGroup && prevButton) {
                const pageContainer = document.createElement('div');
                pageContainer.className = 'elm-page-control-container';
                pageInput = document.createElement('input');
                pageInput.type = 'number';
                pageInput.className = 'elm-unified-input elm-page-input';
                pageInput.value = currentPage;
                pageInput.min = '1';
                const goBtn = document.createElement('button');
                goBtn.className = 'elm-go-btn';
                goBtn.textContent = 'GO';
                pageContainer.appendChild(pageInput);
                pageContainer.appendChild(goBtn);
                prevButton.insertAdjacentElement('afterend', pageContainer);

                // Create navigation function that captures THIS paginator's inputs
                const navigate = () => {
                    const page = parseInt(pageInput.value) || 1;
                    const limit = limitInput ? (parseInt(limitInput.value) || 50) : 50;
                    const offset = Math.max(0, page - 1);
                    const newUrl = new URL(window.location);
                    newUrl.searchParams.set('offset', offset);
                    newUrl.searchParams.set('limit', limit);
                    if (!newUrl.searchParams.has('ignored')) { newUrl.searchParams.set('ignored', 'false'); }
                    window.location.href = newUrl.toString();
                };

                // Attach event listeners
                goBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigate();
                });
                pageInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate();
                    }
                });
                if (limitInput) {
                    limitInput.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            navigate();
                        }
                    });
                }
            }
        });
    }
    function prettifyAddress(str) {
        let pretty = str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        const upperCaseList = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC", "PR", "VI", "GU", "MP", "AS", "PO", "NW", "NE", "SW", "SE", "USA", "US"];
        const stateRegex = new RegExp(`\\b(${upperCaseList.join("|")})\\b`, 'gi');
        return pretty.replace(stateRegex, (match) => match.toUpperCase());
    }
    function formatPhoneBackwards(rawText) {
        const digits = rawText.replace(/\D/g, '');
        if (digits.length < 10) return null;
        const len = digits.length;
        const line = digits.substring(len - 4, len);
        const prefix = digits.substring(len - 7, len - 4);
        const area = digits.substring(len - 10, len - 7);
        const countryCode = digits.substring(0, len - 10);
        return countryCode.length > 0 ? `+${countryCode} (${area})-${prefix}-${line}` : `(${area})-${prefix}-${line}`;
    }
    function processSmartLinks() {
        const valueCells = document.querySelectorAll('elm-merge-value:not(.linkified)');
        valueCells.forEach(cell => {
            const text = cell.textContent.trim();
            if (text.replace(/\D/g, '').length >= 10 && text.length < 20 && !text.includes('@')) {
                const phone = formatPhoneBackwards(text);
                if (phone) { cell.innerHTML = `<span class="elm-phone-formatted">${phone}</span>`; cell.classList.add('linkified'); return; }
            }
            if (text.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
                const checkUrl = `https://mailmeteor.com/email-checker?email=${encodeURIComponent(text)}`;
                cell.innerHTML = `<a href="${checkUrl}" target="_blank" class="elm-smart-link" title="Verify Email">${text}</a>`;
                cell.classList.add('linkified');
                return;
            }
            if (text.startsWith("Home, ")) {
                let rawAddress = text.substring(6).trim();
                rawAddress = rawAddress.replace(/\s*with geo location\s*$/i, "");
                const displayAddress = prettifyAddress(rawAddress);
                if (rawAddress.length > 5) {
                    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rawAddress)}`;
                    cell.innerHTML = `Home, <a href="${mapsUrl}" target="_blank" class="elm-smart-link" title="Open in Google Maps">${displayAddress}</a>`;
                    cell.classList.add('linkified');
                }
            }
        });
    }
    function suppressToasts() {
        const toasts = document.querySelectorAll('.mat-mdc-snack-bar-container');
        toasts.forEach(toast => {
            const text = toast.textContent.toLowerCase();
            if (text.includes('resolve')) {
                toast.remove();
            }
        });
    }
    // Run toast suppression frequently to catch toasts that appear
    setInterval(suppressToasts, 100);
    // --- FEATURE: SCROLL TO BOTTOM DETECTION ---
    function setupScrollDetection() {
        if (!CFG.REQUIRE_SCROLL_TO_BOTTOM) {
            console.log('⚠️ Scroll-to-bottom disabled');
            return; // Feature disabled
        }
        const scrollContainer = document.querySelector('.elm-content') ||
            document.querySelector('.mat-drawer-content') ||
            document.body;
        if (!scrollContainer) {
            console.log('⚠️ No scroll container found');
            return;
        }
        console.log('✅ Setting up scroll detection on:', scrollContainer.className || 'body');
        const checkScroll = () => {
            if (hasScrolledToBottom) {
                console.log('✅ Already marked as scrolled to bottom');
                return; // Already marked as scrolled
            }
            const allRows = document.querySelectorAll('elm-merge-row');
            if (allRows.length === 0) {
                console.log('⚠️ No merge rows found');
                return;
            }
            // Get scroll position
            const scrollTop = scrollContainer.scrollTop;
            const scrollHeight = scrollContainer.scrollHeight;
            const clientHeight = scrollContainer.clientHeight;
            // Calculate how far from bottom (in scroll distance, not viewport)
            const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
            console.log('📏 Scroll check:', {
                scrollTop: Math.round(scrollTop),
                scrollHeight: Math.round(scrollHeight),
                clientHeight: Math.round(clientHeight),
                distanceFromBottom: Math.round(distanceFromBottom),
                threshold: 200,
                willTrigger: distanceFromBottom <= 200
            });
            if (distanceFromBottom <= 200) {
                hasScrolledToBottom = true;
                console.log('✅✅✅ User scrolled to bottom - merge enabled!');
                checkMergeStatus(); // Re-check to update FAB state
            }
        };
        scrollContainer.addEventListener('scroll', checkScroll);
        console.log('✅ Scroll listener attached');
        // Also check immediately in case already at bottom
        checkScroll();
    }
    function checkMergeStatus() {
        const actionWrapper = document.querySelector('.elm-page-action-floating');
        const actionButton = actionWrapper ? actionWrapper.querySelector('button') : null;
        if (!actionButton) return;
        if (!actionButton.querySelector('.fab-merge-text')) {
            const textSpan = document.createElement('span');
            textSpan.className = 'fab-merge-text';
            textSpan.innerText = "Merge";
            actionButton.appendChild(textSpan);
        }
        // Clear all previous blocked row highlights
        document.querySelectorAll('.blocked-row, .blocked-row-critical').forEach(row => {
            row.classList.remove('blocked-row', 'blocked-row-critical');
        });
        // Signal department to csv-database.js via body attribute
        const forbiddenResult = isForbiddenEntry();
        if (forbiddenResult.forbidden) document.body.dataset.csvDept = 'Forbidden';
        else if (isStudentIgnored()) document.body.dataset.csvDept = 'Ignored';
        else document.body.dataset.csvDept = detectActualDepartment();
        // Check forbidden entry FIRST (highest priority)
        if (forbiddenResult.forbidden) {
            document.body.classList.add('forbidden-entry');
            document.body.classList.remove('ready-to-merge', 'review-required', 'wrong-department', 'student-id-mismatch');
            // Highlight the blocked row
            if (forbiddenResult.row) {
                forbiddenResult.row.classList.add('blocked-row');
            }
            return;
        } else {
            document.body.classList.remove('forbidden-entry');
        }
        // Then check department
        const deptResult = isWrongDepartment();
        if (deptResult.wrongDept) {
            document.body.classList.add('wrong-department');
            document.body.classList.remove('ready-to-merge', 'review-required', 'student-id-mismatch');
            // Highlight the blocked row
            if (deptResult.row) {
                deptResult.row.classList.add('blocked-row');
            }
            return;
        } else {
            document.body.classList.remove('wrong-department');
        }
        // Then check student ID mismatch
        const studentIdResult = isStudentIdMismatch();
        if (studentIdResult.mismatch) {
            document.body.classList.add('student-id-mismatch');
            document.body.classList.remove('ready-to-merge', 'review-required');
            // Highlight the blocked row with critical (deep red) styling
            if (studentIdResult.row) {
                studentIdResult.row.classList.add('blocked-row-critical');
            }
            return;
        } else {
            document.body.classList.remove('student-id-mismatch');
        }
        const totalErrorRows = document.querySelectorAll('elm-merge-row.has-error').length;
        const unresolvedErrors = document.querySelectorAll('elm-merge-row.has-error:not(:has(.ng-valid))').length;
        // All conflicts resolved
        if (totalErrorRows > 0 && unresolvedErrors === 0) {
            // Check if scroll-to-bottom is required and hasn't been completed
            if (CFG.REQUIRE_SCROLL_TO_BOTTOM && !hasScrolledToBottom) {
                document.body.classList.add('review-required');
                document.body.classList.remove('ready-to-merge');
            } else {
                document.body.classList.add('ready-to-merge');
                document.body.classList.remove('review-required');
            }
        } else {
            document.body.classList.remove('ready-to-merge', 'review-required');
        }
    }
})();


