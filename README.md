# CSUSB De-Dup Extension

Two Tampermonkey userscripts that streamline the Element451 duplicate-contact merge workflow at CSUSB. **UI Perfection** handles the merge page (auto-resolution, lockdowns, navigation), while **CSV Database** tracks blocked entries and annotates the list page.

---

## Element451 - UI Perfection (v125)

### Configuration

All settings are accessible through the **gear icon** in the navbar (no reload needed). They persist in `localStorage`.

| Setting | Default | Description |
|---|---|---|
| **Auto-Click FAB** | `true` | Automatically clicks the FAB after page loads and Spark IDs are detected. Blocked for forbidden entries, wrong departments, student ID mismatches, and ignored students. |
| **Auto-Navigate After Merge** | `true` | Navigates to the next duplicate 1 second after a successful merge. |
| **Auto-Skip Blocked** | `true` | Automatically skips blocked entries by clicking "Next" after the CSV database records them. |
| **Require Scroll to Bottom** | `true` | Requires scrolling to the bottom of all merge fields before the merge button activates. |
| **Show Merge Counter** | `true` | Displays the merge counter pill in the navbar. |
| **Allowed Department** | `UnderGrad` | Department filter. Options: `All` (no filtering), `UnderGrad`, `Grad`, `IA`, `None` (block everything). |
| **Conflict Row Threshold** | `2` | Number of identity conflicts before a twin/different-person warning. `0` to disable. |
| **Header Offset** | `64` | Pixels from top when scrolling to conflict rows. |

---

### Contacts List Page

**Custom Pagination:** Injects a page number input and page size (limit) input into the paginator. GO button or Enter navigates to the specified page. Updates URL `offset` and `limit` parameters. Works independently for top and bottom paginators.

---

### Contacts Merge Page

#### Entry Lockdowns

Lockdowns are checked in priority order. When triggered, the FAB turns red with a null symbol and clicking it shows an alert explaining the block.

**1. Forbidden Entry Lockdown** (highest priority)
Blocks entries where First Name or Last Name contains "test" (either side), or the full name exactly matches Angela Armstrong, Gillespie Armstrong, or Mariah Armstrong. The triggering row is highlighted red.

**2. Department Lockdown**
Blocks entries belonging to a department other than the configured `Allowed Department`. Detection scans rows containing Workflows, Application, Program, type:, status:, or Outreach_ for these patterns:

| Pattern | Classification |
|---|---|
| `GRAD_` or `grad student` | Grad |
| `IA_`, `_IA_`, or `_IA ` | IA |
| `Outreach_` without `UGRD` | Non-Undergrad (ambiguous — blocked for all specific departments) |
| None of the above | UnderGrad (default) |

- **All**: no filtering, everything allowed.
- **None**: blocks everything regardless of classification.
- **UnderGrad / Grad / IA**: blocks anything that doesn't match.
- **Non-Undergrad**: always blocked for UnderGrad, Grad, and IA. Kept as orange "Unresolved" on the list page since it can't be confidently classified.

The triggering row is highlighted red.

**3. Student ID Mismatch Lockdown**
Blocks entries where the left and right sides have different School Id values — these are two different students and cannot be merged. The School ID row is highlighted with a deep red border and shadow. This is a complete block with no override.

**4. Ignored Student Detection**
Detects students with the "Ignored" chip. Auto-click and auto-skip treat ignored students as blocked entries.

#### Conflict / Possible Twins Warning

Before auto-click proceeds, compares First Name, Last Name, Date of Birth (valid years only), and Address between left and right sides. If the conflict count meets or exceeds the threshold (default 2), an alert lists which fields conflict. The user must acknowledge before auto-click continues.

#### Auto-Click FAB

Waits for Spark IDs to appear (confirming page content has loaded), then clicks the FAB. Blocked if any lockdown or ignored student is detected. Retries at 1s, 2s, and 3.5s intervals. Includes console logging for debugging.

#### Auto-Skip Blocked Entries

After auto-click is blocked, waits for the CSV Database script to record the entry (polls `localStorage` every 500ms, up to 10 seconds), then clicks "Next". If the database script is not installed, skips after 1.5 seconds.

**Race condition protection:** Each poll iteration re-checks whether the entry is still actually blocked. If new merge rows loaded that changed the department detection (e.g., grad rows appearing after Spark IDs), the skip is aborted and auto-click is retried. This prevents grad entries from being incorrectly skipped when the allowed department is Grad.

#### Auto-Resolution of Conflict Rows

Triggered when the FAB is clicked. Only applies to rows with the `has-error` class. Resolution follows a priority system (highest to lowest):

**1. Cal State Apply Application side**
If one side has "Cal State Apply Application" and the other doesn't, all conflicts follow that side (yellow highlight overlay applied). If both have it, the most recent date wins.

**2. Application type entries**
Counts Application Start, Application Submit, Application Complete, and Admit entries. Side with more wins; if tied, most recent date wins.

**3. Milestone Type Matching**
When both sides have the same milestone type (e.g., "type: Prospect"), selects left. Only applies when no applicant context is found.

**4. Email preference**
Prefers personal email domains over institutional: gmail.com, yahoo.com, icloud.com, hotmail.com, aol.com, me.com, outlook.com, live.com, msn.com, protonmail.com, proton.me.

**5. Dual personal email tiebreaking** (when both sides have personal domains)
Multi-tier system tried in order until one side wins:
1. Email open count from the User Activity section
2. First name appearing in the email address
3. Last name appearing in the email address
4. Birth year appearing in the email address (checks 4-digit, 3-digit, and 2-digit forms)
5. Manual review if still tied

**6. csusb.major preference**
Side with `csusb.major.*` wins. If both have it, follows email selection. If no email selected, manual review.

**7. Encoura ID**
If both sides have "Encoura Id:", selects left.

**8. College Board ID**
If both sides have "College Board Id:", selects left.

**9. csusb.school preference**
For Student Type rows with `csusb.school.*`. If only one side has it, that side wins. If both, follows email selection.

**10. Date of Birth**
Rejects invalid birth years (starting with '0' or before 1900). Picks the valid side.

**11. First Generation Student**
Always prefers "Yes" over "No".

**12. Intended Term**
Prefers the later term code. Parses from format like "Spring 2027 (2274)" — higher 4-digit code = later term.

**13. Name case preference**
When names differ only in case, prefers Title Case over ALL CAPS or all lowercase.

**14. Legacy / default patterns**
Spark Id, Record Created, Custom type, Web type, ACUx, and Outreach_UGRD_ all default to left side. Skipped if an applicant side is detected.

#### Address Resolution

Uses a built-in `AddressComparer` module:
- Parses US addresses into structured components (number, prefix, street, type, suffix, city, state, zip, unit)
- Normalizes street types (Street -> St, Avenue -> Ave) and directions (North -> N)
- Strips country variations (United States, USA, US)
- Detects duplicate components via fuzzy matching (Levenshtein distance at 80% similarity threshold)
- Calculates completeness scores (points for each component, heavy penalty for duplicates)
- **Only auto-selects when addresses are the same.** Different addresses result in a tie and follow email selection or require manual review.
- When addresses are the same, picks the more complete one (e.g., includes apt number, country info).

#### Smart Links (appear after FAB click)

- **Email links:** Turned into links to mailmeteor.com email verification.
- **Address links:** "Home, [address]" turned into Google Maps links with prettified Title Case display.
- **Phone formatting:** Reformatted as (xxx)-xxx-xxxx or +cc (xxx)-xxx-xxxx for international.

#### FAB States and Navigation

| State | FAB Appearance | Click Behavior |
|---|---|---|
| **Blocked** (forbidden/dept/ID mismatch) | Red with null symbol | Shows alert explaining the block |
| **First click** (conflicts not visible) | Default | Triggers native conflict detection, runs auto-resolution, scrolls to first unresolved row |
| **Unresolved conflicts** | Default | Scrolls to the next unresolved red row |
| **Review required** (not scrolled to bottom) | Grey with down arrow | Shows scroll reminder alert |
| **Ready to merge** (all resolved + scrolled) | Green, expanded with "Merge" text | Passes click through to trigger actual merge |

#### Merge Success Detection

After the green FAB is clicked, watches for `elm-empty-state` containing "Duplicate user is now merged with master". On detection: increments the merge counter and auto-navigates to the next duplicate (1-second delay).

#### URL Change Detection with Smart Reload

Monitors SPA navigation. Maintains a session-scoped Set of up to 10 recently-seen duplicate IDs. Revisiting a previously-seen ID forces a full page reload for clean state. New duplicates reset all per-page flags and re-run logic.

#### UI Elements

- **Merge Counter:** Pill badge in the navbar showing "Merges: N" with a reset button. Stored in `localStorage`. Animates on increment.
- **High Contrast Toggle:** Checkbox in the navbar toggling colored borders on conflict rows (red/green) and the yellow applicant highlight.
- **Settings Gear:** Opens a Material-design-inspired settings panel with Display, Automation, and Department sections.
- **Ghost Tooltip Suppression:** Makes CDK overlay tooltips non-interactive to prevent them from blocking clicks.
- **Toast Suppression:** Removes "resolve" snackbar toasts every 100ms to prevent them from covering the UI.

---

## Element451 - CSV Database (v4)

A companion script that tracks blocked entries in a local database and annotates the duplicates list page with department badges.

### How It Works

1. Polls `document.body.dataset.csvDept` every 1 second (set by UI Perfection).
2. When a department value appears, extracts first name, last name, department, blocked row content, and unique ID.
3. Stores entries in `localStorage` as JSON. Deduplicates by unique ID; updates existing entries if any field changed.

### Database Format

JSON array in `localStorage` key `elm_csv_database`. Each entry:

```json
{ "firstName": "...", "lastName": "...", "dept": "...", "rowContents": "...", "uniqueId": "..." }
```

Possible `dept` values: `Grad`, `IA`, `UnderGrad`, `Non-Undergrad`, `Forbidden`, `Ignored`.

### List Page Department Badges

On the duplicates list page, rewrites the default orange "Unresolved" chip on each row to show the department with color-coding:

| Department | Label | Background | Text Color |
|---|---|---|---|
| Grad | Graduate | Blue (#e3f2fd) | Blue (#1565c0) |
| IA | International | Yellow (#fff9c4) | Amber (#f57f17) |
| UnderGrad | UnderGrad | Purple (#f3e5f5) | Purple (#6a1b9a) |
| Forbidden | Forbidden | Pink (#fce4ec) | Pink (#c2185b) |
| Ignored | Ignored | Grey (#f5f5f5) | Grey (#616161) |
| Non-Undergrad | *(kept as default "Unresolved")* | *(unchanged)* | *(unchanged)* |

**Staleness protection:** Tracks which page the API data was captured for. When navigating between pages, stale data is invalidated and annotations are cleared before re-applying. Each annotation is stamped with an API generation counter to force re-evaluation when fresh data arrives. Row unique IDs are stamped as `data-csv-uid` attributes to survive Angular re-ordering.

**API interception:** Hooks into both `XMLHttpRequest` and `fetch` to capture the duplicates list endpoint response and extract unique IDs for each row.

### Settings (in the UI Perfection settings pane)

Three action buttons in a "Database" section:

- **Download Database:** Exports as CSV (`elm_csv_database_YYYY-MM-DD.csv`). Columns: Firstname, Lastname, Dept., Row Contents, Unique ID.
- **Upload & Replace Database:** Imports a CSV file, validates structure, replaces the entire database after confirmation.
- **Clear Database:** Deletes all entries after confirmation and reloads the page.

### UI Elements

- **DB Badge:** Pill badge in the navbar showing "DB: N" (entry count). Updates every 1 second.

---

## Inter-Script Communication

| Channel | Direction | Mechanism |
|---|---|---|
| Department signal | UI Perfection -> CSV Database | `document.body.dataset.csvDept` attribute on `<body>` |
| Blocked row content | UI Perfection -> CSV Database | `.blocked-row` / `.blocked-row-critical` CSS classes on `elm-merge-row` elements |
| UI injection targets | UI Perfection -> CSV Database | `#elm-controls-wrapper` (badge), `#elm-settings-pane .settings-body` (settings section) |
| Recording confirmation | CSV Database -> UI Perfection | `localStorage.getItem('elm_csv_database')` checked by auto-skip before navigating away |

The CSV Database script depends on UI Perfection for DOM structure and signals. UI Perfection degrades gracefully if the CSV Database script is not installed (auto-skip proceeds after 1.5s instead of waiting for database confirmation).

---

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Create a new userscript and paste the contents of `Element451-UI-Perfection.user.js`.
3. (Optional) Create a second userscript and paste the contents of `csv-database.js` for entry tracking and list page annotations.
4. Navigate to your Element451 duplicates page. The scripts activate automatically on `*.element451.io`.

## localStorage Keys

| Key | Used By | Purpose |
|---|---|---|
| `elm_require_scroll_to_bottom` | UI Perfection | Scroll-to-review setting |
| `elm_auto_click_fab` | UI Perfection | Auto-click FAB setting |
| `elm_auto_navigate_after_merge` | UI Perfection | Auto-navigate setting |
| `elm_show_merge_counter` | UI Perfection | Show/hide merge counter |
| `elm_auto_skip_blocked` | UI Perfection | Auto-skip blocked entries setting |
| `elm_allowed_department` | UI Perfection | Department filter setting |
| `elm_high_contrast` | UI Perfection | High contrast toggle state |
| `elm_merge_count` | UI Perfection | Merge counter value |
| `elm_csv_database` | CSV Database | JSON array of recorded entries |
