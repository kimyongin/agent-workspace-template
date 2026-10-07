-- Keep record tag IDs (including captured history) and give tasks an independent dictionary.
-- No events are fabricated for this representation migration; dates and names are preserved.
begin;
lock table app.tags, app.task_tags, app.record_tags, app.tasks in access exclusive mode;
alter table app.tags drop constraint tags_scope_check;
alter table app.tags alter column scope set default 'record';
create temporary table task_tag_mapping on commit drop as
  select id old_id, gen_random_uuid() new_id from app.tags where scope='activity';
insert into app.tags(id,owner_id,name,scope,version,created_at,updated_at)
  select m.new_id,t.owner_id,t.name,'task',1,t.created_at,t.updated_at
  from app.tags t join task_tag_mapping m on m.old_id=t.id;
update app.tags set scope='record',version=version+1 where scope='activity';
alter table app.tags add constraint tags_scope_check check(scope in ('entity','task','record'));

create or replace function private.check_tag_scope() returns trigger language plpgsql security invoker
set search_path='' as $$
declare wanted text;
begin
  wanted := case tg_table_name when 'entity_tags' then 'entity' when 'task_tags' then 'task' when 'record_tags' then 'record' end;
  if not exists(select 1 from app.tags where id=new.tag_id and owner_id=new.owner_id and scope=wanted) then
    raise exception 'tag scope mismatch' using errcode='23503';
  end if;
  return new;
end $$;
revoke all on function private.check_tag_scope() from public,anon,authenticated;
-- Old clients must reload before writing a task whose tag IDs have changed.
update app.tasks set version=version+1 where id in (select task_id from app.task_tags);
update app.task_tags tt set tag_id=m.new_id from task_tag_mapping m where tt.tag_id=m.old_id;
commit;
