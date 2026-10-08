begin;
-- Retired snapshots also contain structured entity references; memo/body strings are never rewritten.
create function app.rewrite_entity_refs(value jsonb,previous_id text,next_id text,entity_object boolean default false) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb:=value; item jsonb; key text; replacement jsonb;
begin
  if value is null then return null; end if;
  if jsonb_typeof(value)='array' then
    select coalesce(jsonb_agg(app.rewrite_entity_refs(v,previous_id,next_id,entity_object) order by ordinal),'[]'::jsonb)
      into result from jsonb_array_elements(value) with ordinality as items(v,ordinal);
  elsif jsonb_typeof(value)='object' then
    for key,item in select * from jsonb_each(value) loop
      if key='entity_ids' and jsonb_typeof(item)='array' then
        select coalesce(jsonb_agg(case when v=previous_id then next_id else v end order by ordinal),'[]'::jsonb)
          into replacement from jsonb_array_elements_text(item) with ordinality as items(v,ordinal);
        result=jsonb_set(result,array[key],replacement);
      elsif (key='entity_id' or (entity_object and key='id')) and item=to_jsonb(previous_id) then
        result=jsonb_set(result,array[key],to_jsonb(next_id));
      elsif jsonb_typeof(item) in ('array','object') then
        result=jsonb_set(result,array[key],app.rewrite_entity_refs(item,previous_id,next_id,key='entity_context' or (entity_object and key in ('before','after'))));
      end if;
    end loop;
    if value->>'target_kind'='entity' and value->>'target_id'=previous_id then
      result=result||jsonb_build_object('target_id',next_id,'path',case when value->>'path' is null then null else '/entities/'||app.entity_path_segment(next_id) end);
    end if;
  end if;
  return result;
end $$;
revoke all on function app.rewrite_entity_refs(jsonb,text,text,boolean) from public,anon,authenticated;
grant execute on function app.rewrite_entity_refs(jsonb,text,text,boolean) to app_user;

-- Migrate entity-object IDs nested inside legacy event before/after snapshots.
update app.records r set change_metadata=app.rewrite_entity_refs(change_metadata,
  substring(change_metadata->>'target_id' from 5),change_metadata->>'target_id',true)
  where change_metadata->>'target_kind'='entity' and change_metadata->>'target_id' like 'app:%';
create or replace function app.rekey_entity(old_id text,new_source text,new_external_id text) returns void
language plpgsql security invoker set search_path='' as $$
declare next_id text:=new_source||':'||new_external_id; entity_owner uuid;
begin
  select owner_id into entity_owner from app.entities where id=old_id and owner_id=(select auth.uid()) and deleted_at is null for update;
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
commit;
