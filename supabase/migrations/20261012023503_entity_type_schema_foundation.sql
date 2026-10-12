-- Metadata version and immutable schema revision have independent lifetimes.
create table app.entity_types (
 owner_id uuid not null references auth.users(id) on delete cascade, id uuid not null default gen_random_uuid(),
 label text not null check(length(label) between 1 and 80), icon_id text not null default 'box',
 archived boolean not null default false, version integer not null default 1 check(version>0),
 schema_version integer not null default 1 check(schema_version>0),
 next_property_number integer not null default 2 check(next_property_number>1),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(owner_id,id), unique(id)
);
create table app.entity_schema_versions (
 owner_id uuid not null, type_id uuid not null, schema_version integer not null check(schema_version>0),
 schema jsonb not null check(jsonb_typeof(schema)='object' and octet_length(schema::text)<=65536),
 display jsonb not null check(jsonb_typeof(display)='object' and octet_length(display::text)<=65536),
 created_at timestamptz not null default now(), primary key(owner_id,type_id,schema_version),
 foreign key(owner_id,type_id) references app.entity_types(owner_id,id) on delete cascade
);
alter table app.entity_types add constraint entity_type_current_schema foreign key(owner_id,id,schema_version)
 references app.entity_schema_versions(owner_id,type_id,schema_version) deferrable initially deferred;
alter table app.entity_types enable row level security;
alter table app.entity_schema_versions enable row level security;
create policy entity_type_owner on app.entity_types for all to app_user using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy entity_schema_owner on app.entity_schema_versions for all to app_user using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
grant select,insert,update on app.entity_types to app_user;
grant select,insert on app.entity_schema_versions to app_user;
-- Published versions cannot be updated/deleted by the application role. Owner cleanup cascades.
create function app.reject_entity_schema_mutation() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'published entity schemas are immutable'; end $$;
create trigger immutable_entity_schema before update on app.entity_schema_versions for each row execute function app.reject_entity_schema_mutation();
revoke all on function app.reject_entity_schema_mutation() from public;
