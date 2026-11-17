// Tests the Dedup score engine on its own (no browser): the block between the SCORE ENGINE START / END markers in
// Element451-UI-Perfection-v2.user.js is pure (evidence in, points and rating out), so it runs in Node as it is.
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'Element451-UI-Perfection-v2.user.js'), 'utf8');
const a = src.indexOf('// ---- SCORE ENGINE START'), b = src.indexOf('// ---- SCORE ENGINE END');
if (a < 0 || b < a) { console.error('SCORE ENGINE markers not found in the userscript'); process.exit(1); }
const { scorePair, SCORE_W } = new Function(src.slice(a, b) + '\nreturn { scorePair, SCORE_W };')();

let failures = 0;
const check = (ok, label) => { console.log((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) failures++; };
const side = (o) => Object.assign({ emails: [] }, o);
const score = (A, B, ev) => scorePair(Object.assign({ A: side(A), B: side(B), bolt: {} }, ev || {}));
const pts = (r, key) => { const i = r.items.find(x => x.key === key); return i ? i.pts : null; };
const person = { first: 'Ana', last: 'Cruz' };

// weights
check(SCORE_W.address[0] === 25 && pts(score(person, person, { addrState: 'match' }), 'address') === 25, 'a matching address is +25');
check(SCORE_W.address[1] === -3, 'a different address is still -3 (people move)');
const soft = { studentType: 'ftf', level: 'ug', school: 'csusb' };
check(['studentType', 'level', 'school'].every(k => pts(score({ ...person, ...soft }, { ...person, ...soft }), k) === 5), 'student type, academic level and school attended are +5 each');
check(pts(score({ ...person, applicant: true }, { ...person, coyote: '009111222' }), 'appCoyote') === -40, 'an applicant against a contact with a Coyote ID is -40');

// a different birth date is a heavy penalty, not a veto
const dobDiff = score({ ...person, dob: '2004-01-02', emails: ['ana@x.com'], phone: '3105550101' }, { ...person, dob: '1999-07-30', emails: ['ana@x.com'], phone: '3105550101' }, { addrState: 'match' });
check(pts(dobDiff, 'dob') === -45 && dobDiff.hard === false, 'a clearly different birth date is -45 and is not a hard conflict');
check(dobDiff.level === 'medium', 'it no longer caps the pair at Low: same name, email, phone and address with a different birth date is Medium (' + dobDiff.points + ' pts)');
check(score({ ...person, dob: '2004-01-02' }, { ...person, dob: '2004-01-12' }).hard === false && pts(score({ ...person, dob: '2004-01-02' }, { ...person, dob: '2004-01-12' }), 'dob') === -20, 'a birth date one typo apart is -20 and not hard');
// different IDs are still a veto
const ids = score({ ...person, coyote: '009111222', dob: '2004-01-02' }, { ...person, coyote: '009333444', dob: '2004-01-02' }, { addrState: 'match' });
check(ids.hard === true && ids.level === 'low', 'different Coyote IDs are still a hard conflict that caps the pair at Low');

// the twin pattern is gone: first names that differ cost only the first-name penalty
const twins = score({ first: 'Ana', last: 'Cruz', dob: '2004-01-02' }, { first: 'Eva', last: 'Cruz', dob: '2004-01-02' }, { addrState: 'match' });
check(!twins.items.some(i => i.key === 'twins') && twins.points === 40 + 8 - 12 + 25, 'no twin penalty: same last name, birth date and address with different first names is just 40 + 8 - 12 + 25 = ' + twins.points);

// a matching Coyote ID or CAS ID is enough for High on its own
check(score({ ...person, coyote: '009123456' }, { ...person, coyote: '009123456' }).level === 'high', 'the same Coyote ID and the same name is High');
check(score({ ...person, cas: '8812345' }, { ...person, cas: '8812345' }).level === 'high', 'the same CAS ID and the same name is High');
check(score({ first: 'Andy', last: 'Rios', coyote: '009123456' }, { first: 'Andres', last: 'Rios', coyote: '009123456' }).level === 'high', 'the same Coyote ID with a different first name is High');
const idDob = score({ ...person, coyote: '009123456', dob: '2004-01-02' }, { ...person, coyote: '009123456', dob: '1999-07-30' });
check(idDob.points === 70 && idDob.level === 'high', 'the same Coyote ID and name with a clearly different birth date lands exactly on High (100 + 15 - 45 = ' + idDob.points + ' pts): a deliberate edge, change it on purpose');
check(score({ ...person, coyote: '009123456' }, { ...person, coyote: '009999999' }).level === 'low', 'different Coyote IDs are still Low');
// other evidence still needs two strong matches for High
check(score({ ...person, dob: '2004-01-02' }, { ...person, dob: '2004-01-02' }, { addrState: 'match', bolt: { level: 'high' } }).level === 'medium', 'a single non-ID strong match (birth date) with 100 points is still Medium');
// High still needs 70 points and two strong matches; weak fields alone never reach it
const strong2 = score({ ...person, dob: '2004-01-02', phone: '3105550101' }, { ...person, dob: '2004-01-02', phone: '3105550101' });
check(strong2.level === 'high', 'same birth date, phone and name is High (' + strong2.points + ' pts)');
const weak = score({ ...person, ...soft, emails: ['ana.cruz@y.com'] }, { ...person, ...soft, emails: ['cruz.ana@z.com'] }, { addrState: 'match', bolt: { level: 'high' } });
check(weak.strong === 0 && weak.level !== 'high', 'name, address, soft fields and Bolt High without a strong match is never High (' + weak.points + ' pts)');
console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
process.exit(failures ? 1 : 0);
