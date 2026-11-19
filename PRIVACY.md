# Privacy policy

**Element451 Dedup Tools** (the Chrome Web Store edition and the unpacked extension) helps staff review and merge duplicate contacts in the Element451 Deduplication review queue.

**Short version: the extension does not collect your data and sends nothing to its developer or to any third party.** Everything it reads and stores stays in your browser, on your computer.

## What the extension handles

It runs only on your institution's Element451 site (`*.element451.io`). While you work in the Deduplication review queue it can see:

- **Personally identifiable information** shown on the review pages: names, email addresses, phone numbers, student and other ID numbers, and the other fields of the two contact records being compared. This is read only to score the pair, explain the score and (if you turn it on) merge the pair.
- **Website content** of those pages: the score chips, field values, selections and the Merge Contacts button, which the scripts read and change.
- **Authentication information**, in a limited way. The page sends a sign-in token to Element451. The Database script reads the user ID from it to lock a personal `.elmdb` export file to the person who made it; the token itself is not stored, only a short fingerprint of the ID. If you set a password for spreadsheet exports, that password is kept in the browser's local storage on your computer.

## Where it is stored

- **Which scripts are switched on:** the browser's extension storage (`chrome.storage.local`).
- **The optional database of reviewed pairs, the export password and the settings:** the browser's local storage for the Element451 site, on your computer. This is ordinary, unencrypted browser storage, protected only by your computer and browser profile; anyone with access to your browser profile can read it. Use your own profile, and clear the database when you no longer need it, especially on a shared computer.
- **Files you export** (a password-protected spreadsheet, or an `.elmdb` locked to your Element451 login) are saved where you choose. Who you share them with is up to you.

You can delete everything the extension stores by clearing the Element451 site's data in your browser, or by removing the extension.

## What leaves your computer

Nothing is sent to the developer or to anyone else. There is no server, analytics, advertising, crash reporting or tracking. The extension does not sell, share or transfer data.

The scripts talk only to Element451, and only through the page you already have open: they repeat requests the Element451 page itself makes (for example to read more of the review history), using your own signed-in session. No other host is contacted. The Chrome Web Store edition downloads no code; the scripts it runs are the files in its package.

## Limited Use disclosure

The use of information handled by this extension adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements:

- **Allowed use:** user data is used only to provide the extension's single purpose, reviewing and merging duplicate contacts in the Element451 Deduplication review queue.
- **Allowed transfer:** user data is not transferred to anyone.
- **No advertising:** user data is never used or transferred to serve personalized, re-targeted or interest-based advertising.
- **No human reading:** no person other than you reads the data; the developer never receives it.
- **No other use:** user data is not used or transferred to determine creditworthiness or for lending purposes, and not for any purpose unrelated to the single purpose above.

## Student records

Contacts in Element451 may include records protected by FERPA. The extension is a tool that runs inside your own authorized Element451 session: it shows you only what your account can already see. Your institution's own data-handling rules apply to what you do with it, including any database or export file you create. Do not post student names, IDs or emails in this repository's issues, pull requests or screenshots.

## Changes and contact

If this policy changes, the new version is published in this repository (`PRIVACY.md`) with the extension update. Questions: open an issue at <https://github.com/totallygeekdom/CSUSB-De-Dup-Extension/issues> (without any student information).
