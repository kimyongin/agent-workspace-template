-- Query searches have no template quota. Retain deleted-owner validation before external sends.
drop function app.reserve_search_embedding();
drop table private.search_embedding_budget;

create function app.require_search_owner() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid()) then
    raise exception using errcode='42501',message='request_owner_missing';
  end if;
end;
$$;
revoke all on function app.require_search_owner() from public,anon,authenticated,app_server,app_worker;
grant execute on function app.require_search_owner() to app_user;
