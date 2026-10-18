-- Execution permissions are immutable facts of each accepted analysis/job.
create function private.normalize_schema_permissions(p_permissions jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('target_kind',kind,'target_id',id,'access',access) order by kind,id),'[]'::jsonb)
 from (select r->>'target_kind' kind,r->>'target_id' id,case when bool_or(r->>'access'='write') then 'write' else 'read' end access
  from jsonb_array_elements(p_permissions) r group by r->>'target_kind',r->>'target_id') q
$$;
create function private.schema_permissions_allow(p_user uuid,p_workspace uuid,p_permissions jsonb) returns boolean language plpgsql stable set search_path='' as $$
declare r jsonb;
begin
 if jsonb_typeof(p_permissions) is distinct from 'array' then return false;end if;
 for r in select value from jsonb_array_elements(p_permissions) loop
  if jsonb_typeof(r) is distinct from 'object' or r->>'target_kind' is null or r->>'target_id' is null or r->>'access' is null or r->>'target_kind' not in ('entity_type','tasks','settings') or r->>'access' not in ('read','write')
   or not private.workspace_allows(p_user,p_workspace,r->>'target_kind',r->>'target_id',r->>'access') then return false;end if;
 end loop;
 return true;
end $$;

-- Only stored affiliation IDs are read here. Protected reference values are
-- read separately, after the real executor has every current permission.
create function private.workspace_entity_reference_permissions(p_workspace uuid,p_type uuid) returns jsonb
 language sql stable security definer set search_path='' as $$
 with own as (select id from app.entities where workspace_id=p_workspace and entity_type_id=p_type),
 linked_tasks as (select t.id,t.entity_ids,t.entity_context from app.tasks t where t.workspace_id=p_workspace
  and exists(select 1 from own e where e.id=any(t.entity_ids))),
 peers as (
  select e.entity_type_id id from app.entity_relation_links l join app.entities e
   on e.workspace_id=l.workspace_id and e.id in(l.left_entity_id,l.right_entity_id)
   where l.workspace_id=p_workspace and exists(select 1 from own o where o.id in(l.left_entity_id,l.right_entity_id))
  union select e.entity_type_id from linked_tasks t join app.entities e on e.workspace_id=p_workspace and e.id=any(t.entity_ids)
  union select (c->'type'->>'id')::uuid from linked_tasks t cross join lateral jsonb_array_elements(t.entity_context) c
   where c->'type'->>'id' is not null),
 permissions as (
  select jsonb_build_object('target_kind','entity_type','target_id',id::text,'access','read') permission from peers where id<>p_type
  union all select jsonb_build_object('target_kind','tasks','target_id','*','access','read') where exists(select 1 from linked_tasks))
 select private.normalize_schema_permissions(coalesce(jsonb_agg(permission),'[]'::jsonb)) from permissions
$$;
create function app.workspace_entity_reference_permissions(p_type uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare requirements jsonb;w uuid:=app.current_workspace_id();
begin
 perform app.authorize_workspace(jsonb_build_array(jsonb_build_object('target_kind','settings','target_id','*','access','write'),
  jsonb_build_object('target_kind','entity_type','target_id',p_type::text,'access','write')));
 requirements:=private.workspace_entity_reference_permissions(w,p_type);
 perform app.authorize_workspace(requirements);
 perform set_config('request.workspace_requirements',
  (coalesce(nullif(current_setting('request.workspace_requirements',true),''),'[]')::jsonb||requirements)::text,true);
 return requirements;
end $$;

create function private.workspace_entity_schema_reference_baseline(p_workspace uuid,p_type uuid) returns jsonb
 language sql stable set search_path='' as $$
 select jsonb_build_object(
 'typed_links',coalesce((select jsonb_agg(jsonb_build_array(l.definition_id,l.left_entity_id,l.right_entity_id,l.created_at,d.version)
  order by l.definition_id,l.left_entity_id collate "C",l.right_entity_id collate "C")
  from app.entity_relation_links l join app.entity_relation_definitions d on d.workspace_id=l.workspace_id and d.id=l.definition_id
  where l.workspace_id=p_workspace and exists(select 1 from app.entities e where e.workspace_id=p_workspace and e.entity_type_id=p_type and e.id in(l.left_entity_id,l.right_entity_id))),'[]'::jsonb),
 'tasks',coalesce((select jsonb_agg(jsonb_build_array(t.id,t.entity_ids,t.entity_context) order by t.id collate "C")
  from app.tasks t where t.workspace_id=p_workspace and exists(select 1 from app.entities e where e.workspace_id=p_workspace and e.entity_type_id=p_type and e.id=any(t.entity_ids))),'[]'::jsonb),
 'records',coalesce((select jsonb_agg(jsonb_build_array(r.id,r.task_id,r.entity_id) order by r.id collate "C")
  from app.records r where r.workspace_id=p_workspace and r.record_kind<>'change'
   and exists(select 1 from app.entities e where e.workspace_id=p_workspace and e.entity_type_id=p_type and e.id=r.entity_id)),'[]'::jsonb))
$$;
create or replace function app.entity_schema_reference_baseline(p_owner uuid,p_type uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare requirements jsonb;
begin
 if p_owner is distinct from app.current_workspace_id() then raise exception 'workspace_denied' using errcode='42501';end if;
 perform app.authorize_workspace(jsonb_build_array(jsonb_build_object('target_kind','settings','target_id','*','access','read'),
  jsonb_build_object('target_kind','entity_type','target_id',p_type::text,'access','read')));
 requirements:=private.workspace_entity_reference_permissions(p_owner,p_type);
 perform app.authorize_workspace(requirements);
 perform set_config('request.workspace_requirements',
  (coalesce(nullif(current_setting('request.workspace_requirements',true),''),'[]')::jsonb||requirements)::text,true);
 return private.workspace_entity_schema_reference_baseline(p_owner,p_type);
end $$;
revoke all on function private.normalize_schema_permissions(jsonb),private.schema_permissions_allow(uuid,uuid,jsonb),
 private.workspace_entity_reference_permissions(uuid,uuid),private.workspace_entity_schema_reference_baseline(uuid,uuid)
 from public,anon,authenticated,app_user,app_server,app_worker;
revoke all on function app.workspace_entity_reference_permissions(uuid) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.workspace_entity_reference_permissions(uuid) to app_user;

alter table app.entity_schema_changes add column required_permissions jsonb not null default '[]' check(jsonb_typeof(required_permissions)='array');
alter table app.entity_schema_analyses add column required_permissions jsonb not null default '[]' check(jsonb_typeof(required_permissions)='array');
alter table app.entity_schema_migrations add column required_permissions jsonb not null default '[]' check(jsonb_typeof(required_permissions)='array');
-- Existing accepted facts gain an equivalent descriptor form; no authority is added.
update app.entity_schema_changes c set required_permissions=(select coalesce(jsonb_agg(jsonb_build_object('target_kind','entity_type','target_id',id::text,'access','write')),'[]') from unnest(c.required_kind_ids) id) where workspace_id is not null;
update app.entity_schema_analyses c set required_permissions=(select coalesce(jsonb_agg(jsonb_build_object('target_kind','entity_type','target_id',id::text,'access','write')),'[]') from unnest(c.required_kind_ids) id) where workspace_id is not null;
update app.entity_schema_migrations c set required_permissions=(select coalesce(jsonb_agg(jsonb_build_object('target_kind','entity_type','target_id',id::text,'access','write')),'[]') from unnest(c.required_kind_ids) id) where workspace_id is not null;

grant execute on function private.normalize_schema_permissions(jsonb) to app_user;
create or replace function private.capture_workspace_schema_actor() returns trigger language plpgsql set search_path='' as $$
declare actor jsonb;parent uuid;kinds uuid[];requirements jsonb;inherited jsonb;references_permissions jsonb:='[]';
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
  select g.plan->'protected_permissions' into inherited from app.data_model_changes g where g.workspace_id=new.workspace_id and g.id=parent;
  if tg_table_name='entity_schema_migrations' then references_permissions:=app.workspace_entity_reference_permissions(new.type_id);end if;
  select private.normalize_schema_permissions(coalesce(jsonb_agg(jsonb_build_object('target_kind','entity_type','target_id',id::text,'access','write')),'[]')
    ||coalesce(inherited,'[]')||references_permissions) into new.required_permissions from unnest(kinds) id;
  if tg_table_name in ('entity_schema_analyses','entity_schema_migrations') then
   requirements:=new.required_permissions;
   perform app.authorize_workspace(requirements);
   perform set_config('request.workspace_requirements',
    (coalesce(nullif(current_setting('request.workspace_requirements',true),''),'[]')::jsonb||requirements)::text,true);
  end if;
 else
  if new.workspace_generation is distinct from old.workspace_generation or new.required_kind_ids is distinct from old.required_kind_ids or new.required_permissions is distinct from old.required_permissions then
   raise exception 'schema_execution_scope_immutable' using errcode='23514';
  end if;
  if to_jsonb(new)->'model_change_id' is distinct from to_jsonb(old)->'model_change_id' then
   raise exception 'schema_group_affiliation_immutable' using errcode='23514';
  end if;
  if current_user='app_user' then
   actor:=app.workspace_author();
   if old.workspace_generation is distinct from app.workspace_generation() then
    -- An explicit current writer may terminate an old epoch, never resume it.
    if tg_table_name='entity_schema_migrations' and old.status in ('queued','preparing','ready_to_commit','committing')
      and new.status='cancelled' and (to_jsonb(new)->>'fence')::bigint=(to_jsonb(old)->>'fence')::bigint+1 and (to_jsonb(new)->>'version')::bigint=(to_jsonb(old)->>'version')::bigint+1 and (to_jsonb(new)->>'lease_until') is null and not (to_jsonb(new)->>'retryable')::boolean
      and (to_jsonb(new)-array['status','version','fence','lease_until','retryable','updated_at'])=(to_jsonb(old)-array['status','version','fence','lease_until','retryable','updated_at']) then return new;
    elsif tg_table_name='entity_schema_analyses' and old.status in ('queued','running') and new.status='failed'
      and to_jsonb(new)->>'failure_reason'='analysis_discarded' and (to_jsonb(new)->>'fence')::bigint=(to_jsonb(old)->>'fence')::bigint+1 and (to_jsonb(new)->>'lease_until') is null and not (to_jsonb(new)->>'retryable')::boolean
      and (to_jsonb(new)-array['status','fence','lease_until','retryable','failure_reason'])=(to_jsonb(old)-array['status','fence','lease_until','retryable','failure_reason']) then return new;
    elsif tg_table_name='entity_schema_changes' and old.status not in ('applied','cancelled') and new.status='cancelled'
      and (to_jsonb(new)->>'version')::bigint=(to_jsonb(old)->>'version')::bigint+1
      and (to_jsonb(new)-array['status','version','updated_at'])=(to_jsonb(old)-array['status','version','updated_at']) then return new;
    end if;
    raise exception 'schema_plan_stale' using errcode='P0001';
   end if;
   if new.created_by is distinct from old.created_by or new.created_by_name is distinct from old.created_by_name then
    raise exception 'schema_author_immutable' using errcode='23514';
   end if;
   if new.initiated_by is distinct from old.initiated_by then
    raise exception 'schema_initiator_invalid' using errcode='23514';
   end if;
  end if;
 end if;
 return new;
end $$;

create or replace function private.schema_analysis_current(p_workspace uuid,p_id uuid) returns boolean language sql stable set search_path='' as $$
 select coalesce((select private.schema_execution_allows(a.initiated_by,a.workspace_id,a.workspace_generation,a.required_kind_ids)
  and private.schema_permissions_allow(a.initiated_by,a.workspace_id,a.required_permissions)
  from app.entity_schema_analyses a where a.workspace_id=p_workspace and a.id=p_id),false)
$$;
create or replace function private.authorize_schema_analysis(p_workspace uuid,p_id uuid) returns boolean language plpgsql set search_path='' as $$
declare executor uuid;
begin
 select initiated_by into executor from app.entity_schema_analyses where workspace_id=p_workspace and id=p_id;
 if not found or not private.lock_schema_execution(executor,p_workspace) then return false;end if;
 return private.schema_analysis_current(p_workspace,p_id);
end $$;
create function private.schema_job_current(p_workspace uuid,p_id uuid) returns boolean language plpgsql stable set search_path='' as $$
declare j record;r jsonb;
begin
 select initiated_by,workspace_generation,required_kind_ids,required_permissions,type_id,source_expires_at into j
  from app.entity_schema_migrations where workspace_id=p_workspace and id=p_id;
 if not found or not private.schema_execution_allows(j.initiated_by,p_workspace,j.workspace_generation,j.required_kind_ids)
  or not private.schema_permissions_allow(j.initiated_by,p_workspace,j.required_permissions)
  or j.source_expires_at is null or j.source_expires_at<=clock_timestamp() then return false;end if;
 -- A later link cannot lend this accepted execution a new protected target.
 for r in select value from jsonb_array_elements(private.workspace_entity_reference_permissions(p_workspace,j.type_id)) loop
  if not exists(select 1 from jsonb_array_elements(j.required_permissions) stored
    where stored->>'target_kind'=r->>'target_kind' and stored->>'target_id'=r->>'target_id'
      and (stored->>'access'='write' or stored->>'access'=r->>'access')) then return false;end if;
 end loop;
 return true;
end $$;
create function private.authorize_schema_job(p_workspace uuid,p_id uuid) returns boolean language plpgsql set search_path='' as $$
declare executor uuid;
begin
 select initiated_by into executor from app.entity_schema_migrations where workspace_id=p_workspace and id=p_id;
 if not found or not private.lock_schema_execution(executor,p_workspace) then return false;end if;
 return private.schema_job_current(p_workspace,p_id);
end $$;
create function private.schema_group_current(p_workspace uuid,p_id uuid) returns boolean language plpgsql stable set search_path='' as $$
declare generation bigint;coordinator uuid;permissions jsonb;j record;count_jobs integer:=0;
begin
 select g.workspace_generation,g.initiated_by into generation,coordinator from app.data_model_changes g where g.workspace_id=p_workspace and g.id=p_id;
 if not found or coordinator is null or not exists(select 1 from app.workspaces w where w.id=p_workspace and w.deleted_at is null and w.lifecycle_generation=generation)
  or not private.workspace_allows(coordinator,p_workspace,'settings','*','write') then return false;end if;
 select private.normalize_schema_permissions(coalesce(jsonb_agg(permission),'[]'::jsonb)) into permissions
  from app.data_model_children c join app.entity_schema_migrations m on m.workspace_id=c.workspace_id and m.id=c.job_id
   cross join lateral jsonb_array_elements(m.required_permissions) permission where c.workspace_id=p_workspace and c.model_id=p_id;
 if not private.schema_permissions_allow(coordinator,p_workspace,permissions) then return false;end if;
 for j in select c.job_id from app.data_model_children c join app.entity_schema_migrations m
  on m.workspace_id=c.workspace_id and m.id=c.job_id and m.model_change_id=c.model_id and m.type_id=c.type_id and m.change_id=c.change_id
  where c.workspace_id=p_workspace and c.model_id=p_id loop
  count_jobs:=count_jobs+1;
  if not private.schema_job_current(p_workspace,j.job_id) then return false;end if;
 end loop;
 return count_jobs>0 and count_jobs=(select count(*) from app.data_model_children where workspace_id=p_workspace and model_id=p_id);
end $$;
create function private.authorize_schema_group(p_workspace uuid,p_id uuid) returns boolean language plpgsql set search_path='' as $$
declare executors uuid[];current_executors uuid[];locked integer;
begin
 if not exists(select 1 from app.data_model_changes g where g.workspace_id=p_workspace and g.id=p_id and g.initiated_by is not null) then return false;end if;
 if exists(select 1 from app.data_model_children c join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id
   where c.workspace_id=p_workspace and c.model_id=p_id and j.initiated_by is null) then return false;end if;
 select array_agg(distinct executor order by executor) into executors from (
  select j.initiated_by executor from app.data_model_children c join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id
   where c.workspace_id=p_workspace and c.model_id=p_id
  union select g.initiated_by from app.data_model_changes g where g.workspace_id=p_workspace and g.id=p_id) accounts;
 if coalesce(cardinality(executors),0)=0 then return false;end if;
 -- Every actual account first, in sorted order, then the shared workspace, then domain locks.
 perform 1 from auth.users where id=any(executors) order by id for share;
 get diagnostics locked=row_count;
 if locked<>cardinality(executors) then return false;end if;
 perform 1 from app.workspaces where id=p_workspace for share;
 if not found then return false;end if;
 perform set_config('request.workspace_id',p_workspace::text,true);
 perform set_config('request.workspace_lock_mode','business',true);
 -- Actors can be replaced by an explicit failed-attempt retry while this call
 -- waits for an account lock. Re-read after W; never acquire a new account after W.
 select array_agg(distinct executor order by executor) into current_executors from (
  select j.initiated_by executor from app.data_model_children c join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id
   where c.workspace_id=p_workspace and c.model_id=p_id
  union select g.initiated_by from app.data_model_changes g where g.workspace_id=p_workspace and g.id=p_id) accounts;
 if current_executors is null or not (current_executors <@ executors) then return false;end if;
 -- Fresh post-lock statement for the captured, still-current account set and immutable footprints.
 return private.schema_group_current(p_workspace,p_id);
end $$;
revoke all on function private.schema_job_current(uuid,uuid),private.authorize_schema_job(uuid,uuid),
 private.schema_group_current(uuid,uuid),private.authorize_schema_group(uuid,uuid)
 from public,anon,authenticated,app_user,app_server,app_worker;

-- This transaction-local publication context is private and contains no user identity.
do $$begin
 if exists(select 1 from private.data_model_commit_context) then raise exception 'model_commit_context_requires_empty_store' using errcode='55000';end if;
end $$;
alter table private.data_model_commit_context rename column owner_id to workspace_id;
alter table private.data_model_commit_context add foreign key(workspace_id,model_id) references app.data_model_changes(workspace_id,id) on delete cascade;
CREATE OR REPLACE FUNCTION private.entity_schema_effective_templates(p_owner uuid, p_type uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with settings as (select coalesce((select settings from app.user_business_settings where workspace_id=p_owner and id='record_templates'),'{}'::jsonb) as data),
 actions as (select action,coalesce(data->'entity_types'->p_type::text->action,'{}'::jsonb) as value from settings cross join unnest(array['create','update','delete','restore']) action)
 select jsonb_build_object('entity',jsonb_object_agg(action,jsonb_build_object(
 'memo',case when coalesce(value->>'memo','')~'^[[:space:]]*$' then case when action='update' then '$대상$ $액션$ ($변경항목$)' else '$대상$ $액션$' end else regexp_replace(value->>'memo','\$\{([^$]*?)\$\}','\$\1\$','g') end,
 'tag_ids',coalesce((select jsonb_agg(tag order by tag collate "C") from jsonb_array_elements_text(coalesce(value->'tag_ids','[]'::jsonb)) tag),'[]'::jsonb)))) from actions
$function$;

CREATE OR REPLACE FUNCTION private.stage_entity_schema_migration(p_id uuid, p_fence bigint, p_results jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid; v_type_id uuid; v_job app.entity_schema_migrations%rowtype; v_count integer;
begin
 select x.workspace_id,x.type_id into v_owner,v_type_id from app.entity_schema_migrations x where x.id=p_id;
 if v_owner is null or not private.authorize_schema_job(v_owner,p_id) then return false; end if;
 perform 1 from app.entity_types t where t.workspace_id=v_owner and t.id=v_type_id for update;
 select * into v_job from app.entity_schema_migrations where workspace_id=v_owner and id=p_id for update;
 if v_job.status<>'preparing' or v_job.fence<>p_fence or v_job.lease_until<=now() then return false; end if;
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>50 or octet_length(p_results::text)>1048576 then raise exception 'invalid migration batch' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_results) r left join private.entity_schema_migration_rows s on s.workspace_id=v_owner and s.job_id=p_id and s.entity_id=r->>'entity_id' where s.entity_id is null or s.prepared or s.after<>r->'after' or s.changed<>(r->>'changed')::boolean or (s.changed and (jsonb_typeof(r->'record_context')<>'array' or jsonb_typeof(r->'record_tags')<>'array' or length(r->>'record_body')>22000))) then raise exception 'invalid migration row' using errcode='22023'; end if;
 update private.entity_schema_migration_rows s set prepared=true,record_id=case when s.changed then app.data_id_candidate() end,record_body=r->>'record_body',record_context=r->'record_context',record_tags=r->'record_tags',record_hash=r->>'record_hash',record_path=r->>'record_path' from jsonb_array_elements(p_results) r where s.workspace_id=v_owner and s.job_id=p_id and s.entity_id=r->>'entity_id' and not s.prepared;
 get diagnostics v_count=row_count;
 if v_count<>jsonb_array_length(p_results) then raise exception 'duplicate migration rows' using errcode='22023'; end if;
 select count(*) into v_count from private.entity_schema_migration_rows where workspace_id=v_owner and job_id=p_id and prepared;
 if (select coalesce(sum(octet_length(source_properties::text)+coalesce(octet_length(recovery_properties::text),0)+octet_length(after::text)+octet_length(source_identity::text)+octet_length(coalesce(record_body,''))+octet_length(coalesce(record_context,'null')::text)+octet_length(coalesce(record_tags,'null')::text)),0) from private.entity_schema_migration_rows where workspace_id=v_owner and job_id=p_id)+octet_length(v_job.source_definition::text)+octet_length(v_job.target::text)+octet_length(v_job.source_references::text)+octet_length(v_job.source_templates::text)+octet_length(v_job.migration::text)>8388608 then
 update app.entity_schema_migrations set status='failed',version=version+1,processed=v_count,lease_until=null,retryable=false,failure_reason='migration_result_limit',updated_at=now() where workspace_id=v_owner and id=p_id;
 update app.entity_types set schema_write_locked=false where workspace_id=v_owner and id=v_type_id;
 return true; end if;
 update app.entity_schema_migrations set status=case when v_count=total then 'ready_to_commit' else 'queued' end,version=version+1,processed=v_count,lease_until=null,updated_at=now() where workspace_id=v_owner and id=p_id;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION private.fail_entity_schema_migration(p_id uuid, p_fence bigint, p_reason text, p_retryable boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid; v_type_id uuid; v_job app.entity_schema_migrations%rowtype;
begin
 select x.workspace_id,x.type_id into v_owner,v_type_id from app.entity_schema_migrations x where x.id=p_id;
 if v_owner is null or not private.authorize_schema_job(v_owner,p_id) then return false; end if;
 perform 1 from app.entity_types t where t.workspace_id=v_owner and t.id=v_type_id for update;
 select * into v_job from app.entity_schema_migrations where workspace_id=v_owner and id=p_id for update;
 if v_job.status not in ('preparing','committing') or v_job.fence<>p_fence or v_job.lease_until<=now() then return false; end if;
 if p_reason not in ('migration_worker_failed','schema_plan_stale','migration_result_limit') then raise exception 'invalid migration failure' using errcode='22023'; end if;
 update app.entity_schema_migrations set status='failed',version=version+1,retryable=p_retryable and p_reason='migration_worker_failed',failure_reason=p_reason,lease_until=null,updated_at=now() where workspace_id=v_owner and id=p_id;
 update app.entity_types set schema_write_locked=false where workspace_id=v_owner and id=v_type_id;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION private.fail_data_model_group(p_owner uuid, p_id uuid, p_fence bigint, p_reason text, p_retryable boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_group app.data_model_changes%rowtype;
begin
 select * into v_group from app.data_model_changes g where g.workspace_id=p_owner and g.id=p_id for update;
 if not found or v_group.fence<>p_fence or v_group.status not in ('queued','preparing','ready_to_commit','committing') then return false;end if;
 update app.entity_schema_migrations j set status='failed',version=j.version+1,fence=j.fence+1,lease_until=null,retryable=p_retryable,failure_reason=case when p_retryable then 'migration_worker_failed' else p_reason end,updated_at=now() where j.workspace_id=p_owner and j.model_change_id=p_id and j.status in ('queued','preparing','ready_to_commit','committing');
 update app.entity_types t set schema_write_locked=false,updated_at=now() where t.workspace_id=p_owner and exists(select 1 from app.data_model_children c where c.workspace_id=p_owner and c.model_id=p_id and c.type_id=t.id);
 update app.data_model_changes g set status='failed',version=g.version+1,fence=g.fence+1,lease_until=null,retryable=p_retryable,failure_reason=p_reason,updated_at=now() where g.workspace_id=p_owner and g.id=p_id;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION app.claim_entity_schema_migration()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_candidate uuid; v_owner uuid; v_type_id uuid; v_job app.entity_schema_migrations%rowtype; v_batch jsonb;
begin
 perform private.cleanup_entity_schema_sources();
 select x.id,x.workspace_id,x.type_id into v_candidate,v_owner,v_type_id from app.entity_schema_migrations x where private.schema_job_current(x.workspace_id,x.id) and x.model_change_id is null and (x.status in ('queued','ready_to_commit') or (x.status in ('preparing','committing') and x.lease_until<now())) order by x.created_at,x.id limit 1;
 if v_candidate is null then return null; end if;
 if not private.authorize_schema_job(v_owner,v_candidate) then return null;end if;
 perform 1 from app.entity_types t where t.workspace_id=v_owner and t.id=v_type_id for update;
 select * into v_job from app.entity_schema_migrations where workspace_id=v_owner and id=v_candidate for update;
 if v_job.model_change_id is not null then return null;end if;
 if not(v_job.status in ('queued','ready_to_commit') or (v_job.status in ('preparing','committing') and v_job.lease_until<now())) then return null; end if;
 update app.entity_schema_migrations set status=case when status in ('ready_to_commit','committing') then 'committing' else 'preparing' end,fence=fence+1,version=version+1,lease_until=now()+interval '90 seconds',updated_at=now() where workspace_id=v_owner and id=v_job.id returning * into v_job;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'properties',r.source_properties,'after',r.after,'source',r.source_identity->>'source','external_id',r.source_identity->>'external_id','tag_ids',r.source_identity->'tag_ids','changed',r.changed,'recovery_properties',r.recovery_properties) order by r.entity_id collate "C"),'[]'::jsonb) into v_batch from
 (select * from (select x.*,sum(octet_length(source_properties::text)+octet_length(after::text)+coalesce(octet_length(recovery_properties::text),0)+octet_length(entity_id)+512) over(order by entity_id collate "C") as bytes,row_number() over(order by entity_id collate "C") as ordinal from private.entity_schema_migration_rows x where x.workspace_id=v_owner and x.job_id=v_job.id and not prepared) bounded where bytes<=524288 and ordinal<=50) r;
 return jsonb_build_object('id',v_job.id,'workspace_id',v_job.workspace_id,'initiated_by',v_job.initiated_by,'workspace_generation',v_job.workspace_generation,'type_id',v_job.type_id,'fence',v_job.fence,'status',v_job.status,'target',v_job.target,'source_definition',v_job.source_definition,'recovery_keys',v_job.recovery_keys,'migration',v_job.migration,'source_schema_version',v_job.source_schema_version,'source_template_fingerprint',v_job.source_template_fingerprint,'templates',private.entity_schema_effective_templates(v_owner,v_type_id),'available_tags',coalesce((select jsonb_agg(id order by id) from app.tags where workspace_id=v_owner and scope='record' and id in(select tag from jsonb_each(v_job.source_templates->'entity') action cross join lateral jsonb_array_elements_text(action.value->'tag_ids') tag)),'[]'::jsonb),'type',(select jsonb_build_object('id',t.id,'label',s.schema->>'title','icon_id',s.schema->>'x-icon','archived',coalesce((s.schema->>'deprecated')::boolean,false)) from app.entity_types t join app.entity_schema_versions s on s.workspace_id=t.workspace_id and s.type_id=t.id and s.schema_version=t.schema_version where t.workspace_id=v_owner and t.id=v_type_id),'rows',v_batch);
end $function$;

CREATE OR REPLACE FUNCTION app.stage_entity_schema_migration(p_id uuid, p_fence bigint, p_results jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if exists(select 1 from app.entity_schema_migrations j where j.id=p_id and j.model_change_id is not null) then return false;end if;
 return private.stage_entity_schema_migration(p_id,p_fence,p_results);
end $function$;

CREATE OR REPLACE FUNCTION app.fail_entity_schema_migration(p_id uuid, p_fence bigint, p_reason text, p_retryable boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if exists(select 1 from app.entity_schema_migrations j where j.id=p_id and j.model_change_id is not null) then return false;end if;
 return private.fail_entity_schema_migration(p_id,p_fence,p_reason,p_retryable);
end $function$;

CREATE OR REPLACE FUNCTION app.claim_data_model_conversion()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid;v_id uuid;v_group app.data_model_changes%rowtype;v_job app.entity_schema_migrations%rowtype;v_batch jsonb;
begin
 perform private.cleanup_data_model_sources();
 select g.workspace_id,g.id into v_owner,v_id from app.data_model_changes g where private.schema_group_current(g.workspace_id,g.id) and (g.status in ('queued','ready_to_commit') or (g.status in ('preparing','committing') and g.lease_until<now())) order by g.created_at,g.id limit 1;
 if v_id is null then return null;end if;
 if not private.authorize_schema_group(v_owner,v_id) then return null;end if;
 perform private.lock_data_model_owner(v_owner);
 select * into v_group from app.data_model_changes g where g.workspace_id=v_owner and g.id=v_id for update;
 if not(v_group.status in ('queued','ready_to_commit') or(v_group.status in ('preparing','committing') and v_group.lease_until<now())) then return null;end if;
 if not exists(select 1 from app.data_model_children c where c.workspace_id=v_owner and c.model_id=v_id and c.job_id is not null) then perform private.fail_data_model_group(v_owner,v_id,v_group.fence,'schema_plan_stale',false);return null;end if;
 if v_group.status in ('ready_to_commit','committing') or not exists(select 1 from app.data_model_children c join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id where c.workspace_id=v_owner and c.model_id=v_id and j.status<>'ready_to_commit') then
  update app.data_model_changes g set status='committing',fence=g.fence+1,version=g.version+1,lease_until=now()+interval '90 seconds',updated_at=now() where g.workspace_id=v_owner and g.id=v_id returning * into v_group;
  update app.entity_schema_migrations j set status='committing',fence=j.fence+1,version=j.version+1,lease_until=now()+interval '90 seconds',updated_at=now() where j.workspace_id=v_owner and exists(select 1 from app.data_model_children c where c.workspace_id=v_owner and c.model_id=v_id and c.job_id=j.id) and j.status in ('ready_to_commit','committing');
  return jsonb_build_object('id',v_id,'fence',v_group.fence,'status','committing');
 end if;
 select j.* into v_job from app.entity_schema_migrations j join app.data_model_children c on c.workspace_id=j.workspace_id and c.job_id=j.id where c.workspace_id=v_owner and c.model_id=v_id and (j.status='queued' or(j.status='preparing' and j.lease_until<now())) order by c.type_id limit 1 for update of j;
 if not found then perform private.fail_data_model_group(v_owner,v_id,v_group.fence,'schema_plan_stale',false);return null;end if;
 update app.data_model_changes g set status='preparing',fence=g.fence+1,version=g.version+1,lease_until=now()+interval '90 seconds',updated_at=now() where g.workspace_id=v_owner and g.id=v_id returning * into v_group;
 update app.entity_schema_migrations j set status='preparing',fence=j.fence+1,version=j.version+1,lease_until=now()+interval '90 seconds',updated_at=now() where j.workspace_id=v_owner and j.id=v_job.id returning * into v_job;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'properties',r.source_properties,'after',r.after,'source',r.source_identity->>'source','external_id',r.source_identity->>'external_id','tag_ids',r.source_identity->'tag_ids','changed',r.changed,'recovery_properties',r.recovery_properties) order by r.entity_id collate "C"),'[]'::jsonb) into v_batch from(select * from(select x.*,sum(octet_length(source_properties::text)+octet_length(after::text)+coalesce(octet_length(recovery_properties::text),0)+octet_length(entity_id)+512) over(order by entity_id collate "C") bytes,row_number() over(order by entity_id collate "C") ordinal from private.entity_schema_migration_rows x where x.workspace_id=v_owner and x.job_id=v_job.id and not prepared) bounded where bytes<=524288 and ordinal<=50) r;
 return jsonb_build_object('id',v_id,'fence',v_group.fence,'status','preparing','child',jsonb_build_object('id',v_job.id,'workspace_id',v_owner,'initiated_by',v_job.initiated_by,'workspace_generation',v_job.workspace_generation,'type_id',v_job.type_id,'fence',v_job.fence,'status',v_job.status,'target',v_job.target,'source_definition',v_job.source_definition,'recovery_keys',v_job.recovery_keys,'migration',v_job.migration,'source_schema_version',v_job.source_schema_version,'source_template_fingerprint',v_job.source_template_fingerprint,'templates',private.entity_schema_effective_templates(v_owner,v_job.type_id),'available_tags',coalesce((select jsonb_agg(t.id order by t.id) from app.tags t where t.workspace_id=v_owner and t.scope='record' and t.id in(select tag from jsonb_each(v_job.source_templates->'entity') action cross join lateral jsonb_array_elements_text(action.value->'tag_ids') tag)),'[]'::jsonb),'type',(select jsonb_build_object('id',t.id,'label',s.schema->>'title','icon_id',s.schema->>'x-icon','archived',coalesce((s.schema->>'deprecated')::boolean,false)) from app.entity_types t join app.entity_schema_versions s on s.workspace_id=t.workspace_id and s.type_id=t.id and s.schema_version=t.schema_version where t.workspace_id=v_owner and t.id=v_job.type_id),'rows',v_batch));
end $function$;

CREATE OR REPLACE FUNCTION app.stage_data_model_conversion(p_id uuid, p_fence bigint, p_job uuid, p_child_fence bigint, p_results jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid;v_group app.data_model_changes%rowtype;v_job app.entity_schema_migrations%rowtype;v_saved boolean;
begin
 select g.workspace_id into v_owner from app.data_model_changes g where g.id=p_id;if v_owner is null or not private.authorize_schema_group(v_owner,p_id) then return false;end if;
 perform private.lock_data_model_owner(v_owner);
 select * into v_group from app.data_model_changes g where g.workspace_id=v_owner and g.id=p_id for update;
 if v_group.status<>'preparing' or v_group.fence is distinct from p_fence or v_group.lease_until is null or v_group.lease_until<=now() then return false;end if;
 select j.* into v_job from app.entity_schema_migrations j join app.data_model_children c on c.workspace_id=j.workspace_id and c.job_id=j.id where c.workspace_id=v_owner and c.model_id=p_id and j.id=p_job and j.model_change_id=p_id for update of j;
 if not found or v_job.status<>'preparing' or v_job.fence is distinct from p_child_fence or v_job.lease_until is null or v_job.lease_until<=now() then return false;end if;
 v_saved:=private.stage_entity_schema_migration(p_job,p_child_fence,p_results);
 if not v_saved then return false;end if;
 select * into v_job from app.entity_schema_migrations j where j.workspace_id=v_owner and j.id=p_job;
 if v_job.status='failed' then perform private.fail_data_model_group(v_owner,p_id,p_fence,v_job.failure_reason,false);return true;end if;
 update app.data_model_changes g set status=case when not exists(select 1 from app.data_model_children c join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id where c.workspace_id=v_owner and c.model_id=p_id and j.status<>'ready_to_commit') then 'ready_to_commit' else 'queued' end,version=g.version+1,lease_until=null,updated_at=now() where g.workspace_id=v_owner and g.id=p_id;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION app.fail_data_model_conversion(p_id uuid, p_fence bigint, p_job uuid, p_child_fence bigint, p_reason text, p_retryable boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid;v_group app.data_model_changes%rowtype;
begin
 if p_reason not in ('migration_worker_failed','schema_plan_stale','migration_result_limit') then raise exception 'invalid migration failure' using errcode='22023';end if;
 select g.workspace_id into v_owner from app.data_model_changes g where g.id=p_id;if v_owner is null or not private.authorize_schema_group(v_owner,p_id) then return false;end if;
 perform private.lock_data_model_owner(v_owner);
 select * into v_group from app.data_model_changes g where g.workspace_id=v_owner and g.id=p_id for update;
 if v_group.status not in ('preparing','committing') or v_group.fence is distinct from p_fence or v_group.lease_until is null or v_group.lease_until<=now() then return false;end if;
 if p_job is null or p_child_fence is null or not exists(select 1 from app.entity_schema_migrations j join app.data_model_children c on c.workspace_id=j.workspace_id and c.job_id=j.id where j.workspace_id=v_owner and c.model_id=p_id and j.id=p_job and j.model_change_id=p_id and j.fence=p_child_fence and j.status='preparing' and j.lease_until>now()) then return false;end if;
 return private.fail_data_model_group(v_owner,p_id,p_fence,p_reason,p_retryable and p_reason='migration_worker_failed');
end $function$;


-- Row-level protection covers retained task/peer contexts as well as store projections.
create function app.workspace_schema_permissions_allow(p_permissions jsonb,p_history boolean) returns boolean
 language plpgsql stable security definer set search_path='' as $$
declare r jsonb;requirements jsonb:='[]';
begin
 if jsonb_typeof(p_permissions) is distinct from 'array' or p_history is null then return false;end if;
 for r in select value from jsonb_array_elements(p_permissions) loop
  if jsonb_typeof(r) is distinct from 'object' or r->>'target_kind' is null or r->>'target_id' is null
    or r->>'access' is null or r->>'target_kind' not in ('entity_type','tasks','settings') or r->>'access' not in ('read','write') then return false;end if;
  requirements:=requirements||jsonb_build_array(jsonb_set(r,'{access}',to_jsonb(case when p_history then 'read' else r->>'access' end)));
 end loop;
 return private.schema_permissions_allow(auth.uid(),app.current_workspace_id(),requirements);
end $$;
revoke all on function app.workspace_schema_permissions_allow(jsonb,boolean) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.workspace_schema_permissions_allow(jsonb,boolean) to app_user;
drop policy workspace_schema_read on app.entity_schema_migrations;
create policy workspace_schema_read on app.entity_schema_migrations for select to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read')
  and app.workspace_allows('entity_type',type_id::text,'read') and app.workspace_schema_permissions_allow(required_permissions,true));
drop policy workspace_schema_read on app.entity_schema_changes;
create policy workspace_schema_read on app.entity_schema_changes for select to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read')
  and (kind='compatible' and analysis_id is null and recovery_source_job_id is null
    or (app.workspace_schema_permissions_allow(required_permissions,true)
      and (analysis_id is null or exists(select 1 from app.entity_schema_analyses a where a.workspace_id=entity_schema_changes.workspace_id and a.id=entity_schema_changes.analysis_id))
      and (recovery_source_job_id is null or exists(select 1 from app.entity_schema_migrations j where j.workspace_id=entity_schema_changes.workspace_id and j.id=entity_schema_changes.recovery_source_job_id)))));
-- A permissive FOR ALL write policy also grants SELECT, so split its commands.
drop policy workspace_schema_write on app.entity_schema_migrations;
create policy workspace_schema_insert on app.entity_schema_migrations for insert to app_user
 with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write'));
create policy workspace_schema_update on app.entity_schema_migrations for update to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write'))
 with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write'));
drop policy workspace_schema_write on app.entity_schema_changes;
create policy workspace_schema_insert on app.entity_schema_changes for insert to app_user
 with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write'));
create policy workspace_schema_update on app.entity_schema_changes for update to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write'))
 with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write'));

-- Descriptor-only preflight preserves explicit denial without releasing retained bodies.
create function app.workspace_schema_headers(p_kind text,p_id uuid default null,p_type uuid default null,p_before uuid default null,p_limit integer default 101)
 returns table(id uuid,requirements jsonb) language plpgsql security definer set search_path='' as $$
begin
 perform app.authorize_workspace('[{"target_kind":"settings","target_id":"*","access":"read"}]'::jsonb);
 if p_limit is null or p_limit not between 1 and 101 then raise exception 'invalid header limit' using errcode='22023';end if;
 if p_kind='migration' then
  return query select j.id,j.required_permissions from app.entity_schema_migrations j
   where j.workspace_id=app.current_workspace_id() and (p_id is null or j.id=p_id) and (p_type is null or j.type_id=p_type)
   and (p_before is null or (j.created_at,j.id)<(select b.created_at,b.id from app.entity_schema_migrations b where b.workspace_id=app.current_workspace_id() and b.id=p_before))
   order by j.created_at desc,j.id desc limit p_limit;
 elsif p_kind='change' then
  return query select c.id,case when c.kind='compatible' and c.analysis_id is null and c.recovery_source_job_id is null then '[]'::jsonb else private.normalize_schema_permissions(c.required_permissions
     ||coalesce((select a.required_permissions from app.entity_schema_analyses a where a.workspace_id=c.workspace_id and a.id=c.analysis_id),'[]'::jsonb)
     ||coalesce((select j.required_permissions from app.entity_schema_migrations j where j.workspace_id=c.workspace_id and j.id=c.recovery_source_job_id),'[]'::jsonb)) end
   from app.entity_schema_changes c where c.workspace_id=app.current_workspace_id() and (p_id is null or c.id=p_id)
   and (p_type is null or c.type_id=p_type) and (p_before is null or c.id<p_before) order by c.id desc limit p_limit;
 else raise exception 'invalid header kind' using errcode='22023';end if;
end $$;
revoke all on function app.workspace_schema_headers(text,uuid,uuid,uuid,integer) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.workspace_schema_headers(text,uuid,uuid,uuid,integer) to app_user;

drop policy workspace_schema_write on app.entity_schema_analyses;
create policy workspace_schema_insert on app.entity_schema_analyses for insert to app_user with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write'));
create policy workspace_schema_update on app.entity_schema_analyses for update to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write')) with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write'));
create policy workspace_schema_delete on app.entity_schema_analyses for delete to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write'));
drop policy workspace_schema_read on app.entity_schema_analyses;
create policy workspace_schema_read on app.entity_schema_analyses for select to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read') and app.workspace_allows('entity_type',type_id::text,'read') and app.workspace_schema_permissions_allow(required_permissions,true));

drop policy workspace_schema_write on private.entity_schema_analysis_rows;
create policy workspace_schema_insert on private.entity_schema_analysis_rows for insert to app_user with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write') and exists(select 1 from app.entity_schema_analyses a where a.workspace_id=entity_schema_analysis_rows.workspace_id and a.id=entity_schema_analysis_rows.analysis_id and app.workspace_allows('entity_type',a.type_id::text,'write')));
create policy workspace_schema_update on private.entity_schema_analysis_rows for update to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write') and exists(select 1 from app.entity_schema_analyses a where a.workspace_id=entity_schema_analysis_rows.workspace_id and a.id=entity_schema_analysis_rows.analysis_id and app.workspace_allows('entity_type',a.type_id::text,'write'))) with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write') and exists(select 1 from app.entity_schema_analyses a where a.workspace_id=entity_schema_analysis_rows.workspace_id and a.id=entity_schema_analysis_rows.analysis_id and app.workspace_allows('entity_type',a.type_id::text,'write')));
create policy workspace_schema_delete on private.entity_schema_analysis_rows for delete to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write') and exists(select 1 from app.entity_schema_analyses a where a.workspace_id=entity_schema_analysis_rows.workspace_id and a.id=entity_schema_analysis_rows.analysis_id and app.workspace_allows('entity_type',a.type_id::text,'write')));
drop policy workspace_schema_read on private.entity_schema_analysis_rows;
create policy workspace_schema_read on private.entity_schema_analysis_rows for select to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read') and exists(select 1 from app.entity_schema_analyses a where a.workspace_id=entity_schema_analysis_rows.workspace_id and a.id=entity_schema_analysis_rows.analysis_id));

drop policy workspace_schema_write on private.entity_schema_migration_rows;
create policy workspace_schema_insert on private.entity_schema_migration_rows for insert to app_user with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write') and exists(select 1 from app.entity_schema_migrations j where j.workspace_id=entity_schema_migration_rows.workspace_id and j.id=entity_schema_migration_rows.job_id and app.workspace_allows('entity_type',j.type_id::text,'write')));
create policy workspace_schema_update on private.entity_schema_migration_rows for update to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write') and exists(select 1 from app.entity_schema_migrations j where j.workspace_id=entity_schema_migration_rows.workspace_id and j.id=entity_schema_migration_rows.job_id and app.workspace_allows('entity_type',j.type_id::text,'write'))) with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write') and exists(select 1 from app.entity_schema_migrations j where j.workspace_id=entity_schema_migration_rows.workspace_id and j.id=entity_schema_migration_rows.job_id and app.workspace_allows('entity_type',j.type_id::text,'write')));
create policy workspace_schema_delete on private.entity_schema_migration_rows for delete to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write') and exists(select 1 from app.entity_schema_migrations j where j.workspace_id=entity_schema_migration_rows.workspace_id and j.id=entity_schema_migration_rows.job_id and app.workspace_allows('entity_type',j.type_id::text,'write')));
drop policy workspace_schema_read on private.entity_schema_migration_rows;
create policy workspace_schema_read on private.entity_schema_migration_rows for select to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read') and exists(select 1 from app.entity_schema_migrations j where j.workspace_id=entity_schema_migration_rows.workspace_id and j.id=entity_schema_migration_rows.job_id));

drop policy workspace_schema_write on app.data_model_children;
create policy workspace_schema_insert on app.data_model_children for insert to app_user with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write'));
create policy workspace_schema_update on app.data_model_children for update to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write')) with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write'));
create policy workspace_schema_delete on app.data_model_children for delete to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write') and app.workspace_allows('entity_type',type_id::text,'write'));
drop policy workspace_schema_read on app.data_model_children;
create policy workspace_schema_read on app.data_model_children for select to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read') and app.workspace_allows('entity_type',type_id::text,'read') and exists(select 1 from app.data_model_changes g where g.workspace_id=data_model_children.workspace_id and g.id=data_model_children.model_id));
