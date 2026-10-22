# Element451 Deduplication (New Layout) — Full Documentation (v2)

This document covers the two v2 userscripts, which target Element451's redesigned
**Deduplication** review-queue UI, and everything they change on the Element451 website.

| Script | File | Current version |
|---|---|---|
| UI Perfection (New Deduplication Layout) | `Element451-UI-Perfection-v2.user.js` | `@version 2.212`, shown in the settings pane as `v2.210` |
| CSV Database (New Deduplication Layout) | `csv-database-v2.js` | `@version 2.53` |
| Database Merge (optional) | `csv-database-merge-v2.js` | `@version 1.7`, see [section 17](#17-database-merge) |

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
16. [Chrome extension](#16-chrome-extension)
17. [Database Merge](#17-database-merge)

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
4. To confirm what is running: open the gear (settings) — the Info section at the bottom lists `Main script · vX.Y`, `Database script · vX.Y` (when the CSV script is installed) and, when running in the Chrome extension, `Extension · vX.Y.Z`.
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

The pane's **Info** section (last, in a single list container) lists the versions in use, which matters when the scripts update themselves in the Chrome extension: `Main script · v2.212` (the UI script), `Database script · v2.53` (added under it by the CSV script, when installed) and `Extension · v1.0.0` (only when running through the extension, which hands the page its version as `window.__elm451Extension` when it registers the scripts). All three use the same `vX.Y` style; the console still logs the main script as `v2-build-185`.

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

A pair is blocked when any of these is true. Blocked pairs get red styling (the Merge Contacts button turns red; the triggering row and, for forbidden, the contact card are outlined) and are never auto-applied or auto-merged.

| Blocker | Detection |
|---|---|
| **Forbidden** | Either contact's name contains `test`, or equals one of three hard-coded names (`angela armstrong`, `gillespie armstrong`, `mariah armstrong`) |
| **Appeal** | Any row value, on either side, contains the word `appeal` (the side is reported) |
| **Wrong department** | The detected department differs from **Allowed Department** (see below) |
| **Student ID mismatch** | A row containing `School Id:` shows two different numeric IDs |

**Department detection.** A row counts as Grad/IA when it is a Workflows / Application / Program / `type:` / `status:` row whose text contains `GRAD_` or "grad student" or an `IA_` / `_IA_` / `_IA ` marker **and** `status: Finished`. Otherwise the pair is **UnderGrad**. For a blocked UnderGrad pair the *first diff row* is highlighted red, as the classic script highlighted its first row; it is only a marker, because UnderGrad is "no Grad/IA row found".

The detected department is also published for the CSV script (`Forbidden` > `Appeal` > `Grad/IA` / `UnderGrad`).

---

**Bolt analysis error (a stop, not a blocker).** When Bolt's score chip reads **Error** (its AI analysis failed; the tooltip says "AI analysis merge guidance references an unknown user id."), the pair has no Bolt picks to lean on. The script stops on it: no resolution, no auto-merge and no skip, **even with Auto-Skip on**, so a person looks at it. It shows a `Stop: Bolt error` toast (once per pair, subject to the Toasts switch) and logs `[elm2] Stopped: Bolt analysis error, left for you`. The pair is still recorded in the database like any viewed pair. The script waits up to 3 s for the chip to render before deciding, and the final pre-merge gate also refuses a pair whose chip turns to Error ("Bolt's analysis errored"). Blockers (forbidden, appeal, department, student ID) still come first.

## 7. Field resolution rules

Only rows where the two sides differ (conflicts) are considered. Rules run **in this order**; the first that fires makes the suggestion.

| # | Rule | Behaviour |
|---|---|---|
| 0 | Blank side | If either value is empty, the row is skipped (no opinion) |
| 1 | **Applicant side** (outranks everything) | If an applicant side exists, every conflict row follows it, **except** a row where the applicant side is blank ("-") and the other side has data: that row picks the side with data. Detection: a *Cal State Apply Application* entry on only one side wins; if on both, the later application date wins (left on a tie/no date); otherwise an `Application Start/Submit/Complete` or `Admit` type entry on one side; if both, the side with more such entries, then the later date. Only used for UnderGrad pairs |
| 2 | Blank-vs-data | One side blank ("-") and the other has data (no applicant side): no rule pick; Bolt's pick stays, or the fallback below takes the side with data |
| 4 | **Personal email preferred** | Email rows: the side with a personal-domain address (gmail, yahoo, icloud, hotmail, aol, me.com, outlook, live, msn, protonmail, proton.me) wins when only one side is personal. Both personal: flagged for the tiebreak below |
| 5 | **csusb.major** | The side with `csusb.major.` wins; if both have it the rule cannot decide (see *Needs review* below) |
| 7 | **csusb.school** | Student Type rows: the side with `csusb.school.<n>` wins; if both have it the rule cannot decide (see *Needs review* below) |
| 8 | Date of birth validity | Reject a year that starts with 0 or is below 1900 |
| 9 | First generation | Prefer `Yes` over `No` |
| 10 | Intended term | Prefer the later term code in parentheses, e.g. `(2274)` |
| 11 | Name case | If the values differ only by case, prefer Title Case over ALL CAPS or all lower-case |

**Fallback and manual review.** After the rules, every conflicting row ends in one of three states:

1. **Decided**: a rule picked a side, or Bolt had already selected one (Bolt's pick stands when no rule has an opinion).
2. **Filled**: Bolt left the row unselected (typically Milestones, Sources and other `type: …` list rows) and no rule applies. The script picks, in order: the side with data when one side is blank; the **more recent profile** (the contact card's *Created* date); the side of the **selected email**; and finally an **arbitrary but stable** side (a hash of the pair, so a revisited pair gets the same answer). These rows have no Bolt pick to agree with, so they are never green,.
3. **Needs review**: a rule applied but could not decide (dual personal email with no tiebreak, an address tie or two broken addresses, `csusb.major` or `csusb.school` on both sides) **and** Bolt left the row unselected. The pair is never auto-merged and is **never skipped**: it stays on screen for you (no toast; the console names the fields) whatever Auto-Skip says. Once you have merged it by hand and moved on, auto-merge resumes on the next pair. The console names the rows (`[elm2] Needs review: …`).

**Dual personal-email tiebreak** (both emails personal): first the **engagement** numbers (the contact whose profile has more **email opens**, then more **email clicks**; Contact A = left, B = right). The merge screen only holds those numbers in the page while its "Show engagement data" panel is open, so for these pairs the script opens the panel itself (once per pair, waiting up to 4 s for the table, and leaves it open so you can see the numbers) and reads the `#duplicate-engagement-details` table (`N user actions / email opens / email clicks / sms clicks / logins` per contact). If the opens and clicks are tied or there is no panel, it goes on: prefer the address containing a first name, then a last name (parts of 3+ letters of either contact's name), then the birth year (or its last 3/2 digits) from the DOB rows. If none separates them there is **no pick**; with no Bolt pick either the row *needs review*.

**Addresses**: with an applicant side the applicant rule wins (unless the applicant's address is blank and the other has one). Otherwise address rows compare with the built-in `AddressComparer`: a duplicated-component address loses, and for the same address the more complete one wins. Ties are **not** picked (Bolt's pick stands; with none, the row needs review): the same address with equal completeness, different addresses, or both addresses having duplicated parts.

The classic "email open count" tiebreaker is back, fed by the new layout's engagement panel instead of the old "User Activity" section (see the dual personal-email tiebreak above).

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
2. A **countdown dialog** opens centred **in the merge panel** (the review sidebar), with the 32% scrim covering only that panel rather than the whole site; the scrim also blocks stray clicks on the panel. It shows a red **wavy ring** (Material 3 Expressive's wavy circular progress: the progress arc is a sine wave whose crests travel around the circle, still when *reduce motion* is on, and the pale track is a plain circle drawn only where the arc is not, with a small gap at each junction) that steps down once per second (it starts at 12 o'clock and its end walks back; the rounded tip lands exactly on the mark, e.g. 6 o'clock at half time) with the seconds left in the middle; at **0** a green ring draws itself counter-clockwise from 12 o'clock while the red arc fades, the headline reads *Merging…* and the merge is clicked at that moment (Cancel and Esc work until the countdown reaches 0), the headline *Merging automatically*, a short brief (the two names; *Bolt score:* Low in red, Medium in orange or High in green; *Script agrees with 2/5*, the share of our picks that match Bolt's; and *Script chose 3 over Bolt: Email, Address, DOB*, or *Script found **applicant** and chose 3 over Bolt* when an applicant side decided; with **Use picks from = Bolt's** it reads *Bolt chose 3 over script: Email, Address, DOB*, or *Script found **applicant** but Bolt chose instead*), and a full-width **Cancel** pill. **Esc** also cancels. The countdown length is the **Merge countdown** setting (default 4 s, minimum 2 s): that is the whole wait: the numbers (or lamps) step once a second and Merge Contacts is clicked the instant they reach 0. The green *GO* state shows at that moment and the dialog lingers for a fraction of a second after the click so it can be seen; Cancel is greyed out once the merge has fired. The exception is **race lights**, which hold the green *GO!* for 0.3 s before the click; their four lamp steps are shortened to 0.925 s each so the whole style still takes exactly **4 s**. Its drop-down also has **4 seconds, race lights**: a 4 s countdown drawn as a start signal instead of the ring. Three dark lamps (*Get ready…*), then red lamps light at 3, 2 and 1 seconds left, and at 0 all three go green with *GO!* before the merge click. Stored as `elm_merge_countdown = race`. **Kart:** with race lights a pixel-art go-kart with the CSUSB coyote at the wheel (side profile: blue fur, grey muzzle, white jersey; proportions modelled on the Super Mario Kart sprite sheet) waits in the dimmed strip between the merge panel and the screen edge, with its wheels on the bottom edge of the screen and 40 px in from the side edge. It is stored as 31 short text rows and drawn as one SVG path per colour, so it is tiny. It **charges like a Mario Kart drift mini-turbo** while the lights count down: blue sparks and a small flame at 3, yellow at 2, purple at 1, with **one shake of the kart per colour** (the same small, quick 4 px nudge forward and back every time), and it stays put until the lights go green; then it drives off under the panel with a full-size purple flame and speed lines. The strip is the wider side of the panel; if it is narrower than about 200 px, or *reduce motion* is on, there is no kart. It sits above the page dimming and below the toasts.
3. Cancelling, or the pair changing, aborts and shows a toast.
4. When the countdown ends, a **final gate** re-checks: the pair is unchanged and unblocked, every conflicting field has a selected side (rows that *need review* stop the merge), no twins flag, and the Merge Contacts button exists and is enabled. If it fails because a field needs review, the pair stays on screen. Any other failure: Auto-Skip on → skip, off → a toast says why ("Auto-merge stopped: …").
5. Only then is **Merge Contacts** clicked (once per pair), and the merge-tracking logic takes over.

**After a merge** (yours or an auto-merge): Element451 shows a **Merge completed** card (`bolt-card.merge-completion-state`) with **View merged contact** and **Next duplicate**. The script detects that card, counts the merge, waits about 1 second and presses **Next duplicate** (the button is absent on the last pair, so nothing is pressed then). **Toasts (auto-merge only).** The **Toasts** switch (settings pane, *Display* section) controls these toasts. It is forced **off** and greyed out when the slider is on **None** (a scan), forced **on** and greyed out while **Auto-Skip** or auto-merge (*When done = Merge*) is on, and free otherwise; `Merge: …` also appears after a manual merge when it is on. Short toasts name each outcome, with **one reason per skip** chosen by priority (Range > Forbidden > Student ID > Graduate/IA > Appeal > Twins): `Skip: Appeal`, `Skip: Graduate/IA`, `Skip: Student ID`, `Skip: Forbidden`, `Skip: Range`, `Skip: Twins`; a pair that needs review is not skipped and has no toast (the console names the fields) and, once Element's *Merge completed* card has actually appeared, `Merge: 2/3` (the *Script agrees with 2/3* figure from the dialog), `Merge: Applicant` when an applicant side decided, or `Merge: Bolt` when the script made no picks of its own. Manual sessions and plain scans show none. The console logs each merge (`[elm2] Merged 7/40 | …`) and each skip with its queue position and reason (`[elm2] Skipping to next pair: … (was 8/40)`). The final-check conditions are tested **before** the countdown starts, so a pair that could not merge (for example a field with no pick, which is named with its two values in the console as `[elm2] No pick on: …`) is skipped without showing the dialog. If Merge Contacts was clicked but no Merge completed card appears within 6 s, the console says so and logs any open dialog. While **Next after merge** is on, Element451's own *Skip merge completion screen* and *Skip this screen next time* switches are hidden, because turning either on would remove the card the script reads. A switch that is already on is left visible (so it can be turned off) and the console warns about it. Turn the Next duplicate click off with **Next after merge** in the settings pane. Storage: `elm_next_after_merge` (default on).

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

A right-hand Material 3 panel (warm neutral surface, 40px rounded left edge) with a header of a tonal circular close button at the top left (a 32px circle 24px in from each edge, its left edge lined up with the containers below and concentric with the panel's 40px corner) next to the title, laid out as an **M3 Expressive list**: each setting (and each Database button) is its own light container, 2px apart, the first and last of a group having large 20px outer corners and the rest 6px (`.elm-list` / `.elm-item`; the CSV script puts "Show Database UI" in its own item and styles its Database buttons as list rows): a discrete Material 3 **slider** (track split by a handle, stop dots, value bubble while dragging, labels under it), two **segmented buttons** (Use picks from, When done), a select for the countdown and department, and Material 3 switches. Descriptions under each control reserve their height so the controls below do not jump. A build line shows `New layout · v2-build-N`.

### 10.4 List page

- **Department badges** (CSV script): a small right-aligned pill in the row's flagged cell (see [11.5](#115-list-page-badges)).
- **Pager**: next to the paginator's range label (top and bottom paginators) a **Page [n] of N  Go** box. Enter or Go jumps to the page (0 or a negative number goes to page 1, a number past the end goes to the last page): it sets the paginator component directly if it can be found; otherwise it clicks First/Next page repeatedly, waiting for each page to load ("Going to page N…" toast). Element's "Rows per page: 50" is left as is, because a custom page size could not be set from outside (the page size is not read from the URL and the paginator component was not reachable from a sandboxed script; with `@grant none` build 100 this should be re-checked).
- **History search** (History tab, in the table header's own actions slot, `.bolt-table-header-wrapper` second div, which is where the review queue keeps its search icon; if that slot isn't found it goes before the pager, then above the table): a Material 3 Expressive search field that starts as just a search icon and slides open when clicked (hint "Search merged profiles"; Escape, the icon, or clicking away from an empty box closes it; with text in the box it stays open) with **Previous match** and **Next match** buttons (Enter starts the search, as on the review queue; the status text ("Match 1 of 3") sits to the left of the search box; matches already found are remembered, so Previous goes back without re-scanning). The page loads 50 merges at a time from `.../v2/users/relationships/duplicates/history?limit=50&offset=N`; the script remembers the page's own last request to that URL (URL and headers, including the auth token) and replays it for page 1, 2, 3… scanning each record (word-based partial matching over every value of the record, never the field names: each typed word must be the start of a word in the record, so "lov" finds Lovelace but "ovel" does not; a word with an @, digit or punctuation, such as an email, ID or date, is matched inside the whole value. Any order: one word matches anywhere, so "First" or "Last" finds First Last; two words must both match, so "Last First" finds First Last; with three or more words one may be missing, so "First Middle Last" finds First Last; free-text `ai_analysis`/`feedback` fields are skipped, and so is **who did the merge**: fields keyed like `actor`, `reviewer`, `performer`, `creator`, `author`, `*_by` (`merged_by`, `performed_by`...) are ignored, as is any value equal to a reviewer name shown in the table's "who" column on the pages you have browsed; a plain `user` key is not skipped because in Element451's API the contacts are the "users"). The first match is jumped to straight away (the pager goes to its page and the row is outlined) and the scan carries on through the remaining pages in the background, so the count grows as more are found. The status line has four states: still searching with no match yet (`Searching page 5 of 104…`), still searching with matches (`Searching page 5 of 104… Match 1 of 1`), finished with matches (`Match 1 of 3`) and finished with none (`No matches found in 104 pages`). **Previous match** / **Next match** step through the matches found so far (grey at either end). The **×** inside the field cancels the search and clears the box and the highlight. Before paging it asks for offsets 0 and 1 and compares them to learn whether `offset` counts pages from 0, pages from 1 or records. If no request has been captured yet (the page loaded before the script), go to another page of the list once. The CSV script ignores history responses. Opening animation: the pill hugs its content while the input area slides open (width + fade, 300 ms, the M3 deceleration curve) to a width just big enough for the hint text (182px input area, about 240px for the whole pill) and Previous/Next match fade in after it, so nothing pops in; closing reverses it. **Narrow windows:** the header row wraps instead of squishing: Element's labels (*N Records*, the pager) stay on one line, the pager drops under the header row when the two don't fit, and in the search bar the status text moves onto its own line above the box before anything is clipped.
- **Search bar style**: Element's expanded header search (`bolt-expandable-search`, review queue and History) and the History search share one Material 3 Expressive look: a 56 px full-round bar (the header row is kept 56 px tall even while the search is closed, so nothing moves when it opens) filled `#F5F5F5` (`--md-search-fill`), no outline, the search icon at the leading edge, 16 px text. Only the expanded state of Element's own search is restyled; it already slides open by itself.
- **Tabs**: the *Review Queue / History* tab bar is restyled as Material 3 primary tabs (48px, label-medium, 3px rounded-top indicator as wide as the label, divider line, hover/press state layers).
- **Advanced Filters** panel (opened from the list): restyled compactly — a 640px panel (the overlay, its container and the filters host are all set to the same width), a header with a text *Clear All* and a filled *Apply Filters* (disabled grey until a filter changes), tonal white cards on a tinted page, one-line section headers (title + description), labels beside their controls, Material 3 filter chips (outlined; selected = orange tonal with a check mark, the check hidden when unselected), and compact 168px From/To date boxes. Rules are given extra specificity so Element's own chip colours cannot win.

### 10.5 Toasts

Both scripts append toasts to one shared stack, **bottom-left**, newest at the bottom, up to 4, each fading in/out: the CSV script's `API: data captured successfully` (not shown while the merge panel is open: the list refreshes in the background after a merge) / `unavailable, using database fallback`, and the main script's notices (Auto-merge cancelled/stopped, Going to page N…). The same message arriving again refreshes the existing toast.

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
- **dept** values: `Grad/IA`, `UnderGrad`, `Forbidden`, `Appeal`.

### 11.3 Recording

Every second the script reads `body.dataset.csvDept` and the Spark IDs published by the main script and records the pair if the page's Spark IDs match the published ones (stale-signal guard). In addition, **before every auto-skip** the main script dispatches an `elm2-record-pair` event and waits (up to 3 s, retrying every 0.25 s) until the CSV script confirms the pair is recorded, so a fast skip cannot lose an entry; if the CSV script is not installed the skip proceeds immediately.

### 11.4 API interception

The script wraps `XMLHttpRequest` and `fetch` to capture the list API response (`/v2/users/relationships/duplicates?ignored=…&limit=…&offset=…`). Each record contains `master.identities[]` / `duplicate.identities[]` with objects of the form `{ type: 'Spark_…', value: '<id>' }`; the Spark IDs are read from there (text under `ai_analysis` and `feedback` is ignored). Each fresh capture shows the *API: data captured successfully* toast.

### 11.5 List-page badges

A badge is placed in `.cdk-column-flagged` (falling back to signals, then the row). For each row the script first matches a database entry by **both Spark IDs** found in the row's API record (a contact can be in several pairs, so one shared ID is not enough), then falls back to matching the row text by names: **both contacts' 3-letter prefixes** must appear in the row. Badges are right-aligned so they line up down the column, and respect **Show Database UI**.

### 11.6 Import / export

- **Download**: `elm_database_YYYY-MM-DD.xlsx` (an Excel workbook; also opens in LibreOffice and Google Sheets). Columns, in order: `Bolt Score, Firstname, Lastname, Firstname 2, Lastname 2, Spark ID 1, Spark ID 2, Dept., Scan Date, Merged, Script vs Bolt, Row Contents`. **Bolt Score** (High / Medium / Low) is the score chip on the merge screen, read by the main script (`body.dataset.csvScore`) and stored on the entry the first time it is seen; blank if the chip never showed. Column widths are preset (resize them in the spreadsheet), text never wraps (a value that already contains line breaks keeps them as lines in the cell), the header row is bold, shaded and **frozen**, and the **filter / sort buttons are on Bolt Score, Dept., Scan Date and Merged** (one filter over the whole table, with the dropdown buttons hidden on every other column; each dropdown also has Excel's sort options). The workbook is written by the script itself (a small stored-zip writer; no libraries). It was an `.ods` before 2.32: Excel had to repair that and ignored its frozen row, so the export is `.xlsx` now (the `.ods` and `.csv` importers were removed in 2.50).
- **Struck-through Spark ID**: on a merged pair the Spark ID that was merged away is struck through (grey, line through) in its Spark ID cell. The kept ID is the side selected on the `Spark Id:` row of the merge screen at the Merge click ('left' = Contact A); if that row has no selected side nothing is struck. The strike is stored as `lostSpark` on the entry, and a re-imported `.xlsx` keeps it (read back from the cell style).
- **Struck-through names**: on a merged pair the first and last name that was **not kept** are struck through too (the side not selected on the First name / Last name row at the Merge click; Contact A = the Firstname / Lastname columns, Contact B = the "2" columns). Nothing is struck when the two names are the same, differ only in case, or one is blank. Stored as `lostFirst` / `lostLast` ('a' or 'b') and read back from the cell font / style on import. (The row labels are matched as `first name` and `last name` / `surname`; if Element labels them differently nothing is struck.)
- **Scan Date** is the day the pair was first scanned (recorded); it moves to the merge day when the pair's merge is confirmed. It is a real Excel date cell shown as `DD/MM/YYYY` (stored internally as `YYYY-MM-DD`), so it sorts chronologically and has Excel's date filters. Re-recording an unchanged pair does not touch it; entries recorded before the column existed are blank until they are recorded again. Import accepts a date cell, `DD/MM/YYYY` or `YYYY-MM-DD`.
- **Merged** is `Y` once the Merge completed card confirms the merge, `N` for a recorded pair that was not merged (skipped, blocked or left for you), and blank for entries recorded before this column existed.
- **Script vs Bolt** is only filled for a merged pair (Merged = Y); it is blank for every other row. It is the auto-merge brief in one line, e.g. `2/3 agree · script chose 1 over Bolt: Email, Address`, `Applicant · script chose 1 over Bolt: Address`, `3/3 agree`, or `Bolt's picks` when the script made no picks on a merged pair. (With *Use picks from = Bolt* the wording flips to `Bolt chose N over script`.) Field names only, no personal data.
- How the data gets there: the main script keeps `body.dataset.csvChoice` up to date for the pair on screen; at the Merge Contacts click it remembers the pair's Spark IDs and the line, asks the database script to record the pair (`elm2-record-pair`), and when the Merge completed card appears sends `elm2-pair-merged` (`detail: { a, b, choice }`), which sets Merged = Y.
- **Upload & Replace**: accepts `.xlsx` only (shared or inline strings, dates, strike-through read from the cell fonts). Columns are read **by header name**. Names are shortened to 3 letters on import.
- **Clear Database**: asks for confirmation.

### 11.7 UI

Header `DB: N` pill, the Database section of the settings pane, the **Show Database UI** toggle (under Display), the API toast and the badges, all in the same orange Material 3 style.

---

## 12. Inter-script contract, storage keys and console output

### 12.1 Contract

| Channel | Direction | Mechanism |
|---|---|---|
| Department + Spark IDs | main → CSV | `document.body.dataset.csvDept`, `csvSpark1`, `csvSpark2` |
| Merge Databases button, stored database | merge ← CSV | the merge script puts its button inside `#elm-settings-db-section` (so it exists only while the CSV script is active) and reads / writes `localStorage.elm_csv_database`; nothing else is shared |
| Script vs Bolt line, Bolt score | main → CSV | `document.body.dataset.csvChoice`, `csvScore`; `elm2-pair-merged` event (`detail.a/.b/.choice/.lost/.names`) after a confirmed merge |
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
| `elm_next_after_merge` | main | Next after merge (default on) |
| `elm_outcome_toasts` | main | Toasts switch (default on; forced off with the slider on None, forced on while Auto-Skip or auto-merge is on) |
| `elm_highlight_rows` | main | Highlight Rows |
| `elm_allowed_department` | main | Allowed Department |
| `elm_show_merge_counter` | main | Hidden: show the merge counter |
| `elm_merge_count` | main | Merge counter value |
| `elm_csv_database` | CSV | Recorded pairs (JSON array) |
| `elm_show_db_ui` | CSV | Show Database UI |
| `elm2_bolt_picks` | main | Bolt's original pick per conflicting row (hashed ids, `l`/`r` + timestamp, capped at 2,500 entries). Element451 saves the selection on a pair, so on a second visit the screen shows the last selection rather than Bolt's pick; this keeps Bolt's real pick for the colours and *Use Bolt AI picks* |

### 12.3 Console output (page console, F12 → filter `elm2` or `CSV Database`)

- `[elm2] Blocked: …`, `[elm2] Not blocked — allowed dept: …`, `[elm2] Resolution done — …`, `[elm2] Suggestions by rule: {…}`
- `[elm2] Skipping to next pair: <reason>`, `[elm2] Auto-merging pair`, `[elm2] Auto-merge not done: <reason>`
- `[elm2] page jump: direct …` or `… clicking First / Next …`
- `[elm2] script click on button: "…"` for script-generated clicks, and a warning with a stack trace if one is blocked by the click guard.

---

## 13. Known limitations and unverified guesses

- **Merge-success detection**: the "Merge completed" card (`bolt-card.merge-completion-state`) is the signal (it counts the merge, shows the `Merge: …` toast, sends the pair to the database as Merged = Y and presses Next duplicate). If Element's own "Skip merge completion screen" switch is on, that card never shows; the script then falls back to "the pair on screen changed after Merge Contacts was clicked", which cannot press Next duplicate for you.
- **Score chip reading** assumes the chip text contains `high` / `medium` / `low`.
- **Applicant detection** depends on the Workflows/Application rows being loaded; it re-checks about 0.6 s later, but a very slow load could mislabel a pair.
- **Rows per page** cannot be changed from the script, and the original classic page-size box was dropped. The main script now runs with `@grant none` (build 100) so Angular's paginator component may become reachable; the page-jump console line shows which route is used.
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
| Extension installed but a script does not run | Check its switch in the popup (CSV Database needs UI Perfection on); reload the tab after changing a switch |
| No "Update available" chip | It appears only after a newer GitHub Release exists and Chrome has been restarted (or the extension reloaded) |
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
- **Auto-merge polish**: Toasts switch, short auto-merge brief, countdown timing (exact N seconds, 4 s race lights), wavy ring, panel-scoped overlay, Next after merge, the coyote go-kart.
- **History search**: search every page of the History list through the history API, with Previous / Next match (see section 10).
- **Search bar style**: Material 3 Expressive search bar for Element's header search and the History search.
- **Database**: Bolt Score, Merged and Script vs Bolt columns, an `.xlsx` export (frozen header, widths, filters on Bolt Score / Dept. / Merged, struck-through Spark ID and names), `.xlsx` import (section 11).
- **Engagement tiebreak**: dual personal emails are decided by email opens, then clicks, from the engagement panel (section 7).
- **Database Merge**: a third, optional script that merges several exported databases on a page of its own (section 17).
- **Chrome extension**: unpacked extension that runs both scripts and updates them from GitHub when Chrome starts, popup with switches, build + release workflow (section 16).
- **Versions**: the settings pane lists Main script, Database script and Extension versions in one style.
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

**Popup.** Just the title (no settings cog and no counters; the database and merge counts are in the Element page's own header); the **Update available** chip, only while a newer extension release exists; one row per script (UI Perfection, CSV Database, Database Merge) with an expressive switch and its version (CSV Database is greyed while UI Perfection is off, Database Merge while CSV Database is off); a **Reload tab** prompt after a change; and a footer with the extension version. The extension asks only for the `storage` and `userScripts` permissions plus access to `*.element451.io`, the script source on GitHub and the releases API. It follows the system's light or dark setting; the dark theme uses clearly separated surfaces (near-black background, lighter warm-grey containers, bright orange accents and near-white text).

**Extension storage** (`chrome.storage.local`, not the page's): `enabled` (per-script switches), `cache` (the scripts last downloaded from GitHub, with their versions), `shellUpdate` (a newer extension release, if any) and `dismissed` (the version whose update chip was dismissed).

**Both installed.** Each script starts with a guard (`window.__elm451UiPerfectionLoaded`, `window.__elm451CsvDatabaseLoaded`, `window.__elm451DbMergeLoaded`) so a copy in Tampermonkey and the extension never run twice on a page.

**Build and release.** `.github/workflows/extension.yml`:
- every pull request and every push to `main`: `node scripts/build-extension.js` (syntax-checks the scripts, writes `dist/extension/` and `dist/elm451-dedup-tools-v<version>.zip`), then `npm test` (`scripts/smoke-test.js`: loads the unpacked extension in Chromium, checks the popup, the update chip, then switches the API on and checks all three scripts register in the MAIN world and run on an `element451.io` page, that the settings pane lists the four versions, and that a toggle stops one; also that an older cached script does not replace the bundled one and a newer one does), and the zip is kept as a workflow artifact;
- a tag `vX.Y.Z`: the same, with the version taken from the tag, then `gh release create` publishes the zip as a GitHub Release.
Locally: `npm install` once, `npm run build`, `npm test`; load `dist/extension` with **Load unpacked**. `npm run icons` re-renders the icons.

**Install.** Download the zip from Releases, unzip it, open `chrome://extensions`, turn on Developer mode, **Load unpacked** and pick the folder, then open the extension's **Details** and turn on **Allow user scripts**. Reload your Element451 tab.

**Limits / unverified.** The end-to-end test switches the API on through `chrome.developerPrivate` (what the toggle does), not by clicking it; the GitHub fetches (scripts and releases) were not exercised in CI; the first release has to be tagged by hand.

## 17. Database Merge

`csv-database-merge-v2.js` (optional) combines several databases, for example ones exported by different people or on different days, into one.

**Link to the CSV script.** Only two things: the **Merge Databases** button is added inside the Database section of the settings pane, which the CSV script creates (so the button only exists while the CSV script is active), and the current database is read straight from `localStorage.elm_csv_database`, so it can be merged without downloading it first. Everything else, reading `.xlsx` and writing the merged `.xlsx`, is the script's own copy of the CSV script's file code (keep the two in step when the file format changes). It is installed and updated like the others; in the Chrome extension it is a third switch in the popup (greyed while CSV Database is off), and the settings pane lists `Database merge · vX.Y` under the database script's line.

**The page.** The button opens a new tab, built from the Element451 page with DOM calls (no inline scripts, so the site's content-security policy cannot block it). It is a calm Material 3 page in the orange of the settings pane: a small title with a badge, a dashed drop zone, sources as list rows with leading icons, tonal stat cards, per-source chips, conflicts as cards with chips (the kept copy has a check), a Material dialog for the Replace confirmation and a snackbar for messages, with little motion; it follows the system's light or dark setting. The Element451 tab has to stay open while the merge page is in use.
- **Sources**: drop or choose any number of `.xlsx` files; a table lists each source with its entry count, merged count and Scan Date range, and a **×** to remove a file. "This browser's database" is a source too, ticked by default; at least two sources are needed.
- **Rules** (shown on the page): a pair is the same pair when both Spark IDs match, in either order (entries with no Spark IDs fall back to the two contacts' 3-letter names). If it appears more than once, **the most up to date copy wins**: the later Scan Date (a pair's Scan Date moves to the merge day when it is merged, and a dated entry beats an undated one). On the same date a merged copy beats an unmerged one, and after that the source higher in the list stays. The winner keeps its own fields, filling a blank Bolt score from the other copy.
- **Breakdown** after **Merge**: unique pairs, duplicates combined, merged pairs, conflicts; a per-source table (entries, new pairs, replaced an older copy, already had a better copy); and a conflicts table (the same pair in a different department or merged state in two sources, with which copy was kept; first 200 shown).
- **Result**: **Download merged database (.xlsx)** (same format as the CSV script's export) and **Replace my database with this** (asks first, then writes `elm_csv_database`; the header counter follows within a second). Nothing in the browser changes until Replace is pressed.

**Not verified live:** the new-tab page was tested in headless Chromium against mock databases; pop-up blockers can stop the new tab (the script says so).
