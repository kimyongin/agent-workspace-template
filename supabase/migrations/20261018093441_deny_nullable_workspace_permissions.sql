-- A malformed descriptor is denied, including SQL NULL. Do not rely on IF NOT NULL.
create or replace function private.workspace_allows(p_user uuid,p_workspace uuid,p_kind text,p_target text,p_access text,p_allow_deleted boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(private.workspace_member(p_user,p_workspace,p_allow_deleted)
    and p_access in ('read','write') and exists (
      select 1 from private.workspace_grants g where g.workspace_id=p_workspace and g.user_id=p_user
      and g.target_kind=p_kind and g.target_id=p_target
      and (g.access='write' or (p_access='read' and g.access='read'))
      and (p_kind<>'entity_type' or exists(select 1 from app.entity_types t where t.id=g.entity_type_id and t.workspace_id=p_workspace))),false)
$$;

create or replace function app.authorize_workspace(p_requirements jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
  perform app.lock_workspace(app.current_workspace_id(),false);
  if not private.workspace_member(auth.uid(),app.current_workspace_id()) then
    raise exception using errcode='42501',message='workspace_denied';
  end if;
  if p_requirements is null or jsonb_typeof(p_requirements)<>'array' then
    raise exception using errcode='22023',message='invalid_permissions';
  end if;
  for r in select * from jsonb_array_elements(p_requirements) loop
    if private.workspace_allows(auth.uid(),app.current_workspace_id(),r->>'target_kind',r->>'target_id',r->>'access') is not true then
      raise exception using errcode='42501',message='workspace_denied';
    end if;
  end loop;
end $$;

create or replace function private.workspace_begin_request(p_scope uuid,p_key uuid,p_operation text,p_fingerprint text,p_footprint jsonb,p_retained boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.workspace_request_results%rowtype; g jsonb;
begin
  if not exists(select 1 from auth.users where id=auth.uid() and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp())) then raise exception using errcode='42501',message='request_owner_missing'; end if;
  if p_scope is not null then perform app.authorize_workspace(p_footprint);
  elsif p_operation not in ('workspace.create','workspace.invitation.accept') then raise exception using errcode='42501',message='workspace_denied'; end if;
  select * into r from private.workspace_request_results where executor_id=auth.uid() and workspace_id is not distinct from p_scope and request_key=p_key;
  if not found and p_retained then return '{"state":"missing"}'::jsonb; end if;
  if not found then
    perform pg_catalog.set_config('lock_timeout','2s',true);
    insert into private.workspace_request_results(executor_id,workspace_id,request_key,operation,fingerprint,footprint)
      values(auth.uid(),p_scope,p_key,p_operation,p_fingerprint,p_footprint) on conflict do nothing;
    if found then return '{"state":"new"}'::jsonb; end if;
    select * into r from private.workspace_request_results where executor_id=auth.uid() and workspace_id is not distinct from p_scope and request_key=p_key;
  end if;
  if r.operation<>p_operation or r.fingerprint<>p_fingerprint then return '{"state":"idempotency_key_reused"}'::jsonb; end if;
  if r.completed_at is null then return '{"state":"request_in_progress"}'::jsonb; end if;
  if r.result is null or r.completed_at+interval '30 days'<=clock_timestamp() then return '{"state":"result_expired"}'::jsonb; end if;
  -- A competing bootstrap insertion may have completed after the metadata preflight.
  -- Return only its workspace descriptor, then require a separate lock statement before replay body.
  if p_scope is null and (app.current_workspace_id() is distinct from r.result_workspace_id
    or coalesce(pg_catalog.current_setting('request.workspace_lock_mode',true),'')='') then
    return jsonb_build_object('state','workspace_lock_required','workspace_id',r.result_workspace_id);
  end if;
  if not private.workspace_member(auth.uid(),coalesce(r.workspace_id,r.result_workspace_id)) then raise exception using errcode='42501',message='workspace_denied'; end if;
  for g in select * from jsonb_array_elements(r.footprint) loop
    if private.workspace_allows(auth.uid(),coalesce(r.workspace_id,r.result_workspace_id),g->>'target_kind',g->>'target_id',g->>'access') is not true then
      raise exception using errcode='42501',message='workspace_denied';
    end if;
  end loop;
  return jsonb_build_object('state','replay','result',r.result,'completed_at',r.completed_at);
exception when lock_not_available then return '{"state":"request_in_progress"}'::jsonb;
end $$;
