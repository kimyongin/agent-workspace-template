-- The dictionary is shared workspace metadata. Target connections retain each
-- saved parent's independent authority, including deletion through FK cascades.
alter table app.task_tags add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.task_tags add column tag_scope text generated always as ('task'::text) stored;
alter table app.task_tags alter column owner_id drop not null;
alter table app.task_tags add unique(workspace_id,task_id,tag_id),
 add foreign key(workspace_id,task_id) references app.tasks(workspace_id,id) on delete cascade,
 add foreign key(workspace_id,tag_id,tag_scope) references app.tags(workspace_id,id,scope) on delete cascade;
alter table app.task_tags drop constraint task_tags_owner_id_fkey;
alter table app.task_tags add constraint task_tag_legacy_author_fk foreign key(owner_id) references auth.users(id) on delete set null;
create trigger workspace_model_anchor before insert or update on app.task_tags for each row execute function private.guard_workspace_model_anchor();
create policy task_tag_workspace_scope on app.task_tags as restrictive for all to app_user
 using(workspace_id=app.current_workspace_id()) with check(workspace_id=app.current_workspace_id() and owner_id is null);
create policy task_tag_workspace_read on app.task_tags for select to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('tasks','*','read'));
create policy task_tag_workspace_write on app.task_tags for all to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('tasks','*','write'))
 with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('tasks','*','write'));

create or replace function private.check_tag_scope() returns trigger language plpgsql security invoker set search_path='' as $$
declare wanted text;
begin
 -- Every scoped association now has an actual workspace+tag+fixed-scope FK.
 if nullif(to_jsonb(new)->>'workspace_id','') is not null then return new;end if;
 wanted:=case tg_table_name when 'entity_tags' then 'entity' when 'task_tags' then 'task' when 'record_tags' then 'record' end;
 if not exists(select 1 from app.tags where id=new.tag_id and owner_id=new.owner_id and scope=wanted) then
  raise exception 'tag scope mismatch' using errcode='23503';end if;
 return new;
end $$;

create function app.workspace_tag_delete_allowed(p_tag text) returns boolean
 language sql stable security definer set search_path='' as $$
 select private.workspace_member(auth.uid(),app.current_workspace_id())
 and exists(select 1 from app.tags where workspace_id=app.current_workspace_id() and id=p_tag)
 and not exists(select 1 from app.entity_tags l join app.entities e on e.workspace_id=l.workspace_id and e.id=l.entity_id
  where l.workspace_id=app.current_workspace_id() and l.tag_id=p_tag and not private.workspace_allows(auth.uid(),l.workspace_id,'entity_type',e.entity_type_id::text,'write'))
 and not exists(select 1 from app.task_tags l where l.workspace_id=app.current_workspace_id() and l.tag_id=p_tag
  and not private.workspace_allows(auth.uid(),l.workspace_id,'tasks','*','write'))
 and not exists(select 1 from app.record_tags l join app.records r on r.workspace_id=l.workspace_id and r.id=l.record_id
  left join app.entities e on e.workspace_id=r.workspace_id and e.id=r.entity_id
  where l.workspace_id=app.current_workspace_id() and l.tag_id=p_tag and not case when r.task_id is not null
   then private.workspace_allows(auth.uid(),r.workspace_id,'tasks','*','write')
   else private.workspace_allows(auth.uid(),r.workspace_id,'entity_type',e.entity_type_id::text,'write') end)
$$;
revoke all on function app.workspace_tag_delete_allowed(text) from public,anon,authenticated,app_worker;
grant execute on function app.workspace_tag_delete_allowed(text) to app_user;
create policy tag_workspace_scope on app.tags as restrictive for all to app_user
 using(workspace_id=app.current_workspace_id() and app.is_workspace_member(workspace_id))
 with check(workspace_id=app.current_workspace_id() and owner_id is null and app.is_workspace_member(workspace_id));
create policy tag_workspace_read on app.tags for select to app_user
 using(workspace_id=app.current_workspace_id() and app.is_workspace_member(workspace_id));
create policy tag_workspace_insert on app.tags for insert to app_user
 with check(workspace_id=app.current_workspace_id() and owner_id is null and app.is_workspace_member(workspace_id));
create policy tag_workspace_update on app.tags for update to app_user
 using(workspace_id=app.current_workspace_id() and app.is_workspace_member(workspace_id))
 with check(workspace_id=app.current_workspace_id() and owner_id is null and app.is_workspace_member(workspace_id));
create policy tag_workspace_delete on app.tags for delete to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_tag_delete_allowed(id));
create function private.guard_workspace_tag_dictionary() returns trigger language plpgsql set search_path='' as $$
begin
 if old.workspace_id is not null and (new.id is distinct from old.id or new.scope is distinct from old.scope) then
  raise exception 'tag_dictionary_scope_immutable' using errcode='23514';end if;
 return new;
end $$;
revoke all on function private.guard_workspace_tag_dictionary() from public,anon,authenticated,app_user,app_worker;
create trigger workspace_tag_dictionary before update on app.tags for each row execute function private.guard_workspace_tag_dictionary();
