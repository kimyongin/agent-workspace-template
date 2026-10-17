-- Typed definitions retain ordered roles; legacy entity_pairs are untouched.
create table app.entity_relation_definitions (
 owner_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null default gen_random_uuid(), version integer not null default 1 check(version>0),
 archived boolean not null default false,
 left_type_id uuid not null, left_label text not null check(length(btrim(left_label)) between 1 and 100), left_cardinality text not null check(left_cardinality in ('one','many')),
 right_type_id uuid not null, right_label text not null check(length(btrim(right_label)) between 1 and 100), right_cardinality text not null check(right_cardinality in ('one','many')),
 primary key(owner_id,id),
 foreign key(owner_id,left_type_id) references app.entity_types(owner_id,id),
 foreign key(owner_id,right_type_id) references app.entity_types(owner_id,id)
);
alter table app.entity_relation_definitions enable row level security;
create policy entity_relation_definitions_owner on app.entity_relation_definitions for all to app_user using(owner_id=auth.uid()) with check(owner_id=auth.uid());
grant select,insert,update,delete on app.entity_relation_definitions to app_user;
create index entity_relation_definitions_right on app.entity_relation_definitions(owner_id,right_type_id,id);
create index entity_relation_definitions_left on app.entity_relation_definitions(owner_id,left_type_id,id);
create table app.entity_relation_links (
 owner_id uuid not null references auth.users(id) on delete cascade,
 definition_id uuid not null, left_entity_id text not null, right_entity_id text not null,
 created_at timestamptz not null default now(),
 primary key(owner_id,definition_id,left_entity_id,right_entity_id),
 check(left_entity_id<>right_entity_id),
 foreign key(owner_id,definition_id) references app.entity_relation_definitions(owner_id,id) deferrable initially deferred,
 foreign key(owner_id,left_entity_id) references app.entities(owner_id,id) on delete cascade,
 foreign key(owner_id,right_entity_id) references app.entities(owner_id,id) on delete cascade
);
create index entity_relation_links_right on app.entity_relation_links(owner_id,definition_id,right_entity_id,left_entity_id);
alter table app.entity_relation_links enable row level security;
create policy entity_relation_links_owner on app.entity_relation_links for all to app_user using(owner_id=auth.uid()) with check(owner_id=auth.uid());
grant select,insert,delete on app.entity_relation_links to app_user;
-- Definitions protect existing role and cardinality facts even for direct app_user DML.
create function app.guard_entity_relation_definition() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text||':entity-relations',0));
 if new.owner_id is distinct from old.owner_id or new.id is distinct from old.id or new.version<>old.version+1 then
  raise exception 'immutable_relation_identity_or_version' using errcode='23514';
 end if;
 if exists(select 1 from app.entity_relation_links l join app.entities e on e.owner_id=l.owner_id and e.id=l.left_entity_id join app.entities r on r.owner_id=l.owner_id and r.id=l.right_entity_id where l.owner_id=new.owner_id and l.definition_id=new.id and (e.entity_type_id<>new.left_type_id or r.entity_type_id<>new.right_type_id)) then
  raise exception 'relation_type_in_use' using errcode='23514';
 end if;
 if new.left_cardinality='one' and exists(select 1 from app.entity_relation_links where owner_id=new.owner_id and definition_id=new.id group by left_entity_id having count(*)>1) or new.right_cardinality='one' and exists(select 1 from app.entity_relation_links where owner_id=new.owner_id and definition_id=new.id group by right_entity_id having count(*)>1) then
  raise exception 'relation_cardinality_in_use' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function app.guard_entity_relation_definition() from public;
create trigger guard_entity_relation_definition before update on app.entity_relation_definitions for each row execute function app.guard_entity_relation_definition();
