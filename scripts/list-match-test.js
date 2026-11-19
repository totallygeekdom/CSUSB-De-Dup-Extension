// The list call's records hold the two contacts as `master` and `duplicate` objects (no top-level name): checks the helpers that
// read a name from them and decide whether a list row shows it. They sit between LIST NAMES START / END in database-v2.js.
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'database-v2.js'), 'utf8');
const a = src.indexOf('// ---- LIST NAMES START'), b = src.indexOf('// ---- LIST NAMES END');
if (a < 0 || b < a) { console.error('LIST NAMES markers not found in database-v2.js'); process.exit(1); }
const { personName, rowShowsName } = new Function(src.slice(a, b) + '\nreturn { personName, rowShowsName };')();
let failures = 0;
const check = (ok, label) => { console.log((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) failures++; };

check(personName({ first_name: 'Ana', last_name: 'Cruz' }) === 'Ana Cruz', 'a name from first_name + last_name');
check(personName({ name: 'Ana Cruz', first_name: 'A' }) === 'Ana Cruz', 'a full-name field wins');
check(personName({ firstName: 'Lan', lastName: 'Vo' }) === 'Lan Vo', 'camelCase fields');
check(personName({ id: '1', contact: { first_name: 'Maria', last_name: 'Soto' } }) === 'Maria Soto', 'one object level down');
check(personName({ a: { b: { first_name: 'Deep', last_name: 'Name' } } }) === '', 'no deeper than one level');
check(personName(null) === '' && personName('x') === '' && personName([1]) === '' && personName({ id: 5 }) === '', 'nothing to read gives an empty name');

const row = 'ana cruz  maria soto  high  2 days ago';
check(rowShowsName(row, 'Ana Cruz') && rowShowsName(row, 'MARIA SOTO'), 'a row shows a name it holds, any case');
check(rowShowsName(row, 'Ana Maria Cruz'), 'a middle name on the record is fine (first and last word)');
check(rowShowsName('cruz, ana  soto, maria', 'Ana Cruz'), 'the order "Last, First" is fine');
check(!rowShowsName(row, 'Lan Vo') && !rowShowsName(row, 'Ana') && !rowShowsName(row, ''), 'another name, a one-word name or no name is not shown');

console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
process.exit(failures ? 1 : 0);
