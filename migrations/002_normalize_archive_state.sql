-- Parent-state row-policy guards use a finite locked value. Normalize older
-- timestamp archives to that sentinel; archived_at remains nullable/truthy, so
-- existing app and surface filters retain the same semantics.
UPDATE app_milestones__subjects
SET archived_at = 'archived'
WHERE archived_at IS NOT NULL;
