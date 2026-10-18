-- #512 exposes a compound kind anchor before #513 converts the full material model.
-- Restrictive policies prevent the still-present legacy owner policy from OR-allowing
-- newly scoped kind rows across workspaces. NULL rows are integration-only #513/#518 work.
create policy entity_type_workspace_read on app.entity_types as restrictive for select to app_user
  using(workspace_id is null or (workspace_id=app.current_workspace_id()
    and (app.workspace_allows('settings','*','read') or app.workspace_allows('entity_type',id::text,'read'))));
create policy entity_type_workspace_insert on app.entity_types as restrictive for insert to app_user
  with check(workspace_id is null or (workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write')));
create policy entity_type_workspace_update on app.entity_types as restrictive for update to app_user
  using(workspace_id is null or (workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write')))
  with check(workspace_id is null or (workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write')));
create policy entity_type_workspace_delete on app.entity_types as restrictive for delete to app_user
  using(workspace_id is null or (workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write')));

-- Profile metadata is decorative untrusted presentation only. Never expose an Auth email
-- or consult this label when authorizing a membership, invitation or permission.
create or replace function private.workspace_member_json(p_workspace uuid,p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('user_id',m.user_id,'version',m.version,
    'display_name',left(coalesce(
      case when jsonb_typeof(u.raw_user_meta_data->'full_name')='string' then nullif(btrim(regexp_replace(u.raw_user_meta_data->>'full_name','[[:cntrl:]]',' ','g')),'') end,
      case when jsonb_typeof(u.raw_user_meta_data->'name')='string' then nullif(btrim(regexp_replace(u.raw_user_meta_data->>'name','[[:cntrl:]]',' ','g')),'') end),100),
    'grants',coalesce((select jsonb_agg(jsonb_build_object('target_kind',g.target_kind,'target_id',g.target_id,'access',g.access) order by g.target_kind,g.target_id)
      from private.workspace_grants g where g.workspace_id=m.workspace_id and g.user_id=m.user_id),'[]'::jsonb))
    from private.workspace_members m join auth.users u on u.id=m.user_id where m.workspace_id=p_workspace and m.user_id=p_user
$$;
