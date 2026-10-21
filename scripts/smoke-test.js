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
    check((await page.locator('#scripts .row-item').count()) === 2, 'popup lists both scripts');
    check(!(await page.locator('#off-card').isHidden()), 'popup shows the "Allow user scripts" card while the API is off');
    check((await page.locator('.name').allTextContents()).join('|') === 'UI Perfection|CSV Database', 'script names');

    // settings view and back
    await page.click('#gear');
    check(await page.locator('#settings-view').isVisible(), 'gear opens the settings view');
    await page.click('#back');
    check(await page.locator('#main-view').isVisible(), 'back returns to the main view');

    // update chip: feed a fake newer release through storage and reopen
    await sw.evaluate(() => chrome.storage.local.set({ shellUpdate: { version: '9.9.9', url: 'https://example.com/x.zip' } }));
    await page.reload();
    await page.waitForSelector('.chip', { timeout: 10000 });
    check((await page.locator('.chip').innerText()).includes('9.9.9'), 'update chip shows the new version');
    check((await page.locator('.stats').count()) === 0, 'the chip replaces the counters');
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
    check((await syncVia({ type: 'sync' })).ok === true, 'userScripts API available once allowed, scripts registered');
    const registered = await sw.evaluate(async () => (await chrome.userScripts.getScripts()).map(s => s.id + ':' + s.world).sort().join(','));
    check(registered === 'csv:MAIN,ui:MAIN', 'both scripts registered in the MAIN world (' + registered + ')');
    const site = await context.newPage();
    await site.route('https://test.element451.io/**', r => r.fulfill({ contentType: 'text/html', body: '<html><body><div class="bolt-navigation-right"><elm-universal-search>s</elm-universal-search></div></body></html>' }));
    const flags = () => site.evaluate(() => ({ ui: !!window.__elm451UiPerfectionLoaded, csv: !!window.__elm451CsvDatabaseLoaded }));
    await site.goto('https://test.element451.io/review');
    await site.waitForFunction(() => window.__elm451UiPerfectionLoaded && window.__elm451CsvDatabaseLoaded, null, { timeout: 15000 }).catch(() => {});
    const on = await flags();
    check(on.ui && on.csv, 'both scripts ran on an element451.io page');
    await syncVia({ type: 'toggle', id: 'csv', enabled: false });
    await site.reload();
    await site.waitForFunction(() => window.__elm451UiPerfectionLoaded, null, { timeout: 15000 }).catch(() => {});
    const off = await flags();
    check(off.ui && !off.csv, 'turning CSV Database off stops only that script');
    await syncVia({ type: 'toggle', id: 'csv', enabled: true });

    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join('; ') : ''));
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
