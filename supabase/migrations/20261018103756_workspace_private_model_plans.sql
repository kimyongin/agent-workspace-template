-- Prepared model changes remain private configuration until explicit publication.
-- Preserve unassigned historical rows; no owner is inferred as a workspace.
alter table app.data_model_changes add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.data_model_changes add column workspace_generation bigint;
alter table app.data_model_changes add column initiated_by uuid references auth.users(id) on delete set null;
alter table app.data_model_changes add column created_by uuid references auth.users(id) on delete set null;
alter table app.data_model_changes add column created_by_name text check(created_by_name is null or length(created_by_name)<=100);
alter table app.data_model_changes add constraint model_plan_workspace_generation check(workspace_id is null or (workspace_generation is not null and workspace_generation>0));

do $$
declare fks jsonb;r jsonb;
begin
 select jsonb_agg(jsonb_build_object('relation',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid))) into fks
 from pg_constraint c where c.contype='f' and c.confrelid='app.data_model_changes'::regclass;
 for r in select value from jsonb_array_elements(fks) loop
  execute format('alter table %s drop constraint %I',r->>'relation',r->>'name');
 end loop;
 alter table app.data_model_changes drop constraint data_model_changes_pkey;
 alter table app.data_model_changes add constraint model_plan_legacy_owner_key unique(owner_id,id);
 alter table app.data_model_changes alter column owner_id drop not null;
 alter table app.data_model_changes add constraint model_plan_workspace_key unique(workspace_id,id);
 for r in select value from jsonb_array_elements(fks) loop
  execute format('alter table %s add constraint %I %s',r->>'relation',r->>'name',r->>'definition');
 end loop;
end $$;
alter table app.data_model_changes drop constraint data_model_changes_owner_id_fkey;
alter table app.data_model_changes add constraint model_plan_legacy_author_fk foreign key(owner_id) references auth.users(id) on delete set null;

create function private.capture_workspace_model_plan_actor() returns trigger language plpgsql set search_path='' as $$
declare actor jsonb;
begin
 if tg_op='INSERT' then
  actor:=app.workspace_author();
  new.created_by:=(actor->>'created_by')::uuid;
  new.created_by_name:=actor->>'created_by_name';
  new.initiated_by:=auth.uid();
  new.workspace_generation:=app.workspace_generation();
 else
  if old.workspace_generation is distinct from new.workspace_generation then
   raise exception 'model_plan_generation_immutable' using errcode='23514';
  end if;
  if current_user='app_user' and (new.created_by is distinct from old.created_by or new.created_by_name is distinct from old.created_by_name) then
   raise exception 'model_plan_author_immutable' using errcode='23514';
  end if;
  if current_user='app_user' and new.initiated_by is distinct from old.initiated_by and new.initiated_by is distinct from auth.uid() then
   raise exception 'model_plan_initiator_invalid' using errcode='23514';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.capture_workspace_model_plan_actor() from public,anon,authenticated;
create trigger capture_workspace_model_plan_actor before insert or update on app.data_model_changes
 for each row execute function private.capture_workspace_model_plan_actor();
create trigger workspace_model_anchor before insert or update on app.data_model_changes
 for each row execute function private.guard_workspace_model_anchor();

drop policy data_model_change_owner on app.data_model_changes;
create policy workspace_model_plan_read on app.data_model_changes for select to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read'));
create policy workspace_model_plan_write on app.data_model_changes for all to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write'))
 with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write'));
