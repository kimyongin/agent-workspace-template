-- Single example domain with explicit properties; entities are not search sources.
create table app.entities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  prop1 text not null check(char_length(prop1) between 1 and 100),
  prop2 integer check(prop2 between 0 and 1000000),
  prop3 date check(prop3 between date '0001-01-01' and date '9999-12-31'),
  prop4 text not null default 'a' check(prop4 in ('a','b','c')),
  version integer not null default 1 check(version>=1),
  created_at timestamptz(3) not null default now(),
  updated_at timestamptz(3) not null default now(),
  unique(id,owner_id)
);
alter table app.entities enable row level security;
revoke all on app.entities from public,anon,authenticated;
grant select,insert,update,delete on app.entities to app_user;
create policy entities_owner on app.entities for all to app_user
  using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create index entities_owner_updated on app.entities(owner_id,updated_at desc,id desc);
create index entities_owner_prop1 on app.entities(owner_id,prop1,id);
create index entities_owner_prop2 on app.entities(owner_id,(coalesce(prop2,-1)),id);
create index entities_owner_prop3 on app.entities(owner_id,(coalesce(prop3,date '0001-01-01 BC')),id);
alter table app.tasks add column entity_id uuid,
  add foreign key(entity_id,owner_id) references app.entities(id,owner_id) on delete set null(entity_id);
alter table app.records add column entity_id uuid,
  add foreign key(entity_id,owner_id) references app.entities(id,owner_id) on delete set null(entity_id);
alter table app.principles add column entity_id uuid,
  add foreign key(entity_id,owner_id) references app.entities(id,owner_id) on delete set null(entity_id);
create index tasks_entity on app.tasks(owner_id,entity_id,updated_at desc,id desc) where entity_id is not null;
create index records_entity on app.records(owner_id,entity_id,updated_at desc,id desc) where entity_id is not null;
create index principles_entity on app.principles(owner_id,entity_id,updated_at desc,id desc) where entity_id is not null;
