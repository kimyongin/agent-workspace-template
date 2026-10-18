-- Tag dictionary fan-out can touch task links/version without gaining general
-- task UPDATE or selecting protected entity_ids/entity_context captures.
create function app.workspace_task_tag_target(p_task text,p_touch boolean default false) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare target jsonb;
begin
 if p_touch is null then raise exception 'invalid_tag_target' using errcode='22023';end if;
 perform app.authorize_workspace('[{"target_kind":"tasks","target_id":"*","access":"write"}]'::jsonb);
 perform 1 from app.tasks where workspace_id=app.current_workspace_id() and id=p_task for update;
 if not found then return null;end if;
 if p_touch then
  update app.tasks set version=version+1,updated_at=now() where workspace_id=app.current_workspace_id() and id=p_task;
 end if;
 select to_jsonb(visible) into target from (
  select id,kind,title,body,due_on::text as due_on,recurrence,timezone,status,completed_at,result_record_id,pauses,version,created_at,updated_at
  from app.tasks where workspace_id=app.current_workspace_id() and id=p_task
 ) visible;
 return target||jsonb_build_object('tag_ids',coalesce((select jsonb_agg(tag_id order by tag_id) from app.task_tags
  where workspace_id=app.current_workspace_id() and task_id=p_task),'[]'::jsonb));
end $$;
revoke all on function app.workspace_task_tag_target(text,boolean) from public,anon,authenticated,app_worker;
grant execute on function app.workspace_task_tag_target(text,boolean) to app_user;
