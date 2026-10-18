-- A restored workspace is a new execution generation. Old worker responses must
-- compare their captured generation before publishing any derived state.
alter table app.workspaces add column lifecycle_generation bigint not null default 1
  check(lifecycle_generation>0);

create function app.authorize_workspace_lifecycle() returns void
language plpgsql security definer set search_path='' as $$
begin
  perform app.lock_workspace(app.current_workspace_id(),true);
  if private.workspace_allows(auth.uid(),app.current_workspace_id(),'settings','*','write',true) is not true then
    raise exception using errcode='42501',message='workspace_denied';
  end if;
end $$;

create function app.workspace_set_deleted(p_generation bigint,p_deleted boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w app.workspaces%rowtype;
begin
  perform app.authorize_workspace_lifecycle();
  if p_deleted is null then raise exception using errcode='22023',message='workspace_lifecycle_input'; end if;
  update app.workspaces set deleted_at=case when p_deleted then clock_timestamp() else null end,
    lifecycle_generation=lifecycle_generation+1
    where id=app.current_workspace_id() and lifecycle_generation=p_generation
      and ((p_deleted and deleted_at is null) or (not p_deleted and deleted_at is not null))
    returning * into w;
  if not found then raise exception using errcode='P0001',message='workspace_lifecycle_conflict'; end if;
  perform private.workspace_assert_admin(w.id);
  if p_deleted then
    -- Preserve the outbox facts and ambiguity, but revoke every old lease. A
    -- restore never turns pre-delete deliveries back into executable requests.
    update private.workspace_invitation_deliveries set status='cancelled',
      ambiguous=ambiguous or (status='running' and started_in_lease),
      fence=null,lease_until=null,updated_at=clock_timestamp()
      where workspace_id=w.id and status<>'sent';
  end if;
  return jsonb_build_object('workspace',jsonb_build_object('id',w.id,'name',w.name,
    'deleted_at',w.deleted_at,'lifecycle_generation',w.lifecycle_generation));
end $$;

revoke all on function app.authorize_workspace_lifecycle(),app.workspace_set_deleted(bigint,boolean)
  from public,anon,authenticated,app_user,app_server,app_worker;
grant execute on function app.authorize_workspace_lifecycle(),app.workspace_set_deleted(bigint,boolean) to app_user;
