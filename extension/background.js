// Element451 Dedup Tools: service worker.
// Runs the two userscripts on *.element451.io through the userScripts API (in the page's own JS world,
// like Tampermonkey does), keeps them current from GitHub, and tells the popup when a newer extension
// (the "shell": manifest, popup, this file) has been released. Checks happen only when Chrome starts and
// right after the extension is installed or reloaded; there are no timers.
'use strict';

const REPO = 'totallygeekdom/csusb-de-dup-extension';
const BRANCH = 'main';
const RAW = 'https://raw.githubusercontent.com/' + REPO + '/' + BRANCH + '/';
const MATCHES = ['https://*.element451.io/*'];
const SCRIPTS = [
  { id: 'ui', name: 'UI Perfection', file: 'Element451-UI-Perfection-v2.user.js' },
  { id: 'csv', name: 'CSV Database', file: 'csv-database-v2.js' }
];

const versionOf = (code) => ((code || '').match(/@version\s+([^\s]+)/) || [])[1] || '';
// 1.2.10 > 1.2.9: compares dotted numbers
function newer(a, b) {
  const x = String(a).split('.').map(n => parseInt(n, 10) || 0), y = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}

async function getState() {
  const s = await chrome.storage.local.get(['enabled', 'cache', 'shellUpdate', 'dismissed']);
  return { enabled: s.enabled || { ui: true, csv: true }, cache: s.cache || {}, shellUpdate: s.shellUpdate || null, dismissed: s.dismissed || '' };
}

// The userScripts API is gated: Chrome 138+ needs "Allow user scripts" on the extension's details page
// (Chrome 120-137: Developer mode). Until then every call throws.
async function userScriptsAvailable() {
  try { await chrome.userScripts.getScripts(); return true; } catch (e) { return false; }
}

// The code that runs: whichever has the higher @version, the copy fetched from GitHub or the one bundled in
// the zip (so a newer zip is never held back by an older cached copy, nor an older GitHub copy replace a newer
// bundled one, e.g. while GitHub's main branch is behind the zip).
async function codeFor(script, cache) {
  const code = await (await fetch(chrome.runtime.getURL('scripts/' + script.file))).text();
  const bundled = { code, version: versionOf(code), bundled: true };
  const cached = cache[script.id];
  return cached && cached.code && !newer(bundled.version, cached.version) ? cached : bundled;
}

async function syncScripts() {
  if (!(await userScriptsAvailable())) return false;
  const { enabled, cache } = await getState();
  for (const script of SCRIPTS) {
    try { await chrome.userScripts.unregister({ ids: [script.id] }); } catch (e) { /* not registered yet */ }
    if (enabled[script.id] === false) continue;
    const { code } = await codeFor(script, cache);
    // the first snippet tells the page which extension version is running (the scripts show it in their settings pane)
    const ver = JSON.stringify(chrome.runtime.getManifest().version);
    await chrome.userScripts.register([{ id: script.id, matches: MATCHES, js: [{ code: 'window.__elm451Extension = ' + ver + ';' }, { code }], runAt: 'document_idle', world: 'MAIN' }]);
  }
  return true;
}

async function checkScriptUpdates() {
  const { cache } = await getState();
  let changed = false;
  for (const script of SCRIPTS) {
    try {
      const res = await fetch(RAW + script.file, { cache: 'no-store' });
      if (!res.ok) continue;
      const code = await res.text();
      const version = versionOf(code);
      if (!version || (cache[script.id] && cache[script.id].version === version && cache[script.id].code === code)) continue;
      cache[script.id] = { code, version, fetchedAt: Date.now() };
      changed = true;
    } catch (e) { /* offline: keep what we have */ }
  }
  if (changed) { await chrome.storage.local.set({ cache }); await syncScripts(); }
}

async function checkShellUpdate() {
  try {
    const res = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return;
    const rel = await res.json();
    const version = String(rel.tag_name || '').replace(/^v/, '');
    const asset = (rel.assets || []).find(a => /\.zip$/i.test(a.name));
    if (version && newer(version, chrome.runtime.getManifest().version)) {
      await chrome.storage.local.set({ shellUpdate: { version, url: asset ? asset.browser_download_url : rel.html_url } });
    } else {
      await chrome.storage.local.remove('shellUpdate');
    }
  } catch (e) { /* offline */ }
  await updateBadge();
}

async function updateBadge() {
  const { shellUpdate } = await getState();
  await chrome.action.setBadgeText({ text: shellUpdate ? '↑' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#ef6c00' });
}

async function runChecks() {
  await syncScripts();          // register what we have right away
  await checkScriptUpdates();   // then fetch anything newer from GitHub
  await checkShellUpdate();
}

chrome.runtime.onInstalled.addListener(runChecks);   // install, reload, and extension updates
chrome.runtime.onStartup.addListener(runChecks);     // every time Chrome starts

// The popup talks to us through these messages.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    const st = await getState();
    if (msg.type === 'status') {
      const versions = {};
      for (const script of SCRIPTS) versions[script.id] = (await codeFor(script, st.cache)).version;
      reply({
        userScriptsOk: await userScriptsAvailable(), enabled: st.enabled, versions,
        scripts: SCRIPTS.map(s => ({ id: s.id, name: s.name })),
        shellVersion: chrome.runtime.getManifest().version,
        shellUpdate: st.shellUpdate && st.dismissed !== st.shellUpdate.version ? st.shellUpdate : null
      });
    } else if (msg.type === 'toggle') {
      st.enabled[msg.id] = !!msg.enabled;
      await chrome.storage.local.set({ enabled: st.enabled });
      reply({ ok: await syncScripts() });
    } else if (msg.type === 'dismissUpdate') {
      await chrome.storage.local.set({ dismissed: msg.version });
      await updateBadge();
      reply({ ok: true });
    } else if (msg.type === 'sync') {
      reply({ ok: await syncScripts() });
    }
  })();
  return true; // the reply is sent asynchronously
});
