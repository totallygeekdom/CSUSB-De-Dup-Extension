// ==UserScript==
// @name         Element451 - UI Perfection (New Deduplication Layout)
// @namespace    http://tampermonkey.net/
// @version      1
// @description  Merge workflow automation for Element451's redesigned "Deduplication" review-queue UI (elm-deduplication-index / elm-duplicate-field-diff-form)
// @author       You
// @match        https://*.element451.io/*
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/totallygeekdom/csusb-de-dup-extension/main/Element451-UI-Perfection-v2.user.js
// @downloadURL  https://raw.githubusercontent.com/totallygeekdom/csusb-de-dup-extension/main/Element451-UI-Perfection-v2.user.js
// ==/UserScript==
//
// PORTING NOTES (read before tuning this file live):
// Element451 replaced the old merge page (<elm-merge-row>, mat-button-toggle, a
// floating "FAB" merge button) with a new AI-assisted "Deduplication" workflow:
// a review-queue table (<elm-review-queue-table>, bolt-table/cdk-table) plus a
// stackable sidebar (<elm-review-duplicates-sidebar>) containing a field-by-field
// diff form (<elm-duplicate-field-diff-form>, .diff-row/.diff-value-button).
//
// This file was ported from ONE static, PII-redacted HTML snapshot of that new
// UI — there was no way to click through it, so anything involving a state not
// visible in that snapshot (error/unresolved styling, the actual merge-success
// toast, the "Ignored" chip, list-page cell contents) is a best-effort guess
// and is called out inline. Test against the real site and adjust selectors
// before trusting this for unattended automation.
(function () {
    'use strict';
    const BUILD = 'v2-build-22';
    // =========================================================
    // CONFIGURATION (same localStorage keys as the classic script, so settings
    // carry over if both scripts are ever installed side by side)
    // =========================================================
    function getBoolSetting(key, defaultValue) {
        const val = localStorage.getItem(key);
        if (val === null) return defaultValue;
        return val === 'true';
    }
    const CONFLICT_ROW_THRESHOLD = 2;
    // NOTE: no REQUIRE_SCROLL_TO_BOTTOM or AUTO_NAVIGATE_AFTER_MERGE here.
    // The classic script's scroll-gating doesn't map onto the sidebar layout,
    // and auto-navigate can't be done safely until there's a real
    // merge-success signal to detect (see checkForMergeResult below) — both
    // need live investigation before they're worth exposing as settings.
    const CFG = Object.defineProperties({}, {
        AUTO_RESOLVE_FIELDS:      { get() { return getBoolSetting('elm_auto_click_fab', true); } },
        HIGHLIGHT_ROWS:           { get() { return getBoolSetting('elm_highlight_rows', true); } },
        SHOW_MERGE_COUNTER:       { get() { return getBoolSetting('elm_show_merge_counter', true); } },
        AUTO_SKIP_BLOCKED:        { get() { return getBoolSetting('elm_auto_skip_blocked', true); } },
        ALLOWED_DEPARTMENT:       { get() { return localStorage.getItem('elm_allowed_department') || 'UnderGrad'; } },
    });
    // =========================================================
    // CSS
    // =========================================================
    const css = `
        /* --- LOCKDOWN: red "Merge Contacts" button + null symbol --- */
        body.elm2-blocked .review-queue-nav-visible ~ * .bolt-stackable-sidebar-header-actions button:last-of-type,
        body.elm2-blocked bolt-stackable-sidebar-header-actions button:last-of-type {
            background-color: #d32f2f !important;
            border-color: #d32f2f !important;
        }
        body.elm2-blocked bolt-stackable-sidebar-header-actions button:last-of-type .button-content-wrapper {
            font-size: 0 !important;
        }
        body.elm2-blocked bolt-stackable-sidebar-header-actions button:last-of-type .button-content-wrapper::after {
            content: "\\2205";
            font-size: 16px;
            font-weight: bold;
        }
        /* --- Row highlighting for the specific diff-row that triggered a lockdown --- */
        .diff-row.elm2-blocked-row {
            background-color: #ffcdd2 !important;
            border-radius: 4px;
            box-shadow: inset 0 0 0 2px #b71c1c;
        }
        .diff-row.elm2-blocked-row .diff-title,
        .diff-row.elm2-blocked-row .diff-value-button {
            color: #b71c1c !important;
        }
        /* --- Contact card highlight for forbidden-name / ignored detection --- */
        .contact-card.elm2-blocked-card {
            outline: 3px solid #b71c1c;
            outline-offset: -3px;
        }
        /* --- Applicant-side driven resolution: light yellow tint (replaces the old
               pixel-overlay approach — much simpler now that each side is its own
               button element instead of a shared row) --- */
        /* --- AI-vs-script pick comparison bar + per-row disagreement badges --- */
        #elm2-pick-compare-bar {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
            padding: 10px 12px;
            margin: 0 0 8px;
            background: #f5f5f5;
            border: 1px solid #ddd;
            border-radius: 8px;
            font-family: 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }
        #elm2-pick-compare-count { font-size: 13px; color: #555; flex: 1 1 auto; min-width: 160px; }
        #elm2-pick-compare-bar button {
            border: 1px solid #ccc;
            background: #fff;
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 13px;
            cursor: pointer;
        }
        #elm2-use-ai-btn { border: 2px solid var(--elm2-bolt-blue, #1976d2); color: var(--elm2-bolt-blue, #1976d2); }
        #elm2-use-ai-btn:hover { background: rgba(25, 118, 210, 0.12); background: color-mix(in srgb, var(--elm2-bolt-blue, #1976d2) 12%, transparent); }
        #elm2-use-script-btn { border: 2px solid #ef6c00; color: #ef6c00; }
        #elm2-use-script-btn:hover { background: rgba(239, 108, 0, 0.12); }
        #elm2-pick-compare-bar button:disabled { opacity: 0.45; cursor: default; }
        /* --- Pick comparison colors (light semi-transparent fill + saturated border,
               replacing Element451's own blue; its overlay pseudo-elements are hidden).
               Agreement row: the selected value is green.
               Conflict row (our pick differs from Bolt's): the two values are colored by
               who picked them — Element451's blue = Bolt's pick, orange = ours.
               Rows where our rules have no opinion keep Element451's default styling. --- */
        body .diff-row .elm2-agree-row button.diff-value-button.diff-option-selected {
            background: rgba(67, 160, 71, 0.22) !important;
            border: 2px solid #2e7d32 !important;
            box-shadow: none !important;
            outline: none !important;
            color: #212121 !important;
        }
        body .diff-row .elm2-agree-row button.diff-value-button.diff-option-selected * {
            background: transparent !important;
            color: #212121 !important;
        }
        body .diff-row .elm2-agree-row button.diff-value-button.diff-option-selected::before,
        body .diff-row .elm2-agree-row button.diff-value-button.diff-option-selected::after {
            background: transparent !important;
            border-color: #2e7d32 !important;
            box-shadow: none !important;
            opacity: 0 !important;
        }
        body .diff-row button.diff-value-button.elm2-pick-bolt {
            background: rgba(25, 118, 210, 0.22) !important;
            background: color-mix(in srgb, var(--elm2-bolt-blue, #1976d2) 22%, transparent) !important;
            border: 2px solid var(--elm2-bolt-blue, #1976d2) !important;
            box-shadow: none !important;
            outline: none !important;
            color: #212121 !important;
        }
        body .diff-row button.diff-value-button.elm2-pick-bolt * {
            background: transparent !important;
            color: #212121 !important;
        }
        body .diff-row button.diff-value-button.elm2-pick-bolt::before,
        body .diff-row button.diff-value-button.elm2-pick-bolt::after {
            background: transparent !important;
            border-color: var(--elm2-bolt-blue, #1976d2) !important;
            box-shadow: none !important;
            opacity: 0 !important;
        }
        body .diff-row button.diff-value-button.elm2-pick-ours {
            background: rgba(239, 108, 0, 0.22) !important;
            border: 2px solid #ef6c00 !important;
            box-shadow: none !important;
            outline: none !important;
            color: #212121 !important;
        }
        body .diff-row button.diff-value-button.elm2-pick-ours * {
            background: transparent !important;
            color: #212121 !important;
        }
        body .diff-row button.diff-value-button.elm2-pick-ours::before,
        body .diff-row button.diff-value-button.elm2-pick-ours::after {
            background: transparent !important;
            border-color: #ef6c00 !important;
            box-shadow: none !important;
            opacity: 0 !important;
        }
        /* --- Merge counter / settings pane (unchanged from classic script; the
               top navbar — .bolt-navigation-right / elm-universal-search — was not
               redesigned) --- */
        #elm-controls-wrapper { display: flex; align-items: center; gap: 12px; margin-right: 16px; position: relative; }
        #elm-counter-wrapper { display: flex; align-items: center; background: #f5f5f5; border-radius: 20px; border: 1px solid #ddd; padding: 2px; transition: all 0.2s ease-out; }
        #elm-reset-btn { background: transparent; border: none; color: #999; cursor: pointer; font-size: 14px; padding: 4px 8px; border-radius: 50%; transition: all 0.2s; line-height: 1; }
        #elm-reset-btn:hover { color: #d32f2f; background-color: rgba(211, 47, 47, 0.1); }
        #elm-merge-counter { font-weight: 600; font-size: 14px; color: #555; padding: 4px 12px 4px 4px; white-space: nowrap; }
        #elm-settings-btn { background: transparent; border: 1px solid rgba(255,255,255,0.3); color: white; cursor: pointer; font-size: 18px; padding: 4px 8px; border-radius: 8px; transition: all 0.2s; line-height: 1; display: flex; align-items: center; justify-content: center; }
        #elm-settings-btn:hover { background-color: rgba(255,255,255,0.15); border-color: rgba(255,255,255,0.5); }
        #elm-settings-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.35); z-index: 9998; }
        #elm-settings-overlay.open { display: block; }
        #elm-settings-pane { position: fixed; top: 0; right: -360px; width: 340px; height: 100%; background: #fff; box-shadow: -4px 0 24px rgba(0,0,0,0.25); z-index: 9999; transition: right 0.25s ease-out; overflow-y: auto; font-family: 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; }
        #elm-settings-pane.open { right: 0; }
        #elm-settings-pane .settings-header { padding: 20px; font-size: 18px; font-weight: 600; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
        #elm-settings-pane .settings-body { padding: 16px 20px; }
        #elm-settings-pane .settings-section-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin: 20px 0 8px; }
        #elm-settings-pane .setting-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f2f2f2; gap: 12px; }
        #elm-settings-pane .setting-row label { font-size: 14px; color: #333; }
        #elm-settings-pane select, #elm-settings-pane input[type=number] { padding: 4px 8px; border-radius: 6px; border: 1px solid #ccc; font-size: 13px; }
        .elm-toggle-switch { position: relative; width: 40px; height: 22px; flex-shrink: 0; }
        .elm-toggle-switch input { opacity: 0; width: 0; height: 0; }
        .elm-toggle-slider { position: absolute; cursor: pointer; inset: 0; background-color: #ccc; transition: 0.2s; border-radius: 22px; }
        .elm-toggle-slider::before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background-color: white; transition: 0.2s; border-radius: 50%; }
        .elm-toggle-switch input:checked + .elm-toggle-slider { background-color: #43a047; }
        .elm-toggle-switch input:checked + .elm-toggle-slider::before { transform: translateX(18px); }
    `;
    if (typeof GM_addStyle === 'function') GM_addStyle(css);
    else { const styleEl = document.createElement('style'); styleEl.textContent = css; document.head.appendChild(styleEl); }

    // =========================================================
    // ADDRESS COMPARER (pure text logic — unchanged from the classic script)
    // =========================================================
    const AddressComparer = {
        countryVariations: [
            'united states of america', 'united states', 'usa', 'us', 'u.s.a.', 'u.s.'
        ],
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
            addr = addr.replace(/,?\s*with\s+geo\s+location\s*$/i, '');
            addr = addr.replace(/[,\s]+$/, '');
            for (const country of this.countryVariations) {
                const regex = new RegExp(',?\\s*' + country.replace(/\./g, '\\.') + '\\s*,?\\s*$', 'i');
                addr = addr.replace(regex, '');
            }
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
            s = s.replace(/\./g, '').replace(/\s+/g, ' ').trim();
            return s;
        },
        normalizeForFuzzy(str) {
            if (!str) return '';
            return str.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        },
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
            return /(?:apt|apartment|unit|ste|suite|spc|space)\.?\s*#?\s*[a-z0-9]/i.test(addressStr) ||
                   /#\s*[a-z0-9]/i.test(addressStr);
        },
        extractCity(addressStr) {
            if (!addressStr) return null;
            const cleaned = this.cleanAddress(addressStr);
            const parts = cleaned.split(',').map(p => p.trim()).filter(p => p);
            for (let i = parts.length - 1; i >= 0; i--) {
                const part = parts[i];
                if (part.length === 2 || /\d/.test(part)) continue;
                if (/\b(st|ave|blvd|dr|rd|ln|ct|cir|trl|way|pl)\b/i.test(part)) continue;
                return part.toLowerCase().trim();
            }
            return null;
        },
        hasDuplicateComponents(addressStr) {
            if (!addressStr) return false;
            const cleaned = this.cleanAddress(addressStr);
            const normalized = this.normalizeStreet(cleaned);
            let parts;
            if (cleaned.includes(',')) {
                parts = normalized.split(',').map(p => p.trim().toLowerCase()).filter(p => p);
            } else {
                const typeBreak = normalized.match(/^(.+?\b(?:st|ave|blvd|dr|rd|ln|ct|cir|trl|way|pl|pkwy|hwy|ter)\b\.?)(\s+.+)?$/i);
                if (typeBreak && typeBreak[2]) {
                    parts = [typeBreak[1].trim().toLowerCase(), typeBreak[2].trim().toLowerCase()];
                } else {
                    parts = [normalized.toLowerCase()];
                }
            }
            const seenParts = [];
            for (const part of parts) {
                if (part.length <= 3) { seenParts.push(part); continue; }
                for (const prev of seenParts) {
                    if (prev.length <= 3) continue;
                    if (part === prev || this.stringSimilarity(part, prev) > 0.8) {
                        return true;
                    }
                }
                seenParts.push(part);
            }
            const streetPattern = /(\d+[a-z]?\s+(?:[a-z]+\.?\s+)*[a-z]+)/gi;
            const streetMatches = normalized.match(streetPattern) || [];
            if (streetMatches.length >= 2) {
                for (let i = 0; i < streetMatches.length; i++) {
                    for (let j = i + 1; j < streetMatches.length; j++) {
                        const sim = this.stringSimilarity(streetMatches[i], streetMatches[j]);
                        if (sim > 0.75) return true;
                    }
                }
            }
            const city = this.extractCity(addressStr);
            if (city && city.length > 3) {
                const cityNorm = this.normalizeForFuzzy(city);
                let cityCount = 0;
                for (const part of parts) {
                    const partNorm = this.normalizeForFuzzy(part);
                    if (partNorm.includes(cityNorm) || (cityNorm.includes(partNorm) && partNorm.length > 3) ||
                        this.stringSimilarity(partNorm, cityNorm) > 0.8) {
                        cityCount++;
                    }
                }
                if (cityCount < 2) {
                    const cityRegex = new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                    const fullMatches = normalized.match(cityRegex);
                    if (fullMatches && fullMatches.length >= 2) cityCount = fullMatches.length;
                }
                if (cityCount >= 2) return true;
            }
            const unitPattern = /(?:apt|apartment|unit|spc|space|ste|suite|#)\s*#?\s*([a-z0-9]+)/gi;
            const unitMatches = [];
            let match;
            while ((match = unitPattern.exec(normalized)) !== null) {
                unitMatches.push(match[1].toLowerCase());
            }
            if (unitMatches.length >= 2 && new Set(unitMatches).size < unitMatches.length) return true;
            return false;
        },
        parseAddress(addressStr) {
            const cleaned = this.cleanAddress(addressStr);
            let parsed = {};
            const parts = cleaned.split(',').map(p => p.trim()).filter(p => p);
            const parseStreetPart = (streetPart) => {
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
                    const prefixMatch = remainder.match(/^(N|S|E|W|NE|NW|SE|SW|North|South|East|West|Northeast|Northwest|Southeast|Southwest)\.?\s+(.+)/i);
                    if (prefixMatch) {
                        parsed.prefix = prefixMatch[1];
                        remainder = prefixMatch[2];
                    }
                    const typePattern = /\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|cir|circle|trl|trail|way|pl|place|pkwy|parkway|hwy|highway|ter|terrace)\.?\s*$/i;
                    const typeMatch = remainder.match(typePattern);
                    if (typeMatch) {
                        parsed.type = typeMatch[1];
                        parsed.street = remainder.substring(0, remainder.lastIndexOf(typeMatch[0])).trim();
                    } else {
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
                const lastPart = parts[parts.length - 1];
                const stateZipMatch = lastPart.match(/^\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
                if (stateZipMatch) {
                    parsed.state = stateZipMatch[1];
                    parsed.zip = stateZipMatch[2];
                    if (parts.length >= 3) parsed.city = parts[parts.length - 2];
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
                let remainder = cleaned;
                const szMatch = remainder.match(/\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
                if (szMatch) {
                    parsed.state = szMatch[1];
                    parsed.zip = szMatch[2];
                    remainder = remainder.substring(0, szMatch.index).trim();
                }
                const streetTypeInLine = /\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|cir|circle|trl|trail|way|pl|place|pkwy|parkway|hwy|highway|ter|terrace)\.?\s+/i;
                const stMatch = remainder.match(streetTypeInLine);
                if (stMatch) {
                    const afterType = remainder.substring(stMatch.index + stMatch[0].length).trim();
                    if (afterType && !/^\d/.test(afterType)) {
                        parsed.city = afterType;
                        parseStreetPart(remainder.substring(0, stMatch.index + stMatch[0].length).trim());
                    } else {
                        parseStreetPart(remainder);
                    }
                } else {
                    parseStreetPart(remainder);
                }
            }
            if (!parsed.sec_unit_num) {
                const unit = this.extractUnit(cleaned);
                if (unit) parsed.sec_unit_num = unit;
            }
            parsed._original = addressStr;
            parsed._cleaned = cleaned;
            return parsed;
        },
        createComparisonKey(parsed) {
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
            if (parsed.sec_unit_num || parsed.sec_unit_type) {
                score += 15;
            } else if (this.hasUnitInfo(originalStr)) {
                score += 15;
            }
            if (parsed.prefix) score += 3;
            if (parsed.suffix) score += 3;
            if (this.hasCountry(originalStr)) score += 5;
            if (originalStr && /with\s+geo\s+location/i.test(originalStr)) score += 20;
            if (this.hasDuplicateComponents(originalStr)) score -= 100;
            if (originalStr && !parsed.number) {
                if (/\s\d{4,5}\s*,/.test(originalStr)) score -= 20;
            }
            return score;
        },
        compareAddresses(leftAddr, rightAddr) {
            const result = { areSame: false, winner: 'tie', reason: '', leftScore: 0, rightScore: 0 };
            const leftHasDupes = this.hasDuplicateComponents(leftAddr);
            const rightHasDupes = this.hasDuplicateComponents(rightAddr);
            if (leftHasDupes && rightHasDupes) {
                result.winner = 'neither';
                result.reason = 'Both have duplicates';
                return result;
            }
            if (leftHasDupes) { result.winner = 'right'; result.reason = 'Left has duplicates'; result.areSame = false; return result; }
            if (rightHasDupes) { result.winner = 'left'; result.reason = 'Right has duplicates'; result.areSame = false; return result; }
            const leftParsed = this.parseAddress(leftAddr);
            const rightParsed = this.parseAddress(rightAddr);
            const leftKey = this.createComparisonKey(leftParsed);
            const rightKey = this.createComparisonKey(rightParsed);
            result.areSame = leftKey === rightKey && leftKey.length > 0;
            if (!result.areSame) {
                const extractNumberAndStreet = (addr) => {
                    let s = this.cleanAddress(addr);
                    s = this.normalizeStreet(s);
                    const m = s.match(/^(\d+[a-z]?)\s+(.+?)(?:\s*,|\s+\d{5}|\s+[a-z]{2}\s+\d{5}|$)/i);
                    if (!m) return '';
                    return (m[1] + ' ' + m[2]).replace(/[^a-z0-9]/g, '');
                };
                const leftNorm = extractNumberAndStreet(leftAddr);
                const rightNorm = extractNumberAndStreet(rightAddr);
                if (leftNorm && rightNorm && leftNorm === rightNorm && leftNorm.length > 3) result.areSame = true;
            }
            result.leftScore = this.calculateCompleteness(leftParsed, leftAddr);
            result.rightScore = this.calculateCompleteness(rightParsed, rightAddr);
            if (result.areSame) {
                if (result.leftScore > result.rightScore) {
                    result.winner = 'left';
                    result.reason = `Same address, left more complete (${result.leftScore} vs ${result.rightScore})`;
                } else if (result.rightScore > result.leftScore) {
                    result.winner = 'right';
                    result.reason = `Same address, right more complete (${result.rightScore} vs ${result.leftScore})`;
                } else {
                    result.winner = 'left';
                    result.reason = 'Same address, equal completeness - defaulting to left';
                }
            } else {
                result.winner = 'tie';
                result.reason = 'Different addresses - manual review or follow email';
            }
            return result;
        },
        pickBetterAddress(leftAddr, rightAddr) {
            const comparison = this.compareAddresses(leftAddr, rightAddr);
            return comparison.winner;
        }
    };

    // =========================================================
    // DOM ADAPTER — translates the new .diff-row structure into the same
    // shape the resolution logic below expects (label/left-text/right-text/
    // select-a-side), so the pattern-matching rules can stay close to the
    // classic script instead of being rewritten from scratch.
    // =========================================================
    function getDiffForm() {
        return document.querySelector('elm-duplicate-field-diff-form');
    }
    function isDedupReviewPage() {
        return !!getDiffForm();
    }
    function getDiffRows() {
        const form = getDiffForm();
        if (!form) return [];
        return Array.from(form.querySelectorAll('.diff-row')).map(row => {
            const buttons = row.querySelectorAll(':scope > .diff-value-button');
            const titleEl = row.querySelector(':scope > .diff-title');
            const label = titleEl ? titleEl.textContent.trim() : '';
            const leftBtn = buttons[0] || null;
            const rightBtn = buttons[1] || null;
            const leftText = leftBtn ? leftBtn.textContent.trim() : '';
            const rightText = rightBtn ? rightBtn.textContent.trim() : '';
            const norm = (t) => t.toLowerCase().replace(/\s+/g, ' ').trim();
            return {
                element: row,
                label,
                // Element451 doesn't flag conflicting rows (it just hides matching
                // ones), so we detect them ourselves: the two sides differ.
                isConflict: norm(leftText) !== norm(rightText),
                textContent: `${label} ${leftText} ${rightText}`,
                values: [{ textContent: leftText }, { textContent: rightText }],
                leftSelected: !!(leftBtn && leftBtn.classList.contains('diff-option-selected')),
                rightSelected: !!(rightBtn && rightBtn.classList.contains('diff-option-selected')),
                selectSide(side) {
                    const btn = side === 'left' ? leftBtn : rightBtn;
                    if (btn && !btn.classList.contains('diff-option-selected')) btn.click();
                }
            };
        });
    }
    // Convenience: rows whose label matches (case-insensitive substring)
    function getDiffRowsByLabel(labelSubstr) {
        const needle = labelSubstr.toLowerCase();
        return getDiffRows().filter(r => r.label.toLowerCase().includes(needle));
    }
    // Element451 may reuse the same .diff-row elements when moving to the next
    // pair, which would leave our per-row state (Bolt's pick, our pick, resolved
    // flags, colors) attached to a row that now shows different data. Tag each
    // row with the pair it was computed for and wipe anything stale.
    const ROW_STATE_KEYS = ['elm2AiSide', 'elm2ScriptSide', 'elm2AutoResolved', 'elm2DualPersonal', 'elm2DualResolved', 'elm2AddressResolved'];
    function resetStaleRows() {
        const pairKey = getPairKey();
        if (!pairKey) return;
        getDiffRows().forEach(row => {
            const el = row.element;
            if (el.dataset.elm2Pair === pairKey) return;
            ROW_STATE_KEYS.forEach(k => delete el.dataset[k]);
            el.classList.remove('elm2-agree-row', 'elm2-blocked-row');
            el.removeAttribute('title');
            el.querySelectorAll(':scope > .diff-value-button').forEach(b => b.classList.remove('elm2-pick-bolt', 'elm2-pick-ours'));
            el.dataset.elm2Pair = pairKey;
        });
    }
    // Element451's default blue outline color, read from one of its own
    // outlined accent buttons (e.g. "Save for later") so our Bolt-side styling
    // matches it exactly instead of relying on a guessed hex value.
    function syncBoltBlue() {
        const ref = document.querySelector('bolt-stackable-sidebar-header-actions button.bolt-button-outlined.bolt-button-color-accent');
        if (!ref) return;
        const c = getComputedStyle(ref).borderTopColor;
        if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') return;
        document.documentElement.style.setProperty('--elm2-bolt-blue', c);
    }
    // Records the side Bolt had pre-selected before our script touched the
    // row, the first time each row is seen (idempotent — a no-op on rows
    // already stamped). Must run before runAutoResolution() so it captures
    // Bolt's actual default rather than our own prior click.
    function snapshotNativeSelections() {
        getDiffRows().forEach(row => {
            if (row.element.dataset.elm2AiSide) return; // already captured
            if (row.leftSelected) row.element.dataset.elm2AiSide = 'left';
            else if (row.rightSelected) row.element.dataset.elm2AiSide = 'right';
        });
    }
    // Selects a side AND records it as our script's pick, so the AI-vs-script
    // comparison bar can show both and let a human bulk-switch between them.
    // Every resolution rule below should call this instead of row.selectSide()
    // directly.
    function applyScriptPick(row, side) {
        row.element.dataset.elm2ScriptSide = side;
        if (CFG.AUTO_RESOLVE_FIELDS) row.selectSide(side);
    }
    function getContactCards() {
        const form = getDiffForm();
        if (!form) return [];
        return Array.from(form.querySelectorAll('.contact-card'));
    }
    function getContactNames() {
        return getContactCards().map(card => {
            const nameEl = card.querySelector('.contact-card-name');
            return nameEl ? nameEl.textContent.trim() : '';
        });
    }
    function getScoreChipLevel() {
        const chip = document.querySelector('elm-deduplication-score-chip .bolt-chip');
        if (!chip) return null;
        const text = chip.textContent.trim().toLowerCase();
        if (text.includes('low')) return 'low';
        if (text.includes('medium')) return 'medium';
        if (text.includes('high')) return 'high';
        return null;
    }
    function getAnalysisSummaryText() {
        const el = document.querySelector('.analysis-summary');
        return el ? el.textContent.trim() : '';
    }
    function getQueuePosition() {
        const el = document.querySelector('.review-queue-position');
        if (!el) return null;
        const m = el.textContent.match(/(\d+)\s*\/\s*(\d+)/);
        if (!m) return null;
        return { current: parseInt(m[1], 10), total: parseInt(m[2], 10) };
    }
    function getSidebarActionButton(text) {
        const actions = document.querySelector('bolt-stackable-sidebar-header-actions');
        if (!actions) return null;
        return Array.from(actions.querySelectorAll('button')).find(
            b => b.textContent.trim().toLowerCase() === text.toLowerCase()
        ) || null;
    }
    // No clickMergeContacts() helper — merging is never automated (see the
    // MAIN AUTOMATION LOOP notes below).
    // IMPORTANT: "Dismiss" is NOT the equivalent of the classic script's
    // auto-skip (which just moved to the next entry). In this UI it opens a
    // "Not a duplicate?" feedback dialog and, once confirmed, permanently
    // tells Bolt these two contacts are different people — removing the
    // pair from the queue and training the matcher on that verdict. A
    // department/forbidden/appeal/ignored block says nothing about whether
    // the pair is actually a duplicate, so automation must never click this.
    // Skipping a blocked entry must only ever move to the next pair via
    // clickNextDuplicate() below, leaving the pair untouched in the queue.
    function clickSaveForLater() { const b = getSidebarActionButton('Save for later'); if (b) b.click(); return !!b; }
    function clickNextDuplicate() {
        const b = document.querySelector('.review-queue-nav [aria-label="Next duplicate"]:not([disabled])');
        if (b) { b.click(); return true; }
        return false;
    }
    function clickPrevDuplicate() {
        const b = document.querySelector('[aria-label="Previous duplicate"]:not([disabled])');
        if (b) { b.click(); return true; }
        return false;
    }
    // BEST EFFORT: the reference snapshot is a saved file with no address bar,
    // so the new review page's URL scheme is unconfirmed. Tries the classic
    // "/duplicates/<24-hex-id>" pattern plus a couple of plausible
    // "deduplication" variants — verify against the live site and adjust.
    function extractDuplicateId(url) {
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

    // =========================================================
    // STATE
    // =========================================================
    let currentQueuePositionKey = '';   // "current/total" — used to detect navigation to a new pair
    let resolutionAttempted = false;    // resolution ran for the current pair
    let mergeClickPending = false;      // waiting on the two-phase verification delay
    let conflictWarningShown = false;
    let appealWarningShown = false;
    let awaitingMergeResult = false;
    let lastMergeContactNamesKey = '';

    function getPairKey() {
        // Prefer contact names (stable identity for the pair on screen); fall back
        // to the queue position counter if names aren't available yet.
        const names = getContactNames();
        if (names.length === 2 && names[0] && names[1]) return names.join('|');
        const pos = getQueuePosition();
        return pos ? `${pos.current}/${pos.total}` : '';
    }

    // =========================================================
    // LOCKDOWN DETECTION
    // (Note: the value-text patterns below — "Spark Id:", "type: Custom",
    // "GRAD_", "Outreach_UGRD_", etc. — come from Element451's underlying
    // contact-field data, which this redesign did not change. Only the
    // container markup changed, so these regexes port over unmodified.)
    // =========================================================
    function isForbiddenEntry() {
        const names = getContactNames();
        const forbiddenNames = ['angela armstrong', 'gillespie armstrong', 'mariah armstrong'];
        for (const name of names) {
            const lower = name.toLowerCase().trim();
            if (lower.includes('test')) return { forbidden: true, reason: 'test in name', name };
            if (forbiddenNames.includes(lower)) return { forbidden: true, reason: 'forbidden name', name };
        }
        return { forbidden: false };
    }
    function isAppealKeyword() {
        for (const row of getDiffRows()) {
            if (row.values[0].textContent.toLowerCase().includes('appeal')) return { appeal: true, row, side: 'left' };
            if (row.values[1].textContent.toLowerCase().includes('appeal')) return { appeal: true, row, side: 'right' };
        }
        return { appeal: false };
    }
    function isStudentIgnored() {
        // BEST EFFORT: no "Ignored" chip was present in the reference snapshot
        // to confirm markup against. Verify this selector live.
        return Array.from(document.querySelectorAll('.bolt-chip, elm-chip'))
            .some(el => el.textContent.trim().toLowerCase() === 'ignored');
    }
    function detectActualDepartment() {
        const rows = getDiffRows();
        const isGradText = (t) => t.includes('GRAD_') || /grad student/i.test(t);
        const isIAText = (t) => t.includes('IA_') || t.includes('_IA_') || t.includes('_IA ');
        for (const row of rows) {
            const text = row.textContent;
            const isRelevantRow = text.includes('Workflows') || text.includes('Application') ||
                text.includes('Program') || text.includes('type:') || text.includes('status:');
            if (!isRelevantRow) continue;
            if ((isIAText(text) || isGradText(text)) && /status:\s*Finished/i.test(text)) {
                return { dept: 'Grad/IA', row };
            }
        }
        return { dept: 'UnderGrad', row: rows[0] || null };
    }
    function isWrongDepartment() {
        const dept = CFG.ALLOWED_DEPARTMENT.toLowerCase();
        if (dept === 'all') return { wrongDept: false };
        const result = detectActualDepartment();
        if (dept === 'none') return { wrongDept: true, row: result.row, reason: result.dept };
        if (result.dept.toLowerCase() === dept) return { wrongDept: false };
        return { wrongDept: true, row: result.row, reason: result.dept };
    }
    function isStudentIdMismatch() {
        for (const row of getDiffRows()) {
            const text = row.textContent;
            if (!text.includes('School Id:')) continue;
            const leftMatch = row.values[0].textContent.match(/School Id:\s*(\d+)/i);
            const rightMatch = row.values[1].textContent.match(/School Id:\s*(\d+)/i);
            if (leftMatch && rightMatch && leftMatch[1] !== rightMatch[1]) {
                return { mismatch: true, row, leftId: leftMatch[1], rightId: rightMatch[1] };
            }
        }
        return { mismatch: false };
    }
    function getAllBlockers() {
        const blockers = [];
        const forbidden = isForbiddenEntry();
        if (forbidden.forbidden) blockers.push({ type: 'forbidden', ...forbidden });
        const appeal = isAppealKeyword();
        if (appeal.appeal) blockers.push({ type: 'appeal', ...appeal });
        const wrongDept = isWrongDepartment();
        if (wrongDept.wrongDept) blockers.push({ type: 'department', ...wrongDept });
        const idMismatch = isStudentIdMismatch();
        if (idMismatch.mismatch) blockers.push({ type: 'student-id-mismatch', ...idMismatch });
        if (isStudentIgnored()) blockers.push({ type: 'ignored' });
        return blockers;
    }
    function applyBlockStyling(blockers) {
        document.body.classList.remove('elm2-blocked');
        document.querySelectorAll('.elm2-blocked-row').forEach(el => el.classList.remove('elm2-blocked-row'));
        document.querySelectorAll('.elm2-blocked-card').forEach(el => el.classList.remove('elm2-blocked-card'));
        if (blockers.length === 0) return;
        document.body.classList.add('elm2-blocked');
        blockers.forEach(b => { if (b.row && b.row.element) b.row.element.classList.add('elm2-blocked-row'); });
        if (blockers.some(b => b.type === 'forbidden' || b.type === 'ignored')) {
            getContactCards().forEach(c => c.classList.add('elm2-blocked-card'));
        }
    }
    // Signals the current entry's department/block status to csv-database-v2.js
    // via document.body.dataset, same contract as the classic script.
    function updateCsvSignal(blockers) {
        const uid = extractDuplicateId(window.location.href);
        const forbidden = blockers.some(b => b.type === 'forbidden' || b.type === 'student-id-mismatch');
        const appeal = blockers.find(b => b.type === 'appeal');
        const ignored = blockers.some(b => b.type === 'ignored');
        if (forbidden) document.body.dataset.csvDept = 'Forbidden';
        else if (appeal) document.body.dataset.csvDept = 'Appeal';
        else if (ignored) document.body.dataset.csvDept = 'Ignored';
        else document.body.dataset.csvDept = detectActualDepartment().dept;
        if (uid) document.body.dataset.csvUid = uid;
        if (appeal && !appealWarningShown) {
            appealWarningShown = true;
            const sideLabel = appeal.side === 'left' ? 'left side' : 'right side';
            alert('⚠️ Appeal keyword detected!\n\nReason: The word "appeal" was found on the ' + sideLabel + ' of this entry.\n\nThis merge is blocked and cannot be processed.');
        }
    }

    // =========================================================
    // POSSIBLE TWINS / DIFFERENT PEOPLE WARNING
    // Reuses the same First/Last Name + DOB + Address heuristics as the
    // classic script, but also folds in Bolt's own AI analysis summary,
    // which explicitly states when it thinks two contacts are different
    // people — a signal the old merge page never had.
    // =========================================================
    function checkForConflictingRecords() {
        if (CONFLICT_ROW_THRESHOLD === 0) return { conflictCount: 0, shouldWarn: false, conflicts: [] };
        const conflicts = [];
        let conflictCount = 0;
        const names = getContactNames();
        if (names.length === 2 && names[0] && names[1]) {
            const norm = (n) => n.toLowerCase().replace(/[\s-]/g, '');
            // Compare first tokens (first name) and remaining tokens (last name) independently
            const [aFirst, ...aRest] = names[0].split(/\s+/);
            const [bFirst, ...bRest] = names[1].split(/\s+/);
            if (aFirst && bFirst && norm(aFirst) !== norm(bFirst)) { conflictCount++; conflicts.push('First Name'); }
            const aLast = aRest.join(' '), bLast = bRest.join(' ');
            if (aLast && bLast && norm(aLast) !== norm(bLast)) { conflictCount++; conflicts.push('Last Name'); }
        }
        const isValidYear = (yearStr) => !!yearStr && !yearStr.startsWith('0') && parseInt(yearStr) >= 1900;
        for (const row of getDiffRowsByLabel('birth')) {
            const leftText = row.values[0].textContent, rightText = row.values[1].textContent;
            if (!leftText || !rightText) continue;
            const leftYear = leftText.match(/\b(\d{4})\b/), rightYear = rightText.match(/\b(\d{4})\b/);
            if (leftYear && rightYear && isValidYear(leftYear[1]) && isValidYear(rightYear[1])) {
                if (leftText.replace(/\s+/g, '').toLowerCase() !== rightText.replace(/\s+/g, '').toLowerCase()) {
                    conflictCount++; conflicts.push('Date of Birth');
                }
            }
        }
        for (const row of getDiffRowsByLabel('address')) {
            const leftText = row.values[0].textContent, rightText = row.values[1].textContent;
            if (leftText.length > 10 && rightText.length > 10) {
                const cmp = AddressComparer.compareAddresses(leftText, rightText);
                if (!cmp.areSame) { conflictCount++; conflicts.push('Address'); }
            }
        }
        // AI analysis signal: Bolt's summary explicitly says when it thinks
        // these are different people. Treat that as a strong extra conflict.
        const summary = getAnalysisSummaryText().toLowerCase();
        if (summary && /different (people|person|individuals?)/i.test(summary)) {
            conflictCount += CONFLICT_ROW_THRESHOLD; // force a warning regardless of threshold
            conflicts.push('Bolt Analysis (flagged as different people)');
        }
        const shouldWarn = conflictCount >= CONFLICT_ROW_THRESHOLD;
        return { conflictCount, shouldWarn, conflicts };
    }

    // =========================================================
    // FIELD RESOLUTION ENGINE
    // Same priority tiers as the classic script's autoResolveRows(), adapted
    // to operate on diff-row adapters. Dropped: the "email open count" tier
    // (sourced from a "User Activity" merge-array section that does not
    // appear to exist in the new layout — verify live before re-adding).
    // =========================================================
    function parseApplicationDate(text) {
        const dateMatch = text.match(/(?:updated at\s*)?(\w{3})\s+(\d{1,2}),?\s+(\d{4})\s*-?\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (!dateMatch) return null;
        const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
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
    function getSelectedEmailSide() {
        for (const row of getDiffRowsByLabel('email')) {
            if (row.element.dataset.elm2ScriptSide) return row.element.dataset.elm2ScriptSide;
            if (row.leftSelected) return 'left';
            if (row.rightSelected) return 'right';
        }
        return null;
    }
    function findApplicantSide() {
        const isUndergrad = detectActualDepartment().dept === 'UnderGrad';
        if (!isUndergrad) return null;
        for (const row of getDiffRows()) {
            const text = row.textContent;
            const leftText = row.values[0].textContent, rightText = row.values[1].textContent;
            if (text.includes('Cal State Apply Application')) {
                const leftHasCSU = leftText.includes('Cal State Apply Application');
                const rightHasCSU = rightText.includes('Cal State Apply Application');
                if (leftHasCSU && !rightHasCSU) return 'left';
                if (rightHasCSU && !leftHasCSU) return 'right';
                if (leftHasCSU && rightHasCSU) {
                    const leftDate = parseApplicationDate(leftText), rightDate = parseApplicationDate(rightText);
                    if (leftDate && rightDate) return leftDate >= rightDate ? 'left' : 'right';
                    if (leftDate) return 'left';
                    if (rightDate) return 'right';
                    return 'left';
                }
            }
            const applicationPattern = /type:\s*(Application Start|Application Submit|Application Complete|Admit)/i;
            const leftHasApp = applicationPattern.test(leftText), rightHasApp = applicationPattern.test(rightText);
            if (leftHasApp && !rightHasApp) return 'left';
            if (rightHasApp && !leftHasApp) return 'right';
            if (leftHasApp && rightHasApp) {
                const leftCount = (leftText.match(/type:\s*(Application|Admit)/gi) || []).length;
                const rightCount = (rightText.match(/type:\s*(Application|Admit)/gi) || []).length;
                if (rightCount > leftCount) return 'right';
                if (leftCount > rightCount) return 'left';
                const leftDate = parseApplicationDate(leftText), rightDate = parseApplicationDate(rightText);
                if (leftDate && rightDate) return rightDate > leftDate ? 'right' : 'left';
                return 'right';
            }
        }
        return null;
    }
    function autoResolveRows() {
        const applicantSide = findApplicantSide();
        const rows = getDiffRows().filter(r => r.isConflict && !r.element.dataset.elm2AutoResolved);
        rows.forEach(row => {
            const text = row.textContent;
            const leftText = row.values[0].textContent, rightText = row.values[1].textContent;
            if (!leftText || !rightText) return;
            if (applicantSide) {
                row.element.dataset.elm2AutoResolved = 'true';
                applyScriptPick(row, applicantSide);
                return;
            }
            // Milestone type matching (no applicant context)
            if (text.match(/type:\s*\w+,\s*\w{3}\s+\d{1,2},\s*\d{4}/i)) {
                const typePattern = /type:\s*(\w+),/i;
                const leftTypeMatch = leftText.match(typePattern), rightTypeMatch = rightText.match(typePattern);
                if (leftTypeMatch && rightTypeMatch && leftTypeMatch[1].toLowerCase() === rightTypeMatch[1].toLowerCase()) {
                    row.element.dataset.elm2AutoResolved = 'true';
                    applyScriptPick(row, 'left');
                    return;
                }
            }
            // Email preference
            if (row.label.toLowerCase().includes('email')) {
                const personalDomains = ['gmail.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'aol.com', 'me.com', 'outlook.com', 'live.com', 'msn.com', 'protonmail.com', 'proton.me'];
                const leftIsPersonal = personalDomains.some(d => leftText.toLowerCase().includes('@' + d));
                const rightIsPersonal = personalDomains.some(d => rightText.toLowerCase().includes('@' + d));
                if (leftIsPersonal && !rightIsPersonal) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'left'); return; }
                if (rightIsPersonal && !leftIsPersonal) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'right'); return; }
                if (leftIsPersonal && rightIsPersonal) { row.element.dataset.elm2AutoResolved = 'true'; row.element.dataset.elm2DualPersonal = 'true'; return; }
            }
            // csusb.major preference
            if (/csusb\.major\./i.test(text)) {
                const leftHas = /csusb\.major\./i.test(leftText), rightHas = /csusb\.major\./i.test(rightText);
                if (leftHas && !rightHas) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'left'); return; }
                if (rightHas && !leftHas) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'right'); return; }
                if (leftHas && rightHas) {
                    const emailSide = getSelectedEmailSide();
                    if (emailSide) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, emailSide); }
                    return;
                }
            }
            // Encoura / College Board ID — default left when both sides have it
            if (/Encoura Id:/i.test(leftText) && /Encoura Id:/i.test(rightText)) {
                row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'left'); return;
            }
            if (/College Board Id:/i.test(leftText) && /College Board Id:/i.test(rightText)) {
                row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'left'); return;
            }
            // csusb.school preference (Student Type rows)
            if (text.includes('Student Type') && /csusb\.school\.\d+/i.test(text)) {
                const schoolPattern = /csusb\.school\.\d+/i;
                const leftHas = schoolPattern.test(leftText), rightHas = schoolPattern.test(rightText);
                if (leftHas && !rightHas) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'left'); return; }
                if (rightHas && !leftHas) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'right'); return; }
                if (!leftHas && !rightHas) return;
                if (leftHas && rightHas) {
                    const emailSide = getSelectedEmailSide();
                    if (emailSide) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, emailSide); }
                    return;
                }
            }
            // Date of Birth — reject invalid years
            if (row.label.toLowerCase().includes('birth')) {
                const leftYear = leftText.match(/\b(\d{4})\b/), rightYear = rightText.match(/\b(\d{4})\b/);
                const leftInvalid = leftYear && (leftYear[1].startsWith('0') || parseInt(leftYear[1]) < 1900);
                const rightInvalid = rightYear && (rightYear[1].startsWith('0') || parseInt(rightYear[1]) < 1900);
                if (leftInvalid && !rightInvalid) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'right'); return; }
                if (rightInvalid && !leftInvalid) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'left'); return; }
            }
            // First Generation Student — prefer Yes over No
            if (row.label.toLowerCase().includes('first generation')) {
                const leftYes = /\byes\b/i.test(leftText), rightYes = /\byes\b/i.test(rightText);
                const leftNo = /\bno\b/i.test(leftText), rightNo = /\bno\b/i.test(rightText);
                if (leftYes && rightNo) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'left'); return; }
                if (rightYes && leftNo) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'right'); return; }
            }
            // Intended Term — prefer later term code
            if (row.label.toLowerCase().includes('intended term')) {
                const termCodePattern = /\((\d{4})\)/;
                const leftCodeMatch = leftText.match(termCodePattern), rightCodeMatch = rightText.match(termCodePattern);
                if (leftCodeMatch && rightCodeMatch) {
                    const leftCode = parseInt(leftCodeMatch[1]), rightCode = parseInt(rightCodeMatch[1]);
                    if (rightCode > leftCode) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'right'); return; }
                    if (leftCode > rightCode) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'left'); return; }
                }
            }
            // Name case preference — Title Case over ALL CAPS / all lowercase
            if (row.label.toLowerCase().includes('name') && !row.label.toLowerCase().includes('email')) {
                if (leftText.toLowerCase() === rightText.toLowerCase() && leftText !== rightText) {
                    const isAllUpper = (s) => s === s.toUpperCase() && s !== s.toLowerCase();
                    const isAllLower = (s) => s === s.toLowerCase() && s !== s.toUpperCase();
                    const isTitleCase = (s) => !isAllUpper(s) && !isAllLower(s);
                    if (isTitleCase(rightText) && !isTitleCase(leftText)) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'right'); return; }
                    if (isTitleCase(leftText) && !isTitleCase(rightText)) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'left'); return; }
                }
            }
            // Legacy default-to-left patterns (only reached with no applicant context)
            const legacyPatterns = [
                /Spark Id:/i,
                /type:\s*Created,\s*name:\s*Record Created/i,
                /type:\s*Custom/i,
                /type:.*name:/i,
                /type:\s*Web/i,
                /\[ACUx\]/i,
                /Outreach_UGRD_/i
            ];
            if (legacyPatterns.some(p => p.test(text))) {
                row.element.dataset.elm2AutoResolved = 'true';
                applyScriptPick(row, 'left');
            }
        });
    }
    // Dual-personal-email tiebreak (name/DOB-in-email). Email-open-count tier
    // dropped — no "User Activity" section found in the new layout.
    function autoDualPersonalEmails() {
        const rows = getDiffRows().filter(r => r.isConflict && r.element.dataset.elm2DualPersonal && !r.element.dataset.elm2DualResolved);
        const names = getContactNames();
        const [firstA = '', ...restA] = (names[0] || '').toLowerCase().split(/\s+/);
        const [firstB = '', ...restB] = (names[1] || '').toLowerCase().split(/\s+/);
        const lastA = restA.join(' '), lastB = restB.join(' ');
        let birthYearLeft = '', birthYearRight = '', leftYearValid = false, rightYearValid = false;
        for (const row of getDiffRowsByLabel('birth')) {
            const leftMatch = row.values[0].textContent.match(/\b(\d{4})\b/);
            const rightMatch = row.values[1].textContent.match(/\b(\d{4})\b/);
            if (leftMatch) { birthYearLeft = leftMatch[1]; leftYearValid = !birthYearLeft.startsWith('0') && parseInt(birthYearLeft) >= 1900; }
            if (rightMatch) { birthYearRight = rightMatch[1]; rightYearValid = !birthYearRight.startsWith('0') && parseInt(birthYearRight) >= 1900; }
        }
        const emailContainsName = (email, name) => {
            if (!name || !email) return false;
            if (email.includes(name)) return true;
            return name.split(/[\s-]+/).filter(p => p.length >= 3).some(p => email.includes(p));
        };
        const checkYearInEmail = (email, year) => !!year && (email.includes(year) || email.includes(year.slice(1)) || email.includes(year.slice(2)));
        rows.forEach(row => {
            const leftLower = row.values[0].textContent.toLowerCase();
            const rightLower = row.values[1].textContent.toLowerCase();
            // Priority: first name, then last name, then birth year
            const leftFirst = emailContainsName(leftLower, firstA) || emailContainsName(leftLower, firstB);
            const rightFirst = emailContainsName(rightLower, firstA) || emailContainsName(rightLower, firstB);
            if (leftFirst && !rightFirst) { row.element.dataset.elm2DualResolved = 'true'; applyScriptPick(row, 'left'); return; }
            if (rightFirst && !leftFirst) { row.element.dataset.elm2DualResolved = 'true'; applyScriptPick(row, 'right'); return; }
            const leftLast = emailContainsName(leftLower, lastA) || emailContainsName(leftLower, lastB);
            const rightLast = emailContainsName(rightLower, lastA) || emailContainsName(rightLower, lastB);
            if (leftLast && !rightLast) { row.element.dataset.elm2DualResolved = 'true'; applyScriptPick(row, 'left'); return; }
            if (rightLast && !leftLast) { row.element.dataset.elm2DualResolved = 'true'; applyScriptPick(row, 'right'); return; }
            const leftYear = (leftYearValid && checkYearInEmail(leftLower, birthYearLeft)) || (rightYearValid && checkYearInEmail(leftLower, birthYearRight));
            const rightYear = (leftYearValid && checkYearInEmail(rightLower, birthYearLeft)) || (rightYearValid && checkYearInEmail(rightLower, birthYearRight));
            if (leftYear && !rightYear) { row.element.dataset.elm2DualResolved = 'true'; applyScriptPick(row, 'left'); return; }
            if (rightYear && !leftYear) { row.element.dataset.elm2DualResolved = 'true'; applyScriptPick(row, 'right'); return; }
            row.element.dataset.elm2DualResolved = 'true'; // no tiebreaker — leave for manual review
        });
    }
    function autoResolveAddresses() {
        const applicantSide = findApplicantSide();
        const rows = getDiffRowsByLabel('address').filter(r => r.isConflict && !r.element.dataset.elm2AddressResolved);
        rows.forEach(row => {
            const leftText = row.values[0].textContent, rightText = row.values[1].textContent;
            if (!leftText || !rightText) return;
            row.element.dataset.elm2AddressResolved = 'true';
            if (applicantSide) { applyScriptPick(row, applicantSide); return; }
            const comparison = AddressComparer.compareAddresses(leftText, rightText);
            let winner = comparison.winner;
            if (winner === 'tie') {
                const emailSide = getSelectedEmailSide();
                if (emailSide) winner = emailSide;
            }
            if (winner === 'left' || winner === 'right') applyScriptPick(row, winner);
        });
    }
    function runAutoResolution() {
        autoResolveRows();
        autoDualPersonalEmails();
        autoResolveAddresses();
    }

    // =========================================================
    // AI-VS-SCRIPT PICK COMPARISON
    // Every row where both elm2AiSide (Bolt's original default, captured by
    // snapshotNativeSelections()) and elm2ScriptSide (our resolution engine's
    // pick, stamped by applyScriptPick()) are known can be compared. Rows the
    // script had no opinion on (no rule matched, or it left a tie for manual
    // review) simply have no elm2ScriptSide and are left out of the count —
    // there's nothing to switch on those.
    // =========================================================
    function getPickComparisonRows() {
        return getDiffRows().filter(r => r.element.dataset.elm2AiSide && r.element.dataset.elm2ScriptSide);
    }
    function clearPickClasses(root) {
        root.querySelectorAll('.elm2-agree-row').forEach(el => el.classList.remove('elm2-agree-row'));
        root.querySelectorAll('.elm2-pick-bolt, .elm2-pick-ours').forEach(el => el.classList.remove('elm2-pick-bolt', 'elm2-pick-ours'));
    }
    function annotateRowColors() {
        resetStaleRows();
        if (!CFG.HIGHLIGHT_ROWS) {
            clearPickClasses(document);
            document.querySelectorAll('.diff-row[title]').forEach(el => el.removeAttribute('title'));
            return;
        }
        const label = (side) => (side === 'left' ? 'A' : 'B');
        getDiffRows().forEach(row => {
            const ai = row.element.dataset.elm2AiSide;
            const script = row.element.dataset.elm2ScriptSide;
            const both = !!ai && !!script;
            const agree = both && ai === script;
            const conflict = both && ai !== script;
            row.element.classList.toggle('elm2-agree-row', agree);
            // Conflict rows: color the two value buttons by who picked them.
            const btns = row.element.querySelectorAll(':scope > .diff-value-button');
            ['left', 'right'].forEach((side, idx) => {
                const btn = btns[idx];
                if (!btn) return;
                btn.classList.toggle('elm2-pick-bolt', conflict && ai === side);
                btn.classList.toggle('elm2-pick-ours', conflict && script === side);
            });
            if (both) {
                row.element.title = 'Our rules suggest Contact ' + label(script) + '; Bolt picked Contact ' + label(ai);
            } else {
                row.element.removeAttribute('title');
            }
        });
    }
    function applyAllPicks(sourceAttr) {
        getDiffRows().forEach(row => {
            const side = row.element.dataset[sourceAttr];
            if (side) row.selectSide(side);
        });
        annotateRowColors();
        injectPickComparisonBar();
    }
    function injectPickComparisonBar() {
        const form = getDiffForm();
        const formEl = form ? form.querySelector('form.diff-form') : null;
        let bar = document.getElementById('elm2-pick-compare-bar');
        if (!formEl) { if (bar) bar.remove(); return; }
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'elm2-pick-compare-bar';
            bar.innerHTML = `
                <span id="elm2-pick-compare-count"></span>
                <button type="button" id="elm2-use-ai-btn">Use Bolt AI picks</button>
                <button type="button" id="elm2-use-script-btn">Use our picks</button>
            `;
            const header = formEl.querySelector(':scope > .diff-contacts-header');
            if (header) header.insertAdjacentElement('afterend', bar);
            else formEl.insertBefore(bar, formEl.firstChild);
            document.getElementById('elm2-use-ai-btn').addEventListener('click', () => applyAllPicks('elm2AiSide'));
            document.getElementById('elm2-use-script-btn').addEventListener('click', () => applyAllPicks('elm2ScriptSide'));
        }
        const all = getDiffRows();
        const conflicts = all.filter(r => r.isConflict).length;
        const ours = all.filter(r => r.element.dataset.elm2ScriptSide);
        const both = ours.filter(r => r.element.dataset.elm2AiSide);
        const differing = both.filter(r => r.element.dataset.elm2AiSide !== r.element.dataset.elm2ScriptSide).length;
        const blocked = document.body.classList.contains('elm2-blocked');
        let msg;
        if (blocked) msg = `Blocked entry — no suggestions made (${conflicts} conflicting of ${all.length} fields)`;
        else if (ours.length === 0) msg = `${conflicts} conflicting field(s); our rules had no opinion on any of them`;
        else if (differing > 0) msg = `⚠ ${differing} of ${ours.length} suggestions differ from Bolt's picks (${conflicts} conflicting of ${all.length} fields)`;
        else msg = `Our ${ours.length} suggestion(s) match Bolt's picks (${conflicts} conflicting of ${all.length} fields)`;
        if (!blocked && ours.length > 0 && !CFG.AUTO_RESOLVE_FIELDS) msg += ' — suggestions only, not applied';
        document.getElementById('elm2-pick-compare-count').textContent = msg;
        document.getElementById('elm2-use-ai-btn').disabled = both.length === 0;
        document.getElementById('elm2-use-script-btn').disabled = ours.length === 0;
    }


    // Safety net: Dismiss (and Confirm on its "Not a duplicate?" dialog) is a
    // permanent verdict and must only ever come from a human. Real clicks have
    // isTrusted=true; anything a script fires via .click() is false. Block those
    // in the capture phase, and log a stack trace naming whoever tried.
    document.addEventListener('click', (e) => {
        if (e.isTrusted) return;
        const btn = e.target && e.target.closest ? e.target.closest('button') : null;
        if (!btn) return;
        const text = btn.textContent.trim().toLowerCase();
        if (!btn.classList.contains('diff-value-button')) {
            console.log('[elm2] script click on button:', JSON.stringify(btn.textContent.trim() || btn.getAttribute('aria-label') || ''));
        }
        const inNotDupDialog = !!btn.closest('bolt-dialog') && /not a duplicate/i.test(btn.closest('bolt-dialog').textContent);
        if (text === 'dismiss' || (inNotDupDialog && text === 'confirm')) {
            e.stopImmediatePropagation();
            e.preventDefault();
            console.warn('[elm2] BLOCKED a script-generated click on "' + btn.textContent.trim() + '"', new Error().stack);
        }
    }, true);

    // =========================================================
    // MAIN AUTOMATION LOOP
    //
    // IMPORTANT: this only ever fills in field selections. It never clicks
    // "Merge Contacts" itself. The classic script worked the same way — its
    // "Auto-Click FAB" setting only fired the FAB's *first* click (which
    // triggers conflict detection/auto-resolution); the FAB's second click,
    // the one that actually commits the merge, always required a human,
    // even with that setting on. Merging here stays exactly as manual.
    // =========================================================
    function attemptAutoResolve() {
        if (!isDedupReviewPage()) return;
        if (!getContactNames().filter(Boolean).length) return; // page still loading
        resetStaleRows();
        snapshotNativeSelections(); // capture Bolt's defaults before anything below can click a row
        const pairKey = getPairKey();
        if (pairKey !== currentQueuePositionKey) {
            currentQueuePositionKey = pairKey;
            resolutionAttempted = false;
            conflictWarningShown = false;
            appealWarningShown = false;
            delete document.body.dataset.csvDept;
            delete document.body.dataset.csvUid;
        }
        const blockers = getAllBlockers();
        applyBlockStyling(blockers);
        updateCsvSignal(blockers);
        if (blockers.length > 0) {
            if (resolutionAttempted) return;
            resolutionAttempted = true;
            console.log('[elm2] Blocked:', blockers.map(b => b.type + (b.reason ? ' (' + b.reason + ')' : '')).join(', '),
                '| auto-skip', CFG.AUTO_SKIP_BLOCKED ? 'ON' : 'OFF');
            if (CFG.AUTO_SKIP_BLOCKED) {
                setTimeout(() => {
                    const ok = clickNextDuplicate();
                    console.log('[elm2] Clicked Next duplicate:', ok);
                }, 1200);
            }
            return;
        }
        if (!resolutionAttempted) console.log('[elm2] Not blocked — allowed dept:', CFG.ALLOWED_DEPARTMENT, '| detected:', detectActualDepartment().dept);
        if (resolutionAttempted) return;
        resolutionAttempted = true;
        // Two-phase, mirroring the classic script: resolve now, then re-verify
        // shortly after in case more Workflow/Source rows loaded in the meantime.
        runAutoResolution();
        setTimeout(() => {
            const laterBlockers = getAllBlockers();
            applyBlockStyling(laterBlockers);
            if (laterBlockers.length > 0) {
                if (CFG.AUTO_SKIP_BLOCKED) { clickNextDuplicate(); }
                return;
            }
            runAutoResolution();
            const _rows = getDiffRows();
            console.log('[elm2] Resolution done —', _rows.length, 'fields,',
                _rows.filter(r => r.element.dataset.elm2ScriptSide).length, 'with our suggestion,',
                _rows.filter(r => r.element.dataset.elm2AiSide).length, 'with a Bolt default captured');
            if (!conflictWarningShown && CONFLICT_ROW_THRESHOLD > 0) {
                const { conflictCount, shouldWarn, conflicts } = checkForConflictingRecords();
                if (shouldWarn) {
                    conflictWarningShown = true;
                    alert(`⚠️ Warning: ${conflictCount} conflicting signal(s) detected!\n\nConflicts found in: ${conflicts.join(', ')}\n\nThese entries might be twins or two different people. Please review carefully before merging.`);
                }
            }
            const scoreLevel = getScoreChipLevel();
            if (scoreLevel === 'low' && !conflictWarningShown) {
                conflictWarningShown = true;
                alert('⚠️ Bolt confidence score is "Low" for this pair. Please review carefully before merging.');
            }
            // Resolution stops here. Reviewing the selections and clicking
            // "Merge Contacts" is always a human decision.
        }, 600);
    }
    // Tracks merges regardless of who clicks "Merge Contacts" (always a
    // human, per above) so the counter/auto-navigate still work.
    let mergeButtonBound = null;
    function bindMergeButtonTracking() {
        const btn = getSidebarActionButton('Merge Contacts');
        if (!btn || btn === mergeButtonBound) return;
        mergeButtonBound = btn;
        btn.addEventListener('click', () => {
            awaitingMergeResult = true;
            lastMergeContactNamesKey = getPairKey();
        });
    }
    function checkForMergeResult() {
        if (!awaitingMergeResult) return;
        // BEST EFFORT: no merge-success element existed in the reference
        // snapshot. Detect success as "the pair on screen changed" after
        // Merge Contacts was clicked, which is the one thing guaranteed to
        // happen whether the UI shows a toast or just advances the queue.
        // NOTE: this only fires once the pair on screen has already
        // changed, meaning the app already advanced the queue on its own —
        // do NOT also call clickNextDuplicate() here, that would skip an
        // extra pair. An "auto-navigate after merge" feature isn't safe to
        // add back until there's a real merge-success indicator that can
        // tell "merged" apart from "nothing happened yet" (see README).
        const pairKey = getPairKey();
        if (pairKey && pairKey !== lastMergeContactNamesKey) {
            awaitingMergeResult = false;
            if (CFG.SHOW_MERGE_COUNTER) incrementMergeCount();
            return;
        }
    }
    setInterval(() => {
        attemptAutoResolve();
        bindMergeButtonTracking();
        checkForMergeResult();
        injectMergeCounter();
        if (isDedupReviewPage()) {
            syncBoltBlue();
            annotateRowColors();
            injectPickComparisonBar();
        }
    }, 750);
    new MutationObserver(() => {
        checkForMergeResult();
    }).observe(document.body, { childList: true, subtree: true });

    // =========================================================
    // MERGE COUNTER + SETTINGS PANE
    // (targets .bolt-navigation-right / elm-universal-search — confirmed
    // still present in the redesigned navbar)
    // =========================================================
    function incrementMergeCount() {
        const count = parseInt(localStorage.getItem('elm_merge_count') || '0', 10) + 1;
        localStorage.setItem('elm_merge_count', String(count));
        const counterEl = document.getElementById('elm-merge-counter');
        if (counterEl) {
            counterEl.textContent = `Merges: ${count}`;
            counterEl.style.transform = 'scale(1.15)';
            setTimeout(() => { counterEl.style.transform = 'scale(1)'; }, 150);
        }
    }
    function injectMergeCounter() {
        const navRight = document.querySelector('.bolt-navigation-right');
        const searchBox = document.querySelector('elm-universal-search') || document.querySelector('.bolt-navigation-universal-search');
        if (!navRight || !searchBox || document.getElementById('elm-controls-wrapper')) return;
        const controlsWrapper = document.createElement('div');
        controlsWrapper.id = 'elm-controls-wrapper';

        const settingsBtn = document.createElement('button');
        settingsBtn.id = 'elm-settings-btn';
        settingsBtn.innerHTML = '⚙';
        settingsBtn.title = 'Settings';
        settingsBtn.onclick = (e) => { e.stopPropagation(); toggleSettingsPane(); };
        controlsWrapper.appendChild(settingsBtn);

        if (CFG.SHOW_MERGE_COUNTER) {
            const counterWrapper = document.createElement('div');
            counterWrapper.id = 'elm-counter-wrapper';
            const counterEl = document.createElement('span');
            counterEl.id = 'elm-merge-counter';
            counterEl.textContent = `Merges: ${localStorage.getItem('elm_merge_count') || '0'}`;
            counterEl.style.transition = 'transform 0.15s ease-out';
            const resetBtn = document.createElement('button');
            resetBtn.id = 'elm-reset-btn';
            resetBtn.innerHTML = '↺';
            resetBtn.title = 'Reset merge counter';
            resetBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm('Reset merge counter to 0?')) {
                    localStorage.setItem('elm_merge_count', '0');
                    counterEl.textContent = 'Merges: 0';
                }
            };
            counterWrapper.appendChild(counterEl);
            counterWrapper.appendChild(resetBtn);
            controlsWrapper.appendChild(counterWrapper);
        }
        navRight.insertBefore(controlsWrapper, searchBox.parentElement && searchBox.parentElement !== navRight ? searchBox.parentElement : searchBox);
    }
    function toggleSettingsPane(forceState) {
        let overlay = document.getElementById('elm-settings-overlay');
        let pane = document.getElementById('elm-settings-pane');
        if (!pane) { injectSettingsPane(); overlay = document.getElementById('elm-settings-overlay'); pane = document.getElementById('elm-settings-pane'); }
        const shouldOpen = forceState !== undefined ? forceState : !pane.classList.contains('open');
        pane.classList.toggle('open', shouldOpen);
        overlay.classList.toggle('open', shouldOpen);
    }
    function injectSettingsPane() {
        if (document.getElementById('elm-settings-pane')) return;
        const overlay = document.createElement('div');
        overlay.id = 'elm-settings-overlay';
        overlay.onclick = () => toggleSettingsPane(false);
        document.body.appendChild(overlay);

        const pane = document.createElement('div');
        pane.id = 'elm-settings-pane';
        pane.innerHTML = `
            <div class="settings-header">
                <span>Settings (New Layout) · ${BUILD}</span>
                <button id="elm-settings-close" style="background:none;border:none;font-size:20px;cursor:pointer;">&times;</button>
            </div>
            <div class="settings-body">
                <div class="settings-section-title">Automation</div>
                <div class="setting-row"><label>Auto-Apply Suggestions</label>${toggleHtml('elm-auto-resolve-fields')}</div>
                <div class="setting-row"><label>Auto-Skip Blocked</label>${toggleHtml('elm-auto-skip-blocked')}</div>
                <div class="settings-section-title">Display</div>
                <div class="setting-row"><label>Highlight Rows</label>${toggleHtml('elm-highlight-rows')}</div>
                <div class="setting-row"><label>Show Merge Counter</label>${toggleHtml('elm-show-merge-counter')}</div>
                <div class="settings-section-title">Department</div>
                <div class="setting-row">
                    <label>Allowed Department</label>
                    <select id="elm-allowed-department">
                        <option value="All">All</option>
                        <option value="UnderGrad">UnderGrad</option>
                        <option value="Grad/IA">Grad/IA</option>
                        <option value="None">None</option>
                    </select>
                </div>
            </div>
        `;
        document.body.appendChild(pane);
        document.getElementById('elm-settings-close').onclick = () => toggleSettingsPane(false);
        function toggleHtml(id) {
            return `<label class="elm-toggle-switch"><input type="checkbox" id="${id}"><span class="elm-toggle-slider"></span></label>`;
        }
        setupToggle('elm-auto-resolve-fields', 'elm_auto_click_fab');
        setupToggle('elm-auto-skip-blocked', 'elm_auto_skip_blocked');
        setupToggle('elm-highlight-rows', 'elm_highlight_rows');
        setupToggle('elm-show-merge-counter', 'elm_show_merge_counter', () => { document.getElementById('elm-controls-wrapper')?.remove(); injectMergeCounter(); });
        function setupToggle(elementId, storageKey, onChange) {
            const el = document.getElementById(elementId);
            if (!el) return;
            el.checked = getBoolSetting(storageKey, true);
            el.addEventListener('change', () => {
                localStorage.setItem(storageKey, String(el.checked));
                if (onChange) onChange();
            });
        }
        const deptSelect = document.getElementById('elm-allowed-department');
        deptSelect.value = CFG.ALLOWED_DEPARTMENT;
        deptSelect.addEventListener('change', () => localStorage.setItem('elm_allowed_department', deptSelect.value));
    }

    console.log('%cElement451 UI Perfection (new layout) loaded — ' + BUILD, 'color:#6a1b9a;font-weight:bold;');
})();
