-- The timeline pages newest-first on (occurred_date, created_at, id), all three
-- descending. The date-only index left SQLite reading the whole table and
-- sorting it to return one page; this one is walked backwards in page order,
-- so a page costs a page. All three columns are stored in the clear.
CREATE INDEX IF NOT EXISTS app_milestones__milestones_timeline_idx
  ON app_milestones__milestones (occurred_date, created_at, id);
