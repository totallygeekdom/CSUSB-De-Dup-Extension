'use strict';
const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise(r => chrome.runtime.sendMessage(msg, r));
const ELEMENT_TAB = /^https:\/\/[^/]*\.element451\.io\//;
const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
let state = null, tab = null;
const NEEDS = { csv: 'ui', merge: 'csv' }; // which script each one depends on

// The tab the popup was opened on (the Reload tab button reloads it)
async function loadTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  tab = t || null;
}

// The nearest script this one depends on (directly or through another) that is switched off, if any
const offDependency = (s) => {
  for (let d = NEEDS[s.id]; d; d = NEEDS[d]) if (state.enabled[d] === false) return state.scripts.find(x => x.id === d);
  return null;
};
const needsOff = (s) => !!offDependency(s);
const verText = (s) => 'v' + (state.versions[s.id] || '?') + (needsOff(s) ? ' \u00b7 needs ' + offDependency(s).name : '');

// Updates the rows in place, so a switch keeps its element and animates instead of being rebuilt
function refreshRows() {
  state.scripts.forEach(s => {
    const li = document.querySelector('#scripts li[data-id="' + s.id + '"]');
    if (!li) return;
    li.classList.toggle('disabled-row', needsOff(s));
    li.querySelector('.ver').textContent = verText(s);
  });
}

function renderScripts() {
  const ul = $('scripts');
  ul.textContent = '';
  state.scripts.forEach(s => {
    const li = document.createElement('li');
    li.dataset.id = s.id;
    li.className = 'row-item' + (needsOff(s) ? ' disabled-row' : '');
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
  $('foot').textContent = 'Extension v' + state.shellVersion + ' \u00b7 updated through the Chrome Web Store';
}

async function init() {
  [state] = await Promise.all([send({ type: 'status' }), loadTab()]);
  renderScripts(); renderFoot();
}

$('reload').addEventListener('click', () => { if (tab) chrome.tabs.reload(tab.id); window.close(); });
init();
