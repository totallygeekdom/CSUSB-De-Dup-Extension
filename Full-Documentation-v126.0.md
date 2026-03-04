# **Element451 UI Perfection \- Full Documentation**

**Version:** 126 (UI Perfection) / 7 (CSV Database)
 **Purpose:** Two Tampermonkey userscripts that streamline the Element451 duplicate-contact merge workflow at CSUSB. UI Perfection handles the merge page (auto-resolution, lockdowns, navigation), while CSV Database tracks blocked entries and annotates the list page.

---

## **Table of Contents**

1. [Configuration Constants](#configuration-constants)
2. [Automation Features](#automation-features)
3. [Auto-Resolution System](#auto-resolution-system)
4. [Visual Feedback System](#visual-feedback-system)
5. [Navigation & UI Enhancements](#navigation-&-ui-enhancements)
6. [Safety Features](#safety-features)
7. [Settings Pane](#settings-pane)
8. [Utility Features](#utility-features)
9. [State Management](#state-management)
10. [CSV Database Module](#csv-database-module)
11. [Inter-Script Communication](#inter-script-communication)
12. [CSS Selectors Reference](#css-selectors-reference)

---

## **Automation Features** {#automation-features}

### **Auto-Click FAB**

**Purpose:** Automatically trigger the merge workflow by clicking the FAB button once after page load, eliminating the need for manual first click on every merge page.

**Enabled By Default:** `AUTO_CLICK_FAB = true`

#### **Trigger Conditions**

The auto-click will ONLY occur when ALL of the following conditions are met:

10. **Feature Enabled:** `AUTO_CLICK_FAB = true`  
11. **Not Already Attempted:** `autoClickAttempted = false`  
12. **FAB Not Clicked:** `fabHasBeenClicked = false` (manual or auto)  
13. **Page Fully Loaded:** Spark IDs detected (indicates DOM is ready)  
14. **No Forbidden Entry:** Not a test record or blocked name  
15. **No Department Block:** Not a Graduate/International Admissions record  
16. **Not Ignored:** Student doesn't have "Ignored" chip

#### **Safety Blocks**

Auto-click is **immediately blocked** and will not retry if any of these conditions are detected:

**Forbidden Entry Detection:**

- First Name or Last Name contains "test"  
- Full name matches a hardcoded forbidden names list (see script source)
- Console: `⛔ Auto-click blocked: Forbidden entry detected`

**Department Lockdown:**

- Record contains GRAD\_, IA\_, or non-UGRD Outreach markers  
- Console: `⛔ Auto-click blocked: Wrong department detected`

**Ignored Student:**

- Student has "Ignored" chip  
- Console: `⛔ Auto-click blocked: Ignored student detected`

#### **Timing Strategy**

**On Page Load (Initial):**

setTimeout(attemptAutoClickFAB, 1000);  // First attempt

setTimeout(attemptAutoClickFAB, 2000);  // Retry if Spark IDs not ready

setTimeout(attemptAutoClickFAB, 3500);  // Final attempt

**On URL Navigation (SPA):**

// After detecting new duplicate ID

setTimeout(attemptAutoClickFAB, 200);  // Small delay for DOM stability

**In Mutation Observer:**

// Continuously checks if conditions are met

if (\!autoClickAttempted && \!fabHasBeenClicked) {

    attemptAutoClickFAB();

}

#### **State Management**

**Tracking Variables:**

let fabHasBeenClicked \= false;     // Tracks manual OR auto clicks

let autoClickAttempted \= false;    // Prevents repeated attempts

let mergeSuccessProcessed \= false; // Prevents duplicate merge success triggers

let awaitingMergeSuccess \= false;  // Tracks if green FAB was clicked (enables merge detection)

let conflictWarningShown \= false;  // Tracks if twin/different person warning was shown

**Reset on Navigation:**

// When navigating to new duplicate page:

fabHasBeenClicked \= false;      // Allow new auto-click

autoClickAttempted \= false;     // Reset attempt flag

hasScrolledToBottom \= false;    // Reset scroll requirement

mergeSuccessProcessed \= false;  // Reset merge success flag

awaitingMergeSuccess \= false;   // Reset awaiting merge flag

conflictWarningShown \= false;   // Reset conflict warning flag

#### **Console Logging**

The auto-click feature provides detailed console feedback:

**Success:**

🤖 Auto-clicking FAB (triggered by page load)...

**Waiting for Page Load:**

⏳ Auto-click waiting: Spark IDs not loaded yet

**Blocked \- Forbidden Entry:**

⛔ Auto-click blocked: Forbidden entry detected

**Blocked \- Wrong Department:**

⛔ Auto-click blocked: Wrong department detected

**Blocked \- Ignored Student:**

⛔ Auto-click blocked: Ignored student detected

**Failure:**

⚠️ Auto-click failed: FAB button not found

#### **Integration Points**

**1\. URL Change Detection:**

- Triggered when navigating to new duplicate page (not revisiting)
- 200ms delay after `runLogic()` completes
- Flags reset: `fabHasBeenClicked`, `autoClickAttempted`, `hasScrolledToBottom`, `conflictWarningShown`

**2\. Mutation Observer:**

- Checks continuously as DOM updates  
- Only attempts if not yet attempted and FAB not clicked  
- Catches cases where Spark IDs load after initial attempts

**3\. Initial Page Load:**

- Three attempts at 1000ms, 2000ms, 3500ms  
- Allows progressively loaded pages to trigger auto-click  
- Stops after first successful click

#### **Behavior After Auto-Click**

Once auto-click succeeds, the normal FAB workflow executes:

1. Element451's native conflict detection creates error rows  
2. Auto-resolution logic runs (100ms, 300ms, 500ms delays)  
3. Smart links and applicant side highlight are applied  
4. Page scrolls to first unresolved conflict  
5. Subsequent manual clicks navigate through remaining conflicts

#### **Disabling Auto-Click**

To disable auto-click and require manual FAB clicking:

// At top of userscript:

const AUTO\_CLICK\_FAB \= false;

This reverts to the original manual workflow where users must click the FAB button themselves to trigger conflict detection and auto-resolution.

---

### **Auto-Navigate After Merge**

**Purpose:** Automatically navigate to the next duplicate in the queue after a successful merge, streamlining the workflow.

**Enabled By Default:** `AUTO_NAVIGATE_AFTER_MERGE = true`

#### **Trigger**

The merge success detection **only activates after the green FAB is clicked** (when ready to merge). This prevents false triggers.

#### **Detection**

The feature detects merge success by watching for the Element451 success state:
- Any `elm-empty-state` element containing text "Duplicate user is now merged with master"

#### **Behavior**

1. User clicks the green FAB (ready to merge state)
2. `awaitingMergeSuccess` flag is set to true
3. Script starts watching for the merge success message
4. When merge success is detected:
   - Merge counter is incremented
   - Console logs: `✅ Merge successful - counter incremented`
5. If `AUTO_NAVIGATE_AFTER_MERGE` is enabled:
   - Waits 1 second (so user can see the success message)
   - Clicks the next pagination button (`button[mattooltip="Next"]`)
   - Console logs: `➡️ Auto-navigating to next duplicate...`
6. If no next page is available (end of list or button disabled):
   - Console logs: `⚠️ No next page available - end of list or button disabled`

#### **State Tracking**

- `awaitingMergeSuccess` flag tracks if green FAB was clicked (only then does detection run)
- `mergeSuccessProcessed` flag prevents duplicate triggers for the same merge
- Both flags reset on navigation to a new duplicate page

#### **Disabling Auto-Navigate**

To disable auto-navigation and stay on the success page after merge:

// At top of userscript:

const AUTO\_NAVIGATE\_AFTER\_MERGE \= false;

This keeps the merge counter increment behavior but stops the automatic navigation.

---

### **Twin/Different Person Detection**

**Purpose:** Warn users when records may belong to twins or two different people based on conflicting information.

**Enabled By Default:** `CONFLICT_ROW_THRESHOLD = 2` (warn if 2+ conflicts)

#### **What It Checks**

The script compares left and right values for these rows:

1. **First Name** - Case-insensitive comparison with spaces and hyphens removed
2. **Last Name** - Case-insensitive comparison with spaces and hyphens removed
3. **Date of Birth** - Only compares if both sides have valid years (not starting with 0, >= 1900)
4. **Address** - Uses AddressComparer to determine if addresses are the same

#### **Behavior**

1. Runs **before** FAB auto-click
2. Counts how many of the above rows have conflicting (different) values
3. If conflict count >= `CONFLICT_ROW_THRESHOLD`:
   - Shows alert popup with warning message
   - Lists which fields have conflicts
   - User must click OK to acknowledge
4. After acknowledgment, auto-click and auto-resolution proceed normally
5. Warning only shows once per page (tracked by `conflictWarningShown` flag)

#### **Alert Message**

```
⚠️ Warning: X conflicting rows detected!

Conflicts found in: First Name, Last Name, Date of Birth, Address

These entries might be twins or two different people. Please review carefully before merging.
```

#### **State Tracking**

- `conflictWarningShown` flag prevents showing warning multiple times per page
- Flag resets on navigation to a new duplicate page

#### **Disabling**

To disable twin/different person detection:

// At top of userscript:

const CONFLICT\_ROW\_THRESHOLD \= 0;

---

### **Auto-Skip Blocked Entries**

**Purpose:** Automatically navigate past blocked entries (forbidden, wrong department, student ID mismatch, ignored) without manual intervention.

**Enabled By Default:** `AUTO_SKIP_BLOCKED = true`

#### **Behavior**

1. After auto-click is blocked, waits for the CSV Database script to record the entry
2. Polls `localStorage` for the `elm_csv_database` key every 500ms, up to 10 seconds
3. Once the entry is recorded (or timeout), clicks the "Next" pagination button
4. If the CSV Database script is not installed, skips after 1.5 seconds

#### **Race Condition Protection**

Each poll iteration re-checks whether the entry is still actually blocked. If new merge rows loaded that changed the department detection (e.g., grad rows appearing after Spark IDs), the skip is aborted and auto-click is retried. This prevents grad entries from being incorrectly skipped when the allowed department is Grad.

#### **State Tracking**

- `autoSkipAttempted` flag prevents repeated skip attempts on the same page
- Flag resets on navigation to a new duplicate page

---

## **Configuration Constants** {#configuration-constants}

All settings are accessible through the **gear icon (⚙)** in the navbar. Changes take effect immediately without a reload. Settings persist in `localStorage`.

| Setting | localStorage Key | Default | Description |
| :---- | :---- | :---- | :---- |
| **Require Scroll to Bottom** | `elm_require_scroll_to_bottom` | `true` | Requires scrolling to the bottom of all merge fields before the merge button activates |
| **Auto-Click FAB** | `elm_auto_click_fab` | `true` | Automatically clicks the FAB after page loads and Spark IDs are detected. Blocked for forbidden entries, wrong departments, student ID mismatches, and ignored students |
| **Auto-Navigate After Merge** | `elm_auto_navigate_after_merge` | `true` | Navigates to the next duplicate 1 second after a successful merge |
| **Show Merge Counter** | `elm_show_merge_counter` | `true` | Displays the merge counter pill in the navbar |
| **Auto-Skip Blocked** | `elm_auto_skip_blocked` | `true` | Automatically skips blocked entries by clicking "Next" after the CSV database records them |
| **Allowed Department** | `elm_allowed_department` | `UnderGrad` | Department filter. Options: `All` (no filtering), `UnderGrad`, `Grad`, `IA`, `None` (block everything) |

**Hardcoded Constants:**

| Constant | Value | Description |
| :---- | :---- | :---- |
| `CONFLICT_ROW_THRESHOLD` | `2` | Number of identity conflicts before a twin/different-person warning. `0` to disable |
| `HEADER_OFFSET` | `64` | Pixels from top when scrolling to conflict rows |

---

## **Auto-Resolution System** {#auto-resolution-system}

**Trigger Timing**: Auto-resolution runs when user manually clicks the FAB. The `runAutoResolution()` function is called after the FAB click creates error rows.

### **1\. Applicant Side Detection (Highest Priority)**

**Purpose:** Identifies which side (left or right) contains the actual applicant's record, then applies that preference to ALL conflict rows.

**Detection Methods (in priority order):**

#### **A. Cal State Apply Application Detection**

* **Regex/Pattern:** `text.includes('Cal State Apply Application')`  
* **Logic:**  
  * If only one side has "Cal State Apply Application" → that side is the applicant  
  * If BOTH sides have it → compare dates using `parseApplicationDate()` and pick the most recent  
* **Date Pattern:** `/(?:updated at\s*)?(\w{3})\s+(\d{1,2}),?\s+(\d{4})\s*-?\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i`  
  * Matches: `Apr 17, 2025 - 1:49 AM` or `updated at Apr 17, 2025 - 2:36 AM`  
* **Data Attribute:** `row.dataset.csuApplication = "left" | "right"`

#### **B. Application Type Entries Detection**

* **Regex:** `/type:\s*(Application Start|Application Submit|Application Complete|Admit)/i`  
* **Logic:**  
  * If only one side has application entries → that side is the applicant  
  * If BOTH sides have entries → count occurrences, pick side with more  
  * If tied → compare dates, pick most recent  
* **Count Pattern:** `/type:\s*(Application|Admit)/gi`  
* **Data Attribute:** `row.dataset.applicantRecord = "left" | "right"`

**Key Behavior:** Once applicant side is determined, ALL `elm-merge-row.has-error` rows automatically select that side.

---

### **2\. Milestone Type Matching**

**Purpose:** When milestone rows have the same type value, prefer left side for consistency.

**Condition:** Only applies when no applicant context is found

**Row Detection:** `/type:\s*\w+,\s*\w{3}\s+\d{1,2},\s*\d{4}/i`

**Logic:**

* Extract type value from both sides using pattern: `/type:\s*(\w+),/i`  
* Compare types (case-insensitive)  
* If types match → select left side  
* If types differ → leave for manual review

**Example Patterns:**

* `type: Prospect, Sep 29, 2025 - 12:00 AM`  
* `type: Applicant, Jan 15, 2025 - 9:30 AM`  
* `type: Inquiry, Mar 22, 2025 - 3:15 PM`

**Data Attribute:** `row.dataset.milestoneTypeMatch = "true"`

---

### **3\. Email Resolution**

**Purpose:** When no applicant record is found, prefer personal email domains over institutional/other emails.

**Personal Domains List:**

\['gmail.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'aol.com',  
'me.com', 'outlook.com', 'live.com', 'msn.com', 'protonmail.com', 'proton.me'\]

**Detection:** `text.toLowerCase().includes('email')` (but excludes `'email open'`)

**Logic:**

* If only one side has personal domain → select that side  
* If BOTH sides have personal domains → mark as `data-dual-personal="true"` for secondary resolution

**Data Attributes:**

* `row.dataset.emailSelection = "left" | "right"`  
* `row.dataset.dualPersonal = "true"`

---

### **4\. Dual Personal Email Tiebreakers**

**Purpose:** When both sides have personal email domains, use secondary signals to choose.

**Data Extraction:** Extracts **both** first names, **both** last names, and **both** birth years from left and right sides for comprehensive matching.

**Priority Order:**

1. **Email Opens** (from User Activity array)  
     
   * Pattern: `/(\d+)\s*email opens?/`  
   * Pick side with more email opens  
   * If tied or no opens data → continue to Priority 2

   

2. **First Name Match** *(Updated in v116.2)*  
     
   * Extracts: `firstNameLeft` and `firstNameRight` from both sides  
   * Checks **all combinations:**  
     - Left email vs left first name  
     - Left email vs right first name  
     - Right email vs left first name  
     - Right email vs right first name  
   * Logic: If **only one email** contains a first name → select that side  
   * If both emails match or neither match → continue to Priority 3

   

3. **Last Name Match** *(Updated in v116.2)*  
     
   * Extracts: `lastNameLeft` and `lastNameRight` from both sides  
   * Checks **all combinations:**  
     - Left email vs left last name  
     - Left email vs right last name  
     - Right email vs left last name  
     - Right email vs right last name  
   * Logic: If **only one email** contains a last name → select that side  
   * If both emails match or neither match → continue to Priority 4

   

4. **Birth Year Match** *(Updated in v116.2)*  
     
   * Extracts: `birthYearLeft` and `birthYearRight` from both sides  
   * **Validates both years:** Must not start with '0' AND must be \>= 1900  
   * Patterns checked: full year (2005), last 3 digits (005), last 2 digits (05)  
   * Checks **all combinations** (only for valid years):  
     - Left email vs left birth year (if valid)  
     - Left email vs right birth year (if valid)  
     - Right email vs left birth year (if valid)  
     - Right email vs right birth year (if valid)  
   * Logic: If **only one email** contains a birth year → select that side  
   * If both emails match or neither match → leave for manual decision

**Year Pattern:** `/\b(\d{4})\b/`

**Invalid Year Criteria:**

- Starts with '0' (e.g., "0005", "0199")  
- Before 1900 (e.g., "1850", "1899")

**Data Attribute:** `row.dataset.dualResolved = "true"`

---

### **5\. csusb.major Preference**

**Purpose:** Prefer records with csusb.major designation, and when both have it, follow email selection.

**Condition:** Only applies when no applicant context is found

**Row Detection:** `/csusb\.major\./i`

**Logic:**

* If only left has csusb.major → select left
* If only right has csusb.major → select right
* If BOTH have csusb.major → follow email selection side
* If both have csusb.major but no email selected → leave for manual review

**Example Patterns:**

* `Business Partner Import Major: Economics - csusb.major.181410`
* `Major: Computer Science - csusb.major.110701`

**Data Attributes:**

* `row.dataset.csusbMajorSelection = "left" | "right"` (when only one side has it)
* `row.dataset.csusbMajorFollowEmail = "true"` (when both have it)

**Important:** This logic runs AFTER email resolution, so email must be selected first for the "both have it" case.

---

### **6\. Encoura ID Preference**

**Purpose:** When both sides have Encoura ID values, always select left side.

**Condition:** Only applies when no applicant context is found

**Detection:** Both `leftText` and `rightText` contain `Encoura Id:` (case-insensitive)

**Logic:**

* If both sides have `Encoura Id:` → select left

**Example Pattern:**

* `Encoura Id: 72226502` vs `Encoura Id: 71476216`

**Data Attribute:** `row.dataset.encouraIdSelection = "left"`

---

### **7\. College Board ID Preference**

**Purpose:** When both sides have College Board ID values, always select left side.

**Condition:** Only applies when no applicant context is found

**Detection:** Both `leftText` and `rightText` contain `College Board Id:` (case-insensitive)

**Logic:**

* If both sides have `College Board Id:` → select left

**Example Pattern:**

* `College Board Id: XXXXXXXXX` vs `College Board Id: YYYYYYYYY`

**Data Attribute:** `row.dataset.collegeBoardIdSelection = "left"`

---

### **8\. csusb.school Preference**

**Purpose:** For Student Type rows, prefer records with csusb.school designation.

**Condition:** Only applies when no applicant context is found

**Row Detection:** Row contains `Student Type` AND matches `/csusb\.school\.\d+/i`

**Logic:**

* If only left has csusb.school.* → select left
* If only right has csusb.school.* → select right
* If NEITHER side has csusb.school.* → leave for manual review
* If BOTH have csusb.school.* → follow email selection side
* If both have csusb.school.* but no email selected → leave for manual review

**Example Pattern:**

* `Student Type    Niche - csusb.school.27942`

**Data Attributes:**

* `row.dataset.csusbSchoolSelection = "left" | "right"` (when only one side has it)
* `row.dataset.csusbSchoolFollowEmail = "true"` (when both have it and following email)

**Important:** This logic runs AFTER email resolution, so email must be selected first for the "both have it" case.

---

### **8\. Address Comparison (AddressComparer Module)**

**Purpose:** Intelligently compare addresses and pick the more complete/valid one.

**Features:**

#### **Country Normalization**

Removes these variations from end of address:

\['united states of america', 'united states', 'usa', 'us', 'u.s.a.', 'u.s.'\]

#### **Street Normalization**

**Direction Abbreviations:**

'north' → 'n', 'south' → 's', 'east' → 'e', 'west' → 'w',  
'northeast' → 'ne', 'northwest' → 'nw', 'southeast' → 'se', 'southwest' → 'sw'

**Street Type Abbreviations:**

'street' → 'st', 'avenue' → 'ave', 'boulevard' → 'blvd', 'drive' → 'dr',  
'road' → 'rd', 'lane' → 'ln', 'court' → 'ct', 'circle' → 'cir',  
'trail' → 'trl', 'way' → 'way', 'place' → 'pl', 'parkway' → 'pkwy',  
'highway' → 'hwy', 'terrace' → 'ter'

#### **Unit Extraction Patterns**

/(?:apt|apartment)\\s\*\#?\\s\*(\[a-z0-9-\]+)/i  
/(?:unit|ste|suite)\\s\*\#?\\s\*(\[a-z0-9-\]+)/i  
/(?:spc|space)\\s\*\#?\\s\*(\[a-z0-9-\]+)/i  
/(?:bldg|building|fl|floor|rm|room)\\s\*\#?\\s\*(\[a-z0-9-\]+)/i

#### **Duplicate Detection**

* Checks for repeated address components (e.g., street listed twice)  
* **Street Pattern:** `/(\d+[a-z]?\s+[a-z]+\s+[a-z]+)/gi`  
* **Unit Pattern:** `/(?:apt|unit|spc|space|ste|suite|#)\s*#?\s*(\d+[a-z]?)/gi`  
* **Heavy penalty (-100 score) for duplicates**

#### **Completeness Scoring**

| Component | Points |
| ----- | ----- |
| Street number | \+10 |
| Street name | \+10 |
| Street type | \+5 |
| City | \+10 |
| State | \+10 |
| ZIP | \+10 |
| Unit/Apt | \+15 |
| Prefix/Suffix | \+3 each |
| Duplicate components | \-100 |
| Malformed (number not at start) | \-20 |

**Address Row Detection:**

text.includes('Home,') || /\\d+\\s+\[A-Za-z\]+\\s+(St|Ave|Blvd|Dr|Rd|Ln|Ct|Cir|Trl|Way|Pl)\\b/i.test(text)

**Geo-Location Suffix Stripping:** Element451 appends "with geo location" to geocoded addresses. The comparer strips this suffix before parsing to prevent false mismatches. Geocoded addresses receive a small completeness bonus.

**Tie-breaker:** If scores are equal, follows the email selection side.

**Data Attributes:** `row.dataset.addressResolved = "true"`

---

### **9\. Date of Birth Validation**

**Purpose:** Reject DOB values with obviously invalid years.

**Invalid Year Detection:**

leftYear\[1\].startsWith('0') || parseInt(leftYear\[1\]) \< 1900

**Year Pattern:** `/\b(\d{4})\b/`

**Row Detection:** `text.toLowerCase().includes('date of birth') || text.toLowerCase().includes('birth date')`

---

### **10\. First Generation Student Preference**

**Purpose:** Always prefer "Yes" over "No" for first generation student status.

**Condition:** Only applies when no applicant context is found

**Row Detection:** `text.toLowerCase().includes('first generation student')`

**Logic:**

* If left side has "Yes" and right side has "No" → Select left
* If right side has "Yes" and left side has "No" → Select right
* If both sides have the same value → Leave for manual review

**Data Attributes:** `row.dataset.firstGenSelection = "left"` or `"right"`

**Console Output:** `✅ First Generation Student - selected left (Yes over No)`

---

### **11\. Intended Term Preference**

**Purpose:** Always prefer the later intended term (more recent enrollment date).

**Condition:** Only applies when no applicant context is found

**Row Detection:** `text.toLowerCase().includes('intended term')`

**Term Code Format:** `"Spring 2027 (2274)"` or `"Fall 2027 (2278)"`
- Term codes are 4-digit numbers in parentheses
- Format: YYTT where YY = encoded year, TT = term indicator
- Higher code number = later term chronologically

**Logic:**

* Extract term codes from both sides using pattern `/\((\d{4})\)/`
* Compare numeric values
* Select the side with the higher (later) term code
* If codes are equal → Leave for manual review

**Data Attributes:** `row.dataset.intendedTermSelection = "left"` or `"right"`

**Console Output:** `✅ Intended Term - selected right (later term code: 2278 > 2274)`

---

### **12\. Name Case Preference**

**Purpose:** When names are the same but have different casing, prefer Title Case.

**Condition:** Only applies when no applicant context is found

**Row Detection:** `text.toLowerCase().includes('first name') || text.toLowerCase().includes('last name') || text.toLowerCase().includes('name')` (excludes email rows)

**Logic:**

* If both sides have the same name (case-insensitive) but different casing  
    
* Prefer Title Case (`John Smith`) over ALL CAPS (`JOHN SMITH`) or all lowercase (`john smith`)  
    
* If neither is Title Case, leave for manual decision

---

### **13\. Legacy Pattern Matching**

**Purpose:** Fallback patterns when no applicant context is found.

**Patterns that default to LEFT side:**

/Spark Id:/i  
/type:\\s\*Created,\\s\*name:\\s\*Record Created/i  
/type:\\s\*Custom/i  
/type:.\*name:/i  
/type:\\s\*Web/i  
/\\\[ACUx\\\]/i  
/Outreach\\\_UGRD\\\_/i

**Note:** These patterns are applied as a blanket "select left" rule when no more specific logic applies.

---

## **Visual Feedback System** {#visual-feedback-system}

### **1\. Conflict Row States (Red/Green)**

**Target:** `elm-merge-row.has-error`

| State | Condition | Background | Border |
| ----- | ----- | ----- | ----- |
| Red (Unresolved) | Has `.ng-invalid` OR lacks `.ng-valid` | `#ffe6e6` | `2px solid #d32f2f` |
| Green (Resolved) | Has `.ng-valid` | `#e8f5e9` | `2px solid #2e7d32` |

**Hover States:**

* Red hover: `#ffcccc`  
* Green hover: `#c8e6c9`

---

### **2\. Yellow Applicant Side Highlight**

**Purpose:** Visual overlay showing which column contains the applicant's data.

**Trigger:** Only appears after user clicks FAB.

**Element ID:** `#elm-applicant-highlight`

**Styling:**

background-color: \#fff9c4;  /\* Pastel Yellow \- Material Yellow 100 \*/  
border: 2px solid \#fbc02d;  /\* Darker Yellow Border \*/  
mix-blend-mode: multiply;   /\* Text shows through \*/

**Text Coloring (on applicant side columns):**

* Color: `#e65100` (Dark Orange/Amber)  
* Font-weight: 500  
* Applied via `.applicant-side-left` or `.applicant-side-right` class on container

**Column Targeting:**

* Left side: `elm-merge-row > div:nth-child(2)`  
* Right side: `elm-merge-row > div:nth-child(4)`

**Row Structure Reference:**

\[div 1: label 124px\] \[div 2: left value \~50%\] \[div 3: arrow 118px\] \[div 4: right value \~50%\] \[div 5: trailing 124px\]

---

### **3\. High Contrast Toggle**

**Purpose:** Toggle visibility of colored borders on conflict rows.

**Storage Key:** `localStorage.getItem('elm_high_contrast')` (default: `'true'`)

**Body Class:** `body.no-highlight-borders` (when OFF)

**Effect:** Removes borders from red/green rows and yellow highlight

**UI Location:** Nav bar, left of merge counter

---

## **Navigation & UI Enhancements** {#navigation-&-ui-enhancements}

### **1\. Smart FAB (Floating Action Button) Behavior**

**Target:** `.elm-page-action-floating button`

**States:**

#### **A. Normal State**

* Border-radius: 16px  
* Min-width: 56px

#### **B. Ready to Merge State**

* Body class: `.ready-to-merge`  
* Background: `#2e7d32` (green)  
* Shows "Merge" text label (`.fab-merge-text`)  
* Width expands to fit text

#### **C. Review Required State**

* Body class: `.review-required`  
    
* Background: `#757575` (grey)  
    
* Shows "↓" down arrow symbol  
    
* Click shows alert: "Please scroll to the bottom to review all fields before merging"  
    
* Only appears when `REQUIRE_SCROLL_TO_BOTTOM = true` and all conflicts are resolved but user hasn't scrolled to bottom yet

#### **D. Forbidden Entry State**

* Body class: `.forbidden-entry`  
* Background: `#d32f2f` (red)  
* Shows "∅" symbol  
* Click shows alert: "Forbidden entry"  
* **Highest priority \- checked before department lockdown**

#### **E. Wrong Department State**

* Body class: `.wrong-department`  
* Background: `#d32f2f` (red)  
* Shows "∅" symbol  
* Click shows alert: "For other Department"

**Click Behavior:**

1. **First check:** Forbidden entry (highest priority)  
2. **Second check:** Wrong department  
3. **Third check:** Review required (scroll to bottom)  
4. **First click (no error rows):** Let native behavior create error rows, run auto-resolution, apply smart links and highlight, then scroll to first unresolved row.  
5. **Subsequent clicks (has red rows):** Navigate to next red row below viewport (cycles back to first)  
6. **Ready to merge click (green FAB):** Increment merge counter, reset scroll flag

---

### **2\. Smart Links**

**Target:** `elm-merge-value:not(.linkified)`

**Trigger:** Only applied after user clicks FAB (to avoid interfering with Angular).

**Transformations:**

#### **Phone Numbers**

* **Detection:** `text.replace(/\D/g, '').length >= 10 && text.length < 20 && !text.includes('@')`  
* **Format:** `(xxx)-xxx-xxxx` or `+x (xxx)-xxx-xxxx`  
* **Class:** `.elm-phone-formatted`

#### **Email Addresses**

* **Pattern:** `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`  
* **Link:** `https://mailmeteor.com/email-checker?email={email}`  
* **Class:** `.elm-smart-link`

#### **Addresses (Home,)**

* **Detection:** `text.startsWith("Home, ")`  
* **Cleanup:** Removes " with geo location" suffix  
* **Prettify:** Title case with state abbreviations uppercased  
* **Link:** `https://www.google.com/maps/search/?api=1&query={address}`  
* **State Abbreviations:** `AL, AK, AZ, AR, CA, CO, CT, DE, FL, GA, HI, ID, IL, IN, IA, KS, KY, LA, ME, MD, MA, MI, MN, MS, MO, MT, NE, NV, NH, NJ, NM, NY, NC, ND, OH, OK, OR, PA, RI, SC, SD, TN, TX, UT, VT, VA, WA, WV, WI, WY, DC, PR, VI, GU, MP, AS, PO, NW, NE, SW, SE, USA, US`

---

### **3\. Custom Pagination Controls**

**Target:** `.mat-mdc-paginator-container`

**Injected Elements:**

#### **Page Input**

* ID: `#elm-page-input`  
* Location: After previous button in `.mat-mdc-paginator-range-actions`  
* Reads/writes: `?offset=` URL param (0-indexed internally, displayed as 1-indexed)

#### **Limit Input**

* ID: `#elm-limit-input`  
* Location: Inside `.mat-mdc-paginator-page-size-value`  
* Reads/writes: `?limit=` URL param (default: 50\)

#### **GO Button**

* ID: `#elm-go-btn`  
* Triggers navigation with updated offset/limit

**Navigation Logic:**

newOffset \= Math.max(0, newPage \- 1);  
// Also ensures ?ignored=false is set

---

### **4\. Merge Counter**

**Purpose:** Track total merges completed in session.

**Storage Key:** `localStorage.getItem('elm_merge_count')`

**UI Location:** Nav bar (`.bolt-navigation-right`), before search box

**Elements:**

* `#elm-controls-wrapper` \- Container for toggle \+ counter  
* `#elm-counter-wrapper` \- Counter pill  
* `#elm-merge-counter` \- Text display  
* `#elm-reset-btn` \- Reset button (↻)

**Animation:** `.counter-pop` class adds scale animation on increment

---

## **Safety Features** {#safety-features}

### **1\. Forbidden Entry Detection**

**Purpose:** Block merging of test records and specific forbidden student names.

**Priority:** Highest \- checked BEFORE department lockdown

**Detection Patterns:**

- **Test Records:** First Name OR Last Name contains "test" (case-insensitive)  
  - Checked on BOTH left and right sides  
- **Forbidden Names (exact full name match, case-insensitive):**
  - A hardcoded list of specific names maintained in the `FORBIDDEN_NAMES` array in the script source
  - Checked on BOTH left and right sides

**Name Extraction:**

- Scans `elm-merge-row` elements for rows containing "First Name" and "Last Name"  
- Extracts both left value (`elm-merge-value:nth-child(1)`) and right value (`elm-merge-value:nth-child(2)`)  
- Combines First Name \+ Last Name for full name comparison on each side

**Matching Logic:**

- Test detection: Partial match using `.includes('test')`  
- Forbidden names: Exact full name match after lowercase normalization and trim

**Effect:**

- Adds `body.forbidden-entry` class
- FAB turns red with "∅" symbol (same as department lockdown)
- Click is blocked with alert: "Forbidden entry"
- Highlights the detected name row with `.blocked-row` class (red border)

---

### **1b\. Department Lockdown**

**Purpose:** Prevent accidentally merging records belonging to other departments (Graduate, International Admissions).

**Detection:** Scans **all** rows containing Workflows, Application, Program, type:, status:, or Outreach\_ and collects department flags before classifying. This ensures the result is consistent regardless of row order.

| Pattern | Classification |
| :---- | :---- |
| `IA_`, `_IA_`, or `_IA ` | IA (highest priority) |
| `GRAD_` or `grad student` | Grad |
| `Outreach_` without `UGRD` | Non-Undergrad (ambiguous — blocked for all specific departments) |
| None of the above | UnderGrad (default) |

**Priority: IA > Grad > Non-Undergrad > UnderGrad.** A student with both Grad and IA markers is always classified as IA, because students can be both graduate and international. The entire page is scanned before a classification is made — early rows do not short-circuit detection.

**Allowed Department Behavior:**
- **All**: no filtering, everything allowed.
- **None**: blocks everything regardless of classification.
- **UnderGrad / Grad / IA**: blocks anything that doesn't match.
- **Non-Undergrad**: always blocked for UnderGrad, Grad, and IA. Kept as orange "Unresolved" on the list page since it can't be confidently classified.

**Effect:**

* Adds `body.wrong-department` class
* FAB turns red with "∅" symbol
* Click is blocked with alert showing detected department
* Highlights the row containing the department indicator with `.blocked-row` class (red border)

---

### **2\. Student ID Mismatch Detection** *(NEW in v120.0)*

**Purpose:** Block merging when "School Id:" values differ between left and right sides, indicating two completely different students.

**Priority:** Checked AFTER forbidden entry and department lockdown

**Detection:**

- Scans `elm-merge-row` elements in the "Identities" section for rows containing "School Id:"
- Extracts both left value (`elm-merge-value:nth-child(1)`) and right value (`elm-merge-value:nth-child(2)`)
- Uses regex `/School Id:\s*(\d+)/i` to extract the numeric ID
- Compares the two IDs for exact match

**Example:**
```
School Id: 008545544    School Id: 009238137
```
These differ, so merge is blocked.

**Effect:**

* Adds `body.student-id-mismatch` class
* FAB turns red with "∅" symbol
* Click is completely blocked (no way to proceed)
* Alert message: "Student IDs do not match. Entries are two different people."
* Highlights the School ID row with `.blocked-row-critical` class (deep red border with shadow)
* Auto-click FAB is blocked with console message: `⛔ Auto-click blocked: Student ID mismatch detected`

**Helper Function:** `isStudentIdMismatch()` returns `{ mismatch: true/false, row: element, leftId: string, rightId: string }`

---

### **4\. Ignored Student Detection**

**Purpose:** Detect students with the "Ignored" chip and treat them as blocked entries.

**Detection:** Looks for `elm-chip` elements with `.elm-chip-label` text "Ignored"

**Helper Function:** `isStudentIgnored()` returns `true` or `false`

**Behavior:** Auto-click and auto-skip treat ignored students as blocked entries. The CSV Database records them with dept value `Ignored`.

---

### **5\. Scroll-to-Review Requirement**

**Purpose:** Ensure users review all merge fields before finalizing the merge.

**Configuration:** Controlled by `REQUIRE_SCROLL_TO_BOTTOM` constant (default: `true`)

**Detection:**

- Monitors scroll position using `scrollTop`, `scrollHeight`, and `clientHeight`  
    
- Calculates actual distance from bottom: `scrollHeight - (scrollTop + clientHeight)`  
    
- Marks as "scrolled to bottom" when distance ≤ 200 pixels  
    
- Includes console logging for debugging scroll calculations

**Behavior:**

- When all conflicts are resolved, FAB turns grey with down arrow (↓) instead of green  
    
- Clicking grey FAB shows alert: "Please scroll to the bottom to review all fields before merging"  
    
- Once user scrolls within 200px of bottom, `hasScrolledToBottom` flag is set to `true`  
    
- FAB automatically updates to green "Merge" state  
    
- Flag resets on each new merge page

**Scroll Container Detection:**

- Searches for: `.elm-content`, `.mat-drawer-content`, or `document.body`  
    
- Attaches single scroll listener per session (`scrollListenerAttached` flag)

**Effect:**

* Prevents accidental merges without reviewing all fields  
    
* Adds `body.review-required` class when scroll is needed  
    
* Removes class and enables merge when scroll requirement is met  
    
* Can be completely disabled by setting `REQUIRE_SCROLL_TO_BOTTOM = false`

---

## **Settings Pane** {#settings-pane}

**Purpose:** Centralized configuration UI accessible via the gear icon (⚙) in the navbar.

### **Appearance**

Material Design-inspired floating panel that appears below the gear button. Organized into three collapsible sections:

| Section | Settings |
| :---- | :---- |
| **Display** | High Contrast, Show Merge Counter |
| **Automation** | Auto-Click FAB, Auto-Navigate After Merge, Auto-Skip Blocked, Require Scroll to Bottom |
| **Department** | Allowed Department dropdown (All, UnderGrad, Grad, IA, None) |

### **Behavior**

- Opens/closes with the gear icon button. Closes on clicking the X button or the overlay behind the panel.
- All toggle changes are saved to `localStorage` immediately and take effect without a page reload.
- The Department dropdown includes convenient **All** (no filtering) and **None** (block everything) options.
- The settings panel has scroll overflow handling for short browser windows.

### **Database Section** *(injected by CSV Database script)*

When the CSV Database companion script is installed, it injects a "Database" section into the settings pane with three action buttons:

- **Download Database:** Exports as CSV (`elm_csv_database_YYYY-MM-DD.csv`). Columns: Firstname, Lastname, Dept., Row Contents, Unique ID.
- **Upload & Replace Database:** Imports a CSV file, validates structure, replaces the entire database after confirmation.
- **Clear Database:** Deletes all entries after confirmation and reloads the page.

---

## **Utility Features** {#utility-features}

### **1\. Tooltip Suppression**

**Purpose:** Prevent pagination button tooltips from interfering with clicks.

**Target:** `.mat-mdc-paginator-range-actions .mat-mdc-tooltip-trigger`

**Method:** Adds `mouseenter` listener that stops propagation, marks with `.tooltip-silenced`

**CSS:**

.cdk-overlay-container, .mat-mdc-tooltip-panel, .mat-mdc-tooltip {  
    pointer-events: none \!important;  
}

---

### **2\. Toast Suppression**

**Purpose:** Hide "Please resolve conflicts" toast notifications that appear after FAB click.

**Implementation:**

- Runs every 100ms via `setInterval(suppressToasts, 100)`  
- Also called in auto-resolution timeouts (100ms, 300ms, 500ms) to catch toasts immediately after FAB click  
- Selector: `.mat-mdc-snack-bar-container`  
- Detection: `textContent.toLowerCase().includes("resolve")`  
- Action: `toast.remove()` \- simple immediate removal

**Code:**

function suppressToasts() {

    const toasts \= document.querySelectorAll('.mat-mdc-snack-bar-container');

    toasts.forEach(toast \=\> {

        const text \= toast.textContent.toLowerCase();

        if (text.includes('resolve')) {

            toast.remove();

        }

    });

}

---

### **3\. Ghost Tooltip Fix**

**Purpose:** Ensure merge toggles and pagination buttons remain clickable.

**Targets:**

elm-merge-row mat-button-toggle-group,  
elm-merge-row mat-button-toggle,  
elm-merge-row button,  
elm-merge-pagination button,  
.mat-mdc-paginator-range-actions button

**Fix:** `pointer-events: auto !important; position: relative;`

---

## **State Management** {#state-management}

### **URL Change Detection with Forced Reload**

**Purpose:** Ensure clean state for revisited merge pages while allowing fast forward navigation.

**Why Smart Reload:** Element451's SPA caching can cause stale state when navigating backward or revisiting duplicates:

* Toggle selections persisting on wrong rows  
* `has-error` classes from previous pages  
* Smart links showing wrong data  
* Yellow highlights in wrong positions  
* Stale FAB states (gray/green/red)

**Method:**

* Monitor URL changes via `setInterval(checkUrlChange, 500)`  
* Extract duplicate ID from URL pattern: `/duplicates/[24-char hex ID]`  
* Track seen duplicate IDs in session-scoped Set  
* **Force reload** only when revisiting a previously seen duplicate ID  
* Allow fast navigation for new duplicates (no reload)

**Session Memory:**

* `seenDuplicateIds` Set: Cleared only on actual page reload  
* `currentDuplicateId`: Current page's duplicate ID  
* `lastSparkIds`: Maintained for future features  
* Persists across SPA navigations within same session  
* Enables detection of backward/revisit navigation

**ID Extraction:**

* Pattern: `/\/duplicates\/([a-f0-9]{24})/i`  
* IDs normalized to lowercase to handle case variations  
* Extraction failure logging for debugging

**Behavior:**

* First visit to Duplicate A → Add to Set → Fast navigation ✅  
* Navigate to Duplicate B → Add to Set → Fast navigation ✅  
* Navigate back to Duplicate A → A in Set → **Force reload** 🔄 (ensures fresh state)  
* Browser refresh → Clear seen IDs, fresh state guaranteed

**Console Logging:**

console.log('🔍 URL changed:', {

    from: lastKnownUrl,

    to: currentUrl,

    extractedId: newDuplicateId,

    seenBefore: newDuplicateId ? seenDuplicateIds.has(newDuplicateId) : 'N/A',

    sessionHistory: Array.from(seenDuplicateIds)

});

**On Initial Load:**

* Extract current page's duplicate ID  
* Add to Set immediately (prevents reload on first back-navigation)  
* All state variables ready

---

### **Data Attributes Reference**

| Attribute | Purpose | Values |
| :---- | :---- | :---- |
| `data-auto-resolved` | Row was auto-resolved | `"true"` |
| `data-csu-application` | CSU Application detected on this side | `"left"` | `"right"` |
| `data-applicant-record` | Application entries detected on this side | `"left"` | `"right"` |
| `data-milestone-type-match` | Milestone types matched | `"true"` |
| `data-email-selection` | Email auto-selected to this side | `"left"` | `"right"` |
| `data-dual-personal` | Both sides have personal emails | `"true"` |
| `data-dual-resolved` | Dual email resolved via tiebreaker | `"true"` |
| `data-csusb-major-selection` | Only one side has csusb.major | `"left"` | `"right"` |
| `data-csusb-major-follow-email` | Both have csusb.major, following email | `"true"` |
| `data-encoura-id-selection` | Both sides have Encoura Id, selected left | `"left"` |
| `data-csusb-school-selection` | Only one side has csusb.school | `"left"` | `"right"` |
| `data-csusb-school-follow-email` | Both have csusb.school, following email | `"true"` |
| `data-address-resolved` | Address comparison completed | `"true"` |
| `data-smart-nav-attached` | FAB click handler attached | `"true"` |
| `data-csv-uid` | Unique ID stamped by CSV Database script | `"[24-char hex ID]"` |
| `data-first-gen-selection` | First Gen Student preference | `"left"` \| `"right"` |
| `data-intended-term-selection` | Later intended term selected | `"left"` \| `"right"` |
| `data-college-board-id-selection` | Both sides have College Board Id | `"left"` |

---

### **LocalStorage Keys**

| Key | Used By | Purpose | Default |
| :---- | :---- | :---- | :---- |
| `elm_require_scroll_to_bottom` | UI Perfection | Scroll-to-review setting | `'true'` |
| `elm_auto_click_fab` | UI Perfection | Auto-click FAB setting | `'true'` |
| `elm_auto_navigate_after_merge` | UI Perfection | Auto-navigate setting | `'true'` |
| `elm_show_merge_counter` | UI Perfection | Show/hide merge counter | `'true'` |
| `elm_auto_skip_blocked` | UI Perfection | Auto-skip blocked entries setting | `'true'` |
| `elm_allowed_department` | UI Perfection | Department filter setting | `'UnderGrad'` |
| `elm_high_contrast` | UI Perfection | High contrast toggle state | `'true'` |
| `elm_merge_count` | UI Perfection | Merge counter value | `'0'` |
| `elm_csv_database` | CSV Database | JSON array of recorded entries | `'[]'` |

---

## **CSV Database Module** {#csv-database-module}

**Script:** `csv-database.js` (v7) — A companion Tampermonkey userscript that tracks blocked entries in a local database and annotates the duplicates list page with department badges.

### **How It Works**

1. Polls `document.body.dataset.csvDept` every 1 second (set by UI Perfection).
2. When a department value appears, extracts first name, last name, department, blocked row content, and unique ID.
3. Stores entries in `localStorage` as JSON. Deduplicates by unique ID; updates existing entries if any field changed.

### **Database Format**

JSON array in `localStorage` key `elm_csv_database`. Each entry:

```json
{ "firstName": "...", "lastName": "...", "dept": "...", "rowContents": "...", "uniqueId": "..." }
```

Possible `dept` values: `Grad`, `IA`, `UnderGrad`, `Non-Undergrad`, `Forbidden`, `Ignored`.

### **List Page Department Badges**

On the duplicates list page, rewrites the default orange "Unresolved" chip on each row to show the department with color-coding:

| Department | Label | Background | Text Color |
| :---- | :---- | :---- | :---- |
| Grad | Graduate | Blue (#e3f2fd) | Blue (#1565c0) |
| IA | International | Yellow (#fff9c4) | Amber (#f57f17) |
| UnderGrad | UnderGrad | Purple (#f3e5f5) | Purple (#6a1b9a) |
| Forbidden | Forbidden | Pink (#fce4ec) | Pink (#c2185b) |
| Ignored | Ignored | Grey (#f5f5f5) | Grey (#616161) |
| Non-Undergrad | *(kept as default "Unresolved")* | *(unchanged)* | *(unchanged)* |

### **API Interception**

Hooks into both `XMLHttpRequest` and `fetch` to capture the duplicates list endpoint response and extract unique IDs for each row. This provides real-time data without relying on DOM scraping.

- **XHR hook:** Intercepts `XMLHttpRequest.prototype.open` and `.send` to capture URL and response
- **Fetch hook:** Clones responses and parses JSON for duplicate endpoint calls
- Filters out detail page requests to avoid false positives

### **Staleness Protection**

Tracks which page the API data was captured for using an `apiGeneration` counter:
- Counter increments on each fresh API capture and on page navigation
- Annotations are cleared before re-applying when fresh data arrives
- Row unique IDs stamped as `data-csv-uid` attributes survive Angular re-ordering

### **DB-Direct Fallback Matching**

When API interception data is unavailable (e.g., first page load from cache), falls back to matching list page rows against the local database by firstName + lastName + dept combination.

### **API Status Toast**

A small toast notification with a pulsating dot indicator appears when API data is successfully captured. Confirms that chip annotations are based on live data rather than database fallback.

### **UI Elements**

- **DB Badge:** Pill badge in the navbar showing "DB: N" (entry count). Updates every 1 second.
- **Settings Section:** Three action buttons (Download, Upload, Clear) injected into the UI Perfection settings pane.

---

## **Inter-Script Communication** {#inter-script-communication}

| Channel | Direction | Mechanism |
| :---- | :---- | :---- |
| Department signal | UI Perfection → CSV Database | `document.body.dataset.csvDept` attribute on `<body>` |
| Blocked row content | UI Perfection → CSV Database | `.blocked-row` / `.blocked-row-critical` CSS classes on `elm-merge-row` elements |
| UI injection targets | UI Perfection → CSV Database | `#elm-controls-wrapper` (badge), `#elm-settings-pane .settings-body` (settings section) |
| Recording confirmation | CSV Database → UI Perfection | `localStorage.getItem('elm_csv_database')` checked by auto-skip before navigating away |

The CSV Database script depends on UI Perfection for DOM structure and signals. UI Perfection degrades gracefully if the CSV Database script is not installed (auto-skip proceeds after 1.5s instead of waiting for database confirmation).

---

## **CSS Selectors Reference** {#css-selectors-reference}

### **Primary Targets**

elm-merge-row                    /\* Individual merge field row \*/  
elm-merge-row.has-error          /\* Row with conflict \*/  
elm-merge-value                  /\* Value display cell \*/  
elm-merge-array-row              /\* Array section (e.g., User Activity) \*/  
.elm-array-row-header            /\* Array section header \*/  
mat-button-toggle                /\* Left/right selection toggle \*/  
mat-button-toggle-group          /\* Toggle container \*/  
.mat-button-toggle-checked       /\* Selected toggle state \*/  
.ng-valid / .ng-invalid          /\* Angular validation states \*/

### **Layout Containers**

.elm-content                     /\* Main scrollable content area \*/  
.mat-drawer-content              /\* Alternative scroll container \*/  
.elm-page-action-floating        /\* FAB wrapper \*/  
.bolt-navigation-right           /\* Nav bar right section \*/  
elm-universal-search             /\* Search box (injection reference point) \*/  
.mat-mdc-paginator-container     /\* Pagination wrapper \*/

### **Injected Elements**

\#elm-applicant-highlight         /\* Yellow side highlight \*/  
\#elm-controls-wrapper            /\* Toggle \+ counter container \*/  
\#elm-contrast-wrapper            /\* High contrast toggle \*/  
\#elm-counter-wrapper             /\* Merge counter pill \*/  
\#elm-merge-counter               /\* Counter text \*/  
\#elm-reset-btn                   /\* Counter reset button \*/  
\#elm-page-input                  /\* Page number input \*/  
\#elm-limit-input                 /\* Page size input \*/  
\#elm-go-btn                      /\* Navigation button \*/  
.fab-merge-text                  /\* "Merge" label on FAB \*/
\#elm-settings-btn                /\* Settings gear icon button \*/
\#elm-settings-overlay            /\* Settings panel backdrop \*/
\#elm-settings-pane               /\* Settings panel container \*/
\#elm-db-size-badge               /\* Database entry count badge (injected by CSV Database) \*/

---

## **External Dependencies**

None. The script uses a built-in `AddressComparer` module for address parsing (the external `parse-address` library was removed in v122).

---

## **Run Timing**

**Initial Runs:** Immediately, then at 500ms, 1000ms, 2000ms, 3000ms

**Mutation Observer:** Debounced at 50ms, watches `document.body` for `childList` and `subtree` changes

**Auto-Resolution:** Triggered on FAB manual click with delays at 100ms, 300ms, 500ms

---

## **Version History**

**v117.0 Changes:**

- **NEW: Encoura ID Preference** - Auto-selects left when both sides have `Encoura Id:`
- **NEW: csusb.school Preference** - For Student Type rows:
  - If only one side has csusb.school.* pattern → select that side
  - If neither side has it → manual review required
  - If both sides have it → follow email selection; if no email, manual review
- **BUG FIX: csusb.major fallback** - When both sides have csusb.major but no email is selected, now leaves for manual review instead of defaulting to left
- New data attributes: `data-encoura-id-selection`, `data-csusb-school-selection`, `data-csusb-school-follow-email`

---

**v118.0 Changes (Major Feature):**

- **NEW: Auto-Navigate After Merge** - Automatically navigates to next duplicate after successful merge
- Configuration flag: `AUTO_NAVIGATE_AFTER_MERGE = true` (enabled by default)
- Detects merge success by watching for `elm-empty-state[title="Merged"]` element
- 1 second delay before navigation to let user see the success message
- Clicks the next pagination button (`button[mattooltip="Next"]`)
- **Trigger:** Only activates after green FAB is clicked (prevents false triggers)
- **Counter timing change:** Merge counter now increments on merge success detection instead of FAB click (more accurate)
- New tracking variables: `awaitingMergeSuccess` (tracks green FAB click), `mergeSuccessProcessed` (prevents duplicate triggers)
- Flags reset on navigation to new duplicate page
- Console logging: `✅ Merge successful`, `➡️ Auto-navigating to next duplicate...`
- Gracefully handles end of list: `⚠️ No next page available`

---

**v119.0 Changes (Major Feature):**

- **NEW: Twin/Different Person Detection** - Warns when records may belong to twins or different people
- Configuration flag: `CONFLICT_ROW_THRESHOLD = 2` (0 = disabled)
- Checks for conflicts in: First Name, Last Name, Date of Birth, Address
- Name comparison: case-insensitive, removes spaces and hyphens
- Date of Birth: only compares valid years (not starting with 0, >= 1900)
- Address: uses AddressComparer to determine if addresses are the same
- Runs before FAB auto-click
- Shows alert popup listing which fields have conflicts
- User must click OK to acknowledge before auto-click proceeds
- New tracking variable: `conflictWarningShown` prevents multiple warnings per page
- Flag resets on navigation to new duplicate page

---

**v119.1 Changes (Bug Fix):**

- **Fixed: seenDuplicateIds memory leak** - The Set used to track visited duplicate IDs now limits to 10 most recent entries
- Previously grew indefinitely during long sessions, potentially causing memory issues
- New helper function `addSeenDuplicateId()` manages the Set with FIFO eviction
- New constant: `MAX_SEEN_DUPLICATES = 10`

---

**v119.2 Changes (Bug Fix + Feature):**

- **NEW: SHOW_MERGE_COUNTER config flag** - Allows disabling the merge counter UI
- Configuration flag: `SHOW_MERGE_COUNTER = true` (enabled by default)
- When disabled, the counter wrapper is not rendered and `incrementMergeCount()` is not called
- Useful for users who don't want to track merge counts

---

**v120.0 Changes (Major Feature):**

- **NEW: Student ID Mismatch Detection** - Completely blocks merging when School IDs differ
  - Detects differing "School Id:" values in the Identities section
  - FAB turns red with ∅ symbol (completely blocked, no way to proceed)
  - Alert: "Student IDs do not match. Entries are two different people."
  - Deep red highlight on the School ID row (`.blocked-row-critical` class)
  - Auto-click FAB blocked with console message
  - New helper: `isStudentIdMismatch()` returns `{ mismatch, row, leftId, rightId }`

- **NEW: Blocked Row Highlighting** - Visual feedback for all block types
  - Forbidden Entry: Highlights the name row that triggered the block (`.blocked-row`)
  - Wrong Department: Highlights the row containing the department indicator (`.blocked-row`)
  - Student ID Mismatch: Deep red highlight with shadow (`.blocked-row-critical`)
  - Refactored `isForbiddenEntry()` and `isWrongDepartment()` to return row information

- **CSS Classes Added:**
  - `.blocked-row` - Standard red highlight for forbidden/department blocks
  - `.blocked-row-critical` - Deep red highlight with shadow for student ID mismatch
  - `body.student-id-mismatch` - FAB lockdown state for ID mismatch

---

**v126 Changes (UI Perfection):**

- **FIX: IA > Grad department detection priority** — Students with both Grad and IA markers are now always classified as IA, because students can be both graduate and international
- **Updated README** to document the priority change

---

**v125 Changes (UI Perfection — Major Feature + CSV Database v4-7):**

- **NEW: Settings Pane** — Gear icon (⚙) in the navbar opens a Material Design-inspired settings panel with Display, Automation, and Department sections. All toggle changes saved to `localStorage` and take effect immediately without page reload
- **NEW: Auto-Skip Blocked** — Automatically navigates past blocked entries after CSV database records them. Polls localStorage every 500ms up to 10 seconds. Falls back to 1.5s delay if CSV Database script is not installed
- **NEW: Configuration flags in settings pane** — All/None department options added. Department dropdown lets you choose All (no filtering), UnderGrad, Grad, IA, or None (block everything)
- **NEW: Department chips on list page** — Rewrites the default "Unresolved" chip on each row to show the detected department with color-coded badges (Graduate=blue, International=yellow, UnderGrad=purple, Forbidden=pink, Ignored=grey)
- **NEW: API interception** — Hooks both XMLHttpRequest and fetch to capture the duplicates list endpoint response and extract unique IDs for each row, replacing unreliable DOM scraping
- **NEW: Unique ID stamping** — Stamps `data-csv-uid` attributes on list page rows for position-independent matching that survives Angular re-renders
- **NEW: DB-direct fallback matching** — When API data is unavailable (e.g., cached first page), falls back to matching rows against the local database by name + department
- **NEW: API status toast** — Pulsating dot indicator toast notification confirms when API data is captured live
- **NEW: CSV Database settings section** — Download (CSV export), Upload & Replace, and Clear Database buttons added to the settings pane
- **NEW: DB badge** — "DB: N" pill badge in the navbar showing the current database entry count
- **FIX: Auto-skip race condition** — Each poll iteration re-checks whether the entry is still blocked. If new merge rows changed department detection, skip is aborted and auto-click is retried. Prevents grad entries from being incorrectly skipped
- **FIX: Chips disappearing** — Fixed chips disappearing/reclassifying on page navigation, idle, cached list pages, and Angular re-renders
- **FIX: Chip visual bugs** — Fixed flickering, wrong labels, and ignored chip handling
- **FIX: Blocked entry display** — Fixed for None dept and first page chip annotations
- **FIX: Deep red rows** — Fixed not showing when allowed dept is None
- **FIX: Ignored chips** — Fixed being overwritten with stale dept from database
- **FIX: Settings pane overflow** — Fixed when browser window is short
- **FIX: Settings overlay** — Fixed rendering over the settings panel
- **REFACTOR: CSV Database architecture** — Decoupled csv-database.js from main script using `body[data-csv-dept]` attribute for cross-script communication. CSV Database script now owns all database-related UI

---

**v124 Changes (Address Resolution):**

- **FIX: False address conflicts** — Fixed false conflicts caused by different address component ordering. Now prefers geocoded addresses
- **NEW: Geo-location suffix stripping** — Strips "with geo location" suffix that Element451 appends to geocoded addresses. Adds conflict diagnostics for debugging

---

**v123 Changes (CSV Database Module):**

- **NEW: CSV Database Module** (`csv-database.js`) — Companion Tampermonkey userscript that tracks blocked entries in a local database stored in `localStorage`
- **NEW: Department badge annotation on list page** — Rewrites elm-chip on list and detail page rows to show department
- **NEW: API interception for list page** — Uses XMLHttpRequest and fetch hooks instead of name-matching fallback for reliable department detection
- **NEW: Download button** — Exports database as CSV for troubleshooting
- **REFACTOR: Cross-script architecture** — Main script sets `document.body.dataset.csvDept`, CSV module polls for it. No direct function bridges
- **FIX: Empty CSV download** — Fixed to use actual CSV format

---

**v122 Changes (Multi-Department Support + Auto-Skip):**

- **NEW: ALLOWED_DEPARTMENT config flag** — Multi-department support with options: All, UnderGrad, Grad, IA, None
- **NEW: AUTO_SKIP_BLOCKED** — Automatically skips blocked entries. Waits for database recording before navigating
- **NEW: `grad student` pattern** — Added to department lockdown detection
- **FIX: Address parser** — Replaced broken external `parse-address` library with built-in `AddressComparer` module
- **FIX: Duplicate detection** — Made fully fuzzy with typo and spacing variant support
- **FIX: Grad/IA modes** — Fixed to only allow their own department, removed Outreach catch-all
- **REMOVED: External parse-address dependency** — All address parsing is now built-in

---

**v121.4 Changes (New Feature):**

- **NEW: College Board ID Preference** - When both sides have a College Board Id, always selects left side
  - Detection: Both sides contain `College Board Id:` (case-insensitive)
  - Data attribute: `row.dataset.collegeBoardIdSelection`
  - Only applies when no applicant context is found
  - Example: "College Board Id: XXXXXXXXX" vs "College Board Id: YYYYYYYYY"

---

**v121.3 Changes (New Features):**

- **NEW: First Generation Student Preference** - When one side has "Yes" and the other has "No", always selects the side with "Yes"
  - Row detection: `text.toLowerCase().includes('first generation student')`
  - Data attribute: `row.dataset.firstGenSelection`
  - Only applies when no applicant context is found

- **NEW: Intended Term Preference** - Always selects the later intended term
  - Parses term codes from format like "Spring 2027 (2274)" or "Fall 2027 (2278)"
  - Higher 4-digit code = later term chronologically
  - Data attribute: `row.dataset.intendedTermSelection`
  - Only applies when no applicant context is found

---

**v121.2 Changes (Bug Fix - Email Name Matching):**

- **Fixed: Multi-word and hyphenated last names not matching in emails** - Previously, multi-word last names would not match an email containing just one part of the name
- Added `emailContainsName()` helper function that splits names by spaces and hyphens
- Name parts must be at least 3 characters to be considered (avoids false positives with short strings)
- Example: A hyphenated last name like "Smith-Jones" now matches an email containing "jones"

---

**v121.1 Changes (Bug Fix - Address Tie):**

- **Fixed: Same address with equal completeness not selecting left** - When addresses are the same and have equal completeness scores, now defaults to left side instead of leaving for manual review
- Updated `compareAddresses()` to return `winner: 'left'` when `areSame === true` and scores are equal

---

**v121.0 Changes (Major Bug Fix - Address Comparison):**

- **Fixed: Different addresses being auto-selected based on completeness** - Previously, when two addresses were completely different, the script would pick one based on completeness score. Now, different addresses result in a "tie" and follow email selection or require manual review.

- **Fixed: Same address with unit not being selected** - Improved `hasUnitInfo()` to detect more unit patterns including "Apt B", "Apt 7", "#5", etc.

- **Fixed: Address with country not being preferred** - Added `hasCountry()` check that gives +5 bonus to completeness score before stripping country from address.

- **Fixed: Duplicate city detection** - Added `extractCity()` function and check for city name appearing multiple times in different formats (e.g., "Anytown CA 92000, Anytown, CA").

- **Fixed: Street duplicates with typos not detected** - Added fuzzy string matching with `stringSimilarity()` function. Streets with >80% similarity are now detected as duplicates (e.g., "Oak Grove St" vs "Oak Grve St").

- **Fixed: Whitespace issues causing false mismatches** - More aggressive whitespace normalization in `cleanAddress()` - removes extra spaces, normalizes around commas and periods.

- **Key behavior change**: `compareAddresses()` now only picks a winner based on completeness when `areSame === true`. Different addresses return `winner: 'tie'` with reason "Different addresses - manual review or follow email".

---

**v120.1 Changes (Bug Fix):**

- **Fixed: Bottom paginator not updating offset** - The bottom page selector's GO button would reload the page but not update the offset parameter
- Root cause: Both top and bottom paginators used the same element IDs (`#elm-page-input`, `#elm-limit-input`), so `document.querySelector()` always found the top one
- Fix: Refactored `injectNativePagination()` to use classes instead of IDs, and pass the specific input elements directly to `triggerNavigation()`
- Each paginator now has its own independent page input and limit input
- Added `data-paginator-id` attribute for debugging/identification

---

**v116.2 Changes (Bug Fix \- Email Resolution):**

- **Fixed dual personal email tiebreaker only checking against left side names**  
    
- Bug: When both emails were personal domains, script only extracted left side's first/last name and birth year  
    
- Root cause: Name extraction used `nameValues[0]` (left only) instead of checking both sides  
    
- Complete rewrite of `autoDualPersonalEmails()` function with comprehensive matching:  
    
  **Priority 2 (First Name) \- Now checks all combinations:**  
    
  - Left email vs left first name  
  - Left email vs right first name  
  - Right email vs left first name  
  - Right email vs right first name  
  - Selects side if only one email contains a first name


  **Priority 3 (Last Name) \- Now checks all combinations:**


  - Left email vs left last name  
  - Left email vs right last name  
  - Right email vs left last name  
  - Right email vs right last name  
  - Selects side if only one email contains a last name


  **Priority 4 (Birth Year) \- Now checks all combinations with validation:**


  - Extracts both birth years (left and right)  
  - Validates both years: must not start with '0' and must be \>= 1900  
  - Left email vs left birth year (if valid)  
  - Left email vs right birth year (if valid)  
  - Right email vs left birth year (if valid)  
  - Right email vs right birth year (if valid)  
  - Selects side if only one email contains a valid birth year


- Variables changed: `firstName/lastName/birthYear` → `firstNameLeft/Right`, `lastNameLeft/Right`, `birthYearLeft/Right`  
    
- Added validation flags: `leftYearIsValid`, `rightYearIsValid`  
    
- Added console logging for debugging: "Email selected by \[first name|last name|birth year\] match: \[left|right\]"  
    
- Ensures correct email selection regardless of which side person's data appears on

**v116.1 Changes (Critical Bug Fix):**

- **Fixed auto-click triggering on wrong page during SPA navigation**  
- Bug: URL changes instantly during navigation, but DOM (Spark IDs) updates later  
- Previous behavior: Auto-click fired 200ms after URL change, often clicking on OLD page's data  
- Root cause: Script detected URL change before page content actually updated  
- Fix: Added Spark ID change detection \- auto-click now waits for Spark IDs to actually change  
- New tracking: `previousDuplicateId` variable remembers which page we navigated from  
- Enhanced `shouldAutoClickFAB()`: Compares current Spark IDs vs `lastSparkIds` to confirm page updated  
- Removed direct `setTimeout(attemptAutoClickFAB, 200)` call from URL change detection  
- Auto-click now triggered by mutation observer when Spark IDs change (confirms new page loaded)  
- Added console log: `⏳ Auto-click waiting: Spark IDs not updated yet (still showing previous page)`  
- Added console log: `🔄 Spark IDs changed - page content updated: [ids]`  
- Ensures auto-click only fires when page content has truly loaded with new duplicate's data

**v116.0 Changes (Major Feature):**

- **NEW: Auto-Click FAB Feature** \- Automatically triggers merge workflow on page load  
- Configuration flag: `AUTO_CLICK_FAB = true` (enabled by default)  
- Waits for Spark IDs to appear before attempting click (ensures page is fully loaded)  
- Multiple timing strategies: initial load (1s, 2s, 3.5s), URL navigation (200ms), mutation observer (continuous)  
- Safety blocks prevent auto-click for:  
  - Forbidden entries (test records, blocked names)  
  - Wrong department (Graduate, International Admissions)  
  - Ignored students  
- State tracking with `autoClickAttempted` flag prevents repeated attempts  
- Flags reset on navigation: `fabHasBeenClicked`, `autoClickAttempted`, `hasScrolledToBottom`  
- Comprehensive console logging for debugging (🤖 success, ⛔ blocked, ⏳ waiting)  
- New functions: `shouldAutoClickFAB()`, `attemptAutoClickFAB()`  
- Integrates seamlessly with existing FAB workflow (auto-resolution, highlights, scrolling)  
- Can be disabled by setting `AUTO_CLICK_FAB = false` to revert to manual workflow

**v115.2 Changes (Bug Fix):**

- Fixed address auto-resolution not respecting applicant side detection  
- Bug: Address comparison logic was running independently without checking if applicant side was detected  
- This caused addresses to be selected based on email preference or completeness scoring even when an applicant side existed  
- Fix: Added applicant side check at the beginning of `autoResolveAddresses()` function  
- Now addresses follow the same priority as all other fields: applicant side \> address comparison \> email tie-breaker  
- Ensures consistent behavior where ALL conflict rows (including addresses) follow the applicant side when detected

**v115.1 Changes (Bug Fix):**

- Fixed scroll-to-bottom requirement not enforcing on subsequent pages after first page  
- Bug: `hasScrolledToBottom` flag was not resetting when navigating to new duplicate pages via fast navigation  
- Root cause: Smart reload system allows fast navigation to new duplicates without page reload, causing flag to persist  
- Fix: Reset `hasScrolledToBottom = false` when navigating to new duplicate ID in `checkUrlChange()`  
- Now correctly requires scroll-to-bottom on EVERY merge page, not just the first one after reload

**v115.0 Changes:**

- Added Forbidden Entry Detection: Blocks merging of test records and specific forbidden names  
- Test detection: Checks if "test" appears in First Name or Last Name on BOTH sides  
- Forbidden names: Hardcoded list of specific names (exact match on BOTH sides)  
- Forbidden entry check has HIGHEST PRIORITY (before department lockdown)  
- FAB turns red with ∅ symbol and shows "Forbidden entry" alert  
- New `isForbiddenEntry()` function scans both left and right values  
- New CSS section for `.forbidden-entry` body class  
- Updated `checkMergeStatus()` to check forbidden entry first  
- Updated `setupSmartNavButton()` FAB click handler to block forbidden entries

**v114.0 Changes:**

- Smart reload system: Only reloads when revisiting a previously seen duplicate ID  
- Fast navigation for forward progression through new duplicates  
- Session-scoped ID tracking with automatic cleanup on page reload  
- Extensive debug logging for URL changes and ID tracking  
- Initial page ID added to Set on first load to enable proper back-navigation detection

**v113.2 Changes (Bug Fixes):**

- Fixed scroll detection not working after page reload (removed scrollListenerAttached guard)  
- Fixed toast suppression not catching toasts that appear after FAB click  
- Simplified toast suppression: single selector `.mat-mdc-snack-bar-container`, immediate removal, no over-engineering  
- Added suppressToasts() calls to auto-resolution timeouts (100ms, 300ms, 500ms)  
- Scroll listener now properly reattaches on each page load  
- Fixed crash caused by duplicate leftover code in setupScrollDetection function

**v113.1 Changes (Bug Fixes):**

- Fixed scroll-to-bottom detection using proper scroll height calculation  
- Simplified URL change detection to force reload on EVERY navigation (ensures clean state)  
- Enhanced toast suppression to catch more selector variations  
- Added debugging console logs for scroll detection

**v113.0 Changes:**

- Added Scroll-to-Review Requirement: FAB turns grey with down arrow when all conflicts resolved  
- Users must scroll within 200px of bottom before FAB turns green to merge  
- Prevents accidental merges without reviewing all fields  
- Can be disabled via REQUIRE\_SCROLL\_TO\_BOTTOM configuration flag


**v112.0 Changes:**

- Fixed Element451 cached page bug: Detects when Element reuses DOM with stale state and forces reload  
- Detection: Checks if `has-error` class exists before FAB click (indicates cached page)  
- Prevents wrong toggle selections, smart links, and highlights from persisting between pages

**v111.0 Changes:**

- Added Milestone Type Matching: Auto-selects left when both sides have the same milestone type  
- Added csusb.major Preference: Selects side with csusb.major, or follows email when both have it  
- Updated data attributes to track new auto-resolution patterns

---

*Last Updated: Version 126 (UI Perfection) / Version 7 (CSV Database) — March 2026*

---
