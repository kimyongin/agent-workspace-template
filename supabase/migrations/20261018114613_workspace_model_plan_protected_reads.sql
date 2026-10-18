-- Protected review facts retain their original trusted authorization footprint.
create function private.keep_model_plan_permissions() returns trigger
 language plpgsql set search_path='' as $$
begin
 if old.workspace_id is not null and (
   old.plan->'protected_permissions' is distinct from new.plan->'protected_permissions'
   or old.plan->'protected_kind_ids' is distinct from new.plan->'protected_kind_ids') then
  raise exception 'model_plan_permissions_immutable' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function private.keep_model_plan_permissions() from public,anon,authenticated,app_user,app_server,app_worker;
create trigger keep_model_plan_permissions before update on app.data_model_changes
 for each row execute function private.keep_model_plan_permissions();

drop policy workspace_model_plan_read on app.data_model_changes;
create policy workspace_model_plan_read on app.data_model_changes for select to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read')
  and app.workspace_schema_permissions_allow(coalesce(plan->'protected_permissions',
    (select jsonb_agg(jsonb_build_object('target_kind','entity_type','target_id',k.value,'access','read'))
      from jsonb_array_elements_text(plan->'protected_kind_ids') k(value)),'[]'::jsonb),true));
-- FOR ALL would permissively authorize SELECT and bypass the protected read policy.
drop policy workspace_model_plan_write on app.data_model_changes;
create policy workspace_model_plan_insert on app.data_model_changes for insert to app_user
 with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write'));
create policy workspace_model_plan_update on app.data_model_changes for update to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write'))
 with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write'));

-- Only permission descriptors are available before authorization, never review facts.
-- This preserves explicit forbidden history responses and coherent page boundaries.
create function app.workspace_model_plan_headers(p_id uuid default null,p_after uuid default null,p_limit integer default 101)
 returns table(id uuid,requirements jsonb) language plpgsql security definer set search_path='' as $$
begin
 perform app.authorize_workspace('[{"target_kind":"settings","target_id":"*","access":"read"}]'::jsonb);
 if p_limit is null or p_limit<1 or p_limit>101 then raise exception 'invalid_model_history_limit' using errcode='22023';end if;
 return query select c.id,coalesce(c.plan->'protected_permissions',
  (select jsonb_agg(jsonb_build_object('target_kind','entity_type','target_id',k.value,'access','read'))
    from jsonb_array_elements_text(c.plan->'protected_kind_ids') k(value)),'[]'::jsonb)
 from app.data_model_changes c where c.workspace_id=app.current_workspace_id()
  and (p_id is null or c.id=p_id) and (p_after is null or c.id>p_after)
 order by c.id limit p_limit;
end $$;
revoke all on function app.workspace_model_plan_headers(uuid,uuid,integer) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.workspace_model_plan_headers(uuid,uuid,integer) to app_user;
