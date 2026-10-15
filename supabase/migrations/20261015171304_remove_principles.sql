-- #467: user-approved removal, including existing principle content. No archive or material conversion.
-- Applied migrations stay immutable; only the final live schema is contracted here.
create temporary table removed_principle_records on commit drop as
select owner_id,id from app.records
where change_metadata->>'target_kind'='principle'
   or (record_kind='user'
       and body ~ '^이관 캡처: [^\n]+ / 원본: (principle|record_principle_context) [0-9a-f-]{36} / 조각: [0-9]+/[0-9]+\n실제 적용 시각이 아닙니다\. 원본 시각과 captured_at 의미는 아래 자료 그대로 보존합니다\.');

-- Delete saved response copies as well as their originals, scoped by owner and exact record identity.
delete from private.request_results q
where q.operation like 'principle.%'
   or exists(select 1 from removed_principle_records r where r.owner_id=q.owner_id
     and exists(select 1 from jsonb_path_query(q.result,'$.**.id') v where v=to_jsonb(r.id)));

-- Existing record and task responses can contain readonly historical captures at any depth.
create function pg_temp.remove_principle_captures(value jsonb) returns jsonb
language sql immutable as $$
  select case jsonb_typeof(value)
    when 'object' then coalesce((select jsonb_object_agg(key,pg_temp.remove_principle_captures(item))
      from jsonb_each(value) e(key,item) where key not in ('applied_principle_snapshots','applied_principle_ids')),'{}'::jsonb)
    when 'array' then coalesce((select jsonb_agg(pg_temp.remove_principle_captures(item) order by ordinal)
      from jsonb_array_elements(value) with ordinality e(item,ordinal)),'[]'::jsonb)
    else value end
$$;
update private.request_results set result=pg_temp.remove_principle_captures(result)
where result is not null and (result::text like '%"applied_principle_snapshots"%' or result::text like '%"applied_principle_ids"%');
update private.request_results set result=result #- '{settings,record_templates,principle}'
where result #> '{settings,record_templates,principle}' is not null;

-- Delete derived passages, external-send bookkeeping and both queued and archived messages.
delete from private.passage_effects p using removed_principle_records r
where p.owner_id=r.owner_id and p.record_id=r.id;
delete from app.search_chunks c using removed_principle_records r
where c.owner_id=r.owner_id and c.record_id=r.id;
delete from app.search_index_state s using removed_principle_records r
where s.owner_id=r.owner_id and s.id=r.id;
delete from pgmq.q_search_index q where q.message->>'kind'='principle' or exists(
  select 1 from removed_principle_records r where q.message->>'owner_id'=r.owner_id::text and q.message->>'id'=r.id);
delete from pgmq.a_search_index q where q.message->>'kind'='principle' or exists(
  select 1 from removed_principle_records r where q.message->>'owner_id'=r.owner_id::text and q.message->>'id'=r.id);
delete from app.records d using removed_principle_records r where d.owner_id=r.owner_id and d.id=r.id;

alter table app.records drop column applied_principle_snapshots;
alter table app.records add constraint records_change_target_kind check (
  change_metadata is null or change_metadata->>'target_kind' in ('entity','task','record')
);
-- No CASCADE: an overlooked dependent contract must fail the migration instead of disappearing silently.
drop table app.principles;
update app.user_business_settings set settings=settings-'principle',version=version+1,updated_at=now()
where id='record_templates' and settings ? 'principle';

-- Preserve personal shortcut order and every unrelated profile field.
update auth.users u set raw_user_meta_data=jsonb_set(u.raw_user_meta_data,'{workspace_navigation,refs}',
  coalesce((select jsonb_agg(ref order by ordinal) from jsonb_array_elements(u.raw_user_meta_data #> '{workspace_navigation,refs}')
    with ordinality x(ref,ordinal) where not ref @> '{"kind":"builtin","id":"principles"}'::jsonb),'[]'::jsonb))
where jsonb_typeof(u.raw_user_meta_data #> '{workspace_navigation,refs}')='array'
  and (u.raw_user_meta_data #> '{workspace_navigation,refs}') @> '[{"kind":"builtin","id":"principles"}]'::jsonb;

create or replace function app.claim_search_index(p_limit integer,p_owner uuid default null,p_kind text default null,p_id text default null)
returns table(msg_id bigint,read_ct integer) language plpgsql security definer set search_path='' as $$
begin
  if p_limit not between 1 and 5 or (p_kind is not null and p_kind not in ('task','record')) then
    raise exception '잘못된 worker 범위' using errcode='22023';
  end if;
  if p_kind='task' then return; end if;
  return query select m.msg_id,m.read_ct from pgmq.read('search_index',90,p_limit,
    jsonb_strip_nulls(jsonb_build_object('owner_id',p_owner,'kind','record','id',p_id))) m;
end $$;
