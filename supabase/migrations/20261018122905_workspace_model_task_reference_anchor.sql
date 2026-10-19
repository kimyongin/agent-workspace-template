-- Minimal task roots for actual conversion-reference baselines. #515 owns
-- public task CRUD, authorship, soft deletion, occurrences and writer policies.
alter table app.tasks alter column owner_id drop not null;
alter table app.tasks drop constraint tasks_owner_id_fkey;
alter table app.tasks add constraint task_legacy_author_fk foreign key(owner_id) references auth.users(id) on delete set null;
alter table app.tasks add constraint task_workspace_result_record_fk foreign key(workspace_id,result_record_id)
 references app.records(workspace_id,id) deferrable initially deferred;
create trigger workspace_model_anchor before insert or update on app.tasks
 for each row execute function private.guard_workspace_model_anchor();
drop policy tasks_owner on app.tasks;
create policy task_workspace_read on app.tasks for select to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('tasks','*','read'));
create policy task_workspace_insert on app.tasks for insert to app_user
 with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('tasks','*','write'));

create function private.guard_workspace_task_selection() returns trigger
 language plpgsql security definer set search_path='' as $$
declare requirements jsonb;available integer;
begin
 if new.workspace_id is null then return new;end if;
 if tg_op='UPDATE' and new.entity_ids is not distinct from old.entity_ids then return new;end if;
 if new.workspace_id is distinct from app.current_workspace_id() then
  raise exception 'workspace_denied' using errcode='42501';end if;
 perform app.authorize_workspace('[{"target_kind":"tasks","target_id":"*","access":"write"}]'::jsonb);
 if new.entity_ids is null or array_position(new.entity_ids,null) is not null then
  raise exception 'invalid_task_selection' using errcode='23514';end if;
 select count(*),coalesce(jsonb_agg(jsonb_build_object('target_kind','entity_type','target_id',e.entity_type_id::text,'access','read')),'[]'::jsonb)
  into available,requirements from app.entities e where e.workspace_id=new.workspace_id and e.id=any(new.entity_ids);
 perform app.authorize_workspace(requirements);
 if available<>cardinality(new.entity_ids) then
  raise exception 'task_selection_missing' using errcode='23503';end if;
 perform set_config('request.workspace_requirements',
  (coalesce(nullif(current_setting('request.workspace_requirements',true),''),'[]')::jsonb||requirements)::text,true);
 return new;
end $$;
revoke all on function private.guard_workspace_task_selection() from public,anon,authenticated,app_user,app_server,app_worker;
create trigger guard_workspace_task_selection before insert or update of entity_ids on app.tasks
 for each row execute function private.guard_workspace_task_selection();
