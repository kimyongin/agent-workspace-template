create table app.tags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(name=btrim(name) and char_length(name) between 1 and 30),
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,owner_id)
);
create unique index tags_owner_name on app.tags(owner_id,lower(name));
alter table app.tags enable row level security;
create policy owner_only on app.tags to app_user
  using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on app.tags from public,anon,authenticated;
grant select,insert,update,delete on app.tags to app_user;
