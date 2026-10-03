create table app.task_tags (
  owner_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null,
  tag_id uuid not null,
  primary key(task_id,tag_id),
  foreign key(task_id,owner_id) references app.tasks(id,owner_id) on delete cascade,
  foreign key(tag_id,owner_id) references app.tags(id,owner_id) on delete cascade
);
create index task_tags_tag_owner on app.task_tags(tag_id,owner_id);
alter table app.task_tags enable row level security;
create policy owner_only on app.task_tags to app_user
  using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on app.task_tags from public,anon,authenticated;
grant select,insert,update,delete on app.task_tags to app_user;
