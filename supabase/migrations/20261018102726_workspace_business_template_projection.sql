-- The shared configuration reader remains settings-only. Business operations use
-- this target/action projection after current permission, without receiving other
-- kinds' templates or unrelated actions.
alter table app.tasks add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.tasks add constraint task_workspace_key unique(workspace_id,id);
create policy task_workspace_scope on app.tasks as restrictive for all to app_user
 using(workspace_id is null or (workspace_id=app.current_workspace_id() and app.workspace_allows('tasks','*','read')))
 with check(workspace_id is null or (workspace_id=app.current_workspace_id() and app.workspace_allows('tasks','*','write')));
create trigger workspace_business_anchor before update on app.tasks for each row execute function private.guard_workspace_business_anchor();

create function app.workspace_business_template(p_model text,p_action text,p_target text,p_type uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare v_type uuid;v_version bigint:=0;v_templates jsonb:='{}'::jsonb;v_value jsonb;v_projection jsonb:='{}'::jsonb;
begin
 perform app.lock_workspace(app.current_workspace_id(),false);
 if p_model is null or p_model not in ('entity','task') or p_action is null
  or (p_model='entity' and p_action not in ('create','update','delete','restore'))
  or (p_model='task' and p_action not in ('create','update','delete','stop','resume')) then
  raise exception 'invalid_preparation_target' using errcode='22023';
 end if;
 if p_model='entity' then
  if p_action='create' then v_type:=p_type;
  else
   -- Only affiliation is resolved before authorization. No protected values or
   -- captured context are read until the actual stored kind has been checked.
   select e.entity_type_id into v_type from app.entities e where e.workspace_id=app.current_workspace_id() and e.id=p_target;
  end if;
  if v_type is null then raise exception 'workspace_denied' using errcode='42501';end if;
  perform app.authorize_workspace(jsonb_build_array(jsonb_build_object('target_kind','entity_type','target_id',v_type::text,'access','write')));
 else
  perform app.authorize_workspace('[{"target_kind":"tasks","target_id":"*","access":"write"}]'::jsonb);
  if p_action<>'create' and not exists(select 1 from app.tasks t where t.workspace_id=app.current_workspace_id() and t.id=p_target) then
   raise exception 'preparation_target_missing' using errcode='23503';
  end if;
 end if;
 select s.version,s.settings into v_version,v_templates from app.user_business_settings s
  where s.workspace_id=app.current_workspace_id() and s.id='record_templates';
 v_version:=coalesce(v_version,0);v_templates:=coalesce(v_templates,'{}'::jsonb);
 v_value:=case when p_model='task' then v_templates#>array['task',p_action]
  else v_templates#>array['entity_types',v_type::text,p_action] end;
 if v_value is not null and v_value<>'null'::jsonb then
  v_projection:=case when p_model='task' then jsonb_build_object('task',jsonb_build_object(p_action,v_value))
   else jsonb_build_object('entity_types',jsonb_build_object(v_type::text,jsonb_build_object(p_action,v_value))) end;
 end if;
 return jsonb_build_object('versions',jsonb_build_object('record_templates',v_version),
  'settings',jsonb_build_object('record_templates',v_projection));
end $$;
revoke all on function app.workspace_business_template(text,text,text,uuid) from public,anon,authenticated,app_worker;
grant execute on function app.workspace_business_template(text,text,text,uuid) to app_user;
