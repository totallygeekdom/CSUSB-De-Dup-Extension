// Smoke test for the Chrome Web Store edition (run after `node scripts/build-extension.js --store`): loads dist-store/extension
// unpacked into Chromium and checks that the manifest asks for no userScripts permission and no GitHub access, that the bundled
// scripts are registered as content scripts in the page's own world and run on an Element451 page, that the popup's switches
// stop and restart them, and that nothing is fetched from anywhere else.
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EXT = path.join(__dirname, '..', 'dist-store', 'extension');
let failures = 0;
const check = (ok, label) => { console.log((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) failures++; };

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  check(!(manifest.permissions || []).includes('userScripts'), 'the store edition has no userScripts permission');
  check((manifest.permissions || []).slice().sort().join(',') === 'scripting,storage', 'permissions are only storage and scripting (' + (manifest.permissions || []).join(',') + ')');
  check((manifest.host_permissions || []).join(',') === 'https://*.element451.io/*', 'host access is only element451.io');
  const code = fs.readdirSync(EXT).filter(f => /\.(js|html)$/.test(f)).map(f => fs.readFileSync(path.join(EXT, f), 'utf8')).join('\n');
  check(!/githubusercontent|api\.github\.com|userScripts/.test(code), 'the extension\'s own code never mentions GitHub downloads or the userScripts API');

  const bundled = fs.readdirSync(path.join(EXT, 'scripts')).map(f => fs.readFileSync(path.join(EXT, 'scripts', f), 'utf8')).join('\n');
  check(!/githubusercontent|@updateURL|@downloadURL/.test(bundled), 'the bundled scripts carry no GitHub update lines');

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elm451-store-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium', headless: true,
    args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT]
  });
  try {
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
    check(!!sw, 'service worker started');
    const id = new URL(sw.url()).host;
    const outside = [];
    context.on('request', r => { const u = r.url(); if (/^https?:/.test(u) && !/\.element451\.io\//.test(u)) outside.push(u); });

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('chrome-extension://' + id + '/popup.html');
    await page.waitForSelector('#scripts .row-item', { timeout: 10000 });
    check((await page.locator('#scripts .row-item').count()) === 3, 'popup lists the three scripts');
    check((await page.locator('.name').allTextContents()).join('|') === 'UI Perfection|Database|Database Merge', 'script names');
    check((await page.locator('#off-card, .chip, #sheet').count()) === 0, 'no "Allow user scripts" card and no update chip');
    check(/Extension v\d+\.\d+\.\d+ .*Chrome Web Store/.test(await page.locator('#foot').innerText()), 'footer shows the extension version and that the store updates it');
    check((await page.locator('.ver').allTextContents()).every(t => /^v\d+\.\d+/.test(t)), 'each script shows its version');

    const syncVia = (msg) => page.evaluate((m) => new Promise(r => chrome.runtime.sendMessage(m, r)), msg);
    check((await syncVia({ type: 'sync' })).ok === true, 'scripts registered');
    const registered = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map(s => s.id + ':' + s.world).sort().join(','));
    check(registered === 'csv:MAIN,merge:MAIN,ui:MAIN', 'all three scripts registered in the MAIN world (' + registered + ')');
    // a script that went missing is registered again when the popup opens
    await sw.evaluate(() => chrome.scripting.unregisterContentScripts());
    await syncVia({ type: 'status' });
    const healed = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map(s => s.id).sort().join(','));
    check(healed === 'csv,merge,ui', 'opening the popup registers scripts that are missing (' + healed + ')');
    check((await syncVia({ type: 'toggle', id: 'nope', enabled: false })).ok === false, 'a toggle for an unknown script is refused');

    const site = await context.newPage();
    await site.route('https://test.element451.io/**', r => r.fulfill({ contentType: 'text/html', body: '<html><body><div class="bolt-navigation-right"><elm-universal-search>s</elm-universal-search></div></body></html>' }));
    const flags = () => site.evaluate(() => ({ ui: !!window.__elm451UiPerfectionLoaded, csv: !!window.__elm451CsvDatabaseLoaded, merge: !!window.__elm451DbMergeLoaded }));
    await site.goto('https://test.element451.io/review');
    await site.waitForFunction(() => window.__elm451UiPerfectionLoaded && window.__elm451CsvDatabaseLoaded && window.__elm451DbMergeLoaded, null, { timeout: 15000 }).catch(() => {});
    const on = await flags();
    check(on.ui && on.csv && on.merge, 'all three scripts ran on an element451.io page');

    await site.click('#elm-settings-btn');
    await site.waitForFunction(() => document.querySelectorAll('#elm-settings-pane .settings-build').length >= 4, null, { timeout: 15000 }).catch(() => {});
    const lines = await site.$$eval('#elm-settings-pane .settings-build', els => els.map(e => e.textContent));
    check(lines.length === 4 && /^Main script · v\d+\.\d+$/.test(lines[0]) && /^Database script · v\d+\.\d+$/.test(lines[1]) && /^Database merge · v\d+\.\d+$/.test(lines[2]) && lines[3] === 'Extension · v' + manifest.version, 'settings pane lists the four versions (' + lines.join(' | ') + ')');

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
    await site.reload();
    await site.waitForFunction(() => window.__elm451CsvDatabaseLoaded, null, { timeout: 15000 }).catch(() => {});
    check((await flags()).csv, 'turning it on again starts it');

    check(outside.length === 0, 'the extension made no request outside element451.io' + (outside.length ? ': ' + outside.join(', ') : ''));
    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join('; ') : ''));
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
