-- Whole-model reads must not discover unassigned legacy entity/relation rows.
-- These nullable anchors are consumed by #513 publication and completed by #514;
-- historical rows remain unmapped until #518's explicit test-store cleanup.
alter table app.entities add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.entities add constraint entity_workspace_key unique(workspace_id,id);
alter table app.entities add constraint entity_workspace_type_fk foreign key(workspace_id,entity_type_id)
 references app.entity_types(workspace_id,id);
alter table app.entity_relation_definitions add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.entity_relation_definitions add constraint relation_definition_workspace_key unique(workspace_id,id);
alter table app.entity_relation_definitions add constraint relation_definition_workspace_left_fk foreign key(workspace_id,left_type_id)
 references app.entity_types(workspace_id,id);
alter table app.entity_relation_definitions add constraint relation_definition_workspace_right_fk foreign key(workspace_id,right_type_id)
 references app.entity_types(workspace_id,id);
alter table app.entity_relation_links add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.entity_relation_links add constraint relation_link_workspace_key unique(workspace_id,definition_id,left_entity_id,right_entity_id);
alter table app.entity_relation_links add constraint relation_link_workspace_definition_fk foreign key(workspace_id,definition_id)
 references app.entity_relation_definitions(workspace_id,id) deferrable initially deferred;
alter table app.entity_relation_links add constraint relation_link_workspace_left_fk foreign key(workspace_id,left_entity_id)
 references app.entities(workspace_id,id) on delete cascade;
alter table app.entity_relation_links add constraint relation_link_workspace_right_fk foreign key(workspace_id,right_entity_id)
 references app.entities(workspace_id,id) on delete cascade;

-- Keep not-yet-converted legacy callers isolated on this nondeployable integration
-- branch. A nonnull anchor cannot bypass membership/grants through their owner policy.
create policy entity_workspace_scope on app.entities as restrictive for all to app_user
 using(workspace_id is null or (workspace_id=app.current_workspace_id() and app.workspace_allows('entity_type',entity_type_id::text,'read')))
 with check(workspace_id is null or (workspace_id=app.current_workspace_id() and app.workspace_allows('entity_type',entity_type_id::text,'write')));
create policy relation_definition_workspace_scope on app.entity_relation_definitions as restrictive for all to app_user
 using(workspace_id is null or (workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read')))
 with check(workspace_id is null or (workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write')));
create policy relation_link_workspace_scope on app.entity_relation_links as restrictive for all to app_user
 using(workspace_id is null or (workspace_id=app.current_workspace_id() and exists(
  select 1 from app.entities l join app.entities r on r.workspace_id=l.workspace_id
  where l.workspace_id=entity_relation_links.workspace_id and l.id=entity_relation_links.left_entity_id and r.id=entity_relation_links.right_entity_id
  and app.workspace_allows('entity_type',l.entity_type_id::text,'read') and app.workspace_allows('entity_type',r.entity_type_id::text,'read'))))
 with check(workspace_id is null or (workspace_id=app.current_workspace_id() and exists(
  select 1 from app.entities l join app.entities r on r.workspace_id=l.workspace_id
  where l.workspace_id=entity_relation_links.workspace_id and l.id=entity_relation_links.left_entity_id and r.id=entity_relation_links.right_entity_id
  and app.workspace_allows('entity_type',l.entity_type_id::text,'write') and app.workspace_allows('entity_type',r.entity_type_id::text,'write'))));

create or replace function app.entity_schema_membership(p_owner uuid,p_type uuid) returns text
 language sql stable set search_path='' as $$
 select md5(coalesce(jsonb_agg(jsonb_build_array(e.id,e.version,e.schema_version,e.properties,e.deleted_at) order by e.id)::text,'[]'))
 from app.entities e where e.workspace_id=p_owner and e.entity_type_id=p_type
$$;

create function private.guard_workspace_business_anchor() returns trigger language plpgsql set search_path='' as $$
begin
 if old.workspace_id is not null and new.workspace_id is distinct from old.workspace_id then
  raise exception 'workspace_business_anchor_immutable' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function private.guard_workspace_business_anchor() from public,anon,authenticated;
create trigger workspace_business_anchor before update on app.entities for each row execute function private.guard_workspace_business_anchor();
create trigger workspace_business_anchor before update on app.entity_relation_definitions for each row execute function private.guard_workspace_business_anchor();
create trigger workspace_business_anchor before update on app.entity_relation_links for each row execute function private.guard_workspace_business_anchor();
