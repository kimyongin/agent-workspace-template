-- Shared conversion baselines retain actual scoped links independently of author.
alter table app.entity_relation_links drop constraint entity_relation_links_pkey;
alter table app.entity_relation_links add constraint relation_link_legacy_owner_key unique(owner_id,definition_id,left_entity_id,right_entity_id);
alter table app.entity_relation_links alter column owner_id drop not null;
alter table app.entity_relation_links drop constraint entity_relation_links_owner_id_fkey;
alter table app.entity_relation_links add constraint relation_link_legacy_author_fk foreign key(owner_id) references auth.users(id) on delete set null;
create trigger workspace_model_anchor before insert or update on app.entity_relation_links
 for each row execute function private.guard_workspace_model_anchor();
drop policy entity_relation_links_owner on app.entity_relation_links;
create policy relation_link_workspace_read on app.entity_relation_links for select to app_user
 using(workspace_id=app.current_workspace_id() and exists(select 1 from app.entities l join app.entities r on r.workspace_id=l.workspace_id
  where l.workspace_id=entity_relation_links.workspace_id and l.id=entity_relation_links.left_entity_id and r.id=entity_relation_links.right_entity_id
   and app.workspace_allows('entity_type',l.entity_type_id::text,'read') and app.workspace_allows('entity_type',r.entity_type_id::text,'read')));
create policy relation_link_workspace_insert on app.entity_relation_links for insert to app_user
 with check(workspace_id=app.current_workspace_id() and owner_id is null and exists(select 1 from app.entities l join app.entities r on r.workspace_id=l.workspace_id
  where l.workspace_id=entity_relation_links.workspace_id and l.id=entity_relation_links.left_entity_id and r.id=entity_relation_links.right_entity_id
   and app.workspace_allows('entity_type',l.entity_type_id::text,'write') and app.workspace_allows('entity_type',r.entity_type_id::text,'write')));
create policy relation_link_workspace_delete on app.entity_relation_links for delete to app_user
 using(workspace_id=app.current_workspace_id() and exists(select 1 from app.entities l join app.entities r on r.workspace_id=l.workspace_id
  where l.workspace_id=entity_relation_links.workspace_id and l.id=entity_relation_links.left_entity_id and r.id=entity_relation_links.right_entity_id
   and app.workspace_allows('entity_type',l.entity_type_id::text,'write') and app.workspace_allows('entity_type',r.entity_type_id::text,'write')));

-- BEFORE STATEMENT shares the workspace advisory with definitions/model writers.
create or replace function app.lock_entity_relation_owner() returns trigger language plpgsql set search_path='' as $$
declare workspace uuid:=app.current_workspace_id();
begin
 if workspace is not null then
  perform pg_advisory_xact_lock(hashtextextended(workspace::text||':entity-relations',0));
 end if;
 return null;
end $$;

-- Resolve only definition affiliation before requiring both actual endpoint
-- kinds' WRITE. Internal visibility prevents silent creator-filtered counts.
create or replace function app.guard_entity_relation_link() returns trigger
 language plpgsql security definer set search_path='' as $$
declare link app.entity_relation_links%rowtype;d app.entity_relation_definitions%rowtype;kind record;
 left_kind uuid;right_kind uuid;left_deleted timestamptz;right_deleted timestamptz;left_archived boolean;right_archived boolean;
begin
 if tg_op='DELETE' then link:=old;else link:=new;end if;
 -- Exact privileged parent/account cleanup has no actor. App-user RLS denies
 -- unauthenticated DML, and no client can invoke a trigger function directly.
 if tg_op='DELETE' and nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub' is null then return old;end if;
 if link.workspace_id is null or link.workspace_id is distinct from app.current_workspace_id() then
  raise exception 'workspace_denied' using errcode='42501';end if;
 select * into d from app.entity_relation_definitions where workspace_id=link.workspace_id and id=link.definition_id for update;
 if not found then raise exception 'relation_definition_missing' using errcode='23503';end if;
 perform private.authorize_workspace_model_kinds(array[d.left_type_id,d.right_type_id]);
 for kind in select t.id,t.schema_write_locked from app.entity_types t
  where t.workspace_id=link.workspace_id and t.id in(d.left_type_id,d.right_type_id) order by t.id for update loop
  if kind.schema_write_locked then raise exception 'schema_migration_in_progress' using errcode='55000';end if;
 end loop;
 perform 1 from app.entities e where e.workspace_id=link.workspace_id and e.id in(link.left_entity_id,link.right_entity_id) order by e.id collate "C" for update;
 if tg_op='DELETE' then return old;end if;
 select e.entity_type_id,e.deleted_at,coalesce((v.schema->>'deprecated')::boolean,false)
  into left_kind,left_deleted,left_archived from app.entities e join app.entity_types t on t.workspace_id=e.workspace_id and t.id=e.entity_type_id
  join app.entity_schema_versions v on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version
  where e.workspace_id=link.workspace_id and e.id=link.left_entity_id;
 select e.entity_type_id,e.deleted_at,coalesce((v.schema->>'deprecated')::boolean,false)
  into right_kind,right_deleted,right_archived from app.entities e join app.entity_types t on t.workspace_id=e.workspace_id and t.id=e.entity_type_id
  join app.entity_schema_versions v on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version
  where e.workspace_id=link.workspace_id and e.id=link.right_entity_id;
 if left_kind is null or right_kind is null then raise exception 'relation_endpoint_missing' using errcode='23503';end if;
 if left_kind<>d.left_type_id or right_kind<>d.right_type_id or link.left_entity_id=link.right_entity_id then
  raise exception 'relation_endpoint_kind' using errcode='23514';end if;
 if d.archived or left_deleted is not null or right_deleted is not null or left_archived or right_archived then
  raise exception 'relation_endpoint_inactive' using errcode='23514';end if;
 if d.left_cardinality='one' and exists(select 1 from app.entity_relation_links where workspace_id=link.workspace_id and definition_id=link.definition_id and left_entity_id=link.left_entity_id)
  or d.right_cardinality='one' and exists(select 1 from app.entity_relation_links where workspace_id=link.workspace_id and definition_id=link.definition_id and right_entity_id=link.right_entity_id) then
  raise exception 'relation_single_occupied' using errcode='23505';end if;
 return new;
end $$;
revoke all on function app.guard_entity_relation_link() from public,anon,authenticated,app_user,app_server,app_worker;
