-- Source permissions are facts of the complete stored publication, including
-- compatible selected-text edits that never needed a value-conversion child.
create function private.search_model_permissions(p_plan jsonb) returns jsonb language sql immutable set search_path='' as $$
 select private.normalize_schema_permissions(coalesce(p_plan->'protected_permissions','[]')||'[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb||
  coalesce((select jsonb_agg(jsonb_build_object('target_kind','entity_type','target_id',target_type->'schema'->>'x-type-id','access','write'))
   from jsonb_array_elements(p_plan->'target'->'entity_types') target_type join jsonb_array_elements(p_plan->'source'->'entity_types') source_type
    on source_type->'schema'->>'x-type-id'=target_type->'schema'->>'x-type-id'
   where private.entity_search_definition(source_type->'schema') is distinct from private.entity_search_definition(target_type->'schema')),'[]'))
$$;
create or replace function app.publish_prepared_data_model(p_id uuid,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid:=app.current_workspace_id();g app.data_model_changes;required jsonb;
begin
 perform app.lock_workspace_account();perform app.lock_workspace(w,false);
 perform app.authorize_workspace('[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb);
 select * into g from app.data_model_changes where workspace_id=w and id=p_id;
 if not found then raise exception 'schema_plan_stale' using errcode='P0001';end if;
 required:=private.search_model_permissions(g.plan);
 perform app.authorize_workspace(required);
 perform private.lock_data_model_owner(w);
 select * into g from app.data_model_changes where workspace_id=w and id=p_id for update;
 if not found or g.workspace_generation is distinct from app.workspace_generation() or g.version<>p_version or g.status<>'ready'
  or not coalesce((g.plan->'review'->>'can_apply')::boolean,false)
  or exists(select 1 from app.data_model_children c where c.workspace_id=w and c.model_id=p_id)
  or private.data_model_document(w) is distinct from g.plan->'source' then raise exception 'schema_plan_stale' using errcode='P0001';end if;
 -- This writer always replaces the local capture from its actual immutable plan.
 -- It is extra retained footprint, never an authorization substitute.
 if not private.schema_permissions_allow(auth.uid(),w,private.search_model_permissions(g.plan)) then raise exception 'workspace_denied' using errcode='42501';end if;
 perform set_config('request.search_publication_permissions',private.search_model_permissions(g.plan)::text,true);
 return private.publish_prepared_model_definitions(w,g.plan,'{}'::uuid[]);
end $$;

-- Capture the coordinator's complete plan before publishing any child. Existing
-- Auth/workspace locks are already held; this adds no lock across provider I/O.
do $$ declare definition text;before text;after text;begin
 select pg_get_functiondef('app.commit_data_model_conversion(uuid,bigint,text)'::regprocedure) into definition;
 before:='insert into private.data_model_commit_context(workspace_id,model_id,pid,txid) values(v_owner,p_id,pg_backend_pid(),txid_current());';
 after:='if not private.schema_permissions_allow(v_group.initiated_by,v_owner,private.search_model_permissions(v_group.plan)) then raise exception ''workspace_denied'' using errcode=''42501'';end if;'
  ||E'\n perform set_config(''request.search_publication_permissions'',private.search_model_permissions(v_group.plan)::text,true);\n '||before;
 if strpos(definition,before)=0 then raise exception 'unexpected_model_search_publication';end if;
 execute replace(definition,before,after);
end $$;

create or replace function private.capture_search_permissions() returns trigger language plpgsql security definer set search_path='' as $$
declare parent app.records;inherited jsonb;group_permissions jsonb;requested jsonb:=new.required_permissions;publication jsonb;
begin
 if new.workspace_id is null then return new;end if;
 if new.kind='entity' then
  select jsonb_build_array(jsonb_build_object('target_kind','entity_type','target_id',e.entity_type_id::text,'access','write'))
   into new.required_permissions from app.entities e where e.workspace_id=new.workspace_id and e.id=new.id;
 else
  select * into parent from app.records where workspace_id=new.workspace_id and id=new.id;
  if not found then raise exception 'workspace_search_source_invalid' using errcode='23514';end if;
  if parent.entity_id is not null then
   select jsonb_build_array(jsonb_build_object('target_kind','entity_type','target_id',e.entity_type_id::text,'access','write'))
    into new.required_permissions from app.entities e where e.workspace_id=new.workspace_id and e.id=parent.entity_id;
  else new.required_permissions:='[{"target_kind":"tasks","target_id":"*","access":"write"}]';end if;
 end if;
 select j.required_permissions||'[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb into inherited
  from private.schema_job_commit_context c join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id
  where c.workspace_id=new.workspace_id and c.pid=pg_backend_pid() and c.txid=txid_current();
 select coalesce(jsonb_agg(permission),'[]')||'[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb into group_permissions
  from private.data_model_commit_context ctx join app.data_model_children c on c.workspace_id=ctx.workspace_id and c.model_id=ctx.model_id
  join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id cross join lateral jsonb_array_elements(j.required_permissions) permission
  where ctx.workspace_id=new.workspace_id and ctx.pid=pg_backend_pid() and ctx.txid=txid_current() having count(*)>0;
 publication:=coalesce(nullif(current_setting('request.search_publication_permissions',true),'')::jsonb,'[]');
 new.required_permissions:=private.normalize_schema_permissions(new.required_permissions||coalesce(requested,'[]')||coalesce(inherited,'[]')||coalesce(group_permissions,'[]')||publication);
 return new;
end $$;
-- Group publication's required-kind admission uses the same stored full plan;
-- compatible affected kinds are not lost when only other kinds need conversion.
create or replace function private.authorize_model_publication_requirements(p_workspace uuid,p_requirements jsonb) returns void language plpgsql security definer set search_path='' as $$
declare model uuid;job uuid;executor uuid;captured jsonb;
begin
 if p_workspace is null or p_workspace is distinct from app.current_workspace_id() then raise exception 'workspace_denied' using errcode='42501';end if;
 select c.model_id into model from private.data_model_commit_context c where c.workspace_id=p_workspace and c.pid=pg_backend_pid() and c.txid=txid_current();
 if not found then
  select c.job_id into job from private.schema_job_commit_context c where c.workspace_id=p_workspace and c.pid=pg_backend_pid() and c.txid=txid_current();
  if not found then perform app.lock_workspace_account();perform app.authorize_workspace(p_requirements);return;end if;
  if (select count(*) from private.schema_job_commit_context c where c.workspace_id=p_workspace and c.pid=pg_backend_pid() and c.txid=txid_current())<>1 or not private.authorize_schema_job(p_workspace,job) then raise exception 'workspace_denied' using errcode='42501';end if;
  select j.initiated_by,j.required_permissions into executor,captured from app.entity_schema_migrations j where j.workspace_id=p_workspace and j.id=job;
 else
  if not private.authorize_schema_group(p_workspace,model) then raise exception 'workspace_denied' using errcode='42501';end if;
  select g.initiated_by,private.search_model_permissions(g.plan) into executor,captured from app.data_model_changes g where g.workspace_id=p_workspace and g.id=model;
  select captured||coalesce(jsonb_agg(permission),'[]') into captured from app.data_model_children c join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id
   cross join lateral jsonb_array_elements(j.required_permissions) permission where c.workspace_id=p_workspace and c.model_id=model;
 end if;
 if not private.schema_permissions_allow(executor,p_workspace,captured) or not private.schema_permissions_allow(executor,p_workspace,p_requirements) then raise exception 'workspace_denied' using errcode='42501';end if;
 if exists(select 1 from jsonb_array_elements(p_requirements) requested where requested->>'target_kind'<>'settings' and not exists(
  select 1 from jsonb_array_elements(captured) saved where saved->>'target_kind'=requested->>'target_kind' and saved->>'target_id'=requested->>'target_id'
   and (saved->>'access'='write' or saved->>'access'=requested->>'access'))) then raise exception 'model_publication_requirement_not_captured' using errcode='42501';end if;
end $$;
revoke all on function private.search_model_permissions(jsonb) from public,anon,authenticated,app_user,app_server,app_worker;

-- Read gates are independent of source existence. Adapters hold the standard
-- short Auth/workspace transaction; these projections never claim work or write.
create function app.require_search_workspace() returns void language plpgsql stable security definer set search_path='' as $$
begin
 if not private.workspace_member(auth.uid(),app.current_workspace_id()) then raise exception 'workspace_denied' using errcode='42501';end if;
end $$;
create function app.entity_search_text(p_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare kind uuid;w uuid:=app.current_workspace_id();
begin
 perform app.require_search_workspace();
 select entity_type_id into kind from app.entities where workspace_id=w and id=p_id;
 if not found or not private.workspace_allows(auth.uid(),w,'entity_type',kind::text,'read') then raise exception 'workspace_denied' using errcode='42501';end if;
 return private.entity_search_input(w,p_id);
end $$;
revoke all on function app.require_search_workspace(),app.entity_search_text(text) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.require_search_workspace(),app.entity_search_text(text) to app_user;

-- MATERIALIZED readable rows are selected before hashes, private effects, counts
-- and pages. A task association never grants an entity-owned record affiliation.
create function private.status_source_indexing(p_pipeline text,p_at timestamptz)
returns table(source_kind text,source_id text,created_at timestamptz,state text,reason text,body text,source_version bigint,input_hash text)
language plpgsql stable security definer set search_path='' as $$
declare w uuid:=app.current_workspace_id();
begin
 perform app.require_search_workspace();
 return query with readable_records as materialized (
  select r.id,r.created_at,r.body,r.version from app.records r where r.workspace_id=w and
   ((r.task_id is not null and app.workspace_allows('tasks','*','read')) or (r.entity_id is not null and exists(
    select 1 from app.entities e where e.workspace_id=w and e.id=r.entity_id and app.workspace_allows('entity_type',e.entity_type_id::text,'read'))))
 ), readable_entities as materialized (
  select e.id,e.created_at,e.version from app.entities e where e.workspace_id=w and app.workspace_allows('entity_type',e.entity_type_id::text,'read')
 ), originals as materialized (
  select 'record'::text as kind,r.id,r.created_at,r.body,r.version::bigint from readable_records r
  union all select 'entity',e.id,e.created_at,private.entity_search_input(w,e.id)->>'body',e.version::bigint from readable_entities e
 ), current_sources as materialized (
  select o.*,s.state as index_state,s.reason as index_reason,s.generation,s.workspace_generation,s.initiated_by,s.required_permissions,s.source_schema_version,s.pipeline,s.input_hash
  from originals o left join app.search_index_state s on s.workspace_id=w and s.kind=o.kind and s.id=o.id and s.source_version=o.version
   and s.pipeline=p_pipeline and s.input_hash=encode(extensions.digest(o.body,'sha256'),'hex')
   and exists(select 1 from app.workspaces workspace where workspace.id=w and workspace.lifecycle_generation=s.workspace_generation)
 )
 select o.kind,o.id,o.created_at,
  case when o.index_state='excluded' then 'excluded' when o.index_state='indexed' and chunk.present then 'indexed'
   when o.index_state='failed' or o.index_reason='retry_exhausted' or effect.reason is not null then 'attention' else 'preparing' end,
  case when o.index_state='excluded' or (o.index_state='indexed' and chunk.present) then null when effect.reason is not null then effect.reason
   when o.index_state='failed' or o.index_reason='retry_exhausted' then coalesce(o.index_reason,'retry_exhausted') end,
  o.body,o.version,o.input_hash
 from current_sources o
 cross join lateral (select exists(select 1 from app.search_chunks c where c.workspace_id=w and c.source_kind=o.kind and c.source_id=o.id
  and c.source_version=o.version and c.workspace_generation=o.workspace_generation and c.generation=o.generation) as present) chunk
 left join lateral (
  select case when pe.state='unknown' or (pe.state='running' and (pe.lease_until is null or pe.lease_until<=p_at)) then
    case when pe.attempts>=5 then 'retry_exhausted' else coalesce(pe.reason,'provider_unknown') end
   when pe.state='failed' and (pe.reason<>'transient' or pe.attempts>=5) and not (pe.reason='input_limit' and pe.end_offset-pe.start_offset>1) then
    case when pe.attempts>=5 then 'retry_exhausted' else pe.reason end
   when pe.state='pending' and pe.attempts>=5 then 'retry_exhausted' end as reason
  from private.passage_effects pe where pe.workspace_id=w and pe.source_kind=o.kind and pe.source_id=o.id and pe.source_version=o.version
   and pe.source_hash=o.input_hash and pe.pipeline=o.pipeline and pe.workspace_generation=o.workspace_generation
   and pe.initiated_by is not distinct from o.initiated_by and pe.required_permissions=o.required_permissions
   and pe.source_schema_version is not distinct from o.source_schema_version
  order by case when pe.state='unknown' or (pe.state='running' and (pe.lease_until is null or pe.lease_until<=p_at)) then 0
   when pe.state='failed' and (pe.reason<>'transient' or pe.attempts>=5) and not (pe.reason='input_limit' and pe.end_offset-pe.start_offset>1) then 1
   when pe.state='pending' and pe.attempts>=5 then 2 else 3 end,pe.start_offset,pe.end_offset limit 1
 ) effect on true;
end $$;
revoke all on function private.status_source_indexing(text,timestamptz) from public,anon,authenticated,app_user,app_server,app_worker;

create function private.status_source_wait(p_pipeline text,p_at timestamptz,p_kind text) returns jsonb language sql stable security definer set search_path='' as $$
 with preparing as (
  select coalesce(s.updated_at,original.updated_at) as since from private.status_source_indexing(p_pipeline,p_at) i
  join lateral (select r.updated_at from app.records r where i.source_kind='record' and r.workspace_id=app.current_workspace_id() and r.id=i.source_id
   union all select e.updated_at from app.entities e where i.source_kind='entity' and e.workspace_id=app.current_workspace_id() and e.id=i.source_id) original on true
  left join app.search_index_state s on s.workspace_id=app.current_workspace_id() and s.kind=i.source_kind and s.id=i.source_id and s.source_version=i.source_version
   and s.pipeline=p_pipeline and s.input_hash=i.input_hash
  where i.state='preparing' and i.source_kind=p_kind
 ) select jsonb_build_object('long_waiting',count(*) filter(where since<=p_at-interval '15 minutes'),
  'oldest_waiting_since',min(since),'threshold_minutes',15) from preparing
$$;
revoke all on function private.status_source_wait(text,timestamptz,text) from public,anon,authenticated,app_user,app_server,app_worker;

create or replace function app.status_overview(p_pipeline text,p_timezone text,p_at timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform app.require_search_workspace();
 return (
 with dates as (select (p_at at time zone p_timezone)::date-29 as first_day,(p_at at time zone p_timezone)::date as last_day),
 readable_entities as materialized (select e.created_at,e.deleted_at from app.entities e where e.workspace_id=app.current_workspace_id() and app.workspace_allows('entity_type',e.entity_type_id::text,'read')),
 readable_tasks as materialized (select t.created_at,t.completed_at,t.kind,t.status from app.tasks t where t.workspace_id=app.current_workspace_id() and app.workspace_allows('tasks','*','read')),
 readable_records as materialized (select r.created_at,r.record_kind from app.records r where r.workspace_id=app.current_workspace_id() and
  ((r.task_id is not null and app.workspace_allows('tasks','*','read')) or (r.entity_id is not null and exists(select 1 from app.entities e
   where e.workspace_id=r.workspace_id and e.id=r.entity_id and app.workspace_allows('entity_type',e.entity_type_id::text,'read'))))),
 indexing as materialized (select * from private.status_source_indexing(p_pipeline,p_at)),
 entity_counts as (select count(*)::int as total,count(*) filter(where deleted_at is null)::int as active,count(*) filter(where deleted_at is not null)::int as deleted from readable_entities),
 task_counts as (select count(*)::int as total,count(*) filter(where status='open')::int as open,count(*) filter(where status='done')::int as done,
  count(*) filter(where status='active')::int as active,count(*) filter(where status='stopped')::int as stopped from readable_tasks),
 record_counts as (select count(*)::int as total,count(*) filter(where record_kind='result')::int as result,count(*) filter(where record_kind='change')::int as change from readable_records),
 index_counts as (select count(*)::int as total,count(*) filter(where state='indexed')::int as indexed,count(*) filter(where state='preparing')::int as preparing,
  count(*) filter(where state='attention')::int as attention,count(*) filter(where state='excluded')::int as excluded from indexing where source_kind='record'),
 entity_index_counts as (select count(*)::int as total,count(*) filter(where state='indexed')::int as indexed,count(*) filter(where state='preparing')::int as preparing,
  count(*) filter(where state='attention')::int as attention,count(*) filter(where state='excluded')::int as excluded from indexing where source_kind='entity'),
 events as (
  select (created_at at time zone p_timezone)::date as day,'entities_created' as kind from readable_entities
  union all select (created_at at time zone p_timezone)::date,'tasks_created' from readable_tasks
  union all select (completed_at at time zone p_timezone)::date,'once_completed' from readable_tasks where kind='once' and completed_at is not null
  union all select (created_at at time zone p_timezone)::date,'records_created' from readable_records
 ),activity_days as (
  select day,count(*) filter(where kind='entities_created')::int as entities_created,count(*) filter(where kind='tasks_created')::int as tasks_created,
   count(*) filter(where kind='once_completed')::int as once_completed,count(*) filter(where kind='records_created')::int as records_created
   from events,dates where day between first_day and last_day group by day
 ),index_days as (
  select (created_at at time zone p_timezone)::date as day,source_kind,count(*) filter(where state='indexed')::int as indexed,
   count(*) filter(where state='preparing')::int as preparing,count(*) filter(where state='attention')::int as attention,count(*) filter(where state='excluded')::int as excluded
   from indexing,dates where (created_at at time zone p_timezone)::date between first_day and last_day group by day,source_kind
 ),days as (select first_day+n as day from dates,generate_series(0,29) n),daily as (
  select to_char(d.day,'YYYY-MM-DD') as date,coalesce(a.entities_created,0) as entities_created,coalesce(a.tasks_created,0) as tasks_created,
   coalesce(a.once_completed,0) as once_completed,coalesce(a.records_created,0) as records_created,
   jsonb_build_object('indexed',coalesce(i.indexed,0),'preparing',coalesce(i.preparing,0),'attention',coalesce(i.attention,0),'excluded',coalesce(i.excluded,0)) as indexing,
   jsonb_build_object('indexed',coalesce(e.indexed,0),'preparing',coalesce(e.preparing,0),'attention',coalesce(e.attention,0),'excluded',coalesce(e.excluded,0)) as entity_indexing
  from days d left join activity_days a on a.day=d.day left join index_days i on i.day=d.day and i.source_kind='record'
   left join index_days e on e.day=d.day and e.source_kind='entity'
 ) select jsonb_build_object('period',jsonb_build_object('from',to_char(first_day,'YYYY-MM-DD'),'to',to_char(last_day,'YYYY-MM-DD'),'days',30),
  'entities',(select to_jsonb(e) from entity_counts e),'tasks',(select to_jsonb(t) from task_counts t),'records',(select to_jsonb(r) from record_counts r),
  'indexing',(select to_jsonb(i) from index_counts i)||jsonb_build_object('waiting',private.status_source_wait(p_pipeline,p_at,'record')),
  'entity_indexing',(select to_jsonb(i) from entity_index_counts i)||jsonb_build_object('waiting',private.status_source_wait(p_pipeline,p_at,'entity')),
  'daily',(select jsonb_agg(to_jsonb(d) order by d.date) from daily d)) from dates
 );
end $$;

create or replace function app.status_indexing_issues(p_pipeline text,p_at timestamptz,p_after_at timestamptz default null,p_after_id text default null)
returns table(issue jsonb) language plpgsql stable security definer set search_path='' as $$
declare w uuid:=app.current_workspace_id();
begin
 perform app.require_search_workspace();
 return query with problems as materialized (
  select i.* from private.status_source_indexing(p_pipeline,p_at) i where i.state='attention'
   and (p_after_at is null or (i.created_at,i.source_id)<(p_after_at,p_after_id)) order by i.created_at desc,i.source_id desc limit 6
 ) select jsonb_build_object('id',p.source_id,'kind',p.source_kind,
  'path',case when p.source_kind='entity' then '/entities/'||app.entity_path_segment(p.source_id) else '/records/'||p.source_id end,
  'created_at',p.created_at,'title',left(p.body,100),'reason',coalesce(p.reason,'provider_unknown'),'attempts',coalesce(e.attempts,0),
  'chunks',jsonb_build_object('total',e.total,'succeeded',e.succeeded,'preparing',e.preparing,'unknown',e.unknown,'failed',e.failed))
 from problems p join app.search_index_state s on s.workspace_id=w and s.kind=p.source_kind and s.id=p.source_id and s.source_version=p.source_version
  and s.input_hash=p.input_hash and s.pipeline=p_pipeline
 cross join lateral (
  select coalesce(sum(pe.attempts),0)::int as attempts,count(*)::int as total,count(*) filter(where pe.state='succeeded')::int as succeeded,
   count(*) filter(where (pe.state='pending' and pe.attempts<5) or (pe.state='running' and pe.lease_until>p_at) or (pe.state='failed' and pe.reason='transient' and pe.attempts<5))::int as preparing,
   count(*) filter(where pe.state='unknown' or (pe.state='pending' and pe.attempts>=5) or (pe.state='running' and (pe.lease_until is null or pe.lease_until<=p_at)))::int as unknown,
   count(*) filter(where pe.state='failed' and (pe.reason<>'transient' or pe.attempts>=5))::int as failed
  from private.passage_effects pe where pe.workspace_id=w and pe.source_kind=p.source_kind and pe.source_id=p.source_id and pe.source_version=p.source_version
   and pe.source_hash=p.input_hash and pe.pipeline=p_pipeline and pe.workspace_generation=s.workspace_generation
   and pe.initiated_by is not distinct from s.initiated_by and pe.required_permissions=s.required_permissions
   and pe.source_schema_version is not distinct from s.source_schema_version
   and not (pe.state='failed' and pe.reason='input_limit' and pe.end_offset-pe.start_offset>1)
 ) e order by p.created_at desc,p.source_id desc;
end $$;
-- The current application has no callers of these owner-era helper interfaces.
drop function app.status_record_indexing(text,timestamptz);
drop function app.status_indexing_wait(text,timestamptz);
drop function app.require_search_owner();

-- Search consumes only safe current classifications, never the private ledger.
create function app.search_indexing_states(p_pipeline text) returns table(kind text,id text,state text) language sql stable security definer set search_path='' as $$
 select i.source_kind,i.source_id,case i.state when 'preparing' then 'pending' when 'attention' then 'failed' else i.state end
 from private.status_source_indexing(p_pipeline,statement_timestamp()) i
$$;
revoke all on function app.search_indexing_states(text) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.search_indexing_states(text) to app_user;
