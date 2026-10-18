-- Retention is bounded maintenance, independent of a historical executor's rights.
-- Each maintenance call locks one real workspace and never acquires an Auth lock.
create or replace function private.cleanup_data_model_sources() returns void
 language plpgsql security definer set search_path='' as $$
declare w uuid;item record;
begin
 select g.workspace_id into w from app.data_model_changes g where g.workspace_id is not null
  and g.status in ('applied','cancelled','failed') and g.source_expires_at<=clock_timestamp()
  and (g.source_templates is not null or g.source_memberships is not null)
  order by g.workspace_id,g.source_expires_at,g.id limit 1;
 if w is null then return;end if;
 perform 1 from app.workspaces where id=w for share skip locked;if not found then return;end if;
 perform private.lock_data_model_owner(w);
 for item in select g.id from app.data_model_changes g where g.workspace_id=w
  and g.status in ('applied','cancelled','failed') and g.source_expires_at<=clock_timestamp()
  and (g.source_templates is not null or g.source_memberships is not null)
  order by g.source_expires_at,g.id limit 20 for update skip locked loop
  update app.data_model_changes set source_templates=null,source_memberships=null,retryable=false
   where workspace_id=w and id=item.id and status in ('applied','cancelled','failed') and source_expires_at<=clock_timestamp();
 end loop;
end $$;
create or replace function private.cleanup_entity_schema_sources() returns void
 language plpgsql security definer set search_path='' as $$
declare w uuid;item record;model uuid;
begin
 select candidate.workspace_id into w from (
  select j.workspace_id from app.entity_schema_migrations j where j.workspace_id is not null
   and j.status in ('succeeded','failed','cancelled') and j.source_expires_at<=clock_timestamp() and j.source_definition<>'{}'::jsonb
  union select a.workspace_id from app.entity_schema_analyses a where a.workspace_id is not null
   and exists(select 1 from private.entity_schema_analysis_rows r where r.workspace_id=a.workspace_id and r.analysis_id=a.id)
   and (a.created_at<=clock_timestamp()-interval '30 days' or exists(select 1 from app.entity_schema_migrations j
    where j.workspace_id=a.workspace_id and j.analysis_id=a.id and j.status in ('succeeded','failed','cancelled') and j.source_expires_at<=clock_timestamp()))
   and not exists(select 1 from app.entity_schema_migrations j where j.workspace_id=a.workspace_id and j.analysis_id=a.id
    and (j.status in ('queued','preparing','ready_to_commit','committing') or j.source_expires_at>clock_timestamp()))
 ) candidate order by candidate.workspace_id limit 1;
 if w is null then return;end if;
 perform 1 from app.workspaces where id=w for share skip locked;if not found then return;end if;
 perform private.lock_data_model_owner(w);
 for item in select j.id,j.analysis_id from app.entity_schema_migrations j where j.workspace_id=w
  and j.status in ('succeeded','failed','cancelled') and j.source_expires_at<=clock_timestamp() and j.source_definition<>'{}'::jsonb
  order by j.source_expires_at,j.id limit 20 for update skip locked loop
  delete from private.entity_schema_migration_rows where workspace_id=w and job_id=item.id;
  update app.entity_schema_migrations set source_definition='{}',source_templates='{}',source_references=null,
   committed_references=null,migration='{}',recovery_keys=null,retryable=false where workspace_id=w and id=item.id;
 end loop;
 -- An analysis shared by a live/unexpired attempt remains sealed for that attempt.
 for item in select a.id,a.change_id from app.entity_schema_analyses a where a.workspace_id=w
  and exists(select 1 from private.entity_schema_analysis_rows r where r.workspace_id=w and r.analysis_id=a.id)
  and (a.created_at<=clock_timestamp()-interval '30 days' or exists(select 1 from app.entity_schema_migrations j
   where j.workspace_id=w and j.analysis_id=a.id and j.status in ('succeeded','failed','cancelled') and j.source_expires_at<=clock_timestamp()))
  and not exists(select 1 from app.entity_schema_migrations j where j.workspace_id=w and j.analysis_id=a.id
   and (j.status in ('queued','preparing','ready_to_commit','committing') or j.source_expires_at>clock_timestamp()))
  order by a.created_at,a.id limit 20 for update skip locked loop
  delete from private.entity_schema_analysis_rows where workspace_id=w and analysis_id=item.id;
  update app.entity_schema_analyses set status='failed',fence=fence+1,lease_until=null,retryable=false,
   failure_reason='analysis_source_expired' where workspace_id=w and id=item.id;
  update app.entity_schema_changes set status='stale',version=version+1,updated_at=now()
   where workspace_id=w and analysis_id=item.id and status not in ('applied','cancelled');
  select c.model_change_id into model from app.entity_schema_changes c where c.workspace_id=w and c.id=item.change_id;
  if model is not null then perform private.refresh_workspace_model_analysis(w,model);end if;
 end loop;
end $$;
revoke all on function private.cleanup_data_model_sources(),private.cleanup_entity_schema_sources()
 from public,anon,authenticated,app_user,app_server,app_worker;

create function app.prune_entity_schema_sources() returns void language plpgsql security definer set search_path='' as $$
begin perform private.cleanup_entity_schema_sources();end $$;
create function app.prune_data_model_sources() returns void language plpgsql security definer set search_path='' as $$
begin perform private.cleanup_data_model_sources();end $$;
revoke all on function app.prune_entity_schema_sources(),app.prune_data_model_sources()
 from public,anon,authenticated,app_user,app_server,app_worker;
grant execute on function app.prune_entity_schema_sources(),app.prune_data_model_sources() to app_worker;

-- Claims acquire actual Auth locks first. Maintenance is a separate autocommit call.
do $$
declare signature regprocedure;definition text;before text;
begin
 for signature,before in select * from (values
  ('app.claim_entity_schema_migration()'::regprocedure,'perform private.cleanup_entity_schema_sources();'),
  ('app.claim_data_model_conversion()'::regprocedure,'perform private.cleanup_data_model_sources();')) exact_calls loop
  select pg_get_functiondef(signature) into definition;
  if length(definition)-length(replace(definition,before,''))<>length(before) then
   raise exception 'unexpected_inline_schema_retention' using errcode='55000';end if;
  execute replace(definition,before,'');
 end loop;
 select pg_get_functiondef('app.claim_entity_schema_analysis()'::regprocedure) into definition;
 if position('private.cleanup_entity_schema_sources(' in definition)>0
   or position('private.cleanup_data_model_sources(' in definition)>0 then
  raise exception 'unexpected_analysis_inline_retention' using errcode='55000';end if;
end $$;

-- Application writes may cancel or fence a superseded attempt, never replace its
-- accepted execution input, authority, expiry, or worker-computed result.
create function private.guard_schema_job_source() returns trigger language plpgsql set search_path='' as $$
declare lifecycle text[]:=array['status','version','fence','lease_until','retryable','failure_reason','updated_at'];
begin
 if current_user<>'app_user' then return new;end if;
 if tg_op='INSERT' then
  new.created_at:=clock_timestamp();
  if new.source_expires_at is null or new.source_expires_at>new.created_at+interval '30 days' then
   raise exception 'schema_job_source_immutable' using errcode='23514';end if;
  return new;
 end if;
 if new is not distinct from old then return new;end if;
 if (to_jsonb(new)-lifecycle) is distinct from (to_jsonb(old)-lifecycle) then
  raise exception 'schema_job_source_immutable' using errcode='23514';end if;
 if new.status is distinct from old.status then
  if new.status<>'cancelled' or old.status not in ('queued','preparing','ready_to_commit','committing')
   or new.version<>old.version+1 or new.fence<>old.fence+1 or new.lease_until is not null or new.retryable then
   raise exception 'schema_job_source_immutable' using errcode='23514';end if;
 elsif (to_jsonb(new)-array['retryable','fence','updated_at']) is distinct from (to_jsonb(old)-array['retryable','fence','updated_at'])
  or new.retryable or new.fence<>old.fence+1 then
  raise exception 'schema_job_source_immutable' using errcode='23514';
 end if;
 return new;
end $$;
create trigger schema_job_source before insert or update on app.entity_schema_migrations for each row execute function private.guard_schema_job_source();
create function private.guard_schema_job_source_row() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user='app_user' then
  if tg_op='UPDATE' and new is distinct from old then raise exception 'schema_job_source_row_immutable' using errcode='23514';end if;
  if tg_op='DELETE' and not exists(select 1 from app.entity_schema_migrations j where j.workspace_id=old.workspace_id and j.id=old.job_id
    and j.status='cancelled' and j.workspace_generation=app.workspace_generation()) then
   raise exception 'schema_job_source_row_immutable' using errcode='23514';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger schema_job_source_row before update or delete on private.entity_schema_migration_rows for each row execute function private.guard_schema_job_source_row();
revoke all on function private.guard_schema_job_source(),private.guard_schema_job_source_row()
 from public,anon,authenticated,app_user,app_server,app_worker;

-- An expired queued analysis is fenced even if another workspace's bounded
-- maintenance batch runs first. This preserves the original 17060852 expiry rule.
do $$
declare definition text;before text:='where a.workspace_id=p_workspace and a.id=p_id';
begin
 select pg_get_functiondef('private.schema_analysis_current(uuid,uuid)'::regprocedure) into definition;
 if length(definition)-length(replace(definition,before,''))<>length(before) then
  raise exception 'unexpected_schema_analysis_retention_predicate' using errcode='55000';end if;
 execute replace(definition,before,before||' and a.created_at>clock_timestamp()-interval ''30 days''');
end $$;
create function private.guard_schema_analysis_clock() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user='app_user' then
  if tg_op='INSERT' then new.created_at:=clock_timestamp();
  elsif new.created_at is distinct from old.created_at then raise exception 'schema_analysis_source_immutable' using errcode='23514';end if;
 end if;
 return new;
end $$;
create trigger schema_analysis_clock before insert or update on app.entity_schema_analyses for each row execute function private.guard_schema_analysis_clock();
create function private.guard_schema_analysis_source_row() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user='app_user' and (tg_op='DELETE' or new is distinct from old) then
  raise exception 'schema_analysis_source_row_immutable' using errcode='23514';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger schema_analysis_source_row before update or delete on private.entity_schema_analysis_rows for each row execute function private.guard_schema_analysis_source_row();
revoke all on function private.guard_schema_analysis_clock(),private.guard_schema_analysis_source_row()
 from public,anon,authenticated,app_user,app_server,app_worker;
