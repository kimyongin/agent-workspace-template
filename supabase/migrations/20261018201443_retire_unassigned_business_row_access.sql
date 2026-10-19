-- Preserve the unassigned historical graph without exposing an owner-only path.
-- Current writes retain their existing workspace and kind/settings authority.
drop policy entities_owner on app.entities;
alter policy entity_workspace_scope on app.entities
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('entity_type',entity_type_id::text,'read'))
 with check(workspace_id=app.current_workspace_id() and app.workspace_allows('entity_type',entity_type_id::text,'write'));

drop policy entity_relation_definitions_owner on app.entity_relation_definitions;
alter policy relation_definition_workspace_scope on app.entity_relation_definitions
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read'))
 with check(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write'));
