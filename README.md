# CSUSB De-Dup Extension

Userscripts that streamline the Element451 duplicate-contact merge workflow at CSUSB, for Element451's redesigned
**Deduplication** review queue. **UI Perfection** handles the merge screen (auto-resolution, lockdowns, auto-merge,
navigation, restyles) and **Database** records blocked and skipped pairs, annotates the list page and exports a
spreadsheet. Run them with Tampermonkey (any browser) or, in Chrome, as an unpacked extension that keeps them up to date.

The older scripts for the classic merge page are documented separately in [`README-v1.md`](README-v1.md).

---

## The scripts

Element451 replaced the classic merge page with a redesigned, AI-assisted **Deduplication** review
queue (a queue table plus a side panel with a field-by-field diff form, Bolt AI picks and a score
chip). Two v2 scripts target it, plus an optional third that merges databases:

| Script | File | Current version |
|---|---|---|
| Element451 - UI Perfection v2 | `Element451-UI-Perfection-v2.user.js` | `@version 2.303` (shown in the settings pane) |
| Element451 - Database v2 | `database-v2.js` | `@version 2.74` |
| Element451 - Database Merge v2 (optional, pairs with Database) | `database-merge-v2.js` | `@version 1.17` |


**How pairs are scored: [`SCORING.md`](SCORING.md)** (every weight, the rating rules, sample pairs). **Full documentation: [`Full-Documentation-v2.md`](Full-Documentation-v2.md)** (architecture, every setting,
the resolution rules, auto-merge, every website restyle, the database format, limitations).

### What they do

- **Dedup analysis**: our own points-based rating replaces Bolt's overview card, with department, Appeal and Bolt's-score chips beside it and a Write-up / Points / Bolt's switch (Full-Documentation-v2.md, section 10.6).
- **Automation per pair**, controlled by four settings in the gear pane:
  - **Pairs in range** slider, by our rating (Bolt's score is one input): None, High, Medium, Low, All (each position adds to the one before; an applicant side does not put a pair in range).
  - **Use picks from**: Bolt's or Ours (Ours includes the applicant rule).
  - **When done**: Wait for me, or Merge after a cancel countdown (a centred dialog with a stepped ring,
    a short brief (names, Bolt score, how often the script agrees with Bolt, what it chose over Bolt) and a Cancel button; length set by **Merge countdown**, 2-15 s, or a 4 s "race lights" start signal). This setting
    resets every browser session. A final safety check runs before Merge Contacts is clicked.
  - **Auto-Skip**: skips blocked and out-of-range pairs (Next duplicate
    only, never Dismiss); off = stop on them. There are no popups: an appeal shows as a chip beside our score.
  - **Next after merge**: after a merge, presses "Next duplicate" on the "Merge completed" card (default on).
  - Slider **None** (or no Allowed department ticked) with Auto-Skip on is a **scan**: every pair is
    recorded in the database and skipped.
- **A Bolt error is not a stop**: when the score chip reads **Error** (Bolt's analysis failed) the pair is rated and handled like any other; the error counts as −5 points in our score and there are just no Bolt picks to compare with.
- **Blockers**: forbidden names, an `appeal` keyword, wrong department, student-ID mismatch (ignored pairs are already filtered out of the v2 queue).
- **Field rules**: applicant side first, then personal email (two personal addresses: more email opens, then clicks, then a name / birth-year tiebreak), csusb.major /
  csusb.school (one side), date-of-birth validity, first generation, later intended term, name case and address
  comparison. Rows Bolt leaves unselected and no rule covers (Milestones, Sources, ...) are filled: side with data,
  then the more recent profile (Created date), then the selected email's side, then an arbitrary stable side. A rule that
  applies but cannot decide (dual personal email, address tie, csusb.major / school on both sides) with no Bolt pick
  means the pair needs manual review: it is never auto-merged and never skipped.
- **Review-page visuals**: Bolt-vs-ours pick colours (green agree, blue Bolt, orange ours), applicant band,
  comparison bar with *Use Bolt AI picks* / *Use our picks* and a blue **hover preview** of what each would
  select, High / Medium / Low score-chip colours, a pinned queue nav.
- **Website restyles (Material 3, orange palette sampled from Element's header)**: gear icon and settings pane,
  Review Queue / History tabs, a compact Advanced Filters panel, a Page box with Go on the list paginator,
  a **merged-profile search** on the History page (pages through the history API for a name, email or Spark ID),
  the expanded header search (and the History search) restyled as a Material 3 Expressive search bar,
  and one shared toast stack (bottom-left) for both scripts.
- **Database v2**: records blocked / skipped pairs keyed on the two contacts' **Spark IDs** (the review
  URL no longer changes per pair), stores names as 3-letter prefixes (`Jon...`), shows right-aligned department
  badges on the list page (matched through the list API's `identities[]`, falling back to names; the Firstname 2 / Lastname 2 columns are left blank when both contacts share a name, and a blank counts as "same as the first"), exports an
  **password-protected `.xlsx` spreadsheet**, to share, or a personal `.elmdb` file locked to your Element451 login that only these scripts read (every download is protected: the spreadsheet with a password you set once and the browser remembers (type one, or generate a random password or a three-word passphrase), the personal file with no password; see section 19 of the full documentation) (columns `Bolt Score, Dedup Score, Firstname, Lastname, Firstname 2, Lastname 2, Spark ID 1, Spark ID 2, Dept., Scan Date, Merged, Script vs Bolt, Row Contents`;
  preset column widths, frozen header row, filter buttons on Bolt Score, Dedup Score, Dept. and Merged, the merged-away Spark ID and names struck through; Merged = Y/N, Script vs Bolt = what the script chose over Bolt)
  and imports both protected forms and old plain `.xlsx` files (columns are read by header name), and has a **Show Database UI** toggle (under
  Display). Before every auto-skip the main script asks it to record the pair first.

- **Database Merge** (optional): a **Merge Databases** button in the settings pane, under the Database section (it only
  appears while the Database script is active), opens a new tab where you add as many exported databases as you like
  (protected `.xlsx` or `.elmdb` files, or this browser's stored one without downloading it first), merge them, read a breakdown
  (how many entries became how many pairs, duplicates dropped, how many entries each file kept or lost, differences between files and which copy won), then download the merged
  database (password protected, like every download) or replace this browser's database with it. When a pair is in more than one source, the most up to date copy (the later Scan Date) wins.

### Limitations (details in the full documentation)

- Developed against saved HTML, mock pages and live feedback; the score-chip text, the History search box placement and the First name / Last name row labels are inferred. The merge counter is hidden by default (`localStorage.elm_show_merge_counter = 'true'`).
- **Rows per page** cannot be changed from the script. The **Page / Go** box works (it sets the paginator
  directly if it can, otherwise it clicks First / Next).
- When both emails are personal, email opens then clicks (from the engagement panel, which the script opens itself) decide; if those tie and nothing in the addresses separates them either, no pick is made and the pair is left for manual review.
- The classic scroll-to-bottom requirement and Auto-Click FAB were not ported. (The email-open-count tiebreaker is back, fed by the engagement panel.)
- Dismiss is never clicked by a script (it permanently tells Bolt a pair is not a duplicate); skipping only uses
  Next duplicate.

---

---

## Chrome Web Store edition

A second build of the extension, made for the Chrome Web Store (`extension-store/`): no `userScripts` permission, nothing downloaded from GitHub, and the three scripts are bundled in the package, so the code that runs is the code the store reviewed and the **store delivers updates**. Access is only `*.element451.io`. It has its own version and its own releases (`store-vX.Y.Z`); see [STORE.md](STORE.md) for the listing text, the permission justifications and the release steps, and [PRIVACY.md](PRIVACY.md) for the privacy policy (nothing is collected or sent anywhere). The extension below stays as it is for people who load it unpacked.

---

## Chrome extension (optional)

The v2 scripts can also run as an unpacked Chrome / Edge extension that updates them from GitHub every time Chrome starts, with a popup to switch each script on or off.

1. Download `elm451-dedup-tools-vX.Y.Z.zip` from [Releases](../../releases) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the unzipped folder.
3. Open the extension's **Details** and turn on **Allow user scripts** (Chrome needs this for any userscript extension, Tampermonkey included).
4. Reload your Element451 tab.

The scripts are fetched from this repo's `main` branch on Chrome start (and once right after you load the extension); the toolbar icon shows an arrow and the popup an **Update available** chip when a newer extension zip is released (the extension itself has to be updated by hand: unzip over the folder and reload it). Firefox users keep using Tampermonkey. Details, build and release workflow: [section 16 of the full documentation](Full-Documentation-v2.md#16-chrome-extension).

---

## Installation

**Tampermonkey (any browser, including Firefox):**
1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Create a userscript with the contents of `Element451-UI-Perfection-v2.user.js` and, optionally, a second one with
   `database-v2.js`, and, if you want to merge databases, a third with `database-merge-v2.js` (it needs the Database
   script to show its button). Install each once, and do not run them alongside the classic scripts. Open the gear pane to
   confirm which versions are running.
3. Navigate to your Element451 duplicates page. The scripts activate automatically on `*.element451.io`.

**Chrome:** see [Chrome extension](#chrome-extension-optional) above. Do not install the same script in both
Tampermonkey and the extension; if you do, each script's guard keeps only one copy running.

## Inter-script communication

The two scripts talk through the page, not through any shared code:

| Channel | Direction | Mechanism |
|---|---|---|
| Department, Spark IDs, script-vs-Bolt line, Bolt score, our points | UI Perfection -> Database | `document.body.dataset.csvDept`, `csvSpark1`, `csvSpark2`, `csvChoice`, `csvScore`, `csvPoints` (our points total) |
| Record before skipping | UI Perfection -> Database | `elm2-record-pair` event on `document` (the Database script sets `detail.handled` / `.recorded`) |
| Confirmed merge | UI Perfection -> Database | `elm2-pair-merged` event (`detail.a`, `.b`, `.choice`, `.lost`, `.names`) |
| Blocked row text | UI Perfection -> Database | `.diff-row.elm2-blocked-row` elements |
| UI injection targets | UI Perfection -> Database | `#elm-controls-wrapper` (counter), `#elm-settings-pane .settings-body` (Database section and version line) |
| Merge Databases button, stored database | Database -> Database Merge | the merge script adds its button inside `#elm-settings-db-section` (so it only shows while the Database script is active) and reads `localStorage.elm_csv_database`; it has no other link to the Database script |

UI Perfection works without the Database script. The Database script needs UI Perfection for its signals.

## localStorage keys

| Key | Used by | Purpose |
|---|---|---|
| `elm_range_level2` | UI Perfection | Pairs-in-range slider (0 None ... 4 All) |
| `elm_use_picks` | UI Perfection | Use picks from (`ours` / `bolt`) |
| `elm_when_done` (sessionStorage) | UI Perfection | When done (`wait` / `merge`), reset each browser session |
| `elm_merge_countdown` | UI Perfection | Cancel-countdown seconds (2-15) or `race` |
| `elm_auto_skip_blocked` | UI Perfection | Auto-Skip |
| `elm_next_after_merge` | UI Perfection | Next after merge (default on) |
| `elm_outcome_toasts` | UI Perfection | Toasts switch |
| `elm_highlight_rows` | UI Perfection | Highlight Rows |
| `elm_allowed_department` | UI Perfection | Allowed departments (UnderGrad, Grad/IA checkboxes) |
| `elm_allow_appeal`, `elm_allow_forbidden` | UI Perfection | Appeal and Forbidden checkboxes next to the departments (`true` = worked on instead of blocked; default off) |
| `elm_show_merge_counter` | UI Perfection | Hidden: show the merge counter |
| `elm_merge_count` | UI Perfection | Merge counter value |
| `elm_pair_ratings` | UI Perfection | Our rating of each pair opened (keyed by the two Spark IDs), for the list's score chips |
| `elm_row_pairs` | UI Perfection | List rows tied to their pair by the click that opened them (a hash of the row's words, no names) |
| `elm2_bolt_picks` | UI Perfection | Bolt's original pick per conflicting row, hashed (no names or emails), so a revisited pair still shows what Bolt picked |
| `elm_csv_database` | Database | Recorded pairs (JSON array, Spark-ID keyed) |
| `elm_show_db_ui` | Database | Show Database UI |
| `elm_db_password` | Database | the database password for the shared Excel file, as typed |
| `elm_db_login_mark` | Database | a short fingerprint of the signed-in person's ID (not the ID) |

The Chrome extension keeps its own switches and cached scripts in `chrome.storage.local` (see the full documentation).
