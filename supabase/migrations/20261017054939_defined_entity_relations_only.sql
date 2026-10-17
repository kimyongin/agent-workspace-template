-- Keep the exact historical rows outside the live relationship model.
-- No definitions are inferred and no business records or request receipts are rewritten.
lock table app.entity_pairs in access exclusive mode;
alter table app.entity_pairs set schema private;
alter table private.entity_pairs rename to retired_entity_pairs;
drop policy entity_pairs_owner on private.retired_entity_pairs;
-- Historical IDs must survive normal administrative removal of current entities.
-- The account ownership FK remains; only live endpoint cascade constraints retire.
do $$
declare constraint_name text;
begin
 for constraint_name in select conname from pg_constraint where conrelid='private.retired_entity_pairs'::regclass and contype='f' and confrelid='app.entities'::regclass loop
  execute format('alter table private.retired_entity_pairs drop constraint %I',constraint_name);
 end loop;
end $$;
revoke all on private.retired_entity_pairs from public,app_user,app_server,app_worker,anon,authenticated,service_role;
comment on table private.retired_entity_pairs is 'Retired unconfigured relationship originals; administrative historical preservation only. Not part of the active entity graph.';

-- The changed baseline deliberately makes old accepted analysis/recovery work stale.
-- Preserve those original baselines and their existing retention deadlines.
create or replace function app.entity_schema_reference_baseline(p_owner uuid,p_type uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
 'typed_links',coalesce((select jsonb_agg(jsonb_build_array(l.definition_id,l.left_entity_id,l.right_entity_id,l.created_at,d.version) order by l.definition_id,l.left_entity_id collate "C",l.right_entity_id collate "C") from app.entity_relation_links l join app.entity_relation_definitions d on d.owner_id=l.owner_id and d.id=l.definition_id where l.owner_id=p_owner and exists(select 1 from app.entities e where e.owner_id=p_owner and e.entity_type_id=p_type and e.id in (l.left_entity_id,l.right_entity_id))),'[]'::jsonb),
 'tasks',coalesce((select jsonb_agg(jsonb_build_array(t.id,t.entity_ids,t.entity_context) order by t.id collate "C") from app.tasks t where t.owner_id=p_owner and exists(select 1 from app.entities e where e.owner_id=p_owner and e.entity_type_id=p_type and e.id=any(t.entity_ids))),'[]'::jsonb),
 'records',coalesce((select jsonb_agg(jsonb_build_array(r.id,r.task_id,r.entity_ids,r.entity_context) order by r.id collate "C") from app.records r where r.owner_id=p_owner and r.record_kind<>'change' and exists(select 1 from app.entities e where e.owner_id=p_owner and e.entity_type_id=p_type and e.id=any(r.entity_ids))),'[]'::jsonb))
$$;
