-- Removing live membership must not erase the task's previously captured target context.
-- The application delete path removes membership first; this direct-delete fallback
-- only updates still-linked tasks, so either path increments their version once.
create or replace function app.detach_deleted_task_entity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  update app.tasks t set entity_ids=array_remove(t.entity_ids,old.id),
    version=t.version+1,updated_at=now()
    where t.owner_id=old.owner_id and t.entity_ids @> array[old.id];
  return old;
end $$;
