begin;
lock table app.user_business_settings in access exclusive mode;
create temporary table previous_business_settings on commit drop as
  select owner_id,version,settings,updated_at from app.user_business_settings;
alter table app.user_business_settings add column id text;
alter table app.user_business_settings drop constraint user_business_settings_pkey;
update app.user_business_settings set id='record_templates',settings=coalesce(settings->'record_templates','{}'::jsonb);
insert into app.user_business_settings(owner_id,id,version,settings,updated_at)
  select owner_id,'entity_identity',version,
    coalesce(settings->'entity_identity','{"generation":"uuid","default_source":"app","sources":[{"code":"app","label":"앱"}]}'::jsonb),updated_at
  from previous_business_settings;
alter table app.user_business_settings alter column id set not null;
alter table app.user_business_settings add primary key(owner_id,id),
  add constraint business_settings_section_id check(id in ('record_templates','entity_identity'));
commit;
