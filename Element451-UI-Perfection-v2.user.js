// ==UserScript==
// @name         Element451 - UI Perfection (New Deduplication Layout)
// @namespace    http://tampermonkey.net/
// @version      2.91
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
    const BUILD = 'v2-build-91'; // keep in sync with @version (2.91)
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
    // Slider position, 0..5: None, Applicant, High, Medium, Low, All (each adds to the one before).
    // Stored under a new key; the old slider (0 none, 1 applicant, 2 low, 3 medium, 4 all) is mapped once.
    function rangeLevel() {
        const v = parseInt(localStorage.getItem('elm_range_level'), 10);
        if (!isNaN(v)) return Math.max(0, Math.min(5, v));
        const old = parseInt(localStorage.getItem('elm_auto_apply_level'), 10);
        if (!isNaN(old)) return [0, 1, 4, 3, 5][Math.max(0, Math.min(4, old))];
        return getBoolSetting('elm_auto_click_fab', true) ? 5 : 0;
    }
    const CFG = Object.defineProperties({}, {
        // Slider = which pairs are in range (0 None = automation off, 1 Applicant, 2 + High score,
        // 3 + Medium, 4 + Low, 5 All).
        RANGE_LEVEL:              { get() { return rangeLevel(); } },
        // Whose picks are used on pairs in range: 'ours' (our rules, incl. the applicant rule) or
        // 'bolt' (leave Bolt's picks; ours only fills rows Bolt left unselected).
        USE_PICKS:                { get() { return localStorage.getItem('elm_use_picks') === 'bolt' ? 'bolt' : 'ours'; } },
        // What happens once a pair in range is decided: 'wait' for you, or 'merge'. Kept per browser
        // session only, so a new session always starts on 'wait'.
        // Seconds of the auto-merge cancel window (never below 2: the window is required).
        MERGE_COUNTDOWN:          { get() { const v = parseInt(localStorage.getItem('elm_merge_countdown'), 10); return isNaN(v) ? 4 : Math.max(2, Math.min(15, v)); } },
        WHEN_DONE:                { get() { try { return sessionStorage.getItem('elm_when_done') === 'merge' ? 'merge' : 'wait'; } catch (e) { return 'wait'; } } },
        HIGHLIGHT_ROWS:           { get() { return getBoolSetting('elm_highlight_rows', true); } },
        SHOW_MERGE_COUNTER:       { get() { return getBoolSetting('elm_show_merge_counter', false); } },
        AUTO_SKIP_BLOCKED:        { get() { return getBoolSetting('elm_auto_skip_blocked', true); } },
        ALLOWED_DEPARTMENT:       { get() { return localStorage.getItem('elm_allowed_department') || 'UnderGrad'; } },
    });
    // =========================================================
    // CSS
    // =========================================================
    const css = `
        /* --- Material 3 design tokens for OUR UI (gear, counter, settings pane, comparison
               bar). Primary is Element451's orange header colour (sampled; #ef6c00 until found). --- */
        :root {
            --md-primary: var(--elm2-header-color, #ef6c00);
            --md-primary-text: color-mix(in srgb, var(--md-primary) 76%, #000);
            --md-primary-container: color-mix(in srgb, var(--md-primary) 18%, #fff);
            --md-on-primary-container: color-mix(in srgb, var(--md-primary) 30%, #000);
            --md-primary-track: color-mix(in srgb, var(--md-primary) 26%, #fff);
            --md-on-surface: #1a1c20;
            --md-on-surface-variant: #434750;
            --md-outline: #73777f;
            --md-surface-container-low: #f7f4f1;
            --md-surface-container: #f1ede8;
            --md-surface-container-highest: #e6e1db;
            --md-error: #b3261e;
            --md-elev-1: 0 1px 2px rgba(0,0,0,.3), 0 1px 3px 1px rgba(0,0,0,.15);
            --md-elev-3: 0 1px 3px rgba(0,0,0,.3), 0 4px 8px 3px rgba(0,0,0,.15);
            --md-ease: cubic-bezier(.2, 0, 0, 1);
        }
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
        /* Shared toast stack (also used by csv-database-v2.js): bottom-left, stacks upward. */
        #elm2-toast-stack { position: fixed; left: 16px; bottom: 16px; z-index: 10000; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
        .elm2-toast { display: flex; align-items: center; gap: 12px; box-sizing: border-box; min-height: 48px; max-width: 340px; padding: 8px 16px 8px 12px; border-radius: 4px; background: #2f3236; color: #f1f3f7; font: 400 14px/20px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; letter-spacing: .25px; box-shadow: var(--md-elev-3); opacity: 0; transform: translateY(8px); transition: opacity .25s var(--md-ease), transform .25s var(--md-ease); }
        .elm2-toast.visible { opacity: 1; transform: none; }
        .elm2-toast.elm2-notice { padding-left: 16px; }
        /* Material 3 dialog: 32% scrim, tonal container, hero indicator, headline + supporting text,
           filled error button. Container radius = button radius (24) + gap (16) so the corners nest. */
        #elm2-merge-overlay {
            position: fixed; inset: 0; z-index: 10001; display: flex; align-items: center; justify-content: center;
            background: rgba(0, 0, 0, .32); opacity: 0; pointer-events: none; transition: opacity .2s var(--md-ease);
        }
        #elm2-merge-overlay.visible { opacity: 1; pointer-events: auto; }
        #elm2-merge-overlay .elm2-merge-card {
            box-sizing: border-box; width: min(360px, calc(100vw - 32px)); padding: 40px 16px 16px; border-radius: 40px;
            background: #efebe6; color: #1a1c20; box-shadow: var(--md-elev-3); text-align: center;
            font-family: 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif;
            transform: scale(.85); opacity: 0; transition: transform .25s cubic-bezier(.05, .7, .1, 1), opacity .15s linear;
        }
        #elm2-merge-overlay.visible .elm2-merge-card { transform: scale(1); opacity: 1; }
        #elm2-merge-overlay .elm2-ring { position: relative; width: 160px; height: 160px; margin: 0 auto 24px; }
        #elm2-merge-overlay .elm2-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
        #elm2-merge-overlay .elm2-ring-track { fill: none; stroke: #f9dedc; stroke-width: 8; }
        #elm2-merge-overlay .elm2-ring-arc { fill: none; stroke: #b3261e; stroke-width: 8; stroke-linecap: round; stroke-dasharray: 276.46; stroke-dashoffset: 0; transition: stroke-dashoffset .8s cubic-bezier(.2, 0, 0, 1); }
        #elm2-merge-overlay #elm2-merge-count { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 57px; line-height: 64px; font-weight: 400; color: #b3261e; }
        #elm2-merge-overlay #elm2-merge-title { margin: 0 8px 8px; font-size: 24px; line-height: 32px; font-weight: 400; color: #1a1c20; }
        #elm2-merge-overlay #elm2-merge-summary { margin: 0 12px 32px; font-size: 14px; line-height: 20px; letter-spacing: .25px; color: #434750; }
        #elm2-merge-overlay #elm2-merge-cancel { position: relative; width: 100%; height: 48px; border: none; border-radius: 24px; background: #b3261e; color: #fff; font-family: inherit; font-weight: 500; font-size: 14px; line-height: 20px; letter-spacing: .1px; cursor: pointer; overflow: hidden; transition: box-shadow .2s var(--md-ease); }
        #elm2-merge-overlay #elm2-merge-cancel::after { content: ''; position: absolute; inset: 0; background: #fff; opacity: 0; transition: opacity .2s var(--md-ease); }
        #elm2-merge-overlay #elm2-merge-cancel:hover { box-shadow: var(--md-elev-1); }
        #elm2-merge-overlay #elm2-merge-cancel:hover::after { opacity: .08; }
        #elm2-merge-overlay #elm2-merge-cancel:active::after { opacity: .12; }
        @keyframes elm2-count-in { from { opacity: 0; transform: scale(.7); } to { opacity: 1; transform: scale(1); } }
        #elm2-merge-overlay #elm2-merge-cancel:focus-visible { outline: 3px solid rgba(179, 38, 30, .4); outline-offset: 2px; }
        /* --- Advanced Filters sidebar (list page): compact, Material 3 --- */
        elm-review-queue-filters-sidebar .bolt-stackable-sidebar-content { background: var(--md-surface-container-low) !important; color: var(--md-on-surface); font-family: 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; }
        elm-review-queue-filters-sidebar .bolt-stackable-sidebar-header-wrapper { display: flex !important; flex-wrap: nowrap !important; padding: 12px 16px 12px 8px !important; min-height: 0 !important; gap: 8px !important; align-items: center !important; border-bottom: 1px solid color-mix(in srgb, var(--md-outline) 25%, transparent) !important; background: transparent !important; }
        elm-review-queue-filters-sidebar .bolt-stackable-sidebar-header-wrapper bolt-stackable-sidebar-header { flex: 1 1 auto !important; min-width: 0 !important; }
        elm-review-queue-filters-sidebar .bolt-stackable-sidebar-close-button { width: 40px !important; height: 40px !important; padding: 0 !important; border: none !important; border-radius: 50% !important; flex: 0 0 auto !important; color: var(--md-on-surface-variant) !important; background: transparent !important; }
        elm-review-queue-filters-sidebar .bolt-stackable-sidebar-header-title { margin: 0 !important; font-size: 22px !important; line-height: 28px !important; font-weight: 400 !important; color: var(--md-on-surface) !important; }
        elm-review-queue-filters-sidebar .bolt-stackable-sidebar-header-actions { display: flex !important; gap: 8px !important; }
        elm-review-queue-filters-sidebar .bolt-stackable-sidebar-header-actions button { height: 40px !important; min-width: 0 !important; padding: 0 20px !important; border: none !important; border-radius: 20px !important; box-shadow: none !important; font-size: 14px !important; line-height: 20px !important; font-weight: 500 !important; letter-spacing: .1px !important; text-transform: none !important; }
        elm-review-queue-filters-sidebar .bolt-stackable-sidebar-header-actions button.bolt-button-color-accent { background: transparent !important; color: var(--md-primary-text) !important; }
        elm-review-queue-filters-sidebar .bolt-stackable-sidebar-header-actions button.bolt-button-color-accent:hover { background: color-mix(in srgb, var(--md-primary) 10%, transparent) !important; }
        elm-review-queue-filters-sidebar .bolt-stackable-sidebar-header-actions button.bolt-button-color-accent-dark { background: var(--md-primary) !important; color: #fff !important; }
        elm-review-queue-filters-sidebar .bolt-stackable-sidebar-header-actions button.bolt-button-color-accent-dark:hover { box-shadow: var(--md-elev-1) !important; }
        elm-review-queue-filters-sidebar .bolt-stackable-sidebar-header-actions button.bolt-button-disabled { background: rgba(26, 28, 32, .12) !important; color: rgba(26, 28, 32, .38) !important; box-shadow: none !important; }
        elm-review-queue-filters-sidebar .bolt-copilot-button { display: none !important; }
        elm-review-queue-filters-sidebar bolt-stackable-sidebar-body { padding: 12px 16px 16px !important; }
        elm-review-queue-filters-sidebar bolt-stackable-sidebar-section { display: block; margin: 0 0 8px !important; padding: 12px 16px 14px !important; border: none !important; border-radius: 16px !important; box-shadow: none !important; background: var(--md-surface-container) !important; }
        elm-review-queue-filters-sidebar bolt-stackable-sidebar-section .title { margin: 0 0 10px !important; padding: 0 !important; }
        elm-review-queue-filters-sidebar bolt-stackable-sidebar-section .title-content h3 { margin: 0 !important; font-size: 14px !important; line-height: 20px !important; font-weight: 500 !important; letter-spacing: .1px; color: var(--md-on-surface) !important; }
        elm-review-queue-filters-sidebar bolt-stackable-sidebar-section .description { margin: 2px 0 0 !important; font-size: 12px !important; line-height: 16px !important; letter-spacing: .4px; color: var(--md-on-surface-variant) !important; }
        elm-review-queue-filters-sidebar bolt-stackable-sidebar-section .separator { display: none !important; }
        elm-review-queue-filters-sidebar bolt-stackable-sidebar-section .content { padding: 0 !important; margin: 0 !important; }
        elm-review-queue-filters-sidebar bolt-fields { display: flex !important; flex-direction: column !important; gap: 12px !important; }
        elm-review-queue-filters-sidebar bolt-field { display: flex !important; flex-direction: column !important; align-items: stretch !important; gap: 6px !important; margin: 0 !important; padding: 0 !important; }
        elm-review-queue-filters-sidebar bolt-field-label { width: auto !important; margin: 0 !important; padding: 0 !important; font-size: 12px !important; line-height: 16px !important; font-weight: 500 !important; letter-spacing: .4px; color: var(--md-on-surface-variant) !important; }
        elm-review-queue-filters-sidebar .bolt-chip-list-wrapper { display: flex !important; flex-wrap: wrap !important; gap: 8px !important; }
        elm-review-queue-filters-sidebar bolt-chip-check.bolt-chip { display: inline-flex !important; align-items: center !important; box-sizing: border-box !important; height: 32px !important; min-height: 0 !important; margin: 0 !important; padding: 0 12px !important; border-radius: 8px !important; border: 1px solid var(--md-outline) !important; background: transparent !important; color: var(--md-on-surface-variant) !important; box-shadow: none !important; font-size: 14px !important; line-height: 20px !important; font-weight: 500 !important; letter-spacing: .1px; cursor: pointer; transition: background-color .2s var(--md-ease); }
        elm-review-queue-filters-sidebar bolt-chip-check.bolt-chip:hover { background: color-mix(in srgb, var(--md-on-surface) 8%, transparent) !important; }
        elm-review-queue-filters-sidebar bolt-chip-check .bolt-chip-text { display: flex !important; align-items: center !important; gap: 6px !important; padding: 0 !important; color: inherit !important; }
        elm-review-queue-filters-sidebar bolt-chip-check .mat-ripple { display: none !important; }
        elm-review-queue-filters-sidebar bolt-chip-check bolt-icon { display: none !important; }
        elm-review-queue-filters-sidebar bolt-chip-check.mat-mdc-chip-selected,
        elm-review-queue-filters-sidebar bolt-chip-check.mdc-evolution-chip--selected,
        elm-review-queue-filters-sidebar bolt-chip-check[aria-selected="true"] { border-color: transparent !important; background: var(--md-primary-container) !important; color: var(--md-on-primary-container) !important; }
        elm-review-queue-filters-sidebar bolt-chip-check.mat-mdc-chip-selected bolt-icon,
        elm-review-queue-filters-sidebar bolt-chip-check.mdc-evolution-chip--selected bolt-icon,
        elm-review-queue-filters-sidebar bolt-chip-check[aria-selected="true"] bolt-icon { display: inline-flex !important; width: 16px !important; height: 16px !important; }
        elm-review-queue-filters-sidebar .bolt-field-range-controls { display: grid !important; grid-template-columns: 1fr 1fr; gap: 8px !important; }
        elm-review-queue-filters-sidebar .bolt-field-range-controls .bolt-form-field-label-wrapper { display: block; margin: 0 0 2px !important; }
        elm-review-queue-filters-sidebar .bolt-field-range-controls bolt-label { font-size: 12px !important; line-height: 16px !important; letter-spacing: .4px; color: var(--md-on-surface-variant) !important; }
        elm-review-queue-filters-sidebar input[boltinput][type="date"] { box-sizing: border-box; width: 100%; height: 40px; padding: 0 12px; border: 1px solid var(--md-outline); border-radius: 8px; background: transparent; color: var(--md-on-surface); font-family: inherit; font-size: 14px; line-height: 20px; }
        elm-review-queue-filters-sidebar input[boltinput][type="date"]:hover { border-color: var(--md-on-surface); }
        elm-review-queue-filters-sidebar input[boltinput][type="date"]:focus { outline: none; border: 2px solid var(--md-primary); padding: 0 11px; }
        /* tighter vertical rhythm: one-line section headers, labels beside their controls */
        elm-review-queue-filters-sidebar .bolt-stackable-sidebar-header-wrapper { padding: 12px 16px 12px 6px !important; }
        elm-review-queue-filters-sidebar bolt-stackable-sidebar-body { padding: 12px 16px 16px !important; }
        elm-review-queue-filters-sidebar bolt-stackable-sidebar-section { margin: 0 0 10px !important; padding: 14px 16px 16px !important; border-radius: 16px; }
        elm-review-queue-filters-sidebar bolt-stackable-sidebar-section .title { margin: 0 0 12px !important; }
        elm-review-queue-filters-sidebar bolt-stackable-sidebar-section .title-content { display: flex !important; align-items: baseline !important; gap: 8px !important; min-width: 0; }
        elm-review-queue-filters-sidebar bolt-stackable-sidebar-section .title-content h3 { flex: 0 0 auto; }
        elm-review-queue-filters-sidebar bolt-stackable-sidebar-section .description { margin: 0 !important; flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        elm-review-queue-filters-sidebar bolt-fields { gap: 14px !important; }
        elm-review-queue-filters-sidebar bolt-fields, elm-review-queue-filters-sidebar bolt-field, elm-review-queue-filters-sidebar bolt-stackable-sidebar-section-content { border: none !important; box-shadow: none !important; background: transparent !important; }
        elm-review-queue-filters-sidebar bolt-field { display: grid !important; grid-template-columns: 132px minmax(0, 1fr); align-items: center !important; column-gap: 8px !important; row-gap: 0 !important; }
        elm-review-queue-filters-sidebar .bolt-chip-list-wrapper { gap: 8px !important; }
        elm-review-queue-filters-sidebar bolt-chip-check.bolt-chip { height: 32px !important; padding: 0 12px !important; font-size: 14px !important; }
        elm-review-queue-filters-sidebar .bolt-field-range-controls { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important; gap: 12px !important; }
        elm-review-queue-filters-sidebar .bolt-field-range-controls bolt-form-field,
        elm-review-queue-filters-sidebar .bolt-field-range-controls .bolt-form-field-wrapper,
        elm-review-queue-filters-sidebar .bolt-field-range-controls .bolt-form-field-input-wrapper,
        elm-review-queue-filters-sidebar .bolt-field-range-controls .bolt-form-field-infix { min-width: 0 !important; width: auto !important; max-width: 100% !important; }
        elm-review-queue-filters-sidebar bolt-field .bolt-field-input { min-width: 0 !important; }
        elm-review-queue-filters-sidebar .bolt-field-range-controls bolt-label { text-transform: none !important; }
        elm-review-queue-filters-sidebar .bolt-field-range-controls .bolt-form-field-wrapper { display: flex !important; align-items: center !important; gap: 6px !important; }
        elm-review-queue-filters-sidebar .bolt-field-range-controls .bolt-form-field-label-wrapper { margin: 0 !important; flex: 0 0 auto; }
        elm-review-queue-filters-sidebar .bolt-field-range-controls .bolt-form-field-input-wrapper { flex: 1 1 auto; min-width: 0; }
        elm-review-queue-filters-sidebar input[boltinput][type="date"] { height: 40px; padding: 0 12px; font-size: 14px; }
        elm-review-queue-filters-sidebar input[boltinput][type="date"]:focus { padding: 0 11px; }
        .elm2-pager { display: inline-flex; align-items: center; gap: 8px; margin-right: 12px; font: 400 14px/20px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; color: var(--md-on-surface-variant); }
        .elm2-pager label { display: inline-flex; align-items: center; gap: 6px; }
        .elm2-pager-input { box-sizing: border-box; width: 64px; height: 32px; padding: 0 8px; border: 1px solid var(--md-outline); border-radius: 8px; background: transparent; color: var(--md-on-surface); font: inherit; text-align: center; }
        .elm2-pager-input:hover { border-color: var(--md-on-surface); }
        .elm2-pager-input:focus { outline: none; border: 2px solid var(--md-primary); padding: 0 7px; }
        .elm2-pager .elm2-pager-go { height: 32px; padding: 0 16px; border: none; border-radius: 16px; background: var(--md-primary-container); color: var(--md-on-primary-container); font-family: inherit; font-weight: 500; font-size: 14px; line-height: 20px; cursor: pointer; transition: box-shadow .2s var(--md-ease); }
        .elm2-pager .elm2-pager-go:hover { box-shadow: var(--md-elev-1); }
        #elm2-pick-compare-bar {
            display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
            padding: 12px 16px; margin: 0 0 12px;
            background: var(--md-surface-container); border: none; border-radius: 12px;
            font-family: 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }
        #elm2-pick-compare-count { font-size: 14px; line-height: 20px; letter-spacing: .25px; color: var(--md-on-surface-variant); flex: 1 1 auto; min-width: 160px; }
        #elm2-pick-compare-bar button {
            height: 40px; padding: 0 24px; border-radius: 20px; box-sizing: border-box;
            background: transparent; border: 1px solid var(--md-outline); color: var(--md-primary);
            font: 500 14px/20px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; letter-spacing: .1px;
            cursor: pointer; transition: background-color .2s var(--md-ease);
        }
        #elm2-pick-compare-bar #elm2-use-ai-btn { border-color: var(--elm2-bolt-blue, #1976d2); color: var(--elm2-bolt-blue, #1976d2); }
        #elm2-pick-compare-bar #elm2-use-ai-btn:hover { background: rgba(25, 118, 210, 0.08); background: color-mix(in srgb, var(--elm2-bolt-blue, #1976d2) 8%, transparent); }
        #elm2-pick-compare-bar #elm2-use-script-btn { border-color: #ef6c00; color: #ef6c00; }
        #elm2-pick-compare-bar #elm2-use-script-btn:hover { background: rgba(239, 108, 0, 0.08); }
        #elm2-pick-compare-bar button:active { background-color: rgba(0, 0, 0, 0.1); }
        #elm2-pick-compare-bar button:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
        #elm2-pick-compare-bar button:disabled { opacity: .38; cursor: default; background: transparent; }
        /* --- Pick comparison colors (light semi-transparent fill + saturated border,
               replacing Element451's own blue; its overlay pseudo-elements are hidden).
               Agreement row: the value both agreed on stays green (even if you then select the other one,
               which just gets Element451's normal blue).
               Conflict row (our pick differs from Bolt's): the two values are colored by
               who picked them — Element451's blue = Bolt's pick, orange = ours.
               Rows where our rules have no opinion keep Element451's default styling. --- */
        body .diff-row button.diff-value-button.elm2-agree-pick {
            background: rgba(67, 160, 71, 0.22) !important;
            border: 2px solid #2e7d32 !important;
            box-shadow: none !important;
            outline: none !important;
            color: #212121 !important;
        }
        body .diff-row button.diff-value-button.elm2-agree-pick * {
            background: transparent !important;
            color: #212121 !important;
        }
        body .diff-row button.diff-value-button.elm2-agree-pick::before,
        body .diff-row button.diff-value-button.elm2-agree-pick::after {
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
        /* Hover preview of "Use Bolt AI picks" / "Use our picks": on the rows that button would
               change, every value is neutral and the value it would select gets the blue
               highlight (the green / blue / orange pick colours are hidden meanwhile). */
        body.elm2-previewing .diff-row.elm2-preview-row button.diff-value-button {
            background: transparent !important;
            border: 2px solid rgba(0, 0, 0, 0.12) !important;
            box-shadow: none !important;
            outline: none !important;
            color: #212121 !important;
        }
        body.elm2-previewing .diff-row.elm2-preview-row button.diff-value-button * { background: transparent !important; color: #212121 !important; }
        body.elm2-previewing .diff-row.elm2-preview-row button.diff-value-button::before,
        body.elm2-previewing .diff-row.elm2-preview-row button.diff-value-button::after {
            background: transparent !important; box-shadow: none !important; opacity: 0 !important;
        }
        body.elm2-previewing .diff-row.elm2-preview-row button.diff-value-button.elm2-preview-pick {
            background: rgba(25, 118, 210, 0.22) !important;
            background: color-mix(in srgb, var(--elm2-bolt-blue, #1976d2) 22%, transparent) !important;
            border: 2px solid var(--elm2-bolt-blue, #1976d2) !important;
        }
        /* Applicant side (Application / Cal State Apply entries): when found, the
               "follow the applicant" rule drives the picks, so mark that contact's card. */
        .contact-card.elm2-applicant-card {
            background-color: #fff9c4 !important;
            outline: 3px solid #f9a825;
            outline-offset: -3px;
        }
        #elm2-applicant-outline {
            position: absolute;
            box-sizing: border-box;
            border: 2px solid #f9a825;
            border-radius: 4px;
            pointer-events: none;
            z-index: 2;
        }
        /* --- Material 3 style "Hide matching items" switch.
               40x24 pill track; off = outlined track with a small 12px thumb,
               on = filled track with an 18px white thumb and a check mark.
               Element451's own MDC track/thumb internals are hidden and the visuals are
               drawn with the button's pseudo-elements; the button itself (click, keyboard,
               aria) is untouched. --- */
        bolt-slide-toggle.hide-matching-items-toggle button.mdc-switch {
            position: relative !important;
            width: 40px !important;
            min-width: 40px !important;
            height: 24px !important;
            padding: 0 !important;
            box-sizing: border-box !important;
            border-radius: 12px !important;
            border: 2px solid #73777f !important;
            background: #e6e1db !important;
            transition: background-color 0.2s, border-color 0.2s;
        }
        bolt-slide-toggle.hide-matching-items-toggle button.mdc-switch.mdc-switch--selected {
            background: var(--md-primary) !important;
            border-color: var(--md-primary) !important;
        }
        bolt-slide-toggle.hide-matching-items-toggle button.mdc-switch .mdc-switch__track,
        bolt-slide-toggle.hide-matching-items-toggle button.mdc-switch .mdc-switch__handle-track {
            display: none !important;
        }
        bolt-slide-toggle.hide-matching-items-toggle button.mdc-switch::before {
            content: "";
            position: absolute;
            top: 50%;
            left: 4px;
            width: 12px;
            height: 12px;
            margin-top: -6px;
            border-radius: 50%;
            background: #73777f;
            transition: left 0.2s, width 0.2s, height 0.2s, margin-top 0.2s, background-color 0.2s;
        }
        bolt-slide-toggle.hide-matching-items-toggle button.mdc-switch.mdc-switch--selected::before {
            left: 17px;
            width: 18px;
            height: 18px;
            margin-top: -9px;
            background: #fff;
        }
        bolt-slide-toggle.hide-matching-items-toggle button.mdc-switch.mdc-switch--selected::after {
            content: "";
            position: absolute;
            left: 24px;
            top: 4px;
            width: 4px;
            height: 8px;
            border: solid var(--md-primary);
            border-width: 0 2px 2px 0;
            transform: rotate(45deg);
        }
        /* Score chips: Medium and Low get the same solid look as High (which is left
               exactly as Element451 draws it), in orange and red. Element451 sets each
               level's fill with its own !important rule, so these selectors are
               deliberately far more specific than that (the repeated
               class only raises specificity). */
        html body elm-deduplication-score-chip bolt-chip.score-chip.score-chip.score-chip.score-chip.score-chip.score-chip.score-chip.score-chip.score-chip-medium {
            background-color: #ef6c00 !important;
            border-color: #ef6c00 !important;
            color: #fff !important;
        }
        html body elm-deduplication-score-chip bolt-chip.score-chip.score-chip.score-chip.score-chip.score-chip.score-chip.score-chip.score-chip.score-chip-low {
            background-color: #d32f2f !important;
            border-color: #d32f2f !important;
            color: #fff !important;
        }
        html body elm-deduplication-score-chip bolt-chip.score-chip.score-chip.score-chip.score-chip.score-chip.score-chip.score-chip.score-chip.score-chip-medium .bolt-chip-text,
        html body elm-deduplication-score-chip bolt-chip.score-chip.score-chip.score-chip.score-chip.score-chip.score-chip.score-chip.score-chip.score-chip-low .bolt-chip-text {
            color: #fff !important;
        }
        bolt-slide-toggle.hide-matching-items-toggle label.mdc-label {
            margin-left: 12px !important;
            padding-left: 0 !important;
        }
        /* Pin the Previous / position / Next bar to the top of the review panel while the
               field list scrolls. --elm2-nav-top leaves room for Element451's own title bar
               when that is sticky too. */
        .review-queue-nav {
            position: sticky !important;
            top: var(--elm2-nav-top, 0px);
            z-index: 20;
            background: #fff;
            box-shadow: 0 1px 0 rgba(0, 0, 0, 0.08);
        }
        /* --- Merge counter / settings pane (unchanged from classic script; the
               top navbar — .bolt-navigation-right / elm-universal-search — was not
               redesigned) --- */
        #elm-controls-wrapper { display: flex; align-items: center; gap: 12px; margin-right: 16px; position: relative; }
        /* tonal assist-chip style pill (merge counter; the DB badge in csv-database-v2 matches) */
        #elm-counter-wrapper { display: flex; align-items: center; gap: 4px; height: 32px; box-sizing: border-box; padding: 0 4px 0 12px; background: var(--md-surface-container-highest); border: none; border-radius: 8px; }
        #elm-merge-counter { font: 500 14px/20px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; letter-spacing: .1px; color: var(--md-on-surface); padding: 0; white-space: nowrap; }
        #elm-reset-btn { width: 24px; height: 24px; padding: 0; display: flex; align-items: center; justify-content: center; background: transparent; border: none; border-radius: 50%; color: var(--md-on-surface-variant); cursor: pointer; font-size: 16px; line-height: 1; transition: background-color .2s var(--md-ease), color .2s var(--md-ease); }
        #elm-reset-btn:hover { color: var(--md-error); background-color: rgba(179, 38, 30, .08); }
        /* standard icon button (40px, state layer) */
        #elm-settings-btn { width: 40px; height: 40px; padding: 0; display: flex; align-items: center; justify-content: center; background: transparent; border: none; border-radius: 50%; color: #fff; cursor: pointer; font-size: 22px; line-height: 1; transition: background-color .2s var(--md-ease); }
        #elm-settings-btn:hover { background-color: rgba(255, 255, 255, .12); }
        #elm-settings-btn:active { background-color: rgba(255, 255, 255, .18); }
        #elm-settings-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
        /* modal side sheet */
        #elm-settings-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, .32); z-index: 9998; }
        #elm-settings-overlay.open { display: block; }
        #elm-settings-pane { position: fixed; top: 0; right: -400px; width: 360px; max-width: 100vw; height: 100%; box-sizing: border-box; background: var(--md-surface-container-low); color: var(--md-on-surface); border-radius: 28px 0 0 28px; box-shadow: var(--md-elev-3); z-index: 9999; transition: right .3s var(--md-ease); overflow-y: auto; font-family: 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; }
        #elm-settings-pane.open { right: 0; }
        #elm-settings-pane .settings-header { padding: 24px 16px 16px 24px; display: flex; justify-content: space-between; align-items: flex-start; }
        #elm-settings-pane .settings-title { font-size: 22px; line-height: 28px; font-weight: 400; }
        #elm-settings-pane .settings-build { font-size: 12px; line-height: 16px; letter-spacing: .5px; color: var(--md-on-surface-variant); }
        #elm-settings-close { width: 40px; height: 40px; padding: 0; display: flex; align-items: center; justify-content: center; background: transparent; border: none; border-radius: 50%; color: var(--md-on-surface-variant); font-size: 24px; line-height: 1; cursor: pointer; transition: background-color .2s var(--md-ease); }
        #elm-settings-close:hover { background-color: rgba(29, 27, 32, .08); }
        #elm-settings-close:focus-visible { outline: 2px solid var(--md-primary); }
        #elm-settings-pane .settings-body { padding: 0 24px 24px; }
        #elm-settings-pane .settings-section-title { font-size: 14px; line-height: 20px; font-weight: 500; letter-spacing: .1px; color: var(--md-primary-text); text-transform: none; margin: 24px 0 4px; }
        #elm-settings-pane .setting-row { display: flex; justify-content: space-between; align-items: center; min-height: 56px; padding: 8px 0; border: none; gap: 16px; }
        #elm-settings-pane .setting-row label { font-size: 16px; line-height: 24px; letter-spacing: .5px; color: var(--md-on-surface); }
        /* outlined select */
        #elm-settings-pane select, #elm-settings-pane input[type=number] { height: 40px; padding: 0 12px; box-sizing: border-box; background: transparent; color: var(--md-on-surface); border: 1px solid var(--md-outline); border-radius: 8px; font: 400 14px/20px 'Source Sans Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif; }
        #elm-settings-pane select:hover { border-color: var(--md-on-surface); }
        #elm-settings-pane select:focus { outline: none; border: 2px solid var(--md-primary); padding: 0 11px; }
        /* Material 3 style switches for the settings pane (same look as the restyled
               "Hide matching items" toggle): 40x24 pill, small thumb off, filled track
               with a white check thumb on. */
        .elm-toggle-switch { position: relative; width: 40px; height: 24px; flex-shrink: 0; }
        .elm-toggle-switch input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; z-index: 1; }
        .elm-toggle-slider {
            position: absolute; inset: 0; box-sizing: border-box;
            border: 2px solid #73777f; border-radius: 12px; background: #e6e1db;
            transition: background-color 0.2s, border-color 0.2s;
        }
        .elm-toggle-slider::before {
            content: ""; position: absolute; top: 50%; left: 4px;
            width: 12px; height: 12px; margin-top: -6px; border-radius: 50%; background: #73777f;
            transition: left 0.2s, width 0.2s, height 0.2s, margin-top 0.2s, background-color 0.2s;
        }
        .elm-toggle-switch input:checked + .elm-toggle-slider {
            background: var(--md-primary); border-color: var(--md-primary);
        }
        .elm-toggle-switch input:checked + .elm-toggle-slider::before {
            left: 17px; width: 18px; height: 18px; margin-top: -9px; background: #fff;
        }
        .elm-toggle-switch input:checked + .elm-toggle-slider::after {
            content: ""; position: absolute; left: 24px; top: 4px; width: 4px; height: 8px;
            border: solid var(--md-primary); border-width: 0 2px 2px 0; transform: rotate(45deg);
        }
        /* M3 discrete slider (Auto-Apply level): 16px rounded track split by a 4px pill handle
               with a 6px gap either side, stop dots on the track, a value bubble while
               focused/pressed. The real <input type=range> sits on top, invisible, so
               dragging, clicking and keyboard use are native. */
        #elm-settings-pane .elm-slider-head { min-height: 40px; }
        #elm-settings-pane .setting-row.elm-seg-head { min-height: 32px; padding-bottom: 0; }
        #elm-settings-pane .elm-level-label { font-size: 14px; font-weight: 500; letter-spacing: .1px; color: var(--md-primary-text); }
        #elm-settings-pane .elm-slider { padding: 22px 2px 12px; }
        #elm-settings-pane .m3s { position: relative; height: 44px; --p: 0; --gap: 6px; }
        #elm-settings-pane .m3s input[type=range] { -webkit-appearance: none; appearance: none; position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; z-index: 3; }
        #elm-settings-pane .m3s input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 4px; height: 44px; }
        #elm-settings-pane .m3s input[type=range]::-moz-range-thumb { width: 4px; height: 44px; border: none; }
        #elm-settings-pane .m3s-active, #elm-settings-pane .m3s-inactive { position: absolute; top: 14px; height: 16px; transition: width .2s var(--md-ease), left .2s var(--md-ease); }
        #elm-settings-pane .m3s-active { left: 0; width: max(0px, calc((100% - 4px) * var(--p) - var(--gap))); background: var(--md-primary); border-radius: 8px 2px 2px 8px; }
        #elm-settings-pane .m3s-inactive { right: 0; left: calc((100% - 4px) * var(--p) + 4px + var(--gap)); background: var(--md-primary-track); border-radius: 2px 8px 8px 2px; }
        #elm-settings-pane .m3s-dots span { position: absolute; top: 20px; width: 4px; height: 4px; border-radius: 50%; left: calc(6px + (100% - 16px) * var(--i) / 5); }
        #elm-settings-pane .m3s-dots span.on { background: #fff; }
        #elm-settings-pane .m3s-dots span.off { background: var(--md-primary); }
        #elm-settings-pane .m3s-dots span.here { display: none; }
        #elm-settings-pane .m3s-handle { position: absolute; top: 0; width: 4px; height: 44px; border-radius: 2px; background: var(--md-primary); left: calc((100% - 4px) * var(--p)); pointer-events: none; z-index: 2; transition: left .2s var(--md-ease), width .15s var(--md-ease); }
        #elm-settings-pane .m3s input[type=range]:active ~ .m3s-handle { width: 2px; margin-left: 1px; }
        #elm-settings-pane .m3s-bubble { position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); background: #2f3236; color: #f1f3f7; font-size: 12px; line-height: 16px; letter-spacing: .4px; padding: 6px 12px; border-radius: 16px; white-space: nowrap; opacity: 0; transition: opacity .15s var(--md-ease); }
        #elm-settings-pane .m3s input[type=range]:focus-visible ~ .m3s-handle .m3s-bubble,
        #elm-settings-pane .m3s input[type=range]:active ~ .m3s-handle .m3s-bubble { opacity: 1; }
        #elm-settings-pane .m3s-labels { position: relative; height: 16px; margin-top: 4px; font-size: 12px; line-height: 16px; letter-spacing: .4px; color: var(--md-on-surface-variant); }
        #elm-settings-pane .m3s-labels span { position: absolute; top: 0; white-space: nowrap; left: calc((100% - 4px) * var(--i) / 5 + 2px); transform: translateX(-50%); transition: color .2s var(--md-ease); }
        #elm-settings-pane .m3s-labels span:first-child { left: 0; transform: none; }
        #elm-settings-pane .m3s-labels span:last-child { left: 100%; transform: translateX(-100%); }
        #elm-settings-pane .m3s-labels span.sel { color: var(--md-primary-text); font-weight: 500; }
        #elm-settings-pane .elm-seg { display: flex; height: 40px; margin: 4px 0 8px; border: 1px solid var(--md-outline); border-radius: 20px; overflow: hidden; }
        #elm-settings-pane .elm-seg button { flex: 1; display: flex; align-items: center; justify-content: center; border: none; border-left: 1px solid var(--md-outline); background: transparent; color: var(--md-on-surface); font-family: inherit; font-weight: 500; font-size: 14px; line-height: 20px; letter-spacing: .1px; cursor: pointer; transition: background-color .2s var(--md-ease); }
        #elm-settings-pane .elm-seg.elm-seg-disabled { opacity: .38; }
        #elm-settings-pane .elm-seg button:disabled { cursor: default; }
        #elm-settings-pane .elm-seg button:first-child { border-left: none; }
        #elm-settings-pane .elm-seg button:hover { background: rgba(0, 0, 0, .06); }
        #elm-settings-pane .elm-seg button[aria-checked="true"] { background: var(--md-primary-container); color: var(--md-on-primary-container); }
        #elm-settings-pane .elm-seg button[aria-checked="true"]::before { content: ''; width: 10px; height: 5px; margin: -3px 8px 0 0; border-left: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(-45deg); }
        #elm-settings-pane #elm-when-done-desc { min-height: 54px; }
        #elm-settings-pane .elm-level-desc { min-height: 36px; /* two lines reserved so the controls below do not jump */ font-size: 13px; line-height: 18px; letter-spacing: .25px; color: var(--md-on-surface-variant); margin: 0 0 8px; }
        .elm-toggle-switch input:focus-visible + .elm-toggle-slider { outline: 2px solid var(--md-primary); outline-offset: 2px; }
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
        const labelCounts = {};
        return Array.from(form.querySelectorAll('.diff-row')).map(row => {
            const buttons = row.querySelectorAll(':scope > .diff-value-button');
            const titleEl = row.querySelector(':scope > .diff-title');
            const label = titleEl ? titleEl.textContent.trim() : '';
            const leftBtn = buttons[0] || null;
            const rightBtn = buttons[1] || null;
            const leftText = leftBtn ? leftBtn.textContent.trim() : '';
            const rightText = rightBtn ? rightBtn.textContent.trim() : '';
            const norm = (t) => t.toLowerCase().replace(/\s+/g, ' ').trim();
            // Which side Element451 itself has selected. Bolt AI marks its default
            // pick on the "Keep Contact A/B" arrow buttons (and a user overrides it by
            // clicking an arrow), so the arrows are the primary signal; the value
            // buttons' aria-checked/diff-option-selected are only a fallback.
            const isSel = (b) => !!b && (b.getAttribute('aria-checked') === 'true' || b.classList.contains('diff-option-selected'));
            const arrowA = row.querySelector(':scope > .diff-actions > .diff-action-button[title="Keep Contact A"]');
            const arrowB = row.querySelector(':scope > .diff-actions > .diff-action-button[title="Keep Contact B"]');
            const nativeSide = (isSel(arrowA) && !isSel(arrowB)) ? 'left'
                : (isSel(arrowB) && !isSel(arrowA)) ? 'right'
                : isSel(leftBtn) ? 'left' : isSel(rightBtn) ? 'right' : null;
            // Stable identity for this row within the current pair (survives
            // Element451 re-rendering the DOM node): field label + nth occurrence + both values.
            const occ = labelCounts[label] = (labelCounts[label] || 0) + 1;
            return {
                element: row,
                key: `${label}#${occ}|${norm(leftText)}|${norm(rightText)}`,
                label,
                nativeSide,
                // Element451 doesn't flag conflicting rows (it just hides matching
                // ones), so we detect them ourselves: the two sides differ.
                isConflict: norm(leftText) !== norm(rightText),
                textContent: `${label} ${leftText} ${rightText}`,
                values: [{ textContent: leftText }, { textContent: rightText }],
                leftSelected: !!(leftBtn && leftBtn.classList.contains('diff-option-selected')),
                rightSelected: !!(rightBtn && rightBtn.classList.contains('diff-option-selected')),
                selectSide(side) {
                    const arrow = side === 'left' ? arrowA : arrowB;
                    const value = side === 'left' ? leftBtn : rightBtn;
                    if (isSel(arrow) || (!arrow && isSel(value))) return; // already selected
                    // The arrows are the real control; fall back to the value button
                    // if clicking the arrow didn't register.
                    if (arrow) {
                        arrow.click();
                        if (value) setTimeout(() => { if (!isSel(value) && !isSel(arrow)) value.click(); }, 80);
                    } else if (value) {
                        value.click();
                    }
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
    const ROW_STATE_KEYS = ['elm2AiSide', 'elm2AiSeen', 'elm2ScriptSide', 'elm2AutoResolved', 'elm2DualPersonal', 'elm2DualResolved', 'elm2AddressResolved'];
    // Bolt's original picks and our own picks, remembered in the script (not just
    // on the DOM nodes) for the current pair, so they survive Element451
    // re-rendering a row after the user or our script has changed the selection.
    // Entry: { ai: 'left'|'right', script: 'left'|'right', acted: bool }.
    const rowMemory = new Map();
    let memoryPairKey = '';
    function rememberRow(key, patch) {
        rowMemory.set(key, Object.assign(rowMemory.get(key) || {}, patch));
    }
    function resetStaleRows() {
        const pairKey = getPairKey();
        if (!pairKey) return;
        if (memoryPairKey !== pairKey) { rowMemory.clear(); memoryPairKey = pairKey; }
        getDiffRows().forEach(row => {
            const el = row.element;
            if (el.dataset.elm2Pair !== pairKey) {
                ROW_STATE_KEYS.forEach(k => delete el.dataset[k]);
                el.classList.remove('elm2-blocked-row');
                el.removeAttribute('title');
                el.querySelectorAll(':scope > .diff-value-button').forEach(b => b.classList.remove('elm2-agree-pick', 'elm2-pick-bolt', 'elm2-pick-ours'));
                el.dataset.elm2Pair = pairKey;
            }
            const m = rowMemory.get(row.key);
            if (m) {
                if (m.ai) el.dataset.elm2AiSide = m.ai;
                if (m.script) el.dataset.elm2ScriptSide = m.script;
                if (m.rule) el.dataset.elm2Rule = m.rule;
                if (m.acted) el.dataset.elm2AiSeen = '1';
            }
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
    // =========================================================
    // LIST PAGER: "Rows" and "Page" boxes + Go, next to the paginator's range label
    // (the classic script had the same, driven by URL parameters; this UI keeps paging state in
    // Angular, so it drives the paginator itself).
    // Page jumps: (1) set the paginator component's pageIndex and emit its page event, found via the
    // element's __ngContext__ (Angular's debug API isn't exposed in production); if that component
    // can't be found, (2) click First page / Next page repeatedly, waiting for the range label.
    // Rows per page can only be set through (1).
    // =========================================================
    const PAGER_RANGE = /(\d[\d,]*)\s*[\u2013\u2014-]\s*(\d[\d,]*)\s+of\s+(\d[\d,]*)/i;
    // The MatPaginator instance is not exposed by Angular in production builds. It is reachable
    // through the DOM's __ngContext__ (an Angular "LView" array that holds the directive
    // instances of the view the element was created in): search this element's context and its
    // ancestors', also one level into any component instance found there (e.g. a parent component
    // holding the paginator as a ViewChild).
    const isPaginatorLike = (o) => !!o && typeof o === 'object' && !(o instanceof Node) &&
        typeof o.nextPage === 'function' && typeof o._emitPageEvent === 'function' && 'pageIndex' in o;
    function getPaginatorInstance(pag) {
        if (!pag) return null;
        if (pag.__elm2Paginator && isPaginatorLike(pag.__elm2Paginator)) return pag.__elm2Paginator;
        let el = pag;
        for (let depth = 0; el && depth < 10; depth++, el = el.parentElement) {
            let ctx = el.__ngContext__;
            if (ctx && !Array.isArray(ctx) && Array.isArray(ctx.lView)) ctx = ctx.lView;
            if (!Array.isArray(ctx)) continue;
            const items = ctx.length > 3000 ? ctx.slice(0, 3000) : ctx;
            for (const o of items) {
                if (isPaginatorLike(o)) { pag.__elm2Paginator = o; return o; }
            }
            for (const o of items) {
                if (!o || typeof o !== 'object' || o instanceof Node || Array.isArray(o)) continue;
                let keys;
                try { keys = Object.keys(o); } catch (e) { continue; }
                for (const k of keys.slice(0, 80)) {
                    let v; try { v = o[k]; } catch (e) { continue; }
                    if (isPaginatorLike(v)) { pag.__elm2Paginator = v; return v; }
                }
            }
        }
        return null;
    }
    // For the console when the component can't be found: what the context looks like (no data).
    function describePaginatorContext(pag) {
        const ctx = pag && pag.__ngContext__;
        const out = { ctxType: typeof ctx, isArray: Array.isArray(ctx), length: Array.isArray(ctx) ? ctx.length : null };
        if (Array.isArray(ctx)) {
            const names = new Set();
            ctx.forEach(o => { if (o && typeof o === 'object' && !(o instanceof Node) && !Array.isArray(o) && o.constructor && o.constructor.name) names.add(o.constructor.name); });
            out.constructors = Array.from(names).slice(0, 40);
            out.withPageIndex = ctx.filter(o => o && typeof o === 'object' && 'pageIndex' in o).length;
        }
        return out;
    }
    const rangeLabelText = (pag) => ((pag.querySelector('.mat-mdc-paginator-range-label') || {}).textContent || '').trim();
    function readPagerState(pag) {
        const m = rangeLabelText(pag).replace(/\u00a0/g, ' ').match(PAGER_RANGE);
        if (!m) return null;
        const num = (t) => parseInt(t.replace(/,/g, ''), 10);
        const start = num(m[1]), end = num(m[2]), total = num(m[3]);
        const inst = getPaginatorInstance(pag);
        const size = (inst && inst.pageSize) || Math.max(1, end - start + 1);
        return { start, end, total, size, index: Math.floor((start - 1) / size), pages: Math.max(1, Math.ceil(total / size)) };
    }
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    async function waitForRangeChange(pag, before, ms) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { if (rangeLabelText(pag) !== before) return true; await sleep(100); }
        return false;
    }
    async function pagerGoToPage(pag, page) {
        const st = readPagerState(pag);
        if (!st) return;
        const target = Math.max(0, Math.min(st.pages - 1, page - 1));
        if (target === st.index) return;
        const inst = getPaginatorInstance(pag);
        if (inst) {
            console.log('[elm2] page jump: direct (paginator component found)');
            const prev = inst.pageIndex;
            inst.pageIndex = target;
            inst._emitPageEvent(prev);
            return;
        }
        console.log('[elm2] page jump: clicking First / Next (paginator component not found)');
        // Fallback: walk with the real buttons.
        const btn = (name) => pag.querySelector('button[aria-label="' + name + '"]:not([disabled]):not([aria-disabled="true"])');
        let cur = st.index;
        const click = async (b) => { const before = rangeLabelText(pag); b.click(); return waitForRangeChange(pag, before, 4000); };
        if (target === 0) { const b = btn('First page'); if (b) await click(b); return; }
        if (target < cur) { const b = btn('First page'); if (!b || !(await click(b))) return; cur = 0; }
        showMergeNotice('Going to page ' + (target + 1) + '…');
        while (cur < target) { const b = btn('Next page'); if (!b || !(await click(b))) break; cur++; }
    }
    // Returns true if the page size change was handed to the paginator.
    async function pagerSetRows(pag, rows) {
        const inst = getPaginatorInstance(pag);
        const before = rangeLabelText(pag);
        const info = { foundComponent: !!inst, hasChangePageSize: !!(inst && typeof inst._changePageSize === 'function'),
            sizeBefore: inst && inst.pageSize, options: inst && inst.pageSizeOptions, requested: rows };
        if (!inst || !info.hasChangePageSize) {
            console.log('[elm2] rows per page: not possible', JSON.stringify(Object.assign(info, { context: describePaginatorContext(pag) })));
            showMergeNotice('Rows per page can’t be changed here.');
            return false;
        }
        inst._changePageSize(Math.max(1, Math.min(500, rows)));
        const changed = await waitForRangeChange(pag, before, 3500);
        console.log('[elm2] rows per page:', JSON.stringify(Object.assign(info, { sizeAfter: inst.pageSize, labelChanged: changed, labelBefore: before, labelAfter: rangeLabelText(pag) })));
        if (!changed) showMergeNotice('Rows per page didn’t change — the list ignored the new size.');
        return true;
    }
    function injectPagerInto(pag) {
        const label = pag.querySelector('.mat-mdc-paginator-range-label');
        if (!label) return;
        let box = pag.querySelector('.elm2-pager');
        if (!box) {
            // Rows: our input replaces the "50" text (hidden, not removed, so Angular's bindings stay intact).
            const valueEl = pag.querySelector('.mat-mdc-paginator-page-size-value');
            const rowsEl = document.createElement('input');
            rowsEl.type = 'number'; rowsEl.min = '1'; rowsEl.max = '500';
            rowsEl.className = 'elm2-pager-input elm2-pager-rows';
            rowsEl.setAttribute('aria-label', 'Rows per page');
            if (valueEl) { valueEl.style.display = 'none'; valueEl.insertAdjacentElement('afterend', rowsEl); }
            else { const sz = pag.querySelector('.mat-mdc-paginator-page-size'); if (sz) sz.appendChild(rowsEl); }
            // Page: [n] of N + Go, just before the range label.
            box = document.createElement('div');
            box.className = 'elm2-pager';
            box.innerHTML = '<label>Page <input type="number" min="1" class="elm2-pager-input elm2-pager-page" aria-label="Page"></label>' +
                '<span class="elm2-pager-total"></span><button type="button" class="elm2-pager-go">Go</button>';
            label.parentElement.insertBefore(box, label);
            const pageEl = box.querySelector('.elm2-pager-page');
            const go = async () => {
                const st = readPagerState(pag) || {};
                const rows = parseInt(rowsEl.value, 10);
                const page = parseInt(pageEl.value, 10);
                if (rows > 0 && rows !== st.size) {
                    const ok = await pagerSetRows(pag, rows);
                    if (!ok) return;
                }
                if (page > 0) pagerGoToPage(pag, page);
            };
            box.querySelector('.elm2-pager-go').addEventListener('click', go);
            const onEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
            box.addEventListener('keydown', onEnter);
            rowsEl.addEventListener('keydown', onEnter);
        }
        const st = readPagerState(pag);
        if (!st) return;
        const rowsEl = pag.querySelector('.elm2-pager-rows'), pageEl = box.querySelector('.elm2-pager-page');
        if (rowsEl && document.activeElement !== rowsEl) rowsEl.value = String(st.size);
        if (document.activeElement !== pageEl) pageEl.value = String(st.index + 1);
        pageEl.max = String(st.pages);
        box.querySelector('.elm2-pager-total').textContent = 'of ' + st.pages;
    }
    function injectPager() { document.querySelectorAll('mat-paginator').forEach(injectPagerInto); }
    // Element451's orange header colour, read from the header bar itself, for our own UI accents.
    function syncHeaderColor() {
        let el = document.querySelector('.bolt-navigation-right');
        while (el && el !== document.documentElement) {
            const c = getComputedStyle(el).backgroundColor;
            const m = c.match(/rgba?\(([^)]+)\)/);
            if (m) {
                const [r, g, b, a = 1] = m[1].split(',').map(parseFloat);
                // opaque and not white/near-white/grey: that is the header colour
                if (a > 0.9 && Math.max(r, g, b) - Math.min(r, g, b) > 40) {
                    document.documentElement.style.setProperty('--elm2-header-color', c);
                    return;
                }
            }
            el = el.parentElement;
        }
    }
    // Records the side Bolt had pre-selected before our script touched the
    // row, the first time each row is seen (idempotent — a no-op on rows
    // already stamped). Must run before runAutoResolution() so it captures
    // Bolt's actual default rather than our own prior click.
    function snapshotNativeSelections() {
        getDiffRows().forEach(row => {
            const d = row.element.dataset;
            if (d.elm2AiSide || d.elm2AiSeen) return; // already captured, or we've already acted on this row
            if (row.nativeSide) { d.elm2AiSide = row.nativeSide; rememberRow(row.key, { ai: row.nativeSide }); }
        });
    }
    // Selects a side AND records it as our script's pick, so the AI-vs-script
    // comparison bar can show both and let a human bulk-switch between them.
    // Every resolution rule below should call this instead of row.selectSide()
    // directly.
    let currentRule = '';
    // pairInRange: whether the slider covers the pair on screen. Cumulative:
    // 1 pairs with an applicant side, 2 + Bolt score High, 3 + Medium, 4 + Low, 5 every pair.
    // autoApplyThisPair: in range AND "Use picks from" is Ours (so our picks get applied).
    let pairInRange = false;
    let autoApplyThisPair = false;
    function computeAutoApplyForPair() {
        const level = CFG.RANGE_LEVEL;
        const score = getScoreChipLevel();
        pairInRange = level >= 5
            || (level >= 1 && !!findApplicantSide())
            || (level >= 2 && score === 'high')
            || (level >= 3 && score === 'medium')
            || (level >= 4 && score === 'low');
        autoApplyThisPair = pairInRange && CFG.USE_PICKS === 'ours';
        return autoApplyThisPair;
    }
    function applyScriptPick(row, side) {
        const d = row.element.dataset;
        d.elm2Rule = currentRule;
        if (!d.elm2AiSide && !d.elm2AiSeen && row.nativeSide) { d.elm2AiSide = row.nativeSide; rememberRow(row.key, { ai: row.nativeSide }); }
        d.elm2AiSeen = '1'; // from here on, a selection on this row may be ours, not Bolt's
        d.elm2ScriptSide = side;
        rememberRow(row.key, { script: side, acted: true, rule: currentRule });
        // With Bolt's picks kept, ours only fills a row Bolt left unselected.
        const fillsGap = pairInRange && CFG.USE_PICKS === 'bolt' && !row.nativeSide;
        if (autoApplyThisPair || fillsGap) row.selectSide(side);
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
    // Merging is only ever clicked by startAutoMerge() ("When done" = Merge), after a countdown.
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
    // Skips to the next pair, but first has the CSV database script (if installed) record this
    // one, retrying for up to 3s until it confirms, so a fast skip never loses an entry.
    let skipInFlightKey = '';
    function skipToNext(reason) {
        const key = getPairKey();
        if (skipInFlightKey === key) return; // already skipping this pair
        skipInFlightKey = key;
        const startedAt = Date.now();
        let clicks = 0;
        // Next duplicate can be disabled for a moment while Element loads the following pair, so a
        // failed click is retried; a click that worked but hasn't moved on after 3s is retried too.
        const clickLoop = () => {
            if (getPairKey() !== key) { skipInFlightKey = ''; return; } // moved on
            if (clicks >= 10) {
                skipInFlightKey = '';
                console.warn('[elm2] Could not move to the next pair after', clicks, 'tries');
                showMergeNotice('Auto-skip stopped: there is no next pair to move to.');
                return;
            }
            const ok = clickNextDuplicate();
            clicks++;
            setTimeout(clickLoop, ok ? 3000 : 500);
        };
        const attempt = () => {
            if (getPairKey() !== key) { skipInFlightKey = ''; return; } // already moved on
            const detail = {};
            document.dispatchEvent(new CustomEvent('elm2-record-pair', { detail }));
            if (detail.handled && !detail.recorded && Date.now() - startedAt < 3000) { setTimeout(attempt, 250); return; }
            console.log('[elm2] Skipping to next pair:', reason);
            clickLoop();
        };
        attempt();
    }
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
    // The review queue is a single URL (.../bolt/review-queue) that never changes per
    // profile, so a pair is identified by the Spark ID of each contact, read from
    // the "Spark Id: ..." row of the diff form. Returns { a, b } (either may be '').
    function getSparkIds() {
        const re = /Spark Id:\s*([^\s,|]+)/i;
        for (const row of getDiffRows()) {
            const l = row.values[0].textContent.match(re);
            const r = row.values[1].textContent.match(re);
            if (l || r) return { a: l ? l[1] : '', b: r ? r[1] : '' };
        }
        return { a: '', b: '' };
    }

    // =========================================================
    // STATE
    // =========================================================
    let currentQueuePositionKey = '';   // "current/total" — used to detect navigation to a new pair
    let pairFirstSeenAt = 0;            // when the current pair was first seen
    let resolutionAttempted = false;    // resolution ran for the current pair
    let mergeClickPending = false;      // waiting on the two-phase verification delay
    let conflictWarningShown = false;
    let appealWarningShown = false;
    let awaitingMergeResult = false;
    let lastMergeContactNamesKey = '';

    function getPairKey() {
        // Prefer contact names (stable identity for the pair on screen); fall back
        // to the queue position counter if names aren't available yet.
        // The queue position is part of the key: consecutive pairs can have identical names, and
        // with names alone the script would think it was still on the same pair and stall.
        const names = getContactNames();
        const pos = getQueuePosition();
        if (names.length === 2 && names[0] && names[1]) return names.join('|') + (pos ? '#' + pos.current : '');
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
        // Like the classic script: with no Grad/IA row, the first row is highlighted red
        // as the marker for a blocked UnderGrad entry.
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
        const sparks = getSparkIds();
        const forbidden = blockers.some(b => b.type === 'forbidden' || b.type === 'student-id-mismatch');
        const appeal = blockers.find(b => b.type === 'appeal');
        const ignored = blockers.some(b => b.type === 'ignored');
        if (forbidden) document.body.dataset.csvDept = 'Forbidden';
        else if (appeal) document.body.dataset.csvDept = 'Appeal';
        else if (ignored) document.body.dataset.csvDept = 'Ignored';
        else document.body.dataset.csvDept = detectActualDepartment().dept;
        if (sparks.a || sparks.b) { document.body.dataset.csvSpark1 = sparks.a; document.body.dataset.csvSpark2 = sparks.b; }
        else { delete document.body.dataset.csvSpark1; delete document.body.dataset.csvSpark2; }
        // A skipped pair (Auto-Skip on) gets no popup; one left for you does.
        if (appeal && !appealWarningShown && !CFG.AUTO_SKIP_BLOCKED) {
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
        let boltFlagged = false;
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
            boltFlagged = true; // forces a warning regardless of the threshold, without inflating the count
            conflictCount++;
            conflicts.push('Bolt Analysis (flagged as different people)');
        }
        const shouldWarn = boltFlagged || conflictCount >= CONFLICT_ROW_THRESHOLD;
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
                currentRule = 'follows applicant side (Application/Cal State Apply)';
                row.element.dataset.elm2AutoResolved = 'true';
                applyScriptPick(row, applicantSide);
                return;
            }
            // One side blank ("-"), the other has data: nothing to decide, so we have no
            // opinion and leave Bolt's pick alone. Runs AFTER the applicant-side rule
            // (which outranks everything) but before the pattern rules below, so the
            // legacy default-to-left can never pick an empty side.
            const isBlank = (t) => !t || /^[-\u2013\u2014\s]+$/.test(t);
            if (isBlank(leftText) !== isBlank(rightText)) {
                row.element.dataset.elm2AutoResolved = 'true';
                return;
            }
            // Milestone type matching (no applicant context)
            currentRule = 'milestone type match -> left';
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
            currentRule = 'personal email preferred';
            if (row.label.toLowerCase().includes('email')) {
                const personalDomains = ['gmail.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'aol.com', 'me.com', 'outlook.com', 'live.com', 'msn.com', 'protonmail.com', 'proton.me'];
                const leftIsPersonal = personalDomains.some(d => leftText.toLowerCase().includes('@' + d));
                const rightIsPersonal = personalDomains.some(d => rightText.toLowerCase().includes('@' + d));
                if (leftIsPersonal && !rightIsPersonal) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'left'); return; }
                if (rightIsPersonal && !leftIsPersonal) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'right'); return; }
                if (leftIsPersonal && rightIsPersonal) { row.element.dataset.elm2AutoResolved = 'true'; row.element.dataset.elm2DualPersonal = 'true'; return; }
            }
            // csusb.major preference
            currentRule = 'csusb.major';
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
            currentRule = 'Encoura/College Board ID -> left';
            if (/Encoura Id:/i.test(leftText) && /Encoura Id:/i.test(rightText)) {
                row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'left'); return;
            }
            if (/College Board Id:/i.test(leftText) && /College Board Id:/i.test(rightText)) {
                row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'left'); return;
            }
            // csusb.school preference (Student Type rows)
            currentRule = 'csusb.school';
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
            currentRule = 'date of birth validity';
            if (row.label.toLowerCase().includes('birth')) {
                const leftYear = leftText.match(/\b(\d{4})\b/), rightYear = rightText.match(/\b(\d{4})\b/);
                const leftInvalid = leftYear && (leftYear[1].startsWith('0') || parseInt(leftYear[1]) < 1900);
                const rightInvalid = rightYear && (rightYear[1].startsWith('0') || parseInt(rightYear[1]) < 1900);
                if (leftInvalid && !rightInvalid) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'right'); return; }
                if (rightInvalid && !leftInvalid) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'left'); return; }
            }
            // First Generation Student — prefer Yes over No
            currentRule = 'first generation = yes';
            if (row.label.toLowerCase().includes('first generation')) {
                const leftYes = /\byes\b/i.test(leftText), rightYes = /\byes\b/i.test(rightText);
                const leftNo = /\bno\b/i.test(leftText), rightNo = /\bno\b/i.test(rightText);
                if (leftYes && rightNo) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'left'); return; }
                if (rightYes && leftNo) { row.element.dataset.elm2AutoResolved = 'true'; applyScriptPick(row, 'right'); return; }
            }
            // Intended Term — prefer later term code
            currentRule = 'later intended term';
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
            currentRule = 'name case';
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
            // Matches on the whole row, as in the classic script. A blank left side
            // never reaches here: the blank-side rule above picks the filled side first.
            currentRule = 'legacy default -> left';
            if (legacyPatterns.some(p => p.test(text))) {
                row.element.dataset.elm2AutoResolved = 'true';
                applyScriptPick(row, 'left');
            }
        });
    }
    // Dual-personal-email tiebreak (name/DOB-in-email). Email-open-count tier
    // dropped — no "User Activity" section found in the new layout.
    function autoDualPersonalEmails() {
        currentRule = 'dual personal email tiebreak';
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
        currentRule = 'address comparison';
        const applicantSide = findApplicantSide();
        const rows = getDiffRowsByLabel('address').filter(r => r.isConflict && !r.element.dataset.elm2AddressResolved);
        rows.forEach(row => {
            const leftText = row.values[0].textContent, rightText = row.values[1].textContent;
            if (!leftText || !rightText) return;
            row.element.dataset.elm2AddressResolved = 'true';
            if (applicantSide) { currentRule = 'follows applicant side (Application/Cal State Apply)'; applyScriptPick(row, applicantSide); return; }
            currentRule = 'address comparison';
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
        computeAutoApplyForPair();
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
        root.querySelectorAll('.elm2-agree-pick, .elm2-pick-bolt, .elm2-pick-ours').forEach(el => el.classList.remove('elm2-agree-pick', 'elm2-pick-bolt', 'elm2-pick-ours'));
    }
    // Yellow background behind the applicant side across the whole field list, as in
    // the classic layout: from the field label through that side's value and arrows,
    // including the header row. It's painted as each row's own background, so the
    // entries on top keep their green/blue/orange colors. Plus a yellow contact card.
    function clearApplicantBand() {
        document.querySelectorAll('[data-elm2-band]').forEach(el => {
            el.style.backgroundImage = '';
            el.removeAttribute('data-elm2-band');
        });
        const o = document.getElementById('elm2-applicant-outline');
        if (o) o.remove();
    }
    // Medium and Low score chips get a solid orange / red fill with white text, like High.
    // Applied as inline !important on the chip because Element451's own per-level fill
    // rules beat any stylesheet rule we can write (e.g. an !important rule inside a
    // cascade layer outranks an unlayered one regardless of specificity); inline
    // !important outranks all of them.
    function colorScoreChips() {
        const colors = { medium: '#ef6c00', low: '#d32f2f' };
        document.querySelectorAll('elm-deduplication-score-chip bolt-chip').forEach(chip => {
            const level = chip.classList.contains('score-chip-medium') ? 'medium'
                : chip.classList.contains('score-chip-low') ? 'low' : '';
            if (!level) return;
            const c = colors[level];
            chip.style.setProperty('background-color', c, 'important');
            chip.style.setProperty('border-color', c, 'important');
            chip.style.setProperty('color', '#fff', 'important');
            const label = chip.querySelector('.bolt-chip-text');
            if (label) label.style.setProperty('color', '#fff', 'important');
        });
    }
    // Keeps the pinned queue nav below Element451's own header if that is sticky/fixed.
    function pinReviewQueueNav() {
        if (!document.querySelector('.review-queue-nav')) return;
        const hdr = document.querySelector('.bolt-stackable-sidebar-header-wrapper');
        let top = 0;
        if (hdr) {
            const pos = getComputedStyle(hdr).position;
            if (pos === 'sticky' || pos === 'fixed' || pos === 'absolute') top = Math.round(hdr.getBoundingClientRect().height);
        }
        document.documentElement.style.setProperty('--elm2-nav-top', top + 'px');
    }
    // When the Auto-Apply slider is changed mid-review, apply our suggestions if the new
    // level now covers this pair (lowering it never undoes anything already applied).
    function reapplyForLevel() {
        if (!computeAutoApplyForPair()) return;
        getDiffRows().forEach(row => {
            const side = row.element.dataset.elm2ScriptSide;
            if (side) row.selectSide(side);
        });
    }
    function annotateApplicantSide() {
        document.querySelectorAll('.elm2-applicant-card').forEach(el => el.classList.remove('elm2-applicant-card'));
        if (!CFG.HIGHLIGHT_ROWS || document.body.classList.contains('elm2-blocked')) { clearApplicantBand(); return; }
        const side = findApplicantSide();
        const form = getDiffForm();
        const formEl = form ? form.querySelector('form.diff-form') : null;
        if (!side || !formEl) { clearApplicantBand(); return; }
        const card = getContactCards()[side === 'left' ? 0 : 1];
        if (card) card.classList.add('elm2-applicant-card');

        // The band ends at the applicant contact's OWN arrow button (not the whole
        // arrow group, which also contains the other contact's arrow).
        const arrowSel = side === 'left' ? '[title="Keep Contact A"]' : '[title="Keep Contact B"]';
        const ref = Array.from(formEl.querySelectorAll('.diff-row')).find(r => r.querySelector(':scope > .diff-actions > .diff-action-button' + arrowSel));
        if (!ref) { clearApplicantBand(); return; }
        const arrow = ref.querySelector(':scope > .diff-actions > .diff-action-button' + arrowSel).getBoundingClientRect();
        const pad = 10;
        const boundary = side === 'left' ? arrow.right + pad : arrow.left - pad;
        const yellow = '#fff9c4';
        const targets = Array.from(formEl.querySelectorAll('.diff-header, .diff-row')).filter(el => el.getBoundingClientRect().width);
        if (targets.length === 0) { clearApplicantBand(); return; }
        targets.forEach(el => {
            const r = el.getBoundingClientRect();
            const n = Math.round(boundary - r.left);
            const img = side === 'left'
                ? `linear-gradient(to right, ${yellow} 0, ${yellow} ${n}px, transparent ${n}px)`
                : `linear-gradient(to right, transparent ${n}px, ${yellow} ${n}px)`;
            if (el.dataset.elm2Band === side && el.style.backgroundImage === img) return;
            el.style.backgroundImage = img;
            el.dataset.elm2Band = side;
        });

        // Amber outline around the whole applicant side, from the header row to the last
        // row. Transparent inside, so it never tints the entries.
        if (getComputedStyle(formEl).position === 'static') formEl.style.position = 'relative';
        let outline = document.getElementById('elm2-applicant-outline');
        if (!outline) { outline = document.createElement('div'); outline.id = 'elm2-applicant-outline'; }
        if (outline.parentElement !== formEl) formEl.appendChild(outline);
        const formRect = formEl.getBoundingClientRect();
        const rects = targets.map(el => el.getBoundingClientRect());
        const top = Math.min(...rects.map(r => r.top));
        const bottom = Math.max(...rects.map(r => r.bottom));
        const left = side === 'left' ? Math.min(...rects.map(r => r.left)) : boundary;
        const right = side === 'left' ? boundary : Math.max(...rects.map(r => r.right));
        outline.style.left = (left - formRect.left + formEl.scrollLeft) + 'px';
        outline.style.top = (top - formRect.top + formEl.scrollTop) + 'px';
        outline.style.width = (right - left) + 'px';
        outline.style.height = (bottom - top) + 'px';
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
            // Conflict rows: color the two value buttons by who picked them.
            const btns = row.element.querySelectorAll(':scope > .diff-value-button');
            ['left', 'right'].forEach((side, idx) => {
                const btn = btns[idx];
                if (!btn) return;
                btn.classList.toggle('elm2-agree-pick', agree && ai === side);
                btn.classList.toggle('elm2-pick-bolt', conflict && ai === side);
                btn.classList.toggle('elm2-pick-ours', conflict && script === side);
            });
            if (both) {
                row.element.title = 'Our rules suggest Contact ' + label(script) + (row.element.dataset.elm2Rule ? ' (' + row.element.dataset.elm2Rule + ')' : '') + '; Bolt picked Contact ' + label(ai);
            } else {
                row.element.removeAttribute('title');
            }
        });
    }
    // Hover preview: highlights, in blue, what "Use Bolt AI picks" (elm2AiSide) or "Use our
    // picks" (elm2ScriptSide) would select. previewPicks(null) clears it.
    function previewPicks(attr) {
        if (document.body.classList.contains('elm2-blocked')) attr = null; // no preview on blocked entries
        getDiffRows().forEach(row => {
            const el = row.element;
            const side = attr ? el.dataset[attr] : null;
            el.classList.toggle('elm2-preview-row', !!side);
            el.querySelectorAll(':scope > .diff-value-button').forEach((b, i) => {
                b.classList.toggle('elm2-preview-pick', !!side && (side === 'left' ? 0 : 1) === i);
            });
        });
        document.body.classList.toggle('elm2-previewing', !!attr);
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
        if (!formEl) { if (bar) bar.remove(); previewPicks(null); return; }
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
            [['elm2-use-ai-btn', 'elm2AiSide'], ['elm2-use-script-btn', 'elm2ScriptSide']].forEach(([id, attr]) => {
                const btn = document.getElementById(id);
                btn.addEventListener('click', () => applyAllPicks(attr));
                btn.addEventListener('mouseenter', () => previewPicks(attr));
                btn.addEventListener('focus', () => previewPicks(attr));
                btn.addEventListener('mouseleave', () => previewPicks(null));
                btn.addEventListener('blur', () => previewPicks(null));
            });
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
        if (!blocked && ours.length > 0 && !autoApplyThisPair) {
            msg += CFG.RANGE_LEVEL === 0 ? ' — no pairs are in range (slider on None)' : CFG.USE_PICKS === 'bolt' ? " — using Bolt's picks" : ' — not auto-applied for this pair (outside the slider range)';
        }
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
        if (!btn.classList.contains('diff-value-button') && !/^(First|Next|Previous|Last) page$/.test(btn.getAttribute('aria-label') || '')) {
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
    // AUTO-MERGE ("When done" = Merge)
    // Merging is permanent, so it only happens after a visible countdown with a Cancel
    // button and a short written overview, and only after a final re-check that the pair
    // is still unblocked, still the same pair, and every conflicting field has a pick.
    // Dismiss is never clicked (see the click guard above).
    // =========================================================
    let mergeTimer = null;
    let mergeBarTimer = null;
    let mergedPairKey = '';
    // Notices ("Auto-merge cancelled", "Rows per page ...") use the shared toast stack that
    // csv-database-v2.js also uses for its API toast: bottom-left, newest at the bottom.
    function toastStack() {
        let st = document.getElementById('elm2-toast-stack');
        if (!st) { st = document.createElement('div'); st.id = 'elm2-toast-stack'; document.body.appendChild(st); }
        return st;
    }
    function hideMergeBar() {
        document.querySelectorAll('#elm2-toast-stack .elm2-notice').forEach(t => t.remove());
    }
    function showMergeNotice(text) {
        const st = toastStack();
        const el = document.createElement('div');
        el.className = 'elm2-toast elm2-notice';
        el.setAttribute('role', 'status');
        el.textContent = text;
        st.appendChild(el);
        requestAnimationFrame(() => el.classList.add('visible'));
        setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 250); }, 6000);
        while (st.children.length > 4) st.firstChild.remove();
    }
    // The countdown itself: a centred dialog over a dimmed page, with a draining ring around the
    // seconds left, a plain-language summary and a Cancel button. The overlay also stops stray
    // clicks while the countdown runs.
    function mergeModal() {
        let ov = document.getElementById('elm2-merge-overlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'elm2-merge-overlay';
            ov.innerHTML = `
                <div class="elm2-merge-card" role="alertdialog" aria-live="polite" aria-labelledby="elm2-merge-title" aria-describedby="elm2-merge-summary">
                    <div class="elm2-ring">
                        <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="elm2-ring-track" cx="50" cy="50" r="44"></circle><circle class="elm2-ring-arc" cx="50" cy="50" r="44"></circle></svg>
                        <span id="elm2-merge-count"></span>
                    </div>
                    <h2 id="elm2-merge-title">Merging automatically</h2>
                    <p id="elm2-merge-summary"></p>
                    <button type="button" id="elm2-merge-cancel">Cancel</button>
                </div>`;
            document.body.appendChild(ov);
            document.getElementById('elm2-merge-cancel').addEventListener('click', () => cancelAutoMerge('Auto-merge cancelled'));
        }
        return ov;
    }
    function hideMergeModal() {
        const ov = document.getElementById('elm2-merge-overlay');
        if (ov) ov.classList.remove('visible');
    }
    function cancelAutoMerge(message) {
        const wasRunning = !!mergeTimer;
        clearInterval(mergeTimer);
        mergeTimer = null;
        hideMergeModal();
        hideMergeBar();
        if (wasRunning && message) showMergeNotice(message);
    }
    // Plain-language overview of what is about to be merged.
    function mergeOverview() {
        const names = getContactNames().filter(Boolean);
        const rows = getDiffRows().filter(r => r.isConflict);
        let bolt = 0, ours = 0;
        const rules = new Set();
        rows.forEach(r => {
            const d = r.element.dataset;
            if (d.elm2ScriptSide && r.nativeSide === d.elm2ScriptSide && d.elm2ScriptSide !== d.elm2AiSide) {
                ours++;
                if (d.elm2Rule) rules.add(d.elm2Rule);
            } else bolt++;
        });
        const who = names.length === 2 ? `${names[0]} and ${names[1]}` : 'these two contacts';
        const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
        let detail;
        if (rows.length === 0) detail = 'They have no conflicting fields.';
        else {
            const ruleText = rules.size ? ' (' + Array.from(rules).slice(0, 4).join(', ') + (rules.size > 4 ? ', …' : '') + ')' : '';
            detail = `${plural(rows.length, 'field')} conflict: ${bolt} follow${bolt === 1 ? 's' : ''} Bolt's pick and ${ours} follow${ours === 1 ? 's' : ''} ours${ruleText}.`;
        }
        return `About to merge ${who}. ${detail}`;
    }
    // Final gate before the merge click. Returns { ok, reason }.
    function mergeReadiness(key) {
        if (getPairKey() !== key) return { ok: false, reason: 'the pair changed' };
        if (getAllBlockers().length > 0) return { ok: false, reason: 'the pair is blocked' };
        const unresolved = getDiffRows().filter(r => r.isConflict && !r.nativeSide).length;
        if (unresolved > 0) return { ok: false, reason: unresolved + ' field(s) have no pick' };
        if (CONFLICT_ROW_THRESHOLD > 0 && checkForConflictingRecords().shouldWarn) return { ok: false, reason: 'possible twins' };
        const btn = getSidebarActionButton('Merge Contacts');
        if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return { ok: false, reason: 'the Merge Contacts button is unavailable' };
        return { ok: true, btn };
    }
    function startAutoMerge(key) {
        if (mergedPairKey === key || getPairKey() !== key) return;
        cancelAutoMerge();
        const ov = mergeModal();
        hideMergeBar();
        const total = CFG.MERGE_COUNTDOWN;
        let left = total;
        const arc = ov.querySelector('.elm2-ring-arc');
        document.getElementById('elm2-merge-summary').textContent = mergeOverview();
        // The ring drains one step per second, in time with the number.
        const CIRC = 276.46;
        const render = () => {
            const count = document.getElementById('elm2-merge-count');
            count.textContent = String(left);
            // each new number eases in (scale + fade) while the ring eases down one step
            count.style.animation = 'none';
            void count.getBoundingClientRect();
            count.style.animation = 'elm2-count-in .5s cubic-bezier(.05, .7, .1, 1)';
            arc.style.strokeDashoffset = String(CIRC * (1 - left / total));
        };
        arc.style.transition = 'none';
        arc.style.strokeDashoffset = '0';
        void arc.getBoundingClientRect();
        arc.style.transition = '';
        render();
        ov.classList.add('visible');
        mergeTimer = setInterval(() => {
            if (getPairKey() !== key) { cancelAutoMerge(); return; }
            left--;
            if (left > 0) { render(); return; }
            clearInterval(mergeTimer);
            mergeTimer = null;
            hideMergeModal();
            const ready = mergeReadiness(key);
            if (!ready.ok) {
                console.log('[elm2] Auto-merge not done:', ready.reason);
                if (ready.reason === 'the pair changed') return;
                if (CFG.AUTO_SKIP_BLOCKED) { skipToNext('auto-merge not ready: ' + ready.reason); }
                else showMergeNotice('Auto-merge stopped: ' + ready.reason + '.');
                return;
            }
            mergedPairKey = key;
            console.log('[elm2] Auto-merging pair');
            ready.btn.click();
        }, 1000);
    }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mergeTimer) cancelAutoMerge('Auto-merge cancelled'); });

    // =========================================================
    // MAIN AUTOMATION LOOP
    //
    // Each pair: blockers -> (skip or stop) -> apply picks per "Use picks from" if the pair is
    // inside the slider range -> twins check -> optional auto-merge (cancel window above).
    // =========================================================
    function attemptAutoResolve() {
        if (!isDedupReviewPage()) return;
        if (!getContactNames().filter(Boolean).length) return; // page still loading
        resetStaleRows();
        snapshotNativeSelections(); // capture Bolt's defaults before anything below can click a row
        const pairKey = getPairKey();
        if (pairKey !== currentQueuePositionKey) {
            currentQueuePositionKey = pairKey;
            pairFirstSeenAt = Date.now();
            resolutionAttempted = false;
            conflictWarningShown = false;
            appealWarningShown = false;
            previewPicks(null);
            cancelAutoMerge();
            delete document.body.dataset.csvDept;
            delete document.body.dataset.csvSpark1;
            delete document.body.dataset.csvSpark2;
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
                setTimeout(() => skipToNext('blocked'), 1200);
            }
            return;
        }
        if (!resolutionAttempted) console.log('[elm2] Not blocked — allowed dept:', CFG.ALLOWED_DEPARTMENT, '| detected:', detectActualDepartment().dept);
        if (resolutionAttempted) return;
        // Wait for Element451 to apply its own default picks before we touch
        // anything, so we can record them first (give up after 3s in case Bolt
        // made no picks on this pair).
        const bolt = getDiffRows().filter(r => r.element.dataset.elm2AiSide).length;
        if (bolt === 0 && Date.now() - pairFirstSeenAt < 3000) return;
        // At the Low / Medium Auto-Apply levels the decision depends on Bolt's score, which can
        // render a moment after the field rows: wait for it (up to 3s) before deciding.
        const lvl = CFG.RANGE_LEVEL;
        if (lvl >= 2 && lvl < 5 && !getScoreChipLevel() && Date.now() - pairFirstSeenAt < 3000) return;
        resolutionAttempted = true;
        // Two-phase, mirroring the classic script: resolve now, then re-verify
        // shortly after in case more Workflow/Source rows loaded in the meantime.
        runAutoResolution();
        const phaseOnePairKey = pairKey;
        setTimeout(() => {
            if (getPairKey() !== phaseOnePairKey) return; // moved on already
            const laterBlockers = getAllBlockers();
            applyBlockStyling(laterBlockers);
            if (laterBlockers.length > 0) {
                if (CFG.AUTO_SKIP_BLOCKED) { skipToNext('blocked'); }
                return;
            }
            runAutoResolution();
            const _rows = getDiffRows();
            console.log('[elm2] Resolution done —', _rows.length, 'fields,',
                _rows.filter(r => r.element.dataset.elm2ScriptSide).length, 'with our suggestion,',
                _rows.filter(r => r.element.dataset.elm2AiSide).length, 'with a Bolt default captured');
            const _byRule = {};
            _rows.forEach(r => { const rl = r.element.dataset.elm2Rule; if (r.element.dataset.elm2ScriptSide) _byRule[rl || '(unknown)'] = (_byRule[rl || '(unknown)'] || 0) + 1; });
            console.log('[elm2] Suggestions by rule:', JSON.stringify(_byRule));
            computeAutoApplyForPair();
            // Outside the slider range: skipped with Auto-Skip on (no popup), otherwise left for you.
            // (Slider on None = no pair is in range, so with Auto-Skip on every pair is skipped.)
            if (!pairInRange && CFG.AUTO_SKIP_BLOCKED) {
                skipToNext('outside the slider range');
                return;
            }
            // Possible twins: with Auto-Skip on the pair is skipped with no popup; otherwise it is
            // left for you with a warning popup. A twins pair is never auto-merged.
            // (There is no separate "Low score" popup.)
            if (!conflictWarningShown && CONFLICT_ROW_THRESHOLD > 0) {
                const { conflictCount, shouldWarn, conflicts } = checkForConflictingRecords();
                if (shouldWarn) {
                    conflictWarningShown = true;
                    if (CFG.AUTO_SKIP_BLOCKED) {
                        skipToNext('possible twins: ' + conflicts.join(', '));
                    } else {
                        alert(`⚠️ Warning: ${conflictCount} conflicting signal${conflictCount === 1 ? '' : 's'} detected!\n\nConflicts found in: ${conflicts.join(', ')}\n\nThese entries might be twins or two different people. Please review carefully before merging.`);
                    }
                    return;
                }
            }
            // "When done" = Merge: start the cancel window (the merge itself is clicked there,
            // after a final safety re-check).
            if (pairInRange && CFG.WHEN_DONE === 'merge') setTimeout(() => startAutoMerge(phaseOnePairKey), 500);
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
        colorScoreChips();
        syncHeaderColor(); // the header is on every page, not just the review page
        injectPager();
        if (isDedupReviewPage()) {
            syncBoltBlue();
            annotateRowColors();
            pinReviewQueueNav();
            annotateApplicantSide();
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
        // Inline SVG (Material "settings" outlined icon, 20px): a "⚙" text glyph renders as a colour emoji on macOS
        settingsBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65A.488.488 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zm-1.98-1.71c.04.31.05.52.05.73s-.02.43-.05.73l-.14 1.13.89.7 1.08.84-.7 1.21-1.27-.51-1.04-.42-.9.68c-.43.32-.84.56-1.25.73l-1.06.43-.16 1.13-.2 1.35h-1.4l-.19-1.35-.16-1.13-1.06-.43c-.43-.18-.83-.41-1.23-.71l-.91-.7-1.06.43-1.27.51-.7-1.21 1.08-.84.89-.7-.14-1.13c-.03-.31-.05-.54-.05-.74s.02-.43.05-.73l.14-1.13-.89-.7-1.08-.84.7-1.21 1.27.51 1.04.42.9-.68c.43-.32.84-.56 1.25-.73l1.06-.43.16-1.13.2-1.35h1.39l.19 1.35.16 1.13 1.06.43c.43.18.83.41 1.23.71l.91.7 1.06-.43 1.27-.51.7 1.21-1.07.85-.89.7.14 1.13zM12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>';
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
                <div>
                    <div class="settings-title">Settings</div>
                    <div class="settings-build">New layout · ${BUILD}</div>
                </div>
                <button id="elm-settings-close" aria-label="Close settings">&times;</button>
            </div>
            <div class="settings-body">
                <div class="settings-section-title">Automation</div>
                <div class="setting-row elm-slider-head"><label>Pairs in range</label><span id="elm-apply-level-label" class="elm-level-label"></span></div>
                <div class="elm-slider">
                    <div class="m3s" id="elm-m3s">
                        <input type="range" id="elm-apply-level" min="0" max="5" step="1" aria-label="Pairs in range">
                        <div class="m3s-active"></div>
                        <div class="m3s-inactive"></div>
                        <div class="m3s-dots"><span style="--i:0"></span><span style="--i:1"></span><span style="--i:2"></span><span style="--i:3"></span><span style="--i:4"></span><span style="--i:5"></span></div>
                        <div class="m3s-handle"><span class="m3s-bubble" id="elm-m3s-bubble"></span></div>
                    </div>
                    <div class="m3s-labels"><span style="--i:0">None</span><span style="--i:1">Applicant</span><span style="--i:2">High</span><span style="--i:3">Medium</span><span style="--i:4">Low</span><span style="--i:5">All</span></div>
                </div>
                <div id="elm-apply-level-desc" class="elm-level-desc"></div>
                <div class="setting-row elm-seg-head"><label>Use picks from</label></div>
                <div class="elm-seg" id="elm-use-picks" role="radiogroup" aria-label="Use picks from">
                    <button type="button" role="radio" data-v="bolt">Bolt's</button>
                    <button type="button" role="radio" data-v="ours">Ours</button>
                </div>
                <div id="elm-use-picks-desc" class="elm-level-desc"></div>
                <div class="setting-row elm-seg-head"><label>When done</label></div>
                <div class="elm-seg" id="elm-when-done" role="radiogroup" aria-label="When done">
                    <button type="button" role="radio" data-v="wait">Wait for me</button>
                    <button type="button" role="radio" data-v="merge">Merge</button>
                </div>
                <div id="elm-when-done-desc" class="elm-level-desc"></div>
                <div class="setting-row" id="elm-countdown-row">
                    <label for="elm-merge-countdown">Merge countdown</label>
                    <select id="elm-merge-countdown">
                        <option value="2">2 seconds</option><option value="3">3 seconds</option><option value="4">4 seconds</option>
                        <option value="5">5 seconds</option><option value="6">6 seconds</option><option value="8">8 seconds</option>
                        <option value="10">10 seconds</option><option value="15">15 seconds</option>
                    </select>
                </div>
                <div class="setting-row"><label>Auto-Skip</label>${toggleHtml('elm-auto-skip-blocked')}</div>
                <div class="elm-level-desc elm-skip-desc">Skips blocked, out-of-range and possible-twins pairs with no popup. Off: stops on them instead.</div>
                <div class="settings-section-title">Display</div>
                <div class="setting-row"><label>Highlight Rows</label>${toggleHtml('elm-highlight-rows')}</div>
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
        const levelSlider = document.getElementById('elm-apply-level');
        const levelLabel = document.getElementById('elm-apply-level-label');
        const levelNames = ['None', 'Applicant', 'High', 'Medium', 'Low', 'All'];
        const levelDescs = [
            'No pairs in range. Auto-Skip on skips every pair (a scan); off leaves them for you.',
            'Only pairs that have an applicant side.',
            'Applicant pairs, plus pairs with a High Bolt score.',
            'Applicant pairs, plus High and Medium Bolt scores.',
            'Applicant pairs, plus High, Medium and Low Bolt scores.',
            'Every pair, even one with no Bolt score.'
        ];
        const syncLevel = () => {
            levelSlider.value = CFG.RANGE_LEVEL;
            const idx = parseInt(levelSlider.value, 10);
            document.getElementById('elm-m3s').style.setProperty('--p', idx / 5);
            document.querySelectorAll('#elm-m3s .m3s-dots span').forEach((d, i) => {
                d.className = i < idx ? 'on' : i > idx ? 'off' : 'here';
            });
            document.querySelectorAll('#elm-settings-pane .m3s-labels span').forEach((l, i) => l.classList.toggle('sel', i === idx));
            document.getElementById('elm-m3s-bubble').textContent = levelNames[idx];
            levelLabel.textContent = levelNames[idx];
            document.getElementById('elm-apply-level-desc').textContent = levelDescs[idx];
            // With the slider on None, "Use picks from" and "When done" have nothing to act on.
            ['elm-use-picks', 'elm-when-done'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                el.classList.toggle('elm-seg-disabled', idx === 0);
                el.querySelectorAll('button').forEach(b => { b.disabled = idx === 0; });
            });
        };
        syncLevel();
        levelSlider.addEventListener('input', () => {
            localStorage.setItem('elm_range_level', levelSlider.value);
            syncLevel();
            if (CFG.RANGE_LEVEL === 0) cancelAutoMerge('Auto-merge cancelled');
            reapplyForLevel();
        });
        function setupSegmented(id, get, set, describe, onChange) {
            const el = document.getElementById(id);
            const desc = document.getElementById(id + '-desc');
            const sync = () => {
                el.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === get())));
                desc.textContent = describe(get());
            };
            sync();
            el.addEventListener('click', (e) => {
                const b = e.target.closest('button');
                if (!b) return;
                set(b.dataset.v);
                sync();
                if (onChange) onChange();
            });
        }
        setupSegmented('elm-use-picks', () => CFG.USE_PICKS, v => localStorage.setItem('elm_use_picks', v),
            v => v === 'ours' ? 'Our rules are applied on pairs in range, including the applicant rule.' : "Bolt's picks are kept on pairs in range. Ours only fills rows Bolt left unselected.",
            reapplyForLevel);
        setupSegmented('elm-when-done', () => CFG.WHEN_DONE, v => { try { sessionStorage.setItem('elm_when_done', v); } catch (e) { /* ignore */ } },
            v => v === 'merge' ? 'Merges decided pairs after a countdown with a Cancel button. Resets to "Wait for me" each browser session.' : 'You review the picks and click Merge Contacts yourself.',
            () => { if (CFG.WHEN_DONE !== 'merge') cancelAutoMerge('Auto-merge cancelled'); });
        const countdownSelect = document.getElementById('elm-merge-countdown');
        const countdownRow = document.getElementById('elm-countdown-row');
        const syncCountdown = () => {
            // only relevant when merging is on and the slider isn't on None
            const active = CFG.WHEN_DONE === 'merge' && CFG.RANGE_LEVEL > 0;
            countdownSelect.disabled = !active;
            countdownRow.style.opacity = active ? '' : '.38';
        };
        countdownSelect.value = String(CFG.MERGE_COUNTDOWN);
        countdownSelect.addEventListener('change', () => localStorage.setItem('elm_merge_countdown', countdownSelect.value));
        document.getElementById('elm-when-done').addEventListener('click', syncCountdown);
        levelSlider.addEventListener('input', syncCountdown);
        syncLevel();
        syncCountdown();
        setupToggle('elm-auto-skip-blocked', 'elm_auto_skip_blocked');
        setupToggle('elm-highlight-rows', 'elm_highlight_rows');
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
