-- Activation consumes only persisted descriptors/identities before any body.
-- A current actor cannot borrow an earlier coordinator's queued execution.
create function private.authorize_model_activation(p_workspace uuid,p_model uuid,p_actor uuid) returns void
 language plpgsql security definer set search_path='' as $$
declare generation bigint;captured_generation bigint;requirements jsonb;children integer;accepted integer;
begin
 if p_actor is null or p_actor is distinct from auth.uid() or p_workspace is distinct from app.current_workspace_id() then
  raise exception 'workspace_denied' using errcode='42501';end if;
 perform app.lock_workspace_account();
 perform app.authorize_workspace('[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb);
 select w.lifecycle_generation into generation from app.workspaces w where w.id=p_workspace and w.deleted_at is null;
 select g.workspace_generation,coalesce(g.plan->'protected_permissions','[]'::jsonb)
  into captured_generation,requirements from app.data_model_changes g where g.workspace_id=p_workspace and g.id=p_model;
 if generation is null or captured_generation is distinct from generation then
  raise exception 'workspace_denied' using errcode='42501';end if;
 select count(*) into children from app.data_model_children c where c.workspace_id=p_workspace and c.model_id=p_model;
 select count(*) into accepted from app.data_model_children c join app.entity_schema_migrations j
  on j.workspace_id=c.workspace_id and j.id=c.job_id and j.model_change_id=c.model_id and j.change_id=c.change_id and j.type_id=c.type_id
  where c.workspace_id=p_workspace and c.model_id=p_model and j.initiated_by=p_actor
   and j.workspace_generation=generation and j.status='queued' and j.version=1 and j.fence=0;
 if children=0 or accepted<>children then
  raise exception 'model_activation_attempt_invalid' using errcode='23514';end if;
 select requirements||coalesce(jsonb_agg(permission),'[]'::jsonb)
  ||'[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb into requirements
  from app.data_model_children c join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id
   cross join lateral jsonb_array_elements(j.required_permissions) permission
  where c.workspace_id=p_workspace and c.model_id=p_model;
 perform app.authorize_workspace(requirements);
 perform set_config('request.workspace_requirements',
  (coalesce(nullif(current_setting('request.workspace_requirements',true),''),'[]')::jsonb||requirements)::text,true);
end $$;
revoke all on function private.authorize_model_activation(uuid,uuid,uuid) from public,anon,authenticated,app_server,app_worker;
grant execute on function private.authorize_model_activation(uuid,uuid,uuid) to app_user;

create function private.guard_model_activation_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if old.workspace_id is null or current_user<>'app_user' then return new;end if;
 if old.status in ('ready','failed') and new.status='queued' and new.version=old.version+1 then
  perform private.authorize_model_activation(old.workspace_id,old.id,new.initiated_by);
 elsif new.initiated_by is distinct from old.initiated_by then
  raise exception 'model_plan_initiator_immutable' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function private.guard_model_activation_identity() from public,anon,authenticated,app_user,app_server,app_worker;
create trigger guard_model_activation_identity before update on app.data_model_changes
 for each row execute function private.guard_model_activation_identity();
