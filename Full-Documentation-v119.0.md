# **Element451 UI Perfection \- Full Documentation**

**Version:** 121.4  
 **Purpose:** Automates merge conflict resolution for duplicate student records in Element451, handling an estimated 80% of cases while requiring human confirmation for complex decisions.

---

## **Table of Contents**

1. [Configuration Constants](#configuration-constants)  
2. [Automation Features](#automation-features)  
3. [Auto-Resolution System](#auto-resolution-system)  
4. [Visual Feedback System](#visual-feedback-system)  
5. [Navigation & UI Enhancements](#navigation-&-ui-enhancements)  
6. [Safety Features](#safety-features)  
7. [Utility Features](#utility-features)  
8. [State Management](#state-management)  
9. [CSS Selectors Reference](#css-selectors-reference)

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
- Full name matches: Angela Armstrong, Gillespie Armstrong, Mariah Armstrong  
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

## **Configuration Constants** {#configuration-constants}

HEADER\_OFFSET \= 64  
// Pixels from top when scrolling to conflicts

REQUIRE\_SCROLL\_TO\_BOTTOM \= true  
// Set to false to disable scroll-to-review requirement before merging

**AUTO\_CLICK\_FAB** \= true *(NEW in v116.0)*

// Set to false to disable automatic FAB clicking on page load
// When enabled, automatically triggers merge workflow after page loads
// Blocked for forbidden entries, wrong departments, and ignored students

**AUTO\_NAVIGATE\_AFTER\_MERGE** \= true *(NEW in v118.0)*

// Set to false to disable automatic navigation to next duplicate after merge
// When enabled, automatically clicks the next pagination button after merge success is detected
// 1 second delay after merge success to let user see the success message

**CONFLICT\_ROW\_THRESHOLD** \= 2 *(NEW in v119.0)*

// Number of conflicting rows before warning about possible twins/different people
// Set to 0 to disable this feature
// Checks: First Name, Last Name, Date of Birth (valid years only), Address

**SHOW\_MERGE\_COUNTER** \= true *(NEW in v119.2)*

// Set to false to hide the merge counter in the navbar
// When disabled, the counter UI is not rendered and merge counts are not tracked

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

* `College Board Id: 150521406` vs `College Board Id: 147901950`

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
  - Angela Armstrong  
  - Gillespie Armstrong  
  - Mariah Armstrong  
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

**Detection Patterns:**

// Row must contain one of these context words:  
text.includes('Workflows') || text.includes('Application') ||   
text.includes('Program') || text.includes('type:') ||   
text.includes('status:') || text.includes('Outreach\_')

// AND contain one of these department indicators:  
text.includes('GRAD\_')                           // Graduate Department  
text.includes('IA\_') || text.includes('\_IA\_') || text.includes('\_IA ')  // International Admissions  
text.includes('Outreach\_') && \!text.includes('UGRD')  // Graduate Outreach (not Undergrad)

**Effect:**

* Adds `body.wrong-department` class
* FAB turns red with "∅" symbol
* Click is blocked with alert
* Highlights the detected row with `.blocked-row` class (red border)

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

**Purpose:** Detect if a student has the "Ignored" chip (for future use).

**Detection:** Looks for `elm-chip` elements with `.elm-chip-label` text "Ignored"

**Helper Function:** `isStudentIgnored()` returns `true` or `false`

**Current Behavior:** Detection only, no action taken (reserved for future features)

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

### ---

### **LocalStorage Keys**

| Key | Purpose | Default |
| ----- | ----- | ----- |
| `elm_merge_count` | Total merges completed | `0` |
| `elm_high_contrast` | High contrast borders enabled | `'true'` |

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

---

## **External Dependencies**

* **parse-address** (v1.1.2): `@require https://cdn.jsdelivr.net/npm/parse-address@1.1.2/parse-address.min.js`  
  * Used for structured address parsing  
  * Fallback to manual extraction if unavailable

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

**v121.4 Changes (New Feature):**

- **NEW: College Board ID Preference** - When both sides have a College Board Id, always selects left side
  - Detection: Both sides contain `College Board Id:` (case-insensitive)
  - Data attribute: `row.dataset.collegeBoardIdSelection`
  - Only applies when no applicant context is found
  - Example: "College Board Id: 150521406" vs "College Board Id: 147901950"

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

- **Fixed: Multi-word and hyphenated last names not matching in emails** - Previously, a last name like "Hernandez Maravilla" would not match an email containing just "maravilla"
- Added `emailContainsName()` helper function that splits names by spaces and hyphens
- Name parts must be at least 3 characters to be considered (avoids false positives with short strings)
- Example: Last name "Hernandez-Maravilla" now matches email "maravilla.jose@gmail.com"

---

**v121.1 Changes (Bug Fix - Address Tie):**

- **Fixed: Same address with equal completeness not selecting left** - When addresses are the same and have equal completeness scores, now defaults to left side instead of leaving for manual review
- Updated `compareAddresses()` to return `winner: 'left'` when `areSame === true` and scores are equal

---

**v121.0 Changes (Major Bug Fix - Address Comparison):**

- **Fixed: Different addresses being auto-selected based on completeness** - Previously, when two addresses were completely different, the script would pick one based on completeness score. Now, different addresses result in a "tie" and follow email selection or require manual review.

- **Fixed: Same address with unit not being selected** - Improved `hasUnitInfo()` to detect more unit patterns including "Apt B", "Apt 7", "#5", etc.

- **Fixed: Address with country not being preferred** - Added `hasCountry()` check that gives +5 bonus to completeness score before stripping country from address.

- **Fixed: Duplicate city detection** - Added `extractCity()` function and check for city name appearing multiple times in different formats (e.g., "Victorville CA 92394, Victorville, CA").

- **Fixed: Street duplicates with typos not detected** - Added fuzzy string matching with `stringSimilarity()` function. Streets with >80% similarity are now detected as duplicates (e.g., "Las Cruces St" vs "Las Cruses St").

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
- Forbidden names: Angela Armstrong, Gillespie Armstrong, Mariah Armstrong (exact match on BOTH sides)  
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

*Last Updated: Version 119.0*

---
