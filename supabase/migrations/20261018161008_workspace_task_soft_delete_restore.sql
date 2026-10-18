-- Task roots remain in place for immutable result/occurrence ownership.
alter table app.tasks add column deleted_at timestamptz(3);
grant select(deleted_at),update(deleted_at) on app.tasks to app_user;
create index task_workspace_active_updated on app.tasks(workspace_id,updated_at desc,id desc) where deleted_at is null;

create policy record_workspace_delete on app.records for delete to app_user
 using(workspace_id=app.current_workspace_id() and (
  (task_id is not null and app.workspace_allows('tasks','*','write')) or
  (entity_id is not null and exists(select 1 from app.entities e where e.workspace_id=records.workspace_id
   and e.id=records.entity_id and app.workspace_allows('entity_type',e.entity_type_id::text,'write')))));

drop policy record_workspace_insert on app.records;
create policy record_workspace_insert on app.records for insert to app_user
 with check(workspace_id=app.current_workspace_id() and owner_id is null and (
  (task_id is not null and app.workspace_allows('tasks','*','write') and exists(select 1 from app.tasks t
    where t.workspace_id=records.workspace_id and t.id=records.task_id and (t.deleted_at is null or records.record_kind='change'))) or
  (entity_id is not null and exists(select 1 from app.entities e where e.workspace_id=records.workspace_id
   and e.id=records.entity_id and app.workspace_allows('entity_type',e.entity_type_id::text,'write')))));

-- Extend the existing target-specific preparation seam, without creating a
-- second template reader or weakening its current task WRITE authorization.
do $$ declare definition text;before text;after text;
begin
 select pg_get_functiondef('app.workspace_business_template(text,text,text,uuid)'::regprocedure) into definition;
 before:='(p_model=''task'' and p_action not in (''create'',''update'',''delete'',''stop'',''resume''))';
 after:='(p_model=''task'' and p_action not in (''create'',''update'',''delete'',''restore'',''stop'',''resume''))';
 if strpos(definition,before)=0 then raise exception 'unexpected_task_template_guard';end if;
 execute replace(definition,before,after);
 select pg_get_functiondef('app.set_workspace_task_associations(text,text[],jsonb)'::regprocedure) into definition;
 before:='if target.entity_ids is distinct from before_ids then';
 after:='if target.deleted_at is not null then raise exception ''workspace_denied'' using errcode=''42501'';end if;
 if target.entity_ids is distinct from before_ids then';
 if strpos(definition,before)=0 then raise exception 'unexpected_task_selection_guard';end if;
 execute replace(definition,before,after);
end $$;
