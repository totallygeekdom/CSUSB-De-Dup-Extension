// Smoke test for the built extension (run after scripts/build-extension.js): loads dist/extension unpacked into
// Chromium, checks the service worker starts, the popup renders, and the toggles/update chip behave.
// The userScripts API itself stays switched off in a fresh profile (Chrome gates it behind "Allow user scripts"),
// so what is checked here is the popup's off-state card, the messages, and the counters.
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EXT = path.join(__dirname, '..', 'dist', 'extension');
let failures = 0;
const check = (ok, label) => { console.log((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) failures++; };

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elm451-ext-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium', headless: true,
    args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT]
  });
  try {
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
    check(!!sw, 'service worker started');
    const id = new URL(sw.url()).host;

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('chrome-extension://' + id + '/popup.html');
    await page.waitForSelector('#scripts .row-item', { timeout: 10000 });
    check((await page.locator('#scripts .row-item').count()) === 3, 'popup lists the three scripts');
    check(!(await page.locator('#off-card').isHidden()), 'popup shows the "Allow user scripts" card while the API is off');
    check((await page.locator('.name').allTextContents()).join('|') === 'UI Perfection|Database|Database Merge', 'script names');

    check((await page.locator('#foot').innerText()).includes('Extension v'), 'footer shows the extension version');

    // update chip: feed a fake newer release through storage and reopen.
    // The install-time checks go to GitHub; on a machine with network they clear shellUpdate when no newer release exists, which
    // can land just after the fake one is set. Let a full check run finish first, and set the fake one again if it was cleared.
    await sw.evaluate(() => runChecks()).catch(() => {});
    const setUpdate = async (version) => {
        for (let i = 0; i < 5; i++) {
            await sw.evaluate((v) => chrome.storage.local.set({ shellUpdate: { version: v, url: 'https://example.com/x.zip' } }), version);
            await page.reload();
            try { await page.waitForSelector('.chip', { timeout: 4000 }); return; } catch (e) { /* cleared by a check: set it again */ }
        }
        await page.waitForSelector('.chip', { timeout: 4000 });
    };
    await setUpdate('9.9.9');
    check((await page.locator('.chip').innerText()).includes('9.9.9'), 'update chip shows the new version');
    await setUpdate('9.9.9<img src=x onerror=window.__x=1>');
    check((await page.locator('.chip img').count()) === 0 && (await page.locator('.chip').innerText()).includes('<img'), 'the release version is shown as text, never as markup');
    await setUpdate('9.9.9');
    check((await page.locator('.stats, .stat').count()) === 0, 'the popup has no counter row');
    await page.click('.chip .x');
    await page.waitForSelector('.chip', { state: 'detached', timeout: 5000 });
    check(true, 'dismissing the chip removes it');
    await page.reload();
    await page.waitForSelector('#scripts .row-item');
    check((await page.locator('.chip').count()) === 0, 'a dismissed update stays dismissed');

    // End to end: switch "Allow user scripts" on the way the chrome://extensions toggle does, then check the
    // scripts get registered in the page's own world and run on an Element451 page, and that a toggle stops one.
    const ext = await context.newPage();
    await ext.goto('chrome://extensions');
    await ext.evaluate((extId) => chrome.developerPrivate.updateExtensionConfiguration({ extensionId: extId, userScriptsAccess: true }), id);
    const syncVia = (msg) => page.evaluate((m) => new Promise(r => chrome.runtime.sendMessage(m, r)), msg);
    await sw.evaluate(() => chrome.storage.local.remove('cache')); // whatever the install-time GitHub check stored (online runs)
    check((await syncVia({ type: 'sync' })).ok === true, 'userScripts API available once allowed, scripts registered');
    const registered = await sw.evaluate(async () => (await chrome.userScripts.getScripts()).map(s => s.id + ':' + s.world).sort().join(','));
    check(registered === 'csv:MAIN,merge:MAIN,ui:MAIN', 'all three scripts registered in the MAIN world (' + registered + ')');
    // "Allow user scripts" switched on after the install: opening the popup (its status request) registers what is missing
    await sw.evaluate(() => chrome.userScripts.unregister());
    await syncVia({ type: 'status' });
    const healed = await sw.evaluate(async () => (await chrome.userScripts.getScripts()).map(s => s.id).sort().join(','));
    check(healed === 'csv,merge,ui', 'opening the popup registers scripts that are missing (' + healed + ')');
    check((await syncVia({ type: 'toggle', id: 'nope', enabled: false })).ok === false, 'a toggle for an unknown script is refused');
    const site = await context.newPage();
    await site.route('https://test.element451.io/**', r => r.fulfill({ contentType: 'text/html', body: '<html><body><div class="bolt-navigation-right"><elm-universal-search>s</elm-universal-search></div></body></html>' }));
    const flags = () => site.evaluate(() => ({ ui: !!window.__elm451UiPerfectionLoaded, csv: !!window.__elm451CsvDatabaseLoaded, merge: !!window.__elm451DbMergeLoaded }));
    await site.goto('https://test.element451.io/review');
    await site.waitForFunction(() => window.__elm451UiPerfectionLoaded && window.__elm451CsvDatabaseLoaded && window.__elm451DbMergeLoaded, null, { timeout: 15000 }).catch(() => {});
    const on = await flags();
    check(on.ui && on.csv && on.merge, 'all three scripts ran on an element451.io page');
    // newest wins: an older copy in the cache (what GitHub's main branch may hold) must not replace the bundled
    // one, a newer one must
    // a cached copy is only used when it is one of our userscripts (header, project name, plain version): see looksLikeOurScript
    const fake = (version, body) => '// ==UserScript==\n// @name         Element451 - Test copy\n// @version      ' + version + '\n// ==/UserScript==\n' + body + '\n// ' + 'x'.repeat(200);
    await sw.evaluate((code) => chrome.storage.local.set({ cache: { ui: { code, version: '1.0' } } }), fake('1.0', 'window.__old = 1;'));
    await syncVia({ type: 'sync' });
    await site.reload();
    await site.waitForFunction(() => window.__elm451UiPerfectionLoaded, null, { timeout: 15000 }).catch(() => {});
    check(await site.evaluate(() => !window.__old && !!window.__elm451UiPerfectionLoaded), 'an older cached script does not replace the bundled one');
    await sw.evaluate(() => chrome.storage.local.set({ cache: { ui: { code: '// @version 999.0\nwindow.__notOurs = 1;', version: '999.0' } } }));
    await syncVia({ type: 'sync' });
    await site.reload();
    await site.waitForFunction(() => window.__elm451UiPerfectionLoaded, null, { timeout: 15000 }).catch(() => {});
    check(await site.evaluate(() => !window.__notOurs && !!window.__elm451UiPerfectionLoaded), 'a cached copy that is not one of our userscripts is never run');
    check(await sw.evaluate(() => !looksLikeOurScript('<html><body>Sign in // @version 9.9</body></html>') && !looksLikeOurScript('') && !looksLikeOurScript('// ==UserScript==\n// @name Something else\n// @version 9.9\n// ==/UserScript==\n' + 'x'.repeat(300))), 'pages and other scripts are refused as updates');
    await sw.evaluate((code) => chrome.storage.local.set({ cache: { ui: { code, version: '999.0' } } }), fake('999.0', 'window.__newer = 1;'));
    await syncVia({ type: 'sync' });
    await site.reload();
    await site.waitForFunction(() => window.__newer, null, { timeout: 15000 }).catch(() => {});
    check(await site.evaluate(() => !!window.__newer && !window.__elm451UiPerfectionLoaded), 'a newer cached script replaces the bundled one');
    await sw.evaluate(() => chrome.storage.local.remove('cache'));
    await syncVia({ type: 'sync' });
    await site.reload();
    await site.waitForFunction(() => window.__elm451UiPerfectionLoaded && window.__elm451CsvDatabaseLoaded && window.__elm451DbMergeLoaded, null, { timeout: 15000 }).catch(() => {});

    // the in-page settings pane lists main script, database script and extension versions
    
    await site.click('#elm-settings-btn');
    await site.waitForFunction(() => document.querySelectorAll('#elm-settings-pane .settings-build').length >= 4, null, { timeout: 15000 }).catch(() => {});
    const lines = await site.$$eval('#elm-settings-pane .settings-build', els => els.map(e => e.textContent));
    check(lines.length === 4 && /^Main script · v\d+\.\d+$/.test(lines[0]) && /^Database script · v\d+\.\d+$/.test(lines[1]) && /^Database merge · v\d+\.\d+$/.test(lines[2]) && /^Extension · v\d+\.\d+\.\d+$/.test(lines[3]), 'settings pane lists the four versions (' + lines.join(' | ') + ')');

    // Appeal and Forbidden checkboxes sit with the departments: off by default, and ticking one stores its setting
    const allow0 = await site.$$eval('#elm-allow-appeal, #elm-allow-forbidden', els => els.map(e => e.checked));
    await site.evaluate(() => { document.getElementById('elm-allow-appeal').click(); });
    const allow1 = await site.evaluate(() => ({ a: localStorage.getItem('elm_allow_appeal'), f: localStorage.getItem('elm_allow_forbidden') }));
    check(allow0.length === 2 && !allow0[0] && !allow0[1] && allow1.a === 'true' && allow1.f === null, 'Appeal and Forbidden checkboxes: off by default, ticking Appeal stores it');
    await site.evaluate(() => { document.getElementById('elm-allow-appeal').click(); });
    await syncVia({ type: 'toggle', id: 'csv', enabled: false });
    await site.reload();
    await site.waitForFunction(() => window.__elm451UiPerfectionLoaded, null, { timeout: 15000 }).catch(() => {});
    const off = await flags();
    check(off.ui && !off.csv, 'turning Database off stops only that script');
    await syncVia({ type: 'toggle', id: 'csv', enabled: true });

    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join('; ') : ''));
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
