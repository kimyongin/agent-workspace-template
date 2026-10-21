-- Pre-title publication boundary: relevant deployed storage from schema_document_storage,
-- workspace_model_definitions and workspace_model_business_anchors. No final title guard.
create schema app; create schema private;
create table app.entity_types (
 owner_id uuid, workspace_id uuid, id uuid not null, schema_version integer not null check(schema_version>0),
 next_property_number integer not null default 4, schema_write_locked boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id),unique(owner_id,id)
);
create table app.entity_schema_versions (
 owner_id uuid,workspace_id uuid,schema jsonb not null,
 type_id uuid generated always as ((schema->>'x-type-id')::uuid) stored not null,
 schema_version integer generated always as ((schema->>'x-version')::integer) stored not null,
 created_at timestamptz not null default now(),
 constraint entity_schema_document_bytes check(jsonb_typeof(schema)='object' and octet_length(schema::text)<=262144),
 unique(workspace_id,type_id,schema_version),unique(owner_id,type_id,schema_version),
 foreign key(workspace_id,type_id) references app.entity_types(workspace_id,id) deferrable initially deferred
);
alter table app.entity_types add foreign key(workspace_id,id,schema_version)
 references app.entity_schema_versions(workspace_id,type_id,schema_version) deferrable initially deferred;
create function app.reject_entity_schema_mutation() returns trigger language plpgsql set search_path='' as $$
 begin raise exception 'published entity schemas are immutable';end $$;
create trigger immutable_entity_schema before update on app.entity_schema_versions for each row execute function app.reject_entity_schema_mutation();
create table app.entities(workspace_id uuid,entity_type_id uuid,id text,schema_version integer,version integer,
 properties jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),
 foreign key(workspace_id,entity_type_id,schema_version) references app.entity_schema_versions(workspace_id,type_id,schema_version));
-- Non-active and active execution envelopes remain raw evidence; cutover reads only workspace/status.
create table app.entity_schema_changes(workspace_id uuid,id uuid,status text,payload jsonb);
create table app.entity_schema_analyses(workspace_id uuid,id uuid,status text,payload jsonb);
create table app.entity_schema_migrations(workspace_id uuid,id uuid,status text,payload jsonb);
create table app.data_model_changes(workspace_id uuid,id uuid,status text,plan jsonb);
create table private.workspace_request_results(executor_id uuid,workspace_id uuid,request_key uuid,
 operation text,fingerprint text,result jsonb,completed_at timestamptz);
create table app.records(workspace_id uuid,id uuid,body text,entity_context jsonb,change_metadata jsonb,created_at timestamptz default now());
create table app.tasks(workspace_id uuid,id uuid,associations jsonb,updated_at timestamptz default now());
create table app.entity_connections(workspace_id uuid,id uuid,payload jsonb);
create table private.entity_search_jobs(workspace_id uuid,id uuid,payload jsonb);
-- Same anchor rejection used in deployed workspace_model_definitions. Installed after legacy seed.
create function private.guard_workspace_model_anchor() returns trigger language plpgsql set search_path='' as $$
 begin
 if tg_op='INSERT' then
  if new.workspace_id is null or new.workspace_id is distinct from nullif(current_setting('request.workspace_id',true),'')::uuid or new.owner_id is not null then
   raise exception 'workspace_model_anchor_required' using errcode='23514';end if;
 elsif old.workspace_id is not null and new.workspace_id is distinct from old.workspace_id then
  raise exception 'workspace_model_anchor_immutable' using errcode='23514';end if;
 return new;end $$;
