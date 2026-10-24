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

    // update chip: feed a fake newer release through storage and reopen
    await sw.evaluate(() => chrome.storage.local.set({ shellUpdate: { version: '9.9.9', url: 'https://example.com/x.zip' } }));
    await page.reload();
    await page.waitForSelector('.chip', { timeout: 10000 });
    check((await page.locator('.chip').innerText()).includes('9.9.9'), 'update chip shows the new version');
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
    const site = await context.newPage();
    await site.route('https://test.element451.io/**', r => r.fulfill({ contentType: 'text/html', body: '<html><body><div class="bolt-navigation-right"><elm-universal-search>s</elm-universal-search></div></body></html>' }));
    const flags = () => site.evaluate(() => ({ ui: !!window.__elm451UiPerfectionLoaded, csv: !!window.__elm451CsvDatabaseLoaded, merge: !!window.__elm451DbMergeLoaded }));
    await site.goto('https://test.element451.io/review');
    await site.waitForFunction(() => window.__elm451UiPerfectionLoaded && window.__elm451CsvDatabaseLoaded && window.__elm451DbMergeLoaded, null, { timeout: 15000 }).catch(() => {});
    const on = await flags();
    check(on.ui && on.csv && on.merge, 'all three scripts ran on an element451.io page');
    // the popup's "Open dedup page" button: the background notes the school's address (and the review queue's) from the
    // Element451 tabs it sees, and the button opens it
    await new Promise(r => setTimeout(r, 500));
    let noted = await sw.evaluate(async () => (await chrome.storage.local.get('site')).site);
    check(noted && noted.origin === 'https://test.element451.io' && !noted.dedupUrl, 'the extension notes the Element451 address from a tab');
    await site.goto('https://test.element451.io/v2/data/duplicates/bolt/review-queue');
    await new Promise(r => setTimeout(r, 500));
    noted = await sw.evaluate(async () => (await chrome.storage.local.get('site')).site);
    check(noted && noted.dedupUrl === 'https://test.element451.io/v2/data/duplicates/bolt/review-queue', 'it also notes the review queue address');
    const popup2 = await context.newPage(); // the popup closes itself after opening the tab, so it gets its own page
    await popup2.goto('chrome-extension://' + id + '/popup.html');
    await popup2.waitForSelector('#scripts .row-item');
    check(!(await popup2.locator('#open-dedup').isDisabled()) && (await popup2.locator('#dedup-hint').isHidden()), 'the Open the dedup page button is enabled once the site is known');
    // (the test site is not a real server, so what is checked is the tab the extension opens, not what loads in it)
    const [opened] = await Promise.all([context.waitForEvent('page', { timeout: 10000 }), popup2.click('#open-dedup')]);
    await new Promise(r => setTimeout(r, 500));
    const tabUrls = await sw.evaluate(async () => (await chrome.tabs.query({})).map(t => t.url || t.pendingUrl || ''));
    check(tabUrls.some(u => u.startsWith('https://test.element451.io/v2/data/duplicates/bolt/review-queue')), 'the button opens the dedup page in a new tab');
    await opened.close().catch(() => {});
    await sw.evaluate(() => chrome.storage.local.remove('site'));
    await site.goto('https://test.element451.io/review');
    // newest wins: an older copy in the cache (what GitHub's main branch may hold) must not replace the bundled
    // one, a newer one must
    await sw.evaluate(() => chrome.storage.local.set({ cache: { ui: { code: '// @version 1.0\nwindow.__old = 1;', version: '1.0' } } }));
    await syncVia({ type: 'sync' });
    await site.reload();
    await site.waitForFunction(() => window.__elm451UiPerfectionLoaded, null, { timeout: 15000 }).catch(() => {});
    check(await site.evaluate(() => !window.__old && !!window.__elm451UiPerfectionLoaded), 'an older cached script does not replace the bundled one');
    await sw.evaluate(() => chrome.storage.local.set({ cache: { ui: { code: '// @version 999.0\nwindow.__newer = 1;', version: '999.0' } } }));
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
