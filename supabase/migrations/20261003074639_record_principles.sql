create table app.record_principles (
  owner_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  principle_id uuid not null,
  primary key(record_id, principle_id),
  foreign key(record_id, owner_id) references app.records(id, owner_id) on delete cascade,
  foreign key(principle_id, owner_id) references app.principles(id, owner_id) on delete cascade
);
create index record_principles_principle_owner on app.record_principles(principle_id, owner_id);
alter table app.record_principles enable row level security;
create policy owner_only on app.record_principles to app_user
  using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on app.record_principles from public, anon, authenticated;
grant select,insert,update,delete on app.record_principles to app_user;
