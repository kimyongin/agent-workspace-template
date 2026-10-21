-- Forward fixes for schema visibility and ordinary identifier nullability.
begin;
create or replace function app.entity_identifier_kinds(p_type uuid,p_schema_version integer) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare document jsonb; result jsonb; settings_read boolean;
begin
 -- Match the existing schema SELECT policy; settings readers need no business-data grant.
 -- Membership/lifecycle remains authoritative before either permission branch.
 perform app.authorize_workspace('[]'::jsonb);
 settings_read:=app.workspace_allows('settings','*','read');
 if not settings_read then
  perform app.authorize_workspace(jsonb_build_array(jsonb_build_object('target_kind','entity_type','target_id',p_type::text,'access','read')));
 end if;
 select s.schema into document from app.entity_schema_versions s join app.entity_types t
  on t.workspace_id=s.workspace_id and t.id=s.type_id
  where s.workspace_id=app.current_workspace_id() and s.type_id=p_type and s.schema_version=p_schema_version
   and (settings_read or s.schema_version=t.schema_version);
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

create or replace function private.guard_entity_identifiers() returns trigger
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
  if not (new.properties ? field.key) then
   if document->'required' ? field.key then
    raise exception 'identifier_value_required' using errcode='23514';end if;
   continue;
  end if;
  if new.properties->field.key='null'::jsonb then
   if not coalesce(field.value->'type' @> '["null"]'::jsonb,false) then
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

commit;
