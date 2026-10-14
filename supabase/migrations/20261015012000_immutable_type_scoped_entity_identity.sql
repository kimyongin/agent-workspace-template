-- A contract transition for an empty related store, not a data migration.
-- Existing test/production cleanup requires its own explicit authorized manifest.
begin;
lock table app.entities,app.entity_tags,app.entity_pairs,app.tasks,app.records,
  app.entity_schema_analyses,app.entity_schema_migrations,
  private.entity_schema_analysis_rows,private.entity_schema_migration_rows,
  private.request_results in access exclusive mode;
do $$
begin
  if exists(select 1 from app.entities)
    or exists(select 1 from app.entity_tags)
    or exists(select 1 from app.entity_pairs)
    or exists(select 1 from app.tasks where cardinality(entity_ids)>0 or entity_context<>'[]'::jsonb)
    or exists(select 1 from app.records where cardinality(entity_ids)>0 or entity_context<>'[]'::jsonb
      or change_metadata->>'target_kind'='entity'
      or change_metadata @? '$.**.entity_ids[*]'
      or change_metadata @? '$.**.entity_context[*]'
      or change_metadata @? '$.**.entity_id')
    or exists(select 1 from app.entity_schema_analyses)
    or exists(select 1 from app.entity_schema_migrations)
    or exists(select 1 from private.entity_schema_analysis_rows)
    or exists(select 1 from private.entity_schema_migration_rows)
    or exists(select 1 from private.request_results where operation like 'entity.%'
      or result @? '$.**.entity_ids[*]'
      or result @? '$.**.entity_context[*]'
      or result @? '$.**.entity_id'
      or result @? '$.**.target_kind ? (@ == "entity")')
  then
    raise exception 'entity_identity_transition_requires_empty_related_store: existing entities, references, receipts or sealed schema jobs require separately authorized cleanup; no data was changed'
      using errcode='55000';
  end if;
end $$;
alter table app.entities drop constraint entity_tuple_id;
alter table app.entities drop constraint entities_owner_id_source_external_id_key;
alter table app.entities add constraint entity_tuple_id
  check(id=source||':'||entity_type_id::text||':'||external_id);
alter table app.entities add constraint entity_external_id_outer_space
  check(external_id=btrim(external_id,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'));
create or replace function app.enforce_entity_type_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.entity_type_id is distinct from old.entity_type_id
    or new.source is distinct from old.source or new.external_id is distinct from old.external_id
    or new.id is distinct from old.id then
    raise exception 'entity_identity_immutable' using errcode='23514';
  end if;
  return new;
end $$;
drop function app.rekey_entity(text,text,text);
drop function app.rewrite_entity_refs(jsonb,text,text,boolean);
-- Global identity settings are no longer a writable/readable product contract.
-- Old rows are preserved; no automatic cleanup occurs here.
alter table app.user_business_settings drop constraint business_settings_section_id;
alter table app.user_business_settings add constraint business_settings_section_id
  check(id='record_templates') not valid;
commit;
