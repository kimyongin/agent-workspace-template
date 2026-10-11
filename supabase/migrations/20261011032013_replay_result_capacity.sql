-- Forward-only: preserve all successful results, tombstones, counters and prior migrations.
-- Modern bounded completion responses duplicate bodies and up to 100 entity contexts.
-- Unbounded legacy histories still fail closed before committing any business effects.
alter table private.request_results drop constraint request_results_result_check;
alter table private.request_results add constraint request_results_result_check
  check (result is null or octet_length(result::text) <= 1048576);

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
