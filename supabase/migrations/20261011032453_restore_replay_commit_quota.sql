-- Restore T3 commit-time quota accounting while retaining the applied 1 MiB result limit.
create or replace function app.finish_request(p_key uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid()) then
    raise exception using errcode='42501',message='request_owner_missing';
  end if;
  if p_result is null or octet_length(p_result::text)>1048576 then
    raise exception using errcode='22023',message='request_result_too_large';
  end if;
  -- Serialize quota only at final commit, after the business row locks and size check.
  -- A missing slot aborts the complete transaction, including all effects and reservations.
  insert into private.request_capacity(owner_id) values(auth.uid()) on conflict do nothing;
  update private.request_capacity set used=used+1 where owner_id=auth.uid() and used<100000;
  if not found then raise exception using errcode='P0001',message='request_capacity_exceeded'; end if;
  update private.request_results set result=p_result, completed_at=clock_timestamp()
    where owner_id=auth.uid() and request_key=p_key and completed_at is null;
  if not found then raise exception using errcode='22023',message='request_result_missing'; end if;
end;
$$;
revoke all on function app.finish_request(uuid,jsonb) from public, anon, authenticated, app_server, app_worker;
grant execute on function app.finish_request(uuid,jsonb) to app_user;
