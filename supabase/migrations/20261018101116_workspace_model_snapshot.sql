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

-- A complete definition export is one statement snapshot, without entity counts.
CREATE OR REPLACE FUNCTION private.data_model_document(p_owner uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
 'format','workspace-data-model','format_version',1,'title','자료 모델',
 'entity_types',coalesce((select jsonb_agg(jsonb_build_object(
  'ref','type_'||t.id::text,'schema',v.schema,
  'identity',jsonb_build_object('version',i.version,'label',i.label,
   'default_source',i.default_source,'sources',coalesce((
    select jsonb_agg(jsonb_build_object('code',s.code,'rule_id',s.rule_id,'active',s.active)
                     order by s.code)
    from app.entity_type_identity_sources s
    where s.workspace_id=p_owner and s.type_id=t.id),'[]'::jsonb))) order by t.id)
  from app.entity_types t join app.entity_schema_versions v
   on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version
  join app.entity_type_identity i on i.workspace_id=t.workspace_id and i.type_id=t.id
  where t.workspace_id=p_owner),'[]'::jsonb),
 'relations',coalesce((select jsonb_agg(jsonb_build_object(
  'id',d.id,'version',d.version,'archived',d.archived,'ends',jsonb_build_array(
   jsonb_build_object('type_ref','type_'||d.left_type_id::text,'label',d.left_label,'cardinality',d.left_cardinality),
   jsonb_build_object('type_ref','type_'||d.right_type_id::text,'label',d.right_label,'cardinality',d.right_cardinality))) order by d.id)
  from app.entity_relation_definitions d where d.workspace_id=p_owner),'[]'::jsonb),
 'identity_definitions',jsonb_build_object(
  'issuers',coalesce((select jsonb_agg(jsonb_build_object('code',i.code,'label',i.label,
   'active',i.active,'system',i.system,'version',i.version) order by i.code)
   from app.entity_issuers i where i.workspace_id=p_owner),'[]'::jsonb),
  'rules',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'source',r.source,
   'label',r.label,'meaning',r.meaning,'generation',r.generation,
   'active',r.active,'version',r.version) order by r.id)
   from app.entity_identifier_rules r where r.workspace_id=p_owner),'[]'::jsonb)))
$function$
;

create function app.export_workspace_data_model() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform app.lock_workspace(app.current_workspace_id(),false);
 perform app.authorize_workspace('[{"target_kind":"settings","target_id":"*","access":"read"}]'::jsonb);
 return private.data_model_document(app.current_workspace_id());
end $$;
revoke all on function app.export_workspace_data_model() from public,anon,authenticated,app_worker;
grant execute on function app.export_workspace_data_model() to app_user;
