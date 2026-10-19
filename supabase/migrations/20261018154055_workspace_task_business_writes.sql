-- Task business writes share the workspace root independently of settings.
-- Historical legacy rows remain untouched for the explicit #518 cleanup.
alter table app.tasks add column created_by uuid references auth.users(id) on delete set null;
alter table app.tasks add column created_by_name text check(created_by_name is null or length(created_by_name)<=100);

create function private.guard_workspace_task_author() returns trigger
 language plpgsql set search_path='' as $$
declare actor jsonb;
begin
 if new.workspace_id is null then return new;end if;
 if tg_op='INSERT' and current_user='app_user' then
  actor:=app.workspace_author();
  new.created_by:=(actor->>'created_by')::uuid;
  new.created_by_name:=actor->>'created_by_name';
 elsif tg_op='UPDATE' and current_user='app_user' and
  (new.created_by is distinct from old.created_by or new.created_by_name is distinct from old.created_by_name) then
  raise exception 'task_author_immutable' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function private.guard_workspace_task_author() from public,anon,authenticated,app_server,app_user,app_worker;
create trigger workspace_task_author before insert or update on app.tasks
 for each row execute function private.guard_workspace_task_author();

create policy task_workspace_update on app.tasks for update to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('tasks','*','write'))
 with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('tasks','*','write'));
