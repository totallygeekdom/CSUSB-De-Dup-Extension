'use strict';
const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise(r => chrome.runtime.sendMessage(msg, r));
const ELEMENT_TAB = /^https:\/\/[^/]*\.element451\.io\//;
const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

let state = null, counts = null, tab = null;
const NEEDS = { csv: 'ui', merge: 'csv' }; // which script each one depends on

async function loadCounts() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  tab = t || null;
  if (!tab || !ELEMENT_TAB.test(tab.url || '')) return null;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        let db = 0;
        try { db = JSON.parse(localStorage.getItem('elm_csv_database') || '[]').length; } catch (e) { /* unreadable */ }
        return { db, merges: parseInt(localStorage.getItem('elm_merge_count') || '0', 10) || 0 };
      }
    });
    return res && res.result;
  } catch (e) { return null; }
}

function renderStats() {
  const slot = $('stats-slot');
  slot.textContent = '';
  if (state.shellUpdate) {
    // the update chip takes the counters' place until it is dismissed or the extension is updated
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.innerHTML = ICON_DOWNLOAD + '<span class="grow">Update available · v' + state.shellUpdate.version + '</span>';
    const x = document.createElement('span');
    x.className = 'x'; x.title = 'Dismiss'; x.setAttribute('role', 'button'); x.setAttribute('aria-label', 'Dismiss update');
    x.innerHTML = ICON_CLOSE;
    x.addEventListener('click', async (e) => { e.stopPropagation(); await send({ type: 'dismissUpdate', version: state.shellUpdate.version }); state.shellUpdate = null; renderStats(); renderFoot(); });
    chip.appendChild(x);
    chip.addEventListener('click', () => { chrome.tabs.create({ url: state.shellUpdate.url }); $('sheet').hidden = false; });
    slot.appendChild(chip);
    return;
  }
  if (counts) {
    const box = document.createElement('div');
    box.className = 'stats';
    box.innerHTML = '<div class="stat"><b>' + counts.db.toLocaleString() + '</b><span>DB entries</span></div><div class="stat"><b>' + counts.merges.toLocaleString() + '</b><span>Merges</span></div>';
    slot.appendChild(box);
  } else {
    const p = document.createElement('p');
    p.className = 'fine';
    p.textContent = 'Open Element451 to see the database and merge counts.';
    slot.appendChild(p);
  }
}

function renderScripts() {
  const ul = $('scripts');
  ul.textContent = '';
  const off = !state.userScriptsOk;
  $('off-card').hidden = !off;
  state.scripts.forEach(s => {
    const li = document.createElement('li');
    const dep = NEEDS[s.id];
    const needsUi = !!dep && state.enabled[dep] === false; // a script whose partner script is switched off
    li.className = 'row-item' + (off || needsUi ? ' disabled-row' : '');
    const txt = document.createElement('div');
    txt.className = 'txt';
    txt.innerHTML = '<div class="name"></div><div class="ver"></div>';
    txt.querySelector('.name').textContent = s.name;
    txt.querySelector('.ver').textContent = 'v' + (state.versions[s.id] || '?') + (needsUi ? ' · needs ' + state.scripts.find(x => x.id === dep).name : '');
    const sw = document.createElement('label');
    sw.className = 'switch';
    sw.innerHTML = '<input type="checkbox" role="switch"><span class="track"></span><span class="thumb">' + ICON_CHECK + '</span>';
    const input = sw.querySelector('input');
    input.checked = state.enabled[s.id] !== false;
    input.disabled = off;
    input.setAttribute('aria-label', s.name);
    input.addEventListener('change', async () => {
      state.enabled[s.id] = input.checked;
      await send({ type: 'toggle', id: s.id, enabled: input.checked });
      renderScripts();
      if (tab && ELEMENT_TAB.test(tab.url || '')) $('reload-row').hidden = false;
    });
    li.append(txt, sw);
    ul.appendChild(li);
  });
}

// Footer: the extension's own version, plus the counts while the update chip is covering them.
function renderFoot() {
  let t = 'Extension v' + state.shellVersion + ' \u00b7 scripts update when Chrome starts';
  if (state.shellUpdate && counts) t = 'DB ' + counts.db.toLocaleString() + ' \u00b7 Merges ' + counts.merges.toLocaleString() + '\n' + t;
  $('foot').textContent = t;
}

async function init() {
  [state, counts] = await Promise.all([send({ type: 'status' }), loadCounts()]);
  renderStats(); renderScripts(); renderFoot();
}

$('reload').addEventListener('click', () => { if (tab) chrome.tabs.reload(tab.id); window.close(); });
const openExt = () => chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
$('open-ext').addEventListener('click', openExt);
$('sheet-ext').addEventListener('click', openExt);
$('sheet-close').addEventListener('click', () => { $('sheet').hidden = true; });
init();
