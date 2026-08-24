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

## Two things worth knowing before you change the schema

**Subjects are not always members.** The flagship case — a baby's first steps —
belongs to someone with no account, and possibly no account for a decade. So
`subjects.member_id` is optional and `subjects.name` always carries a fallback.
Subjects also store their own `birth_date`, because the hub strips `birthdate`
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
migrations/001_init.sql subjects + milestones tables
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
