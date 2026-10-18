-- A private transaction-local context identifies a stored group; it is never
-- sufficient authority without the live executor/generation/permission check.
create function private.authorize_model_publication_requirements(p_workspace uuid,p_requirements jsonb)
 returns void language plpgsql security definer set search_path='' as $$
declare model uuid;job uuid;executor uuid;captured jsonb;
begin
 if p_workspace is null or p_workspace is distinct from app.current_workspace_id() then
  raise exception 'workspace_denied' using errcode='42501';end if;
 select c.model_id into model from private.data_model_commit_context c
  where c.workspace_id=p_workspace and c.pid=pg_backend_pid() and c.txid=txid_current();
 if not found then
  select c.job_id into job from private.schema_job_commit_context c
   where c.workspace_id=p_workspace and c.pid=pg_backend_pid() and c.txid=txid_current();
  if not found then
   perform app.lock_workspace_account();
   perform app.authorize_workspace(p_requirements);
   return;
  end if;
  if (select count(*) from private.schema_job_commit_context c where c.workspace_id=p_workspace
    and c.pid=pg_backend_pid() and c.txid=txid_current())<>1 or not private.authorize_schema_job(p_workspace,job) then
   raise exception 'workspace_denied' using errcode='42501';end if;
  select j.initiated_by,j.required_permissions into executor,captured from app.entity_schema_migrations j
   where j.workspace_id=p_workspace and j.id=job;
 else
  if not private.authorize_schema_group(p_workspace,model) then
   raise exception 'workspace_denied' using errcode='42501';end if;
  select g.initiated_by into executor from app.data_model_changes g where g.workspace_id=p_workspace and g.id=model;
  select coalesce(jsonb_agg(permission),'[]'::jsonb) into captured from app.data_model_children c
   join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id
   cross join lateral jsonb_array_elements(j.required_permissions) permission
   where c.workspace_id=p_workspace and c.model_id=model;
 end if;
 if not private.schema_permissions_allow(executor,p_workspace,p_requirements) then
  raise exception 'workspace_denied' using errcode='42501';end if;
 if exists(select 1 from jsonb_array_elements(p_requirements) requested where requested->>'target_kind'<>'settings'
  and not exists(select 1 from jsonb_array_elements(captured) saved
   where saved->>'target_kind'=requested->>'target_kind' and saved->>'target_id'=requested->>'target_id'
    and (saved->>'access'='write' or saved->>'access'=requested->>'access'))) then
  raise exception 'model_publication_requirement_not_captured' using errcode='42501';end if;
end $$;
revoke all on function private.authorize_model_publication_requirements(uuid,jsonb) from public,anon,authenticated,app_server,app_worker;
grant execute on function private.authorize_model_publication_requirements(uuid,jsonb) to app_user;

create function private.assert_model_publication_plan(p_workspace uuid,p_plan jsonb) returns void
 language plpgsql security definer set search_path='' as $$
declare model uuid;
begin
 select c.model_id into model from private.data_model_commit_context c
  where c.workspace_id=p_workspace and c.pid=pg_backend_pid() and c.txid=txid_current();
 if found and not exists(select 1 from app.data_model_changes g where g.workspace_id=p_workspace and g.id=model and g.plan=p_plan) then
  raise exception 'model_publication_plan_mismatch' using errcode='23514';end if;
 if model is null and exists(select 1 from private.schema_job_commit_context c where c.workspace_id=p_workspace
   and c.pid=pg_backend_pid() and c.txid=txid_current()) then
  raise exception 'standalone_job_has_no_model_plan' using errcode='42501';end if;
end $$;
revoke all on function private.assert_model_publication_plan(uuid,jsonb) from public,anon,authenticated,app_server,app_worker;
grant execute on function private.assert_model_publication_plan(uuid,jsonb) to app_user;

-- Preserve the complete existing immutable/version/FK publication checks. Only
-- replace their authorization entry; refuse unexpected source instead of guessing.
do $$
declare definition text;before text;after text;signature regprocedure;
 settings_check text:='perform app.authorize_workspace(''[{"target_kind":"settings","target_id":"*","access":"write"}]''::jsonb);';
begin
 signature:='private.authorize_workspace_model_kinds(uuid[])'::regprocedure;
 select pg_get_functiondef(signature) into definition;
 before:='perform app.authorize_workspace(requirements);';
 after:='perform private.authorize_model_publication_requirements(app.current_workspace_id(),requirements);';
 if strpos(definition,before)=0 then raise exception 'unexpected_model_kind_authorizer';end if;
 execute replace(definition,before,after);

 signature:='private.publish_prepared_model_definitions(uuid,jsonb,uuid[])'::regprocedure;
 select pg_get_functiondef(signature) into definition;
 after:='perform private.authorize_model_publication_requirements(p_owner,''[{"target_kind":"settings","target_id":"*","access":"write"}]''::jsonb);'
  ||E'\n perform private.assert_model_publication_plan(p_owner,p_plan);';
 if strpos(definition,settings_check)=0 then raise exception 'unexpected_model_definition_publisher';end if;
 execute replace(definition,settings_check,after);

 signature:='app.guard_entity_relation_definition_kinds()'::regprocedure;
 select pg_get_functiondef(signature) into definition;
 after:='perform private.authorize_model_publication_requirements(new.workspace_id,''[{"target_kind":"settings","target_id":"*","access":"write"}]''::jsonb);';
 if strpos(definition,settings_check)=0 then raise exception 'unexpected_model_relation_guard';end if;
 execute replace(definition,settings_check,after);

 signature:='app.publish_data_model_relation(uuid,integer,jsonb,boolean)'::regprocedure;
 select pg_get_functiondef(signature) into definition;
 before:=E'perform app.lock_workspace_account();\n perform app.lock_workspace(v_owner,false);\n '||settings_check;
 after:='perform private.authorize_model_publication_requirements(v_owner,''[{"target_kind":"settings","target_id":"*","access":"write"}]''::jsonb);';
 if strpos(definition,before)=0 then raise exception 'unexpected_model_relation_publisher';end if;
 execute replace(definition,before,after);
end $$;
