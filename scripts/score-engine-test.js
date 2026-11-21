// Tests the Dedup score engine on its own (no browser): the block between the SCORE ENGINE START / END markers in
// Element451-UI-Perfection-v2.user.js is pure (evidence in, points and rating out), so it runs in Node as it is.
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'Element451-UI-Perfection-v2.user.js'), 'utf8');
const a = src.indexOf('// ---- SCORE ENGINE START'), b = src.indexOf('// ---- SCORE ENGINE END');
if (a < 0 || b < a) { console.error('SCORE ENGINE markers not found in the userscript'); process.exit(1); }
const load = (text) => new Function(text + '\nreturn { scorePair, SCORE_W, scoreSlots, slotsToString, slotsFromString };')();
const { scorePair, SCORE_W, scoreSlots, slotsToString, slotsFromString } = load(src.slice(a, b));

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
check(pts(score({ ...person, coyote: '009123456' }, { ...person, coyote: '009123456' }), 'coyote') === 120 && pts(score({ ...person, cas: '8812345' }, { ...person, cas: '8812345' }), 'cas') === 120 && pts(score({ ...person, coyote: '1' + '23456' }, { ...person, coyote: '654321' }), 'coyote') === -120 && pts(score({ ...person, cas: '123456' }, { ...person, cas: '654321' }), 'cas') === -18, 'a matching Coyote ID or CAS ID is +120; different Coyote IDs are -120, different CAS IDs -18');
const casDiff = score({ ...person, dob: '2004-01-02' }, { ...person, dob: '2004-01-02', cas: '654321' }), casDiff2 = score({ ...person, dob: '2004-01-02', cas: '123456' }, { ...person, dob: '2004-01-02', cas: '654321' });
check(casDiff2.hard === false && casDiff2.level === 'medium', 'different CAS IDs are not a hard conflict (a student can have several applications): same name and birth date stays Medium (' + casDiff2.points + ')');
check(casDiff.items.every(i => i.key !== 'cas'), 'a CAS ID on one side only is not compared');
check(!score({ ...person, gender: 'Female' }, { ...person, gender: 'Female' }).items.some(x => x.key === 'gender') && !('gender' in SCORE_W), 'gender is not scored');
check(scoreSlots({ 'last.0': 1, 'gender.0': 1 }).points === scoreSlots({ 'last.0': 1 }).points, 'a remembered rating that holds a gender slot is re-rated without it');
const viaMail = score({ ...person, coyote: '009000001' }, { ...person, coyote: '009000001', coyoteFrom: 'email' }), viaMailOff = score({ ...person, coyote: '009000001' }, { ...person, coyote: '009999999', coyoteFrom: 'email' });
check(pts(viaMail, 'coyote') === 120 && viaMail.level === 'high' && pts(viaMailOff, 'coyote') === null && viaMailOff.hard === false, 'a Coyote ID read from a coyote.csusb.edu email confirms (+120) but never makes a hard conflict');
const within = score({ ...person, first: 'Lan', last: 'Vo' }, { ...person, first: 'Tran Mai Lan', last: 'Vo' });
check(pts(within, 'first') === 15 && pts(score({ ...person, first: 'Mai Lan' }, { ...person, first: 'Mai Linh' }), 'first') === -30, 'a first name inside the other word for word (Lan / Tran Mai Lan) is the same first name; Mai Lan / Mai Linh still differ');
check(pts(score({ ...person, applicant: true }, { ...person, coyote: '009111222' }), 'appCoyote') === -40, 'an applicant against a contact with a Coyote ID is -40');

// a different birth date is a heavy penalty, not a veto
const dobDiff = score({ ...person, dob: '2004-01-02', emails: ['ana@x.com'], phone: '3105550101' }, { ...person, dob: '1999-07-30', emails: ['ana@x.com'], phone: '3105550101' }, { addrState: 'match' });
check(pts(dobDiff, 'dob') === -45 && dobDiff.hard === false, 'a clearly different birth date is -45 and is not a hard conflict');
check(dobDiff.level !== 'low', 'it no longer caps the pair at Low: same name, email, phone and address with a different birth date is ' + dobDiff.level + ' (' + dobDiff.points + ' pts)');
check(score({ ...person, dob: '2004-01-02' }, { ...person, dob: '2004-01-12' }).hard === false && pts(score({ ...person, dob: '2004-01-02' }, { ...person, dob: '2004-01-12' }), 'dob') === -20, 'a birth date one typo apart is -20 and not hard');
// different IDs are still a veto
const ids = score({ ...person, coyote: '009111222', dob: '2004-01-02' }, { ...person, coyote: '009333444', dob: '2004-01-02' }, { addrState: 'match' });
check(ids.hard === true && ids.level === 'low', 'different Coyote IDs are still a hard conflict that caps the pair at Low');

// the twin rule: different first names, so the shared last name gives 0 and the same address and birth date -30 each
const twins = score({ first: 'Ana', last: 'Cruz', dob: '2004-01-02' }, { first: 'Eva', last: 'Cruz', dob: '2004-01-02' }, { addrState: 'match' });
check(twins.twins && twins.points === SCORE_W.first[1] + SCORE_W.twinLast + SCORE_W.twinAddress + SCORE_W.twinDob && twins.level === 'low', 'twins (Ana / Eva Cruz, same birth date and address): ' + SCORE_W.first[1] + ' + ' + SCORE_W.twinLast + ' ' + SCORE_W.twinAddress + ' ' + SCORE_W.twinDob + ' = ' + twins.points + ', Low, Twins? chip');
const rhyme = score({ first: 'Kayla', last: 'Soto', dob: '2004-01-02' }, { first: 'Layla', last: 'Soto', dob: '2004-01-02' });
check(rhyme.twins && rhyme.level === 'low', 'rhyming first names (Kayla / Layla) count as different: twin rule, Low (' + rhyme.points + ' pts)');
const sibs = score({ first: 'Ana', last: 'Cruz', dob: '2004-01-02' }, { first: 'Eva', last: 'Cruz', dob: '2001-05-06' }, { addrState: 'match' });
check(sibs.points === SCORE_W.first[1] + SCORE_W.twinLast + SCORE_W.twinAddress + SCORE_W.dob[1], 'siblings (different birth dates, same address): ' + sibs.points + ' pts');
const nick = score({ first: 'Robert', last: 'Soto', dob: '2004-01-02' }, { first: 'Bob', last: 'Soto', dob: '2004-01-02' }, { addrState: 'match' });
check(!nick.twins && nick.level === 'high', 'a nickname (Robert / Bob) still matches: no twin rule, High (' + nick.points + ' pts)');
const mid = score({ first: 'Maria', last: 'Soto', dob: '2004-01-02' }, { first: 'Maria Elena', last: 'Soto', dob: '2004-01-02' }, { addrState: 'match' });
check(!mid.twins && mid.level === 'high', 'a middle name added (Maria / Maria Elena) still matches: no twin rule, High (' + mid.points + ' pts)');
const twinId = score({ first: 'Andy', last: 'Rios', coyote: '009123456', dob: '2004-01-02' }, { first: 'Luis', last: 'Rios', coyote: '009123456', dob: '2004-01-02' }, { addrState: 'match' });
check(!twinId.twins && twinId.level === 'high', 'a matching Coyote ID turns the twin rule off (' + twinId.points + ' pts)');
const twinCas = score({ first: 'Andy', last: 'Rios', cas: '8812345', dob: '2004-01-02' }, { first: 'Luis', last: 'Rios', cas: '8812345', dob: '2004-01-02' });
check(!twinCas.twins, 'a matching CAS ID turns the twin rule off');
// a rating remembered before the twin rule is re-rated under it
const oldSlots = { 'first.1': 1, 'last.0': 1, 'address.0': 1, 'dob.0': 1 };
check(scoreSlots(oldSlots).points === twins.points, 'a remembered rating from before the twin rule is re-rated under it (' + scoreSlots(oldSlots).points + ' pts)');
check(scoreSlots({ 'first.1': 1, 'coyote.0': 1, 'dob.0': 1 }).points === SCORE_W.first[1] + SCORE_W.coyote[0] + SCORE_W.dob[0], 'and not when an ID matched');

// a matching Coyote ID or CAS ID is enough for High on its own
check(score({ ...person, coyote: '009123456' }, { ...person, coyote: '009123456' }).level === 'high', 'the same Coyote ID and the same name is High');
check(score({ ...person, cas: '8812345' }, { ...person, cas: '8812345' }).level === 'high', 'the same CAS ID and the same name is High');
check(score({ first: 'Andy', last: 'Rios', coyote: '009123456' }, { first: 'Andres', last: 'Rios', coyote: '009123456' }).level === 'high', 'the same Coyote ID with a different first name is High');
const idDob = score({ ...person, coyote: '009123456', dob: '2004-01-02' }, { ...person, coyote: '009123456', dob: '1999-07-30' });
check(idDob.points === 105 && idDob.level === 'high', 'the same Coyote ID and name with a clearly different birth date is High (120 + 15 + 15 - 45 = ' + idDob.points + ' pts): an ID match outweighs a birth date that disagrees; change it on purpose');
check(score({ ...person, coyote: '009123456' }, { ...person, coyote: '009999999' }).level === 'low', 'different Coyote IDs are still Low');
// the rating is the points alone: 70+ is High whatever the evidence
const dobBolt = score({ ...person, dob: '2004-01-02' }, { ...person, dob: '2004-01-02' }, { bolt: { level: 'high' } });
check(dobBolt.level === 'high', 'the same birth date and name with Bolt High is High (' + dobBolt.points + ' points; no second strong match needed)');
check(score({ ...person, dob: '2004-01-02' }, { ...person, dob: '2004-01-02' }).level === 'high', 'the same birth date and name is High (70 points)');
// a matching address is a strong match, so with one other strong match and 70 points the pair is High
check(score({ ...person, dob: '2004-01-02' }, { ...person, dob: '2004-01-02' }, { addrState: 'match' }).level === 'high', 'the same birth date, name and address is High (80 pts)');
check(score({ ...person, dob: '2004-01-02' }, { ...person, dob: '2004-01-02' }, { addrState: 'match', bolt: { level: 'high' } }).level === 'high', 'the same birth date, name and address with Bolt High is High (100 pts)');
check(score({ ...person, emails: ['ana@x.com'] }, { ...person, emails: ['ana@x.com'] }, { addrState: 'match', bolt: { level: 'high' } }).level === 'high', 'the same name, email and address with Bolt High is High (100 pts)');
check(score({ ...person, phone: '3105550101' }, { ...person, phone: '3105550101' }, { addrState: 'match', bolt: { level: 'high' } }).level === 'high', 'the same name, phone and address with Bolt High is High (85 pts)');
// households that share an address: the twin rule puts them on Low
check(score({ first: 'Ana', last: 'Cruz', dob: '2004-01-02' }, { first: 'Eva', last: 'Cruz', dob: '2004-01-02' }, { addrState: 'match' }).level === 'low', 'twins (same last name, birth date and address, different first name) are Low');
const famMail = score({ first: 'Ana', last: 'Cruz', emails: ['cruz@x.com'] }, { first: 'Eva', last: 'Cruz', emails: ['cruz@x.com'] }, { addrState: 'match' });
check(famMail.level === 'low', 'siblings (same last name, address and family email) are Low (' + famMail.points + ' pts)');
check(score({ first: 'Rosa', last: 'Diaz', phone: '3105550101' }, { first: 'Marco', last: 'Diaz', phone: '3105550101' }, { addrState: 'match' }).level === 'low', 'parent and child (same phone and address, different names) are Low (35 pts)');
// points only: 70+ is High, 45-69 Medium
const strong2 = score({ ...person, dob: '2004-01-02', phone: '3105550101' }, { ...person, dob: '2004-01-02', phone: '3105550101' });
check(strong2.level === 'high', 'same birth date, phone and name is High (' + strong2.points + ' pts)');
const weak = score({ ...person, ...soft, emails: ['ana.cruz@y.com'] }, { ...person, ...soft, emails: ['cruz.ana@z.com'] }, { addrState: 'match', bolt: { level: 'high' } });
check(weak.points >= 70 && weak.level === 'high', 'name, address, soft fields and Bolt High is High on its points (' + weak.points + ')');
const softBolt = score({ ...person, ...soft }, { ...person, ...soft }, { bolt: { level: 'high' } });
check(softBolt.points >= 45 && softBolt.points < 70 && softBolt.level === 'medium', 'name, soft fields and Bolt High (' + softBolt.points + ' points) is Medium');
// a failed Bolt analysis (its chip reads Error) is a small negative, never a stop
const errRes = score({ ...person, ...soft }, { ...person, ...soft }, { bolt: { level: null, error: true } });
const noErr = score({ ...person, ...soft }, { ...person, ...soft }, {});
check(SCORE_W.boltError === -5 && pts(errRes, 'bolt') === -5 && errRes.points === noErr.points - 5, 'a Bolt error counts -5 (' + errRes.points + ' vs ' + noErr.points + ')');
check(pts(score({ ...person }, { ...person }, { bolt: { level: 'high', error: true } }), 'bolt') === 10, 'a Bolt level wins over the error flag');
check(SCORE_W.boltHigh === 10 && SCORE_W.boltMedium === 5 && SCORE_W.boltLow === -10, "Bolt's own score: High +10, Medium +5, Low -10");

// the rating as data: the slots that applied are remembered and re-rated with whatever weights are in force
const pairs = [
  ['same DOB + name + address', score({ ...person, dob: '2004-01-02' }, { ...person, dob: '2004-01-02' }, { addrState: 'match' })],
  ['Coyote ID + name', score({ ...person, coyote: '009123456' }, { ...person, coyote: '009123456' })],
  ['different Coyote IDs', score({ ...person, coyote: '1' }, { ...person, coyote: '2' })],
  ['different DOB, nickname, soft fields, Bolt Low', score({ first: 'Mike', last: 'Lee', dob: '2004-01-02', ...soft }, { first: 'Michael', last: 'Lee', dob: '1999-07-30', ...soft }, { bolt: { level: 'low' } })],
  ['name hidden in two emails (capped) and a birth date in an email', score({ first: 'Ann', last: 'Lee', emails: ['eva.cruz@x.com', 'evacruz1@x.com', 'x010204@x.com'] }, { first: 'Eva', last: 'Cruz', dob: '2004-01-02', emails: ['q@y.com'] })],
  ['phone + email + Bolt "different people"', score({ ...person, phone: '3105550101', emails: ['ana@x.com'] }, { ...person, phone: '3105550101', emails: ['ana@x.com'] }, { bolt: { level: 'high', different: true } })],
  ['nothing to compare', score({}, {})]
];
pairs.forEach(([name, r]) => {
  const again = scoreSlots(slotsFromString(slotsToString(r.slots)));
  const itemSum = r.items.reduce((t, i) => t + i.pts, 0);
  check(again && again.points === r.points && again.level === r.level && again.hard === r.hard && again.strong === r.strong && itemSum === r.points,
    'slots round trip and agree with the items: ' + name + ' (' + r.points + ' pts, ' + r.level + ', "' + slotsToString(r.slots) + '")');
});
// a remembered pair follows a weight change: the same slots, rated by an engine whose address weight is lower
const remembered = slotsToString(pairs[0][1].slots);
const other = load(src.slice(a, b).replace('high: 70,', 'high: 100,'));
check(pairs[0][1].level === 'high' && other.scoreSlots(slotsFromString(remembered)).level === 'medium', 'the same remembered slots re-rate under changed rules (High cutoff 70 -> 100: High -> Medium)');
const slotText = slotsToString(pairs[0][1].slots);
check(!/[A-Za-z]{6,}\.?\d?/.test(slotText.replace(/[a-z]+\.\d|[A-Za-z]+(?=,|$|\*)/g, '')) && !/ana|cruz|2004|@/i.test(slotText), 'the remembered text holds no names, dates or contact details: "' + slotText + '"');
check(scoreSlots({ 'dob.0': 1, 'retiredRule.0': 1 }) === null && slotsFromString('dob.0,,x') === null && slotsFromString(undefined) === null, 'an unknown slot or a malformed text is not rated (so the chip reads Pending)');
// Bolt saying "different people" takes back its High / Medium bonus (only the -10 penalty is left)
{
  const base = score({ ...person }, { ...person }, { bolt: { level: 'medium' } });
  const diff = score({ ...person }, { ...person }, { bolt: { level: 'medium', different: true } });
  const diffHigh = score({ ...person }, { ...person }, { bolt: { level: 'high', different: true } });
  check(pts(base, 'bolt') === SCORE_W.boltMedium, 'Bolt Medium alone is +' + SCORE_W.boltMedium);
  check(!diff.items.some(i => i.key === 'bolt') && pts(diff, 'boltDifferent') === SCORE_W.boltDifferent, 'Bolt Medium + "different people": no Medium bonus, only ' + SCORE_W.boltDifferent);
  check(!diffHigh.items.some(i => i.key === 'bolt') && diff.points === base.points - SCORE_W.boltMedium + SCORE_W.boltDifferent, 'the points are the same with or without the bonus plus the penalty (' + diff.points + ')');
}

console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
process.exit(failures ? 1 : 0);
