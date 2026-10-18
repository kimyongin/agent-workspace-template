-- Forward-only hook: the already applied #512 foundation remains independently reviewable.
create or replace function private.workspace_invitation_json(i private.workspace_invitations) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',i.id,'workspace_id',i.workspace_id,'version',i.version,'email',i.email,'grants',i.grants,
    'expires_at',i.expires_at,'revoked_at',i.revoked_at,'accepted_by',i.accepted_by,'accepted_at',i.accepted_at,
    'delivery',jsonb_build_object('status',private.workspace_invitation_delivery_status(i.id)))
$$;
create or replace function app.workspace_invite(p_email text,p_grants jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.workspace_invitations%rowtype;
begin
  perform private.workspace_assert_manager();
  perform private.workspace_validate_grants(app.current_workspace_id(),p_grants);
  update private.workspace_invitations set revoked_at=clock_timestamp(),version=version+1
    where workspace_id=app.current_workspace_id() and email=lower(btrim(p_email)) and accepted_at is null and revoked_at is null and expires_at<=clock_timestamp();
  insert into private.workspace_invitations(workspace_id,email,grants,created_by)
    values(app.current_workspace_id(),lower(btrim(p_email)),p_grants,auth.uid()) returning * into i;
  perform private.enqueue_workspace_invitation_delivery(i.id);
  return jsonb_build_object('invitation',private.workspace_invitation_json(i),'acceptance_path','/invitations/'||i.id::text);
end $$;
create function app.workspace_retry_invitation_delivery(p_invitation uuid,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.workspace_assert_manager();
  if not exists(select 1 from private.workspace_invitations where workspace_id=app.current_workspace_id() and id=p_invitation and version=p_version) then
    raise exception using errcode='P0001',message='workspace_version_conflict';
  end if;
  return jsonb_build_object('delivery',jsonb_build_object('status',private.retry_workspace_invitation_delivery(p_invitation)));
end $$;
revoke all on function app.workspace_retry_invitation_delivery(uuid,integer) from public,anon,authenticated,app_user,app_server,app_worker;
grant execute on function app.workspace_retry_invitation_delivery(uuid,integer) to app_user;
