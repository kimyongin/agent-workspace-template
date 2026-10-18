-- Existing record writes are deliberately column-scoped. A parent can only be
-- selected at creation; author capture is trusted and no new UPDATE grant exists.
grant insert(workspace_id,entity_id) on app.records to app_user;
