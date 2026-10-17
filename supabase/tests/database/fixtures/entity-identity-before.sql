-- Minimal predecessor shape read by the immutable identity transition guard.
-- No current application aliases or historical migration changes are needed.
create schema app;
create schema private;
create table app.entities(owner_id uuid,id text,entity_type_id uuid,source text,external_id text,properties jsonb);
create table app.entity_tags(owner_id uuid,entity_id text,tag_id text);
create table app.entity_pairs(owner_id uuid,entity_id text,other_id text,created_at timestamptz);
create table app.tasks(owner_id uuid,id text,entity_ids text[],entity_context jsonb);
create table app.records(owner_id uuid,id text,entity_ids text[],entity_context jsonb,change_metadata jsonb,body text);
create table app.entity_schema_analyses(owner_id uuid,id uuid,status text,fingerprint text);
create table app.entity_schema_migrations(owner_id uuid,id uuid,status text,source_definition jsonb,source_expires_at timestamptz);
create table private.entity_schema_analysis_rows(owner_id uuid,analysis_id uuid,entity_id text,properties jsonb);
create table private.entity_schema_migration_rows(owner_id uuid,job_id uuid,entity_id text,source_properties jsonb);
create table private.request_results(owner_id uuid,request_key uuid,operation text,input_fingerprint text,result jsonb,expires_at timestamptz);
