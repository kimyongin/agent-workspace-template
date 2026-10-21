-- #543/#553: properties is the only writable identifier value authority.
-- This is an explicit-reset cutover, never a preservation/rekey migration.
begin;
lock table app.entities,app.entity_types,app.entity_schema_versions,
 app.entity_schema_changes,app.entity_schema_analyses,app.entity_schema_migrations,
 app.data_model_changes,app.tasks,app.records,app.search_index_state,app.search_chunks,private.passage_effects,
 pgmq.q_search_index,pgmq.a_search_index,private.entity_schema_analysis_rows,
 private.entity_schema_migration_rows,private.workspace_request_results,private.request_results in access exclusive mode;
do $$
begin
 if exists(select 1 from app.entities)
  or exists(select 1 from app.tasks where cardinality(entity_ids)>0 or entity_context<>'[]'::jsonb)
  or exists(select 1 from app.records where entity_id is not null or cardinality(entity_ids)>0 or entity_context<>'[]'::jsonb
   or change_metadata->>'target_kind'='entity' or change_metadata @? '$.**.entity_ids[*]'
   or change_metadata @? '$.**.entity_context[*]' or change_metadata @? '$.**.entity_id')
  or exists(select 1 from app.search_index_state where kind='entity')
  or exists(select 1 from app.search_chunks where source_kind='entity')
  or exists(select 1 from private.passage_effects where source_kind='entity')
  or exists(select 1 from pgmq.q_search_index where message->>'kind'='entity')
  or exists(select 1 from pgmq.a_search_index where message->>'kind'='entity')
  or exists(select 1 from app.entity_types t join app.entity_schema_versions s
   on s.workspace_id=t.workspace_id and s.type_id=t.id and s.schema_version=t.schema_version
   where not coalesce(s.schema->'required' ? (s.schema->>'x-identity-property'),false)
    or s.schema->'properties'->(s.schema->>'x-identity-property')->'type' is distinct from '"string"'::jsonb
    or not coalesce(s.schema->'properties'->(s.schema->>'x-identity-property') ? 'x-identifier',false))
  or exists(select 1 from app.entity_schema_changes)
  or exists(select 1 from app.entity_schema_analyses)
  or exists(select 1 from app.entity_schema_migrations)
  or exists(select 1 from app.data_model_changes)
  or exists(select 1 from private.workspace_request_results where operation ~ '^(entity[.]|entity-type[.]|entity-schema-|entity-relation[.]|entity-link[.]|data-model[.])'
   or result @? '$.**.entity_ids[*]' or result @? '$.**.entity_context[*]' or result @? '$.**.entity_id'
   or result @? '$.**.target_kind ? (@ == "entity")')
  or exists(select 1 from private.request_results where operation ~ '^(entity[.]|entity-type[.]|entity-schema-|entity-relation[.]|entity-link[.]|data-model[.])'
   or result @? '$.**.entity_ids[*]' or result @? '$.**.entity_context[*]' or result @? '$.**.entity_id'
   or result @? '$.**.target_kind ? (@ == "entity")')
 then
  raise exception 'field_identifier_cutover_requires_explicit_reset' using errcode='55000',
   hint='Apply the reviewed single #551/#543 reset plan to incompatible entity definitions, entities and their retained work; no data was changed.';
 end if;
end $$;

create function app.identifier_raw(p_value text) returns text
 language plpgsql immutable parallel safe set search_path='' as $$
declare raw text:=substr(p_value,38); c text; n integer;
 whitespace constant text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
 if p_value is null or substr(p_value,1,37) !~ '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff):$'
  or char_length(raw) not between 1 and 200 or raw<>btrim(raw,whitespace) then
  raise exception 'identifier_value_invalid' using errcode='23514';
 end if;
 for c in select regexp_split_to_table(raw,'') loop
  n:=ascii(c);
  if n<32 or n between 127 and 159 then raise exception 'identifier_value_invalid' using errcode='23514';end if;
 end loop;
 return raw;
end $$;
create function app.identifier_kind(p_value text) returns uuid
 language plpgsql immutable parallel safe set search_path='' as $$
begin
 perform app.identifier_raw(p_value);
 return substr(p_value,1,36)::uuid;
end $$;
create function app.entity_reference(p_type uuid,p_value text) returns text
 language plpgsql immutable parallel safe set search_path='' as $$
begin
 if p_type is null then raise exception 'entity_type_missing' using errcode='23514';end if;
 perform app.identifier_kind(p_type::text||':type');
 perform app.identifier_raw(p_value);
 return p_type::text||':'||p_value;
end $$;
revoke all on function app.identifier_raw(text),app.identifier_kind(text),app.entity_reference(uuid,text) from public,anon,authenticated;
grant execute on function app.identifier_raw(text),app.identifier_kind(text),app.entity_reference(uuid,text) to app_user,app_worker;

-- Registry references are derived from immutable publication documents, never
-- independently writable per-field settings or a second reference ledger.
create function private.identifier_field_references(p_workspace uuid)
 returns table(type_id uuid,schema_version integer,property text,settings jsonb)
 language sql stable security definer set search_path='' as $$
 select s.type_id,s.schema_version,f.key,f.value->'x-identifier'
 from app.entity_schema_versions s cross join lateral jsonb_each(s.schema->'properties') f
 where s.workspace_id=p_workspace and f.value ? 'x-identifier'
$$;
revoke all on function private.identifier_field_references(uuid) from public,anon,authenticated,app_user,app_server,app_worker;

create function app.entity_identifier_kinds(p_type uuid,p_schema_version integer) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare document jsonb; result jsonb;
begin
 perform app.authorize_workspace(jsonb_build_array(jsonb_build_object('target_kind','entity_type','target_id',p_type::text,'access','read')));
 select s.schema into document from app.entity_schema_versions s join app.entity_types t
  on t.workspace_id=s.workspace_id and t.id=s.type_id
  where s.workspace_id=app.current_workspace_id() and s.type_id=p_type and s.schema_version=p_schema_version;
 if not found then return '[]'::jsonb;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'source',r.source,'label',r.label,
  'source_label',i.label,'active',r.active and i.active,'generation',r.generation,
  'version',r.version,'source_version',i.version) order by r.id),'[]'::jsonb) into result
 from app.entity_identifier_rules r join app.entity_issuers i on i.workspace_id=r.workspace_id and i.code=r.source
 where r.workspace_id=app.current_workspace_id() and exists(
  select 1 from jsonb_each(document->'properties') f
  where f.value->'x-identifier'->'allowed_kind_ids' ? r.id::text);
 return result;
end $$;
revoke all on function app.entity_identifier_kinds(uuid,integer) from public,anon,authenticated,app_worker;
grant execute on function app.entity_identifier_kinds(uuid,integer) to app_user;

-- One transaction mutex covers schema/registry decisions, including SQL writes
-- that do not enter through the application's transaction adapter.
create function private.lock_identifier_registry() returns trigger
 language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(app.current_workspace_id()::text||':entity-identity-registry',0));
 return null;
end $$;
create trigger identifier_registry_lock before insert or update or delete on app.entity_identifier_rules
 for each statement execute function private.lock_identifier_registry();
create trigger issuer_registry_lock before insert or update or delete on app.entity_issuers
 for each statement execute function private.lock_identifier_registry();
revoke all on function private.lock_identifier_registry() from public,anon,authenticated,app_user,app_server,app_worker;

create or replace function app.lock_business_entity_identity(p_type uuid) returns boolean
 language plpgsql security definer set search_path='' as $$
declare document jsonb;
begin
 perform app.authorize_workspace(jsonb_build_array(jsonb_build_object('target_kind','entity_type','target_id',p_type::text,'access','write')));
 select s.schema into document from app.entity_types t join app.entity_schema_versions s
  on s.workspace_id=t.workspace_id and s.type_id=t.id and s.schema_version=t.schema_version
  where t.workspace_id=app.current_workspace_id() and t.id=p_type for share of t,s;
 if not found then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(app.current_workspace_id()::text||':entity-identity-registry',0));
 perform 1 from app.entity_identifier_rules r join app.entity_issuers i on i.workspace_id=r.workspace_id and i.code=r.source
  where r.workspace_id=app.current_workspace_id() and exists(select 1 from jsonb_each(document->'properties') f
   where f.value->'x-identifier'->'allowed_kind_ids' ? r.id::text) order by r.id for share of r,i;
 return true;
end $$;

create function private.guard_identifier_definition() returns trigger
 language plpgsql security definer set search_path='' as $$
declare v_type uuid:=(new.schema->>'x-type-id')::uuid;identity_key text:=new.schema->>'x-identity-property';field record;settings jsonb;v_kind_text text;current_document jsonb; old_identity text;
begin
 -- This trigger is also the final direct-SQL publication boundary. Drafts live
 -- elsewhere; a published document always contains exactly one identity field.
 if identity_key is null or not(new.schema->'properties' ? identity_key)
  or not(new.schema->'required' ? identity_key) then
  raise exception 'identifier_definition_invalid' using errcode='23514';end if;
 perform 1 from app.entity_types where workspace_id=new.workspace_id and id=v_type for update;
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text||':entity-identity-registry',0));
 for field in select key,value from jsonb_each(new.schema->'properties') loop
  if field.key=identity_key and (not(field.value ? 'x-identifier') or field.value->'type'<>'"string"'::jsonb
   or field.value ? 'default' or coalesce((field.value->>'deprecated')::boolean,false)) then
   raise exception 'identifier_definition_invalid' using errcode='23514';end if;
  if not(field.value ? 'x-identifier') then continue;end if;
  settings:=field.value->'x-identifier';
  if not coalesce(field.value->'type' in ('"string"'::jsonb,'["string","null"]'::jsonb,'["null","string"]'::jsonb),false)
   or field.value ?| array['minLength','maxLength','pattern','format','oneOf','enum']
   or jsonb_typeof(settings) is distinct from 'object'
   or jsonb_typeof(settings->'allowed_kind_ids') is distinct from 'array'
   or jsonb_array_length(settings->'allowed_kind_ids')<1
   or not(settings->'allowed_kind_ids' ? (settings->>'default_kind_id')) then
   raise exception 'identifier_definition_invalid' using errcode='23514';end if;
  if (select count(*) from jsonb_array_elements(settings->'allowed_kind_ids'))<>
   (select count(distinct value) from jsonb_array_elements(settings->'allowed_kind_ids')) then
   raise exception 'identifier_definition_invalid' using errcode='23514';end if;
  for v_kind_text in select jsonb_array_elements_text(settings->'allowed_kind_ids') loop
   if not exists(select 1 from app.entity_identifier_rules r join app.entity_issuers i
    on i.workspace_id=r.workspace_id and i.code=r.source where r.workspace_id=new.workspace_id and r.id::text=v_kind_text)
    then raise exception 'identifier_kind_unavailable' using errcode='23514';end if;
  end loop;
  perform 1 from app.entity_identifier_rules r join app.entity_issuers i on i.workspace_id=r.workspace_id and i.code=r.source
   where r.workspace_id=new.workspace_id and settings->'allowed_kind_ids' ? r.id::text order by r.id for share of r,i;
  if not exists(select 1 from app.entity_identifier_rules r join app.entity_issuers i
   on i.workspace_id=r.workspace_id and i.code=r.source where r.workspace_id=new.workspace_id
   and r.id::text=settings->>'default_kind_id' and r.active and i.active) then
   raise exception 'identity_default_inactive' using errcode='23514',detail=field.key;end if;
  if field.value ? 'default' and field.value->'default'<>'null'::jsonb then
   if not(settings->'allowed_kind_ids' ? app.identifier_kind(field.value->>'default')::text) then
    raise exception 'identifier_kind_not_allowed' using errcode='23514';end if;
  end if;
 end loop;
 if exists(select 1 from app.entities where workspace_id=new.workspace_id and entity_type_id=v_type) then
  select s.schema into current_document from app.entity_types t join app.entity_schema_versions s
   on s.workspace_id=t.workspace_id and s.type_id=t.id and s.schema_version=t.schema_version
   where t.workspace_id=new.workspace_id and t.id=v_type;
  old_identity:=current_document->>'x-identity-property';
  if identity_key is distinct from old_identity or new.schema->'properties'->identity_key->'type' is distinct from
   current_document->'properties'->old_identity->'type' then
   raise exception 'entity_identity_definition_immutable' using errcode='23514';end if;
  for field in select key,value from jsonb_each(current_document->'properties') where value ? 'x-identifier' loop
   if exists(select 1 from app.entities e where e.workspace_id=new.workspace_id and e.entity_type_id=v_type
    and e.properties->field.key is not null and e.properties->field.key<>'null'::jsonb
    and not coalesce(new.schema->'properties'->field.key->'x-identifier'->'allowed_kind_ids'
     ? app.identifier_kind(e.properties->>field.key)::text,false)) then
    raise exception 'identifier_kind_in_use' using errcode='23514',detail=field.key;end if;
  end loop;
 end if;
 return new;
end $$;
create trigger identifier_definition before insert on app.entity_schema_versions
 for each row execute function private.guard_identifier_definition();
revoke all on function private.guard_identifier_definition() from public,anon,authenticated,app_user,app_server,app_worker;

create function private.guard_entity_identifiers() returns trigger
 language plpgsql security definer set search_path='' as $$
declare document jsonb;old_document jsonb;identity_key text;field record;pair text;kind uuid;active boolean;
begin
 perform 1 from app.entity_types where workspace_id=new.workspace_id and id=new.entity_type_id for share;
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text||':entity-identity-registry',0));
 select schema into document from app.entity_schema_versions
  where workspace_id=new.workspace_id and type_id=new.entity_type_id and schema_version=new.schema_version for share;
 if not found then raise exception 'identifier_definition_missing' using errcode='23514';end if;
 identity_key:=document->>'x-identity-property';
 if identity_key is null or jsonb_typeof(new.properties->identity_key) is distinct from 'string' then
  raise exception 'entity_identity_required' using errcode='23514';end if;
 if tg_op='UPDATE' then
  select schema into old_document from app.entity_schema_versions
   where workspace_id=old.workspace_id and type_id=old.entity_type_id and schema_version=old.schema_version;
  if new.workspace_id is distinct from old.workspace_id or new.entity_type_id is distinct from old.entity_type_id
   or new.id is distinct from old.id or identity_key is distinct from old_document->>'x-identity-property'
   or new.properties->identity_key is distinct from old.properties->identity_key then
   raise exception 'entity_identity_immutable' using errcode='23514';end if;
 end if;
 if new.id is distinct from app.entity_reference(new.entity_type_id,new.properties->>identity_key) then
  raise exception 'entity_identifier_reference_mismatch' using errcode='23514';end if;
 for field in select key,value from jsonb_each(document->'properties') where value ? 'x-identifier' loop
  if new.properties->field.key is null or new.properties->field.key='null'::jsonb then
   if document->'required' ? field.key or (new.properties ? field.key and field.value->'type'='"string"'::jsonb) then
    raise exception 'identifier_value_required' using errcode='23514';end if;
   continue;
  end if;
  if jsonb_typeof(new.properties->field.key)<>'string' then raise exception 'identifier_value_invalid' using errcode='23514';end if;
  pair:=new.properties->>field.key;kind:=app.identifier_kind(pair);
  if not(field.value->'x-identifier'->'allowed_kind_ids' ? kind::text) then
   raise exception 'identifier_kind_not_allowed' using errcode='23514',detail=field.key;end if;
  select r.active and i.active into active from app.entity_identifier_rules r join app.entity_issuers i
   on i.workspace_id=r.workspace_id and i.code=r.source where r.workspace_id=new.workspace_id and r.id=kind for share of r,i;
  if not found then raise exception 'identifier_kind_unavailable' using errcode='23514';end if;
  if not active and (tg_op='INSERT' or new.properties->field.key is distinct from old.properties->field.key) then
   raise exception 'identifier_kind_inactive' using errcode='23514',detail=field.key;end if;
 end loop;
 return new;
end $$;
create trigger entity_identifier_values before insert or update on app.entities
 for each row execute function private.guard_entity_identifiers();
revoke all on function private.guard_entity_identifiers() from public,anon,authenticated,app_user,app_server,app_worker;

create or replace function app.enforce_entity_type_immutable() returns trigger
 language plpgsql set search_path='' as $$
begin
 if new.workspace_id is distinct from old.workspace_id or new.entity_type_id is distinct from old.entity_type_id
  or new.id is distinct from old.id then raise exception 'entity_identity_immutable' using errcode='23514';end if;
 return new;
end $$;

create or replace function private.guard_identity_definition() returns trigger
 language plpgsql security definer set search_path='' as $$
declare referenced_types uuid[];
begin
 if tg_op='DELETE' and not exists(select 1 from app.workspaces where id=old.workspace_id) then return old;end if;
 if tg_table_name='entity_issuers' then
  if tg_op='UPDATE' and (new.workspace_id is distinct from old.workspace_id or new.code is distinct from old.code
   or new.system is distinct from old.system) then raise exception 'issuer_code_immutable' using errcode='23514';end if;
  if tg_op='DELETE' and exists(select 1 from private.identifier_field_references(old.workspace_id) f
   join app.entity_identifier_rules r on r.workspace_id=old.workspace_id and f.settings->'allowed_kind_ids' ? r.id::text
   where r.source=old.code) then raise exception 'referenced_issuer_immutable' using errcode='23514';end if;
 elsif tg_table_name='entity_identifier_rules' then
  select array_agg(distinct f.type_id) into referenced_types from private.identifier_field_references(old.workspace_id) f
   where f.settings->'allowed_kind_ids' ? old.id::text;
  if tg_op='DELETE' then
   if cardinality(referenced_types)>0 then raise exception 'referenced_rule_immutable' using errcode='23514';end if;
   return old;
  end if;
  if new.workspace_id is distinct from old.workspace_id or new.id is distinct from old.id
   or new.source is distinct from old.source or new.generation is distinct from old.generation then
   raise exception 'rule_identity_immutable' using errcode='23514';end if;
  if new.meaning is distinct from old.meaning then
   if old.source='app' or cardinality(referenced_types)>0 then raise exception 'referenced_rule_immutable' using errcode='23514';end if;
  end if;
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
create trigger issuer_delete_guard before delete on app.entity_issuers
 for each row execute function private.guard_identity_definition();
create trigger identifier_rule_delete_guard before delete on app.entity_identifier_rules
 for each row execute function private.guard_identity_definition();

create or replace function private.check_identity_default_active() returns trigger
 language plpgsql security definer set search_path='' as $$
declare affected jsonb;
begin
 select jsonb_agg(jsonb_build_object('type_id',t.id,'property',f.key)) into affected
 from app.entity_types t join app.entity_schema_versions s
  on s.workspace_id=t.workspace_id and s.type_id=t.id and s.schema_version=t.schema_version
 cross join lateral jsonb_each(s.schema->'properties') f
 join app.entity_identifier_rules r on r.workspace_id=t.workspace_id and r.id::text=f.value->'x-identifier'->>'default_kind_id'
 join app.entity_issuers i on i.workspace_id=r.workspace_id and i.code=r.source
 where t.workspace_id=new.workspace_id and not(r.active and i.active);
 if affected is not null then raise exception 'identity_default_inactive' using errcode='23514',detail=affected::text;end if;
 return new;
end $$;

-- The schema document supplies the exact referenced projection under type read
-- permission; unrelated settings remain hidden without a settings grant.
drop policy workspace_definition_read on app.entity_identifier_rules;
create policy workspace_definition_read on app.entity_identifier_rules for select to app_user
 using(workspace_id=app.current_workspace_id() and (app.workspace_allows('settings','*','read') or exists(
  select 1 from app.entity_types t join app.entity_schema_versions s
   on s.workspace_id=t.workspace_id and s.type_id=t.id and s.schema_version=t.schema_version
  cross join lateral jsonb_each(s.schema->'properties') f
  where t.workspace_id=entity_identifier_rules.workspace_id and app.workspace_allows('entity_type',t.id::text,'read')
   and f.value->'x-identifier'->'allowed_kind_ids' ? entity_identifier_rules.id::text)));
drop policy workspace_definition_read on app.entity_issuers;
create policy workspace_definition_read on app.entity_issuers for select to app_user
 using(workspace_id=app.current_workspace_id() and (app.workspace_allows('settings','*','read') or exists(
  select 1 from app.entity_identifier_rules r where r.workspace_id=entity_issuers.workspace_id and r.source=entity_issuers.code)));

-- Publishing an already retained version is still a publication. In particular,
-- a recovery cannot point the head at a historical alternate identity field.
create function private.guard_identifier_head() returns trigger
 language plpgsql security definer set search_path='' as $$
declare document jsonb;identity_key text;
begin
 if new.schema_version is not distinct from old.schema_version then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text||':entity-identity-registry',0));
 select schema into document from app.entity_schema_versions where workspace_id=new.workspace_id
  and type_id=new.id and schema_version=new.schema_version;
 identity_key:=document->>'x-identity-property';
 if identity_key is null or not coalesce(document->'required' ? identity_key,false)
  or document->'properties'->identity_key->'type' is distinct from '"string"'::jsonb
  or not coalesce(document->'properties'->identity_key ? 'x-identifier',false) then
  raise exception 'identifier_definition_invalid' using errcode='23514';end if;
 if exists(select 1 from app.entities e join app.entity_schema_versions s
  on s.workspace_id=e.workspace_id and s.type_id=e.entity_type_id and s.schema_version=e.schema_version
  where e.workspace_id=new.workspace_id and e.entity_type_id=new.id
   and (identity_key is distinct from s.schema->>'x-identity-property'
    or document->'properties'->identity_key->'type' is distinct from s.schema->'properties'->identity_key->'type'
    or not coalesce(document->'required' ? identity_key,false)
    or coalesce((document->'properties'->identity_key->>'deprecated')::boolean,false)
    or not coalesce(document->'properties'->identity_key->'x-identifier'->'allowed_kind_ids'
     ? app.identifier_kind(e.properties->>identity_key)::text,false))) then
  raise exception 'entity_identity_definition_immutable' using errcode='23514';end if;
 return new;
end $$;
create trigger identifier_head before update of schema_version on app.entity_types
 for each row execute function private.guard_identifier_head();
revoke all on function private.guard_identifier_head() from public,anon,authenticated,app_user,app_server,app_worker;

-- Retire old settings write authority and the old value/reference tuple only
-- after every runtime SQL consumer has moved to the field document contract.
drop trigger entity_identity_reference on app.entities;
drop trigger issuer_effective_configuration on app.entity_issuers;
drop trigger rule_effective_configuration on app.entity_identifier_rules;
drop function private.mark_entity_identity_reference();
drop function private.bump_type_identity_configuration();

CREATE OR REPLACE FUNCTION app.entity_title(p_schema jsonb, p_properties jsonb, p_fallback text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
declare
 v_template text:=p_schema->>'x-title-template';v_key text;v_field jsonb;v_raw jsonb;v_choice text;
 v_position integer:=1;v_open integer;v_start integer;v_end integer;v_legacy boolean;
 v_value text;v_result text:='';v_has_content boolean:=false;
 v_whitespace constant text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
 while v_position<=char_length(v_template) loop
  v_open:=strpos(substr(v_template,v_position),'$');
  if v_open=0 then
   v_value:=substr(v_template,v_position);v_position:=char_length(v_template)+1;
  elsif v_open>1 then
   v_value:=substr(v_template,v_position,v_open-1);v_position:=v_position+v_open-1;
  elsif substr(v_template,v_position,2)='$$' then
   v_value:='$';v_position:=v_position+2;
  else
   v_legacy:=substr(v_template,v_position,2)='${';
   v_start:=v_position+case when v_legacy then 2 else 1 end;
   v_end:=strpos(substr(v_template,v_start),case when v_legacy then '$}' else '$' end);
   if v_end=0 then exit;end if;
   v_key:=substr(v_template,v_start,v_end-1);
   v_position:=v_start+v_end-1+case when v_legacy then 2 else 1 end;
   v_field:=p_schema->'properties'->v_key;v_raw:=p_properties->v_key;
   select item->>'title' into v_choice from jsonb_array_elements(
    case when jsonb_typeof(v_field->'oneOf')='array' then v_field->'oneOf' else '[]'::jsonb end
   ) item where item->'const'=v_raw and item ? 'title' limit 1;
   if found then v_value:=v_choice;
   elsif jsonb_typeof(v_raw)='boolean' then v_value:=case when v_raw='true'::jsonb then '예' else '아니오' end;
   elsif jsonb_typeof(v_raw)='number' then
    v_value:=v_raw#>>'{}';
    -- JSONB can retain numeric scale; JavaScript's validated Number projection does not.
    if v_value::numeric=0 then v_value:='0';
    elsif strpos(v_value,'.')>0 then v_value:=rtrim(rtrim(v_value,'0'),'.');end if;
   elsif jsonb_typeof(v_raw)='string' then
    v_value:=case when v_field ? 'x-identifier' then app.identifier_raw(v_raw#>>'{}') else v_raw#>>'{}' end;
   else v_value:='';end if;
  end if;
  v_has_content:=v_has_content or btrim(v_value,v_whitespace)<>'';
  -- Keep at most one overflow code point while still inspecting later parts for fallback.
  v_result:=left(v_result||v_value,4097);
 end loop;
 if not v_has_content then
  v_result:=case when jsonb_typeof(p_properties->(p_schema->>'x-identity-property'))='string'
   then app.identifier_raw(p_properties->>(p_schema->>'x-identity-property')) else coalesce(p_fallback,'') end;
 end if;
 return case when char_length(v_result)>4096 then left(v_result,4095)||'…' else v_result end;
end $function$
;

CREATE OR REPLACE FUNCTION app.claim_entity_schema_migration()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_candidate uuid; v_owner uuid; v_type_id uuid; v_job app.entity_schema_migrations%rowtype; v_batch jsonb;
begin

 select x.id,x.workspace_id,x.type_id into v_candidate,v_owner,v_type_id from app.entity_schema_migrations x where private.schema_job_current(x.workspace_id,x.id) and x.model_change_id is null and (x.status in ('queued','ready_to_commit') or (x.status in ('preparing','committing') and x.lease_until<now())) order by x.created_at,x.id limit 1;
 if v_candidate is null then return null; end if;
 if not private.authorize_schema_job(v_owner,v_candidate) then return null;end if;
 perform 1 from app.entity_types t where t.workspace_id=v_owner and t.id=v_type_id for update;
 select * into v_job from app.entity_schema_migrations where workspace_id=v_owner and id=v_candidate for update;
 if v_job.model_change_id is not null then return null;end if;
 if not(v_job.status in ('queued','ready_to_commit') or (v_job.status in ('preparing','committing') and v_job.lease_until<now())) then return null; end if;
 update app.entity_schema_migrations set status=case when status in ('ready_to_commit','committing') then 'committing' else 'preparing' end,fence=fence+1,version=version+1,lease_until=now()+interval '90 seconds',updated_at=now() where workspace_id=v_owner and id=v_job.id returning * into v_job;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'properties',r.source_properties,'after',r.after,'tag_ids',r.source_identity->'tag_ids','changed',r.changed,'recovery_properties',r.recovery_properties) order by r.entity_id collate "C"),'[]'::jsonb) into v_batch from
 (select * from (select x.*,sum(octet_length(source_properties::text)+octet_length(after::text)+coalesce(octet_length(recovery_properties::text),0)+octet_length(entity_id)+512) over(order by entity_id collate "C") as bytes,row_number() over(order by entity_id collate "C") as ordinal from private.entity_schema_migration_rows x where x.workspace_id=v_owner and x.job_id=v_job.id and not prepared) bounded where bytes<=524288 and ordinal<=50) r;
 return jsonb_build_object('id',v_job.id,'workspace_id',v_job.workspace_id,'initiated_by',v_job.initiated_by,'workspace_generation',v_job.workspace_generation,'type_id',v_job.type_id,'fence',v_job.fence,'status',v_job.status,'target',v_job.target,'source_definition',v_job.source_definition,'recovery_keys',v_job.recovery_keys,'migration',v_job.migration,'source_schema_version',v_job.source_schema_version,'source_template_fingerprint',v_job.source_template_fingerprint,'templates',private.entity_schema_effective_templates(v_owner,v_type_id),'available_tags',coalesce((select jsonb_agg(id order by id) from app.tags where workspace_id=v_owner and scope='record' and id in(select tag from jsonb_each(v_job.source_templates->'entity') action cross join lateral jsonb_array_elements_text(action.value->'tag_ids') tag)),'[]'::jsonb),'type',(select jsonb_build_object('id',t.id,'label',s.schema->>'title','icon_id',s.schema->>'x-icon','archived',coalesce((s.schema->>'deprecated')::boolean,false)) from app.entity_types t join app.entity_schema_versions s on s.workspace_id=t.workspace_id and s.type_id=t.id and s.schema_version=t.schema_version where t.workspace_id=v_owner and t.id=v_type_id),'rows',v_batch);
end $function$
;

CREATE OR REPLACE FUNCTION app.claim_data_model_conversion()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid;v_id uuid;v_group app.data_model_changes%rowtype;v_job app.entity_schema_migrations%rowtype;v_batch jsonb;
begin

 select g.workspace_id,g.id into v_owner,v_id from app.data_model_changes g where private.schema_group_current(g.workspace_id,g.id) and (g.status in ('queued','ready_to_commit') or (g.status in ('preparing','committing') and g.lease_until<now())) order by g.created_at,g.id limit 1;
 if v_id is null then return null;end if;
 if not private.authorize_schema_group(v_owner,v_id) then return null;end if;
 perform private.lock_data_model_owner(v_owner);
 select * into v_group from app.data_model_changes g where g.workspace_id=v_owner and g.id=v_id for update;
 if not(v_group.status in ('queued','ready_to_commit') or(v_group.status in ('preparing','committing') and v_group.lease_until<now())) then return null;end if;
 if not exists(select 1 from app.data_model_children c where c.workspace_id=v_owner and c.model_id=v_id and c.job_id is not null) then perform private.fail_data_model_group(v_owner,v_id,v_group.fence,'schema_plan_stale',false);return null;end if;
 if v_group.status in ('ready_to_commit','committing') or not exists(select 1 from app.data_model_children c join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id where c.workspace_id=v_owner and c.model_id=v_id and j.status<>'ready_to_commit') then
  update app.data_model_changes g set status='committing',fence=g.fence+1,version=g.version+1,lease_until=now()+interval '90 seconds',updated_at=now() where g.workspace_id=v_owner and g.id=v_id returning * into v_group;
  update app.entity_schema_migrations j set status='committing',fence=j.fence+1,version=j.version+1,lease_until=now()+interval '90 seconds',updated_at=now() where j.workspace_id=v_owner and exists(select 1 from app.data_model_children c where c.workspace_id=v_owner and c.model_id=v_id and c.job_id=j.id) and j.status in ('ready_to_commit','committing');
  return jsonb_build_object('id',v_id,'fence',v_group.fence,'status','committing');
 end if;
 select j.* into v_job from app.entity_schema_migrations j join app.data_model_children c on c.workspace_id=j.workspace_id and c.job_id=j.id where c.workspace_id=v_owner and c.model_id=v_id and (j.status='queued' or(j.status='preparing' and j.lease_until<now())) order by c.type_id limit 1 for update of j;
 if not found then perform private.fail_data_model_group(v_owner,v_id,v_group.fence,'schema_plan_stale',false);return null;end if;
 update app.data_model_changes g set status='preparing',fence=g.fence+1,version=g.version+1,lease_until=now()+interval '90 seconds',updated_at=now() where g.workspace_id=v_owner and g.id=v_id returning * into v_group;
 update app.entity_schema_migrations j set status='preparing',fence=j.fence+1,version=j.version+1,lease_until=now()+interval '90 seconds',updated_at=now() where j.workspace_id=v_owner and j.id=v_job.id returning * into v_job;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'properties',r.source_properties,'after',r.after,'tag_ids',r.source_identity->'tag_ids','changed',r.changed,'recovery_properties',r.recovery_properties) order by r.entity_id collate "C"),'[]'::jsonb) into v_batch from(select * from(select x.*,sum(octet_length(source_properties::text)+octet_length(after::text)+coalesce(octet_length(recovery_properties::text),0)+octet_length(entity_id)+512) over(order by entity_id collate "C") bytes,row_number() over(order by entity_id collate "C") ordinal from private.entity_schema_migration_rows x where x.workspace_id=v_owner and x.job_id=v_job.id and not prepared) bounded where bytes<=524288 and ordinal<=50) r;
 return jsonb_build_object('id',v_id,'fence',v_group.fence,'status','preparing','child',jsonb_build_object('id',v_job.id,'workspace_id',v_owner,'initiated_by',v_job.initiated_by,'workspace_generation',v_job.workspace_generation,'type_id',v_job.type_id,'fence',v_job.fence,'status',v_job.status,'target',v_job.target,'source_definition',v_job.source_definition,'recovery_keys',v_job.recovery_keys,'migration',v_job.migration,'source_schema_version',v_job.source_schema_version,'source_template_fingerprint',v_job.source_template_fingerprint,'templates',private.entity_schema_effective_templates(v_owner,v_job.type_id),'available_tags',coalesce((select jsonb_agg(t.id order by t.id) from app.tags t where t.workspace_id=v_owner and t.scope='record' and t.id in(select tag from jsonb_each(v_job.source_templates->'entity') action cross join lateral jsonb_array_elements_text(action.value->'tag_ids') tag)),'[]'::jsonb),'type',(select jsonb_build_object('id',t.id,'label',s.schema->>'title','icon_id',s.schema->>'x-icon','archived',coalesce((s.schema->>'deprecated')::boolean,false)) from app.entity_types t join app.entity_schema_versions s on s.workspace_id=t.workspace_id and s.type_id=t.id and s.schema_version=t.schema_version where t.workspace_id=v_owner and t.id=v_job.type_id),'rows',v_batch));
end $function$
;

CREATE OR REPLACE FUNCTION private.commit_entity_schema_migration(p_id uuid, p_fence bigint, p_template_fingerprint text, p_pipeline text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid; v_type_id uuid; v_job app.entity_schema_migrations%rowtype; v_type app.entity_types%rowtype; v_change app.entity_schema_changes%rowtype; v_next_schema integer; v_count integer;
begin
 select x.workspace_id,x.type_id into v_owner,v_type_id from app.entity_schema_migrations x where x.id=p_id;
 if v_owner is null or not private.authorize_schema_job(v_owner,p_id) then return false; end if;
 perform private.lock_data_model_owner(v_owner);
 if not private.schema_job_current(v_owner,p_id) then return false;end if;
 select * into v_type from app.entity_types x where x.workspace_id=v_owner and x.id=v_type_id for update;
 select * into v_job from app.entity_schema_migrations where workspace_id=v_owner and id=p_id for update;
 if v_job.status<>'committing' or v_job.fence is distinct from p_fence or v_job.lease_until is null or v_job.lease_until<=now() then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':record_templates',0));
 select * into v_change from app.entity_schema_changes where workspace_id=v_owner and id=v_job.change_id for update;
 if not v_type.schema_write_locked or v_type.schema_version<>v_job.source_schema_version or v_change.version<>v_job.change_version or v_change.fingerprint<>v_job.fingerprint or v_change.analysis_id<>v_job.analysis_id or v_change.status<>'ready' or app.entity_schema_membership(v_owner,v_type_id)<>v_job.membership or p_template_fingerprint<>v_job.source_template_fingerprint or private.entity_schema_effective_templates(v_owner,v_type_id)<>v_job.source_templates or private.workspace_entity_schema_reference_baseline(v_owner,v_type_id)<>v_job.source_references then
 perform private.fail_entity_schema_migration(p_id,p_fence,'schema_plan_stale',false); return false; end if;
 if p_pipeline is null or char_length(p_pipeline) not between 1 and 120 then raise exception 'invalid pipeline' using errcode='22023'; end if;
 if v_job.processed<>v_job.total or (select count(*) from private.entity_schema_migration_rows where workspace_id=v_owner and job_id=p_id and prepared)<>v_job.total then raise exception 'incomplete migration' using errcode='22023'; end if;
 perform 1 from app.entities e where e.workspace_id=v_owner and e.entity_type_id=v_type_id order by e.id collate "C" for update;
 if not exists(select 1 from private.data_model_commit_context ctx where ctx.workspace_id=v_owner and ctx.model_id=v_job.model_change_id and ctx.pid=pg_backend_pid() and ctx.txid=txid_current()) and not coalesce((v_job.target->'schema'->>'deprecated')::boolean,false)
 and exists(select 1 from app.entity_schema_versions s where s.workspace_id=v_owner and s.type_id=v_type_id and s.schema_version=v_type.schema_version
  and (coalesce((s.schema->>'deprecated')::boolean,false) or s.schema->>'title' is distinct from v_job.target->'schema'->>'title'))
 and exists(select 1 from app.entity_types t join app.entity_schema_versions s on s.workspace_id=t.workspace_id and s.type_id=t.id and s.schema_version=t.schema_version
  where t.workspace_id=v_owner and t.id<>v_type_id and not coalesce((s.schema->>'deprecated')::boolean,false) and s.schema->>'title'=v_job.target->'schema'->>'title') then
  perform private.fail_entity_schema_migration(p_id,p_fence,'schema_plan_stale',false); return false;
 end if;
 insert into private.schema_job_commit_context(workspace_id,job_id,pid,txid) values(v_owner,p_id,pg_backend_pid(),txid_current());
 v_next_schema=v_type.schema_version+1;
 insert into app.entity_schema_versions(workspace_id,schema) values(v_owner,(v_job.target->'schema')||jsonb_build_object('x-type-id',v_type_id,'x-version',v_next_schema));
 update app.entities e set properties=r.after,schema_version=v_next_schema,version=e.version+1,updated_at=now() from private.entity_schema_migration_rows r where r.workspace_id=v_owner and r.job_id=p_id and r.workspace_id=e.workspace_id and r.entity_id=e.id and e.entity_type_id=v_type_id and e.version=r.source_version;
 get diagnostics v_count=row_count;
 if v_count<>v_job.total then
  if exists(select 1 from private.data_model_commit_context ctx where ctx.workspace_id=v_owner and ctx.model_id=v_job.model_change_id and ctx.pid=pg_backend_pid() and ctx.txid=txid_current()) then raise exception 'schema_plan_stale' using errcode='P0001';end if;
  raise exception 'migration source changed' using errcode='40001';
 end if;
 update private.entity_schema_migration_rows set committed_version=source_version+1 where workspace_id=v_owner and job_id=p_id;
 insert into app.records(workspace_id,id,entity_id,created_by,created_by_name,body,record_kind,change_metadata)
 select v_owner,r.record_id,r.entity_id,v_job.initiated_by,v_job.created_by_name,r.record_body,'change',
  jsonb_build_object('event_id',r.record_id,'target_kind','entity','target_id',r.entity_id,
   'target_title',app.entity_title(v_job.target->'schema',r.after,app.identifier_raw(substr(r.entity_id,38))),
   'action','update','source',v_job.actor_source,'before',null,'after',null,'path',r.record_path,'schema_migration_id',v_job.id,'target_snapshot',r.record_context->0)
 from private.entity_schema_migration_rows r where r.workspace_id=v_owner and r.job_id=p_id and r.changed;
 insert into app.record_tags(workspace_id,record_id,tag_id)
 select v_owner,r.record_id,tag.id from private.entity_schema_migration_rows r
 cross join lateral jsonb_array_elements_text(r.record_tags) ids(id)
 join app.tags tag on tag.workspace_id=r.workspace_id and tag.scope='record' and tag.id=ids.id
 where r.workspace_id=v_owner and r.job_id=p_id and r.changed;
 with queued as (
  insert into pgmq.q_search_index(vt,message)
  select now(),jsonb_build_object('workspace_id',v_owner,'initiated_by',v_job.initiated_by,'workspace_generation',v_job.workspace_generation,
   'source_version',record.version,'kind','record','id',r.record_id,'input_hash',r.record_hash,'pipeline',p_pipeline)
  from private.entity_schema_migration_rows r join app.records record on record.workspace_id=r.workspace_id and record.id=r.record_id
  where r.workspace_id=v_owner and r.job_id=p_id and r.changed returning msg_id,message)
 insert into app.search_index_state(workspace_id,initiated_by,workspace_generation,source_version,kind,id,input_hash,pipeline,message_id)
 select v_owner,v_job.initiated_by,v_job.workspace_generation,(message->>'source_version')::bigint,'record',message->>'id',message->>'input_hash',p_pipeline,msg_id from queued;
 update app.entity_types set schema_version=v_next_schema,schema_write_locked=false,updated_at=now() where workspace_id=v_owner and id=v_type_id;
 update app.entity_schema_changes set status='applied',updated_at=now() where workspace_id=v_owner and id=v_job.change_id;
 update app.entity_schema_migrations set status='succeeded',version=version+1,lease_until=null,retryable=false,failure_reason=null,source_expires_at=coalesce(source_expires_at,now()+interval '30 days'),committed_membership=app.entity_schema_membership(v_owner,v_type_id),committed_references=private.workspace_entity_schema_reference_baseline(v_owner,v_type_id),result=jsonb_build_object('schema_version',v_next_schema,'total',v_job.total,'changed',(select count(*) from private.entity_schema_migration_rows where workspace_id=v_owner and job_id=p_id and changed),'committed_at',now()),updated_at=now() where workspace_id=v_owner and id=p_id;
 delete from private.schema_job_commit_context ctx where ctx.workspace_id=v_owner and ctx.job_id=p_id and ctx.pid=pg_backend_pid() and ctx.txid=txid_current();
 return true;
end $function$
;

CREATE OR REPLACE FUNCTION private.entity_search_input(p_workspace uuid, p_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare document jsonb;properties jsonb;field record;body text:='';fields jsonb:='[]';label text;field_text text;start_offset integer;
begin
 select v.schema,e.properties into document,properties from app.entities e join app.entity_types t on t.workspace_id=e.workspace_id and t.id=e.entity_type_id
  join app.entity_schema_versions v on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version
  where e.workspace_id=p_workspace and e.id=p_id and e.deleted_at is null;
 if not found then return jsonb_build_object('body','','fields','[]'::jsonb);end if;
 for field in select key,value as definition from jsonb_each(document->'properties')
  where value->'x-search-text'='true'::jsonb and not coalesce((value->>'deprecated')::boolean,false)
   and (value->'type'='"string"'::jsonb or value->'type'='["string","null"]'::jsonb or value->'type'='["null","string"]'::jsonb)
   and not (value ? 'format') and not (value ? 'oneOf') order by (value->>'x-order')::integer,key loop
  if jsonb_typeof(properties->field.key) is distinct from 'string' then continue;end if;
  field_text:=case when field.definition ? 'x-identifier' then app.identifier_raw(properties->>field.key) else properties->>field.key end;
  if trim(field_text)='' then continue;end if;
  label:=coalesce(nullif(field.definition->>'title',''),field.key);
  if body<>'' then body:=body||E'\n\n';end if;
  body:=body||label||E'\n';start_offset:=char_length(body);body:=body||field_text;
  fields:=fields||jsonb_build_array(jsonb_build_object('key',field.key,'label',label,'start',start_offset,'end',char_length(body)));
 end loop;
 return jsonb_build_object('body',body,'fields',fields);
end $function$
;

CREATE OR REPLACE FUNCTION private.data_model_document(p_owner uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
 'format','workspace-data-model','format_version',1,'title','자료 모델',
 'entity_types',coalesce((select jsonb_agg(jsonb_build_object(
  'ref','type_'||t.id::text,'schema',v.schema) order by t.id)
  from app.entity_types t join app.entity_schema_versions v
   on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version
  where t.workspace_id=p_owner),'[]'::jsonb),
 'relations',coalesce((select jsonb_agg(jsonb_build_object(
  'id',d.id,'version',d.version,'archived',d.archived,'ends',jsonb_build_array(
   jsonb_build_object('type_ref','type_'||d.left_type_id::text,'label',d.left_label,'cardinality',d.left_cardinality),
   jsonb_build_object('type_ref','type_'||d.right_type_id::text,'label',d.right_label,'cardinality',d.right_cardinality))) order by d.id)
  from app.entity_relation_definitions d where d.workspace_id=p_owner),'[]'::jsonb),
 'identity_definitions',jsonb_build_object(
  'issuers',coalesce((select jsonb_agg(jsonb_build_object('code',i.code,'label',i.label,
   'active',i.active,'system',i.system,'version',i.version) order by i.code)
   from app.entity_issuers i where i.workspace_id=p_owner),'[]'::jsonb),
  'rules',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'source',r.source,
   'label',r.label,'meaning',r.meaning,'generation',r.generation,
   'active',r.active,'version',r.version) order by r.id)
   from app.entity_identifier_rules r where r.workspace_id=p_owner),'[]'::jsonb)))
$function$
;

CREATE OR REPLACE FUNCTION private.publish_prepared_model_definitions(p_owner uuid, p_plan jsonb, p_skip uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare target jsonb:=p_plan->'target'; source jsonb:=p_plan->'source'; x jsonb; old jsonb;
 v_type_id uuid; v_rule_id uuid; next_property integer;
 ends jsonb; old_ends jsonb; counts jsonb; result jsonb;
begin
 perform private.authorize_model_publication_requirements(p_owner,'[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb);
 perform private.assert_model_publication_plan(p_owner,p_plan);
 if app.current_workspace_id() is distinct from p_owner then
  raise exception 'request_owner_missing' using errcode='42501'; end if;
 if (select count(*) from app.entity_types t where t.workspace_id=p_owner)
   +(select count(*) from jsonb_array_elements(target->'entity_types') z
     where not exists(select 1 from app.entity_types t where t.workspace_id=p_owner
      and t.id=(z->'schema'->>'x-type-id')::uuid))>64
 then raise exception 'entity_type_limit' using errcode='P0001'; end if;
 if (select count(distinct code) from (
  select i.code from app.entity_issuers i where i.workspace_id=p_owner
  union all select z->>'code' from jsonb_array_elements(target->'identity_definitions'->'issuers') z) q)>64
 then raise exception 'issuer_limit' using errcode='P0001'; end if;
 if exists(select 1 from (
  select r.source,r.id from app.entity_identifier_rules r where r.workspace_id=p_owner
  union select z->>'source',(z->>'id')::uuid
   from jsonb_array_elements(target->'identity_definitions'->'rules') z) q
  group by q.source having count(*)>64)
 then raise exception 'rule_limit' using errcode='P0001'; end if;
 for x in select value from jsonb_array_elements(target->'identity_definitions'->'issuers') loop
  select value into old from jsonb_array_elements(source->'identity_definitions'->'issuers') z
   where z->>'code'=x->>'code';
  if (x->>'system')::boolean then
   if x->>'code'<>'app' then raise exception 'invalid system issuer'; end if;
   if old is null then insert into app.entity_issuers(workspace_id,code,label,active,system)
    values(p_owner,'app','앱',true,true); end if;
  elsif old is null then
   insert into app.entity_issuers(workspace_id,code,label,active,system)
    values(p_owner,x->>'code',x->>'label',(x->>'active')::boolean,false);
  elsif (old->'label',old->'active') is distinct from (x->'label',x->'active') then
   update app.entity_issuers i set label=x->>'label',active=(x->>'active')::boolean,version=i.version+1
    where i.workspace_id=p_owner and i.code=x->>'code' and i.version=(old->>'version')::integer;
   if not found then raise exception 'schema_plan_stale' using errcode='P0001'; end if;
  end if;
 end loop;
 for x in select value from jsonb_array_elements(target->'identity_definitions'->'rules') loop
  v_rule_id:=(x->>'id')::uuid;
  select value into old from jsonb_array_elements(source->'identity_definitions'->'rules') z
   where (z->>'id')::uuid=v_rule_id;
  if old is null then
   insert into app.entity_identifier_rules(workspace_id,id,source,label,meaning,generation,active)
    values(p_owner,v_rule_id,x->>'source',x->>'label',x->>'meaning',x->>'generation',(x->>'active')::boolean);
  elsif v_rule_id<>'00000000-0000-4000-8000-000000000001'::uuid then
   if (old->'source',old->'generation') is distinct from (x->'source',x->'generation')
    then raise exception 'immutable rule identity' using errcode='P0001'; end if;
   if (old->'label',old->'meaning',old->'active') is distinct from (x->'label',x->'meaning',x->'active') then
    update app.entity_identifier_rules r set label=x->>'label',meaning=x->>'meaning',
     active=(x->>'active')::boolean,version=r.version+1
     where r.workspace_id=p_owner and r.id=v_rule_id and r.version=(old->>'version')::integer;
    if not found then raise exception 'schema_plan_stale' using errcode='P0001'; end if;
   end if;
  end if;
 end loop;
 for x in select value from jsonb_array_elements(target->'entity_types') loop
  v_type_id:=(x->'schema'->>'x-type-id')::uuid;
  select value into old from jsonb_array_elements(source->'entity_types') z
   where (z->'schema'->>'x-type-id')::uuid=v_type_id;
  select coalesce(max(substring(k from 6)::integer),1)+1 into next_property
   from jsonb_object_keys(x->'schema'->'properties') k;
  if old is null then
   insert into app.entity_types(workspace_id,id,next_property_number) values(p_owner,v_type_id,next_property);
  end if;
  if not (v_type_id=any(p_skip)) then
   if exists(select 1 from app.entity_types t where t.workspace_id=p_owner and t.id=v_type_id
    and t.schema_write_locked) then raise exception 'schema_migration_in_progress' using errcode='P0001'; end if;
   if old is null or ((old->'schema') - 'x-version') is distinct from ((x->'schema') - 'x-version') then
    insert into app.entity_schema_versions(workspace_id,schema) values(p_owner,x->'schema');
    update app.entity_types t set schema_version=(x->'schema'->>'x-version')::integer,
     next_property_number=greatest(t.next_property_number,next_property),updated_at=now()
     where t.workspace_id=p_owner and t.id=v_type_id;
   end if;
  elsif not exists(select 1 from app.entity_types t join app.entity_schema_versions v
   on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version
   where t.workspace_id=p_owner and t.id=v_type_id and v.schema=x->'schema') then
   raise exception 'group_schema_publication_mismatch' using errcode='P0001';
  end if;
 end loop;
 for x in select value from jsonb_array_elements(target->'relations') loop
  select value into old from jsonb_array_elements(source->'relations') z where z->>'id'=x->>'id';
  select jsonb_agg(jsonb_build_object('type_id',p_plan->'review'->'mapping'->'types'->>(z->>'type_ref'),
   'label',z->>'label','cardinality',z->>'cardinality') order by ord) into ends
   from jsonb_array_elements(x->'ends') with ordinality q(z,ord);
  select jsonb_agg(jsonb_build_object('type_id',t->'schema'->>'x-type-id',
   'label',z->>'label','cardinality',z->>'cardinality') order by ord) into old_ends
   from jsonb_array_elements(old->'ends') with ordinality q(z,ord)
   join lateral (select y from jsonb_array_elements(source->'entity_types') y
    where y->>'ref'=z->>'type_ref') matched(t) on true;
  if old is null or ends is distinct from old_ends or old->'archived' is distinct from x->'archived' then
   -- Executes with function owner privileges, but the public actor remains the verified stored owner.
   -- app_worker receives no grant on this public function itself.
   perform app.publish_data_model_relation((x->>'id')::uuid,(old->>'version')::integer,
     ends,(x->>'archived')::boolean);
  end if;
 end loop;
 with entries as (
  select z,case when exists(select 1 from jsonb_array_elements(target->'entity_types') t where t->>'ref'=z->>'ref') then 'types' when z->>'ref' like 'relation:%' then 'relations'
   when z->>'ref' like 'issuer:%' then 'issuers'
   when z->>'ref' like 'rule:%' then 'rules' else 'types' end category
  from jsonb_array_elements(p_plan->'review'->'items') z),
 summaries as (
  select category,jsonb_build_object(
   'added',count(*) filter(where z->>'kind'='new'),
   'updated',count(*) filter(where z->>'kind' in ('compatible','migration_required')),
   'unchanged',count(*) filter(where z->>'kind'='unchanged')) value
  from entries group by category)
 select jsonb_build_object('types',coalesce((select value from summaries where category='types'),'{"added":0,"updated":0,"unchanged":0}'::jsonb),
  'relations',coalesce((select value from summaries where category='relations'),'{"added":0,"updated":0,"unchanged":0}'::jsonb),
  'issuers',coalesce((select value from summaries where category='issuers'),'{"added":0,"updated":0,"unchanged":0}'::jsonb),
  'rules',coalesce((select value from summaries where category='rules'),'{"added":0,"updated":0,"unchanged":0}'::jsonb)) into counts;
 result:=jsonb_build_object('counts',counts,'changed',exists(
  select 1 from jsonb_each(counts) q where (q.value->>'added')::integer+(q.value->>'updated')::integer>0),
  'type_ids',coalesce((select jsonb_agg(z->'schema'->>'x-type-id') from jsonb_array_elements(target->'entity_types') z),'[]'::jsonb),
  'relation_ids',coalesce((select jsonb_agg(z->>'id') from jsonb_array_elements(target->'relations') z),'[]'::jsonb));
 return result;
end $function$
;
drop table app.entity_type_identity_sources,app.entity_type_identity;
drop function private.guard_type_identity_source();
alter table app.entities drop column source,drop column external_id;
-- Tombstones reserve identities. Runtime callers can only soft-delete them.
revoke delete on app.entities from app_user,app_worker;
commit;
