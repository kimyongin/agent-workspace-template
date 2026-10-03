create table app.record_tags (
  owner_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  tag_id uuid not null,
  primary key(record_id,tag_id),
  foreign key(record_id,owner_id) references app.records(id,owner_id) on delete cascade,
  foreign key(tag_id,owner_id) references app.tags(id,owner_id) on delete cascade
);
create table app.principle_tags (
  owner_id uuid not null references auth.users(id) on delete cascade,
  principle_id uuid not null,
  tag_id uuid not null,
  primary key(principle_id,tag_id),
  foreign key(principle_id,owner_id) references app.principles(id,owner_id) on delete cascade,
  foreign key(tag_id,owner_id) references app.tags(id,owner_id) on delete cascade
);
create index record_tags_tag_owner on app.record_tags(tag_id,owner_id);
create index principle_tags_tag_owner on app.principle_tags(tag_id,owner_id);
alter table app.record_tags enable row level security;
alter table app.principle_tags enable row level security;
create policy owner_only on app.record_tags to app_user
  using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy owner_only on app.principle_tags to app_user
  using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on app.record_tags,app.principle_tags from public,anon,authenticated;
grant select,insert,update,delete on app.record_tags,app.principle_tags to app_user;
