-- Milestones: a permanent, dated timeline of once-ever events.
--
-- Deliberately NOT a feed and NOT a calendar. Nothing here recurs, nothing
-- expires, and there is no `retention` block in the manifest — a milestone is
-- meant to still be here in fifteen years. Anything that repeats annually
-- belongs in Occasions; anything still to be done belongs in Tasks; anything
-- that repeats seasonally and is worth comparing year over year belongs in
-- Almanac.
--
-- The spine is the MILESTONE, not a person. "We got the keys" and "we planted
-- the oak" are household milestones that belong to nobody in particular, and
-- modelling them as a person named "the house" is the shape this schema exists
-- to avoid. People ATTACH to a milestone, zero or many, through
-- `milestone_people` — so a first day of school shared by two kids is one row
-- with two attachments, not two near-duplicate rows.
--
-- Migrations are additive only: add 002_*.sql, 003_*.sql for later changes.
-- Never DROP/RENAME; the runner applies each version exactly once, in order.
-- This file seeds no rows: app migrations run OUTSIDE the app-db codec, so any
-- literal inserted here would land in an encrypted column as plaintext.

-- Someone a milestone can be about.
--
-- A registry of people this app knows about, NOT a timeline owner. Usually a
-- household member, but it must not have to be: the most common milestone in
-- the whole app — a baby's first steps — belongs to someone who has no account
-- and may not get one for a decade. So `member_id` is optional and `name`
-- always carries the display name. When `member_id` is set the UI prefers the
-- roster's name; when it is empty the columns here are the only source.
CREATE TABLE IF NOT EXISTS app_milestones__people (
  id          TEXT NOT NULL PRIMARY KEY,
  member_id   TEXT NOT NULL DEFAULT '',   -- roster member id, or '' for someone with no account
                                          -- (plaintext: ends in _id)
  name        TEXT NOT NULL,              -- encrypted; the fallback display name
  birth_date  TEXT NOT NULL DEFAULT '',   -- yyyy-mm-dd, or '' if unknown (plaintext: ends in _date)
                                          -- Carried here rather than read from the roster because
                                          -- `birthdate` is stripped from family.members for guests
                                          -- and in shared spaces — and age-at-the-time is the point.
  icon        TEXT NOT NULL DEFAULT '🌱', -- plaintext (built-in column name)
  visibility  TEXT NOT NULL DEFAULT 'everyone',  -- everyone|private (row policy; plaintext)
  archived_at TEXT,                       -- ISO timestamp, set instead of deleting someone
  created_by  TEXT NOT NULL,              -- member id of the author (plaintext: ends in _by)
  created_at  TEXT NOT NULL,              -- ISO timestamp (plaintext)
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS app_milestones__people_member_idx
  ON app_milestones__people (member_id);

-- One thing that happened, once. Belongs to the household; people attach below.
CREATE TABLE IF NOT EXISTS app_milestones__milestones (
  id             TEXT NOT NULL PRIMARY KEY,
  title          TEXT NOT NULL,           -- encrypted; "First steps"
  note           TEXT NOT NULL DEFAULT '',-- encrypted; the story. Empty strings pass through
                                          -- the codec unencrypted, so DEFAULT '' is safe.
  category       TEXT NOT NULL DEFAULT 'other',
                                          -- first|school|health|home|pet|travel|other (plaintext:
                                          -- built-in column name)

  -- The date, and how much of it is actually known.
  --
  -- `occurred_date` is ALWAYS a full yyyy-mm-dd so that ORDER BY, substr() and
  -- the glance keep working: for month precision store the 1st, for year
  -- precision store Jan 1. `date_precision` records how much of it to believe,
  -- and the UI renders "March 2024" or "2024" accordingly.
  --
  -- This is why the glance filters on date_precision = 'day'. Without that
  -- filter every January 1st would light up with every year-precision
  -- milestone the household has ever recorded.
  --
  -- Household-LOCAL date, never date('now'): the :today token the glance binds
  -- is the household's local day, and writes must use the same clock.
  occurred_date  TEXT NOT NULL,           -- plaintext: ends in _date
  date_precision TEXT NOT NULL DEFAULT 'day'
                 CHECK (date_precision IN ('day', 'month', 'year')),
                                          -- compared in the glance's WHERE, so it is declared in
                                          -- the manifest's db_plaintext_columns. CHECK is safe
                                          -- here only because the column is plaintext.

  file_ids       TEXT NOT NULL DEFAULT '[]',  -- JSON array of hub file ids (photos). Purged via
                                              -- delete_file_list_columns; note "_ids" is NOT a
                                              -- plaintext suffix ("_id" is), so this is encrypted
                                              -- at rest and never compared in SQL.
  visibility     TEXT NOT NULL DEFAULT 'everyone',  -- everyone|private (row policy; plaintext)
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- The timeline read, and the "on this day" glance which scans by date.
CREATE INDEX IF NOT EXISTS app_milestones__milestones_date_idx
  ON app_milestones__milestones (occurred_date);

-- Who a milestone is about: zero rows for a household milestone, one per
-- person otherwise.
--
-- Every column here is plaintext by suffix (_id, _by, _at), deliberately: the
-- glance and the AI export both JOIN this table, and the hub's row-policy
-- rewriter fails closed on a governed table reached only through a subquery —
-- so these have to be joinable at the top level, which encrypted keys are not.
CREATE TABLE IF NOT EXISTS app_milestones__milestone_people (
  id           TEXT NOT NULL PRIMARY KEY,
  milestone_id TEXT NOT NULL,             -- FK to milestones.id
  person_id    TEXT NOT NULL,             -- FK to people.id
  written_by   TEXT NOT NULL,             -- member who attached them; the inherit_visibility
                                          -- policy's writer_column, forced hub-side on INSERT
  created_at   TEXT NOT NULL
);

-- One attachment per person per milestone. Safe as a UNIQUE index only because
-- both columns are plaintext — a uniqueness constraint over an encrypted column
-- is dead on arrival, since every row encrypts to different bytes.
CREATE UNIQUE INDEX IF NOT EXISTS app_milestones__milestone_people_pair_idx
  ON app_milestones__milestone_people (milestone_id, person_id);

CREATE INDEX IF NOT EXISTS app_milestones__milestone_people_person_idx
  ON app_milestones__milestone_people (person_id);
