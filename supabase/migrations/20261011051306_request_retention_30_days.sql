-- Retain complete request receipts for 30 days without lifetime usage limits.
create or replace function app.begin_request(p_key uuid, p_operation text, p_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_row private.request_results%rowtype;
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
  return jsonb_build_object('state','new');
exception when lock_not_available then
  return jsonb_build_object('state','request_in_progress');
end;
$$;
create or replace function app.finish_request(p_key uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid()) then
    raise exception using errcode='42501',message='request_owner_missing';
  end if;
  if p_result is null or octet_length(p_result::text)>1048576 then
    raise exception using errcode='22023',message='request_result_too_large';
  end if;
  update private.request_results set result=p_result, completed_at=clock_timestamp()
    where owner_id=auth.uid() and request_key=p_key and completed_at is null;
  if not found then raise exception using errcode='22023',message='request_result_missing'; end if;
end;
$$;
revoke all on function app.finish_request(uuid,jsonb) from public, anon, authenticated, app_server, app_worker;
grant execute on function app.finish_request(uuid,jsonb) to app_user;

drop table private.request_capacity;
drop index private.request_results_cleanup;
create index request_results_cleanup on private.request_results(completed_at)
  where completed_at is not null;
create or replace function private.expire_request_results()
returns void language sql security definer set search_path = '' as $$
  delete from private.request_results
  where completed_at is not null and completed_at <= clock_timestamp() - interval '30 days';
$$;
revoke all on function private.expire_request_results() from public,anon,authenticated,app_user,app_server,app_worker;
-- Existing expire-request-results Cron continues to call the same private function.
