-- The original manager requirement survives every receipt route, including a
-- normal/retained replay after restoration. The finish boundary cannot weaken it.
update private.workspace_request_results set footprint='[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb
  where workspace_id is not null and operation in ('workspace.delete','workspace.restore');

create or replace function app.begin_workspace_lifecycle_request(p_key uuid,p_operation text,p_fingerprint text) returns jsonb
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
    insert into private.workspace_request_results(executor_id,workspace_id,request_key,operation,fingerprint,footprint)
      values(auth.uid(),app.current_workspace_id(),p_key,p_operation,p_fingerprint,'[ {"target_kind":"settings","target_id":"*","access":"write"} ]'::jsonb) returning * into r;
    return '{"state":"new"}'::jsonb;
  end if;
  if r.operation<>p_operation or r.fingerprint<>p_fingerprint then return '{"state":"idempotency_key_reused"}'::jsonb; end if;
  if r.completed_at is null then return '{"state":"request_in_progress"}'::jsonb; end if;
  if r.result is null or r.completed_at+interval '30 days'<=clock_timestamp() then return '{"state":"result_expired"}'::jsonb; end if;
  return jsonb_build_object('state','replay','result',r.result,'completed_at',r.completed_at);
end $$;


create or replace function app.finish_workspace_request(p_key uuid,p_result jsonb,p_footprint jsonb,p_account boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare v_scope uuid:=case when p_account then null else app.current_workspace_id() end; v_workspace uuid;
begin
  if p_result is null or octet_length(p_result::text)>1048576 then raise exception using errcode='22023',message='request_result_too_large'; end if;
  if jsonb_typeof(p_footprint)<>'array' then raise exception using errcode='22023',message='invalid_permissions'; end if;
  if p_account then
    v_workspace:=(p_result->'workspace'->>'id')::uuid;
    if not private.workspace_member(auth.uid(),v_workspace) then raise exception using errcode='42501',message='workspace_denied'; end if;
  end if;
  update private.workspace_request_results set result=p_result,footprint=case when workspace_id is not null and operation in ('workspace.delete','workspace.restore') then '[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb else p_footprint end,result_workspace_id=v_workspace,completed_at=clock_timestamp()
    where executor_id=auth.uid() and workspace_id is not distinct from v_scope and request_key=p_key and completed_at is null;
  if not found then raise exception using errcode='22023',message='request_result_missing'; end if;
end $$;
