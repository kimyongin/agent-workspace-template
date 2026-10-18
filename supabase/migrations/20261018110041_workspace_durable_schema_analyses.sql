-- Durable sources belong to a workspace; historical unassigned rows remain untouched.
-- No owner is adopted as a workspace and no existing business row is deleted.
alter table app.entity_schema_changes add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.entity_schema_analyses add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.entity_schema_migrations add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table private.entity_schema_analysis_rows add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table private.entity_schema_migration_rows add column workspace_id uuid references app.workspaces(id) on delete cascade;

-- Preserve every legacy FK while replacing owner primary keys with nullable legacy keys.
do $$
declare refs jsonb;r jsonb;t text;pk text;
begin
 select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid))) into refs
 from pg_constraint c where c.contype='f' and c.confrelid in
 ('app.entity_schema_changes'::regclass,'app.entity_schema_analyses'::regclass,'app.entity_schema_migrations'::regclass,
  'private.entity_schema_analysis_rows'::regclass,'private.entity_schema_migration_rows'::regclass,'app.data_model_children'::regclass);
 for r in select value from jsonb_array_elements(coalesce(refs,'[]'::jsonb)) loop
  execute format('alter table %s drop constraint %I',r->>'table',r->>'name');
 end loop;
 foreach t in array array['app.entity_schema_changes','app.entity_schema_analyses','app.entity_schema_migrations',
  'private.entity_schema_analysis_rows','private.entity_schema_migration_rows','app.data_model_children'] loop
  select conname into pk from pg_constraint where conrelid=t::regclass and contype='p';
  execute format('alter table %s drop constraint %I',t,pk);
  if t='app.data_model_children' then
   execute format('alter table %s add unique(owner_id,model_id,type_ref)',t);
  elsif t='private.entity_schema_analysis_rows' then
   execute format('alter table %s add unique(owner_id,analysis_id,entity_id)',t);
  elsif t='private.entity_schema_migration_rows' then
   execute format('alter table %s add unique(owner_id,job_id,entity_id)',t);
  else execute format('alter table %s add unique(owner_id,id)',t);
  end if;
  execute format('alter table %s alter column owner_id drop not null',t);
 end loop;
 for r in select value from jsonb_array_elements(coalesce(refs,'[]'::jsonb)) loop
  execute format('alter table %s add constraint %I %s',r->>'table',r->>'name',r->>'definition');
 end loop;
end $$;

alter table app.entity_schema_changes add unique(workspace_id,id),add unique(workspace_id,type_id,id),
 add unique(workspace_id,model_change_id,type_id,id),
 add foreign key(workspace_id,type_id) references app.entity_types(workspace_id,id) on delete cascade,
 add foreign key(workspace_id,model_change_id) references app.data_model_changes(workspace_id,id) on delete cascade;
alter table app.entity_schema_analyses add unique(workspace_id,id),add unique(workspace_id,type_id,change_id,id),
 add foreign key(workspace_id,type_id,change_id) references app.entity_schema_changes(workspace_id,type_id,id) on delete cascade;
alter table app.entity_schema_migrations add unique(workspace_id,id),add unique(workspace_id,model_change_id,type_id,change_id,id),
 add foreign key(workspace_id,type_id) references app.entity_types(workspace_id,id) on delete cascade,
 add foreign key(workspace_id,type_id,change_id) references app.entity_schema_changes(workspace_id,type_id,id),
 add foreign key(workspace_id,type_id,change_id,analysis_id) references app.entity_schema_analyses(workspace_id,type_id,change_id,id),
 add foreign key(workspace_id,model_change_id) references app.data_model_changes(workspace_id,id) on delete cascade,
 add foreign key(workspace_id,recovery_source_job_id) references app.entity_schema_migrations(workspace_id,id) on delete cascade;
alter table app.entity_schema_changes
 add foreign key(workspace_id,recovery_source_job_id) references app.entity_schema_migrations(workspace_id,id) on delete cascade,
 add foreign key(workspace_id,type_id,id,analysis_id) references app.entity_schema_analyses(workspace_id,type_id,change_id,id) deferrable initially deferred;
alter table private.entity_schema_analysis_rows add unique(workspace_id,analysis_id,entity_id),
 add foreign key(workspace_id,analysis_id) references app.entity_schema_analyses(workspace_id,id) on delete cascade,
 add foreign key(workspace_id,entity_id) references app.entities(workspace_id,id);
alter table private.entity_schema_migration_rows add unique(workspace_id,job_id,entity_id),
 add foreign key(workspace_id,job_id) references app.entity_schema_migrations(workspace_id,id) on delete cascade,
 add foreign key(workspace_id,entity_id) references app.entities(workspace_id,id);
alter table app.data_model_children add unique(workspace_id,model_id,type_ref),add unique(workspace_id,model_id,type_id),
 add unique(workspace_id,change_id),
 add foreign key(workspace_id,type_id) references app.entity_types(workspace_id,id),
 add foreign key(workspace_id,model_id,type_id,change_id) references app.entity_schema_changes(workspace_id,model_change_id,type_id,id) on delete cascade,
 add foreign key(workspace_id,type_id,change_id,analysis_id) references app.entity_schema_analyses(workspace_id,type_id,change_id,id),
 add foreign key(workspace_id,model_id,type_id,change_id,job_id) references app.entity_schema_migrations(workspace_id,model_change_id,type_id,change_id,id);
create unique index workspace_schema_one_active_job on app.entity_schema_migrations(workspace_id,type_id)
 where status in ('queued','preparing','ready_to_commit','committing');

alter table app.entity_schema_changes add column workspace_generation bigint,
 add column initiated_by uuid references auth.users(id) on delete set null,
 add column created_by uuid references auth.users(id) on delete set null,
 add column created_by_name text check(created_by_name is null or length(created_by_name)<=100),
 add column required_kind_ids uuid[] not null default '{}',
 add check(workspace_id is null or (workspace_generation is not null and workspace_generation>0 and cardinality(required_kind_ids)>0));
alter table app.entity_schema_analyses add column workspace_generation bigint,
 add column initiated_by uuid references auth.users(id) on delete set null,
 add column created_by uuid references auth.users(id) on delete set null,
 add column created_by_name text check(created_by_name is null or length(created_by_name)<=100),
 add column required_kind_ids uuid[] not null default '{}',
 add check(workspace_id is null or (workspace_generation is not null and workspace_generation>0 and cardinality(required_kind_ids)>0));
alter table app.entity_schema_migrations add column workspace_generation bigint,
 add column initiated_by uuid references auth.users(id) on delete set null,
 add column created_by uuid references auth.users(id) on delete set null,
 add column created_by_name text check(created_by_name is null or length(created_by_name)<=100),
 add column required_kind_ids uuid[] not null default '{}',
 add check(workspace_id is null or (workspace_generation is not null and workspace_generation>0 and cardinality(required_kind_ids)>0));

-- Server-derived execution facts are captured independently on every accepted job.
create function private.capture_workspace_schema_actor() returns trigger language plpgsql set search_path='' as $$
declare actor jsonb;parent uuid;kinds uuid[];
begin
 if tg_op='INSERT' then
  actor:=app.workspace_author();
  new.created_by:=(actor->>'created_by')::uuid;new.created_by_name:=actor->>'created_by_name';
  new.initiated_by:=new.created_by;new.workspace_generation:=app.workspace_generation();
  parent:=(to_jsonb(new)->>'model_change_id')::uuid;
  if tg_table_name='entity_schema_analyses' then
   select c.model_change_id into parent from app.entity_schema_changes c
    where c.workspace_id=new.workspace_id and c.id=new.change_id and c.type_id=new.type_id;
  end if;
  select array_agg(distinct id order by id) into kinds from (
   select new.type_id as id union all
   select value::uuid from app.data_model_changes g cross join lateral
    jsonb_array_elements_text(coalesce(g.plan->'protected_kind_ids','[]'::jsonb))
    where g.workspace_id=new.workspace_id and g.id=parent) required;
  new.required_kind_ids:=kinds;
 else
  if new.workspace_generation is distinct from old.workspace_generation or new.required_kind_ids is distinct from old.required_kind_ids then
   raise exception 'schema_execution_scope_immutable' using errcode='23514';
  end if;
  if current_user='app_user' then
   actor:=app.workspace_author();
   if old.workspace_generation is distinct from app.workspace_generation() then
    raise exception 'schema_plan_stale' using errcode='P0001';
   end if;
   if new.created_by is distinct from old.created_by or new.created_by_name is distinct from old.created_by_name then
    raise exception 'schema_author_immutable' using errcode='23514';
   end if;
   if new.initiated_by is distinct from old.initiated_by and new.initiated_by is distinct from (actor->>'created_by')::uuid then
    raise exception 'schema_initiator_invalid' using errcode='23514';
   end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function private.capture_workspace_schema_actor() from public,anon,authenticated,app_user,app_server,app_worker;
create trigger capture_workspace_schema_actor before insert or update on app.entity_schema_changes for each row execute function private.capture_workspace_schema_actor();
create trigger capture_workspace_schema_actor before insert or update on app.entity_schema_analyses for each row execute function private.capture_workspace_schema_actor();
create trigger capture_workspace_schema_actor before insert or update on app.entity_schema_migrations for each row execute function private.capture_workspace_schema_actor();
create trigger workspace_schema_anchor before insert or update on app.entity_schema_changes for each row execute function private.guard_workspace_model_anchor();
create trigger workspace_schema_anchor before insert or update on app.entity_schema_analyses for each row execute function private.guard_workspace_model_anchor();
create trigger workspace_schema_anchor before insert or update on app.entity_schema_migrations for each row execute function private.guard_workspace_model_anchor();
create trigger workspace_schema_anchor before insert or update on private.entity_schema_analysis_rows for each row execute function private.guard_workspace_model_anchor();
create trigger workspace_schema_anchor before insert or update on private.entity_schema_migration_rows for each row execute function private.guard_workspace_model_anchor();
drop policy schema_change_owner on app.entity_schema_changes;
create policy workspace_schema_read on app.entity_schema_changes for select to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read'));
create policy workspace_schema_write on app.entity_schema_changes for all to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write')) with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write'));
drop policy schema_analysis_owner on app.entity_schema_analyses;
create policy workspace_schema_read on app.entity_schema_analyses for select to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read') and app.workspace_allows('entity_type',type_id::text,'read'));
create policy workspace_schema_write on app.entity_schema_analyses for all to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write')) with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write'));
drop policy migration_owner on app.entity_schema_migrations;
create policy workspace_schema_read on app.entity_schema_migrations for select to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read') and app.workspace_allows('entity_type',type_id::text,'read'));
create policy workspace_schema_write on app.entity_schema_migrations for all to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write')) with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write'));
drop policy schema_analysis_rows_owner on private.entity_schema_analysis_rows;
create policy workspace_schema_read on private.entity_schema_analysis_rows for select to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read') and exists(select 1 from app.entity_schema_analyses a where a.workspace_id=entity_schema_analysis_rows.workspace_id and a.id=entity_schema_analysis_rows.analysis_id and app.workspace_allows('entity_type',a.type_id::text,'read')));
create policy workspace_schema_write on private.entity_schema_analysis_rows for all to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write') and exists(select 1 from app.entity_schema_analyses a where a.workspace_id=entity_schema_analysis_rows.workspace_id and a.id=entity_schema_analysis_rows.analysis_id and app.workspace_allows('entity_type',a.type_id::text,'write'))) with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write') and exists(select 1 from app.entity_schema_analyses a where a.workspace_id=entity_schema_analysis_rows.workspace_id and a.id=entity_schema_analysis_rows.analysis_id and app.workspace_allows('entity_type',a.type_id::text,'write')));
drop policy migration_rows_owner on private.entity_schema_migration_rows;
create policy workspace_schema_read on private.entity_schema_migration_rows for select to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read') and exists(select 1 from app.entity_schema_migrations j where j.workspace_id=entity_schema_migration_rows.workspace_id and j.id=entity_schema_migration_rows.job_id and app.workspace_allows('entity_type',j.type_id::text,'read')));
create policy workspace_schema_write on private.entity_schema_migration_rows for all to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write') and exists(select 1 from app.entity_schema_migrations j where j.workspace_id=entity_schema_migration_rows.workspace_id and j.id=entity_schema_migration_rows.job_id and app.workspace_allows('entity_type',j.type_id::text,'write'))) with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write') and exists(select 1 from app.entity_schema_migrations j where j.workspace_id=entity_schema_migration_rows.workspace_id and j.id=entity_schema_migration_rows.job_id and app.workspace_allows('entity_type',j.type_id::text,'write')));
drop policy model_children_owner on app.data_model_children;
create policy workspace_schema_read on app.data_model_children for select to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read') and app.workspace_allows('entity_type',type_id::text,'read'));
create policy workspace_schema_write on app.data_model_children for all to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write')) with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write'));

-- The existing signature's first UUID is now the actual business namespace.
-- Invoker execution retains the caller's current kind-read RLS boundary.
create or replace function app.entity_schema_membership(p_owner uuid,p_type uuid) returns text
 language sql stable set search_path='' as $$
 select md5(coalesce(jsonb_agg(jsonb_build_array(e.id,e.version,e.schema_version,e.properties,e.deleted_at) order by e.id)::text,'[]'))
 from app.entities e where e.workspace_id=p_owner and e.entity_type_id=p_type
$$;
