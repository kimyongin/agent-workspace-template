-- Retire remaining owner-only execution policies without changing historical rows.
-- Historical rows remain unchanged; only current workspace permissions authorize app_user.
drop policy records_owner on app.records;
drop policy entity_tags_owner on app.entity_tags;
drop policy owner_only on app.record_tags;
-- These legacy policies are already blocked by restrictive workspace policies and are unused.
drop policy owner_only on app.tags;
drop policy owner_only on app.task_tags;

alter policy task_workspace_scope on app.tasks
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('tasks','*','read'))
 with check(workspace_id=app.current_workspace_id() and app.workspace_allows('tasks','*','write'));
alter policy relation_link_workspace_scope on app.entity_relation_links
 using(workspace_id=app.current_workspace_id() and exists(
  select 1 from app.entities l join app.entities r on r.workspace_id=l.workspace_id
  where l.workspace_id=entity_relation_links.workspace_id and l.id=entity_relation_links.left_entity_id and r.id=entity_relation_links.right_entity_id
  and app.workspace_allows('entity_type',l.entity_type_id::text,'read') and app.workspace_allows('entity_type',r.entity_type_id::text,'read')))
 with check(workspace_id=app.current_workspace_id() and exists(
  select 1 from app.entities l join app.entities r on r.workspace_id=l.workspace_id
  where l.workspace_id=entity_relation_links.workspace_id and l.id=entity_relation_links.left_entity_id and r.id=entity_relation_links.right_entity_id
  and app.workspace_allows('entity_type',l.entity_type_id::text,'write') and app.workspace_allows('entity_type',r.entity_type_id::text,'write')));
