-- The tuple is the actual ID; every owner may independently use the same tuple.
-- No UUID alias remains. Old UUIDs become exact external IDs of the app source.
lock table app.entities,app.entity_tags,app.tasks,app.records in access exclusive mode;
drop trigger deleted_entity_task_links on app.entities;
drop function app.detach_deleted_task_entity();
alter table app.entity_tags drop constraint entity_tags_entity_id_owner_id_fkey;
alter table app.entity_tags drop constraint entity_tags_pkey;
alter table app.entities drop constraint entities_pkey;
alter table app.entities drop constraint entities_id_owner_id_key;
alter table app.entities alter column id drop default;
alter table app.entities alter column id type text using 'app:'||id::text;
alter table app.entities add column source text not null default 'app',
  add column external_id text,
  add column deleted_at timestamptz(3);
update app.entities set external_id=substring(id from 5);
alter table app.entities alter column source drop default;
alter table app.entities alter column external_id set not null;
alter table app.entities add primary key(owner_id,id),
  add unique(owner_id,source,external_id),
  add constraint entity_source_code check(source ~ '^[a-z][a-z0-9_-]{0,31}$'),
  add constraint entity_external_id_length check(char_length(external_id) between 1 and 200),
  add constraint entity_external_id_controls check(external_id !~ '[[:cntrl:]]'),
  add constraint entity_tuple_id check(id=source||':'||external_id);
alter table app.entity_tags alter column entity_id type text using 'app:'||entity_id::text;
alter table app.entity_tags add primary key(owner_id,entity_id,tag_id),
  add foreign key(owner_id,entity_id) references app.entities(owner_id,id) on update cascade on delete cascade;

create function pg_temp.entity_ids(old uuid[]) returns text[] language sql immutable as $$
  select coalesce(array_agg('app:'||id::text order by ordinal),'{}'::text[]) from unnest(old) with ordinality as ids(id,ordinal)
$$;
alter table app.tasks alter column entity_ids drop default;
alter table app.records alter column entity_ids drop default;
alter table app.tasks alter column entity_ids type text[] using pg_temp.entity_ids(entity_ids);
alter table app.records alter column entity_ids type text[] using pg_temp.entity_ids(entity_ids);
alter table app.tasks alter column entity_ids set default '{}';
alter table app.records alter column entity_ids set default '{}';
create function pg_temp.entity_context(old jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(context || jsonb_build_object('id','app:'||(context->>'id')) order by ordinal),'[]'::jsonb)
  from jsonb_array_elements(old) with ordinality as contexts(context,ordinal)
$$;
update app.tasks set entity_context=pg_temp.entity_context(entity_context);
update app.records set entity_context=pg_temp.entity_context(entity_context);
-- Historical fact snapshots keep their values; structured references migrate with current references.
create function pg_temp.entity_fact_refs(value jsonb) returns jsonb language plpgsql immutable as $$
declare result jsonb:=value; ids jsonb; item jsonb; key text;
begin
  if value is null then return value; end if;
  if jsonb_typeof(value)='object' then
    for key,item in select * from jsonb_each(value) loop
      if key='entity_ids' and jsonb_typeof(item)='array' then
        select coalesce(jsonb_agg('app:'||v),'[]'::jsonb) into ids from jsonb_array_elements_text(item) v;
        result=jsonb_set(result,array[key],ids);
      elsif key='entity_context' and jsonb_typeof(item)='array' then
        result=jsonb_set(result,array[key],pg_temp.entity_context(item));
      elsif key='entity_id' and jsonb_typeof(item)='string' then
        result=jsonb_set(result,array[key],to_jsonb('app:'||(item#>>'{}')));
      elsif jsonb_typeof(item) in ('object','array') then
        result=jsonb_set(result,array[key],pg_temp.entity_fact_refs(item));
      end if;
    end loop;
  elsif jsonb_typeof(value)='array' then
    select coalesce(jsonb_agg(pg_temp.entity_fact_refs(v)),'[]'::jsonb) into result from jsonb_array_elements(value) v;
  end if;
  return result;
end $$;
update app.records set change_metadata=pg_temp.entity_fact_refs(change_metadata) where change_metadata is not null;
update app.records set change_metadata=change_metadata || jsonb_build_object(
  'target_id','app:'||(change_metadata->>'target_id'),
  'path',case when change_metadata->>'path' is null then null else '/entities/app%3A'||(change_metadata->>'target_id') end)
  where change_metadata->>'target_kind'='entity';

-- Only the actor's rows are accessible. Called inside the same transaction as version checks and change memo.
create function app.rekey_entity(old_id text,new_source text,new_external_id text) returns void
language plpgsql security invoker set search_path='' as $$
declare next_id text:=new_source||':'||new_external_id; entity_owner uuid; target record;
begin
  select owner_id into entity_owner from app.entities where id=old_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then raise exception 'entity not found' using errcode='23503'; end if;
  -- Unique constraints include deleted entities, so collision always aborts the entire operation.
  update app.entities set id=next_id,source=new_source,external_id=new_external_id,version=version+1,updated_at=now()
    where owner_id=entity_owner and id=old_id;
  update app.tasks t set entity_ids=array_replace(entity_ids,old_id,next_id),
    entity_context=(select coalesce(jsonb_agg(case when context->>'id'=old_id then context||jsonb_build_object('id',next_id) else context end order by ordinal),'[]'::jsonb)
      from jsonb_array_elements(t.entity_context) with ordinality as contexts(context,ordinal)),
    version=version+1,updated_at=now()
    where owner_id=entity_owner and (old_id=any(entity_ids) or entity_context @> jsonb_build_array(jsonb_build_object('id',old_id)));
  update app.records r set entity_ids=array_replace(entity_ids,old_id,next_id),
    entity_context=(select coalesce(jsonb_agg(case when context->>'id'=old_id then context||jsonb_build_object('id',next_id) else context end order by ordinal),'[]'::jsonb)
      from jsonb_array_elements(r.entity_context) with ordinality as contexts(context,ordinal)),
    change_metadata=case when change_metadata->>'target_kind'='entity' and change_metadata->>'target_id'=old_id
      then change_metadata||jsonb_build_object('target_id',next_id,'path',case when change_metadata->>'path' is null then null else '/entities/'||app.entity_path_segment(next_id) end)
      else change_metadata end,
    version=version+1,updated_at=now()
    where owner_id=entity_owner and (old_id=any(entity_ids) or entity_context @> jsonb_build_array(jsonb_build_object('id',old_id))
      or (change_metadata->>'target_kind'='entity' and change_metadata->>'target_id'=old_id));
end $$;
-- Match encodeURIComponent for structured navigation paths, including UTF-8 bytes.
create function app.entity_path_segment(value text) returns text language plpgsql immutable security invoker set search_path='' as $$
declare bytes bytea:=convert_to(value,'UTF8'); result text:=''; byte integer;
begin
  for i in 0..length(bytes)-1 loop
    byte=get_byte(bytes,i);
    result=result||case when byte between 65 and 90 or byte between 97 and 122 or byte between 48 and 57 or byte in (45,95,46,33,126,42,39,40,41)
      then chr(byte) else '%'||upper(lpad(to_hex(byte),2,'0')) end;
  end loop;
  return result;
end $$;
revoke all on function app.rekey_entity(text,text,text),app.entity_path_segment(text) from public,anon,authenticated;
grant execute on function app.rekey_entity(text,text,text),app.entity_path_segment(text) to app_user;
-- Entity deletion is a reversible domain command; only account deletion/admin cleanup is physical.
revoke delete on app.entities from app_user;
