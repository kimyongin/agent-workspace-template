-- Whole model reviews retain one immutable plan and one atomic publication result.
create table app.data_model_changes (
 owner_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null default gen_random_uuid(), version integer not null default 1,
 status text not null check(status in ('ready','needs_conversion','applied','cancelled')),
 plan jsonb not null, result jsonb, created_at timestamptz not null default now(),
 primary key(owner_id,id), unique(id)
);
alter table app.data_model_changes enable row level security;
create policy data_model_change_owner on app.data_model_changes for all to app_user
 using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
grant select,insert,update on app.data_model_changes to app_user;
create index data_model_change_history on app.data_model_changes(owner_id,id);
-- Only the validated model-publication function can admit the normal exported
-- snapshot of an active relationship whose endpoint kind has since been archived.
create table private.data_model_publication_context(owner_id uuid not null,pid integer not null,txid bigint not null,primary key(owner_id,pid,txid));
revoke all on private.data_model_publication_context from public,anon,authenticated,app_user,app_server,app_worker;
create or replace function app.guard_entity_relation_definition_kinds() returns trigger language plpgsql security definer set search_path='' as $$
declare requires_active boolean; available integer; expected integer;
begin
 requires_active := tg_op='INSERT';
 if tg_op='UPDATE' then requires_active := (not new.archived and old.archived) or new.left_type_id<>old.left_type_id or new.right_type_id<>old.right_type_id; end if;
 if requires_active and not exists(select 1 from private.data_model_publication_context c where c.owner_id=new.owner_id and c.pid=pg_backend_pid() and c.txid=txid_current()) then
  perform 1 from app.entity_types t where t.owner_id=new.owner_id and t.id in(new.left_type_id,new.right_type_id) order by t.id for share;
  select count(*) into available from app.entity_types t join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version where t.owner_id=new.owner_id and t.id in(new.left_type_id,new.right_type_id) and not coalesce((v.schema->>'deprecated')::boolean,false);
  expected := case when new.left_type_id=new.right_type_id then 1 else 2 end;
  if available<>expected then raise exception 'relation_kind_unavailable' using errcode='23514'; end if;
 end if;
 return new;
end $$;
revoke all on function app.guard_entity_relation_definition_kinds() from public,anon,authenticated,app_user,app_server,app_worker;
create function app.publish_data_model_relation(p_id uuid,p_expected integer,p_ends jsonb,p_archived boolean) returns void language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_current app.entity_relation_definitions%rowtype;
begin
 if v_owner is null or jsonb_array_length(p_ends)<>2 then raise exception 'invalid model relation' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':entity-relations',0));
 select * into v_current from app.entity_relation_definitions where owner_id=v_owner and id=p_id for update;
 if (p_expected is null and found) or (p_expected is not null and (not found or v_current.version<>p_expected)) then raise exception 'model relation changed' using errcode='40001'; end if;
 if exists(select 1 from app.entity_relation_links l join app.entities e on e.owner_id=l.owner_id and e.id=l.left_entity_id join app.entities o on o.owner_id=l.owner_id and o.id=l.right_entity_id where l.owner_id=v_owner and l.definition_id=p_id and (e.entity_type_id<>(p_ends->0->>'type_id')::uuid or o.entity_type_id<>(p_ends->1->>'type_id')::uuid)) or
 ((p_ends->0->>'cardinality')='one' and exists(select 1 from app.entity_relation_links where owner_id=v_owner and definition_id=p_id group by left_entity_id having count(*)>1)) or
 ((p_ends->1->>'cardinality')='one' and exists(select 1 from app.entity_relation_links where owner_id=v_owner and definition_id=p_id group by right_entity_id having count(*)>1)) then raise exception 'model relation incompatible' using errcode='23514'; end if;
 insert into private.data_model_publication_context values(v_owner,pg_backend_pid(),txid_current());
 if p_expected is null then
 insert into app.entity_relation_definitions(owner_id,id,left_type_id,left_label,left_cardinality,right_type_id,right_label,right_cardinality,archived) values(v_owner,p_id,(p_ends->0->>'type_id')::uuid,p_ends->0->>'label',p_ends->0->>'cardinality',(p_ends->1->>'type_id')::uuid,p_ends->1->>'label',p_ends->1->>'cardinality',p_archived);
 else
 update app.entity_relation_definitions set left_type_id=(p_ends->0->>'type_id')::uuid,left_label=p_ends->0->>'label',left_cardinality=p_ends->0->>'cardinality',right_type_id=(p_ends->1->>'type_id')::uuid,right_label=p_ends->1->>'label',right_cardinality=p_ends->1->>'cardinality',archived=p_archived,version=version+1 where owner_id=v_owner and id=p_id;
 end if;
 delete from private.data_model_publication_context where owner_id=v_owner and pid=pg_backend_pid() and txid=txid_current();
end $$;
revoke all on function app.publish_data_model_relation(uuid,integer,jsonb,boolean) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.publish_data_model_relation(uuid,integer,jsonb,boolean) to app_user;
