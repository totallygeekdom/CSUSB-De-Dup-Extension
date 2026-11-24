// Tests the rating actions (Stop / Merge / Skip / Dismiss per High, Medium, Low). The pure block of the userscript is cut out and run on its own.
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'Element451-UI-Perfection-v2.user.js'), 'utf8');
const a = src.indexOf('// ---- RATING ACTIONS START'), b = src.indexOf('// ---- RATING ACTIONS END');
if (a < 0 || b < 0) { console.error('FAIL the RATING ACTIONS markers are missing from the script'); process.exit(1); }
const { ACTION_NAMES, RATING_LEVELS, isAction, actionsFromOld, actionFor, blockedAction, isScan } =
  new Function(src.slice(a, b) + '\nreturn { ACTION_NAMES, RATING_LEVELS, isAction, actionsFromOld, actionFor, blockedAction, isScan };')();
let failures = 0;
const check = (ok, label) => { console.log((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) failures++; };
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

check(same(ACTION_NAMES, ['stop', 'merge', 'skip', 'dismiss']) && same(RATING_LEVELS, ['high', 'medium', 'low']), 'four actions, three ratings');
check(ACTION_NAMES.every(isAction) && !isAction('wait') && !isAction(null) && !isAction(''), 'only the four action names are accepted');

// carrying an older install over: the slider (0 None, 1 High, 2 + Medium, 3 + Low, 4 All) and Auto-Skip
check(same(actionsFromOld(4, true), { high: 'stop', medium: 'stop', low: 'stop' }), 'old default (slider All, Auto-Skip on): every rating Stop');
check(same(actionsFromOld(2, true), { high: 'stop', medium: 'stop', low: 'skip' }), 'old slider on Medium with Auto-Skip: Low skipped');
check(same(actionsFromOld(1, true), { high: 'stop', medium: 'skip', low: 'skip' }), 'old slider on High with Auto-Skip: Medium and Low skipped');
check(same(actionsFromOld(0, true), { high: 'skip', medium: 'skip', low: 'skip' }) && isScan(actionsFromOld(0, true)), 'old slider on None with Auto-Skip: every rating Skip (a scan)');
check(same(actionsFromOld(1, false), { high: 'stop', medium: 'stop', low: 'stop' }), 'old slider on High with Auto-Skip off: nothing skipped, everything Stop');
check(!Object.values(actionsFromOld(3, true)).includes('merge') && !Object.values(actionsFromOld(0, false)).includes('merge'), 'an older install is never carried over to Merge (it was a per-session choice)');

// the action for a pair
const acts = { high: 'merge', medium: 'stop', low: 'dismiss' };
check(actionFor(acts, 'high') === 'merge' && actionFor(acts, 'medium') === 'stop' && actionFor(acts, 'low') === 'dismiss', 'a rated pair takes its rating\'s action');
check(actionFor(acts, null) === 'stop' && actionFor(acts, undefined) === 'stop', 'with no rating yet and different actions: Stop');
check(actionFor({ high: 'skip', medium: 'skip', low: 'skip' }, null) === 'skip', 'with no rating yet and the same action for all three: that action');

// blocked pairs
check(blockedAction('stop') === 'stop', 'a blocked pair on Stop stays on screen');
check(['merge', 'skip', 'dismiss'].every(x => blockedAction(x) === 'skip'), 'a blocked pair is never merged or dismissed by its rating: it is skipped');

// scan
check(isScan({ high: 'skip', medium: 'skip', low: 'skip' }) && !isScan({ high: 'skip', medium: 'skip', low: 'stop' }), 'a scan is every rating on Skip');

console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
process.exit(failures ? 1 : 0);
