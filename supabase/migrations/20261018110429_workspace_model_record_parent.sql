-- New model conversion records have one immutable business parent. Existing
-- unassigned records remain untouched until the explicitly approved #518 cleanup.
alter table app.records add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.records add column entity_id text;
alter table app.records alter column owner_id drop not null;
alter table app.records add constraint record_workspace_key unique(workspace_id,id);
alter table app.records add constraint record_workspace_entity_fk foreign key(workspace_id,entity_id)
 references app.entities(workspace_id,id);
alter table app.records add constraint record_workspace_task_fk foreign key(workspace_id,task_id)
 references app.tasks(workspace_id,id);
alter table app.records add constraint record_workspace_exact_parent check(workspace_id is null or ((entity_id is not null)::integer+(task_id is not null)::integer=1));
alter table app.records add constraint record_workspace_no_legacy_parents check(workspace_id is null or (cardinality(entity_ids)=0 and entity_context='[]'::jsonb));
alter table app.records drop constraint records_owner_id_fkey;
alter table app.records add constraint record_legacy_author_fk foreign key(owner_id) references auth.users(id) on delete set null;
alter table app.records add column created_by uuid references auth.users(id) on delete set null;
alter table app.records add column created_by_name text check(created_by_name is null or length(created_by_name)<=100);

-- No historical NULL anchor can be adopted by a later UPDATE. Scoped ownership
-- cannot be changed back into an Auth-owned row, including privileged writers.
create or replace function private.guard_workspace_model_anchor() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.workspace_id is null or new.workspace_id is distinct from app.current_workspace_id() or new.owner_id is not null then
   raise exception 'workspace_model_anchor_required' using errcode='23514';
  end if;
 else
  if new.workspace_id is distinct from old.workspace_id then
   raise exception 'workspace_model_anchor_immutable' using errcode='23514';
  end if;
  if old.workspace_id is not null and new.owner_id is not null then
   raise exception 'workspace_model_anchor_required' using errcode='23514';
  end if;
 end if;
 return new;
end $$;
create trigger workspace_model_anchor before insert or update on app.records
 for each row execute function private.guard_workspace_model_anchor();

create function private.guard_workspace_record_parent() returns trigger language plpgsql set search_path='' as $$
declare actor jsonb;
begin
 if tg_op='UPDATE' and old.workspace_id is not null then
  if new.entity_id is distinct from old.entity_id or new.task_id is distinct from old.task_id then
   raise exception 'record_parent_immutable' using errcode='23514';
  end if;
  if current_user='app_user' and (new.created_by is distinct from old.created_by or new.created_by_name is distinct from old.created_by_name) then
   raise exception 'record_author_immutable' using errcode='23514';
  end if;
 elsif tg_op='INSERT' and current_user='app_user' and new.workspace_id is not null then
  actor:=app.workspace_author();
  new.created_by:=(actor->>'created_by')::uuid;new.created_by_name:=actor->>'created_by_name';
 end if;
 return new;
end $$;
revoke all on function private.guard_workspace_record_parent() from public,anon,authenticated;
create trigger workspace_record_parent before insert or update on app.records
 for each row execute function private.guard_workspace_record_parent();

-- Parent facts are resolved from the actual stored workspace entity. A task
-- parent needs only task permission; neither branch grants general settings.
create policy record_workspace_read on app.records for select to app_user
 using(workspace_id=app.current_workspace_id() and (
  (task_id is not null and app.workspace_allows('tasks','*','read')) or
  (entity_id is not null and exists(select 1 from app.entities e where e.workspace_id=records.workspace_id and e.id=records.entity_id and app.workspace_allows('entity_type',e.entity_type_id::text,'read')))));
create policy record_workspace_insert on app.records for insert to app_user
 with check(workspace_id=app.current_workspace_id() and owner_id is null and (
  (task_id is not null and app.workspace_allows('tasks','*','write')) or
  (entity_id is not null and exists(select 1 from app.entities e where e.workspace_id=records.workspace_id and e.id=records.entity_id and app.workspace_allows('entity_type',e.entity_type_id::text,'write')))));
create policy record_workspace_update on app.records for update to app_user
 using(workspace_id=app.current_workspace_id() and (
  (task_id is not null and app.workspace_allows('tasks','*','write')) or
  (entity_id is not null and exists(select 1 from app.entities e where e.workspace_id=records.workspace_id and e.id=records.entity_id and app.workspace_allows('entity_type',e.entity_type_id::text,'write')))))
 with check(workspace_id=app.current_workspace_id() and owner_id is null and (
  (task_id is not null and app.workspace_allows('tasks','*','write')) or
  (entity_id is not null and exists(select 1 from app.entities e where e.workspace_id=records.workspace_id and e.id=records.entity_id and app.workspace_allows('entity_type',e.entity_type_id::text,'write')))));
