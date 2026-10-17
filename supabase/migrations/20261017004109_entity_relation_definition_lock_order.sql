-- BEFORE STATEMENT runs before PostgreSQL takes target row locks. Direct DML and
-- service commands therefore share owner -> definition -> ordered kinds.
create function app.lock_entity_relation_owner() returns trigger language plpgsql security invoker set search_path='' as $$
declare actor_id uuid := nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub','')::uuid;
begin
 if actor_id is not null then
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text||':entity-relations',0));
 end if;
 return null;
end $$;
revoke all on function app.lock_entity_relation_owner() from public;
create trigger lock_entity_relation_definition_owner before insert or update or delete on app.entity_relation_definitions for each statement execute function app.lock_entity_relation_owner();

create function app.guard_entity_relation_definition_kinds() returns trigger language plpgsql security invoker set search_path='' as $$
declare requires_active boolean; available integer; expected integer;
begin
 requires_active := tg_op='INSERT';
 if tg_op='UPDATE' then
  requires_active := (not new.archived and old.archived) or new.left_type_id<>old.left_type_id or new.right_type_id<>old.right_type_id;
 end if;
 if requires_active then
  perform 1 from app.entity_types t where t.owner_id=new.owner_id and t.id in (new.left_type_id,new.right_type_id) order by t.id for share;
  -- Separate statement after locking: do not validate an old joined schema snapshot
  -- when an archive publication completed while the row lock was being acquired.
  select count(*) into available from app.entity_types t join app.entity_schema_versions v
   on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version
   where t.owner_id=new.owner_id and t.id in (new.left_type_id,new.right_type_id) and not coalesce((v.schema->>'deprecated')::boolean,false);
  expected := case when new.left_type_id=new.right_type_id then 1 else 2 end;
  if available<>expected then raise exception 'relation_kind_unavailable' using errcode='23514'; end if;
 end if;
 return new;
end $$;
revoke all on function app.guard_entity_relation_definition_kinds() from public;
create trigger guard_entity_relation_definition_kinds before insert or update on app.entity_relation_definitions for each row execute function app.guard_entity_relation_definition_kinds();
