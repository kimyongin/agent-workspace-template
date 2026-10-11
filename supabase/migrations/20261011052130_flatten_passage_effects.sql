-- Flatten identities in place: existing IDs, vectors, attempts, fences and clocks survive.
alter table private.passage_effects
  add column owner_id uuid references auth.users(id) on delete cascade,
  add column record_id text,
  add column source_version integer,
  add column source_hash text check(source_hash ~ '^[0-9a-f]{64}$'),
  add column pipeline text;
update private.passage_effects e set owner_id=i.owner_id,record_id=i.record_id,
  source_version=i.source_version,source_hash=i.source_hash,pipeline=i.pipeline
  from private.search_effect_intents i where i.id=e.intent_id;
alter table private.passage_effects
  alter column owner_id set not null,alter column record_id set not null,
  alter column source_version set not null,alter column source_hash set not null,alter column pipeline set not null,
  drop column intent_id,drop column provider_key,drop column provider_job_id,
  drop column key_expires_at,drop column key_supported;
alter table private.passage_effects add unique(owner_id,record_id,source_version,source_hash,pipeline,
  provider_scope,model,dimensions,start_offset,end_offset,input_hash);
-- Obsolete recovery reasons are uncertainty, never evidence of definite failure.
update private.passage_effects set reason='provider_unknown' where reason in ('key_expired','unsupported_recovery');
alter table private.passage_effects drop constraint passage_effects_reason_check;
alter table private.passage_effects add check(reason in ('provider_unknown','transient','configuration','input_limit','invalid_response','retry_exhausted'));
drop trigger search_effect_intent on app.search_index_state;
drop trigger refresh_record_effect_intent on app.records;
drop function private.register_search_effect_intent();
drop function private.refresh_record_effect_intent();
drop function app.claim_passage_effect(bigint,text,text,text,integer,integer,integer,text,integer,boolean,boolean);
drop function app.complete_passage_effect(uuid,bigint,text,text,jsonb,text);
-- Keep completed-source cleanup, without registering a second work intent.
create function private.prune_superseded_passage_results() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='records' then
    delete from private.passage_effects where owner_id=new.owner_id and record_id=new.id
      and source_version<>new.version and state in ('succeeded','failed');
  elsif new.kind='record' and new.state='pending' then
    delete from private.passage_effects where owner_id=new.owner_id and record_id=new.id
      and (source_hash<>new.input_hash or pipeline<>new.pipeline
        or source_version<>(select version from app.records where owner_id=new.owner_id and id=new.id))
      and state in ('succeeded','failed');
  end if;
  return new;
end $$;
create trigger prune_superseded_passage_results after insert or update on app.search_index_state
  for each row execute function private.prune_superseded_passage_results();
create trigger prune_revised_passage_results after update of body,version on app.records
  for each row execute function private.prune_superseded_passage_results();
create or replace function private.prune_record_effect_results() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from private.passage_effects where owner_id=old.owner_id and record_id=old.id and state in ('succeeded','failed');
  return old;
end $$;
revoke all on function private.prune_superseded_passage_results() from public,anon,authenticated,app_user,app_server,app_worker;
create function app.claim_passage_effect(p_message bigint,p_pipeline text,p_scope text,p_model text,p_dimensions integer,
  p_start integer,p_end integer,p_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare src jsonb; source_revision integer; e private.passage_effects;
begin
  if p_scope is null or p_scope !~ '^[0-9a-f]{64}$' or p_model is null or char_length(p_model) not between 1 and 120
    or p_dimensions is distinct from 1024 or p_start is null or p_start<0 or p_end is null or p_end<=p_start
    or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_effect_input' using errcode='22023';
  end if;
  src:=app.prepare_search_index(p_message,p_pipeline);
  if src is null then return jsonb_build_object('action','stale'); end if;
  if p_end>char_length(src->>'body') or p_hash<>encode(extensions.digest(
      substring(src->>'body' from p_start+1 for p_end-p_start),'sha256'),'hex') then
    raise exception 'invalid_effect_source' using errcode='22023';
  end if;
  select version into source_revision from app.records where owner_id=(src->>'owner_id')::uuid and id=src->>'id';
  insert into private.passage_effects(owner_id,record_id,source_version,source_hash,pipeline,provider_scope,model,dimensions,start_offset,end_offset,input_hash)
    values((src->>'owner_id')::uuid,src->>'id',source_revision,src->>'input_hash',p_pipeline,p_scope,p_model,p_dimensions,p_start,p_end,p_hash) on conflict do nothing;
  select * into e from private.passage_effects where owner_id=(src->>'owner_id')::uuid and record_id=src->>'id'
    and source_version=source_revision and source_hash=src->>'input_hash' and pipeline=p_pipeline
    and provider_scope=p_scope and model=p_model and dimensions=p_dimensions
    and start_offset=p_start and end_offset=p_end and input_hash=p_hash for update;
  if e.state='succeeded' then return jsonb_build_object('action','cached','effect_id',e.id,'vector',e.result::text::jsonb); end if;
  if e.state='running' and e.lease_until>clock_timestamp() or e.next_attempt_at>clock_timestamp() then
    return jsonb_build_object('action','busy','effect_id',e.id);
  end if;
  -- A lease expiry never proves that the external send failed.
  if e.state='running' then e.state:='unknown'; e.reason:='provider_unknown'; end if;
  if e.state='failed' and e.reason<>'transient' then
    return jsonb_build_object('action','held','effect_id',e.id,'state',e.state,'reason',e.reason,'attempts',e.attempts);
  end if;
  if e.attempts>=5 then
    update private.passage_effects set state=e.state,reason='retry_exhausted',lease_until=null,updated_at=now() where id=e.id;
    return jsonb_build_object('action','held','effect_id',e.id,'state',e.state,'reason','retry_exhausted','attempts',e.attempts);
  end if;
  update private.passage_effects set state='running',reason=null,fence=fence+1,
    lease_until=clock_timestamp()+interval '90 seconds',updated_at=now(),
    attempts=attempts+1
    where id=e.id returning * into e;
  return jsonb_build_object('action','send','effect_id',e.id,'fence',e.fence,'attempts',e.attempts);
end $$;

create function app.complete_passage_effect(p_effect uuid,p_fence bigint,p_state text,p_reason text,p_vector jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare e private.passage_effects; i private.passage_effects; body text; v extensions.vector;
begin
  if p_state is null or p_state not in ('succeeded','failed','unknown')
    or (p_state='failed' and (p_reason is null or p_reason not in ('transient','configuration','input_limit')))
    or (p_state='unknown' and (p_reason is null or p_reason not in ('provider_unknown','invalid_response')))
 then raise exception 'invalid_effect_result' using errcode='22023'; end if;
  -- Lock the source before the effect, matching claim/enqueue lock order.
  select * into i from private.passage_effects where id=p_effect;
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
  update private.passage_effects set state=p_state,
    reason=case when p_state='succeeded' then null when p_state='unknown' and attempts>=5 then 'retry_exhausted' else p_reason end,
    result=v,lease_until=null,updated_at=now(),
    next_attempt_at=clock_timestamp()+make_interval(secs=>case when p_state='unknown' or (p_state='failed' and p_reason='transient') then least(900,30*power(2,greatest(0,attempts-1))::integer)
      else 0 end)
    where id=p_effect;
  return true;
end $$;
create or replace function app.record_passage_effect_status(p_record text) returns jsonb
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
    into result from private.passage_effects e
      join app.search_index_state s on s.owner_id=e.owner_id and s.id=e.record_id and s.kind='record'
        and s.input_hash=e.source_hash and s.pipeline=e.pipeline
      where e.owner_id=o and e.record_id=p_record and e.source_version=(select version from app.records where owner_id=o and id=p_record);
  return result;
end $$;
drop table private.search_effect_intents;
revoke all on function app.claim_passage_effect(bigint,text,text,text,integer,integer,integer,text),
  app.complete_passage_effect(uuid,bigint,text,text,jsonb) from public,anon,authenticated,app_user,app_server,app_worker;
grant execute on function app.claim_passage_effect(bigint,text,text,text,integer,integer,integer,text),
  app.complete_passage_effect(uuid,bigint,text,text,jsonb) to app_worker;
