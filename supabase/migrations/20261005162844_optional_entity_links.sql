-- Additive compatibility: legacy entity_id remains until all consumers have migrated.
-- Captured IDs/titles are knowledge context, not live FK ownership claims.
alter table app.tasks add column entity_ids uuid[] not null default '{}',
  add column entity_context jsonb not null default '[]'::jsonb;
alter table app.records add column entity_ids uuid[] not null default '{}',
  add column entity_context jsonb not null default '[]'::jsonb;

update app.tasks t set entity_ids=array[t.entity_id],
  entity_context=jsonb_build_array(jsonb_build_object('id',e.id,'title',e.prop1,'captured_at',now(),'source','legacy_backfill'))
  from app.entities e where t.entity_id=e.id and t.owner_id=e.owner_id;
update app.records r set entity_ids=array[r.entity_id],
  entity_context=jsonb_build_array(jsonb_build_object('id',e.id,'title',e.prop1,'captured_at',now(),'source','legacy_backfill'))
  from app.entities e where r.entity_id=e.id and r.owner_id=e.owner_id;

alter table app.tasks add constraint task_entity_selection_size check(cardinality(entity_ids)<=100),
  add constraint task_entity_context_array check(jsonb_typeof(entity_context)='array');
alter table app.records add constraint record_entity_selection_size check(cardinality(entity_ids)<=100),
  add constraint record_entity_context_array check(jsonb_typeof(entity_context)='array');
create index tasks_entity_ids on app.tasks using gin(entity_ids);
create index records_entity_ids on app.records using gin(entity_ids);
