'use strict';
const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise(r => chrome.runtime.sendMessage(msg, r));
const ELEMENT_TAB = /^https:\/\/[^/]*\.element451\.io\//;
const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

let state = null, tab = null;
const NEEDS = { csv: 'ui', merge: 'csv' }; // which script each one depends on

// The tab the popup was opened on (the Reload tab button reloads it)
async function loadTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  tab = t || null;
}

// The update chip, shown only while a newer extension release exists (until it is dismissed)
function renderUpdate() {
  const slot = $('update-slot');
  slot.textContent = '';
  if (!state.shellUpdate) return;
  const chip = document.createElement('button');
  chip.className = 'chip';
  chip.innerHTML = ICON_DOWNLOAD + '<span class="grow">Update available \u00b7 v' + state.shellUpdate.version + '</span>';
  const x = document.createElement('span');
  x.className = 'x'; x.title = 'Dismiss'; x.setAttribute('role', 'button'); x.setAttribute('aria-label', 'Dismiss update');
  x.innerHTML = ICON_CLOSE;
  x.addEventListener('click', async (e) => { e.stopPropagation(); await send({ type: 'dismissUpdate', version: state.shellUpdate.version }); state.shellUpdate = null; renderUpdate(); });
  chip.appendChild(x);
  chip.addEventListener('click', () => { chrome.tabs.create({ url: state.shellUpdate.url }); $('sheet').hidden = false; });
  slot.appendChild(chip);
}

const needsOff = (s) => !!NEEDS[s.id] && state.enabled[NEEDS[s.id]] === false;
const verText = (s) => 'v' + (state.versions[s.id] || '?') + (needsOff(s) ? ' \u00b7 needs ' + state.scripts.find(x => x.id === NEEDS[s.id]).name : '');

// Updates the rows in place, so a switch keeps its element and animates instead of being rebuilt
function refreshRows() {
  state.scripts.forEach(s => {
    const li = document.querySelector('#scripts li[data-id="' + s.id + '"]');
    if (!li) return;
    li.classList.toggle('disabled-row', !state.userScriptsOk || needsOff(s));
    li.querySelector('.ver').textContent = verText(s);
  });
}

function renderScripts() {
  const ul = $('scripts');
  ul.textContent = '';
  const off = !state.userScriptsOk;
  $('off-card').hidden = !off;
  state.scripts.forEach(s => {
    const li = document.createElement('li');
    li.dataset.id = s.id;
    li.className = 'row-item' + (off || needsOff(s) ? ' disabled-row' : '');
    const txt = document.createElement('div');
    txt.className = 'txt';
    txt.innerHTML = '<div class="name"></div><div class="ver"></div>';
    txt.querySelector('.name').textContent = s.name;
    txt.querySelector('.ver').textContent = verText(s);
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
      refreshRows();
      if (tab && ELEMENT_TAB.test(tab.url || '')) $('reload-row').hidden = false;
    });
    li.append(txt, sw);
    ul.appendChild(li);
  });
}

// Footer: the extension's own version
function renderFoot() {
  $('foot').textContent = 'Extension v' + state.shellVersion + ' \u00b7 scripts update when Chrome starts';
}

async function init() {
  [state] = await Promise.all([send({ type: 'status' }), loadTab()]);
  renderUpdate(); renderScripts(); renderFoot();
}

$('reload').addEventListener('click', () => { if (tab) chrome.tabs.reload(tab.id); window.close(); });
const openExt = () => chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
$('open-ext').addEventListener('click', openExt);
$('sheet-ext').addEventListener('click', openExt);
$('sheet-close').addEventListener('click', () => { $('sheet').hidden = true; });
init();
