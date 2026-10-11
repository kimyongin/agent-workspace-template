-- Business writes and their safe results commit together. Tombstones never expire.
create table private.request_results (
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_key uuid not null,
  operation text not null,
  revision integer not null default 1 check (revision = 1),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz,
  result jsonb,
  primary key(owner_id, request_key),
  check (result is null or octet_length(result::text) <= 131072)
);
create index request_results_cleanup on private.request_results(completed_at) where result is not null;
create table private.request_capacity (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  used integer not null default 0 check (used between 0 and 100000)
);
alter table private.request_results enable row level security;
alter table private.request_capacity enable row level security;
revoke all on private.request_results, private.request_capacity from public, anon, authenticated, app_user, app_server, app_worker;

-- Private table access deliberately passes only through these narrow functions.
-- Owner is read from trusted transaction claims, never from a function argument.
create function app.begin_request(p_key uuid, p_operation text, p_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_row private.request_results%rowtype; v_used integer;
begin
  if v_owner is null then raise exception using errcode='42501', message='request_owner_missing'; end if;
  -- Also prevents a concurrent account deletion from racing the replay/commit.
  perform 1 from auth.users where id=v_owner for key share;
  if not found then raise exception using errcode='42501', message='request_owner_missing'; end if;
  perform pg_catalog.set_config('lock_timeout', '2s', true);
  -- Unique owner/key insertion waits for a competing transaction, not its uncommitted result.
  insert into private.request_results(owner_id,request_key,operation,fingerprint)
    values(v_owner,p_key,p_operation,p_fingerprint) on conflict do nothing;
  if not found then
    select * into v_row from private.request_results where owner_id=v_owner and request_key=p_key;
    if v_row.operation <> p_operation or v_row.fingerprint <> p_fingerprint then
      return jsonb_build_object('state','idempotency_key_reused');
    end if;
    if v_row.completed_at is null then return jsonb_build_object('state','request_in_progress'); end if;
    if v_row.result is null or v_row.completed_at + interval '30 days' <= clock_timestamp() then
      return jsonb_build_object('state','result_expired');
    end if;
    return jsonb_build_object('state','replay','result',v_row.result,'completed_at',v_row.completed_at);
  end if;
  insert into private.request_capacity(owner_id) values(v_owner) on conflict do nothing;
  update private.request_capacity set used=used+1 where owner_id=v_owner and used<100000 returning used into v_used;
  if not found then return jsonb_build_object('state','idempotency_capacity_exceeded'); end if;
  return jsonb_build_object('state','new');
exception when lock_not_available then
  return jsonb_build_object('state','request_in_progress');
end;
$$;
create function app.finish_request(p_key uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid()) then
    raise exception using errcode='42501',message='request_owner_missing';
  end if;
  if p_result is null or octet_length(p_result::text)>131072 then
    raise exception using errcode='22023',message='request_result_too_large';
  end if;
  update private.request_results set result=p_result, completed_at=clock_timestamp()
    where owner_id=auth.uid() and request_key=p_key and completed_at is null;
  if not found then raise exception using errcode='22023',message='request_result_missing'; end if;
end;
$$;
revoke all on function app.begin_request(uuid,text,text), app.finish_request(uuid,jsonb) from public, anon, authenticated, app_server, app_worker;
grant execute on function app.begin_request(uuid,text,text), app.finish_request(uuid,jsonb) to app_user;

-- Remove duplicate response bodies after 30 days; retain key/fingerprint tombstones.
create function private.expire_request_results() returns void language sql security definer set search_path = '' as $$
  update private.request_results set result=null
  where result is not null and completed_at + interval '30 days' <= clock_timestamp();
$$;
revoke all on function private.expire_request_results() from public,anon,authenticated,app_user,app_server,app_worker;
create extension if not exists pg_cron;
select cron.schedule('expire-request-results', '17 3 * * *', 'select private.expire_request_results()');
