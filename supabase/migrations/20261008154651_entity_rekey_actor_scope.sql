-- SECURITY INVOKER reads are already restricted to the authenticated Actor by entities_owner RLS.
-- Resolve the owner from that visible locked row without requesting extra auth schema grants.
create or replace function app.rekey_entity(old_id text,new_source text,new_external_id text) returns void
language plpgsql security invoker set search_path='' as $$
declare next_id text:=new_source||':'||new_external_id; entity_owner uuid;
begin
  select owner_id into entity_owner from app.entities where id=old_id and deleted_at is null for update;
  if not found then raise exception 'entity not found' using errcode='23503'; end if;
  update app.entities set id=next_id,source=new_source,external_id=new_external_id,version=version+1,updated_at=now()
    where owner_id=entity_owner and id=old_id;
  update app.tasks t set entity_ids=array_replace(entity_ids,old_id,next_id),
    entity_context=app.rewrite_entity_refs(entity_context,old_id,next_id,true),version=version+1,updated_at=now()
    where owner_id=entity_owner and (old_id=any(entity_ids) or entity_context @> jsonb_build_array(jsonb_build_object('id',old_id)));
  update app.records r set entity_ids=array_replace(entity_ids,old_id,next_id),
    entity_context=app.rewrite_entity_refs(entity_context,old_id,next_id,true),
    change_metadata=app.rewrite_entity_refs(change_metadata,old_id,next_id,change_metadata->>'target_kind'='entity'),
    version=version+1,updated_at=now()
    where owner_id=entity_owner and (old_id=any(entity_ids) or entity_context @> jsonb_build_array(jsonb_build_object('id',old_id))
      or app.rewrite_entity_refs(change_metadata,old_id,next_id,change_metadata->>'target_kind'='entity') is distinct from change_metadata);
end $$;
