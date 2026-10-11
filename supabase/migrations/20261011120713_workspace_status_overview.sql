-- Read current record classifications without granting access to private effects.
-- Only the authenticated owner and current source/hash/pipeline/revision participate.
create function app.status_record_indexing(p_pipeline text,p_at timestamptz)
returns table(record_id text,created_at timestamptz,state text,reason text)
language plpgsql stable security definer set search_path='' as $$
declare o uuid:=auth.uid();
begin
  if o is null or not exists(select 1 from auth.users where id=o) then
    raise exception 'request_owner_missing' using errcode='42501'; end if;
  return query
    select r.id,r.created_at,
      case when s.state='excluded' then 'excluded'
        when s.state='indexed' and exists(select 1 from app.search_chunks c
          where c.owner_id=o and c.record_id=r.id and c.generation=s.generation) then 'indexed'
        when s.state='failed' or s.reason='retry_exhausted' or e.reason is not null then 'attention'
        else 'preparing' end,
      case when s.state='excluded' or (s.state='indexed' and exists(select 1 from app.search_chunks c
          where c.owner_id=o and c.record_id=r.id and c.generation=s.generation)) then null
        when e.reason is not null then e.reason
        when s.state='failed' or s.reason='retry_exhausted' then coalesce(s.reason,'retry_exhausted')
        else null end
    from app.records r
    left join app.search_index_state s on s.owner_id=o and s.kind='record' and s.id=r.id
      and s.pipeline=p_pipeline and s.input_hash=encode(extensions.digest(r.body,'sha256'),'hex')
    left join lateral (
      select case
        when pe.state='unknown' or (pe.state='running' and (pe.lease_until is null or pe.lease_until<=p_at))
          then case when pe.attempts>=5 then 'retry_exhausted' else coalesce(pe.reason,'provider_unknown') end
        when pe.state='failed' and (pe.reason<>'transient' or pe.attempts>=5)
          and not (pe.reason='input_limit' and pe.end_offset-pe.start_offset>1)
          then case when pe.attempts>=5 then 'retry_exhausted' else pe.reason end
        when pe.state='pending' and pe.attempts>=5 then 'retry_exhausted'
        else null end as reason
      from private.passage_effects pe
      where pe.owner_id=o and pe.record_id=r.id and pe.source_version=r.version
        and pe.source_hash=s.input_hash and pe.pipeline=s.pipeline
      order by case
        when pe.state='unknown' or (pe.state='running' and (pe.lease_until is null or pe.lease_until<=p_at)) then 0
        when pe.state='failed' and (pe.reason<>'transient' or pe.attempts>=5)
          and not (pe.reason='input_limit' and pe.end_offset-pe.start_offset>1) then 1
        when pe.state='pending' and pe.attempts>=5 then 2 else 3 end,pe.start_offset,pe.end_offset
      limit 1
    ) e on true
    where r.owner_id=o;
end $$;
revoke all on function app.status_record_indexing(text,timestamptz) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.status_record_indexing(text,timestamptz) to app_user;

-- All overview aggregates share one statement snapshot under the normal owner RLS.
create function app.status_overview(p_pipeline text,p_timezone text,p_at timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
  with dates as (
    select (p_at at time zone p_timezone)::date-29 as first_day,
      (p_at at time zone p_timezone)::date as last_day
  ), indexing as materialized (select * from app.status_record_indexing(p_pipeline,p_at)),
  entity_counts as (select count(*)::int as total,count(*) filter(where deleted_at is null)::int as active,
    count(*) filter(where deleted_at is not null)::int as deleted from app.entities),
  task_counts as (select count(*)::int as total,count(*) filter(where status='open')::int as open,
    count(*) filter(where status='done')::int as done,count(*) filter(where status='active')::int as active,
    count(*) filter(where status='stopped')::int as stopped from app.tasks),
  record_counts as (select count(*)::int as total,count(*) filter(where record_kind='user')::int as "user",
    count(*) filter(where record_kind='result')::int as result,count(*) filter(where record_kind='change')::int as change from app.records),
  index_counts as (select count(*)::int as total,count(*) filter(where state='indexed')::int as indexed,
    count(*) filter(where state='preparing')::int as preparing,count(*) filter(where state='attention')::int as attention,
    count(*) filter(where state='excluded')::int as excluded from indexing),
  events as (
    select (created_at at time zone p_timezone)::date as day,'entities_created' as kind from app.entities
    union all select (created_at at time zone p_timezone)::date,'tasks_created' from app.tasks
    union all select (completed_at at time zone p_timezone)::date,'once_completed' from app.tasks where kind='once' and completed_at is not null
    union all select (created_at at time zone p_timezone)::date,'records_created' from app.records
  ), activity_days as (
    select day,count(*) filter(where kind='entities_created')::int as entities_created,
      count(*) filter(where kind='tasks_created')::int as tasks_created,
      count(*) filter(where kind='once_completed')::int as once_completed,
      count(*) filter(where kind='records_created')::int as records_created
    from events,dates where day between first_day and last_day group by day
  ), index_days as (
    select (created_at at time zone p_timezone)::date as day,
      count(*) filter(where state='indexed')::int as indexed,count(*) filter(where state='preparing')::int as preparing,
      count(*) filter(where state='attention')::int as attention,count(*) filter(where state='excluded')::int as excluded
    from indexing,dates where (created_at at time zone p_timezone)::date between first_day and last_day group by day
  ), days as (
    select first_day+n as day from dates,generate_series(0,29) n
  ), daily as (
    select to_char(d.day,'YYYY-MM-DD') as date,coalesce(a.entities_created,0) as entities_created,
      coalesce(a.tasks_created,0) as tasks_created,coalesce(a.once_completed,0) as once_completed,
      coalesce(a.records_created,0) as records_created,jsonb_build_object(
        'indexed',coalesce(i.indexed,0),'preparing',coalesce(i.preparing,0),
        'attention',coalesce(i.attention,0),'excluded',coalesce(i.excluded,0)) as indexing
    from days d left join activity_days a on a.day=d.day left join index_days i on i.day=d.day
  )
  select jsonb_build_object('period',jsonb_build_object('from',to_char(first_day,'YYYY-MM-DD'),
    'to',to_char(last_day,'YYYY-MM-DD'),'days',30),
    'entities',(select to_jsonb(e) from entity_counts e),'tasks',(select to_jsonb(t) from task_counts t),
    'records',(select to_jsonb(r) from record_counts r),'indexing',(select to_jsonb(i) from index_counts i),
    'daily',(select jsonb_agg(to_jsonb(d) order by d.date) from daily d)) from dates;
$$;
revoke all on function app.status_overview(text,text,timestamptz) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.status_overview(text,text,timestamptz) to app_user;
