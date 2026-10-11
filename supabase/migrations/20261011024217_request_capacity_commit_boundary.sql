-- Keep independent same-owner business locks independent until final lifetime quota accounting.
create or replace function app.begin_request(p_key uuid, p_operation text, p_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_row private.request_results%rowtype;;
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
  -- Fast fail for an already full owner, without holding the owner counter through business row locks.
  if exists(select 1 from private.request_capacity where owner_id=v_owner and used>=100000) then
    return jsonb_build_object('state','idempotency_capacity_exceeded');
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
  if p_result is null or octet_length(p_result::text)>131072 then
    raise exception using errcode='22023',message='request_result_too_large';
  end if;
  -- Serialize only at final commit accounting. A capacity failure rolls back the whole business transaction.
  insert into private.request_capacity(owner_id) values(auth.uid()) on conflict do nothing;
  update private.request_capacity set used=used+1 where owner_id=auth.uid() and used<100000;
  if not found then raise exception using errcode='P0001',message='request_capacity_exceeded'; end if;
  update private.request_results set result=p_result, completed_at=clock_timestamp()
    where owner_id=auth.uid() and request_key=p_key and completed_at is null;
  if not found then raise exception using errcode='22023',message='request_result_missing'; end if;
end;
$$;
