# Milestones

A Chickadee Bandit app: a permanent, dated timeline of the things that happen
once — first steps, first word, first day of school, the day the dog came home,
the day we got the keys.

## What belongs here (and what doesn't)

Milestones is deliberately narrow, because three neighbouring apps already
cover the other shapes:

| Shape | App |
| --- | --- |
| Something still to be done | **Tasks** / **Home Maintenance** |
| Recurs every year, and you want the countdown | **Occasions** |
| Recurs every season, and you want the year-over-year drift | **Almanac** |
| **Happened once, has a date, is kept for good** | **Milestones** |

Almanac in particular is *not* the place for a one-off: its model is one
observation row **per year** per recurring event type, and its glance only fires
on "same day, earlier year". A single observation there returns nothing the app
is built to give.

## Three things worth knowing before you change the schema

**The milestone is the spine, not a person.** "We got the keys" and "we planted
the oak" are about the household and nobody in particular; modelling them as a
person named *the house* is the shape this schema exists to avoid. People attach
to a milestone through `milestone_people`, zero or many — so a first day of
school two siblings shared is one row with two attachments, each aged
separately, rather than two near-duplicate rows.

A milestone with no attachments is a household milestone and always shows. One
that names only archived people is hidden, which is what archiving is for — the
glance says the same thing as `HAVING COUNT(mp.id) = 0 OR COUNT(p.id) > 0`, and
`isVisibleMilestone()` mirrors it client-side.

Every column of `milestone_people` is plaintext by suffix (`_id`, `_by`, `_at`)
on purpose: the glance and the AI export both JOIN it, the row-policy rewriter
fails closed on a governed table reached only through a subquery, and encrypted
keys cannot be joined or made UNIQUE. For the same reason the glance's subtitle
never concatenates names — `decryptAppRows` decrypts by *value*, so a
`group_concat` of two encrypted names is no longer a ciphertext and would render
raw bytes on the card.

**People are not always members.** The flagship case — a baby's first steps —
belongs to someone with no account, and possibly no account for a decade. So
`people.member_id` is optional and `people.name` always carries a fallback.
People also store their own `birth_date`, because the hub strips `birthdate`
from `family.members` for guests and inside shared spaces — and age-at-the-time
is the whole point of the timeline.

**Dates carry a precision.** Nobody knows the day of a first word. `occurred_date`
is always a full `yyyy-mm-dd` so SQL can sort and `substr` it (month precision
anchors to the 1st, year precision to Jan 1), and `date_precision` says how much
of it to believe. Consequently **anything that matches on month-and-day must
filter `date_precision = 'day'`** — the manifest's glance does, and so does
`onThisDay()` in `src/logic.js`. Without it, every January 1st surfaces every
year-precision milestone the household has ever recorded.

## Layout

```
manifest.json           app declaration (row policies, glance, events, file purge)
migrations/001_init.sql milestones + people + the milestone_people join
src/index.html          the whole UI
src/logic.js            pure logic — dates, ages, gates, ordering (unit tested)
src/shared.js           test-side mirrors of the hub-sdk helpers logic.js uses
src/queries/            named SQL for `ai_access.db_exports`
__tests__/              vitest
```

## Development

```bash
make setup     # once, to enable the pre-push hook (build + tests)
npm install
npm test
npm run dev    # local dev server with a stubbed hub
npm run build  # writes dist/bundle.json
```
