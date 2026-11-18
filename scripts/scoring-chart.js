// Writes SCORING.md: the Dedup scoring system as a chart, generated from the score engine in the userscript so it cannot
// drift from what runs. `node scripts/scoring-chart.js` writes the file; `--check` (run by `npm test`) fails when the file
// in the repo differs from what the engine produces, so a weight changed without regenerating the chart is caught.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'Element451-UI-Perfection-v2.user.js'), 'utf8');
const a = src.indexOf('// ---- SCORE ENGINE START'), b = src.indexOf('// ---- SCORE ENGINE END');
if (a < 0 || b < a) { console.error('SCORE ENGINE markers not found in the userscript'); process.exit(1); }
const { scorePair, SCORE_W: W, SCORE_CUT: CUT } = new Function(src.slice(a, b) + '\nreturn { scorePair, SCORE_W, SCORE_CUT };')();

const n = (v) => (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(v);

// ---- sample pairs: [name, side A, side B, extra evidence]
const P = (o) => Object.assign({ emails: [] }, o);
const ana = { first: 'Ana', last: 'Cruz' }, dob = { dob: '2004-01-02' };
const soft = { studentType: 'ftf', level: 'ug', school: 'csusb' };
const SAMPLES = [
  ['Same Coyote ID + same name', P({ ...ana, coyote: '009123456' }), P({ ...ana, coyote: '009123456' })],
  ['Same CAS ID + same name', P({ ...ana, cas: '8812345' }), P({ ...ana, cas: '8812345' })],
  ['Same Coyote ID, different first name', P({ first: 'Andy', last: 'Rios', coyote: '009123456' }), P({ first: 'Andres', last: 'Rios', coyote: '009123456' })],
  ['Same Coyote ID + name, clearly different DOB', P({ ...ana, coyote: '009123456', dob: '2004-01-02' }), P({ ...ana, coyote: '009123456', dob: '1999-07-30' })],
  ['Same name + DOB + email + address, different phones', P({ ...ana, ...dob, emails: ['ana@x.com'], phone: '3105550101' }), P({ ...ana, ...dob, emails: ['ana@x.com'], phone: '9515550199' }), { addrState: 'match' }],
  ['Same DOB + email + name', P({ ...ana, ...dob, emails: ['ana@x.com'] }), P({ ...ana, ...dob, emails: ['ana@x.com'] })],
  ['Same first name, overlapping last names, emails differing only in the numbers (maria.soto444 / maria.soto1111)', P({ first: 'Maria', last: 'Del Rio Soto', emails: ['maria.soto444@gmail.com'] }), P({ first: 'Maria', last: 'Soto', emails: ['maria.soto1111@gmail.com'] })],
  ['Same DOB + name + address, Bolt High', P({ ...ana, ...dob }), P({ ...ana, ...dob }), { addrState: 'match', bolt: { level: 'high' } }],
  ['Same name + email + address, Bolt High', P({ ...ana, emails: ['ana@x.com'] }), P({ ...ana, emails: ['ana@x.com'] }), { addrState: 'match', bolt: { level: 'high' } }],
  ['Same name + phone + address, Bolt High', P({ ...ana, phone: '3105550101' }), P({ ...ana, phone: '3105550101' }), { addrState: 'match', bolt: { level: 'high' } }],
  ['Same DOB + name + address', P({ ...ana, ...dob }), P({ ...ana, ...dob }), { addrState: 'match' }],
  ['Same DOB + phone + name', P({ ...ana, ...dob, phone: '3105550101' }), P({ ...ana, ...dob, phone: '3105550101' })],
  ['Same DOB + address, same last name only', P({ last: 'Cruz', ...dob }), P({ last: 'Cruz', ...dob }), { addrState: 'match' }],
  ['Jr./Sr. (same name, address, family email, no DOB on file)', P({ first: 'Luis', last: 'Soto', emails: ['soto@x.com'] }), P({ first: 'Luis', last: 'Soto', emails: ['soto@x.com'] }), { addrState: 'match' }],
  ['Same DOB + address, no names on either record', P({ ...dob }), P({ ...dob }), { addrState: 'match' }],
  ['Twins (same last name, DOB, address; different first name)', P({ first: 'Ana', last: 'Cruz', ...dob }), P({ first: 'Eva', last: 'Cruz', ...dob }), { addrState: 'match' }],
  ['Siblings (same last name, address, family email; different first name)', P({ first: 'Ana', last: 'Cruz', emails: ['cruz@x.com'] }), P({ first: 'Eva', last: 'Cruz', emails: ['cruz@x.com'] }), { addrState: 'match' }],
  ['Same name, email, phone and address, clearly different DOB', P({ ...ana, dob: '2004-01-02', emails: ['ana@x.com'], phone: '3105550101' }), P({ ...ana, dob: '1999-07-30', emails: ['ana@x.com'], phone: '3105550101' }), { addrState: 'match' }],
  ['Same DOB + name only', P({ ...ana, ...dob }), P({ ...ana, ...dob })],
  ['Same name + DOB + email, applicant vs a contact with a Coyote ID', P({ ...ana, ...dob, emails: ['ana@x.com'], applicant: true }), P({ ...ana, ...dob, emails: ['ana@x.com'], coyote: '009111222' })],
  ['Same name + email + address + soft fields, clearly different DOB', P({ ...ana, dob: '2004-01-02', emails: ['ana@x.com'], ...soft }), P({ ...ana, dob: '1999-07-30', emails: ['ana@x.com'], ...soft }), { addrState: 'match' }],
  ['Parent/child (same phone and address, different names)', P({ first: 'Rosa', last: 'Diaz', phone: '3105550101' }), P({ first: 'Marco', last: 'Diaz', phone: '3105550101' }), { addrState: 'match' }],
  ['Same name, address and soft fields, Bolt High (nothing else strong)', P({ ...ana, ...soft }), P({ ...ana, ...soft }), { addrState: 'match', bolt: { level: 'high' } }],
  ['Same name + address + DOB, applicant vs a contact with a Coyote ID', P({ ...ana, ...dob, applicant: true }), P({ ...ana, ...dob, coyote: '009111222' }), { addrState: 'match' }],
  ['Jr./Sr. with clearly different DOBs', P({ first: 'Luis', last: 'Soto', dob: '1970-05-05', emails: ['soto@x.com'] }), P({ first: 'Luis', last: 'Soto', dob: '2004-02-02', emails: ['soto@x.com'] }), { addrState: 'match' }],
  ['Same name only, Bolt High', P({ ...ana }), P({ ...ana }), { bolt: { level: 'high' } }],
  ['Different Coyote IDs, everything else the same', P({ ...ana, ...dob, coyote: '009111222', emails: ['ana@x.com'] }), P({ ...ana, ...dob, coyote: '009333444', emails: ['ana@x.com'] }), { addrState: 'match' }],
  // pairs that score Low: little in common, or evidence that points the other way
  ['Completely different people', P({ ...ana, ...dob, emails: ['ana@x.com'], phone: '3105550101' }), P({ first: 'Marco', last: 'Diaz', dob: '1999-07-30', emails: ['marco@y.com'], phone: '9515550199' }), { addrState: 'mismatch' }],
  ['Same email, different names and different birth dates', P({ ...ana, ...dob, emails: ['cruz@x.com'] }), P({ first: 'Eva', last: 'Diaz', dob: '1999-07-30', emails: ['cruz@x.com'] })],
  ['Different CAS IDs, same name and birth date', P({ ...ana, ...dob, cas: '8812345' }), P({ ...ana, ...dob, cas: '8899999' })],
  ['Same phone only (a family line), different names', P({ ...ana, phone: '3105550101' }), P({ first: 'Eva', last: 'Diaz', phone: '3105550101' })],
  ['Same address only (roommates), different names', P({ ...ana }), P({ first: 'Eva', last: 'Diaz' }), { addrState: 'match' }],
  ['Same last name only, different first name', P({ first: 'Ana', last: 'Cruz' }), P({ first: 'Eva', last: 'Cruz' })],
  ['Same first name only, different last name', P({ first: 'Ana', last: 'Cruz' }), P({ first: 'Ana', last: 'Diaz' })],
  ['Same name, clearly different birth date', P({ ...ana, dob: '2004-01-02' }), P({ ...ana, dob: '1999-07-30' })],
  ['Same email only (a shared family email), different names', P({ ...ana, emails: ['cruz@x.com'] }), P({ first: 'Eva', last: 'Diaz', emails: ['cruz@x.com'] })],
  ['Same birth date only (a coincidence), different names', P({ ...ana, ...dob }), P({ first: 'Eva', last: 'Diaz', ...dob })],
  ['Same name, birth date one typo apart', P({ ...ana, dob: '2004-01-02' }), P({ ...ana, dob: '2004-01-12' })],
  ['Same name, different birth date, same address', P({ ...ana, dob: '2004-01-02' }), P({ ...ana, dob: '1999-07-30' }), { addrState: 'match' }],
  ['Relatives: same last name and address, different first names', P({ first: 'Ana', last: 'Cruz' }), P({ first: 'Eva', last: 'Cruz' }), { addrState: 'match' }],
  ['Same name + address, applicant vs a contact with a Coyote ID', P({ ...ana, applicant: true }), P({ ...ana, coyote: '009111222' }), { addrState: 'match' }],
  ['Same name, Bolt says Low', P({ ...ana }), P({ ...ana }), { bolt: { level: 'low' } }],
  ['Siblings: same last name and family email, no shared address', P({ first: 'Ana', last: 'Cruz', emails: ['cruz@x.com'] }), P({ first: 'Eva', last: 'Cruz', emails: ['cruz@x.com'] })],
  ['Same name, different address', P({ ...ana }), P({ ...ana }), { addrState: 'mismatch' }],
  ['Same name, nothing else known', P({ ...ana }), P({ ...ana })],
  ['Bolt flags "different people", same name + birth date', P({ ...ana, ...dob }), P({ ...ana, ...dob }), { bolt: { different: true } }]
];
const ORDER = { high: 0, medium: 1, low: 2 };
const rows = SAMPLES.map(([name, A, B, ev]) => ({ name, r: scorePair(Object.assign({ A, B, bolt: {} }, ev || {})) }))
  .sort((x, y) => ORDER[x.r.level] - ORDER[y.r.level] || y.r.points - x.r.points);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const top = rows.filter(x => x.r.level !== 'low'), low = rows.filter(x => x.r.level === 'low');
// how the points add up, from the engine's own reasons (information-only reasons that score 0 are left out)
const adds = (r) => r.items.filter(i => i.pts !== 0).map(i => i.label + ' ' + n(i.pts)).join(', ') + (r.hard ? ' (hard conflict: capped at Low)' : '');

const md = `# Dedup scoring

How the Dedup analysis rates a pair of contacts (High, Medium or Low) and the number it records in the database's **Dedup Score** column.
**This file is generated** from the score engine in \`Element451-UI-Perfection-v2.user.js\` by \`node scripts/scoring-chart.js\`, and \`npm test\` fails when it
is out of date, so the numbers below are what runs. To change a number, edit \`SCORE_W\` / \`SCORE_CUT\` (or the rating line in \`scorePair\`) in the userscript, run
\`npm run scoring\`, and commit both. The reasoning behind the design is in section 10.6 of [\`Full-Documentation-v2.md\`](Full-Documentation-v2.md).

## Points per field

A field only counts when **both** records have it; a missing field scores 0 and is never held against a pair.

| Field | Match | Mismatch |
|---|---|---|
| Coyote ID | ${n(W.coyote[0])} | ${n(W.coyote[1])} (hard conflict) |
| CAS ID | ${n(W.cas[0])} | ${n(W.cas[1])}, not a hard conflict (a student can have several applications) |
| Date of birth | ${n(W.dob[0])} | ${n(W.dob[1])}, not a hard conflict (one typo or a day/month swap: ${n(W.dobTypo[1])}) |
| Email | ${n(W.email[0])} exact; ${n(W.emailName[0])} same name part (another domain, or only the numbers differ: maria.soto444 / maria.soto1111) | ${n(0)} (people have several) |
| Phone | ${n(W.phone[0])} | ${n(0)} |
| First name | ${n(W.first[0])} same; ${n(W.firstRelated[0])} nickname, initial or prefix | ${n(W.first[1])} |
| Last name | ${n(W.last[0])} same; ${n(W.lastPartial[0])} overlapping | ${n(W.last[1])} |
| Address (the page's own comparer) | ${n(W.address[0])} | ${n(W.address[1])} (people move) |
| Student type, academic level, school attended | ${n(W.soft[0])} each | ${n(0)} |
| Gender | ${n(W.gender[0])} | ${n(W.gender[1])} (it can be missing, updated or entered wrong) |
| Name of the other record found in an email address (counted whether or not the names match) | ${n(W.emailNameFull)} first + last name, ${n(W.emailNamePartial)} first 3+ letters + last name (mar.soto), ${n(W.emailNameInitial)} first initial + last name, ${n(W.emailNameOne)} first or last name alone (capped at ${n(W.emailNameCap)} for the pair) | none |
| Birth date found in an email address | ${n(W.emailDobFull)} full date that matches, ${n(W.emailDobYear)} birth year | ${n(W.emailDobConflict)} (a full date that disagrees) |
| Bolt's own score | High ${n(W.boltHigh)}, Medium ${n(W.boltMedium)} | Low ${n(W.boltLow)}; Bolt says "different people" ${n(W.boltDifferent)} |
| Applicant with no Coyote ID vs a contact that has one | none | ${n(W.applicantVsCoyote)} |

There is no twin-pattern rule: first names that differ cost the first-name penalty and nothing more.

## Rating

- **High**: ${CUT.high}+ points and no hard conflict, and either a matching **Coyote ID or CAS ID** (enough on its own) or at least **two strong matches**.
- **Medium**: ${CUT.medium}+ points.
- **Low**: everything else. A Low pair under ${CUT.low} points is described as "probably different people" in the write-up.
- **Strong matches** are: Coyote ID, CAS ID, date of birth, exact email, phone and a matching address.
- **Hard conflict**: two different Coyote IDs. It caps the pair at Low. Different CAS IDs are a small penalty, not a hard conflict: a student can have several applications. A different birth date is a heavy penalty, not a hard conflict.

## Sample pairs: High and Medium

Each row is run through the live engine (the Bolt score is not included unless the pair says so). Sorted by rating, then points.

| Pair | Points | Strong matches | Rating |
|---|---|---|---|
${top.map(x => `| ${x.name} | ${x.r.points} | ${x.r.strong} | ${x.r.level === 'high' ? '**High**' : cap(x.r.level)} |`).join('\n')}

## Examples of Low scores

A pair is Low under ${CUT.medium} points, or when two IDs disagree. In practice that is a pair with little in common, or with evidence pointing the other way: different names, a different
birth date, a different ID. A single shared fact (the same email, phone, address or birth date) is not enough on its own, because families and roommates share them. The last column shows how the
points add up. Closest to Medium first.

| Pair | Points | How it adds up |
|---|---|---|
${low.map(x => `| ${x.name} | ${x.r.points} | ${adds(x.r)} |`).join('\n')}

## Known trade-offs

- **Households.** Twins, siblings and parent/child pairs that share an address land on Medium (see the rows above). Medium is not High, but a slider that includes Medium
  can still auto-apply or auto-merge it; the separate *possible twins* check only stops pairs with two or more conflicting rows. A larger first-name mismatch penalty would push
  them down to Low.
- **Address as a strong match.** It lets a pair with the same name, address and one family-shared email or phone (a Jr./Sr. with no birth date on file) reach High.
  Requiring a birth date or ID for High would stop that.
- **Birth date and address alone.** With no names on either record the pair stays Medium; a last name is enough to reach High.
- **Bolt's "different people" flag.** It costs ${n(W.boltDifferent)}, which a same name and birth date outweigh: that pair is Medium (see the sample rows), not Low.
- **An ID match outweighs a disagreeing birth date.** A matching Coyote ID or CAS ID with the same name is High even when the birth dates are clearly different.
`;
const file = path.join(ROOT, 'SCORING.md');
if (process.argv.includes('--check')) {
  const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (have !== md) { console.error('SCORING.md is out of date with the score engine. Run: npm run scoring'); process.exit(1); }
  console.log('SCORING.md matches the score engine');
} else {
  fs.writeFileSync(file, md);
  console.log('Wrote SCORING.md (' + rows.length + ' sample pairs)');
}
