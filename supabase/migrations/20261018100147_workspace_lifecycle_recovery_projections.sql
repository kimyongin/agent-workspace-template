create function private.workspace_lifecycle_json(w app.workspaces) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',w.id,'name',w.name,'deleted_at',w.deleted_at,
    'lifecycle_generation',w.lifecycle_generation)
$$;
create function app.workspace_lifecycle_details() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app.authorize_workspace_lifecycle();
  return (select jsonb_build_object('workspace',private.workspace_lifecycle_json(w))
    from app.workspaces w where w.id=app.current_workspace_id());
end $$;
create function app.deleted_workspaces() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app.lock_workspace_account();
  return jsonb_build_object('items',coalesce((select jsonb_agg(private.workspace_lifecycle_json(w) order by w.name,w.id)
    from app.workspaces w where w.deleted_at is not null
      and private.workspace_allows(auth.uid(),w.id,'settings','*','write',true)), '[]'::jsonb));
end $$;

-- This is a separate narrow recovery route, never an allow-deleted option on the
-- normal business ledger. Authorization happens before reading any receipt body.
create function app.begin_workspace_lifecycle_request(p_key uuid,p_operation text,p_fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.workspace_request_results%rowtype;
begin
  perform app.authorize_workspace_lifecycle();
  if p_operation not in ('workspace.delete','workspace.restore') or p_operation is null then
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

create function app.workspace_generation() returns bigint
language plpgsql security definer set search_path='' as $$
begin
  perform app.authorize_workspace('[]');
  return (select lifecycle_generation from app.workspaces where id=app.current_workspace_id());
end $$;
create function app.workspace_author() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app.authorize_workspace('[]');
  return (select jsonb_build_object('created_by',u.id,'created_by_name',left(coalesce(
    case when jsonb_typeof(u.raw_user_meta_data->'full_name')='string' then nullif(btrim(regexp_replace(u.raw_user_meta_data->>'full_name','[[:cntrl:]]',' ','g')),'') end,
    case when jsonb_typeof(u.raw_user_meta_data->'name')='string' then nullif(btrim(regexp_replace(u.raw_user_meta_data->>'name','[[:cntrl:]]',' ','g')),'') end),100))
    from auth.users u where u.id=auth.uid());
end $$;
revoke all on function private.workspace_lifecycle_json(app.workspaces),app.workspace_lifecycle_details(),app.deleted_workspaces(),
  app.begin_workspace_lifecycle_request(uuid,text,text),app.workspace_generation(),app.workspace_author()
  from public,anon,authenticated,app_user,app_server,app_worker;
grant execute on function app.workspace_lifecycle_details(),app.deleted_workspaces(),
  app.begin_workspace_lifecycle_request(uuid,text,text),app.workspace_generation(),app.workspace_author() to app_user;
