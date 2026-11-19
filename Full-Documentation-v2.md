# Element451 Deduplication (New Layout) — Full Documentation (v2)

This document covers the two v2 userscripts, which target Element451's redesigned
**Deduplication** review-queue UI, and everything they change on the Element451 website.

| Script | File | Current version |
|---|---|---|
| Element451 - UI Perfection v2 | `Element451-UI-Perfection-v2.user.js` | `@version 2.311`, shown in the settings pane |
| Element451 - Database v2 | `database-v2.js` | `@version 2.76` |
| Element451 - Database Merge v2 (optional) | `database-merge-v2.js` | `@version 1.17`, see [section 17](#17-database-merge) |


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
11. [Database v2](#11-database-v2)
12. [Inter-script contract, storage keys and console output](#12-inter-script-contract-storage-keys-and-console-output)
13. [Known limitations and unverified guesses](#13-known-limitations-and-unverified-guesses)
14. [Troubleshooting](#14-troubleshooting)
15. [Change history (summary)](#15-change-history-summary)
16. [Chrome extension](#16-chrome-extension)
17. [Database Merge](#17-database-merge)

---

## 1. Installation and versions

1. Install the Tampermonkey extension.
2. Create one userscript with the contents of `Element451-UI-Perfection-v2.user.js` and, optionally, a
   second with `database-v2.js`. Both match `https://*.element451.io/*` and run with
   `@grant none`, which means they run in the page's own JavaScript context (this is what lets
   the script look at Angular's internals and lets the two scripts talk to each other).
3. Do not run a classic script and its v2 counterpart on the same page, and make sure each v2 script is
   installed **once**. A duplicate or disabled install was the cause of several "bugs" during development
   (doubled popups, missing features).
4. To confirm what is running: open the gear (settings) — the Info section at the bottom lists `Main script · vX.Y`, `Database script · vX.Y` (when the Database script is installed) and, when running in the Chrome extension, `Extension · vX.Y.Z`.
   Tampermonkey shows both `@version` values too. (The scripts no longer print a "loaded" line in the console.)

Both scripts have `@updateURL`/`@downloadURL` pointing at the `main` branch. Builds developed on a
feature branch must be pasted manually. Each script keeps its `@version` and a `VERSION` constant in sync (the
settings pane shows the constant), so Tampermonkey's update check works once a build reaches `main`.

Chrome users can instead install the scripts through the unpacked extension, which keeps them current from
`main` by itself ([section 16](#16-chrome-extension)); Firefox stays on Tampermonkey.

---

## 2. How the new layout differs from the classic merge page

| Classic (old) | New layout |
|---|---|
| Full page of `elm-merge-row` rows with a floating "FAB" merge button | A review queue with a side panel holding `elm-duplicate-field-diff-form`; each field is a `.diff-row` with two value buttons and arrow buttons |
| Entry identified by `/duplicates/<id>` in the URL | The URL is always `/v2/data/duplicates/bolt/review-queue` and never changes per pair |
| The FAB's first click revealed conflicts, the second merged | One click on **Merge Contacts** merges |
| Conflict rows highlighted by Element | Element hides matching rows (its "Hide matching items" switch); differing rows are the conflicts. For each new pair the script turns the switch off to read every row, then puts it back, so the score, the blocker checks and the department check see every row |
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
5. Compute blockers → apply lockdown styling → publish the signal for the Database script → either skip/stop (blocked) or continue to resolution (see [section 5](#5-the-per-pair-workflow)).

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

Five positions, chosen by **our rating** (section 10.6; Bolt's score is one input of it), **each adding to the one before**:

| Position | Pairs in range |
|---|---|
| **None** | no pair is in range |
| **High** | rating **High** |
| **Medium** | **High** and **Medium** |
| **Low** | **High**, **Medium** and **Low** |
| **All** | every pair, whatever its rating |

An applicant side does **not** put a pair in range (applicants can have any score); the applicant rule only
affects *which side is picked* when **Use picks from = Ours** ([section 7](#7-field-resolution-rules)). The script waits up to 3 seconds for the score chip to render; on High, Medium and Low (where the rating decides whether the pair is in range) it waits up to 10 seconds, so a slow Bolt analysis no longer leaves a pair "out of range" for good.

What "in range" means:

- In range: our picks are applied (if **Use picks from = Ours**), and the pair is eligible for auto-merge.
- Out of range: with **Auto-Skip on** the pair is skipped (no popup); with Auto-Skip off it is left for you untouched.
- **None with Auto-Skip on skips every pair** (see [scan mode](#53-scan-mode)).

Storage: `elm_range_level2` (0-4); All until it has been set.

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
- pairs outside the slider range.

Off: the script stops on those pairs and leaves them on screen (no popups: an appeal shows as a chip in the Dedup analysis card, [section 8](#8-warnings-and-popups)). Before every skip the Database script is asked to record the pair first ([11.3](#113-recording)). Storage: `elm_auto_skip_blocked` (default on).

### 4.6 Display

- **Highlight Rows** (`elm_highlight_rows`, default on): the pick colours on rows and the applicant band.
- **Show Database UI** (added by the Database script, `elm_show_db_ui`, default on): shows/hides the header `DB:` counter and the list-view department chips. Recording and the Download / Upload / Clear buttons are unaffected.

### 4.7 Allowed departments

Two checkboxes, **UnderGrad** and **Grad/IA**, in the Automation section right under the *Pairs in range* slider (`elm_allowed_department`, stored as `All` when both are ticked, `UnderGrad` (the default) or `Grad/IA` when one is, and `None` when neither is). A pair whose detected department is not ticked is a blocker. With neither ticked everything is blocked (used for scan runs).

Two more checkboxes sit with them, **Appeal** and **Forbidden** (`elm_allow_appeal`, `elm_allow_forbidden`, both off by default). Ticked, that kind of pair is no longer a blocker: it is scored, can be auto-applied and, with auto-merge on, merged like any other. Its chip stays beside the score as a note ("Appeals are allowed in your settings"), and the Database script still records it as an Appeal or Forbidden pair. Forbidden covers both test records and the forbidden-name list, so tick it with care. A student ID mismatch and a department that is not ticked still block.

### 4.8 Database

Download / Upload & Replace / Clear Database (added by the Database script, [section 11](#11-database-v2)).

The pane's **Info** section (last, in a single list container) lists the versions in use, which matters when the scripts update themselves in the Chrome extension: `Main script · v2.218` (the UI script), `Database script · v2.58` (added under it by the Database script, when installed) and `Extension · v1.0.3` (only when running through the extension, which hands the page its version as `window.__elm451Extension` when it registers the scripts). All three use the same `vX.Y` style; the console still logs the main script as `v2-build-185`.

### 4.9 Hidden setting

`elm_show_merge_counter` (default false, no longer a visible toggle) shows a `Merges N` pill (tonal orange, number in bold) with a circular-arrow reset button in the header, just left of the gear. To use it, set `localStorage.elm_show_merge_counter = 'true'`. It counts a merge when the pair on screen changes after Merge Contacts was clicked (see limitations).

---

## 5. The per-pair workflow

### 5.1 Order of checks

1. **Blockers** ([section 6](#6-blockers-lockdowns)). If any apply: red lockdown styling; the pair is recorded; then **Auto-Skip on** → skip, **off** → stop (an appeal shows as a chip and a line in the write-up).
2. Wait for Bolt's defaults to be captured (up to 3 s) and, on Low/Medium/High, the score chip (up to 3 s).
3. Compute whether the pair is **in range** (by our rating only).
4. Run field resolution ([section 7](#7-field-resolution-rules)); apply per **Use picks from**.
5. About 0.6 s later, re-check blockers (more rows may have loaded) and run resolution again.
6. If out of range and Auto-Skip on → skip. (Otherwise continue.)
7. (There is no possible-twins check any more, UI 2.286: our score decides; [section 8](#8-warnings-and-popups).)
8. If in range and **When done = Merge** → cancel countdown, then merge ([section 9](#9-auto-merge-and-the-cancel-countdown)).
9. Otherwise stop and wait for you.

### 5.2 Pair identity

`getPairKey()` is names + queue position. If the position or names change mid-processing the script cancels a running countdown and starts over for the new pair.

### 5.3 Scan mode

To scan the whole queue and record every pair without acting on any, use either:

- **no department ticked under Allowed departments** (every pair is a wrong-department blocker), or
- **Slider = None** (nothing is in range),

with **Auto-Skip on**. Every pair is recorded in the database and skipped with no popups. Skipping is robust against two real-world problems: the **Next duplicate** button can be disabled for a moment while Element loads the next pair (the click is retried every 0.5 s, up to 10 tries, and re-tried once after 3 s if a click did not move on), and consecutive pairs with identical names (handled by the position in the pair key). If it cannot advance, a "no next pair" notice appears.

---

## 6. Blockers (lockdowns)

A pair is blocked when any of these is true. Blocked pairs get red styling (the Merge Contacts button turns red; the triggering row and, for forbidden, the contact card are outlined) and are never auto-applied or auto-merged.

| Blocker | Detection |
|---|---|
| **Forbidden** (unless ticked under Allowed departments) | Either contact's name contains `test`, or is on a short hard-coded list of names. The list is kept in the code as SHA-256 hashes (`FORBIDDEN_NAME_HASHES`), so the names cannot be read from the public source; the comment above it shows how to hash a name to add one |
| **Appeal** (unless ticked under Allowed departments) | Any row value, on either side, contains the word `appeal` (the side is reported) |
| **Wrong department** | The detected department is not ticked under **Allowed departments** (see below) |
| **Student ID mismatch** | A row containing `School Id:` shows two different numeric IDs |

**Department detection.** A row counts as Grad/IA when it is a Workflows / Application / Program / `type:` / `status:` row whose text contains `GRAD_` or "grad student" or an `IA_` / `_IA_` / `_IA ` marker **and** `status: Finished`. Otherwise the pair is **UnderGrad**. For a blocked UnderGrad pair the *first diff row* is highlighted red, as the classic script highlighted its first row; it is only a marker, because UnderGrad is "no Grad/IA row found".

The detected department is also published for the Database script (`Forbidden` > `Appeal` > `Grad/IA` / `UnderGrad`).

---

**Bolt analysis error (not a stop).** When Bolt's score chip reads **Error** (its AI analysis failed; the tooltip says "AI analysis merge guidance references an unknown user id."), the pair is rated and handled like any other: our rating does not depend on Bolt, so the error is one small negative input (**-5**, `boltError`, in the points table as "Bolt's analysis failed") and the write-up says `Bolt's original score: Error (its own analysis failed), counted as -5 points.` There are no Bolt picks to compare with, so with *Use picks from = Bolt* our picks fill every row Bolt left unselected, and a row that nobody can decide still *needs review* (the pair is not merged). Before UI 2.291 the script stopped on such a pair (no resolution, merge or skip, even with Auto-Skip on).

## 7. Field resolution rules

Only rows where the two sides differ (conflicts) are considered. Rules run **in this order**; the first that fires makes the suggestion.

| # | Rule | Behaviour |
|---|---|---|
| 0 | Blank side | If either value is empty, the row is skipped (no opinion) |
| 1 | **Applicant side** (outranks everything) | If an applicant side exists, every conflict row follows it, **except** a row where the applicant side is blank ("-") and the other side has data: that row picks the side with data. Detection: a *Cal State Apply Application* entry on only one side wins; if on both, the later application date wins (left on a tie/no date); otherwise an `Application Start/Submit/Complete` or `Admit` type entry on one side; if both, the side with more such entries, then the later date; failing both, a **CAS ID** (`Cas Id: 7000000002`) on one side only marks that side, since only someone who applied through Cal State Apply has one (UI 2.279). Only used for UnderGrad pairs |
| 2 | Blank-vs-data | One side blank ("-") and the other has data (no applicant side): no rule pick; Bolt's pick stays, or the fallback below takes the side with data |
| 4 | **Personal email preferred** | Email rows: the side with a personal-domain address (gmail, yahoo, icloud, hotmail, aol, me.com, outlook, live, msn, protonmail, proton.me) wins when only one side is personal. Both personal: flagged for the tiebreak below |
| 5 | **csusb.major** | The side with `csusb.major.` wins; if both have it the rule cannot decide (see *Needs review* below) |
| 7 | **csusb.school** | Student Type rows: the side with `csusb.school.<n>` wins; if both have it the rule cannot decide (see *Needs review* below) |
| 8 | Date of birth validity | Reject a year that starts with 0 or is below 1900 |
| 9 | First generation | Prefer `Yes` over `No` |
| 10 | Intended term | Prefer the later term code in parentheses, e.g. `(2274)` |
| 11 | Name case | If the values differ only by case, prefer Title Case over ALL CAPS or all lower-case. A single letter (an initial) has no Title Case, so the capital wins (`I` over `i`) |

**Fallback and manual review.** After the rules, every conflicting row ends in one of three states:

1. **Decided**: a rule picked a side, or Bolt had already selected one (Bolt's pick stands when no rule has an opinion).
2. **Filled**: Bolt left the row unselected (typically Milestones, Sources and other `type: …` list rows) and no rule applies. The script picks, in order: the side with data when one side is blank; the **more recent profile** (the contact card's *Created* date); the side of the **selected email**; and finally an **arbitrary but stable** side (a hash of the pair, so a revisited pair gets the same answer). These rows have no Bolt pick to agree with, so they are never green,.
3. **Needs review**: a rule applied but could not decide (dual personal email with no tiebreak, an address tie or two broken addresses, `csusb.major` or `csusb.school` on both sides) **and** Bolt left the row unselected. The pair is never auto-merged and is **never skipped**: it stays on screen for you whatever Auto-Skip says. A toast says `Not merged: needs review (Email, Address)` and the console names the fields. Once you have merged it by hand and moved on, auto-merge resumes on the next pair. The console names the rows (`[elm2] Needs review: …`).

**Dual personal-email tiebreak** (both emails personal): first the **engagement** numbers (the contact whose profile has more **email opens**, then more **email clicks**; Contact A = left, B = right). The merge screen only holds those numbers while its "Show engagement data" panel is open, so for these pairs the script opens the panel itself (once per pair, waiting up to 4 s) and reads the `#duplicate-engagement-details` table. If opens and clicks are tied or there is no panel, it goes on: prefer the address containing a first name, then a last name (parts of 3+ letters of either contact's name), then the birth year (or its last 3/2 digits) from the DOB rows. If none separates them there is **no pick**; with no Bolt pick either, the row *needs review*.

**Addresses**: with an applicant side the applicant rule wins (unless the applicant's address is blank and the other has one). Otherwise address rows compare with the built-in `AddressComparer`: a duplicated-component address loses, and for the same address the more complete one wins. Ties are **not** picked (Bolt's pick stands; with none, the row needs review): the same address with equal completeness, different addresses, or both addresses having duplicated parts.

The classic "email open count" tiebreaker is back, fed by the new layout's engagement panel instead of the old "User Activity" section (see the dual personal-email tiebreak above).

---

## 8. Warnings and popups

**There are no popups on the review page any more** (UI 2.278). The two there were, both browser `alert()`s for pairs left for you, have moved:

- **Appeal keyword detected** is now an **Appeal** chip beside our score in the Dedup analysis card, and a first line in the write-up saying where the word is (`Blocked: the word "appeal" is in the Notes row of Contact A (left), so this pair cannot be merged.`). The pair is still blocked and styled red as before.
- **Possible twins / different people** is gone altogether (UI 2.286: first the popup, then the check). Our score already counts a different first name, last name, birth date or address and Bolt's *different people* against the pair, and the write-up says so; a pair is skipped, left for you or auto-merged by its score and the slider alone. Twins and siblings who share a last name, birth date and address score about 50 (Medium), so **a slider that includes Medium, with When done = Merge, can now auto-merge them**: keep the slider on High for unattended merging, or ask for a larger first-name penalty.

The classic "Bolt score is Low" popup no longer exists either. The only dialogs left are the merge counter's reset confirmation and the Database script's file and clear-database messages.

---

## 9. Auto-merge and the cancel countdown

Merging is permanent, so auto-merge is opt-in (**When done = Merge**, which resets every browser session) and gated:

1. The pair must be in range and unblocked.
2. A **countdown dialog** opens centred in the merge panel; a scrim covers only that panel and blocks stray clicks on it. It shows the headline *Merging automatically*, a red **wavy ring** that steps down once a second with the seconds left in the middle, a short brief, and a full-width **Cancel** pill (**Esc** also cancels; both work until the countdown reaches 0). The brief shows the two names; *Bolt score:* Low / Medium / High; *Script agrees with 2/5* (the share of our picks that match Bolt's); and *Script chose 3 over Bolt: Email, Address, DOB*, or *Script found **applicant** and chose 3 over Bolt* when an applicant side decided. With **Use picks from = Bolt's** it reads *Bolt chose 3 over script: …* or *Script found **applicant** but Bolt chose instead*. At **0** the ring turns green, the headline reads *Merging…* and Merge Contacts is clicked at that moment; Cancel is greyed out once the merge has fired.

   The length is the **Merge countdown** setting (default 4 s, minimum 2 s), and that is the whole wait. The exception is **4 seconds, race lights** (stored as `elm_merge_countdown = race`): a start signal instead of the ring. Three dark lamps (*Get ready…*), red lamps at 3, 2 and 1 seconds left, then all green with *GO!* for 0.3 s before the click; the lamp steps are shortened to 0.925 s so the whole style still takes exactly 4 s.

   **Kart:** with race lights, a pixel-art go-kart with the CSUSB coyote (a 28 × 29 px sprite) waits in the dimmed strip beside the merge panel. It charges like a Mario Kart drift mini-turbo while the lights count down: drift sparks at the wheels, **blue** at 3, **orange and yellow** at 2 and **pink** at 1, with one shake of the kart per colour. The sparks are a trail at each wheel, which grows with each stage (small, medium, large) and is a wave that swells, curls over to the left and crashes into spray (twelve frames), with tongues of fire licking out of its left edge while it builds, plus small plus-shaped sparks that flare, drift back and go out (the first colour throws fewer), and the wheels flicker as they turn. When the lights go green the sparks stop and the borders of the tyres turn pink, two bright pink arcs, on opposite sides, running round each tyre as a circle, and the kart drives off under the panel with six pink speed lines, each 1 px tall, four in front of the kart and two behind it. Each is 11 frames across the whole drawing (the 22 px behind the kart plus its 28 px), taken from a drawn picture: the line grows out of the right edge (1, 2, 4, 6, 10, 17 px long), slides left in bigger and bigger steps while it shrinks (10, 6, 4, 2, 1 px) and dies away; its ends are lighter than its middle. The frames are the `KART_STREAK` table in the script. All six lines run across the same 50 px; they differ only in their row and in when they start. It is drawn as inline SVG (a text bitmap, one path per colour). It is skipped if the strip is narrower than about 200 px or *reduce motion* is on, and it sits above the page dimming and below the toasts.
3. Cancelling, or the pair changing, aborts and shows a toast.
4. When the countdown ends, a **final gate** re-checks: the pair is unchanged and unblocked, every conflicting field has a selected side (rows that *need review* stop the merge), and the Merge Contacts button exists and is enabled (a disabled button is waited for, up to 8 s, before the countdown starts and again at 0: Element can leave it disabled for a moment while it loads the pair). If it fails because a field needs review, the pair stays on screen. Any other failure: Auto-Skip on → skip, off → a toast says why ("Auto-merge stopped: …").
5. Only then is **Merge Contacts** clicked (once per pair), and the merge-tracking logic takes over.

**After a merge** (yours or an auto-merge): Element451 shows a **Merge completed** card (`bolt-card.merge-completion-state`) with **View merged contact** and **Next duplicate**. The script detects that card, counts the merge, waits about 1 second and presses **Next duplicate** (absent on the last pair, so nothing is pressed then). The **Next after merge** switch in the settings pane turns this off (`elm_next_after_merge`, default on). While it is on, Element451's own *Skip merge completion screen* and *Skip this screen next time* switches are hidden, because turning either on would remove the card the script reads; a switch that is already on stays visible (so it can be turned off) and the console warns about it. If Merge Contacts was clicked but no card appears within 6 s, the console says so and logs any open dialog.

**Toasts.** The **Toasts** switch (settings pane, *Display*) controls them. It is forced **off** (greyed) when the slider is on **None** (a scan), forced **on** (greyed) while **Auto-Skip** or auto-merge is on, and free otherwise. A skip shows **one reason**, chosen by priority (Range > Forbidden > Student ID > Graduate/IA > Appeal): `Skip: Appeal`, `Skip: Graduate/IA`, `Skip: Student ID`, `Skip: Forbidden`, `Skip: Range`. A pair that needs review is not skipped; it shows `Not merged: needs review (…)`. If Merge Contacts was clicked but no *Merge completed* card appears within 6 s, a toast says so (and whether a dialog is open). Once the *Merge completed* card has appeared you get `Merge: 2/3` (the *Script agrees* figure), `Merge: Applicant`, or `Merge: Bolt` when the script made no picks of its own. Plain scans show none.

The console logs each merge (`[elm2] Merged 7/40 | …`) and each skip with its queue position and reason (`[elm2] Skipping to next pair: … (was 8/40)`). The final-check conditions are tested **before** the countdown starts, so a pair that could not merge (for example a field with no pick, named in the console as `[elm2] No pick on: …`) is skipped without showing the dialog.

The script never clicks **Dismiss** and never merges while the slider is on None or When done is on Wait for me.

---

## 10. Visual changes to the Element451 website

All of these are CSS/DOM additions made by the main script. Colours use a Material 3 token set whose primary is **Element451's orange header colour**, sampled from the header bar (`#ef6c00` until found), with warm-neutral surfaces. Element's own blue/orange/green semantics on picks are kept.

### 10.1 Review pair

- **Pick colours** (Highlight Rows): on a row where Bolt and we agree, the chosen value is **green**; on a row where we differ, Bolt's pick is **blue** and ours is **orange**; rows where our rules have no opinion keep Element's default styling. There are no legends or text badges, and arrows are never restyled.
- **Applicant band**: with an applicant side, that contact's card is outlined and a yellow band marks that side's column of values (disabled on blocked pairs). The row that shows the applicant (the first Cal State Apply / application row that side has, else its CAS ID row) gets an extra highlight on top: a darker amber frame and a tint on the applicant's side of that row, layered over the band and the outline so they overlap. The same band, outline and row highlight mark the side that has a School / Coyote ID when the other has none.
- **Comparison bar** under the contact header: a one-line status ("Our N suggestion(s) match Bolt's picks (x conflicting of y fields)" / "⚠ n of N suggestions differ from Bolt's picks" / "automation is off", etc.) plus two buttons: **Use Bolt AI picks** and **Use our picks**. It is **pinned**: while the field list scrolls it stays just under the Previous / position / Next bar (sticky; the form's `overflow: hidden` is swapped for `overflow: clip` so it can stick), The bar is a white card with a thin outline; while it is pinned it also gets a stronger shadow and a white strip above it, so it stands out from the grey navigation bar.
- **Hover preview**: hovering (or focusing) either button highlights in blue exactly what it would select on the rows it would change, with the other values neutral; the green/blue/orange pick colours are hidden meanwhile. Disabled on blocked pairs.
- **Score chips** (High / Medium / Low): High stays green; Medium is orange and Low is red, applied inline with `!important` because Element's per-level rules override stylesheets.
- **Pinned queue nav**: the Previous / position / Next bar stays at the top while you scroll the panel (below Element's header if that is sticky/fixed).
- **"Hide matching items" switch**: restyled as a Material 3 switch in the primary colour.
- **Blocked styling**: red Merge Contacts button and red row/card outlines ([section 6](#6-blockers-lockdowns)).
- **Countdown dialog** and **toast stack** ([sections 9](#9-auto-merge-and-the-cancel-countdown) and 10.5).

### 10.2 Header controls

- A 40px round **gear** button (an inline SVG, outlined Material "settings", so macOS does not draw an emoji) opens the settings pane. If the Database script is installed, a tonal `Database N` pill sits just left of it (then the hidden Merges counter, when shown: order is Database, Merges, gear).

- **Title bar colour**: the script sets `<meta name="theme-color">` to the header colour it samples, so an installed web app's title bar (and the browser toolbar on mobile) matches the Element451 header. It darkens live with the page: while anything dims the whole window, the colour is the header colour blended with that dim layer. That covers a profile's sidebar and dialogs (`.cdk-overlay-backdrop`), our settings pane's overlay, and any other window-wide layer whose class contains `backdrop` or `scrim` (this is how the Advanced Filters panel is picked up). The colour follows the fade in and out and returns to the header colour when the layer closes. Layers that cover only part of the window, like our countdown scrim over the merge panel, are ignored.

### 10.3 Settings pane

A right-hand Material 3 panel with a close button at the top left next to the title, laid out as an **M3 Expressive list**: each setting (and each Database button) is its own light container, with large outer corners on the first and last of a group (`.elm-list` / `.elm-item`). Controls: a discrete Material 3 **slider** (stop dots, value bubble while dragging), two **segmented buttons** (Use picks from, When done), selects for the countdown and department, and Material 3 switches. Descriptions under each control reserve their height so the controls below do not jump. A build line shows `New layout · v2-build-N`.

**Install as an app card** (top of the pane): shown only while Chrome says the page can be installed (the script holds the `beforeinstallprompt` event until you click **Install**, which opens Chrome's own install dialog). It looks like the extension popup's "One setting to turn on" card, and its **X** hides it for good (`elm_install_dismissed`). Element451 ships no web app manifest, so the script adds one itself (a blob `<link rel="manifest">` named *Element451*, a standalone window starting at the site root, and an icon with the white CSUSB logo on the header orange in a rounded square (corners transparent), drawn on a canvas from a small embedded greyscale image of the logo); Chrome then offers the install as it would for any web app. If the page's security policy (`manifest-src` / `default-src`) refuses it, the console says `[elm2] the page's security policy refuses an added web app manifest…` and nothing else changes. The manifest also lists a **Deduplication** shortcut (the item in the installed app's taskbar right-click list on Windows, and in its icon menu), pointing at the Deduplication page: the script learns that page's address (the path only, `elm_dedup_path` in this browser's local storage, never in the script) the first time the list is on screen. Chrome reads an installed app's shortcuts when it installs it and when it re-checks the manifest (about once a day, when the app is opened), so for an app installed earlier it can take a day, or uninstall and install it again. The card does not show when the app is already installed or in browsers without installable web apps (Firefox).

### 10.4 List page

- **Department badges** (Database script): a small right-aligned pill in the row's flagged cell (see [11.5](#115-list-page-badges)).
- **Pager**: next to the paginator's range label (top and bottom paginators) a **Page [n] of N  Go** box. Enter or Go jumps to the page (0 or a negative number goes to page 1, a number past the end goes to the last page): it sets the paginator component directly if it can be found; otherwise it clicks First/Next page repeatedly, waiting for each page to load ("Going to page N…" toast). Element's "Rows per page: 50" is left as is, because a custom page size could not be set from outside (the page size is not read from the URL and the paginator component was not reachable from a sandboxed script; with `@grant none` build 100 this should be re-checked).
- **History search** (History tab, in the table header's actions slot; if that slot isn't found it goes before the pager, then above the table): a Material 3 Expressive search field that starts as a search icon and slides open when clicked (hint "Search merged profiles"; Escape, the icon, or clicking away from an empty box closes it). Enter starts the search, as on the review queue. **Previous match** / **Next match** step through the matches found so far (found matches are remembered, so Previous goes back without re-scanning), a status line sits left of the box, and the **×** cancels the search and clears the highlight. The first match is jumped to straight away (the pager goes to its page and the row gets a rounded orange box) while the scan carries on in the background, so the count grows as more are found.
  - **Status line**: `Searching page 5 of 104…`, `Searching page 5 of 104… Match 1 of 1`, `Match 1 of 3`, or `No matches found in 104 pages`.
  - **How it scans**: the page loads 50 merges at a time from `.../v2/users/relationships/duplicates/history?limit=50&offset=N`. The script remembers the page's own last request to that URL (including the auth token) and replays it for page 1, 2, 3…. Before paging it requests offsets 0 and 1 to learn whether `offset` counts pages from 0, pages from 1 or records. If no request has been captured yet (the page loaded before the script), go to another page of the list once. The Database script ignores history responses.
  - **Matching**: word-based partial matching over every value of the record, never the field names. Capitals and accents are ignored on both sides ("jose" finds José, "hernandez" finds Hernández). Each typed word must be the start of a word in the record ("lov" finds Lovelace, "ovel" does not); a word with an @, digit or punctuation (an email, ID or date) is matched inside the whole value. Order doesn't matter, and with three or more words one may be missing ("First Middle Last" finds First Last).
  - **Skipped fields**: free text (`ai_analysis`, `feedback`) and **who did the merge**: keys like `actor`, `reviewer`, `performer`, `creator`, `author`, `*_by`, and any value equal to a reviewer name shown in the table's "who" column on the pages you have browsed. A plain `user` key is searched, because in Element451's API the contacts are the "users".
  - **Narrow windows**: the header row wraps instead of squishing. The pager drops under the header row when the two don't fit, and the status text moves onto its own line above the box before anything is clipped.
- **Search bar style**: Element's expanded header search (`bolt-expandable-search`, review queue and History) and the History search share one Material 3 Expressive look: a 56 px full-round bar (the header row is kept 56 px tall even while the search is closed, so nothing moves when it opens) filled `#F5F5F5` (`--md-search-fill`), no outline, the search icon at the leading edge, 16 px text. Only the expanded state of Element's own search is restyled; it already slides open by itself.
- **Tabs**: the *Review Queue / History* tab bar is restyled as Material 3 primary tabs (48px, label-medium, 3px rounded-top indicator as wide as the label, divider line, hover/press state layers).
- **Advanced Filters** panel (opened from the list): restyled compactly — a 640px panel (the overlay, its container and the filters host are all set to the same width), a header with a text *Clear All* and a filled *Apply Filters* (disabled grey until a filter changes), tonal white cards on a tinted page, one-line section headers (title + description), labels beside their controls, Material 3 filter chips (outlined; selected = orange tonal with a check mark, the check hidden when unselected), and compact 168px From/To date boxes. Rules are given extra specificity so Element's own chip colours cannot win.

### 10.5 Toasts

Both scripts append toasts to one shared stack, **bottom-left**, newest at the bottom, up to 4, each fading in/out: the Database script's `API: data captured successfully` (never shown while the merge panel is open, and one already showing is removed when the panel opens: the list refreshes in the background after a merge. "Open" means the diff form is on the page, or the review sidebar is on screen) / `unavailable, using database fallback`, and the main script's notices (Auto-merge cancelled/stopped, Going to page N…). The same message arriving again refreshes the existing toast.

### 10.6 Dedup analysis (our rating and write-up)

**The current weights, the rating rules and a table of sample pairs are in [`SCORING.md`](SCORING.md)**, which is generated from the score engine and checked by `npm test`, so it always matches what runs.

Bolt's overview card is replaced by our own: a **rating chip** (High, Medium or Low), the point total, and beside them:

- a **department chip** (UnderGrad purple, Grad/IA blue, the same colours as the Database script's list badges), outlined when the department is not one of your allowed ones (the pair is blocked);
- an **Appeal** chip (amber) when the word *appeal* is on either record; a **Forbidden** chip (pink) for every forbidden entry: a name that contains *test* (a test record), a name on the forbidden list, and two different School IDs (UI 2.305; before, the first two read *Test* and *Forbidden name*). The chip's hover text and the write-up's *Blocked: …* line say which it is; the list's badge and the database say **Forbidden** too. Different School IDs get the same **Forbidden** chip (UI 2.303), and the score counts them as different Coyote IDs (−120, capped at Low); the pair is blocked from merging; each blocker also opens the write-up with a *Blocked: …* line saying why;
- **Bolt: High / Medium / Low**, Bolt's original score (our chips replace Bolt's on the page, so this is where it can still be seen). The write-up ends with it too: *Bolt's original score: High.*, or that it could not be read, or that Bolt's chip said High while its text said different people, so it was not counted.

A three-way switch picks the view: **Write-up** (the plain-English write-up), **Points** (a table: one row per rule that applied, saying what was found, with its points, a *strong match* tag on the strong matches (an ID, birth date, exact email, phone, address; for information, they do not change the rating), the total, and one sentence on why that total is the rating it is, e.g. *93 points: High is 70+.*) and **Bolt's** (Bolt's own header and text, which are only hidden, never removed; the chip and title then show Bolt's score instead of ours). Write-up or Points is remembered from pair to pair and across visits (`elm2_an_view`); Bolt's goes back to the one you use on the next pair. Hovering our chip lists the points per field, and the console logs the same breakdown with the evidence read, for each pair.

**Where the data comes from.** Every field is read from the diff form's own rows, matching ones too. For each new pair the script turns Element's "Hide matching items" switch off, reads all the rows into a snapshot, and puts the switch back the way it was (UI 2.301); nothing is decided about the pair until that is done. The score, the blocker checks and the department check read the snapshot together with the rows on screen. Before, matching fields were taken from Bolt's bullet list. Names come from the contact cards when the form has no name rows. The rating still waits for Bolt's overview to be on screen, because Bolt's own score and its "different people" remark are part of it.

**Points.** Both contacts need the field, or it scores 0 (a missing field is never held against a pair).

| Field | Match | Mismatch |
|---|---|---|
| Coyote ID (a School Id, or the number of a `coyote.csusb.edu` email) | +120 | -120, hard conflict (scores nothing when one ID comes from an email) |
| CAS ID | +120 | -18, not a hard conflict (a student can have several applications) |
| Date of birth | +40 | -45 (one typo or day/month swap: -20). Heavy, but **not** a hard conflict: it does not cap the rating |
| Email, exact / same name part (another domain, or only the numbers, dots, dashes or underscores differ, with at least 5 letters left: `maria.soto444` / `maria.soto1111`) | +40 / +15 | 0 (people have several) |
| Phone | +30 | 0 |
| First name (same / nickname or initial) | +15 / +7 | -30 |
| Last name (same / overlapping) | +15 / +7 | -15 |
| Address (the page's own comparer) | +25 | -3 |
| Student type, Academic level, School attended | +5 each | 0 |
| Name or birth date found in an email address | name: +6 first + last, +4 first 3+ letters + last (`mar.soto`), +3 initial + last, +2 first or last alone, up to +10 for the pair / birth date: +20 (year only +3) | -8 (a full date that disagrees) |
| Applicant with no Coyote ID vs a contact that has one | | -40 |
| Bolt High / Medium / Low | +10 / +5 / -10 | |
| Bolt says "different people" | | -10, and Bolt's High / Medium bonus is not given |

**Rating.** The rating is the points alone (UI 2.287): High is 70+, Medium 45+, everything else Low, except that a **hard conflict** always makes the pair Low. (It used to need a matching Coyote or CAS ID or two strong matches for High as well; that rule is gone.) A **hard conflict** is now only two different Coyote IDs, and it caps the pair at Low. Different CAS IDs are -18, not a hard conflict, because a student can have several applications. A clearly different birth date is a -45 penalty like any other, so the other fields can outweigh it (a matching Coyote ID and name with a clearly different birth date scores 90 and is High). There is no twin-pattern rule: first names that differ cost the first-name penalty (-30) and nothing more, so a pair of twins or siblings who share a last name, birth date and address scores 50 points (Medium); there is no separate possible-twins check any more (section 8), so the score alone decides. A Low pair under 15 points is described as probably different people in the write-up. These are deliberately cautious: merging two people is the worse mistake. The weights, thresholds and nickname list are in `SCORE_W`, `SCORE_CUT` and `NICK` at the top of the score engine, which is a set of pure functions (no page access) between the `SCORE ENGINE START` / `END` comments.

**Score chips.** The chips in the review sidebar and on the list show our rating too. A chip reads **Pending**, in Bolt's blue, until the pair has been analysed. The review page remembers each pair it rates (localStorage `elm_pair_ratings`, keyed by the pair's two Spark IDs, the 4000 most recent) **as the list of scoring rules that applied** (for example `address.0,dob.0,first.0,last.0`: a matching address, birth date, first name and last name), never as the finished rating and never with a name, date or contact detail. The list re-rates those rules with the weights in force **now**, so changing a weight changes the chips of every remembered pair at once, with no need to open the pairs again. An entry saved by an older version has no rules to re-rate, so its chip reads Pending until the pair is opened again. A pair is remembered as soon as its rating exists (not only when the analysis card is drawn), so a pair that is skipped within a second still gets a chip and a list row finds it through `data-csv-sparks`, the Spark IDs the Database script sets on a row from the list API. Without the Database script, or when the list API was not captured, list rows stay Pending. A chip that shows Bolt's own *Error* is left alone. **Bolt's score is read only from the chip in the review sidebar**; a chip in a list row behind the sidebar belongs to another pair and is never used (no chip found means no Bolt score). A High chip beside Bolt text that says *different people* is treated as a misread and ignored; the console line `[elm2] analysis:` lists how many Bolt chips were read and their levels.

The slider, the Auto-Apply range check and the merge brief use this rating; the database's Bolt Score column still records Bolt's own chip.

---

## 11. Database v2

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
- **dept** values: `Grad/IA`, `UnderGrad`, `Forbidden`, `Appeal`.
- **score** is Bolt's own score (`high` / `medium` / `low`, from its chip, kept once seen). **points** is **our** score: the points total of the Dedup analysis (section 10.6) as a whole number, for example `80` or `-38` (`0` and negative totals are real scores). It is the number the analysis bar shows next to the rating, written for the pair while its review page is on screen and **updated to the latest** each time the pair is seen again (more evidence can load after the first look); when the analysis is not on screen the stored number is kept. It is absent on entries recorded before the column existed and on pairs whose analysis never finished loading (a pair skipped before Bolt's overview rendered has no analysis): both fill in the next time the pair is opened. The main script publishes it as `document.body.dataset.csvPoints`.
- **Blank second names**: when both contacts have the same name, the second-name fields (`firstName2`, `lastName2`) are left blank, each field on its own and ignoring case (a pair of `Ethan Suarez` / `Ethan Suarez` stores `Eth...` / `Sua...` and blank "2" columns). A blank second name means "same as the first".

### 11.3 Recording

Every second the script reads `body.dataset.csvDept` and the Spark IDs published by the main script and records the pair if the page's Spark IDs match the published ones (stale-signal guard). In addition, **before every auto-skip** the main script dispatches an `elm2-record-pair` event and waits (up to 3 s, retrying every 0.25 s) until the Database script confirms the pair is recorded, so a fast skip cannot lose an entry; if the Database script is not installed the skip proceeds immediately.

### 11.4 API interception

The script wraps `XMLHttpRequest` and `fetch` to capture the list API response (`/v2/users/relationships/duplicates?ignored=…&limit=…&offset=…`). Each record contains `master.identities[]` / `duplicate.identities[]` with objects of the form `{ type: 'Spark_…', value: '<id>' }`; the Spark IDs are read from there (text under `ai_analysis` and `feedback` is ignored). Each fresh capture shows the *API: data captured successfully* toast.

### 11.5 List-page badges

A badge is placed in `.cdk-column-flagged` (falling back to signals, then the row). For each row the script first matches a database entry by **both Spark IDs** found in the row's API record (a contact can be in several pairs, so one shared ID is not enough), then falls back to matching the row text by names: **both contacts' 3-letter prefixes** must appear in the row. A blank second name is read as the first name, and when both contacts share a name that name must appear **twice** in the row, so a pair of identical names doesn't match a row with one copy of the name beside a different person. Badges are right-aligned so they line up down the column, and respect **Show Database UI**.

**Score chips on the list (where a row's Spark IDs come from).** A list chip shows the rating remembered for the pair, found by the pair's two Spark IDs, which the Database script writes on the row as `data-csv-sparks`. They come from the list API's record when the record is known to belong to the row (tied by the names on the row; a tie made earlier is checked again, because Element451 reuses row elements), and otherwise from the database entry the row was matched to, the same entry the department badge is drawn from, so the two chips on a row agree. That second source matters on a **first load**: the page asks for its list before the scripts run, so nothing is captured until you change page, and the chips used to stay Pending until you went to another page and back. Position (row *n* is record *n*) is used only when most rows already matched by name, so data captured for another page can no longer tie rows to the wrong records (it used to show another pair's rating). The chips are labelled in the frame a row is added, so a row never shows Bolt's own score for an instant. A pair stays Pending when it has no remembered rating: pairs that were skipped before Bolt's overview finished loading are recorded in the database but never rated; open one and let it load to rate it.

**Speed with a big database.** The database is read every second (the counter, the recording) and, on the list page, once per row. With thousands of entries that used to freeze the page: every row was compared against every entry, building several regular expressions each time (a few thousand entries blocked the page for over half a second every two seconds). Now the parsed database is kept in memory and read again only when the stored text changes (saving refreshes it, and another tab or script changing it is noticed), and lookup tables are built once per change: by Spark ID pair, by Spark ID, and by the first letters of the first name. A list row is only compared with the entries its words point to, in database order, so the result is the same as before. Entries whose names or IDs contain characters other than letters and digits are always checked in full.

### 11.6 Import / export

- **Download** is always password protected and offers two forms (section 19): a password-protected `elm_database_YYYY-MM-DD.xlsx` (Excel asks for the password, then opens it as the spreadsheet described here) or a personal `elm_database_YYYY-MM-DD.elmdb`, locked to your Element451 login, that only these scripts read. The spreadsheet inside: Columns, in order: `Bolt Score, Dedup Score, Firstname, Lastname, Firstname 2, Lastname 2, Spark ID 1, Spark ID 2, Dept., Scan Date, Merged, Script vs Bolt, Row Contents`. **Bolt Score** (High / Medium / Low) is the score chip on the merge screen, read by the main script (`body.dataset.csvScore`) and stored the first time it is seen; blank if the chip never showed. **Dedup Score** is our own points total for the pair (section 11.2), written as a real number so it sorts and filters numerically (`0` and negative totals are shown; blank when the pair has no analysis yet). The header row is bold, shaded and frozen, and the filter / sort buttons are on Bolt Score, Dept., Scan Date and Merged only. The workbook is written by the script itself (a small stored-zip writer; no libraries). It was an `.ods` before 2.32 (Excel had to repair it and ignored its frozen row); the `.ods` and `.csv` importers were removed in 2.50.
- **Cell colours** (the same in the Database Merge page's download): **Bolt Score** in soft versions of the list view's chip colours (High green `#C8E6C9`, Medium orange `#FFE0B2`, Low red `#FFCDD2`, each with a darker text colour); **Dept.** in the list view's chip colours (Grad/IA blue, UnderGrad purple, Forbidden pink, Appeal amber; any other department stays uncoloured); **Script vs Bolt** in the light yellow of the applicant band (`#FFF9C4`) with dark yellow text (`#9A6700`, no border) when the line starts with *Applicant*, i.e. the script found an applicant side. Colours are cell formatting only: they do not change the values, the filters or the sort order, and importing a file ignores them.
- **Struck-through Spark ID**: on a merged pair the Spark ID that was merged away is struck through (grey, line through) in its Spark ID cell. The kept ID is the side selected on the `Spark Id:` row of the merge screen at the Merge click ('left' = Contact A); if that row has no selected side nothing is struck. The strike is stored as `lostSpark` on the entry, and a re-imported `.xlsx` keeps it (read back from the cell style).
- **Struck-through names**: on a merged pair the first and last name that was **not kept** are struck through too (the side not selected on the First name / Last name row at the Merge click; Contact A = the Firstname / Lastname columns, Contact B = the "2" columns). Nothing is struck when the two names are the same, differ only in case, or one is blank. Stored as `lostFirst` / `lostLast` ('a' or 'b') and read back from the cell font / style on import. (The row labels are matched as `first name` and `last name` / `surname`; if Element labels them differently nothing is struck.)
- **Scan Date** is the day the pair was first scanned (recorded); it moves to the merge day when the pair's merge is confirmed. It is a real Excel date cell shown as `DD/MM/YYYY` (stored internally as `YYYY-MM-DD`), so it sorts chronologically and has Excel's date filters. Re-recording an unchanged pair does not touch it; entries recorded before the column existed are blank until they are recorded again. Import accepts a date cell, `DD/MM/YYYY` or `YYYY-MM-DD`.
- **Merged** is `Y` once the Merge completed card confirms the merge, `N` for a recorded pair that was not merged (skipped, blocked or left for you), and blank for entries recorded before this column existed.
- **Script vs Bolt** is only filled for a merged pair (Merged = Y); it is blank for every other row. It is the auto-merge brief in one line, e.g. `2/3 agree · script chose 1 over Bolt: Email, Address`, `Applicant · script chose 1 over Bolt: Address`, `3/3 agree`, or `Bolt's picks` when the script made no picks on a merged pair. (With *Use picks from = Bolt* the wording flips to `Bolt chose N over script`.) Field names only, no personal data.
- How the data gets there: the main script keeps `body.dataset.csvChoice` up to date for the pair on screen; at the Merge Contacts click it remembers the pair's Spark IDs and the line, asks the database script to record the pair (`elm2-record-pair`), and when the Merge completed card appears sends `elm2-pair-merged` (`detail: { a, b, choice }`), which sets Merged = Y.
- **Upload & Replace**: accepts a password-protected `.xlsx`, an `.elmdb`, and an old unprotected `.xlsx` (shared or inline strings, dates, strike-through read from the cell fonts). The saved password is tried first; a file made with another password asks for it (section 19). Columns are read **by header name**. Names are shortened to 3 letters on import.
- **Clear Database**: asks for confirmation.

### 11.7 UI

Header `Database N` pill (tonal orange, with a database icon in an orange circle; it sits first, left of the Merges pill, and the two join as one pair with big outer and small inner corners when both show), the Database section of the settings pane, the **Show Database UI** toggle (under Display), the API toast and the badges, all in the same orange Material 3 style.

---

## 12. Inter-script contract, storage keys and console output

### 12.1 Contract

| Channel | Direction | Mechanism |
|---|---|---|
| Department + Spark IDs | main → Database | `document.body.dataset.csvDept`, `csvSpark1`, `csvSpark2` |
| Merge Databases button, stored database | merge ← CSV | the merge script puts its button inside `#elm-settings-db-section` (so it exists only while the Database script is active) and reads / writes `localStorage.elm_csv_database`; nothing else is shared |
| Script vs Bolt line, Bolt score, our points | main → Database | `document.body.dataset.csvChoice`, `csvScore`, `csvPoints`; `elm2-pair-merged` event (`detail.a/.b/.choice/.lost/.names`) after a confirmed merge |
| "Record before skipping" | main → Database | `elm2-record-pair` event on `document`; the Database script sets `event.detail.handled` / `.recorded` |
| Blocked-row text | main → Database | `.diff-row.elm2-blocked-row` elements |
| UI injection targets | main → Database | `#elm-controls-wrapper` (badge), `#elm-settings-pane .settings-body` (Database section), `#elm-highlight-rows` row (Show Database UI toggle) |
| Shared toast stack | both | `#elm2-toast-stack` (created by whichever script needs it first) |
| Design tokens | main → Database | CSS variables on `:root` (`--md-primary`, `--md-primary-container`, …, `--elm2-header-color`) |

### 12.2 `localStorage` / `sessionStorage` keys

| Key | Used by | Purpose |
|---|---|---|
| `elm_range_level2` | main | Slider position 0–4 (None, High, Medium, Low, All) |
| `elm_use_picks` | main | `ours` / `bolt` |
| `elm_when_done` (**sessionStorage**) | main | `wait` / `merge`, reset every browser session |
| `elm_merge_countdown` | main | Cancel window seconds (2–15) |
| `elm_auto_skip_blocked` | main | Auto-Skip |
| `elm_next_after_merge` | main | Next after merge (default on) |
| `elm_dedup_path` | main | the path of the Deduplication page, learnt from the list page, for the installed app's shortcut |
| `elm_install_dismissed` | main | the X on the Install as an app card was clicked |
| `elm_pair_ratings` | main | per pair (keyed by the two Spark IDs): `[level code, time, the scoring rules that applied]`, for the score chips on the list (re-rated with the current weights) |
| `elm2_an_view` | main | the Dedup analysis card's view: `ours` (write-up) or `points` |
| `elm_row_pairs` | main | list rows tied to a pair by the click that opened them: a hash of the row's words (no names stored) → `[the pair's key, time]`, up to 4,000 |
| `elm_outcome_toasts` | main | Toasts switch (default on; forced off with the slider on None, forced on while Auto-Skip or auto-merge is on) |
| `elm_highlight_rows` | main | Highlight Rows |
| `elm_allowed_department` | main | Allowed departments (the two checkboxes) |
| `elm_show_merge_counter` | main | Hidden: show the merge counter |
| `elm_merge_count` | main | Merge counter value |
| `elm_csv_database` | Database | Recorded pairs (JSON array) |
| `elm_show_db_ui` | Database | Show Database UI |
| `elm_db_password` | Database | the database password for the shared Excel file, as typed (section 19) |
| `elm_db_login_mark` | Database | a short fingerprint of the signed-in person's ID and when it last changed (section 19); not the ID itself |
| `elm2_bolt_picks` | main | Bolt's original pick per conflicting row (hashed ids, `l`/`r` + timestamp, capped at 2,500 entries). Element451 saves the selection on a pair, so on a second visit the screen shows the last selection rather than Bolt's pick; this keeps Bolt's real pick for the colours and *Use Bolt AI picks* |

**Engagement table.** The dual-personal-email tiebreak reads `#duplicate-engagement-details`: one row per measure, one cell per contact. Real cells read `3 email opens, last open at Jan 11, 2026 - 6:00 AM` or `1 email click, last click at …`, so the measure name is only the label: whatever follows a comma is dropped and singular/plural is ignored (`email open(s)` → `email opens`, `email click(s)` → `email clicks`). Before this, only cells with a count of 0 (no trailing text) were recognised, so the tiebreak never saw the opens and clicks of a contact that had any.

**Value buttons (page layout).** Each `.diff-row` has a title, two value buttons (`button.diff-value-button`, left = Contact A, right = Contact B) and the arrows in `.diff-actions`. Element451 now wraps each value button in `<div class="diff-value">` next to a copy button (`button.diff-value-copy`), so the scripts find the value buttons anywhere in the row (`row.querySelectorAll('.diff-value-button')`), which works for both the older direct-child layout and the wrapped one. Searching only the row's direct children finds no values at all, which silently breaks reading Spark IDs, conflict detection and the picks.

### 12.3 Console output (page console, F12 → filter `elm2` or `Database`)

- `[elm2] Blocked: …`, `[elm2] Not blocked — allowed dept: …`, `[elm2] Resolution done — …`, `[elm2] Suggestions by rule: {…}`
- `[elm2] Skipping to next pair: <reason>`, `[elm2] Auto-merging pair`, `[elm2] Auto-merge not done: <reason>`
- `[elm2] page jump: direct …` or `… clicking First / Next …`
- `[elm2] script click on button: "…"` for script-generated clicks, and a warning with a stack trace if one is blocked by the click guard.
- **Database script** (silent while recording works): if the pair on screen has not been recorded for 5 seconds, one warning says why: `[Database] the pair on screen is not being recorded: <reason>`. The reasons are: the main script has not reported the pair yet (no department signal), no Spark IDs on the page, the Spark IDs the main script reported do not match the page, the contact names have not loaded, or the browser would not save the database (storage full?). The warning prints again only if the reason changes, and a failed save logs its error once, not on every retry.
- **`[elm2] No Spark IDs found on the pair on screen …`** (main script): printed once per pair when no Spark ID has been read for 4 seconds; it lists how many rows the page has and the rows that mention "spark", with every long word or number blanked out. Spark IDs are read tolerantly: `Spark Id: abc`, `Spark ID:abc`, `Spark Id abc`, or a row labelled "Spark Id" that holds only the value.
- **No personal details in the console.** The lines above name fields, rules, counts and reasons, never a contact's values. The analysis line (`[elm2] analysis: … | read (values masked): {…}`) shows what was read with every letter turned into `x` and every digit into `9` (`"dob":"9999-99-99"`, `"emails":["xxxxx@xxxxx.xxx"]`), so it can be pasted into a bug report; `Needs review:` names the field only; `Merged 3/40` no longer repeats the card's sentence; the history record sample is masked the same way.
- **`[elm2] <step> failed (logged once; the other steps keep running)`** / **`[Database] <step> failed (logged once)`**: one of the timer steps threw (usually Element451 changed a piece of markup). The step is tried again on every tick, the other steps are not affected, and the error is printed once per step and message instead of every tick.
- **Score chips** (main script): `[elm2] chips: 25 on the list: 3 rated (2 by Spark IDs, 1 by the row you opened), 22 Pending (20 with no Spark IDs from the Database script, 2 not opened yet, 0 rated before 2.270: reopen). …` is printed whenever those counts change. When a pair is rated: `[elm2] chips: rated the pair on screen (Spark IDs …1234, …5678): High. List row with these Spark IDs: yes / none of 25 rows; row opened by a click: yes / no.` Spark IDs show only their last 4 characters. Type **`elm2ChipReport()`** for a table of every chip: where it is (list row, sidebar, another kind of row), the row's Spark IDs (last 4 characters), what it shows, how it was rated and why it is Pending (`nosparks`, `unrated`, `old`).
- **Database script, list**: `[elm-db] list API: records 25, with 2+ Spark IDs 25 (from identities[].value); fields of a record: _id, name, …` when list data is captured (field names only, never values), and `[elm-db] list: 25 rows: 25 tied to a list record (25 by name), 25 of those records with Spark IDs, 12 matched to the database, 25 given Spark IDs for the score chips` whenever the counts change.
- **`elm451Debug()`** (type it in the console on the page): prints and returns the Database script's state: its version, the number of entries and their size in KB, whether the browser storage is writable, whether you are on the review page, the main script's signals (department, Spark IDs, choice, score), the Spark IDs and names read from the page, whether the main script is loaded and whether the scripts run through the extension, and the last recording problem.

---

## 13. Known limitations and unverified guesses

- **Merge-success detection**: the "Merge completed" card (`bolt-card.merge-completion-state`) is the signal (it counts the merge, shows the `Merge: …` toast, sends the pair to the database as Merged = Y and presses Next duplicate). If Element's own "Skip merge completion screen" switch is on, that card never shows; the script then falls back to "the pair on screen changed after Merge Contacts was clicked", which cannot press Next duplicate for you.
- **Score chip reading** assumes the chip text contains `high` / `medium` / `low`.
- **Dedup analysis** (section 10.6) reads field labels by keyword (birth, phone, email, address, first/last name, CAS, Coyote or School Id, student type, academic level, school attended); unverified for labels not yet seen on the live site. The console line `[elm2] analysis:` shows what was read for each pair.
- **Applicant detection** depends on the Workflows/Application rows being loaded; it re-checks about 0.6 s later, but a very slow load could mislabel a pair.
- **Rows per page** cannot be changed from the script, and the original classic page-size box was dropped. The main script now runs with `@grant none` (build 100) so Angular's paginator component may become reachable; the page-jump console line shows which route is used.
- **Merge script duplicates**: the Database Merge script's name-based key treats a blank second name as the first, so an old row with full second names and a new row with blanks still count as the same pair.
- **Name matching for list badges** is a weak fallback because only 3-letter prefixes are stored; Spark IDs are the real key, and the list API must carry them (it does, in `identities[]`).
- **Email rule**: when both emails are personal, the engagement numbers (email opens, then clicks) decide; if those tie and no name or birth year in the addresses separates them either, no pick is made and, unless Bolt picked, the pair is left for manual review.
- **Unverified on the live site** (built from pasted HTML, mock pages and screenshots): the History page search box placement and which fields the history records carry; the First name / Last name row labels used to strike through discarded names in the export; whether Excel opens the `.xlsx` without a repair; the engagement panel toggle (`elm-duplicate-engagement-panel button.engagement-toggle`); how the kart layers with Element's dimming; and the extension's GitHub fetches until the first release exists.
- The classic **scroll-to-bottom** requirement and **Auto-Click FAB** do not map onto this layout and were not ported.
- Element's DOM may change; selectors are listed in `getDiffRows`, the CSS blocks, and the pager/filters code.

---

## 14. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| A feature seems missing or a popup shows twice | Duplicate or disabled Tampermonkey install; check the version lines in the gear pane and each script's version. In Chrome with both Tampermonkey and the extension, each script has a guard so only one copy runs |
| Extension popup says "One setting to turn on" | Open the extension's Details and turn on **Allow user scripts** (Developer mode on Chrome 120-137); then reload the Element451 tab |
| Extension installed but a script does not run | Check its switch in the popup (Database needs UI Perfection on; Database Merge needs Database, and so UI Perfection too: a row whose script needs one that is switched off is greyed out and says "needs …"); reload the tab after changing a switch |
| No "Update available" chip | It appears only after a newer GitHub Release exists and Chrome has been restarted (or the extension reloaded) |
| Database buttons / badges still blue or old | The Database script on your side is an older copy; check it shows the latest `@version` |
| Nothing is auto-applied | Slider on None, pair out of range, or **Use picks from = Bolt's** (nothing to apply) |
| Everything gets skipped | Slider None, or no Allowed department ticked, with Auto-Skip on = scan mode |
| Auto-merge never runs | When done is Wait for me (it resets every session), slider on None, or the final gate failed (see the toast / `[elm2] Auto-merge not done`) |
| Skips lose database entries | Make sure both scripts are the latest builds (the record-before-skip handshake) |
| Scan stalls after a few pairs | Fixed in build 81 (queue position in the pair key, retrying Next); update the main script |
| A selected filter chip is blue | Element's own style won; send the chip's HTML so the selector can be added |
| List score chips stay Pending | Filter the console on `chips`. *with no Spark IDs from the Database script*: the list API's records carry no Spark IDs (see the `[elm-db] list API:` line) and the pair is not in the database yet; open the row by clicking it, and its chip follows. *not opened yet*: the row has Spark IDs but no pair with those IDs has been rated; compare the last 4 characters in `elm2ChipReport()` with the `rated the pair on screen` line. *rated before 2.270*: reopen the pair |
| API toast inconsistent | Fixed in Database script v2.18+ (toast on every fresh capture) |

---

## 15. Change history (summary)

- **Initial port**: both classic scripts copied and adapted to the new layout (diff-form rows, queue table).
- **Safety**: auto-skip never clicks Dismiss; Dismiss/Confirm click guard; Merge Contacts is never clicked unless auto-merge is enabled.
- **Colours and AI**: Bolt-pick recording, green/blue/orange pick colours, applicant yellow band, comparison bar with *Use Bolt AI picks / Use our picks*, score-chip colours, pinned queue nav, Material 3 restyle of the gear, settings pane, toggles and slider.
- **Automation rework**: slider None → High → Medium → Low → All (an earlier build had an Applicant stop, removed because applicants can have any score), **Use picks from**, **When done** with the cancel countdown (dialog with draining stepped ring), **Merge countdown** setting, Auto-Skip covering blocked / out-of-range / twins pairs, no popups for skipped pairs, scan mode.
- **Database v2**: keyed on Spark IDs (the URL no longer changes), names stored as 3-letter prefixes, two-contact columns, header-based import, list matching via the list API's `identities[]`, record-before-skip handshake, right-aligned badges, Show Database UI toggle, shared toast stack.
- **Website restyles**: orange Material 3 palette sampled from Element's header, Material 3 tabs, compact Advanced Filters panel, list pager (Page box + Go), hover preview on the comparison buttons, gear icon as an SVG.
- **Auto-merge polish**: Toasts switch, short auto-merge brief, countdown timing (exact N seconds, 4 s race lights), wavy ring, panel-scoped overlay, Next after merge, the coyote go-kart.
- **History search**: search every page of the History list through the history API, with Previous / Next match (see section 10).
- **Search bar style**: Material 3 Expressive search bar for Element's header search and the History search.
- **Database**: Bolt Score, Merged and Script vs Bolt columns, an `.xlsx` export (frozen header, widths, filters on Bolt Score / Dept. / Merged, struck-through Spark ID and names), `.xlsx` import (section 11).
- **Engagement tiebreak**: dual personal emails are decided by email opens, then clicks, from the engagement panel (section 7).
- **Database Merge**: a third, optional script that merges several exported databases on a page of its own (section 17).
- **Chrome extension**: unpacked extension that runs both scripts and updates them from GitHub when Chrome starts, popup with switches, build + release workflow (section 16).
- **Versions**: the settings pane lists Main script, Database script and Extension versions in one style.
- **Our own rating**: a points-based rating and plain-English write-up replace Bolt's overview card; score chips show our rating, or Pending (section 10.6).
- **Stability and security pass** (UI 2.266, Database 2.67, Database Merge 1.15, extension 1.0.4): section 18.
- **Protected database files** (Database 2.69, Database Merge 1.16): every download is a password-protected `.xlsx` to share, or a personal `.elmdb` locked to your Element451 login; section 19.
- **ID weights ±120** (UI 2.272): a matching Coyote ID or CAS ID is +120 and different ones are -120 (were +100 / -100 and +80 / -80).
- **Birth date mismatch -45** (UI 2.271): was -60.
- **SCORING.md** (generated chart of the scoring system, kept in step by `npm test`; `npm run scoring` regenerates it).
- **Applicant row highlight** (UI 2.298, 2.299): the row that identifies the applicant gets its own amber frame and tint on the applicant's side, over the band and outline.
- **Smoke tests removed** (UI 2.304): `scripts/smoke-test.js` and `scripts/smoke-test-store.js`, and the workflow steps that installed Chromium and ran them. `npm test` now runs only the Node tests.
- **One Forbidden chip** (UI 2.305): test records and names on the forbidden list read *Forbidden* instead of *Test* / *Forbidden name*, like different School IDs (2.303) and the list's badge. The reason is in the chip's hover text and the write-up.
- **The side with a School / Coyote ID leads** (UI 2.304, Database 2.75): when only one contact has a School Id (or a coyote.csusb.edu email, the same ID), every conflict row follows that side, exactly as with an applicant (a row where that side is blank still takes the side with data). If the applicant is the one without an ID and the other side has one, the ID side wins. Same UnderGrad-only gate as the applicant rule. The band, outline and extra row highlight mark it, the row highlight on the row that shows the ID; the brief and the database's *Script vs Bolt* column say *Coyote ID* where they said *Applicant*. The score still counts only a real applicant (the -40).
- **Forbidden chip for different School IDs** (UI 2.303): a pair with two different School IDs is blocked, and now shows a Forbidden chip and a *Blocked: …* line in the write-up, like the list's badge (it had neither).
- **Matching rows are read (UI 2.297, 2.301)**: Element's "Hide matching items" switch leaves only the differing rows on the page, so an Appeal or test keyword, a School ID or a department marker in a row both contacts share went unseen, and the score had to take matching fields from Bolt's bullet list. For each new pair the script now turns the switch off, reads every row into a snapshot, and puts the switch back to the state it was in. The score, the blocker checks and the department check read the rows themselves; scoring no longer uses Bolt's bullet list. (2.297 kept the switch off with a setting in the pane; 2.300 kept it off with no setting; 2.301 restores it after the check; 2.302 confirms each click by the switch changing state, and logs `[elm2] Matching rows:` lines to the console.)
- **Bolt "different people" is -10, and takes back Bolt's bonus** (UI 2.295, 2.296): was -25. It now costs the same as Bolt's Low score, and when Bolt says different people the +10 (High) or +5 (Medium) it would have added is not given.
- **Appeal and Forbidden checkboxes** (UI 2.294): two new checkboxes next to the departments under Allowed departments. Ticked, an Appeal or Forbidden pair is worked on instead of blocked (both default off, so nothing changes unless you tick them); the chip stays as a note and the Database script still records the pair as Appeal or Forbidden. Section 4.7.
- **Forbidden names kept as hashes** (UI 2.293, and the v1 script): the hard-coded forbidden-name list is stored as SHA-256 hashes of the lower-case full name, so the names are no longer readable in the code or the docs. Blocking works as before (spaces inside a name are now collapsed before comparing).
- **Real student details removed** (UI 2.292): examples taken from screenshots are replaced with made-up ones.
- **A Bolt error is a -5, not a stop** (UI 2.291): a pair whose Bolt score chip reads Error used to halt the whole run (no resolution, merge or skip, even with Auto-Skip on). It is now rated by our own points like any other pair, with Bolt's analysis failing counted as -5, and the write-up and the Points view say so.
- **Auto-merge stops are visible and retried** (UI 2.290): a pair that needs review now shows `Not merged: needs review (…)` (it used to stay silent); a Merge Contacts button that is still disabled is waited for (up to 8 s, before and after the countdown) instead of ending the merge; a merge click with no *Merge completed* card within 6 s shows a toast; and on High / Medium / Low the script waits up to 10 s (was 3 s) for the rating before judging the pair, because a pair is only judged once.
- **Strong matches marked again** (UI 2.289): the Points view tags strong matches again and SCORING.md's points table has a *Strong match* column (an ID, birth date, exact email, phone, address), both for information: the rating stays points only.
- **Bolt's own score weighs less** (UI 2.288): Bolt High +10 (was +20), Medium +5 (was +8), Low -10 (was -5). *Same name only, Bolt High* drops from 50 (Medium) to 40 (Low); the other samples keep their rating.
- **Points only** (UI 2.287): the rating is the points alone, 70+ High and 45+ Medium; different Coyote IDs still make it Low. High no longer also needs a matching Coyote or CAS ID or two strong matches (birth date, exact email, phone, address), so a pair with 70+ points and one strong match, or none, is High: *same birth date and name* (70), the Lan Vo pair (70), *same name, address and soft fields with Bolt High* (90).
- **No possible-twins check** (UI 2.286): it no longer skips pairs (Auto-Skip on), stops them or keeps them from auto-merge; the score alone decides (section 8). Twins and siblings at Medium can now be auto-merged by a slider that includes Medium.
- **One name inside the other** (UI 2.286): a first name whose every word is a word of the other record's first name is the same first name (+15): *Lan* and *Tran Mai Lan* (a family name put first, or a full name typed into the first-name field), *Ana* and *Ana Maria*. It used to be a different first name (-30). *Mai Lan* / *Mai Linh* still differ.
- **The Identities section is read** (UI 2.285): values that name themselves are read wherever they are, so the Identities rows (labelled *Identities* or nothing) count: `School Id: …`, `Cas Id: …`, `Email: …` and `School Email: …`. A **coyote.csusb.edu address is the student's Coyote ID** (`009000001@coyote.csusb.edu`): a side with no School Id takes its Coyote ID from it, so a School Id on one record and the same number in the other's coyote email is the same Coyote ID (+120, enough for High). An ID read from an email only confirms: if it differs from the other record's, it scores nothing (a mistyped email never makes a hard conflict). The Maria Soto pair (School Id 009000001 on one side, 009000001@coyote.csusb.edu on the other) goes to High.
- **Matching gender +5** (UI 2.284): the same gender on both records is +5, like student type, level and school; a different or missing one is 0. A gender that matches is read from its row like any other (the matching rows are kept on the page).
- **A cover while a pair is read and scored** (UI 2.311): while the matching rows are shown, read and hidden again (and, for up to 4 s, while Bolt's overview has not shown yet) the fields are covered by a white layer with a Material indeterminate circular progress in the primary orange. It hides the rows appearing and disappearing, and blocks clicks and keys on the fields (Escape still cancels an auto-merge). It never stays longer than 8 s; the console says when it gave up. The Dedup analysis card shows pulsing placeholder lines (a skeleton) in the meantime instead of Bolt's own text, for at most 8 s per pair.
- **A skipped pair gets its chip** (UI 2.310): Auto-Skip moved on 1.2 s after a pair loaded, which is sooner than Bolt's overview often rendered, and a pair's rating is only worked out (and remembered for its list chip) once that overview is there, so skipped pairs stayed Pending. A skip now waits for the rating, for 5 s at most, before it records the pair and moves on.
- **List chips: rows are tied to their records by the names inside `master` / `duplicate`** (Database 2.76): the list call's records hold the two contacts as `master` and `duplicate` objects and have no top-level name, so no row was ever tied to its record by name (the console said "0 tied to a list record") and the rows got Spark IDs only from the database; a reviewed pair with no database entry stayed Pending. Names are now read from those objects (a full-name field, or first + last, one object level down), and a row matches when it shows the whole name or the first and last word. The `[elm-db] list API:` console line now also says how many records gave both names and lists the field names of `master`.
- **Gender is no longer scored** (UI 2.309): the +5 for the same gender is gone (2.284 added it), and the script no longer reads a gender row at all. A remembered rating that holds the old gender point is re-rated without it.
- **Orange Write-up / Points / Bolt's control** (UI 2.308): the selected segment was Bolt's blue; it now uses the same orange container colour as the rest of our UI (it follows Element's header colour).
- **Hide matching items is put back reliably** (UI 2.307): the step that turns the switch back on no longer depends on the pair staying the same (a re-render that changed the pair key could leave it off); it runs first on every tick and clicks again, up to six times, until the switch is on. The switch's state is read from `aria-checked` when it has one (the selected class only otherwise). Each click logs the switch's `aria-checked` and class to the console.
- **Different CAS IDs are -18** (UI 2.306): was -25. Still not a hard conflict.
- **Different CAS IDs -25, not a hard conflict** (UI 2.283): a student can have several applications, so two CAS IDs no longer cap a pair at Low (they were -120 and hard). A matching CAS ID is unchanged: +120, a strong match, enough on its own for High. *Different CAS IDs, same name and birth date* goes from Low (-50) to Medium (45). Only different Coyote IDs are a hard conflict now.
- **Name in email, in part too** (UI 2.282): an email that holds the other record's name scores whether or not the two records' names match (it used to count only when the first names differed). Partial names count: the first 3+ letters of the first name with the last name (`mar.soto`, `juli_soto`) +4, besides first + last +6 and initial + last +3; the first or the last name alone +2. One word of a last name of several is enough (*Soto* of *Del Rio Soto*). Still capped at +10 for the pair. The Maria Soto pair (`maria.soto444` / `maria.soto1111`) goes from 37 (Low) to 47 (Medium). Combinations that move from Low to Medium: the same name with Bolt Medium and name-based emails; the same first name and an overlapping last name with Bolt High; and that same first / overlapping last pair with emails that differ only in the numbers. None reaches High.
- **Phone back to +25** (UI 2.282): undoing the +30 of UI 2.280.
- **Emails that differ only in the numbers** (UI 2.281): `maria.soto444` and `maria.soto1111` count as the same name part (+15), like the same name part on another domain. Numbers, dots, dashes and underscores are left out of the comparison and at least 5 letters must remain, so initials such as `jd1` / `jd2` do not count.
- **Phone +30** (UI 2.280): a matching phone number is +30 (was +25). Three pairs move from Low to Medium, each landing on 45: same phone and last name only; same phone and first name only; parent and child (same phone, address and last name, different first name) that Bolt rates Medium.
- **CAS ID marks the applicant** (UI 2.279): when the application rows name no applicant, a CAS ID on one side only makes that side the applicant (picks, the applicant band, and the -40 *Applicant vs Coyote ID* rule when the other side has a Coyote ID).
- **Generated passwords** (Database 2.74): the password dialog's **Random password** (12 characters, about 73 bits) and **Passphrase** (three everyday words from the EFF list, with awkward ones taken out, and a number; about 48 bits) buttons, with **Copy** (section 19).
- **Dedup analysis card: chips, a points view, no popups** (UI 2.278): department, Appeal, Test (a name with *test* in it) and Forbidden name chips and Bolt's original score beside our score; *Blocked: …* lines and *Bolt's original score* in the write-up; a Write-up / Points / Bolt's switch, the Points view being a table of the rules that applied and why the total is the rating it is. The Appeal and Possible-twins popups are gone (section 8); the twins check still skips (Auto-Skip on) or stops, and never auto-merges.
- **Score chips: the row you open, and console lines** (UI 2.277, Database 2.73): a list row is tied to its pair a second way, by the click that opens it. The first different pair rated after a click on a row is that row's pair, and the tie is kept by the row's own words (names, emails), so it outlives a reload. Moving on with Next, without a click, ends the tie, so no other row is tied by mistake. Each row is also given both sets of Spark IDs, the list record's and the database entry's, and the chip tries each. New console lines say why a chip is Pending (section 12.3). Before, a row whose list record and database entry gave no usable Spark IDs stayed Pending with nothing in the console to say why. A chip outside a list row (the review sidebar's) is rated as the pair on screen; a chip in a row that is not a `bolt-row.cdk-row` is now rated as its row, never as the open pair.
- **The list follows the profile you are viewing** (UI 2.276, Database 2.72): the list is annotated while a profile is open (it was skipped, so on a first load a row was only tied to its pair after the profile was closed), is annotated again about 150 ms after a pair is recorded, and the list's chips are updated in the frame a pair is rated. The chip of the profile on screen turns from Pending to its rating within about a second, and the next profile's follows.
- **Names weigh more** (UI 2.275): a same first name is +15 (was +7), a nickname or initial +7 (was +3), a different first name -30 (was -12); a same last name is +15 (was +8), overlapping +7 (was +4), a different last name -15 (was -8).
- **List chips follow the weights** (UI 2.274): pairs are remembered as the scoring rules that applied and re-rated with the current weights, so a weight change updates the list without reopening pairs (it used to keep each pair's old rating until it was opened again). Bolt's bullet *address: match when accounting for formatting differences* is now read as a match (the word *differences* made it read as a mismatch).
- **A matching address is a strong match** (UI 2.273): with one other strong match (birth date, exact email or phone) and 70+ points the pair is High, so *same birth date + name + address*, *same name + email + address* and *same name + phone + address* (with Bolt High) are High. Pairs that share an address but not a first name (twins, siblings, parent and child) stay Medium, because a different first name costs points. Name, address and soft fields alone are still never High: that is one strong match.
- **ID match is enough for High** (UI 2.270): a matching Coyote ID or CAS ID with 70+ points and no hard conflict is High without a second strong match (it used to stay Medium however many points it had).
- **Scoring weights** (UI 2.269): address match +25, student type / level / school +5 each, applicant vs Coyote ID -40; a different birth date is no longer a hard conflict; the twin-pattern penalty is removed; section 10.6.
- **Dedup Score column** (UI 2.268, Database 2.71, Database Merge 1.17): our points total is recorded with each pair, exported, imported and merged; section 11.2.
- **List score chips** (UI 2.267, Database 2.70): chips show on a first load and no longer take another page's rating; section 11.5.
- **Fixes along the way**: stall on identical consecutive names / disabled Next button, twins warning signal count, cut-off date text in filters, clipped filters panel, selected-chip colour specificity.

## 16. Chrome extension

The scripts (the two main ones and the optional Database Merge script) can also run as an unpacked Chrome extension (Chrome / Edge, Manifest V3). Firefox keeps using Tampermonkey with the same `@updateURL` links.

**What it is.** A thin wrapper in `extension/`: a service worker (`background.js`), a Material 3 Expressive popup (`popup.html/.css/.js`), icons and a manifest. The two scripts are not copied by hand: `scripts/build-extension.js` takes them from the repo root, so the userscripts stay the single source of truth.

**How the scripts run.** The service worker registers them with the `chrome.userScripts` API (`world: 'MAIN'`, `runAt: document_idle`, match `https://*.element451.io/*`), the same mechanism Tampermonkey uses, so they run in the page's own JS world exactly as before (they wrap the page's `fetch` / `XMLHttpRequest` and read Angular internals). Settings, the database and the merge counter stay in the page's `localStorage`, so the in-page settings pane works unchanged.

**One setting to turn on.** Chrome gates that API: Chrome 138+ needs **Allow user scripts** on the extension's details page (`chrome://extensions` → Details); Chrome 120-137 needs Developer mode. Tampermonkey needs the same switch. Until it is on, the popup shows a card with a button that opens the extension page.

**Auto-update.** When Chrome starts, and once right after the extension is installed or reloaded (no timers, no polling):
- the scripts are fetched from `https://raw.githubusercontent.com/totallygeekdom/csusb-de-dup-extension/main/` and re-registered only if the file changed (compared by `@version` and content); the copy that runs is whichever has the higher `@version`, the downloaded one or the one bundled in the zip, so a newer zip is never held back by an older cached copy and an older GitHub copy (e.g. while `main` is behind the zip) never replaces a newer bundled one; the bundled copy is also what runs when GitHub is unreachable;
- the latest GitHub Release is checked (`api.github.com/.../releases/latest`); if its tag is newer than the installed extension version, the toolbar icon gets an `↑` badge and the popup shows an **Update available · vX.Y.Z** chip above the script list.
Chrome cannot update an unpacked extension by itself, so the chip downloads the release zip and a sheet lists the steps: unzip over the extension folder, open `chrome://extensions`, click reload. The chip can be dismissed (it returns for a newer version).

**Popup.** The title; an **Update available** chip (only while a newer extension release exists); one row per script (UI Perfection, Database, Database Merge) with a switch and its version (Database is greyed while UI Perfection is off, Database Merge while Database is off); a **Reload tab** prompt after a change; and a footer with the extension version. The extension asks only for the `storage` and `userScripts` permissions plus access to `*.element451.io`, the script source on GitHub and the releases API. It follows the system's light or dark setting.

**What is accepted from GitHub.** The downloaded scripts run inside Element451 with the signed-in person's access, so a download is only used when it is one of this project's userscripts: it must start with the userscript header, carry `@name Element451 - …` and a plain numeric `@version`, and be of a plausible size. A sign-in page, an error page or a cut-off file is ignored (a console warning says so) and the copy already in use stays. The release check only accepts a numeric version and a link under this repository's GitHub releases (anything else opens the releases page); the popup writes the version as text. Requests give up after 20 seconds. The trust boundary is unchanged and worth knowing: **whoever can push to this repository's `main` branch can change what runs in Element451 for everyone using the extension or the Tampermonkey update links**, so protect the branch (required pull requests, two-factor sign-in on the accounts that can merge).

**Self-repair.** Opening the popup registers any switched-on script that is not registered, which covers **Allow user scripts** being turned on after the install (Chrome does not tell the extension when that switch changes).

**Extension storage** (`chrome.storage.local`, not the page's): `enabled` (per-script switches), `cache` (the scripts last downloaded from GitHub, with their versions), `shellUpdate` (a newer extension release, if any) and `dismissed` (the version whose update chip was dismissed).

**Chrome Web Store edition.** `extension-store/` holds a second wrapper with its own `manifest.json` (own version, `1.0.0` first), `background.js`, `popup.html` and `popup.js`; the icons and `popup.css` are shared with `extension/`. It differs from the extension above in three ways: it has no `userScripts` permission (the bundled scripts are registered with `chrome.scripting.registerContentScripts`, `world: 'MAIN'`, `persistAcrossSessions`, with the build-written `scripts/ext-version.js` first so the settings pane can show the extension version), it downloads nothing (no GitHub fetch of scripts or releases, no `cache`, no update chip), and Chrome Web Store updates it (a new script version means a new store version: bump `extension-store/manifest.json` and upload the zip). Permissions are `storage`, `scripting` and `https://*.element451.io/*`; the build fails if the manifest asks for more. Build: `npm run build:store` (writes `dist-store/` and `elm451-dedup-tools-store-v<version>.zip`); CI publishes a release tagged `store-vX.Y.Z` when that version has none (never marked "latest", so the other extension's update check ignores it). See STORE.md.

**Both installed.** Each script starts with a guard (`window.__elm451UiPerfectionLoaded`, `window.__elm451CsvDatabaseLoaded`, `window.__elm451DbMergeLoaded`) so a copy in Tampermonkey and the extension never run twice on a page.

**Build and release.** `.github/workflows/extension.yml`:
- every pull request and every push to `main`: `node scripts/build-extension.js` (syntax-checks the scripts, writes `dist/extension/` and `dist/elm451-dedup-tools-v<version>.zip`), then `npm test` (database file protection, forbidden names, merge rules, the score engine and the `SCORING.md` check; no browser is installed), and the zip is kept as a workflow artifact. (The browser smoke tests that used to load the extension in Chromium were removed in UI 2.304; they are in the git history.);
- a **release** is published when the extension's version has no GitHub Release yet: on a push to `main`, the version in `extension/manifest.json` decides (`1.0.0` becomes the tag and release `v1.0.0`, created by `gh release create` on the pushed commit); on a pushed tag `vX.Y.Z` the version is taken from the tag. If that release already exists nothing happens. So **releasing = bump the version in `extension/manifest.json` and merge to `main`**; a merge that only changes the userscripts needs no release, since they update themselves from `main`.
`npm test` runs the Node-only tests, starting with `scripts/protected-files-test.js` (the database file protection of section 19). Locally: `npm install` once, `npm run build`, `npm test`; load `dist/extension` with **Load unpacked**. `npm run icons` re-renders the icons.

**Install.** Download the zip from Releases, unzip it, open `chrome://extensions`, turn on Developer mode, **Load unpacked** and pick the folder, then open the extension's **Details** and turn on **Allow user scripts**. Reload your Element451 tab.

**Limits / unverified.** The end-to-end test switches the API on through `chrome.developerPrivate` (what the toggle does), not by clicking it; the GitHub fetches (scripts and releases) were not exercised in CI; the release step runs only on `main` / tags, so it is verified by the first release.

## 17. Database Merge

`database-merge-v2.js` (optional) combines several databases, for example ones exported by different people or on different days, into one.

**Link to the Database script.** Only two things: the **Merge Databases** button is added inside the Database section of the settings pane, which the Database script creates (so the button only exists while the Database script is active), and the current database is read straight from `localStorage.elm_csv_database`, so it can be merged without downloading it first. Everything else, reading `.xlsx` and writing the merged `.xlsx`, is the script's own copy of the Database script's file code (keep the two in step when the file format changes). It is installed and updated like the others; in the Chrome extension it is a third switch in the popup (greyed while Database is off), and the settings pane lists `Database merge · vX.Y` under the database script's line.

**The page.** The button opens a new tab, built from the Element451 page with DOM calls (no inline scripts, so the site's content-security policy cannot block it). It is a calm Material 3 page in the orange of the settings pane: a small title with a badge, a dashed drop zone, sources as list rows with leading icons, tonal stat cards, per-source chips, conflicts as cards with chips (the kept copy has a check), a Material dialog for the Replace confirmation and a snackbar for messages, with little motion; it follows the system's light or dark setting. The Element451 tab has to stay open while the merge page is in use. In dark mode it uses the same deep colours as the extension popup (page `#110e0c`, cards `#2a2420`, text `#f6ebe4`) so the cards stand out clearly.
- **Sources**: drop or choose any number of database files (password-protected `.xlsx`, `.elmdb`, or old plain `.xlsx`; a file the saved password does not open asks for its own, section 19); a table lists each source with its entry count, merged count and Scan Date range, and a **×** to remove a file. "This browser's database" is a source too, ticked by default; at least two sources are needed.
- **Rules** (shown on the page): a pair is the same pair when both Spark IDs match, in either order (entries with no Spark IDs fall back to the two contacts' 3-letter names). If it appears more than once, **the most up to date copy wins**: the later Scan Date (a pair's Scan Date moves to the merge day when it is merged, and a dated entry beats an undated one). On the same date a merged copy beats an unmerged one, and after that the source higher in the list stays. The winner keeps its own fields, filling a blank Bolt score from the other copy. Whichever copy wins, a blank **Bolt Score** or **Dedup Score** on it is filled in from the other copy.
- **Breakdown** after **Merge**: a one-line summary ("7 entries from 2 sources became 4 pairs…"), then four tiles (pairs in the result, duplicates dropped, already merged, differences to check); a per-source list (entries, how many were kept in the result and how many were dropped because a newer copy is in another file, so kept + dropped always equals the source's entries); and a conflicts table (the same pair in a different department or merged state in two sources, with which copy was kept; first 200 shown).
- **Result**: **Download merged database (.xlsx)** (same format as the Database script's export) and **Replace my database with this** (asks first, then writes `elm_csv_database`; the header counter follows within a second). Nothing in the browser changes until Replace is pressed.

**Not verified live:** the new-tab page was tested in headless Chromium against mock databases; pop-up blockers can stop the new tab (the script says so).

---

## 18. Stability and security pass

A review of all three scripts and the extension for efficiency, stability and unsafe shortcuts. What changed, and what was looked at and left alone.

**Stability**
- **A failing step no longer stops the rest.** The main script runs about twenty steps every 750 ms, the Database script five timers. One step throwing (Element451 changing a piece of markup is enough) used to skip every step after it, on every tick, and print the error each time. Each step now runs on its own and reports once (section 12.3).
- **Full browser storage no longer stalls the queue.** The database, the settings and the merge counter share the site's few MB of `localStorage`. With it full, writing the merge counter threw inside the merge-completed handler, so **Next duplicate** was never pressed and the automation stopped. Every storage read and write in the main script now goes through guarded helpers (`lsGet` / `lsSet`).
- **The database says when it is not saving.** A refused save was only a console line. It is now a toast on the page (the merge panel included), repeated once a minute while it lasts; the header pill's tooltip and a one-time toast warn when the database passes about 4 million characters (the browser allows about 5 million for the whole site). **Upload & Replace**, **Clear** and the Merge page's **Replace** report a failed save instead of announcing success.
- **Page jumps** fall back to clicking First / Next when Angular's paginator object refuses the direct call (it is not a public interface and can change at any Element451 release).
- **Stores stay in step across windows.** The remembered ratings and Bolt picks are re-read when another tab or the installed app changes them.
- **The build fails** when a script's `const VERSION` (shown in the settings pane) differs from its `@version` (the Database script had drifted).

**Efficiency**
- The merge-completed check ran on every DOM change of the page (hundreds while a pair renders); it now runs once per burst.
- The Database script watched the whole page for changes on every Element451 page whenever no queue table was on screen; it now watches the queue table only and looks for it twice a second.
- The store of Bolt's picks (up to 3000 entries) was parsed again for every undecided row on every tick; it is parsed once.
- Blocked-pair styling, the header colour and Bolt's blue are written only when they change (a blocked pair was restyled every tick), and the Database script's toast clean-up no longer forces a layout every 300 ms.
- On a mock page with a DOM change every 4 ms, the scripts' own script time over 8 seconds fell from about 450 to 520 ms to about 180 to 200 ms. That is a mock, not Element451 itself.

**Security and privacy**
- The request hook kept a copy of the headers of **every** request the page made (they include the sign-in token). It now keeps them for the one history call it replays, in memory only, and its own bookkeeping can no longer make a page request fail.
- Console lines no longer contain names, dates of birth, emails, phone numbers or IDs (section 12.3).
- The extension checks what it downloads and what it shows (section 16).

**Looked at and left as it is**
- **Wrapping the page's `XMLHttpRequest` / `fetch`** is how a userscript reads the list and history data; there is no supported alternative from inside the page, and both wrappers pass every request through unchanged.
- **`localStorage` as the database.** It is synchronous, shared with the site and limited to a few MB, but it is what lets the three scripts and Tampermonkey share one database with no extra permission. With the warnings above the limit is visible well before it is reached; moving to IndexedDB would be a rewrite of the Database and Merge scripts.
- **Updates only when Chrome starts** (section 16) is by design; a browser left open for weeks keeps its scripts until it restarts or the extension is reloaded.
- **Reading Angular's paginator** through the element's internal context is fragile by nature; it stays because the click fallback covers it.
- **Selectors and label keywords** for Element451's markup remain the main source of breakage (section 13); nothing here can make them stable, but a broken one now fails one step instead of the loop.

---

## 19. Protected database files

A downloaded database used to be a plain `.xlsx`: anyone who got the file could read it. Every download is now protected, from the Database section of the settings pane and from the Merge Databases page alike. There is no unprotected download. **Download** offers two forms, for two purposes:

| | Excel file, to share (`.xlsx`) | Personal file (`.elmdb`) |
|---|---|---|
| For | sending to coworkers, opening in Excel | your own copy: a backup, or moving your database to another computer |
| Opens with | the database password | your Element451 login. No password |
| Opens in | Excel, after it asks for the password; also Upload and Merge Databases | Upload and Merge Databases only, while you are signed in as yourself |
| Protection | Excel's own "Encrypt with Password" format (ECMA-376 agile encryption: AES-256, SHA-512, 100,000 password rounds, tamper check) | AES-256-GCM; the key is made from your Element451 user ID (PBKDF2-SHA256, 600,000 rounds); the entries are gzipped first, so the file is small |
| Keeps | what the spreadsheet can carry (section 11.6) | every stored field exactly |

**The password (Excel file).** One password per browser, set the first time you download an Excel file (or with **Database Password** in the Database section), at least 8 characters. It is kept in this browser (`localStorage`, key `elm_db_password`), so your own files download and upload without asking. Coworkers who set the same password open each other's files without being asked either; agree on one and pass it on some other way than with the file. **Database Password** shows the saved one (hidden until **Show** is ticked) and changes it; files made earlier keep the password they were made with. Opening a file tries the saved password first, then any that opened a file since the page loaded; if none fits, a dialog asks, and asks again after a wrong one. Cancelling changes nothing. An old unprotected `.xlsx` still opens, and so does a spreadsheet that was password-protected in Excel itself.

**Generating a password.** The password dialog has two **Generate** buttons; either fills the field and shows what it made, with a **Copy** button beside **Show**:

| Button | What it makes | Example | Strength |
|---|---|---|---|
| **Random password** | 12 characters with at least one lowercase letter, capital, digit and symbol. Characters that are easy to mix up when read out or copied from a note (`l 1 I O 0`) are left out, and the symbols are `! @ # $ % & * ? - _ = +` | `WsGwJg=%+p9a` | about 73 bits: 12 is the length password managers and current guidance treat as the floor for a strong random password |
| **Passphrase** | three random words and a number from 100 to 999, joined with hyphens | `maple-orbit-tundra-482` | about 48 bits: weaker than the random password, but easy to say to a coworker and to type |

Both come from the browser's cryptographic random generator (`crypto.getRandomValues`), with every character, word and number equally likely. The words are the EFF Large Wordlist for Passphrases (Electronic Frontier Foundation, [eff.org/dice](https://www.eff.org/dice), CC BY 3.0 US) without its four hyphenated words and without 680 words that could be awkward in a password people share at work (health, disability, bodies, sex, religion, death, violence, crime, politics, insults; *autism*, *diabetic*, *prison* and *pregnant* are examples): 7,092 everyday words, stored in the script in a compact form (about 31 KB). A typed password is still accepted at 8 characters or more. Each check of an Excel password takes 100,000 rounds of SHA-512, which slows guessing, but the random password is the one to use if the file may travel far.

**The login (personal file).** The page sends a sign-in token with its own calls to Element451's deduplication API. When that token is a JWT, its payload names the signed-in person (`sub`, `user_id` and similar); the script reads that ID from the page's own request (only the ID is kept, in memory; never the token) and locks the file to it. If no such call has been seen yet, it looks in the page's stored session for a token or a user object, and uses it only when everything found names one person. Then:
- downloading and uploading a personal file asks for nothing;
- signed in as someone else, the file is refused ("locked to a different Element451 login") and the database is left alone;
- when the script cannot tell who is signed in, the personal option is shown as unavailable and says so (open the Deduplication list, so the page talks to Element451, and try again). The Excel file is always available.

**How strong each is.**
- **Excel file**: as strong as the password. Someone with the file and no password cannot read it; a short or guessable password can be tried offline.
- **Personal file**: lighter. Your Element451 user ID is an identifier, not a secret, and how the key is made from it is public in this repository. To someone who only has the file and does not know your ID, it is closed. Someone who knows your ID (an administrator of your Element451 site, for instance) and is willing to write code could open it without your login. It keeps the file personal and out of casual reach; it is not the place for something that must stay secret from people inside Element451. If the ID the token carries turns out to be an email address rather than an internal ID (`elm451Debug()` shows `kind`), the lock is weaker still, because an email can be guessed.
- **The password in the browser** is stored as typed. Anyone who can use this browser profile on Element451 can read it, and can read the database itself the same way. It protects files that leave the browser, not the browser.
- **Lost access.** A forgotten password cannot be recovered from a file (while it is still saved in a browser, **Database Password → Show** reveals it). A personal file opens only for the login that made it: if that account is removed or replaced, the file cannot be opened. Keep an Excel copy of anything that must outlive the account.

**Checking the login.** `elm451Debug()` in the console prints `login: { found, from: 'request' | 'storage', kind: 'id' | 'email', fingerprint, changedInLast30Days }`. The fingerprint is 8 characters derived from the ID (never the ID) and should read the same every time you are signed in, on any computer; it is also kept in `localStorage` (`elm_db_login_mark`) with the time it last changed. If a different login was seen in this browser in the last 30 days, the download dialog says so on the personal option: on a shared computer that is just another person; otherwise it means the ID is not a steady one, and a personal file should be checked (upload it back) before it is relied on.

**Where the code is.** The Database script holds the encryption (between the `PROTECTED FILES START / END` markers), and after it the login reader, the dialogs and the saved password. The Merge script borrows them through `window.__elm451DbFiles` (`read(file, document)`, `download(entries, document)`); with a Database script too old to offer that, it can still read plain `.xlsx` files and refuses to download.

**Checked how.** The encryption code is tested on its own (`scripts/protected-files-test.js`) and was checked against `msoffcrypto-tool`, an independent implementation of Office encryption, in both directions (it opens our files, we open its files), including a wrong password, a changed file and a non-English password. End to end on mock pages: both downloads, upload back, another password, cancel, an old plain file, the Merge page, a 15,000-entry database; and for the personal file: same login in a later session opens it, another login is refused, no login found is explained. **Not checked:**
- opening the `.xlsx` in **Excel itself** (not available where this was built). If Excel refuses a file that the right password should open, report it.
- **how Element451 really signs its requests.** That its token is a JWT naming the person was assumed, not seen. If the personal option stays unavailable on the real site, or the fingerprint changes between sign-ins, send the `login` line from `elm451Debug()`.
