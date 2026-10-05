-- Bridge old scalar-only writers during rolling consumer migration. Existing row policies/grants still apply.
create function app.sync_legacy_entity_selection() returns trigger
language plpgsql security invoker set search_path='' as $$
declare entity_title text;
begin
  if tg_op='INSERT' then
    if new.entity_id is null or cardinality(new.entity_ids)>0 then return new; end if;
  else
    if new.entity_id is not distinct from old.entity_id
       or new.entity_ids is distinct from old.entity_ids
       or new.entity_context is distinct from old.entity_context then return new; end if;
    if new.entity_id is null then
      -- FK deletion removes live navigation; captured record identity/name stays as knowledge.
      if tg_table_name='tasks' then
        new.entity_ids=array_remove(old.entity_ids,old.entity_id);
        select coalesce(jsonb_agg(context),'[]'::jsonb) into new.entity_context
          from jsonb_array_elements(old.entity_context) context where context->>'id'<>old.entity_id::text;
        new.entity_id=(select id from app.entities where id=any(new.entity_ids) and owner_id=new.owner_id order by id limit 1);
      end if;
      return new;
    end if;
  end if;
  select prop1 into entity_title from app.entities where id=new.entity_id and owner_id=new.owner_id for key share;
  if not found then raise exception 'invalid entity reference' using errcode='23503'; end if;
  new.entity_ids=array[new.entity_id];
  new.entity_context=jsonb_build_array(jsonb_build_object('id',new.entity_id,'title',entity_title,
    'captured_at',now(),'source','selection'));
  return new;
end $$;
revoke all on function app.sync_legacy_entity_selection() from public,anon,authenticated;
create trigger task_legacy_entity_selection before insert or update of entity_id on app.tasks
  for each row execute function app.sync_legacy_entity_selection();
create trigger record_legacy_entity_selection before insert or update of entity_id on app.records
  for each row execute function app.sync_legacy_entity_selection();

-- A deleted non-primary selected entity has no scalar FK to cascade. Remove that live task link too.
create function app.detach_deleted_task_entity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  update app.tasks t set entity_ids=array_remove(t.entity_ids,old.id),
    entity_context=(select coalesce(jsonb_agg(context),'[]'::jsonb)
      from jsonb_array_elements(t.entity_context) context where context->>'id'<>old.id::text),
    entity_id=(select id from app.entities where id=any(t.entity_ids) and id<>old.id and owner_id=t.owner_id order by id limit 1),
    version=t.version+1,updated_at=now()
    where t.owner_id=old.owner_id and t.entity_ids @> array[old.id];
  return old;
end $$;
revoke all on function app.detach_deleted_task_entity() from public,anon,authenticated;
create trigger deleted_entity_task_links after delete on app.entities
  for each row execute function app.detach_deleted_task_entity();
