-- Scoped model relations use a workspace key, never a user-shaped surrogate.
-- Preserve legacy rows and their old FK graph until #518 explicitly removes it.
do $$
declare fks jsonb;r jsonb;
begin
 select jsonb_agg(jsonb_build_object('relation',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid))) into fks
 from pg_constraint c where c.contype='f' and c.confrelid='app.entity_relation_definitions'::regclass;
 for r in select value from jsonb_array_elements(fks) loop
  execute format('alter table %s drop constraint %I',r->>'relation',r->>'name');
 end loop;
 alter table app.entity_relation_definitions drop constraint entity_relation_definitions_pkey;
 alter table app.entity_relation_definitions add constraint relation_definition_legacy_owner_key unique(owner_id,id);
 alter table app.entity_relation_definitions alter column owner_id drop not null;
 for r in select value from jsonb_array_elements(fks) loop
  execute format('alter table %s add constraint %I %s',r->>'relation',r->>'name',r->>'definition');
 end loop;
end $$;
alter table app.entity_relation_definitions drop constraint entity_relation_definitions_owner_id_fkey;
alter table app.entity_relation_definitions add constraint relation_definition_legacy_author_fk foreign key(owner_id) references auth.users(id) on delete set null;
create trigger workspace_model_anchor before insert or update on app.entity_relation_definitions
 for each row execute function private.guard_workspace_model_anchor();
create policy relation_definition_workspace_read on app.entity_relation_definitions for select to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read'));
create policy relation_definition_workspace_write on app.entity_relation_definitions for all to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write'))
 with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write'));

-- This is transaction-local internal evidence, not a user-owned table. Refuse
-- unexpected state rather than removing any existing row during the transition.
do $$begin
 if exists(select 1 from private.data_model_publication_context) then
  raise exception 'model_publication_context_requires_empty_store' using errcode='55000';
 end if;
end $$;
alter table private.data_model_publication_context rename column owner_id to workspace_id;


create function private.authorize_workspace_model_kinds(p_ids uuid[]) returns void
 language plpgsql set search_path='' as $$
declare requirements jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('target_kind','entity_type','target_id',id::text,'access','write') order by id),'[]'::jsonb)
 into requirements from (select distinct unnest(p_ids) as id) q where id is not null;
 perform app.authorize_workspace(requirements);
 perform set_config('request.workspace_requirements',
  (coalesce(nullif(current_setting('request.workspace_requirements',true),''),'[]')::jsonb||requirements)::text,true);
end $$;
revoke all on function private.authorize_workspace_model_kinds(uuid[]) from public,anon,authenticated,app_server,app_worker;
grant execute on function private.authorize_workspace_model_kinds(uuid[]) to app_user;

create or replace function app.guard_entity_relation_definition_kinds() returns trigger language plpgsql security definer set search_path='' as $$
declare requires_active boolean; available integer; expected integer;
begin
 if new.workspace_id is not null then
  if new.workspace_id is distinct from app.current_workspace_id() then
   raise exception 'workspace_denied' using errcode='42501';
  end if;
  perform app.authorize_workspace('[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb);
  requires_active:=tg_op='INSERT';
  if tg_op='UPDATE' then requires_active:=(not new.archived and old.archived) or new.left_type_id<>old.left_type_id or new.right_type_id<>old.right_type_id;end if;
  if requires_active and not exists(select 1 from private.data_model_publication_context c where c.workspace_id=new.workspace_id and c.pid=pg_backend_pid() and c.txid=txid_current()) then
   perform 1 from app.entity_types t where t.workspace_id=new.workspace_id and t.id in(new.left_type_id,new.right_type_id) order by t.id for share;
   select count(*) into available from app.entity_types t join app.entity_schema_versions v on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version
    where t.workspace_id=new.workspace_id and t.id in(new.left_type_id,new.right_type_id) and not coalesce((v.schema->>'deprecated')::boolean,false);
   expected:=case when new.left_type_id=new.right_type_id then 1 else 2 end;
   if available<>expected then raise exception 'relation_kind_unavailable' using errcode='23514';end if;
  end if;
  return new;
 end if;
 if auth.uid() is not null and new.owner_id<>auth.uid() then raise exception 'relation owner mismatch' using errcode='42501'; end if;
 requires_active := tg_op='INSERT';
 if tg_op='UPDATE' then requires_active := (not new.archived and old.archived) or new.left_type_id<>old.left_type_id or new.right_type_id<>old.right_type_id; end if;
 if requires_active  then
  perform 1 from app.entity_types t where t.owner_id=new.owner_id and t.id in(new.left_type_id,new.right_type_id) order by t.id for share;
  select count(*) into available from app.entity_types t join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version where t.owner_id=new.owner_id and t.id in(new.left_type_id,new.right_type_id) and not coalesce((v.schema->>'deprecated')::boolean,false);
  expected := case when new.left_type_id=new.right_type_id then 1 else 2 end;
  if available<>expected then raise exception 'relation_kind_unavailable' using errcode='23514'; end if;
 end if;
 return new;
end $$;

create or replace function app.guard_entity_relation_definition() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.workspace_id is not null then
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text||':entity-relations',0));
  if new.workspace_id is distinct from old.workspace_id or new.id is distinct from old.id or new.version<>old.version+1 then
   raise exception 'immutable_relation_identity_or_version' using errcode='23514';
  end if;
  if (new.left_type_id,new.right_type_id,new.left_cardinality,new.right_cardinality) is distinct from
     (old.left_type_id,old.right_type_id,old.left_cardinality,old.right_cardinality) then
   perform private.authorize_workspace_model_kinds(array[old.left_type_id,old.right_type_id,new.left_type_id,new.right_type_id]);
   if exists(select 1 from app.entity_relation_links l join app.entities e on e.workspace_id=l.workspace_id and e.id=l.left_entity_id join app.entities r on r.workspace_id=l.workspace_id and r.id=l.right_entity_id
    where l.workspace_id=new.workspace_id and l.definition_id=new.id and (e.entity_type_id<>new.left_type_id or r.entity_type_id<>new.right_type_id)) then
    raise exception 'relation_type_in_use' using errcode='23514';
   end if;
   if new.left_cardinality='one' and exists(select 1 from app.entity_relation_links where workspace_id=new.workspace_id and definition_id=new.id group by left_entity_id having count(*)>1)
    or new.right_cardinality='one' and exists(select 1 from app.entity_relation_links where workspace_id=new.workspace_id and definition_id=new.id group by right_entity_id having count(*)>1) then
    raise exception 'relation_cardinality_in_use' using errcode='23514';
   end if;
  end if;
  return new;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text||':entity-relations',0));
 if new.owner_id is distinct from old.owner_id or new.id is distinct from old.id or new.version<>old.version+1 then
  raise exception 'immutable_relation_identity_or_version' using errcode='23514';
 end if;
 if exists(select 1 from app.entity_relation_links l join app.entities e on e.owner_id=l.owner_id and e.id=l.left_entity_id join app.entities r on r.owner_id=l.owner_id and r.id=l.right_entity_id where l.owner_id=new.owner_id and l.definition_id=new.id and (e.entity_type_id<>new.left_type_id or r.entity_type_id<>new.right_type_id)) then
  raise exception 'relation_type_in_use' using errcode='23514';
 end if;
 if new.left_cardinality='one' and exists(select 1 from app.entity_relation_links where owner_id=new.owner_id and definition_id=new.id group by left_entity_id having count(*)>1) or new.right_cardinality='one' and exists(select 1 from app.entity_relation_links where owner_id=new.owner_id and definition_id=new.id group by right_entity_id having count(*)>1) then
  raise exception 'relation_cardinality_in_use' using errcode='23514';
 end if;
 return new;
end $$;

CREATE OR REPLACE FUNCTION app.publish_data_model_relation(p_id uuid, p_expected integer, p_ends jsonb, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid:=app.current_workspace_id(); v_current app.entity_relation_definitions%rowtype;v_effect boolean;
begin
 perform app.lock_workspace_account();
 perform app.lock_workspace(v_owner,false);
 perform app.authorize_workspace('[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb);
 if v_owner is null or jsonb_array_length(p_ends)<>2 then raise exception 'invalid model relation' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':entity-relations',0));
 select * into v_current from app.entity_relation_definitions where workspace_id=v_owner and id=p_id for update;
 if (p_expected is null and found) or (p_expected is not null and (not found or v_current.version<>p_expected)) then raise exception 'model relation changed' using errcode='40001'; end if;
 v_effect:=p_expected is not null and
  (v_current.left_type_id,v_current.right_type_id,v_current.left_cardinality,v_current.right_cardinality) is distinct from
  ((p_ends->0->>'type_id')::uuid,(p_ends->1->>'type_id')::uuid,p_ends->0->>'cardinality',p_ends->1->>'cardinality');
 if v_effect then
  perform private.authorize_workspace_model_kinds(array[v_current.left_type_id,v_current.right_type_id,(p_ends->0->>'type_id')::uuid,(p_ends->1->>'type_id')::uuid]);
 end if;
 if v_effect and (exists(select 1 from app.entity_relation_links l join app.entities e on e.workspace_id=l.workspace_id and e.id=l.left_entity_id join app.entities o on o.workspace_id=l.workspace_id and o.id=l.right_entity_id where l.workspace_id=v_owner and l.definition_id=p_id and (e.entity_type_id<>(p_ends->0->>'type_id')::uuid or o.entity_type_id<>(p_ends->1->>'type_id')::uuid)) or
 ((p_ends->0->>'cardinality')='one' and exists(select 1 from app.entity_relation_links where workspace_id=v_owner and definition_id=p_id group by left_entity_id having count(*)>1)) or
 ((p_ends->1->>'cardinality')='one' and exists(select 1 from app.entity_relation_links where workspace_id=v_owner and definition_id=p_id group by right_entity_id having count(*)>1)) ) then raise exception 'model relation incompatible' using errcode='23514'; end if;
 insert into private.data_model_publication_context(workspace_id,pid,txid) values(v_owner,pg_backend_pid(),txid_current());
 if p_expected is null then
 insert into app.entity_relation_definitions(workspace_id,id,left_type_id,left_label,left_cardinality,right_type_id,right_label,right_cardinality,archived) values(v_owner,p_id,(p_ends->0->>'type_id')::uuid,p_ends->0->>'label',p_ends->0->>'cardinality',(p_ends->1->>'type_id')::uuid,p_ends->1->>'label',p_ends->1->>'cardinality',p_archived);
 else
 update app.entity_relation_definitions set left_type_id=(p_ends->0->>'type_id')::uuid,left_label=p_ends->0->>'label',left_cardinality=p_ends->0->>'cardinality',right_type_id=(p_ends->1->>'type_id')::uuid,right_label=p_ends->1->>'label',right_cardinality=p_ends->1->>'cardinality',archived=p_archived,version=version+1 where workspace_id=v_owner and id=p_id;
 end if;
 delete from private.data_model_publication_context where workspace_id=v_owner and pid=pg_backend_pid() and txid=txid_current();
end $function$;
