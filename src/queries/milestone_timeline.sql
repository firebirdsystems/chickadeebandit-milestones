SELECT
  m.id,
  m.title,
  m.note,
  m.category,
  m.occurred_date,
  m.date_precision,
  m.created_by,
  m.created_at,
  mp.person_id,
  CASE WHEN p.member_id = '' THEN p.name ELSE NULL END AS person_name,
  p.member_id AS person_member_id,
  p.birth_date AS person_birth_date
FROM app_milestones__milestones m
LEFT JOIN app_milestones__milestone_people mp
  ON mp.milestone_id = m.id
LEFT JOIN app_milestones__people p
  ON p.id = mp.person_id AND p.archived_at IS NULL
WHERE mp.id IS NULL OR p.id IS NOT NULL
ORDER BY m.occurred_date DESC
LIMIT 500
