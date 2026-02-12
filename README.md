# CSUSB-De-Dup-Extension

## **Short Documentation v.121.5:**

### **Configuration**

**AUTO\_CLICK\_FAB:** Set to `true` (default) to automatically click FAB on page load. Set to `false` to require manual FAB clicking. Auto-click is blocked for forbidden entries, wrong departments, and ignored students.

**REQUIRE\_SCROLL\_TO\_BOTTOM:** Set to `true` (default) to require scrolling to bottom before merging. Set to `false` to disable scroll-to-review requirement.

**AUTO\_NAVIGATE\_AFTER\_MERGE:** Set to `true` (default) to automatically navigate to the next duplicate after a successful merge. Set to `false` to stay on the success page.

**CONFLICT\_ROW\_THRESHOLD:** Set to number of conflicting rows before warning about possible twins/different people (default: 2). Set to `0` to disable.

**SHOW\_MERGE\_COUNTER:** Set to `true` (default) to show the merge counter in the navbar. Set to `false` to hide it.

**HEADER\_OFFSET:** Pixels from top when scrolling to conflicts (default: 64).

---

### **Contacts List Page**

**Custom Pagination:** Injects page number input and page size (limit) input into the paginator. GO button or Enter key navigates to the specified page with specified limit. Updates URL parameters offset and limit. Works correctly for both top and bottom paginators (each operates independently).

---

### **Contacts Merge Page**

**Auto-Click FAB:** When enabled (default), automatically clicks the FAB button once after page loads and Spark IDs are detected. Waits 200ms after navigation to ensure page is ready. Auto-click is blocked if forbidden entry, wrong department, or ignored student is detected. Can be disabled by setting AUTO\_CLICK\_FAB \= false at top of script. Includes console logging for debugging (🤖 for successful auto-click, ⛔ for blocked, ⏳ for waiting).

**Tooltips & Toasts:** Removes all tooltips for buttons in the center column and pagination buttons to prevent ghost tooltips blocking clicks. FAB tooltip is not removed. Suppresses "Please resolve all items" toast that appears after FAB click \- runs every 100ms to catch and remove toasts immediately.

**Auto Selection:** Auto selection logic triggers when user clicks FAB. Only applies to rows marked with "has-error" class. Rows are marked with data attributes to track what has been processed.

**Applicant:** If one column has the student as an applicant either in the Cal State Apply Application section or in application type entries (Application Start, Application Submit, Application Complete, Admit) then that side should be highlighted yellow and all conflict rows on that side should be selected. All other auto selection logic should be ignored. If both sides have applicant data, compare dates and pick the most recent one. If both sides have application entries, count them and pick the side with more (or most recent if tied).

**Milestone Type Matching:** When milestone rows (type: Prospect, type: Applicant, etc.) have the same type value, select left side. Only applies when no applicant context is found. Example: if both sides show "type: Prospect, Sep 29, 2025 \- 12:00 AM" and "type: Prospect, Dec 15, 2025 \- 12:00 AM", the left side is selected.

**Email:** Tiered tiebreaker system: choose email that contains domain on whitelist (gmail.com, yahoo.com, icloud.com, hotmail.com, aol.com, me.com, outlook.com, live.com, msn.com, protonmail.com, proton.me). If both emails have a whitelisted domain, then choose email with the most opens from User Activity section. If emails have the same number of opens then check both emails against both first names (case insensitive) \- select the email that contains a first name. If both emails contain first names or neither do, then check both emails against both last names (case insensitive) \- select the email that contains a last name. If both emails contain last names or neither do, then check both emails against both birth years \- only valid years are checked (not starting with 0, \>= 1900). Birth year can match as 4 digits (2005), 3 digits (005), or 2 digits (05). If both emails have birth years or neither do, then let user manually decide the email.

**csusb.major Preference:** When only one side contains csusb.major designation, select that side. When both sides contain csusb.major, follow the selected email side. If no email is selected, leave for manual review. Only applies when no applicant context is found. Example: "Business Partner Import Major: Economics \- csusb.major.181410"

**Encoura ID Preference:** When both sides have an Encoura Id, always select left side. Only applies when no applicant context is found. Example: "Encoura Id: 72226502" vs "Encoura Id: 71476216"

**College Board ID Preference:** When both sides have a College Board Id, always select left side. Only applies when no applicant context is found. Example: "College Board Id: 150521406" vs "College Board Id: 147901950"

**csusb.school Preference:** For Student Type rows containing csusb.school.* pattern: if only one side has it, select that side; if neither side has it, leave for manual review; if both sides have it, follow the selected email side; if no email is selected, leave for manual review. Only applies when no applicant context is found. Example: "Student Type    Niche - csusb.school.27942"

**Addresses:** Uses parse-address JavaScript library to parse addresses into a standard unified format. IMPORTANT: Only auto-selects when addresses are THE SAME - different addresses result in a tie and follow email selection or require manual review. When addresses are the same, picks the more complete one (ex. contains the apt# when the other does not, or has country info). Will not choose any address that has duplicate items like the street address listed twice, city name repeated, or similar street names with typos (fuzzy matching at 80% similarity). Scoring system gives points for completeness (street number, city, state, zip, unit number, country) and heavy penalty for duplicates. If the addresses are the same level of completeness then pick the address that is on the side of the chosen email.

**Address Link:** Addresses starting with "Home, " should be turned into a link that goes to a Google Maps search ([https://www.google.com/maps/search/?api=1\\\&query=example+address](https://www.google.com/maps/search/?api=1\\&query=example+address)). Address text is prettified to title case with state abbreviations uppercased. Only appears after FAB is clicked.

**Email Link:** Emails should be turned into a link that goes to Mail Meteor email verification ([https://mailmeteor.com/email-checker?email=example%40example.com](https://mailmeteor.com/email-checker?email=example%40example.com)). Only appears after FAB is clicked.

**Phone Formatting:** Phone numbers are formatted as (xxx)-xxx-xxxx or \+x (xxx)-xxx-xxxx for international. Only appears after FAB is clicked.

**Name Case:** If both sides have the same name (case-insensitive) but different casing, prefer Title Case over ALL CAPS or all lowercase. Only applies when no applicant context is found.

**Date of Birth:** If one side has an invalid birth year (starts with 0 or is before 1900\) then choose the other side.

**First Generation Student:** When one side has "Yes" and the other has "No", always select the side with "Yes". Only applies when no applicant context is found. Example: "First Generation Student: Yes" vs "First Generation Student: No" - the "Yes" side is selected.

**Intended Term:** When both sides have different intended terms, always select the later term. Parses term codes from format like "Spring 2027 (2274)" or "Fall 2027 (2278)" where the 4-digit code indicates the term chronologically (higher code = later term). Only applies when no applicant context is found. Example: "Spring 2027 (2274)" vs "Fall 2027 (2278)" - Fall 2027 is selected because 2278 > 2274.

**Extra Rows:** When no applicant context is found, certain row patterns default to left side: Spark Id, type: Created/name: Record Created, type: Custom, type: Web, \[ACUx\], and Outreach\_UGRD\_. These are ignored if an applicant side is detected.

**Forbidden Entry Lockdown:** If the record contains "test" in First Name or Last Name (either side), or if the full name matches Angela Armstrong, Gillespie Armstrong, or Mariah Armstrong (exact match, either side), then the FAB turns red with a ∅ symbol and clicking it shows "Forbidden entry" alert. This is checked BEFORE department lockdown and has highest priority. The detected name row is highlighted in red.

**Department Lockdown:** If the record contains *GRAD*, IA\_, *IA*, *IA , or Outreach* (without UGRD) in relevant rows (Workflows, Application, Program, type:, status:, Outreach\_) then the FAB turns red with a ∅ symbol and clicking it shows "For other Department" alert. This prevents accidentally merging Graduate or International Admissions records. The detected row is highlighted in red.

**Student ID Mismatch Lockdown:** If the "School Id:" values in the Identities section differ between left and right sides (e.g., "School Id: 008545544" vs "School Id: 009238137"), these are two different students and cannot be merged. FAB turns red with ∅ symbol. Clicking shows "Student IDs do not match. Entries are two different people." alert. The School ID row is highlighted with a deep red border and shadow. This is a complete block with no way to proceed.

**Ignored Students:** Script detects if a student has the "Ignored" chip (for future use).

**Smart FAB Navigation:** First click triggers Element451's native conflict detection, runs auto-resolution, applies smart links and highlight, and scrolls to first unresolved row. Subsequent clicks cycle through unresolved red rows. When all conflicts are resolved, FAB turns grey with down arrow (↓) requiring user to scroll to bottom and review all fields. Once scrolled within 200px of bottom, FAB turns green and shows "Merge" text. This scroll-to-review requirement can be disabled by setting REQUIRE\_SCROLL\_TO\_BOTTOM \= false at the top of the script.

**Auto-Navigate After Merge:** When enabled (default), automatically navigates to the next duplicate after successful merge. Only activates after the green FAB is clicked (ready to merge state). Detects merge success by watching for elm-empty-state element with "Duplicate user is now merged with master" text. Waits 1 second to let user see success message, then clicks next pagination button (button[mattooltip="Next"]). Merge counter increments on merge success detection (more accurate than FAB click). Can be disabled by setting AUTO\_NAVIGATE\_AFTER\_MERGE \= false.

**Twin/Different Person Detection:** Warns when records may belong to twins or different people. Runs before FAB auto-click. Checks for conflicts in First Name, Last Name, Date of Birth (valid years only), and Address. Names are compared case-insensitively with spaces and hyphens removed. Addresses use AddressComparer to check if they're the same. If conflict count >= CONFLICT\_ROW\_THRESHOLD (default 3), shows alert popup listing which fields conflict. User must click OK to acknowledge before auto-click proceeds. Set CONFLICT\_ROW\_THRESHOLD = 0 to disable.

**High Contrast Toggle:** Checkbox in navigation bar to toggle colored borders on conflict rows and yellow highlight on/off. Default is on. Stored in localStorage.

**Merge Counter:** Counter in the navigation bar tracks total merges completed. Stored in localStorage. Has reset button. Animates on increment. Can be hidden by setting SHOW\_MERGE\_COUNTER = false.

**URL Change Detection with Smart Reload:** Monitors for SPA navigation changes and implements intelligent reload strategy. Extracts duplicate IDs from URLs (24-character hex after /duplicates/). Tracks seen IDs in session-scoped Set that persists across navigation but clears on page reload. Set is limited to 10 most recent IDs to prevent memory growth during long sessions. Only forces reload when revisiting a previously seen duplicate ID, allowing fast forward navigation through new duplicates. Includes extensive debug logging showing URL changes, extracted IDs, and session history. Initial page ID is added to Set on load to enable proper back-navigation detection. Spark ID tracking is maintained for future features.
