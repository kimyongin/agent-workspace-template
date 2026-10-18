-- Leaving a deleted workspace is a member-only control operation. It does not
-- permit business reads, permission changes or restoration of a managerless space.
create function app.authorize_workspace_membership() returns void
language plpgsql security definer set search_path='' as $$
begin
  perform app.lock_workspace(app.current_workspace_id(),true);
  if private.workspace_member(auth.uid(),app.current_workspace_id(),true) is not true then
    raise exception using errcode='42501',message='workspace_denied';
  end if;
end $$;
create function app.workspace_membership_details() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app.authorize_workspace_membership();
  return (select jsonb_build_object('workspace',jsonb_build_object('id',w.id,'name',w.name,'deleted_at',w.deleted_at),
    'membership_version',m.version) from app.workspaces w join private.workspace_members m on m.workspace_id=w.id
    where w.id=app.current_workspace_id() and m.user_id=auth.uid());
end $$;

create function app.begin_workspace_membership_request(p_key uuid,p_operation text,p_fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.workspace_request_results%rowtype;
begin
  perform app.authorize_workspace_membership();
  if p_operation<>'workspace.leave' or p_operation is null then
    raise exception using errcode='42501',message='workspace_denied';
  end if;
  select * into r from private.workspace_request_results where executor_id=auth.uid()
    and workspace_id=app.current_workspace_id() and request_key=p_key;
  if not found then
    insert into private.workspace_request_results(executor_id,workspace_id,request_key,operation,fingerprint)
      values(auth.uid(),app.current_workspace_id(),p_key,p_operation,p_fingerprint) returning * into r;
    return '{"state":"new"}'::jsonb;
  end if;
  if r.operation<>p_operation or r.fingerprint<>p_fingerprint then return '{"state":"idempotency_key_reused"}'::jsonb; end if;
  if r.completed_at is null then return '{"state":"request_in_progress"}'::jsonb; end if;
  if r.result is null or r.completed_at+interval '30 days'<=clock_timestamp() then return '{"state":"result_expired"}'::jsonb; end if;
  return jsonb_build_object('state','replay','result',r.result,'completed_at',r.completed_at);
end $$;


create or replace function app.workspace_remove_member(p_user uuid,p_version integer,p_leave boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform app.lock_workspace(app.current_workspace_id(),true);
  if p_leave then
    if p_user is distinct from auth.uid() then raise exception using errcode='42501',message='workspace_denied'; end if;
    perform app.authorize_workspace_membership();
  else perform private.workspace_assert_manager(); end if;
  delete from private.workspace_members where workspace_id=app.current_workspace_id() and user_id=p_user and version=p_version;
  if not found then raise exception using errcode='P0001',message='workspace_version_conflict'; end if;
  perform private.workspace_assert_admin(app.current_workspace_id());
  return case when p_leave then '{"left":true}'::jsonb else '{"removed":true}'::jsonb end;
end $$;

revoke all on function app.authorize_workspace_membership(),app.workspace_membership_details(),
  app.begin_workspace_membership_request(uuid,text,text) from public,anon,authenticated,app_user,app_server,app_worker;
grant execute on function app.authorize_workspace_membership(),app.workspace_membership_details(),
  app.begin_workspace_membership_request(uuid,text,text) to app_user;
