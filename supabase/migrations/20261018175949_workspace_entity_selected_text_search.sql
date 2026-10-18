-- Selected entity text shares the existing bounded passage/effect pipeline.
-- Explicit source references replace the record-only graph; no legacy adoption.
alter table app.search_index_state drop constraint search_index_state_kind_check;
alter table app.search_index_state add check(kind in ('record','entity'));
alter table app.search_index_state drop constraint search_state_workspace_record_fk;
alter table app.search_index_state drop constraint search_state_scoped_revision;
alter table app.search_index_state add column source_schema_version bigint;
alter table app.search_index_state add column record_source_id text generated always as (case when kind='record' then id end) stored;
alter table app.search_index_state add column entity_source_id text generated always as (case when kind='entity' then id end) stored;
alter table app.search_index_state add foreign key(workspace_id,record_source_id) references app.records(workspace_id,id) on delete cascade;
alter table app.search_index_state add foreign key(workspace_id,entity_source_id) references app.entities(workspace_id,id) on delete cascade;
alter table app.search_index_state add check(workspace_id is null or (owner_id is null and workspace_generation is not null and workspace_generation>0 and source_version is not null and source_version>0
 and ((kind='record' and source_schema_version is null) or (kind='entity' and source_schema_version is not null and source_schema_version>0))));

alter table app.search_chunks rename column record_id to source_id;
alter table app.search_chunks add column source_kind text not null default 'record' check(source_kind in ('record','entity'));
alter table app.search_chunks add column source_schema_version bigint;
alter table app.search_chunks add check(workspace_id is null or (source_version is not null and source_version>0 and workspace_generation is not null and workspace_generation>0
 and ((source_kind='record' and source_schema_version is null) or (source_kind='entity' and source_schema_version is not null and source_schema_version>0))));
alter table app.search_chunks add column record_source_id text generated always as (case when source_kind='record' then source_id end) stored;
alter table app.search_chunks add column entity_source_id text generated always as (case when source_kind='entity' then source_id end) stored;
alter table app.search_chunks drop constraint search_chunks_workspace_id_record_id_fkey;
alter table app.search_chunks drop constraint search_chunks_workspace_id_record_id_ordinal_key;
alter table app.search_chunks add constraint search_chunks_workspace_source_key unique(workspace_id,source_kind,source_id,ordinal);
alter table app.search_chunks add foreign key(workspace_id,record_source_id) references app.records(workspace_id,id) on delete cascade;
alter table app.search_chunks add foreign key(workspace_id,entity_source_id) references app.entities(workspace_id,id) on delete cascade;
drop policy search_chunks_workspace_read on app.search_chunks;
create policy search_chunks_workspace_read on app.search_chunks for select to app_user using(workspace_id=app.current_workspace_id() and
 ((source_kind='record' and exists(select 1 from app.records r where r.workspace_id=search_chunks.workspace_id and r.id=search_chunks.source_id)) or
  (source_kind='entity' and exists(select 1 from app.entities e where e.workspace_id=search_chunks.workspace_id and e.id=search_chunks.source_id))));
drop policy search_state_workspace_read on app.search_index_state;
create policy search_state_workspace_read on app.search_index_state for select to app_user using(workspace_id=app.current_workspace_id() and
 ((kind='record' and exists(select 1 from app.records r where r.workspace_id=search_index_state.workspace_id and r.id=search_index_state.id)) or
  (kind='entity' and exists(select 1 from app.entities e where e.workspace_id=search_index_state.workspace_id and e.id=search_index_state.id))));

alter table private.passage_effects rename column record_id to source_id;
alter table private.passage_effects add column source_kind text not null default 'record' check(source_kind in ('record','entity'));
alter table private.passage_effects add column source_schema_version bigint;
alter table private.passage_effects add column projection_version bigint generated always as (coalesce(source_schema_version,0)) stored;
alter table private.passage_effects add check(workspace_id is null or (owner_id is null and workspace_generation is not null and workspace_generation>0 and message_id is not null
 and ((source_kind='record' and source_schema_version is null) or (source_kind='entity' and source_schema_version is not null and source_schema_version>0))));
do $$ declare c record;n integer:=0;begin
 for c in select conname from pg_constraint where conrelid='private.passage_effects'::regclass and contype='u' and pg_get_constraintdef(oid) like '%workspace_id%' loop
  execute format('alter table private.passage_effects drop constraint %I',c.conname);n:=n+1;
 end loop;
 if n<>1 then raise exception 'unexpected_scoped_passage_identity';end if;
end $$;
alter table private.passage_effects add constraint passage_workspace_source_identity unique(workspace_id,source_kind,source_id,source_version,projection_version,source_hash,pipeline,workspace_generation,initiated_by,permission_hash,provider_scope,model,dimensions,start_offset,end_offset,input_hash);

create function private.entity_search_definition(document jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,jsonb_build_object('title',value->'title','order',value->'x-order','type',value->'type','format',value->'format','oneOf',value->'oneOf','deprecated',value->'deprecated')),'{}')
 from jsonb_each(document->'properties') where value->'x-search-text'='true'::jsonb
$$;

-- Callers authorize immutable kind affiliation before invoking this private
-- projection. Offsets address this exact labeled text, never properties JSON.
create function private.entity_search_input(p_workspace uuid,p_id text) returns jsonb language plpgsql stable set search_path='' as $$
declare document jsonb;properties jsonb;field record;body text:='';fields jsonb:='[]';label text;field_text text;start_offset integer;
begin
 select v.schema,e.properties into document,properties from app.entities e join app.entity_types t on t.workspace_id=e.workspace_id and t.id=e.entity_type_id
  join app.entity_schema_versions v on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version
  where e.workspace_id=p_workspace and e.id=p_id and e.deleted_at is null;
 if not found then return jsonb_build_object('body','','fields','[]'::jsonb);end if;
 for field in select key,value as definition from jsonb_each(document->'properties')
  where value->'x-search-text'='true'::jsonb and not coalesce((value->>'deprecated')::boolean,false)
   and (value->'type'='"string"'::jsonb or value->'type'='["string","null"]'::jsonb or value->'type'='["null","string"]'::jsonb)
   and not (value ? 'format') and not (value ? 'oneOf') order by (value->>'x-order')::integer,key loop
  if jsonb_typeof(properties->field.key) is distinct from 'string' then continue;end if;
  field_text:=properties->>field.key;
  if trim(field_text)='' then continue;end if;
  label:=coalesce(nullif(field.definition->>'title',''),field.key);
  if body<>'' then body:=body||E'\n\n';end if;
  body:=body||label||E'\n';start_offset:=char_length(body);body:=body||field_text;
  fields:=fields||jsonb_build_array(jsonb_build_object('key',field.key,'label',label,'start',start_offset,'end',char_length(body)));
 end loop;
 return jsonb_build_object('body',body,'fields',fields);
end $$;

create or replace function private.capture_search_permissions() returns trigger language plpgsql security definer set search_path='' as $$
declare parent app.records;inherited jsonb;group_permissions jsonb;requested jsonb:=new.required_permissions;
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
  where ctx.workspace_id=new.workspace_id and ctx.pid=pg_backend_pid() and ctx.txid=txid_current()
  having count(*)>0;
 new.required_permissions:=private.normalize_schema_permissions(new.required_permissions||coalesce(requested,'[]')||coalesce(inherited,'[]')||coalesce(group_permissions,'[]'));
 return new;
end $$;
create or replace function private.check_workspace_record_search_source() returns trigger language plpgsql security definer set search_path='' as $$
declare body text;
begin
 if new.workspace_id is null then return new;end if;
 if new.initiated_by is null or not exists(select 1 from app.workspaces w where w.id=new.workspace_id and w.deleted_at is null and w.lifecycle_generation=new.workspace_generation) then
  raise exception 'workspace_search_source_invalid' using errcode='23514';end if;
 if new.kind='record' then
  select r.body into body from app.records r where r.workspace_id=new.workspace_id and r.id=new.id and r.version=new.source_version;
 else
  if not exists(select 1 from app.entities e join app.entity_types t on t.workspace_id=e.workspace_id and t.id=e.entity_type_id
   where e.workspace_id=new.workspace_id and e.id=new.id and e.version=new.source_version and t.schema_version=new.source_schema_version) then
   raise exception 'workspace_search_source_invalid' using errcode='23514';end if;
  body:=private.entity_search_input(new.workspace_id,new.id)->>'body';
 end if;
 if body is null or encode(extensions.digest(body,'sha256'),'hex') is distinct from new.input_hash then raise exception 'workspace_search_source_invalid' using errcode='23514';end if;
 return new;
end $$;

-- Ordinary entity writes and model/schema publication use the same atomic
-- projection producer. Settings authority alone never grants protected values.
create function private.enqueue_entity_search(p_workspace uuid,p_id text,p_publication boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare executor uuid:=auth.uid();epoch bigint;revision bigint;schema_revision bigint;type_id uuid;projection jsonb;hash text;message_id bigint;required jsonb;
 pipeline constant text:='llama-v2-1024-record-body-utf8-1800-overlap180-v1';
begin
 select e.entity_type_id into type_id from app.entities e where e.workspace_id=p_workspace and e.id=p_id;
 if not found then return;end if;
 required:=jsonb_build_array(jsonb_build_object('target_kind','entity_type','target_id',type_id::text,'access','write'));
 select j.initiated_by into executor from private.schema_job_commit_context c join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id
  where c.workspace_id=p_workspace and c.pid=pg_backend_pid() and c.txid=txid_current();
 if not found then
  select g.initiated_by into executor from private.data_model_commit_context c join app.data_model_changes g on g.workspace_id=c.workspace_id and g.id=c.model_id
   where c.workspace_id=p_workspace and c.pid=pg_backend_pid() and c.txid=txid_current();
  if not found then executor:=auth.uid();end if;
 end if;
 if p_publication then required:=required||'[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb;end if;
 perform private.authorize_model_publication_requirements(p_workspace,required);
 if executor is null or not private.schema_permissions_allow(executor,p_workspace,required) then raise exception 'workspace_denied' using errcode='42501';end if;
 select lifecycle_generation into epoch from app.workspaces where id=p_workspace and deleted_at is null;
 select e.version,t.schema_version into revision,schema_revision from app.entities e join app.entity_types t on t.workspace_id=e.workspace_id and t.id=e.entity_type_id
  where e.workspace_id=p_workspace and e.id=p_id;
 projection:=private.entity_search_input(p_workspace,p_id);hash:=encode(extensions.digest(projection->>'body','sha256'),'hex');
 delete from pgmq.q_search_index where message->>'workspace_id'=p_workspace::text and message->>'kind'='entity' and message->>'id'=p_id;
 delete from app.search_chunks where workspace_id=p_workspace and source_kind='entity' and source_id=p_id;
 delete from app.search_index_state where workspace_id=p_workspace and kind='entity' and id=p_id;
 if trim(projection->>'body')<>'' then
  select pgmq.send('search_index',jsonb_build_object('workspace_id',p_workspace,'initiated_by',executor,'workspace_generation',epoch,
   'source_version',revision,'source_schema_version',schema_revision,'kind','entity','id',p_id,'input_hash',hash,'pipeline',pipeline)) into message_id;
 end if;
 insert into app.search_index_state(workspace_id,initiated_by,workspace_generation,source_version,source_schema_version,kind,id,input_hash,pipeline,message_id,state,reason,required_permissions)
 values(p_workspace,executor,epoch,revision,schema_revision,'entity',p_id,hash,pipeline,message_id,
  case when message_id is null then 'excluded' else 'pending' end,case when message_id is null then 'invalid_input' end,required);
end $$;
create function private.entity_search_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Migration rows are staged against a not-yet-published schema; the final type
 -- publication below enqueues every current source using its actual executor.
 if exists(select 1 from private.schema_job_commit_context c where c.workspace_id=new.workspace_id and c.pid=pg_backend_pid() and c.txid=txid_current()) then return new;end if;
 perform private.enqueue_entity_search(new.workspace_id,new.id);return new;
end $$;
create trigger entity_search_changed after insert or update of properties,schema_version,version,deleted_at on app.entities
 for each row when (new.workspace_id is not null) execute function private.entity_search_changed();
create function private.entity_search_schema_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare old_projection jsonb;new_projection jsonb;entity record;
begin
 if new.schema_version is not distinct from old.schema_version then return new;end if;
 select coalesce(jsonb_object_agg(key,jsonb_build_object('title',value->'title','order',value->'x-order','type',value->'type','format',value->'format','oneOf',value->'oneOf','deprecated',value->'deprecated')),'{}') into old_projection
  from app.entity_schema_versions v cross join lateral jsonb_each(v.schema->'properties') p
  where v.workspace_id=old.workspace_id and v.type_id=old.id and v.schema_version=old.schema_version and value->'x-search-text'='true'::jsonb;
 select coalesce(jsonb_object_agg(key,jsonb_build_object('title',value->'title','order',value->'x-order','type',value->'type','format',value->'format','oneOf',value->'oneOf','deprecated',value->'deprecated')),'{}') into new_projection
  from app.entity_schema_versions v cross join lateral jsonb_each(v.schema->'properties') p
  where v.workspace_id=new.workspace_id and v.type_id=new.id and v.schema_version=new.schema_version and value->'x-search-text'='true'::jsonb;
 -- Unrelated metadata does not read protected values or invalidate identical
 -- selected input. Worker authorization compares the current selected projection
 -- against the captured published version before accepting that exact hash.
 if old_projection=new_projection then return new;end if;
 for entity in select id from app.entities where workspace_id=new.workspace_id and entity_type_id=new.id order by id loop
  perform private.enqueue_entity_search(new.workspace_id,entity.id,true);
 end loop;
 return new;
end $$;
create trigger entity_search_schema_changed after update of schema_version on app.entity_types for each row
 when (new.workspace_id is not null) execute function private.entity_search_schema_changed();

create function private.search_execution_allows(s app.search_index_state) returns boolean language sql stable set search_path='' as $$
 select s.workspace_id is not null and s.initiated_by is not null
  and exists(select 1 from app.workspaces w where w.id=s.workspace_id and w.deleted_at is null and w.lifecycle_generation=s.workspace_generation)
  and private.workspace_member(s.initiated_by,s.workspace_id)
  and private.schema_permissions_allow(s.initiated_by,s.workspace_id,s.required_permissions)
  and ((s.kind='record' and exists(select 1 from app.records r left join app.entities e on e.workspace_id=r.workspace_id and e.id=r.entity_id
   where r.workspace_id=s.workspace_id and r.id=s.id and r.version=s.source_version and ((r.task_id is not null and private.workspace_allows(s.initiated_by,s.workspace_id,'tasks','*','write')) or
    (r.entity_id is not null and private.workspace_allows(s.initiated_by,s.workspace_id,'entity_type',e.entity_type_id::text,'write'))))) or
   (s.kind='entity' and exists(select 1 from app.entities e where e.workspace_id=s.workspace_id and e.id=s.id and e.version=s.source_version
    and private.workspace_allows(s.initiated_by,s.workspace_id,'entity_type',e.entity_type_id::text,'write'))))
$$;
create function private.authorize_search_source(p_workspace uuid,p_kind text,p_id text,p_message bigint,p_pipeline text) returns boolean language plpgsql set search_path='' as $$
declare s app.search_index_state;parent_kind uuid;body text;revision bigint;schema_revision bigint;j jsonb;
begin
 select * into s from app.search_index_state where workspace_id=p_workspace and kind=p_kind and id=p_id;
 if not found or s.initiated_by is null then return false;end if;
 perform 1 from auth.users where id=s.initiated_by for share;
 if not found then return false;end if;
 perform 1 from app.workspaces where id=p_workspace for share;
 if not found then return false;end if;
 perform set_config('request.workspace_id',p_workspace::text,true);perform set_config('request.workspace_lock_mode','business',true);
 if not private.search_execution_allows(s) then return false;end if;
 if p_kind='record' then
  select r.body,r.version into body,revision from app.records r where r.workspace_id=p_workspace and r.id=p_id for update;
 else
  select e.entity_type_id into parent_kind from app.entities e where e.workspace_id=p_workspace and e.id=p_id;
  if not found then return false;end if;
  select t.schema_version into schema_revision from app.entity_types t where t.workspace_id=p_workspace and t.id=parent_kind for share;
  select e.version into revision from app.entities e where e.workspace_id=p_workspace and e.id=p_id for update;
  body:=private.entity_search_input(p_workspace,p_id)->>'body';
 end if;
 if p_kind='entity' and schema_revision is distinct from s.source_schema_version and not exists(
  select 1 from app.entity_schema_versions before_schema join app.entity_schema_versions published_schema
   on published_schema.workspace_id=before_schema.workspace_id and published_schema.type_id=before_schema.type_id
  where before_schema.workspace_id=p_workspace and before_schema.type_id=parent_kind and before_schema.schema_version=s.source_schema_version
   and published_schema.schema_version=schema_revision
   and private.entity_search_definition(before_schema.schema)=private.entity_search_definition(published_schema.schema)) then return false;end if;
 if body is null or revision is distinct from s.source_version
  or encode(extensions.digest(body,'sha256'),'hex') is distinct from s.input_hash then return false;end if;
 select * into s from app.search_index_state where workspace_id=p_workspace and kind=p_kind and id=p_id for update;
 if not found or s.state<>'pending' or s.message_id is distinct from p_message or s.pipeline is distinct from p_pipeline then return false;end if;
 select message into j from pgmq.q_search_index where msg_id=p_message;
 return coalesce(j->>'workspace_id'=p_workspace::text and j->>'id'=p_id and j->>'kind'=p_kind
  and j->>'initiated_by'=s.initiated_by::text and (j->>'workspace_generation')::bigint=s.workspace_generation
  and (j->>'source_version')::bigint=s.source_version and (j->>'source_schema_version')::bigint is not distinct from s.source_schema_version
  and j->>'input_hash'=s.input_hash and j->>'pipeline'=s.pipeline,false);
end $$;

create or replace function app.claim_search_index(p_limit integer,p_workspace uuid default null,p_kind text default null,p_id text default null)
returns table(msg_id bigint,read_ct integer) language plpgsql security definer set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 5 or (p_kind is not null and p_kind not in ('task','record','entity')) then raise exception 'invalid_worker_scope' using errcode='22023';end if;
 if p_kind='task' then return;end if;
 -- Select only scoped current jobs. Never mutate retained legacy queue entries.
 -- Queue locks end with this RPC; protected source locks start in prepare.
 return query with candidates as (
  select q.msg_id from pgmq.q_search_index q join app.search_index_state s
   on s.workspace_id::text=q.message->>'workspace_id' and s.kind=q.message->>'kind' and s.id=q.message->>'id' and s.message_id=q.msg_id
  where q.vt<=clock_timestamp() and q.message->>'kind' in ('record','entity') and (p_kind is null or s.kind=p_kind) and s.state='pending'
   and (p_workspace is null or s.workspace_id=p_workspace) and (p_id is null or s.id=p_id)
   and q.message->>'initiated_by'=s.initiated_by::text and (q.message->>'workspace_generation')::bigint=s.workspace_generation
   and (q.message->>'source_version')::bigint=s.source_version and (q.message->>'source_schema_version')::bigint is not distinct from s.source_schema_version and q.message->>'input_hash'=s.input_hash and q.message->>'pipeline'=s.pipeline
   and private.search_execution_allows(s)
  order by q.msg_id limit p_limit for update of q skip locked
 ), claimed as (
  update pgmq.q_search_index q set vt=clock_timestamp()+interval '90 seconds',read_ct=q.read_ct+1
   from candidates c where q.msg_id=c.msg_id returning q.msg_id,q.read_ct)
 select c.msg_id,c.read_ct from claimed c order by c.msg_id;
end $$;
create or replace function app.prepare_search_index(p_message bigint,p_pipeline text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j jsonb;s app.search_index_state;body text;fields jsonb:='[]';projection jsonb;w uuid;source_kind text;
begin
 select message into j from pgmq.q_search_index where msg_id=p_message;
 if not found or j->>'workspace_id' is null then return null;end if;
 w:=(j->>'workspace_id')::uuid;source_kind:=j->>'kind';
 if not coalesce(private.authorize_search_source(w,source_kind,j->>'id',p_message,p_pipeline),false) then return null;end if;
 select * into s from app.search_index_state where workspace_id=w and search_index_state.kind=source_kind and id=j->>'id';
 if source_kind='record' then select r.body into body from app.records r where r.workspace_id=w and r.id=s.id;
 else projection:=private.entity_search_input(w,s.id);body:=projection->>'body';fields:=projection->'fields';end if;
 return jsonb_build_object('workspace_id',w,'initiated_by',s.initiated_by,'workspace_generation',s.workspace_generation,
  'source_version',s.source_version,'source_schema_version',s.source_schema_version,'required_permissions',s.required_permissions,
  'kind',source_kind,'id',s.id,'input_hash',s.input_hash,'body',body,'fields',fields);
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
  update app.search_index_state set reason=p_reason,message_id=null,updated_at=now() where workspace_id=w and kind=source->>'kind' and id=i;
  perform pgmq.archive('search_index',p_message);return true;
 end if;
 if p_state='retry' then perform pgmq.set_vt('search_index',p_message,p_delay);return true;end if;
 delete from app.search_chunks where workspace_id=w and source_kind=source->>'kind' and source_id=i;
 if p_state='indexed' then
  for c in select value from jsonb_array_elements(p_chunks) loop
   s:=(c->>'start')::integer;e:=(c->>'end')::integer;v:=(c->>'vector')::extensions.vector;
   if s is null or e is null or s<0 or s>covered or e<=s or e>body_length or v is null or extensions.vector_dims(v)<>1024 or extensions.vector_norm(v)=0 then
    raise exception 'invalid_index_chunk' using errcode='22023';end if;
   insert into app.search_chunks(workspace_id,source_kind,source_id,source_version,source_schema_version,workspace_generation,generation,ordinal,start_offset,end_offset,embedding)
    values(w,source->>'kind',i,(source->>'source_version')::bigint,(source->>'source_schema_version')::bigint,(source->>'workspace_generation')::bigint,p_message,n,s,e,v);
   covered:=greatest(covered,e);n:=n+1;
  end loop;
  if covered<>body_length then raise exception 'incomplete_index_chunks' using errcode='22023';end if;
 end if;
 update app.search_index_state set state=p_state,reason=p_reason,generation=case when p_state='indexed' then p_message end,message_id=null,updated_at=now()
  where workspace_id=w and kind=source->>'kind' and id=i;
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
 insert into private.passage_effects(workspace_id,initiated_by,workspace_generation,message_id,required_permissions,source_kind,source_id,source_version,source_schema_version,source_hash,pipeline,provider_scope,model,dimensions,start_offset,end_offset,input_hash)
  values((src->>'workspace_id')::uuid,(src->>'initiated_by')::uuid,(src->>'workspace_generation')::bigint,p_message,src->'required_permissions',src->>'kind',src->>'id',
   (src->>'source_version')::bigint,(src->>'source_schema_version')::bigint,src->>'input_hash',p_pipeline,p_scope,p_model,p_dimensions,p_start,p_end,p_hash) on conflict do nothing;
 select * into e from private.passage_effects where workspace_id=(src->>'workspace_id')::uuid and source_kind=src->>'kind' and source_id=src->>'id'
  and source_version=(src->>'source_version')::bigint and source_schema_version is not distinct from (src->>'source_schema_version')::bigint and source_hash=src->>'input_hash' and pipeline=p_pipeline
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
 if src is null or (src->>'workspace_id')::uuid is distinct from i.workspace_id or src->>'id' is distinct from i.source_id or src->>'kind' is distinct from i.source_kind
  or (src->>'source_schema_version')::bigint is distinct from i.source_schema_version
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

-- Completed superseded results may be discarded; uncertain/running effects are
-- retained even when the business source disappears. No owner-to-workspace path.
create or replace function private.prune_superseded_passage_results() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='records' then
  delete from private.passage_effects where workspace_id=new.workspace_id and source_kind='record' and source_id=new.id
   and source_version<>new.version and state in ('succeeded','failed');
 elsif new.state='pending' then
  delete from private.passage_effects where workspace_id=new.workspace_id and source_kind=new.kind and source_id=new.id
   and (source_version<>new.source_version or source_schema_version is distinct from new.source_schema_version or source_hash<>new.input_hash or pipeline<>new.pipeline)
   and state in ('succeeded','failed');
 end if;
 return new;
end $$;
create or replace function private.prune_record_effect_results() returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from private.passage_effects where workspace_id=old.workspace_id and source_kind='record' and source_id=old.id and state in ('succeeded','failed');return old;
end $$;
drop function private.authorize_search_record(uuid,text,bigint,text);
drop function private.search_record_execution_allows(app.search_index_state);
revoke all on function private.entity_search_definition(jsonb),private.entity_search_input(uuid,text),private.enqueue_entity_search(uuid,text,boolean),private.entity_search_changed(),private.entity_search_schema_changed(),
 private.search_execution_allows(app.search_index_state),private.authorize_search_source(uuid,text,text,bigint,text) from public,anon,authenticated,app_user,app_server,app_worker;

create function private.guard_search_source_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if new.kind is distinct from old.kind or new.id is distinct from old.id or new.source_version is distinct from old.source_version
  or new.source_schema_version is distinct from old.source_schema_version or new.workspace_generation is distinct from old.workspace_generation
  or new.input_hash is distinct from old.input_hash or new.pipeline is distinct from old.pipeline or new.required_permissions is distinct from old.required_permissions
  or (new.initiated_by is distinct from old.initiated_by and new.initiated_by is not null) then
  raise exception 'search_source_identity_immutable' using errcode='23514';end if;
 return new;
end $$;
create trigger search_source_identity before update on app.search_index_state for each row execute function private.guard_search_source_identity();
revoke all on function private.guard_search_source_identity() from public,anon,authenticated,app_user,app_server,app_worker;
