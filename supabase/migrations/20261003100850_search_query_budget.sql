-- HTTP와 MCP가 같은 소유자별 외부 질의 호출 예산을 공유한다. 키워드 검색은 호출하지 않는다.
create table private.search_embedding_budget (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  used integer not null check(used between 0 and 20)
);
alter table private.search_embedding_budget enable row level security;
revoke all on private.search_embedding_budget from public,anon,authenticated,app_user,app_server,app_worker;
create function app.reserve_search_embedding() returns boolean
language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_window timestamptz:=date_trunc('minute',clock_timestamp()); v_used integer;
begin
  if v_owner is null then raise exception '사용자 문맥이 필요합니다' using errcode='42501'; end if;
  insert into private.search_embedding_budget(owner_id,window_start,used) values(v_owner,v_window,1)
    on conflict(owner_id) do update set
      used=case when private.search_embedding_budget.window_start<v_window then 1 else private.search_embedding_budget.used+1 end,
      window_start=v_window
    where private.search_embedding_budget.window_start<v_window or private.search_embedding_budget.used<20
    returning used into v_used;
  return v_used is not null;
end $$;
revoke all on function app.reserve_search_embedding() from public,anon,authenticated;
grant execute on function app.reserve_search_embedding() to app_user;
