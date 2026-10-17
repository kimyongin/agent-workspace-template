-- The definer guard must not probe another owner before RLS rejects the write.
create or replace function app.guard_entity_relation_definition_kinds() returns trigger language plpgsql security definer set search_path='' as $$
declare requires_active boolean; available integer; expected integer;
begin
 if auth.uid() is not null and new.owner_id<>auth.uid() then raise exception 'relation owner mismatch' using errcode='42501'; end if;
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
