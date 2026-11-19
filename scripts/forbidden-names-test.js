// The forbidden-name list is stored as hashes: checks the in-script SHA-256 against Node's, that both UI scripts hold the
// same list of well-formed hashes, and that a name is matched however it is cased or spaced.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let failures = 0;
const check = (ok, label) => { console.log((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) failures++; };
const load = (file) => {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const a = src.indexOf('    const sha256Hex = '), b = src.indexOf('const isForbiddenName');
  const end = src.indexOf('\n', b);
  return new Function(src.slice(a, end) + '\nreturn { sha256Hex, FORBIDDEN_NAME_HASHES, isForbiddenName };')();
};
const v2 = load('Element451-UI-Perfection-v2.user.js'), v1 = load('Element451-UI-Perfection.user.js');
const samples = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'Ünïcødé ñame'];
check(samples.every(s => v2.sha256Hex(s) === crypto.createHash('sha256').update(s, 'utf8').digest('hex')), 'the in-script SHA-256 matches Node\'s');
const list = [...v2.FORBIDDEN_NAME_HASHES];
check(list.length === 3 && list.every(h => /^[0-9a-f]{64}$/.test(h)), 'the list holds 3 SHA-256 hashes');
check(JSON.stringify(list) === JSON.stringify([...v1.FORBIDDEN_NAME_HASHES]), 'the v1 and v2 scripts hold the same list');
// a made-up name, added for the test, matches regardless of case and spacing; other names do not
const h = crypto.createHash('sha256').update('elm-forbidden-name:pat example').digest('hex');
v2.FORBIDDEN_NAME_HASHES.add(h);
check(v2.isForbiddenName('Pat Example') && v2.isForbiddenName('  PAT   example ') && !v2.isForbiddenName('Pat Examples') && !v2.isForbiddenName(''), 'a listed name matches whatever its case and spacing; others do not');
console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
process.exit(failures ? 1 : 0);
