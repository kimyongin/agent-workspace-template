-- Cost cap does not turn uncertainty into failure.
create or replace function app.complete_passage_effect(p_effect uuid,p_fence bigint,p_state text,p_reason text,p_vector jsonb,p_job text)
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
    reason=case when p_state='accepted' then 'provider_unknown' when p_state='succeeded' then null when p_state='unknown' and attempts>=5 then 'retry_exhausted' else p_reason end,
    provider_job_id=coalesce(p_job,provider_job_id),result=v,lease_until=null,updated_at=now(),
    next_attempt_at=clock_timestamp()+make_interval(secs=>case when p_state='accepted' then 1
      when p_state='unknown' or (p_state='failed' and p_reason='transient') then least(900,30*power(2,greatest(0,attempts-1))::integer)
      else 0 end)
    where id=p_effect;
  return true;
end $$;

