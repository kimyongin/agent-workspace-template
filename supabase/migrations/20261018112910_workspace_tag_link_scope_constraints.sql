create or replace function private.check_tag_scope() returns trigger language plpgsql security invoker
set search_path='' as $$
declare wanted text;
begin
  -- Scoped entity/record associations have a generated fixed scope protected by
  -- their actual workspace+tag+scope FK. Preserve the old guard for legacy rows
  -- and task links until their feature transition is complete.
  if tg_table_name in ('entity_tags','record_tags') and nullif(to_jsonb(new)->>'workspace_id','') is not null then return new;end if;
  wanted := case tg_table_name when 'entity_tags' then 'entity' when 'task_tags' then 'task' when 'record_tags' then 'record' end;
  if not exists(select 1 from app.tags where id=new.tag_id and owner_id=new.owner_id and scope=wanted) then
    raise exception 'tag scope mismatch' using errcode='23503';
  end if;
  return new;
end $$;
