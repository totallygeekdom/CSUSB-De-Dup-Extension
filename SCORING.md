# Dedup scoring

How the Dedup analysis rates a pair of contacts (High, Medium or Low) and the number it records in the database's **Dedup Score** column.
**This file is generated** from the score engine in `Element451-UI-Perfection-v2.user.js` by `node scripts/scoring-chart.js`, and `npm test` fails when it
is out of date, so the numbers below are what runs. To change a number, edit `SCORE_W` / `SCORE_CUT` (or the rating line in `scorePair`) in the userscript, run
`npm run scoring`, and commit both. The reasoning behind the design is in section 10.6 of [`Full-Documentation-v2.md`](Full-Documentation-v2.md).

## Points per field

A field only counts when **both** records have it; a missing field scores 0 and is never held against a pair.

| Field | Match | Mismatch |
|---|---|---|
| Coyote ID | +120 | -120 (hard conflict) |
| CAS ID | +120 | -120 (hard conflict) |
| Date of birth | +40 | -45, not a hard conflict (one typo or a day/month swap: -20) |
| Email | +40 exact; +15 same name part on another domain | 0 (people have several) |
| Phone | +25 | 0 |
| First name | +15 same; +7 nickname, initial or prefix | -30 |
| Last name | +15 same; +7 overlapping | -15 |
| Address (the page's own comparer) | +25 | -3 (people move) |
| Student type, academic level, school attended | +5 each | 0 |
| Name of the other record found in an email address | +6 full name, +3 first initial + last name (capped at +10) | none |
| Birth date found in an email address | +20 full date that matches, +3 birth year | -8 (a full date that disagrees) |
| Bolt's own score | High +20, Medium +8 | Low -5; Bolt says "different people" -25 |
| Applicant with no Coyote ID vs a contact that has one | none | -40 |

There is no twin-pattern rule: first names that differ cost the first-name penalty and nothing more.

## Rating

- **High**: 70+ points and no hard conflict, and either a matching **Coyote ID or CAS ID** (enough on its own) or at least **two strong matches**.
- **Medium**: 45+ points.
- **Low**: everything else. A Low pair under 15 points is described as "probably different people" in the write-up.
- **Strong matches** are: Coyote ID, CAS ID, date of birth, exact email, phone and a matching address.
- **Hard conflict**: two different Coyote IDs or two different CAS IDs. It caps the pair at Low. A different birth date is a heavy penalty, not a hard conflict.

## Sample pairs

Each row is run through the live engine (the Bolt score is not included unless the pair says so). Sorted by rating, then points.

| Pair | Points | Strong matches | Rating |
|---|---|---|---|
| Same Coyote ID + same name | 150 | 1 | **High** |
| Same CAS ID + same name | 150 | 1 | **High** |
| Same name + DOB + email + address, different phones | 135 | 3 | **High** |
| Same DOB + name + address, Bolt High | 115 | 2 | **High** |
| Same name + email + address, Bolt High | 115 | 2 | **High** |
| Same DOB + email + name | 110 | 2 | **High** |
| Same Coyote ID, different first name | 105 | 1 | **High** |
| Same Coyote ID + name, clearly different DOB | 105 | 1 | **High** |
| Same name + phone + address, Bolt High | 100 | 2 | **High** |
| Same DOB + name + address | 95 | 2 | **High** |
| Same DOB + phone + name | 95 | 2 | **High** |
| Jr./Sr. (same name, address, family email, no DOB on file) | 95 | 2 | **High** |
| Same DOB + address, same last name only | 80 | 2 | **High** |
| Same name, email, phone and address, clearly different DOB | 75 | 3 | **High** |
| Same name + DOB + email, applicant vs a contact with a Coyote ID | 70 | 2 | **High** |
| Same name, address and soft fields, Bolt High (nothing else strong) | 90 | 1 | Medium |
| Same DOB + name only | 70 | 1 | Medium |
| Same DOB + address, no names on either record | 65 | 2 | Medium |
| Same name + email + address + soft fields, clearly different DOB | 65 | 2 | Medium |
| Same name + address + DOB, applicant vs a contact with a Coyote ID | 55 | 2 | Medium |
| Twins (same last name, DOB, address; different first name) | 50 | 2 | Medium |
| Siblings (same last name, address, family email; different first name) | 50 | 2 | Medium |
| Jr./Sr. with clearly different DOBs | 50 | 2 | Medium |
| Same name only, Bolt High | 50 | 0 | Medium |
| Parent/child (same phone and address, different names) | 35 | 2 | Low |
| Different Coyote IDs, everything else the same | 15 | 3 | Low |

## Known trade-offs

- **Households.** Twins, siblings and parent/child pairs that share an address land on Medium (see the rows above). Medium is not High, but a slider that includes Medium
  can still auto-apply or auto-merge it; the separate *possible twins* check only stops pairs with two or more conflicting rows. A larger first-name mismatch penalty would push
  them down to Low.
- **Address as a strong match.** It lets a pair with the same name, address and one family-shared email or phone (a Jr./Sr. with no birth date on file) reach High.
  Requiring a birth date or ID for High would stop that.
- **Birth date and address alone.** With no names on either record the pair stays Medium; a last name is enough to reach High.
- **An ID match outweighs a disagreeing birth date.** A matching Coyote ID or CAS ID with the same name is High even when the birth dates are clearly different.
