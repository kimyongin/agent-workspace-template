-- Minimal pre-transition database at the public migration boundary.
-- Table definitions and checks are the deployed pre-transition PostgreSQL definitions.
create schema auth; create schema app; create schema private;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$ select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid $$;
grant usage on schema app,auth to app_user;
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

alter table app.entity_schema_versions add constraint entity_schema_definition_bytes check(octet_length(schema::text)+octet_length(display::text)<=65536);
alter table app.entity_types add column schema_write_locked boolean not null default false;
CREATE TABLE app.entity_schema_changes (
    owner_id uuid NOT NULL,
    type_id uuid NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_type_version integer NOT NULL,
    source_schema_version integer NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    kind text NOT NULL,
    edits jsonb NOT NULL,
    reservations jsonb NOT NULL,
    target jsonb NOT NULL,
    diff jsonb NOT NULL,
    fingerprint text NOT NULL,
    analysis_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_template_fingerprint text,
    migration jsonb DEFAULT '{"rules": [], "overrides": []}'::jsonb NOT NULL,
    recovery_source_job_id uuid,
    recovery_expires_at timestamp with time zone,
    recovery_keys jsonb,
    CONSTRAINT entity_schema_changes_kind_check CHECK ((kind = ANY (ARRAY['compatible'::text, 'migration_required'::text]))),
    CONSTRAINT entity_schema_changes_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'analyzing'::text, 'ready'::text, 'stale'::text, 'invalid'::text, 'applied'::text, 'cancelled'::text]))),
    CONSTRAINT entity_schema_changes_target_check CHECK (((octet_length(((target -> 'schema'::text))::text) + octet_length(((target -> 'display'::text))::text)) <= 65536)),
    CONSTRAINT entity_schema_changes_version_check CHECK ((version > 0))
);
CREATE TABLE app.entity_schema_analyses (
    owner_id uuid NOT NULL,
    type_id uuid NOT NULL,
    change_id uuid NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    change_version integer NOT NULL,
    fingerprint text NOT NULL,
    membership text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    total integer NOT NULL,
    processed integer DEFAULT 0 NOT NULL,
    failed integer DEFAULT 0 NOT NULL,
    fence bigint DEFAULT 0 NOT NULL,
    lease_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    changed integer DEFAULT 0 NOT NULL,
    unchanged integer DEFAULT 0 NOT NULL,
    removed integer DEFAULT 0 NOT NULL,
    replacements integer DEFAULT 0 NOT NULL,
    retryable boolean DEFAULT false NOT NULL,
    failure_reason text,
    CONSTRAINT entity_schema_analyses_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text]))),
    CONSTRAINT entity_schema_analyses_total_check CHECK (((total >= 0) AND (total <= 2000)))
);
CREATE TABLE app.entity_schema_migrations (
    owner_id uuid NOT NULL,
    type_id uuid NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    change_id uuid NOT NULL,
    change_version integer NOT NULL,
    analysis_id uuid NOT NULL,
    fingerprint text NOT NULL,
    membership text NOT NULL,
    source_type_version integer NOT NULL,
    source_schema_version integer NOT NULL,
    source_template_fingerprint text NOT NULL,
    source_templates jsonb NOT NULL,
    source_definition jsonb NOT NULL,
    target jsonb NOT NULL,
    migration jsonb NOT NULL,
    source_references jsonb,
    committed_references jsonb,
    status text DEFAULT 'queued'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    total integer NOT NULL,
    processed integer DEFAULT 0 NOT NULL,
    fence bigint DEFAULT 0 NOT NULL,
    lease_until timestamp with time zone,
    retryable boolean DEFAULT false NOT NULL,
    failure_reason text,
    result jsonb,
    source_expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval),
    actor_source text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    committed_membership text,
    recovery_source_job_id uuid,
    recovery_keys jsonb,
    CONSTRAINT entity_schema_migrations_actor_source_check CHECK ((actor_source = ANY (ARRAY['http'::text, 'mcp'::text]))),
    CONSTRAINT entity_schema_migrations_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'preparing'::text, 'ready_to_commit'::text, 'committing'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT entity_schema_migrations_total_check CHECK (((total >= 0) AND (total <= 2000)))
);

create table app.entities(owner_id uuid,entity_type_id uuid,schema_version integer,id text,properties jsonb,
 constraint entity_stored_schema foreign key(owner_id,entity_type_id,schema_version) references app.entity_schema_versions(owner_id,type_id,schema_version));
-- Business writes and their safe results commit together. Tombstones never expire.
create table private.request_results (
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_key uuid not null,
  operation text not null,
  revision integer not null default 1 check (revision = 1),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz,
  result jsonb,
  primary key(owner_id, request_key),
  check (result is null or octet_length(result::text) <= 131072)
);

revoke all on private.request_results from public,anon,authenticated,app_user,app_server,app_worker;
