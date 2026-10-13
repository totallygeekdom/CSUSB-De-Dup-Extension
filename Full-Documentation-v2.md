# Element451 Deduplication (New Layout) — Full Documentation (v2)

This document covers the two v2 userscripts, which target Element451's redesigned
**Deduplication** review-queue UI, and everything they change on the Element451 website.

| Script | File | Current version |
|---|---|---|
| UI Perfection (New Deduplication Layout) | `Element451-UI-Perfection-v2.user.js` | `@version 2.102`, shown in the settings pane and console as `v2-build-102` |
| CSV Database (New Deduplication Layout) | `csv-database-v2.js` | `@version 2.21` |

The classic scripts (`Element451-UI-Perfection.user.js`, `csv-database.js`; see
`Full-Documentation-v127.0.md`) are unchanged and target the old merge page.

> **Verification status.** Most behaviour below was developed against saved HTML snapshots,
> mock pages and the user's live feedback. Items that could not be confirmed against the live
> site are listed under [Known limitations](#13-known-limitations-and-unverified-guesses).

## Table of contents

1. [Installation and versions](#1-installation-and-versions)
2. [How the new layout differs from the classic merge page](#2-how-the-new-layout-differs-from-the-classic-merge-page)
3. [Architecture](#3-architecture)
4. [Settings reference](#4-settings-reference)
5. [The per-pair workflow](#5-the-per-pair-workflow)
6. [Blockers (lockdowns)](#6-blockers-lockdowns)
7. [Field resolution rules](#7-field-resolution-rules)
8. [Warnings and popups](#8-warnings-and-popups)
9. [Auto-merge and the cancel countdown](#9-auto-merge-and-the-cancel-countdown)
10. [Visual changes to the Element451 website](#10-visual-changes-to-the-element451-website)
11. [CSV Database v2](#11-csv-database-v2)
12. [Inter-script contract, storage keys and console output](#12-inter-script-contract-storage-keys-and-console-output)
13. [Known limitations and unverified guesses](#13-known-limitations-and-unverified-guesses)
14. [Troubleshooting](#14-troubleshooting)
15. [Change history (summary)](#15-change-history-summary)

---

## 1. Installation and versions

1. Install the Tampermonkey extension.
2. Create one userscript with the contents of `Element451-UI-Perfection-v2.user.js` and, optionally, a
   second with `csv-database-v2.js`. Both match `https://*.element451.io/*` and run with
   `@grant none`, which means they run in the page's own JavaScript context (this is what lets
   the script look at Angular's internals and lets the two scripts talk to each other).
3. Do not run a classic script and its v2 counterpart on the same page, and make sure each v2 script is
   installed **once**. A duplicate or disabled install was the cause of several "bugs" during development
   (doubled popups, missing features).
4. To confirm what is running: open the gear (settings) — the header reads `New layout · v2-build-N`.
   The CSV script logs `CSV Database (new layout) vX.Y loaded` in the page console, and Tampermonkey shows
   both `@version` values.

Both scripts have `@updateURL`/`@downloadURL` pointing at the `main` branch. Builds developed on a
feature branch must be pasted manually. `@version` and the `BUILD` constant are kept in sync (build `N`
= `@version 2.N`), so Tampermonkey's update check works once a build reaches `main`.

---

## 2. How the new layout differs from the classic merge page

| Classic (old) | New layout |
|---|---|
| Full page of `elm-merge-row` rows with a floating "FAB" merge button | A review queue with a side panel holding `elm-duplicate-field-diff-form`; each field is a `.diff-row` with two value buttons and arrow buttons |
| Entry identified by `/duplicates/<id>` in the URL | The URL is always `/v2/data/duplicates/bolt/review-queue` and never changes per pair |
| The FAB's first click revealed conflicts, the second merged | One click on **Merge Contacts** merges |
| Conflict rows highlighted by Element | Element hides matching rows; differing rows are the conflicts |
| No AI | **Bolt AI** pre-selects a side on each row (marked on the "Keep Contact A/B" arrow buttons) and shows a score chip (High / Medium / Low) and an analysis summary |
| List page: `elm-row` chips, URL-driven pagination (`offset`/`limit`) | List page: `elm-review-queue-table` + Angular Material paginator (state not in the URL) |
| Next entry: link/URL navigation | `Previous duplicate` / `Next duplicate` buttons in a queue nav bar; **Dismiss** opens a permanent "Not a duplicate?" verdict dialog |

Consequences that shaped the scripts:

- Pairs are identified by contact names plus the queue position (for the review loop) and by the two
  contacts' **Spark IDs** (for the database).
- **Dismiss is never clicked by the script.** Skipping only ever uses **Next duplicate**.
- Bolt's own picks are the starting point, so the script records Bolt's pick on every row before
  touching anything, and compares its own suggestions against them.

---

## 3. Architecture

### 3.1 The main loop

`attemptAutoResolve()` runs about once a second (and on DOM mutations) while a review pair is on screen:

1. Wait until both contact names are loaded.
2. `resetStaleRows()` — clear any per-row state left over from the previous pair (Element can reuse DOM nodes).
3. `snapshotNativeSelections()` — record Bolt's default pick for every row (read from the arrow buttons) *before* anything can click a row.
4. Detect a **new pair** by `getPairKey()`: the two contact names plus the queue position (`name|name#current`). The position is part of the key because consecutive pairs can have identical names; with names alone the script thought it was still on the same pair and stalled.
5. Compute blockers → apply lockdown styling → publish the signal for the CSV script → either skip/stop (blocked) or continue to resolution (see [section 5](#5-the-per-pair-workflow)).

### 3.2 The diff-row adapter

`getDiffRows()` turns each `.diff-row` into an object: `label`, left/right text, `isConflict` (the two sides
differ, since Element does not flag conflicts itself), `nativeSide` (which side Element/Bolt has selected,
read from the arrow buttons first and the value buttons as a fallback), a stable `key`
(`label#occurrence|left|right`) and `selectSide(side)` (clicks the arrow, falling back to the value button).

### 3.3 Bolt's picks vs our picks

- Every rule calls `applyScriptPick(row, side)`, which records our suggestion on the row (`data-elm2-script-side`, `data-elm2-rule`) and in `rowMemory`, and only actually clicks the row if the pair is in range and **Use picks from** is **Ours** (or the row is a gap Bolt left unselected, see [4.2](#42-use-picks-from)).
- `rowMemory` (a per-pair Map) keeps Bolt's original pick and ours even if Element re-renders a row.
- "Our" suggestions are always computed, so the comparison bar and hover preview work even when nothing is auto-applied.

### 3.4 Safety net: the click guard

A capture-phase click listener blocks any **untrusted** (script-generated) click on **Dismiss** and on **Confirm**
inside the "Not a duplicate?" dialog, and logs a stack trace naming the caller. Other script clicks are allowed
and logged (the pager's own First/Next/Previous/Last buttons are not logged).

### 3.4b Page context

Because both scripts run with `@grant none`, the main script can read Angular's internal data on elements
(`__ngContext__`). With a sandboxed grant, Firefox hides those properties from userscripts.

---

## 4. Settings reference

All settings are in the gear (⚙) pane. Settings are stored in `localStorage` unless noted.

### 4.1 Pairs in range (slider)

Five positions, chosen by **Bolt score**, **each adding to the one before**:

| Position | Pairs in range |
|---|---|
| **None** | no pair is in range |
| **High** | Bolt score **High** |
| **Medium** | **High** and **Medium** |
| **Low** | **High**, **Medium** and **Low** |
| **All** | every pair, even one with no score chip |

An applicant side does **not** put a pair in range (applicants can have any score); the applicant rule only
affects *which side is picked* when **Use picks from = Ours** ([section 7](#7-field-resolution-rules)). On High, Medium and Low the script waits up to 3 seconds for the score chip to render before deciding.

What "in range" means:

- In range: our picks are applied (if **Use picks from = Ours**), and the pair is eligible for auto-merge.
- Out of range: with **Auto-Skip on** the pair is skipped (no popup); with Auto-Skip off it is left for you untouched.
- **None with Auto-Skip on skips every pair** (see [scan mode](#53-scan-mode)).

Storage: `elm_range_level2` (0-4). Earlier builds had an *Applicant* stop and used `elm_range_level` (0-5); that value is mapped once (Applicant becomes High), and the oldest `elm_auto_apply_level` and `elm_auto_click_fab` are honoured as fallbacks.

### 4.2 Use picks from

- **Ours** (default): our rules are applied on pairs in range, **including the applicant rule**.
- **Bolt's**: Element's pre-selected picks are kept. Our suggestion only fills a row Bolt left unselected. (Applying "Bolt's picks" changes nothing by itself, since Bolt's picks are already selected.)

Greyed out while the slider is on None. Storage: `elm_use_picks` (`ours` | `bolt`).

### 4.3 When done

- **Wait for me** (default): you review and click Merge Contacts.
- **Merge**: after the pair is decided, a cancel countdown runs, then the script clicks Merge Contacts ([section 9](#9-auto-merge-and-the-cancel-countdown)).

Stored in **`sessionStorage`** (`elm_when_done`), so every new browser session starts on Wait for me. Greyed out while the slider is on None.

### 4.4 Merge countdown

2, 3, 4 (default), 5, 6, 8, 10 or 15 seconds. Never below 2: the cancel window is required. Only active when When done = Merge and the slider is not None. Storage: `elm_merge_countdown`.

### 4.5 Auto-Skip

Skips pairs the script will not handle, with **no popup**, by clicking **Next duplicate** (never Dismiss):

- blocked pairs ([section 6](#6-blockers-lockdowns)),
- pairs outside the slider range,
- possible-twins pairs.

Off: the script stops on those pairs and leaves them on screen, showing the popups that apply ([section 8](#8-warnings-and-popups)). A twins pair is never auto-merged either way. Before every skip the CSV script is asked to record the pair first ([11.3](#113-recording)). Storage: `elm_auto_skip_blocked` (default on).

### 4.6 Display

- **Highlight Rows** (`elm_highlight_rows`, default on): the pick colours on rows and the applicant band.
- **Show Database UI** (added by the CSV script, `elm_show_db_ui`, default on): shows/hides the header `DB:` counter and the list-view department chips. Recording and the Download / Upload / Clear buttons are unaffected.

### 4.7 Department

**Allowed Department**: `All`, `UnderGrad` (default), `Grad/IA`, `None` (`elm_allowed_department`). A pair whose detected department differs is a blocker. **None** blocks everything (used for scan runs).

### 4.8 Database

Download / Upload & Replace / Clear Database (added by the CSV script, [section 11](#11-csv-database-v2)).

### 4.9 Hidden setting

`elm_show_merge_counter` (default false, no longer a visible toggle) shows a `Merges: N` pill with a reset button in the header. To use it, set `localStorage.elm_show_merge_counter = 'true'`. It counts a merge when the pair on screen changes after Merge Contacts was clicked (see limitations).

---

## 5. The per-pair workflow

### 5.1 Order of checks

1. **Blockers** ([section 6](#6-blockers-lockdowns)). If any apply: red lockdown styling; the pair is recorded; then **Auto-Skip on** → skip, **off** → stop (the appeal popup shows if it is an appeal pair).
2. Wait for Bolt's defaults to be captured (up to 3 s) and, on Low/Medium/High, the score chip (up to 3 s).
3. Compute whether the pair is **in range** (by Bolt score only).
4. Run field resolution ([section 7](#7-field-resolution-rules)); apply per **Use picks from**.
5. About 0.6 s later, re-check blockers (more rows may have loaded) and run resolution again.
6. If out of range and Auto-Skip on → skip. (Otherwise continue.)
7. **Possible twins** check ([section 8](#8-warnings-and-popups)): Auto-Skip on → skip; off → popup. A twins pair stops here (never merged).
8. If in range and **When done = Merge** → cancel countdown, then merge ([section 9](#9-auto-merge-and-the-cancel-countdown)).
9. Otherwise stop and wait for you.

### 5.2 Pair identity

`getPairKey()` is names + queue position. If the position or names change mid-processing the script cancels a running countdown and starts over for the new pair.

### 5.3 Scan mode

To scan the whole queue and record every pair without acting on any, use either:

- **Allowed Department = None** (every pair is a wrong-department blocker), or
- **Slider = None** (nothing is in range),

with **Auto-Skip on**. Every pair is recorded in the database and skipped with no popups. Skipping is robust against two real-world problems: the **Next duplicate** button can be disabled for a moment while Element loads the next pair (the click is retried every 0.5 s, up to 10 tries, and re-tried once after 3 s if a click did not move on), and consecutive pairs with identical names (handled by the position in the pair key). If it cannot advance, a "no next pair" notice appears.

---

## 6. Blockers (lockdowns)

A pair is blocked when any of these is true. Blocked pairs get red styling (the Merge Contacts button turns red; the triggering row and, for forbidden/ignored, the contact card are outlined) and are never auto-applied or auto-merged.

| Blocker | Detection |
|---|---|
| **Forbidden** | Either contact's name contains `test`, or equals one of three hard-coded names (`angela armstrong`, `gillespie armstrong`, `mariah armstrong`) |
| **Appeal** | Any row value, on either side, contains the word `appeal` (the side is reported) |
| **Wrong department** | The detected department differs from **Allowed Department** (see below) |
| **Student ID mismatch** | A row containing `School Id:` shows two different numeric IDs |
| **Ignored** | A chip (`.bolt-chip` / `elm-chip`) whose text is `Ignored` is on the page |

**Department detection.** A row counts as Grad/IA when it is a Workflows / Application / Program / `type:` / `status:` row whose text contains `GRAD_` or "grad student" or an `IA_` / `_IA_` / `_IA ` marker **and** `status: Finished`. Otherwise the pair is **UnderGrad**. For a blocked UnderGrad pair the *first diff row* is highlighted red, as the classic script highlighted its first row; it is only a marker, because UnderGrad is "no Grad/IA row found".

The detected department is also published for the CSV script (`Forbidden` > `Appeal` > `Ignored` > `Grad/IA` / `UnderGrad`).

---

## 7. Field resolution rules

Only rows where the two sides differ (conflicts) are considered. Rules run **in this order**; the first that fires makes the suggestion.

| # | Rule | Behaviour |
|---|---|---|
| 0 | Blank side | If either value is empty, the row is skipped (no opinion) |
| 1 | **Applicant side** (outranks everything) | If an applicant side exists, every conflict row follows it. Detection: a *Cal State Apply Application* entry on only one side wins; if on both, the later application date wins (left on a tie/no date); otherwise an `Application Start/Submit/Complete` or `Admit` type entry on one side; if both, the side with more such entries, then the later date. Only used for UnderGrad pairs |
| 2 | Blank-vs-data | One side blank ("-") and the other has data: no opinion, Bolt's pick stays |
| 3 | Milestone type match | Rows like `type: X, Mon dd, yyyy` where both sides have the same type: left |
| 4 | **Personal email preferred** | Email rows: the side with a personal-domain address (gmail, yahoo, icloud, hotmail, aol, me.com, outlook, live, msn, protonmail, proton.me) wins when only one side is personal. Both personal: flagged for the tiebreak below |
| 5 | **csusb.major** | The side with `csusb.major.` wins; if both, follow the selected email side |
| 6 | Encoura / College Board ID | Both sides present: left |
| 7 | **csusb.school** | Student Type rows: the side with `csusb.school.<n>` wins; if both, follow the selected email side |
| 8 | Date of birth validity | Reject a year that starts with 0 or is below 1900 |
| 9 | First generation | Prefer `Yes` over `No` |
| 10 | Intended term | Prefer the later term code in parentheses, e.g. `(2274)` |
| 11 | Name case | If the values differ only by case, prefer Title Case over ALL CAPS or all lower-case |
| 12 | Legacy default → left | Any row whose text matches `Spark Id:`, `type: Created, name: Record Created`, `type: Custom`, `type: … name:`, `type: Web`, `[ACUx]` or `Outreach_UGRD_` defaults to the left side (never an empty side) |

**Dual personal-email tiebreak** (both emails personal): prefer the address containing a first name, then a last name (parts of 3+ letters of either contact's name), then the birth year (or its last 3/2 digits) from the DOB rows. If none separates them there is **no pick** (the row is left for you), exactly as in the classic script.

**Addresses**: address rows compare with the built-in `AddressComparer` (the classic script's logic, unchanged); on a tie, the selected email side decides; with an applicant side the applicant rule wins.

Not ported: the classic "email open count" tiebreaker (its "User Activity" section does not exist in the new layout).

---

## 8. Warnings and popups

Popups are browser `alert()`s and only appear for pairs that are **left for you** (never for a pair that is being skipped):

- **Appeal keyword detected** — blocked pair, Auto-Skip off.
- **Possible twins / different people** — a pair that passed the blockers and range check, Auto-Skip off.

**Possible-twins signals** (`checkForConflictingRecords`): first name differs, last name differs, date of birth differs (valid years only), address differs (by `AddressComparer`), and **Bolt's analysis summary says "different people/person/individual(s)"**. The warning fires when at least 2 of the first four signals hold, or when Bolt flags it on its own. The popup states the real number of signals and lists them (`1 conflicting signal detected … Bolt Analysis (flagged as different people)`).

The classic "Bolt score is Low" popup no longer exists; the twins check covers it. With Auto-Skip on, twins pairs are skipped silently.

---

## 9. Auto-merge and the cancel countdown

Merging is permanent, so auto-merge is opt-in (**When done = Merge**, which resets every browser session) and gated:

1. The pair must be in range, unblocked, and not flagged as possible twins.
2. A **countdown dialog** opens (centred, over a 32% scrim; the scrim also blocks stray clicks). It shows a draining red ring that steps down once per second with the seconds left in the middle, the headline *Merging automatically*, a plain-language summary such as *"About to merge A and B. 12 fields conflict: 8 follow Bolt's pick and 4 follow ours (applicant side, email)."*, and a full-width **Cancel** pill. **Esc** also cancels. The countdown length is the **Merge countdown** setting (default 4 s, minimum 2 s).
3. Cancelling, or the pair changing, aborts and shows a toast.
4. When the countdown ends, a **final gate** re-checks: the pair is unchanged and unblocked, every conflicting field has a selected side, no twins flag, and the Merge Contacts button exists and is enabled. If it fails: Auto-Skip on → skip, off → a toast says why ("Auto-merge stopped: …").
5. Only then is **Merge Contacts** clicked (once per pair), and the merge-tracking logic takes over.

The script never clicks **Dismiss** and never merges while the slider is on None or When done is on Wait for me.

---

## 10. Visual changes to the Element451 website

All of these are CSS/DOM additions made by the main script. Colours use a Material 3 token set whose primary is **Element451's orange header colour**, sampled from the header bar (`#ef6c00` until found), with warm-neutral surfaces. Element's own blue/orange/green semantics on picks are kept.

### 10.1 Review pair

- **Pick colours** (Highlight Rows): on a row where Bolt and we agree, the chosen value is **green**; on a row where we differ, Bolt's pick is **blue** and ours is **orange**; rows where our rules have no opinion keep Element's default styling. There are no legends or text badges, and arrows are never restyled.
- **Applicant band**: with an applicant side, that contact's card is outlined and a yellow band marks that side's column of values (disabled on blocked pairs).
- **Comparison bar** under the contact header: a one-line status ("Our N suggestion(s) match Bolt's picks (x conflicting of y fields)" / "⚠ n of N suggestions differ from Bolt's picks" / "automation is off", etc.) plus two buttons: **Use Bolt AI picks** and **Use our picks**.
- **Hover preview**: hovering (or focusing) either button highlights in blue exactly what it would select on the rows it would change, with the other values neutral; the green/blue/orange pick colours are hidden meanwhile. Disabled on blocked pairs.
- **Score chips** (High / Medium / Low): High stays green; Medium is orange and Low is red, applied inline with `!important` because Element's per-level rules override stylesheets.
- **Pinned queue nav**: the Previous / position / Next bar stays at the top while you scroll the panel (below Element's header if that is sticky/fixed).
- **"Hide matching items" switch**: restyled as a Material 3 switch in the primary colour.
- **Blocked styling**: red Merge Contacts button and red row/card outlines ([section 6](#6-blockers-lockdowns)).
- **Countdown dialog** and **toast stack** ([sections 9](#9-auto-merge-and-the-cancel-countdown) and 10.5).

### 10.2 Header controls

- A 40px round **gear** button (an inline SVG, outlined Material "settings", so macOS does not draw an emoji) opens the settings pane. If the CSV script is installed, a tonal `DB: N` pill sits next to it. The hidden merge counter lives here too.

### 10.3 Settings pane

A right-hand Material 3 panel (warm neutral surface, 28px rounded left edge): a discrete Material 3 **slider** (track split by a handle, stop dots, value bubble while dragging, labels under it), two **segmented buttons** (Use picks from, When done), a select for the countdown and department, and Material 3 switches. Descriptions under each control reserve their height so the controls below do not jump. A build line shows `New layout · v2-build-N`.

### 10.4 List page

- **Department badges** (CSV script): a small right-aligned pill in the row's flagged cell (see [11.5](#115-list-page-badges)).
- **Pager**: next to the paginator's range label (top and bottom paginators) a **Page [n] of N  Go** box. Enter or Go jumps to the page: it sets the paginator component directly if it can be found; otherwise it clicks First/Next page repeatedly, waiting for each page to load ("Going to page N…" toast). Element's "Rows per page: 50" is left as is, because a custom page size could not be set from outside (the page size is not read from the URL and the paginator component was not reachable from a sandboxed script; with `@grant none` build 100 this should be re-checked).
- **Tabs**: the *Review Queue / History* tab bar is restyled as Material 3 primary tabs (48px, label-medium, 3px rounded-top indicator as wide as the label, divider line, hover/press state layers).
- **Advanced Filters** panel (opened from the list): restyled compactly — a 640px panel (the overlay, its container and the filters host are all set to the same width), a header with a text *Clear All* and a filled *Apply Filters* (disabled grey until a filter changes), tonal white cards on a tinted page, one-line section headers (title + description), labels beside their controls, Material 3 filter chips (outlined; selected = orange tonal with a check mark, the check hidden when unselected), and compact 168px From/To date boxes. Rules are given extra specificity so Element's own chip colours cannot win.

### 10.5 Toasts

Both scripts append toasts to one shared stack, **bottom-left**, newest at the bottom, up to 4, each fading in/out: the CSV script's `API: data captured successfully` / `unavailable, using database fallback`, and the main script's notices (Auto-merge cancelled/stopped, Going to page N…). The same message arriving again refreshes the existing toast.

---

## 11. CSV Database v2

### 11.1 Purpose

Records pairs the main script blocked (or skipped) so the list page can show a department badge per row and so you can export the history. It degrades gracefully: the main script works without it (a skip simply proceeds without waiting for a recording confirmation).

### 11.2 Data model

Stored in `localStorage.elm_csv_database` as a JSON array. Each entry:

```json
{ "firstName": "Jon...", "lastName": "Smi...", "firstName2": "Amy", "lastName2": "Lee",
  "dept": "Forbidden", "rowContents": "…", "sparkId1": "123", "sparkId2": "456" }
```

- **Key**: the pair of **Spark IDs** (read from the `Spark Id:` diff row; Spark ID 1 = contact A, 2 = contact B), compared as an unordered set.
- **Privacy**: only the first 3 letters of each first/last name are stored, followed by `...` when a name was cut (`Jon...`); names of 3 letters or fewer are kept. Full names are also masked out of `rowContents`. Older entries with full names are shortened automatically when the database is read.
- **dept** values: `Grad/IA`, `UnderGrad`, `Forbidden`, `Appeal`, `Ignored`.

### 11.3 Recording

Every second the script reads `body.dataset.csvDept` and the Spark IDs published by the main script and records the pair if the page's Spark IDs match the published ones (stale-signal guard). In addition, **before every auto-skip** the main script dispatches an `elm2-record-pair` event and waits (up to 3 s, retrying every 0.25 s) until the CSV script confirms the pair is recorded, so a fast skip cannot lose an entry; if the CSV script is not installed the skip proceeds immediately.

### 11.4 API interception

The script wraps `XMLHttpRequest` and `fetch` to capture the list API response (`/v2/users/relationships/duplicates?ignored=…&limit=…&offset=…`). Each record contains `master.identities[]` / `duplicate.identities[]` with objects of the form `{ type: 'Spark_…', value: '<id>' }`; the Spark IDs are read from there (text under `ai_analysis` and `feedback` is ignored). Each fresh capture shows the *API: data captured successfully* toast.

### 11.5 List-page badges

A badge is placed in `.cdk-column-flagged` (falling back to signals, then the row). For each row the script first matches a database entry by **both Spark IDs** found in the row's API record (a contact can be in several pairs, so one shared ID is not enough), then falls back to matching the row text by names: **both contacts' 3-letter prefixes** must appear in the row. Rows already showing an `Ignored` chip get no badge. Badges are right-aligned so they line up down the column, and respect **Show Database UI**.

### 11.6 Import / export

- **Download**: `elm_csv_database_YYYY-MM-DD.csv`, columns `Firstname, Lastname, Firstname 2, Lastname 2, Dept., Row Contents, Spark ID 1, Spark ID 2`.
- **Upload & Replace**: reads columns **by header name**, so files from earlier versions (a different column order, or the oldest 5-column `Unique ID` format, which gets no Spark IDs and matches by name only) still import. Names are shortened on import.
- **Clear Database**: asks for confirmation.

### 11.7 UI

Header `DB: N` pill, the Database section of the settings pane, the **Show Database UI** toggle (under Display), the API toast and the badges, all in the same orange Material 3 style.

---

## 12. Inter-script contract, storage keys and console output

### 12.1 Contract

| Channel | Direction | Mechanism |
|---|---|---|
| Department + Spark IDs | main → CSV | `document.body.dataset.csvDept`, `csvSpark1`, `csvSpark2` |
| "Record before skipping" | main → CSV | `elm2-record-pair` event on `document`; the CSV script sets `event.detail.handled` / `.recorded` |
| Blocked-row text | main → CSV | `.diff-row.elm2-blocked-row` elements |
| UI injection targets | main → CSV | `#elm-controls-wrapper` (badge), `#elm-settings-pane .settings-body` (Database section), `#elm-highlight-rows` row (Show Database UI toggle) |
| Shared toast stack | both | `#elm2-toast-stack` (created by whichever script needs it first) |
| Design tokens | main → CSV | CSS variables on `:root` (`--md-primary`, `--md-primary-container`, …, `--elm2-header-color`) |

### 12.2 `localStorage` / `sessionStorage` keys

| Key | Used by | Purpose |
|---|---|---|
| `elm_range_level2` | main | Slider position 0–4 (None, High, Medium, Low, All) |
| `elm_use_picks` | main | `ours` / `bolt` |
| `elm_when_done` (**sessionStorage**) | main | `wait` / `merge`, reset every browser session |
| `elm_merge_countdown` | main | Cancel window seconds (2–15) |
| `elm_auto_skip_blocked` | main | Auto-Skip |
| `elm_highlight_rows` | main | Highlight Rows |
| `elm_allowed_department` | main | Allowed Department |
| `elm_show_merge_counter` | main | Hidden: show the merge counter |
| `elm_merge_count` | main | Merge counter value |
| `elm_range_level`, `elm_auto_apply_level`, `elm_auto_click_fab` | main | Legacy slider values, read once to initialise `elm_range_level2` |
| `elm_csv_database` | CSV | Recorded pairs (JSON array) |
| `elm_show_db_ui` | CSV | Show Database UI |

### 12.3 Console output (page console, F12 → filter `elm2` or `CSV Database`)

- `[elm2] Blocked: …`, `[elm2] Not blocked — allowed dept: …`, `[elm2] Resolution done — …`, `[elm2] Suggestions by rule: {…}`
- `[elm2] Skipping to next pair: <reason>`, `[elm2] Auto-merging pair`, `[elm2] Auto-merge not done: <reason>`
- `[elm2] page jump: direct …` or `… clicking First / Next …`
- `[elm2] script click on button: "…"` for script-generated clicks, and a warning with a stack trace if one is blocked by the click guard.
- `CSV Database (new layout) vX.Y loaded`

---

## 13. Known limitations and unverified guesses

- **Merge-success detection** is inferred: a merge is counted when the pair on screen changes after Merge Contacts was clicked. There is no confirmed success indicator, so there is no auto-navigate-after-merge feature.
- The **Ignored chip** selector is a best-effort guess (the list API also carries an `ignored` field that is not used yet).
- **Score chip reading** assumes the chip text contains `high` / `medium` / `low`.
- **Applicant detection** depends on the Workflows/Application rows being loaded; it re-checks about 0.6 s later, but a very slow load could mislabel a pair.
- **Rows per page** cannot be changed from the script, and the original classic page-size box was dropped. The main script now runs with `@grant none` (build 100) so Angular's paginator component may become reachable; the page-jump console line shows which route is used.
- **Name matching for list badges** is a weak fallback because only 3-letter prefixes are stored; Spark IDs are the real key, and the list API must carry them (it does, in `identities[]`).
- **Email rule**: when both emails are personal and no tiebreaker separates them, no pick is made (as in the classic script).
- The classic **scroll-to-bottom** requirement and **Auto-Click FAB** do not map onto this layout and were not ported.
- Element's DOM may change; selectors are listed in `getDiffRows`, the CSS blocks, and the pager/filters code.

---

## 14. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| A feature seems missing or a popup shows twice | Duplicate or disabled Tampermonkey install; check the gear's build number and each script's version |
| Database buttons / badges still blue or old | The CSV script on your side is an older copy; check it shows the latest `@version` |
| Nothing is auto-applied | Slider on None, pair out of range, or **Use picks from = Bolt's** (nothing to apply) |
| Everything gets skipped | Slider None or Allowed Department None with Auto-Skip on = scan mode |
| Auto-merge never runs | When done is Wait for me (it resets every session), slider on None, pair flagged as twins, or the final gate failed (see the toast / `[elm2] Auto-merge not done`) |
| Skips lose database entries | Make sure both scripts are the latest builds (the record-before-skip handshake) |
| Scan stalls after a few pairs | Fixed in build 81 (queue position in the pair key, retrying Next); update the main script |
| A selected filter chip is blue | Element's own style won; send the chip's HTML so the selector can be added |
| API toast inconsistent | Fixed in CSV v2.18+ (toast on every fresh capture) |

---

## 15. Change history (summary)

- **Initial port**: both classic scripts copied and adapted to the new layout (diff-form rows, queue table).
- **Safety**: auto-skip never clicks Dismiss; Dismiss/Confirm click guard; Merge Contacts is never clicked unless auto-merge is enabled.
- **Colours and AI**: Bolt-pick recording, green/blue/orange pick colours, applicant yellow band, comparison bar with *Use Bolt AI picks / Use our picks*, score-chip colours, pinned queue nav, Material 3 restyle of the gear, settings pane, toggles and slider.
- **Automation rework**: slider None → High → Medium → Low → All (an earlier build had an Applicant stop, removed because applicants can have any score), **Use picks from**, **When done** with the cancel countdown (dialog with draining stepped ring), **Merge countdown** setting, Auto-Skip covering blocked / out-of-range / twins pairs, no popups for skipped pairs, scan mode.
- **CSV Database v2**: keyed on Spark IDs (the URL no longer changes), names stored as 3-letter prefixes, two-contact columns, header-based import, list matching via the list API's `identities[]`, record-before-skip handshake, right-aligned badges, Show Database UI toggle, shared toast stack.
- **Website restyles**: orange Material 3 palette sampled from Element's header, Material 3 tabs, compact Advanced Filters panel, list pager (Page box + Go), hover preview on the comparison buttons, gear icon as an SVG.
- **Fixes along the way**: stall on identical consecutive names / disabled Next button, twins warning signal count, cut-off date text in filters, clipped filters panel, selected-chip colour specificity.
