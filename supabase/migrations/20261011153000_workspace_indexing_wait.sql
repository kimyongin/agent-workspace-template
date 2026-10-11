-- Waiting is an observation, not a confirmed provider or worker failure.
-- The threshold is a check prompt, not a processing SLA. Only current owner/source participates.
create function app.status_indexing_wait(p_pipeline text,p_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  -- An empty owner join can skip status_record_indexing during SQL planning.
  -- Validate the caller independently before evaluating any aggregates.
  perform app.require_search_owner();
  return (
  with preparing as (
    select coalesce(s.updated_at,r.updated_at) as since
    from app.status_record_indexing(p_pipeline,p_at) i
    join app.records r on r.owner_id=auth.uid() and r.id=i.record_id
    left join app.search_index_state s on s.owner_id=r.owner_id and s.kind='record' and s.id=r.id
      and s.pipeline=p_pipeline and s.input_hash=encode(extensions.digest(r.body,'sha256'),'hex')
    where i.state='preparing'
  )
  select jsonb_build_object(
    'long_waiting',count(*) filter(where since<=p_at-interval '15 minutes'),
    'oldest_waiting_since',min(since),'threshold_minutes',15) from preparing);
end;
$$;
revoke all on function app.status_indexing_wait(text,timestamptz) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.status_indexing_wait(text,timestamptz) to app_user;
