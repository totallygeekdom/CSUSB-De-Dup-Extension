# Chrome Web Store edition

The package in `extension-store/` is the one to submit to the Chrome Web Store. Differences from the unpacked extension in `extension/`:

| | Unpacked extension (`extension/`) | Store edition (`extension-store/`) |
|---|---|---|
| Permissions | `storage`, `userScripts` | `storage`, `scripting` |
| Host access | `*.element451.io`, GitHub (raw and API) | `*.element451.io` only |
| Where the scripts come from | the package, replaced by newer copies downloaded from GitHub `main` | the package only |
| Updates | scripts: every Chrome start; the extension: manual zip | the Chrome Web Store (a script change = a new store version) |
| User setting needed | "Allow user scripts" | none |
| Release tag | `vX.Y.Z` | `store-vX.Y.Z` |

## Releasing

1. Change the scripts as usual (`Element451-UI-Perfection-v2.user.js`, `database-v2.js`, `database-merge-v2.js`).
2. Bump `version` in `extension-store/manifest.json` (the store rejects an upload with the same version as the live one).
3. Merge to `main`. CI builds the zip and publishes a `store-vX.Y.Z` release with it (locally: `npm run build:store`, zip in `dist-store/`).
4. Upload the zip in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) and submit for review.

The unpacked extension is not affected: its scripts still update from GitHub `main`.

## Listing text

**Name:** Element451 Dedup Tools

**Summary (132 characters max):** Scoring, a plain-English write-up and optional auto-merge for the Element451 Deduplication review queue.

**Description:** Works only on your institution's Element451 site (`*.element451.io`), on the Deduplication review queue. It scores each pair of possible duplicate contacts by points, explains the score in plain English, can skip pairs that must not be merged (for example other departments' records) and can merge pairs after a visible countdown that you can cancel. An optional local database lists the pairs you have reviewed. Everything stays in your browser; the extension sends nothing anywhere. Each of the three scripts can be switched on or off from the toolbar icon.

**Visibility:** Unlisted (anyone with the link can install it) or Private (named Google accounts or a Google Workspace domain).

## Single purpose

Streamline reviewing and merging duplicate contacts in the Element451 Deduplication review queue.

## Permission justifications

- **Host access `https://*.element451.io/*`:** the scripts run on the Element451 review pages and read and change what is on them (scores, selections, the merge button). They need no other site.
- **`scripting`:** registers the three bundled scripts so they run in the page's own context on Element451 pages, and turns each one on or off from the popup.
- **`storage`:** remembers which scripts are switched on.

## Remote code

None. The extension downloads nothing and runs only files that are in the package. (The `userScripts` permission and the GitHub download of the unpacked extension are not part of this edition.)

## Data and privacy

- The extension collects nothing and sends nothing to the developer or anyone else; it talks only to Element451, by repeating requests the page itself makes with your own signed-in session. The full policy, including the Limited Use statement, is in [PRIVACY.md](PRIVACY.md).
- The scripts' settings and the optional database of reviewed pairs are kept in the browser's local storage on that computer. A database file can be downloaded, password-protected, and shared by the user.
- Contact details shown on Element451 pages are read only to score and explain the pair on screen; they are not stored outside the optional local database and never leave the browser.

Fill in the privacy practices tab of the Developer Dashboard to match: no personal data sold or transferred; the data handled is "personally identifiable information", "website content" and "authentication information" (the sign-in ID read locally to lock a personal export file, and the export password kept in local storage), used only for the extension's single purpose. Google requires these disclosures even for data that only stays on the computer. Privacy policy URL: `https://github.com/totallygeekdom/CSUSB-De-Dup-Extension/blob/main/PRIVACY.md`.

## Before submitting

- Developer account: one-time $5 fee and 2-step verification.
- Screenshots (1280x800 or 640x400): the analysis card and the points view; the repo's example gallery can be used as a starting point.
- A support contact (email) and a privacy policy link if the dashboard asks for one; the data section above is the text to base it on.
