// Element451 Dedup Tools: service worker.
// Runs the three scripts that ship inside this package on *.element451.io, in the page's own JS world (MAIN), and lets
// the popup switch each one on or off. Nothing is downloaded: the code that runs is the code that was reviewed and
// published in the Chrome Web Store, and the store delivers updates (a new script version = a new extension version).
'use strict';

const MATCHES = ['https://*.element451.io/*'];
const SCRIPTS = [
  { id: 'ui', name: 'UI Perfection', file: 'Element451-UI-Perfection-v2.user.js' },
  { id: 'csv', name: 'Database', file: 'database-v2.js' },
  { id: 'merge', name: 'Database Merge', file: 'database-merge-v2.js' }
];
// A small file written by the build that tells the page which extension version is running (the scripts show it in
// their settings pane). It runs before each script.
const VERSION_FILE = 'scripts/ext-version.js';

const versionOf = (code) => ((code || '').match(/@version\s+([^\s]+)/) || [])[1] || '';

async function getEnabled() {
  const s = await chrome.storage.local.get('enabled');
  return s.enabled || { ui: true, csv: true, merge: true };
}

// Registration is unregister-then-register, so two overlapping runs (install + a popup toggle) could both unregister and
// then both register, which throws "Duplicate script ID". Run them one at a time.
let syncQueue = Promise.resolve();
function syncScripts() {
  const run = syncQueue.then(syncScriptsNow, syncScriptsNow);
  syncQueue = run.catch(() => {});
  return run;
}

async function syncScriptsNow() {
  const enabled = await getEnabled();
  const ids = SCRIPTS.map(s => s.id);
  try { await chrome.scripting.unregisterContentScripts({ ids }); } catch (e) { /* none registered yet */ }
  for (const script of SCRIPTS) {
    if (enabled[script.id] === false) continue;
    const def = { id: script.id, matches: MATCHES, js: [VERSION_FILE, 'scripts/' + script.file], runAt: 'document_idle', world: 'MAIN', persistAcrossSessions: true };
    try { await chrome.scripting.registerContentScripts([def]); }
    catch (e) { console.warn('Dedup Tools: could not register ' + script.name + ':', e && e.message || e); } // one failing must not stop the others
  }
  return true;
}

// What an earlier version (which fetched scripts from GitHub) left behind.
async function cleanUpOldState() {
  try { await chrome.storage.local.remove(['cache', 'shellUpdate', 'dismissed']); } catch (e) { /* nothing to remove */ }
  try { await chrome.action.setBadgeText({ text: '' }); } catch (e) { /* the badge is cosmetic */ }
}

chrome.runtime.onInstalled.addListener(async () => { await cleanUpOldState(); await syncScripts(); }); // install, reload, and extension updates
chrome.runtime.onStartup.addListener(() => { syncScripts(); });                                         // every time Chrome starts

// The popup talks to us through these messages.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // only this extension's own pages (the popup) are answered
  if (!sender || sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false;
  (async () => {
    try {
      const enabled = await getEnabled();
      if (msg.type === 'status') {
        const versions = {};
        for (const script of SCRIPTS) versions[script.id] = versionOf(await (await fetch(chrome.runtime.getURL('scripts/' + script.file))).text());
        // a script that is switched on but not registered (a failed registration, a cleared profile): register it now
        const have = new Set((await chrome.scripting.getRegisteredContentScripts()).map(s => s.id));
        if (SCRIPTS.some(s => enabled[s.id] !== false && !have.has(s.id))) await syncScripts();
        reply({ enabled, versions, scripts: SCRIPTS.map(s => ({ id: s.id, name: s.name })), shellVersion: chrome.runtime.getManifest().version });
      } else if (msg.type === 'toggle') {
        if (!SCRIPTS.some(s => s.id === msg.id)) { reply({ ok: false, error: 'unknown script' }); return; }
        enabled[msg.id] = !!msg.enabled;
        await chrome.storage.local.set({ enabled });
        reply({ ok: await syncScripts() });
      } else if (msg.type === 'sync') {
        reply({ ok: await syncScripts() });
      } else {
        reply({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      console.warn('Dedup Tools: message "' + (msg && msg.type) + '" failed:', e && e.message || e);
      try { reply({ ok: false, error: String(e && e.message || e) }); } catch (e2) { /* the popup closed */ }
    }
  })();
  return true; // the reply is sent asynchronously
});
