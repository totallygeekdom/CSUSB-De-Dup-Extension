# Dedup scoring

How the Dedup analysis rates a pair of contacts (High, Medium or Low) and the number it records in the database's **Dedup Score** column.
**This file is generated** from the score engine in `Element451-UI-Perfection-v2.user.js` by `node scripts/scoring-chart.js`, and `npm test` fails when it
is out of date, so the numbers below are what runs. To change a number, edit `SCORE_W` / `SCORE_CUT` (or the rating line in `scorePair`) in the userscript, run
`npm run scoring`, and commit both. The reasoning behind the design is in section 10.6 of [`Full-Documentation-v2.md`](Full-Documentation-v2.md).

## Points per field

A field only counts when **both** records have it; a missing field scores 0 and is never held against a pair.

**Strong match** marks the matches that point to one person rather than a household: an ID, the birth date, the exact email, the phone and the address. They are tagged in the
Points view too. They are shown for information only: the rating is the points alone.

| Field | Match | Mismatch | Strong match |
|---|---|---|---|
| Coyote ID (School Id, or the number of a coyote.csusb.edu email) | +120 | -120 (hard conflict; not when one ID comes from an email) | **Yes** |
| CAS ID | +120 | -25, not a hard conflict (a student can have several applications) | **Yes** |
| Date of birth | +40 | -45, not a hard conflict (one typo or a day/month swap: -20) | **Yes** |
| Email | +40 exact; +15 same name part (another domain, or only the numbers differ: maria.soto444 / maria.soto1111) | 0 (people have several) | **Yes** (exact only) |
| Phone | +25 | 0 | **Yes** |
| First name | +15 same; +7 nickname, initial or prefix | -30 |  |
| Last name | +15 same; +7 overlapping | -15 |  |
| Address (the page's own comparer) | +25 | -3 (people move) | **Yes** |
| Student type, academic level, school attended | +5 each | 0 |  |
| Gender | +5 | 0 (it can be missing, updated or entered wrong) |  |
| Name of the other record found in an email address (counted whether or not the names match) | +6 first + last name, +4 first 3+ letters + last name (mar.soto), +3 first initial + last name, +2 first or last name alone (capped at +10 for the pair) | none |  |
| Birth date found in an email address | +20 full date that matches, +3 birth year | -8 (a full date that disagrees) |  |
| Bolt's own score | High +10, Medium +5 | Low -10; Bolt says "different people" -25 |  |
| Applicant with no Coyote ID vs a contact that has one | none | -40 | |

There is no twin-pattern rule: first names that differ cost the first-name penalty and nothing more.

## Rating

- **High**: 70+ points and no hard conflict. The rating is the points alone.
- **Medium**: 45+ points.
- **Low**: everything else. A Low pair under 15 points is described as "probably different people" in the write-up.
- **Hard conflict**: two different Coyote IDs. It caps the pair at Low. Different CAS IDs are a small penalty, not a hard conflict: a student can have several applications. A different birth date is a heavy penalty, not a hard conflict.

## Sample pairs: High and Medium

Each row is run through the live engine (the Bolt score is not included unless the pair says so). Sorted by rating, then points.

| Pair | Points | Rating |
|---|---|---|
| Same Coyote ID + same name | 150 | **High** |
| Same CAS ID + same name | 150 | **High** |
| Same name + DOB + email + address, different phones | 135 | **High** |
| Same DOB + email + name | 110 | **High** |
| Same Coyote ID, different first name | 105 | **High** |
| Same Coyote ID + name, clearly different DOB | 105 | **High** |
| Same DOB + name + address, Bolt High | 105 | **High** |
| Same name + email + address, Bolt High | 105 | **High** |
| Jr./Sr. (same name, address, family email, no DOB on file) | 99 | **High** |
| Same DOB + name + address | 95 | **High** |
| Same DOB + phone + name | 95 | **High** |
| Same name + phone + address, Bolt High | 90 | **High** |
| Same DOB + address, same last name only | 80 | **High** |
| Same name, address and soft fields, Bolt High (nothing else strong) | 80 | **High** |
| Same name, email, phone and address, clearly different DOB | 75 | **High** |
| Same name, a family name put first on one record (Lan Vo / Tran Mai Lan Vo), same DOB | 70 | **High** |
| Same DOB + name only | 70 | **High** |
| Same name + DOB + email, applicant vs a contact with a Coyote ID | 70 | **High** |
| Same DOB + address, no names on either record | 65 | Medium |
| Same name + email + address + soft fields, clearly different DOB | 65 | Medium |
| Same name + address + DOB, applicant vs a contact with a Coyote ID | 55 | Medium |
| Siblings (same last name, address, family email; different first name) | 54 | Medium |
| Jr./Sr. with clearly different DOBs | 54 | Medium |
| Twins (same last name, DOB, address; different first name) | 50 | Medium |
| Same first name, overlapping last names, emails differing only in the numbers (maria.soto444 / maria.soto1111) | 47 | Medium |
| Different CAS IDs, same name and birth date | 45 | Medium |
| Bolt flags "different people", same name + birth date | 45 | Medium |

## Examples of Low scores

A pair is Low under 45 points, or when two IDs disagree. In practice that is a pair with little in common, or with evidence pointing the other way: different names, a different
birth date, a different ID. A single shared fact (the same email, phone, address or birth date) is not enough on its own, because families and roommates share them. The last column shows how the
points add up. Closest to Medium first.

| Pair | Points | How it adds up |
|---|---|---|
| Same name only, Bolt High | 40 | First name +15, Last name +15, Bolt +10 |
| Parent/child (same phone and address, different names) | 35 | Phone +25, First name -30, Last name +15, Address +25 |
| Same name, nothing else known | 30 | First name +15, Last name +15 |
| Siblings: same last name and family email, no shared address | 29 | Email +40, First name -30, Last name +15, Name in email +4 |
| Same name, different address | 27 | First name +15, Last name +15, Address -3 |
| Same name, Bolt says Low | 20 | First name +15, Last name +15, Bolt -10 |
| Different Coyote IDs, everything else the same | 15 | Coyote ID -120, Date of birth +40, Email +40, First name +15, Last name +15, Address +25 (hard conflict: capped at Low) |
| Same name + address, applicant vs a contact with a Coyote ID | 15 | Applicant vs Coyote ID -40, First name +15, Last name +15, Address +25 |
| Same name, birth date one typo apart | 10 | Date of birth -20, First name +15, Last name +15 |
| Same name, different birth date, same address | 10 | Date of birth -45, First name +15, Last name +15, Address +25 |
| Relatives: same last name and address, different first names | 10 | First name -30, Last name +15, Address +25 |
| Same first name only, different last name | 0 | First name +15, Last name -15 |
| Same email only (a shared family email), different names | -3 | Email +40, First name -30, Last name -15, Name in email +2 |
| Same birth date only (a coincidence), different names | -5 | Date of birth +40, First name -30, Last name -15 |
| Same last name only, different first name | -15 | First name -30, Last name +15 |
| Same name, clearly different birth date | -15 | Date of birth -45, First name +15, Last name +15 |
| Same phone only (a family line), different names | -20 | Phone +25, First name -30, Last name -15 |
| Same address only (roommates), different names | -20 | First name -30, Last name -15, Address +25 |
| Same email, different names and different birth dates | -48 | Date of birth -45, Email +40, First name -30, Last name -15, Name in email +2 |
| Completely different people | -93 | Date of birth -45, First name -30, Last name -15, Address -3 |

## Known trade-offs

- **Households.** Twins, siblings and parent/child pairs that share an address land on Medium (see the rows above). Medium is not High, but a slider that includes Medium
  auto-applies and, with When done = Merge, auto-merges them: there is no separate possible-twins check any more, the score alone decides. A larger first-name mismatch penalty
  would push them down to Low.
- **Points only.** High is 70+ points, whatever they come from, so a pair can reach it with no birth date, ID, email or phone: the same name with Bolt High,
  name-based emails, gender and soft fields add up to 80. A Jr./Sr. with the same name, address and a family email or phone (no birth date on file) is High too.
- **Birth date and address alone.** With no names on either record the pair stays Medium (65); a last name is enough to reach High.
- **Bolt's "different people" flag.** It costs -25, which a same name and birth date outweigh: that pair is Medium (see the sample rows), not Low.
- **An ID match outweighs a disagreeing birth date.** A matching Coyote ID or CAS ID with the same name is High even when the birth dates are clearly different.
