-- T02-2: 할 일·활동 기록·요청 결과와 색인 큐.
-- 권한 구성은 docs/architecture/hexagonal-review.md "권한과 직접 접근"을 따른다.
-- 형식 한도(CHECK)는 contracts(supabase/functions/_shared/contracts)와 같게 두고, 업무 규칙(완료 조건·회차·상태 전환)은 core에만 둔다.
-- 시각은 밀리초 정밀도(timestamptz(3))로 저장해 API의 ISO 문자열과 목록 커서가 정확히 일치하게 한다.
-- 업무 테이블은 PostgREST에 노출하지 않는 app 스키마에 둔다(Supabase의 public 기본 권한을 받지 않는다).

create extension if not exists pgmq;

create schema app;

-- 사용자 역할: 로그인하지 않고, 서버가 트랜잭션 안에서만 전환한다. RLS 정책의 대상이다.
create role app_user nologin noinherit;
-- 서버 접속 역할: 업무 테이블 권한 없음. app_user로 전환과 색인 큐 전송만 한다.
-- 비밀번호는 migration에 두지 않는다. 로컬은 scripts/local-setup.mjs, 호스팅은 배포 절차에서 설정한다.
create role app_server login noinherit;
grant app_user to app_server;

grant usage on schema app to app_user;
grant usage on schema auth to app_user;
grant execute on function auth.uid() to app_user;

create table app.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('once', 'recurring')),
  title text not null check (char_length(title) between 1 and 100),
  summary text not null check (char_length(summary) between 1 and 300),
  body text not null default '' check (char_length(body) <= 20000),
  due_on date,
  recurrence jsonb check (recurrence is null or jsonb_typeof(recurrence) = 'object'),
  timezone text check (timezone is null or char_length(timezone) between 1 and 64),
  status text not null check (status in ('open', 'done', 'active', 'stopped')),
  completed_at timestamptz(3),
  result_record_id uuid,
  pauses jsonb not null default '[]' check (jsonb_typeof(pauses) = 'array'),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz(3) not null default now(),
  updated_at timestamptz(3) not null default now(),
  unique (id, owner_id),
  -- 종류별 필드의 모양. 상태 전환 규칙이 아니라 행이 가질 수 있는 형태만 제한한다.
  constraint tasks_kind_shape check (
    (kind = 'once' and recurrence is null and timezone is null and status in ('open', 'done') and pauses = '[]')
    or (kind = 'recurring' and recurrence is not null and timezone is not null and due_on is null
        and status in ('active', 'stopped') and completed_at is null and result_record_id is null)
  )
);

create table app.records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  summary text not null check (char_length(summary) between 1 and 300),
  body text not null default '' check (char_length(body) <= 20000),
  occurred_at timestamptz(3) not null default now(),
  task_id uuid,
  occurrence_on date,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz(3) not null default now(),
  updated_at timestamptz(3) not null default now(),
  unique (id, owner_id),
  -- 같은 소유자의 할 일만 참조한다. 할 일 삭제는 앱이 task_id·occurrence_on을 먼저 비운다.
  foreign key (task_id, owner_id) references app.tasks (id, owner_id) on delete set null (task_id),
  constraint records_occurrence_needs_task check (occurrence_on is null or task_id is not null)
);

alter table app.tasks
  add foreign key (result_record_id, owner_id) references app.records (id, owner_id)
  on delete set null (result_record_id);

create index tasks_owner_updated on app.tasks (owner_id, updated_at desc, id desc);
create index tasks_owner_due on app.tasks (owner_id, due_on) where due_on is not null;
create index records_owner_occurred on app.records (owner_id, occurred_at desc, id desc);
create index records_task_occurrence on app.records (task_id, occurrence_on) where task_id is not null;

-- 같은 요청의 재전송에 첫 결과를 돌려주기 위한 요청 결과(보관 7일, 정리는 T02-6).
create table app.request_results (
  owner_id uuid not null references auth.users (id) on delete cascade,
  operation text not null check (char_length(operation) between 1 and 100),
  request_id uuid not null,
  request_hash text not null check (char_length(request_hash) = 64),
  response jsonb not null,
  created_at timestamptz(3) not null default now(),
  primary key (owner_id, operation, request_id)
);

alter table app.tasks enable row level security;
alter table app.records enable row level security;
alter table app.request_results enable row level security;

grant select, insert, update, delete on app.tasks, app.records to app_user;
grant select, insert, delete on app.request_results to app_user;

create policy tasks_owner on app.tasks for all to app_user
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy records_owner on app.records for all to app_user
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy request_results_owner on app.request_results for all to app_user
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- 색인 큐. 메시지 소비·삭제는 T02-3의 worker 역할이 맡는다.
select pgmq.create('search_index');

grant usage on schema pgmq to app_server;
grant execute on function pgmq.send(text, jsonb) to app_server;
grant execute on function pgmq.send(text, jsonb, jsonb, timestamp with time zone) to app_server;
grant execute on function pgmq.format_table_name(text, text) to app_server;
grant insert on pgmq.q_search_index to app_server;
-- send의 INSERT ... RETURNING msg_id에 필요한 컬럼만. 메시지 내용은 읽지 못한다.
grant select (msg_id) on pgmq.q_search_index to app_server;
