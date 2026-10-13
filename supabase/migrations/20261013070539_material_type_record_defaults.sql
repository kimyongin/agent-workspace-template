-- Material record defaults are fixed; only type overrides participate in job freshness.
create or replace function private.entity_schema_effective_templates(p_owner uuid,p_type uuid) returns jsonb language sql stable set search_path='' as $$
 with settings as (select coalesce((select settings from app.user_business_settings where owner_id=p_owner and id='record_templates'),'{}'::jsonb) as data),
 actions as (select action,coalesce(data->'entity_types'->p_type::text->action,'{}'::jsonb) as value from settings cross join unnest(array['create','update','delete','restore']) action)
 select jsonb_build_object('entity',jsonb_object_agg(action,jsonb_build_object(
 'memo',case when coalesce(value->>'memo','')~'^[[:space:]]*$' then case when action='update' then '$대상$ $액션$ ($변경항목$)' else '$대상$ $액션$' end else regexp_replace(value->>'memo','\$\{([^$]*?)\$\}','\$\1\$','g') end,
 'tag_ids',coalesce((select jsonb_agg(tag order by tag collate "C") from jsonb_array_elements_text(coalesce(value->'tag_ids','[]'::jsonb)) tag),'[]'::jsonb)))) from actions
$$;
