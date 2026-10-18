-- A current-user capability projection for active-space selection. It is not an
-- arbitrary-user permission oracle and does not expose deleted-space metadata.
create function app.can_manage_workspace(p_workspace uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.workspace_allows(auth.uid(),p_workspace,'settings','*','write')
$$;
revoke all on function app.can_manage_workspace(uuid) from public,anon,authenticated,app_user,app_server,app_worker;
grant execute on function app.can_manage_workspace(uuid) to app_user;
