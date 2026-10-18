-- Resolve all current affected parents before any protected use, unlink or
-- request receipt. Missing dictionaries may still replay a retained success;
-- the common ledger independently reauthorizes that saved complete footprint.
create function app.workspace_tag_delete_requirements(p_tag text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare required jsonb;
begin
 perform app.authorize_workspace('[]'::jsonb);
 if not exists(select 1 from app.tags where workspace_id=app.current_workspace_id() and id=p_tag) then return '[]'::jsonb;end if;
 if not app.workspace_tag_delete_allowed(p_tag) then raise exception 'workspace_denied' using errcode='42501';end if;
 with targets as (
  select 'entity_type'::text kind,e.entity_type_id::text target from app.entity_tags l
   join app.entities e on e.workspace_id=l.workspace_id and e.id=l.entity_id
   where l.workspace_id=app.current_workspace_id() and l.tag_id=p_tag
  union select 'tasks','*' from app.task_tags l where l.workspace_id=app.current_workspace_id() and l.tag_id=p_tag
  union select case when r.task_id is not null then 'tasks' else 'entity_type' end,
   case when r.task_id is not null then '*' else e.entity_type_id::text end
   from app.record_tags l join app.records r on r.workspace_id=l.workspace_id and r.id=l.record_id
   left join app.entities e on e.workspace_id=r.workspace_id and e.id=r.entity_id
   where l.workspace_id=app.current_workspace_id() and l.tag_id=p_tag)
 select coalesce(jsonb_agg(jsonb_build_object('target_kind',kind,'target_id',target,'access','write') order by kind,target),'[]'::jsonb) into required from targets;
 perform app.authorize_workspace(required);
 return required;
end $$;
revoke all on function app.workspace_tag_delete_requirements(text) from public,anon,authenticated,app_worker;
grant execute on function app.workspace_tag_delete_requirements(text) to app_user;
