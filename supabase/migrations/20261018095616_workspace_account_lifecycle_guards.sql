-- Auth mutations and ordinary application entry share an account -> workspace order.
-- SHARE conflicts with non-key Auth soft deletion/ban updates; KEY SHARE did not.
create or replace function app.lock_workspace_account() returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from auth.users where id=auth.uid() and deleted_at is null
    and (banned_until is null or banned_until<=clock_timestamp()) for share;
  if not found then raise exception using errcode='42501',message='request_owner_missing'; end if;
end $$;

-- Provider account deletion is outside our transaction. This guard therefore lives
-- at the actual Auth mutation, not only at an application preflight.
create function private.protect_workspace_admin_on_auth_invalidation() returns trigger
language plpgsql security definer set search_path='' as $$
declare workspace uuid;
begin
  if tg_op='UPDATE' and new.deleted_at is null
    and (new.banned_until is null or new.banned_until<=clock_timestamp()) then return new; end if;
  -- Lock the whole affected set first, in a consistent order. Every SELECT below
  -- is a fresh READ COMMITTED statement after a possible workspace lock wait.
  for workspace in select m.workspace_id from private.workspace_members m
    where m.user_id=old.id order by m.workspace_id loop
    perform 1 from app.workspaces w where w.id=workspace for update;
  end loop;
  for workspace in select m.workspace_id from private.workspace_members m
    join app.workspaces w on w.id=m.workspace_id
    where m.user_id=old.id and w.deleted_at is null order by m.workspace_id loop
    if not exists(select 1 from private.workspace_members m
      join auth.users u on u.id=m.user_id
      join private.workspace_grants g using(workspace_id,user_id)
      where m.workspace_id=workspace and u.id<>old.id and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<=clock_timestamp())
        and g.target_kind='settings' and g.target_id='*' and g.access='write') then
      raise exception using errcode='23514',message='workspace_final_admin';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.protect_workspace_admin_on_auth_invalidation()
  from public,anon,authenticated,app_user,app_server,app_worker;
create trigger protect_workspace_admin_before_auth_delete before delete on auth.users
  for each row execute function private.protect_workspace_admin_on_auth_invalidation();
create trigger protect_workspace_admin_before_auth_invalidation before update of deleted_at,banned_until on auth.users
  for each row execute function private.protect_workspace_admin_on_auth_invalidation();
