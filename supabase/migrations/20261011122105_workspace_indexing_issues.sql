-- Private effects remain worker-owned. This bounded owner projection exposes counters only.
create function app.status_indexing_issues(p_pipeline text,p_at timestamptz,p_after_at timestamptz default null,p_after_id text default null)
returns table(issue jsonb) language plpgsql stable security definer set search_path='' as $$
declare o uuid:=auth.uid();
begin
  if o is null or not exists(select 1 from auth.users where id=o) then
    raise exception 'request_owner_missing' using errcode='42501'; end if;
  return query
    with problems as materialized (
      select i.record_id,i.created_at,i.reason,r.body,r.version
      from app.status_record_indexing(p_pipeline,p_at) i
      join app.records r on r.owner_id=o and r.id=i.record_id
      where i.state='attention' and (p_after_at is null or (i.created_at,i.record_id)<(p_after_at,p_after_id))
      order by i.created_at desc,i.record_id desc limit 6
    )
    select jsonb_build_object('id',p.record_id,'created_at',p.created_at,'title',left(p.body,100),
      'reason',coalesce(p.reason,'provider_unknown'),'attempts',coalesce(e.attempts,0),
      'chunks',jsonb_build_object('total',e.total,'succeeded',e.succeeded,'preparing',e.preparing,'unknown',e.unknown,'failed',e.failed))
    from problems p
    cross join lateral (
      select coalesce(sum(pe.attempts),0)::int as attempts,count(*)::int as total,
        count(*) filter(where pe.state='succeeded')::int as succeeded,
        count(*) filter(where (pe.state='pending' and pe.attempts<5) or (pe.state='running' and pe.lease_until>p_at) or (pe.state='failed' and pe.reason='transient' and pe.attempts<5))::int as preparing,
        count(*) filter(where pe.state='unknown' or (pe.state='pending' and pe.attempts>=5) or (pe.state='running' and (pe.lease_until is null or pe.lease_until<=p_at)))::int as unknown,
        count(*) filter(where (pe.state='failed' and (pe.reason<>'transient' or pe.attempts>=5)))::int as failed
      from private.passage_effects pe
      where pe.owner_id=o and pe.record_id=p.record_id and pe.source_version=p.version
        and pe.source_hash=encode(extensions.digest(p.body,'sha256'),'hex') and pe.pipeline=p_pipeline
        and not (pe.state='failed' and pe.reason='input_limit' and pe.end_offset-pe.start_offset>1)
    ) e order by p.created_at desc,p.record_id desc;
end $$;
revoke all on function app.status_indexing_issues(text,timestamptz,timestamptz,text) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.status_indexing_issues(text,timestamptz,timestamptz,text) to app_user;
-- Replaced public per-record diagnostics have no internal callers.
drop function app.record_passage_effect_status(text);
