-- Non-destructive forward transition. Only owners with existing fixed-property rows
-- receive an explicit legacy definition; new/empty owners remain without a type.
alter table app.entities add column entity_type_id uuid,
  add column schema_version integer,
  add column properties jsonb;
do $$
declare entity_owner uuid; legacy_type uuid;
begin
  for entity_owner in select distinct owner_id from app.entities loop
    insert into app.entity_types(owner_id,label,icon_id,next_property_number)
      values(entity_owner,'기존 자료','box',5) returning id into legacy_type;
    insert into app.entity_schema_versions(owner_id,type_id,schema_version,schema,display)
    values(entity_owner,legacy_type,1,
      '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"properties":{"prop_1":{"type":"string","title":"이름","minLength":1,"maxLength":100},"prop_2":{"type":["integer","null"],"title":"속성 2","minimum":0,"maximum":1000000},"prop_3":{"type":["string","null"],"title":"속성 3","format":"date"},"prop_4":{"type":"string","title":"속성 4","enum":["a","b","c"],"default":"a"}},"required":["prop_1","prop_4"]}'::jsonb,
      '{"representative":"prop_1","order":["prop_1","prop_2","prop_3","prop_4"],"list_columns":["prop_1","prop_2","prop_3","prop_4"],"archived":[],"option_labels":{}}'::jsonb);
    update app.entities set entity_type_id=legacy_type,schema_version=1,
      properties=jsonb_build_object('prop_1',prop1,'prop_2',prop2,'prop_3',prop3,'prop_4',prop4)
      where owner_id=entity_owner;
  end loop;
end $$;
alter table app.entities alter column entity_type_id set not null,
  alter column schema_version set not null, alter column properties set not null,
  add constraint entity_properties_object check(jsonb_typeof(properties)='object' and octet_length(properties::text)<=65536),
  add constraint entity_stored_schema foreign key(owner_id,entity_type_id,schema_version)
    references app.entity_schema_versions(owner_id,type_id,schema_version);
alter table app.entities drop column prop1, drop column prop2, drop column prop3, drop column prop4;
create index entities_owner_type_updated on app.entities(owner_id,entity_type_id,updated_at desc,id desc);
-- Publication and schema migration take the same type-row lock before entity locks.
-- Future migration jobs set this gate in their own transaction while preparing/applying.
alter table app.entity_types add column schema_write_locked boolean not null default false;
create function app.enforce_entity_type_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  if new.entity_type_id is distinct from old.entity_type_id then
    raise exception 'entity_type_immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger entity_type_immutable before update on app.entities for each row execute function app.enforce_entity_type_immutable();
revoke all on function app.enforce_entity_type_immutable() from public;
