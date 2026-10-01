-- T02-1 실험 1: 직접 Postgres 트랜잭션의 Actor 문맥·RLS·큐 원자성.
-- 격리 실험 전용이며 앱 migration이 아니다.

create extension if not exists pgmq;
select pgmq.create('exp_index');

create table public.items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  title text not null check (char_length(title) between 1 and 100)
);
alter table public.items enable row level security;

-- 서버만 쓰는 비로그인 역할. PostgREST에 노출되지 않는다.
create role app_user nologin noinherit;
grant usage on schema public to app_user;
grant select, insert, update, delete on public.items to app_user;
create policy items_owner on public.items for all to app_user
  using (owner_id = (auth.jwt() ->> 'sub')::uuid)
  with check (owner_id = (auth.jwt() ->> 'sub')::uuid);
grant usage on schema auth to app_user;
grant execute on function auth.jwt() to app_user;

-- 서버 접속 역할: 업무 테이블 권한 없음, app_user로 전환만 가능, 큐 전송 가능.
create role app_server login password 'local-experiment-only' noinherit;
grant app_user to app_server;
grant usage on schema pgmq to app_server;
grant select, insert, update, delete on all tables in schema pgmq to app_server;
grant usage, select on all sequences in schema pgmq to app_server;
grant execute on all functions in schema pgmq to app_server;

-- 일반 사용자(PostgREST의 authenticated·anon)의 직접 쓰기 차단.
revoke all on public.items from anon, authenticated;
