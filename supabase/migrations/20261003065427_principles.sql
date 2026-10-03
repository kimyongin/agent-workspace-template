-- 사용자 원칙. 업무 상태 전환은 core가 담당하며 DB는 형식·소유권만 보장한다.
create table app.principles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  summary text not null check (char_length(summary) between 1 and 300),
  body text not null default '' check (char_length(body) <= 20000),
  applies_when text not null default '' check (char_length(applies_when) <= 300),
  status text not null default 'active' check (status in ('active', 'inactive')),
  replaced_by_id uuid,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz(3) not null default now(),
  updated_at timestamptz(3) not null default now(),
  unique (id, owner_id),
  foreign key (replaced_by_id, owner_id) references app.principles (id, owner_id) on delete set null (replaced_by_id)
);
create index principles_owner_status_updated on app.principles (owner_id, status, updated_at desc, id desc);
alter table app.principles enable row level security;
revoke all on app.principles from public, anon, authenticated;
grant select, insert, update, delete on app.principles to app_user;
create policy principles_owner on app.principles for all to app_user
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
