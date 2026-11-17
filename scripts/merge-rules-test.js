// Tests the Database Merge script's merge rules on their own (no browser): the rules are pure functions, so the block
// from `function keyOf` to the page code in database-merge-v2.js runs in Node as it is.
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'database-merge-v2.js'), 'utf8');
const a = src.indexOf('    function keyOf(e) {'), b = src.indexOf('    // THE PAGE (a new tab');
if (a < 0 || b < a) { console.error('merge rules not found in database-merge-v2.js'); process.exit(1); }
const { mergeSources } = new Function(src.slice(a, b) + '\nreturn { mergeSources };')();

let failures = 0;
const check = (ok, label) => { console.log((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) failures++; };
const e = (extra) => ({ firstName: 'And...', lastName: 'Rio...', firstName2: '', lastName2: '', dept: 'UnderGrad', rowContents: '', sparkId1: 'a', sparkId2: 'b', merged: 'N', choice: '', score: '', scanDate: '2026-11-01', ...extra });
const one = (...sources) => mergeSources(sources.map((entries, i) => ({ name: 'src' + i, entries }))).entries;

// the newer copy wins, in either order, and keeps what the older copy knew when it has no value of its own
let r = one([e({ scanDate: '2026-11-01', points: 64, score: 'high' })], [e({ scanDate: '2026-11-12' })]);
check(r.length === 1 && r[0].scanDate === '2026-11-12' && r[0].points === 64 && r[0].score === 'high', 'newer copy (second) wins and takes the older copy\'s points and Bolt score');
r = one([e({ scanDate: '2026-11-12' })], [e({ scanDate: '2026-11-01', points: 64, score: 'high' })]);
check(r.length === 1 && r[0].scanDate === '2026-11-12' && r[0].points === 64 && r[0].score === 'high', 'newer copy (first) wins and takes the older copy\'s points and Bolt score');
// a winner's own value is never replaced, and zero and negative totals are values
r = one([e({ scanDate: '2026-11-12', points: 80 })], [e({ scanDate: '2026-11-01', points: 64 })]);
check(r[0].points === 80, 'the winner\'s own points stay');
r = one([e({ scanDate: '2026-11-12', points: 0 })], [e({ scanDate: '2026-11-01', points: 64 })]);
check(r[0].points === 0, 'a total of 0 is a value, not a blank');
r = one([e({ scanDate: '2026-11-12' })], [e({ scanDate: '2026-11-01', points: -38 })]);
check(r[0].points === -38, 'a negative total is carried over');
r = one([e({ scanDate: '2026-11-12' })], [e({ scanDate: '2026-11-01' })]);
check(r[0].points === undefined, 'no points anywhere stays without points');
r = one([e({ sparkId1: 'x', sparkId2: 'y', points: 10 })], [e({ sparkId1: 'p', sparkId2: 'q', points: 20 })]);
check(r.length === 2 && r.map(x => x.points).join() === '10,20', 'different pairs are both kept, each with its own points');
console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
process.exit(failures ? 1 : 0);
