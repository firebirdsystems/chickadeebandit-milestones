-- Milestones: a permanent, dated, per-subject timeline of once-ever events.
--
-- Deliberately NOT a feed and NOT a calendar. Nothing here recurs, nothing
-- expires, and there is no `retention` block in the manifest — a milestone is
-- meant to still be here in fifteen years. Anything that repeats annually
-- belongs in Occasions; anything still to be done belongs in Tasks; anything
-- that repeats seasonally and is worth comparing year over year belongs in
-- Almanac.
--
-- Migrations are additive only: add 002_*.sql, 003_*.sql for later changes.
-- Never DROP/RENAME; the runner applies each version exactly once, in order.
-- This file seeds no rows: app migrations run OUTSIDE the app-db codec, so any
-- literal inserted here would land in an encrypted column as plaintext.

-- Whose timeline this is.
--
-- A subject is usually a household member, but it must not have to be. The
-- most common milestone in the whole app — a baby's first steps — belongs to
-- someone who has no account, and may not get one for a decade. So `member_id`
-- is optional and `name` always carries the display name. When `member_id` is
-- set the UI should prefer the roster's name and birthdate; when it is empty
-- the columns here are the only source.
CREATE TABLE IF NOT EXISTS app_milestones__subjects (
  id          TEXT NOT NULL PRIMARY KEY,
  member_id   TEXT NOT NULL DEFAULT '',   -- roster member id, or '' for a subject with no account
                                          -- (plaintext: ends in _id)
  name        TEXT NOT NULL,              -- encrypted; the fallback display name
  birth_date  TEXT NOT NULL DEFAULT '',   -- yyyy-mm-dd, or '' if unknown (plaintext: ends in _date)
                                          -- Carried here rather than read from the roster because
                                          -- `birthdate` is stripped from family.members for guests
                                          -- and in shared spaces — and age-at-the-time is the point.
  icon        TEXT NOT NULL DEFAULT '🌱', -- plaintext (built-in column name)
  visibility  TEXT NOT NULL DEFAULT 'everyone',  -- everyone|private (row policy; plaintext)
  archived_at TEXT,                       -- set instead of deleting a subject
  created_by  TEXT NOT NULL,              -- member id of the author (plaintext: ends in _by)
  created_at  TEXT NOT NULL,              -- ISO timestamp (plaintext)
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS app_milestones__subjects_member_idx
  ON app_milestones__subjects (member_id);

-- One thing that happened, once.
CREATE TABLE IF NOT EXISTS app_milestones__milestones (
  id             TEXT NOT NULL PRIMARY KEY,
  subject_id     TEXT NOT NULL,           -- FK to subjects.id (plaintext: ends in _id)
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

-- The timeline read: one subject, oldest to newest.
CREATE INDEX IF NOT EXISTS app_milestones__milestones_subject_date_idx
  ON app_milestones__milestones (subject_id, occurred_date);

-- The "on this day" glance, which scans by date across all subjects.
CREATE INDEX IF NOT EXISTS app_milestones__milestones_date_idx
  ON app_milestones__milestones (occurred_date);
