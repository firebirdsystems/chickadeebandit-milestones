SELECT
  m.id,
  m.subject_id,
  CASE WHEN s.member_id = '' THEN s.name ELSE NULL END AS subject_name,
  s.member_id AS subject_member_id,
  s.birth_date AS subject_birth_date,
  m.title,
  m.note,
  m.category,
  m.occurred_date,
  m.date_precision,
  m.created_by,
  m.created_at
FROM app_milestones__milestones m
JOIN app_milestones__subjects s
  ON s.id = m.subject_id
WHERE s.archived_at IS NULL
ORDER BY m.occurred_date DESC
LIMIT 500
