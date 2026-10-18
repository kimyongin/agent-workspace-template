-- Scoped record indexing. Existing legacy attempts and uncertain sends remain retained;
-- this worker can execute only sources with explicit workspace execution facts.
alter table app.search_chunks add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.search_chunks add column source_version bigint;
alter table app.search_chunks add column workspace_generation bigint;
alter table app.search_chunks drop constraint search_chunks_pkey;
alter table app.search_chunks add unique(owner_id,record_id,ordinal);
alter table app.search_chunks alter column owner_id drop not null;
alter table app.search_chunks add unique(workspace_id,record_id,ordinal);
alter table app.search_chunks add foreign key(workspace_id,record_id) references app.records(workspace_id,id) on delete cascade;
alter table app.search_chunks add check(workspace_id is null or (owner_id is null and source_version>0 and workspace_generation>0));
drop policy search_chunks_owner on app.search_chunks;
create policy search_chunks_workspace_read on app.search_chunks for select to app_user
 using(workspace_id=app.current_workspace_id() and exists(select 1 from app.records r where r.workspace_id=search_chunks.workspace_id and r.id=search_chunks.record_id));

alter table app.search_index_state add column required_permissions jsonb not null default '[]' check(jsonb_typeof(required_permissions)='array');
alter table private.passage_effects add column workspace_id uuid references app.workspaces(id) on delete set null;
alter table private.passage_effects add column initiated_by uuid references auth.users(id) on delete set null;
alter table private.passage_effects add column workspace_generation bigint;
alter table private.passage_effects add column message_id bigint;
alter table private.passage_effects add column required_permissions jsonb not null default '[]' check(jsonb_typeof(required_permissions)='array');
alter table private.passage_effects add column permission_hash text generated always as (encode(extensions.digest(required_permissions::text,'sha256'),'hex')) stored;
alter table private.passage_effects drop constraint passage_effects_owner_id_fkey;
alter table private.passage_effects add foreign key(owner_id) references auth.users(id) on delete set null;
alter table private.passage_effects alter column owner_id drop not null;
alter table private.passage_effects add unique(workspace_id,record_id,source_version,source_hash,pipeline,workspace_generation,initiated_by,permission_hash,provider_scope,model,dimensions,start_offset,end_offset,input_hash);

-- Persist publication's entire affected footprint, rather than substituting the
-- single generated record's parent for the job that produced it.
create function private.capture_search_permissions() returns trigger language plpgsql security definer set search_path='' as $$
declare parent app.records; inherited jsonb;
begin
 if new.workspace_id is null then return new;end if;
 select * into parent from app.records where workspace_id=new.workspace_id and id=new.id;
 if not found then raise exception 'workspace_search_source_invalid' using errcode='23514';end if;
 if parent.entity_id is not null then
  select jsonb_build_array(jsonb_build_object('target_kind','entity_type','target_id',e.entity_type_id::text,'access','write'))
   into new.required_permissions from app.entities e where e.workspace_id=new.workspace_id and e.id=parent.entity_id;
 else new.required_permissions:='[{"target_kind":"tasks","target_id":"*","access":"write"}]';end if;
 select private.normalize_schema_permissions(j.required_permissions||'[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb)
  into inherited from private.schema_job_commit_context c join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id
  where c.workspace_id=new.workspace_id and c.pid=pg_backend_pid() and c.txid=txid_current();
 new.required_permissions:=private.normalize_schema_permissions(new.required_permissions||coalesce(inherited,'[]'));
 return new;
end $$;
create trigger capture_search_permissions before insert on app.search_index_state for each row execute function private.capture_search_permissions();
-- Pending sources created before this forward acquire only their actual immutable
-- parent's footprint; nothing is inferred from Auth ownership.
update app.search_index_state s set required_permissions=case when r.task_id is not null then
 '[{"target_kind":"tasks","target_id":"*","access":"write"}]'::jsonb else
 jsonb_build_array(jsonb_build_object('target_kind','entity_type','target_id',e.entity_type_id::text,'access','write')) end
 from app.records r left join app.entities e on e.workspace_id=r.workspace_id and e.id=r.entity_id
 where s.workspace_id=r.workspace_id and s.kind='record' and s.id=r.id;
update app.search_index_state s set required_permissions=private.normalize_schema_permissions(s.required_permissions||j.required_permissions||'[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb)
 from app.records r join app.entity_schema_migrations j on j.workspace_id=r.workspace_id and j.id::text=r.change_metadata->>'schema_migration_id'
 where s.workspace_id=r.workspace_id and s.kind='record' and s.id=r.id;

-- Queue admission reads immutable affiliation and current execution authority only.
-- No protected body/vector is read until the separately committed prepare stage.
create function private.search_record_execution_allows(s app.search_index_state) returns boolean language sql stable set search_path='' as $$
 select s.workspace_id is not null and s.initiated_by is not null
  and exists(select 1 from app.workspaces w where w.id=s.workspace_id and w.deleted_at is null and w.lifecycle_generation=s.workspace_generation)
  and private.workspace_member(s.initiated_by,s.workspace_id)
  and private.schema_permissions_allow(s.initiated_by,s.workspace_id,s.required_permissions)
  and exists(select 1 from app.records r left join app.entities e on e.workspace_id=r.workspace_id and e.id=r.entity_id
   where r.workspace_id=s.workspace_id and r.id=s.id and
    ((r.task_id is not null and private.workspace_allows(s.initiated_by,s.workspace_id,'tasks','*','write')) or
     (r.entity_id is not null and private.workspace_allows(s.initiated_by,s.workspace_id,'entity_type',e.entity_type_id::text,'write'))))
$$;

-- Auth -> workspace -> actual parent/source -> state -> effect is the same lock
-- order at every stage. Each RPC commits before the provider is invoked.
create function private.authorize_search_record(p_workspace uuid,p_id text,p_message bigint,p_pipeline text) returns boolean
 language plpgsql set search_path='' as $$
declare s app.search_index_state; parent_entity text; parent_task text; parent_kind uuid; source app.records; j jsonb;
begin
 select * into s from app.search_index_state where workspace_id=p_workspace and kind='record' and id=p_id;
 if not found or s.initiated_by is null then return false;end if;
 perform 1 from auth.users where id=s.initiated_by for share;
 if not found then return false;end if;
 perform 1 from app.workspaces where id=p_workspace for share;
 if not found then return false;end if;
 perform set_config('request.workspace_id',p_workspace::text,true);
 perform set_config('request.workspace_lock_mode','business',true);
 if not exists(select 1 from app.workspaces where id=p_workspace and deleted_at is null and lifecycle_generation=s.workspace_generation)
  or not private.workspace_member(s.initiated_by,p_workspace)
  or not private.schema_permissions_allow(s.initiated_by,p_workspace,s.required_permissions) then return false;end if;
 -- Resolve only immutable affiliation before granting access to body/hash/vector.
 select entity_id,task_id into parent_entity,parent_task from app.records where workspace_id=p_workspace and id=p_id;
 if not found then return false;end if;
 if parent_entity is not null then
  select entity_type_id into parent_kind from app.entities where workspace_id=p_workspace and id=parent_entity;
  if not found or not private.workspace_allows(s.initiated_by,p_workspace,'entity_type',parent_kind::text,'write') then return false;end if;
 elsif parent_task is not null then
  if not private.workspace_allows(s.initiated_by,p_workspace,'tasks','*','write') then return false;end if;
 else return false;end if;
 select * into source from app.records where workspace_id=p_workspace and id=p_id for update;
 if not found or source.version is distinct from s.source_version or encode(extensions.digest(source.body,'sha256'),'hex') is distinct from s.input_hash then return false;end if;
 select * into s from app.search_index_state where workspace_id=p_workspace and kind='record' and id=p_id for update;
 if not found or s.state<>'pending' or s.message_id is distinct from p_message or s.pipeline is distinct from p_pipeline then return false;end if;
 select message into j from pgmq.q_search_index where msg_id=p_message;
 return j->>'workspace_id'=p_workspace::text and j->>'id'=p_id and j->>'kind'='record'
  and j->>'initiated_by'=s.initiated_by::text and (j->>'workspace_generation')::bigint=s.workspace_generation
  and (j->>'source_version')::bigint=s.source_version and j->>'input_hash'=s.input_hash and j->>'pipeline'=s.pipeline;
end $$;

-- UUID scope now means workspace explicitly; no owner fallback or adoption.
drop function app.claim_search_index(integer,uuid,text,text);
create function app.claim_search_index(p_limit integer,p_workspace uuid default null,p_kind text default null,p_id text default null)
returns table(msg_id bigint,read_ct integer) language plpgsql security definer set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 5 or (p_kind is not null and p_kind not in ('task','record')) then raise exception 'invalid_worker_scope' using errcode='22023';end if;
 if p_kind='task' then return;end if;
 -- Select only scoped current jobs. Never mutate retained legacy queue entries.
 -- Queue locks end with this RPC; protected source locks start in prepare.
 return query with candidates as (
  select q.msg_id from pgmq.q_search_index q join app.search_index_state s
   on s.workspace_id::text=q.message->>'workspace_id' and s.kind='record' and s.id=q.message->>'id' and s.message_id=q.msg_id
  where q.vt<=clock_timestamp() and q.message->>'kind'='record' and s.state='pending'
   and (p_workspace is null or s.workspace_id=p_workspace) and (p_id is null or s.id=p_id)
   and q.message->>'initiated_by'=s.initiated_by::text and (q.message->>'workspace_generation')::bigint=s.workspace_generation
   and (q.message->>'source_version')::bigint=s.source_version and q.message->>'input_hash'=s.input_hash and q.message->>'pipeline'=s.pipeline
   and private.search_record_execution_allows(s)
  order by q.msg_id limit p_limit for update of q skip locked
 ), claimed as (
  update pgmq.q_search_index q set vt=clock_timestamp()+interval '90 seconds',read_ct=q.read_ct+1
   from candidates c where q.msg_id=c.msg_id returning q.msg_id,q.read_ct)
 select c.msg_id,c.read_ct from claimed c order by c.msg_id;
end $$;
create or replace function app.prepare_search_index(p_message bigint,p_pipeline text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j jsonb; s app.search_index_state; body text; w uuid;
begin
 select message into j from pgmq.q_search_index where msg_id=p_message;
 if not found or j->>'workspace_id' is null then return null;end if;
 w:=(j->>'workspace_id')::uuid;
 if not coalesce(private.authorize_search_record(w,j->>'id',p_message,p_pipeline),false) then return null;end if;
 select * into s from app.search_index_state where workspace_id=w and kind='record' and id=j->>'id';
 select r.body into body from app.records r where r.workspace_id=w and r.id=s.id;
 return jsonb_build_object('workspace_id',w,'initiated_by',s.initiated_by,'workspace_generation',s.workspace_generation,
  'source_version',s.source_version,'required_permissions',s.required_permissions,'kind','record','id',s.id,'input_hash',s.input_hash,'body',body);
end $$;

create or replace function app.finish_search_index(p_message bigint,p_pipeline text,p_state text,p_reason text,p_chunks jsonb default null,p_delay integer default 0)
returns boolean language plpgsql security definer set search_path='' as $$
declare source jsonb; c jsonb; v extensions.vector; s integer; e integer; covered integer:=0; n integer:=0; w uuid; i text; body_length integer;
begin
 if p_state is null or p_state not in ('indexed','excluded','failed','retry','held')
  or (p_state='indexed' and (p_chunks is null or jsonb_typeof(p_chunks)<>'array' or jsonb_array_length(p_chunks)=0))
  or (p_state<>'indexed' and (p_reason is null or p_reason not in ('invalid_input','input_limit','configuration','retry_exhausted','transient','invalid_response','provider_unknown')))
  or p_delay is null or p_delay not between 0 and 3600 then raise exception 'invalid_index_result' using errcode='22023';end if;
 source:=app.prepare_search_index(p_message,p_pipeline);
 if source is null then return false;end if;
 w:=(source->>'workspace_id')::uuid;i:=source->>'id';body_length:=char_length(source->>'body');
 if p_state='held' then
  update app.search_index_state set reason=p_reason,message_id=null,updated_at=now() where workspace_id=w and kind='record' and id=i;
  perform pgmq.archive('search_index',p_message);return true;
 end if;
 if p_state='retry' then perform pgmq.set_vt('search_index',p_message,p_delay);return true;end if;
 delete from app.search_chunks where workspace_id=w and record_id=i;
 if p_state='indexed' then
  for c in select value from jsonb_array_elements(p_chunks) loop
   s:=(c->>'start')::integer;e:=(c->>'end')::integer;v:=(c->>'vector')::extensions.vector;
   if s is null or e is null or s<0 or s>covered or e<=s or e>body_length or v is null or extensions.vector_dims(v)<>1024 or extensions.vector_norm(v)=0 then
    raise exception 'invalid_index_chunk' using errcode='22023';end if;
   insert into app.search_chunks(workspace_id,record_id,source_version,workspace_generation,generation,ordinal,start_offset,end_offset,embedding)
    values(w,i,(source->>'source_version')::bigint,(source->>'workspace_generation')::bigint,p_message,n,s,e,v);
   covered:=greatest(covered,e);n:=n+1;
  end loop;
  if covered<>body_length then raise exception 'incomplete_index_chunks' using errcode='22023';end if;
 end if;
 update app.search_index_state set state=p_state,reason=p_reason,generation=case when p_state='indexed' then p_message end,message_id=null,updated_at=now()
  where workspace_id=w and kind='record' and id=i;
 if p_state='indexed' then perform pgmq.delete('search_index',p_message);else perform pgmq.archive('search_index',p_message);end if;
 return true;
end $$;

create or replace function app.claim_passage_effect(p_message bigint,p_pipeline text,p_scope text,p_model text,p_dimensions integer,p_start integer,p_end integer,p_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare src jsonb;e private.passage_effects;
begin
 if p_scope is null or p_scope !~ '^[0-9a-f]{64}$' or p_model is null or char_length(p_model) not between 1 and 120
  or p_dimensions is distinct from 1024 or p_start is null or p_start<0 or p_end is null or p_end<=p_start or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
  raise exception 'invalid_effect_input' using errcode='22023';end if;
 src:=app.prepare_search_index(p_message,p_pipeline);
 if src is null then return jsonb_build_object('action','stale');end if;
 if p_end>char_length(src->>'body') or p_hash<>encode(extensions.digest(substring(src->>'body' from p_start+1 for p_end-p_start),'sha256'),'hex') then
  raise exception 'invalid_effect_source' using errcode='22023';end if;
 insert into private.passage_effects(workspace_id,initiated_by,workspace_generation,message_id,required_permissions,record_id,source_version,source_hash,pipeline,provider_scope,model,dimensions,start_offset,end_offset,input_hash)
  values((src->>'workspace_id')::uuid,(src->>'initiated_by')::uuid,(src->>'workspace_generation')::bigint,p_message,src->'required_permissions',src->>'id',
   (src->>'source_version')::bigint,src->>'input_hash',p_pipeline,p_scope,p_model,p_dimensions,p_start,p_end,p_hash) on conflict do nothing;
 select * into e from private.passage_effects where workspace_id=(src->>'workspace_id')::uuid and record_id=src->>'id'
  and source_version=(src->>'source_version')::bigint and source_hash=src->>'input_hash' and pipeline=p_pipeline
  and workspace_generation=(src->>'workspace_generation')::bigint and initiated_by=(src->>'initiated_by')::uuid
  and required_permissions=src->'required_permissions' and provider_scope=p_scope and model=p_model and dimensions=p_dimensions
  and start_offset=p_start and end_offset=p_end and input_hash=p_hash for update;
 if not found then return jsonb_build_object('action','stale');end if;
 if e.state='succeeded' then return jsonb_build_object('action','cached','effect_id',e.id,'vector',e.result::text::jsonb);end if;
 if e.state='running' and e.lease_until>clock_timestamp() or e.next_attempt_at>clock_timestamp() then return jsonb_build_object('action','busy','effect_id',e.id);end if;
 if e.state='running' then e.state:='unknown';e.reason:='provider_unknown';end if;
 if e.state='failed' and e.reason<>'transient' then return jsonb_build_object('action','held','effect_id',e.id,'state',e.state,'reason',e.reason,'attempts',e.attempts);end if;
 if e.attempts>=5 then
  update private.passage_effects set state=e.state,reason='retry_exhausted',lease_until=null,updated_at=now() where id=e.id;
  return jsonb_build_object('action','held','effect_id',e.id,'state',e.state,'reason','retry_exhausted','attempts',e.attempts);
 end if;
 update private.passage_effects set state='running',reason=null,fence=fence+1,lease_until=clock_timestamp()+interval '90 seconds',updated_at=now(),attempts=attempts+1,message_id=p_message where id=e.id returning * into e;
 return jsonb_build_object('action','send','effect_id',e.id,'fence',e.fence,'attempts',e.attempts);
end $$;
create or replace function app.complete_passage_effect(p_effect uuid,p_fence bigint,p_state text,p_reason text,p_vector jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare e private.passage_effects;i private.passage_effects;src jsonb;v extensions.vector;
begin
 if p_state is null or p_state not in ('succeeded','failed','unknown')
  or (p_state='failed' and (p_reason is null or p_reason not in ('transient','configuration','input_limit')))
  or (p_state='unknown' and (p_reason is null or p_reason not in ('provider_unknown','invalid_response'))) then raise exception 'invalid_effect_result' using errcode='22023';end if;
 select * into i from private.passage_effects where id=p_effect;
 if not found or i.workspace_id is null then return false;end if;
 src:=app.prepare_search_index(i.message_id,i.pipeline);
 if src is null or (src->>'workspace_id')::uuid is distinct from i.workspace_id or src->>'id' is distinct from i.record_id
  or (src->>'source_version')::bigint is distinct from i.source_version or src->>'input_hash' is distinct from i.source_hash
  or (src->>'initiated_by')::uuid is distinct from i.initiated_by or (src->>'workspace_generation')::bigint is distinct from i.workspace_generation
  or src->'required_permissions' is distinct from i.required_permissions then return false;end if;
 select * into e from private.passage_effects where id=p_effect for update;
 if not found or e.state<>'running' or e.fence<>p_fence or e.lease_until<=clock_timestamp() then return false;end if;
 if p_state='succeeded' then
  v:=p_vector::text::extensions.vector;
  if v is null or extensions.vector_dims(v)<>e.dimensions or extensions.vector_norm(v)=0 then raise exception 'invalid_effect_vector' using errcode='22023';end if;
 elsif p_vector is not null then raise exception 'invalid_effect_vector' using errcode='22023';end if;
 update private.passage_effects set state=p_state,reason=case when p_state='succeeded' then null when p_state='unknown' and attempts>=5 then 'retry_exhausted' else p_reason end,
  result=v,lease_until=null,updated_at=now(),next_attempt_at=clock_timestamp()+make_interval(secs=>case when p_state='unknown' or (p_state='failed' and p_reason='transient')
   then least(900,30*power(2,greatest(0,attempts-1))::integer) else 0 end) where id=p_effect;
 return true;
end $$;
revoke all on function private.capture_search_permissions(),private.search_record_execution_allows(app.search_index_state),private.authorize_search_record(uuid,text,bigint,text) from public,anon,authenticated,app_user,app_server,app_worker;
revoke all on function app.claim_search_index(integer,uuid,text,text) from public,anon,authenticated,app_user,app_server;
grant execute on function app.claim_search_index(integer,uuid,text,text) to app_worker;
