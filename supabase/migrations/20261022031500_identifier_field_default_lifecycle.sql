-- Fixed identifier values are new-assignment defaults, independent of the default kind selector.
begin;

CREATE OR REPLACE FUNCTION private.guard_identifier_definition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   if not exists(select 1 from app.entity_identifier_rules r join app.entity_issuers i
    on i.workspace_id=r.workspace_id and i.code=r.source where r.workspace_id=new.workspace_id
    and r.id=app.identifier_kind(field.value->>'default') and r.active and i.active) then
    raise exception 'identifier_default_value_inactive' using errcode='23514',detail=field.key;end if;
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
end $function$;

create or replace function private.check_identity_default_active() returns trigger
language plpgsql security definer set search_path='' as $$
declare affected jsonb;
begin
 select jsonb_agg(jsonb_build_object('type_id',t.id,'property',f.key) order by t.id,f.key) into affected
 from app.entity_types t join app.entity_schema_versions s
  on s.workspace_id=t.workspace_id and s.type_id=t.id and s.schema_version=t.schema_version
 cross join lateral jsonb_each(s.schema->'properties') f
 join app.entity_identifier_rules r on r.workspace_id=t.workspace_id and (
  r.id::text=f.value->'x-identifier'->>'default_kind_id' or r.id=case
   when f.value ? 'x-identifier' and jsonb_typeof(f.value->'default')='string'
   then app.identifier_kind(f.value->>'default') end)
 join app.entity_issuers i on i.workspace_id=r.workspace_id and i.code=r.source
 where t.workspace_id=new.workspace_id and not(r.active and i.active);
 if affected is not null then raise exception 'identity_default_inactive' using errcode='23514',detail=affected::text;end if;
 return new;
end $$;

commit;
