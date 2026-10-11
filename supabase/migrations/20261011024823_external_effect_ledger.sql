-- Existing search queue is the outbox. This intent is written in its local transaction.
create table private.search_effect_intents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  record_id text not null,
  source_version integer not null,
  source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
  pipeline text not null,
  created_at timestamptz not null default now(),
  unique(owner_id,record_id,source_version,source_hash,pipeline)
);
create table private.passage_effects (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references private.search_effect_intents(id) on delete cascade,
  provider_scope text not null check(provider_scope ~ '^[0-9a-f]{64}$'),
  model text not null check(char_length(model) between 1 and 120),
  dimensions integer not null check(dimensions=1024),
  start_offset integer not null check(start_offset>=0),
  end_offset integer not null check(end_offset>start_offset),
  input_hash text not null check(input_hash ~ '^[0-9a-f]{64}$'),
  provider_key uuid not null default gen_random_uuid(),
  provider_job_id text check(provider_job_id ~ '^[A-Za-z0-9:_-]{1,120}$'),
  state text not null default 'pending' check(state in ('pending','running','succeeded','failed','unknown')),
  reason text check(reason in ('provider_unknown','transient','configuration','input_limit','invalid_response',
    'retry_exhausted','key_expired','unsupported_recovery')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  fence bigint not null default 0,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  key_expires_at timestamptz,
  key_supported boolean,
  result extensions.vector(1024),
  updated_at timestamptz not null default now(),
  unique(intent_id,provider_scope,model,dimensions,start_offset,end_offset,input_hash),
  check((state='succeeded')=(result is not null))
);
alter table private.search_effect_intents enable row level security;
alter table private.passage_effects enable row level security;
revoke all on private.search_effect_intents,private.passage_effects from public,anon,authenticated,app_user,app_server,app_worker;

create function private.register_search_effect_intent() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.kind='record' and new.state='pending' then
    insert into private.search_effect_intents(owner_id,record_id,source_version,source_hash,pipeline)
      select new.owner_id,new.id,r.version,new.input_hash,new.pipeline from app.records r where r.owner_id=new.owner_id and r.id=new.id on conflict do nothing;
    -- Only final results from superseded revisions are disposable. Uncertain sends survive.
    delete from private.passage_effects e using private.search_effect_intents i
      where e.intent_id=i.id and i.owner_id=new.owner_id and i.record_id=new.id
        and (i.source_hash<>new.input_hash or i.pipeline<>new.pipeline or i.source_version<>(select version from app.records where owner_id=new.owner_id and id=new.id)) and e.state in ('succeeded','failed');
  end if;
  return new;
end $$;
create trigger search_effect_intent after insert or update on app.search_index_state
  for each row execute function private.register_search_effect_intent();
-- Existing pending outbox entries also get a durable intent.
insert into private.search_effect_intents(owner_id,record_id,source_version,source_hash,pipeline)
  select s.owner_id,s.id,r.version,s.input_hash,s.pipeline from app.search_index_state s join app.records r on r.owner_id=s.owner_id and r.id=s.id where s.kind='record' and s.state='pending'
  on conflict do nothing;

create function private.prune_record_effect_results() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from private.passage_effects e using private.search_effect_intents i
    where e.intent_id=i.id and i.owner_id=old.owner_id and i.record_id=old.id and e.state in ('succeeded','failed');
  return old;
end $$;
create trigger prune_record_effect_results after delete on app.records
  for each row execute function private.prune_record_effect_results();
-- A version-only record edit can reuse the pending queue message, but is a new effect identity.
create function private.refresh_record_effect_intent() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into private.search_effect_intents(owner_id,record_id,source_version,source_hash,pipeline)
    select new.owner_id,new.id,new.version,s.input_hash,s.pipeline from app.search_index_state s
      where s.owner_id=new.owner_id and s.id=new.id and s.kind='record' and s.state='pending'
        and s.input_hash=encode(extensions.digest(new.body,'sha256'),'hex') on conflict do nothing;
  delete from private.passage_effects e using private.search_effect_intents i
    where e.intent_id=i.id and i.owner_id=new.owner_id and i.record_id=new.id
      and i.source_version<>new.version and e.state in ('succeeded','failed');
  return new;
end $$;
create trigger refresh_record_effect_intent after update of body,version on app.records
  for each row execute function private.refresh_record_effect_intent();
revoke all on function private.refresh_record_effect_intent() from public,anon,authenticated,app_user,app_server,app_worker;
revoke all on function private.register_search_effect_intent(),private.prune_record_effect_results()
  from public,anon,authenticated,app_user,app_server,app_worker;

create function app.claim_passage_effect(p_message bigint,p_pipeline text,p_scope text,p_model text,p_dimensions integer,
  p_start integer,p_end integer,p_hash text,p_key_seconds integer,p_lookup boolean,p_recompute boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare src jsonb; intent uuid; e private.passage_effects; action text:='send';
begin
  if p_scope is null or p_scope !~ '^[0-9a-f]{64}$' or p_model is null or char_length(p_model) not between 1 and 120
    or p_dimensions is distinct from 1024 or p_start is null or p_start<0 or p_end is null or p_end<=p_start
    or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_lookup is null or p_recompute is null
    or (p_key_seconds is not null and p_key_seconds not between 1 and 2592000) then
    raise exception 'invalid_effect_input' using errcode='22023';
  end if;
  src:=app.prepare_search_index(p_message,p_pipeline);
  if src is null then return jsonb_build_object('action','stale'); end if;
  if p_end>char_length(src->>'body') or p_hash<>encode(extensions.digest(
      substring(src->>'body' from p_start+1 for p_end-p_start),'sha256'),'hex') then
    raise exception 'invalid_effect_source' using errcode='22023';
  end if;
  select id into intent from private.search_effect_intents where owner_id=(src->>'owner_id')::uuid
    and record_id=src->>'id' and source_hash=src->>'input_hash' and pipeline=p_pipeline
    and source_version=(select version from app.records where owner_id=(src->>'owner_id')::uuid and id=src->>'id');
  if intent is null then raise exception 'missing_effect_intent' using errcode='23503'; end if;
  insert into private.passage_effects(intent_id,provider_scope,model,dimensions,start_offset,end_offset,input_hash)
    values(intent,p_scope,p_model,p_dimensions,p_start,p_end,p_hash) on conflict do nothing;
  select * into e from private.passage_effects where intent_id=intent and provider_scope=p_scope and model=p_model
    and dimensions=p_dimensions and start_offset=p_start and end_offset=p_end and input_hash=p_hash for update;
  if e.state='succeeded' then return jsonb_build_object('action','cached','effect_id',e.id,'vector',e.result::text::jsonb); end if;
  if e.state='running' and e.lease_until>clock_timestamp() or e.next_attempt_at>clock_timestamp() then
    return jsonb_build_object('action','busy','effect_id',e.id);
  end if;
  -- A lease expiry never proves that the external send failed.
  if e.state='running' then e.state:='unknown'; e.reason:='provider_unknown'; end if;
  if e.state='failed' and e.reason<>'transient' then
    return jsonb_build_object('action','held','effect_id',e.id,'state',e.state,'reason',e.reason,'attempts',e.attempts);
  end if;
  if e.state='unknown' then
    if p_lookup and e.provider_job_id is not null then action:='lookup';
    elsif not p_recompute and (p_key_seconds is null or not coalesce(e.key_supported,false) or e.key_expires_at<=clock_timestamp()) then
      e.reason:=case when p_key_seconds is not null and coalesce(e.key_supported,false) then 'key_expired' else 'unsupported_recovery' end;
      update private.passage_effects set state='unknown',reason=e.reason,lease_until=null,updated_at=now() where id=e.id;
      return jsonb_build_object('action','held','effect_id',e.id,'state','unknown','reason',e.reason,'attempts',e.attempts);
    end if;
  end if;
  if action='send' and e.attempts>=5 then
    update private.passage_effects set state=e.state,reason='retry_exhausted',lease_until=null,updated_at=now() where id=e.id;
    return jsonb_build_object('action','held','effect_id',e.id,'state',e.state,'reason','retry_exhausted','attempts',e.attempts);
  end if;
  update private.passage_effects set state='running',reason=null,fence=fence+1,
    lease_until=clock_timestamp()+interval '90 seconds',updated_at=now(),
    attempts=attempts+case when action='send' then 1 else 0 end,
    key_supported=coalesce(key_supported,p_key_seconds is not null),
    key_expires_at=case when attempts=0 and p_key_seconds is not null then clock_timestamp()+make_interval(secs=>p_key_seconds)
      else key_expires_at end
    where id=e.id returning * into e;
  return jsonb_build_object('action',action,'effect_id',e.id,'fence',e.fence,'key',e.provider_key,
    'attempts',e.attempts,'job_id',e.provider_job_id);
end $$;

create function app.complete_passage_effect(p_effect uuid,p_fence bigint,p_state text,p_reason text,p_vector jsonb,p_job text)
returns boolean language plpgsql security definer set search_path='' as $$
declare e private.passage_effects; i private.search_effect_intents; body text; v extensions.vector;
begin
  if p_state is null or p_state not in ('succeeded','failed','unknown','accepted')
    or (p_state='failed' and (p_reason is null or p_reason not in ('transient','configuration','input_limit')))
    or (p_state='unknown' and (p_reason is null or p_reason not in ('provider_unknown','invalid_response')))
    or (p_job is not null and p_job !~ '^[A-Za-z0-9:_-]{1,120}$')
    or (p_state='accepted' and p_job is null) then raise exception 'invalid_effect_result' using errcode='22023'; end if;
  -- Lock the source before the effect, matching claim/enqueue lock order.
  select * into i from private.search_effect_intents where id=(select intent_id from private.passage_effects where id=p_effect);
  if not found then return false; end if;
  select r.body into body from app.records r where r.owner_id=i.owner_id and r.id=i.record_id for update;
  if not found or encode(extensions.digest(body,'sha256'),'hex')<>i.source_hash or not exists(
    select 1 from app.search_index_state s where s.owner_id=i.owner_id and s.kind='record' and s.id=i.record_id
      and s.input_hash=i.source_hash and s.pipeline=i.pipeline and i.source_version=(select version from app.records where owner_id=i.owner_id and id=i.record_id)) then return false; end if;
  select * into e from private.passage_effects where id=p_effect for update;
  if not found or e.state<>'running' or e.fence<>p_fence or e.lease_until<=clock_timestamp() then return false; end if;
  if p_state='succeeded' then
    v:=p_vector::text::extensions.vector;
    if v is null or extensions.vector_dims(v)<>e.dimensions or extensions.vector_norm(v)=0 then
      raise exception 'invalid_effect_vector' using errcode='22023'; end if;
  elsif p_vector is not null then raise exception 'invalid_effect_vector' using errcode='22023'; end if;
  update private.passage_effects set state=case when p_state='accepted' then 'unknown' else p_state end,
    reason=case when p_state='accepted' then 'provider_unknown' when p_state='succeeded' then null else p_reason end,
    provider_job_id=coalesce(p_job,provider_job_id),result=v,lease_until=null,updated_at=now(),
    next_attempt_at=clock_timestamp()+make_interval(secs=>case when p_state='accepted' then 1
      when p_state='unknown' or (p_state='failed' and p_reason='transient') then least(900,30*power(2,greatest(0,attempts-1))::integer)
      else 0 end)
    where id=p_effect;
  return true;
end $$;

create function app.record_passage_effect_status(p_record text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid:=auth.uid(); result jsonb;
begin
  if o is null or not exists(select 1 from auth.users where id=o) then
    raise exception 'request_owner_missing' using errcode='42501'; end if;
  if not exists(select 1 from app.records where id=p_record and owner_id=o) then
    raise exception 'effect_record_missing' using errcode='23503'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('effect_id',e.id,'state',
      case when e.state='running' and e.lease_until<=clock_timestamp() then 'unknown' else e.state end,
      'attempts',e.attempts,'reason',case when e.state='running' and e.lease_until<=clock_timestamp() then 'provider_unknown' else e.reason end,
      'start',e.start_offset,'end',e.end_offset) order by e.start_offset,e.end_offset),'[]'::jsonb)
    into result from private.passage_effects e join private.search_effect_intents i on i.id=e.intent_id
      join app.search_index_state s on s.owner_id=i.owner_id and s.id=i.record_id and s.kind='record'
        and s.input_hash=i.source_hash and s.pipeline=i.pipeline
      where i.owner_id=o and i.record_id=p_record and i.source_version=(select version from app.records where owner_id=o and id=p_record);
  return result;
end $$;
revoke all on function app.claim_passage_effect(bigint,text,text,text,integer,integer,integer,text,integer,boolean,boolean),
  app.complete_passage_effect(uuid,bigint,text,text,jsonb,text),app.record_passage_effect_status(text)
  from public,anon,authenticated,app_user,app_server,app_worker;
grant execute on function app.claim_passage_effect(bigint,text,text,text,integer,integer,integer,text,integer,boolean,boolean),
  app.complete_passage_effect(uuid,bigint,text,text,jsonb,text) to app_worker;
grant execute on function app.record_passage_effect_status(text) to app_user;
