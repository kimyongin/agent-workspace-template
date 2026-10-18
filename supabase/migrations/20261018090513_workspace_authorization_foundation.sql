-- #512: current workspace authorization. Legacy business rows remain unchanged until #513–#518.
-- Private membership/grant tables have no application DML grants. Explicit helpers own control changes.
alter role app_user nosuperuser nobypassrls;
alter role app_server nosuperuser nobypassrls;
create table app.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);
alter table app.workspaces enable row level security;
create table private.workspace_members (
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  primary key (workspace_id,user_id)
);
-- Only this nullable anchor is transitional. #513 converts kinds, #518 removes all legacy rows/contracts.
alter table app.entity_types add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.entity_types add unique(workspace_id,id);
create table private.workspace_grants (
  workspace_id uuid not null,
  user_id uuid not null,
  target_kind text not null check (target_kind in ('entity_type','tasks','settings')),
  target_id text not null,
  entity_type_id uuid,
  access text not null check (access in ('none','read','write')),
  primary key(workspace_id,user_id,target_kind,target_id),
  foreign key(workspace_id,user_id) references private.workspace_members(workspace_id,user_id) on delete cascade,
  foreign key(workspace_id,entity_type_id) references app.entity_types(workspace_id,id),
  check ((target_kind='entity_type' and entity_type_id is not null and target_id=entity_type_id::text)
    or (target_kind in ('tasks','settings') and target_id='*' and entity_type_id is null))
);
create table private.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  email text not null check (length(email) between 3 and 320 and email=lower(btrim(email))),
  grants jsonb not null check (jsonb_typeof(grants)='array'),
  version integer not null default 1 check (version>0),
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default clock_timestamp()+interval '7 days',
  revoked_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz
);
create unique index workspace_invitations_pending_email on private.workspace_invitations(workspace_id,email)
  where revoked_at is null and accepted_at is null;
create table private.workspace_request_results (
  executor_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references app.workspaces(id) on delete cascade,
  request_key uuid not null,
  operation text not null check (length(operation) between 1 and 100),
  fingerprint text not null check (length(fingerprint)=64),
  footprint jsonb not null default '[]' check (jsonb_typeof(footprint)='array'),
  result_workspace_id uuid references app.workspaces(id) on delete cascade,
  result jsonb,
  completed_at timestamptz,
  unique nulls not distinct(executor_id,workspace_id,request_key)
);
create index workspace_request_results_expiry on private.workspace_request_results(completed_at) where completed_at is not null;
alter table private.workspace_members enable row level security;
alter table private.workspace_grants enable row level security;
alter table private.workspace_invitations enable row level security;
alter table private.workspace_request_results enable row level security;
revoke all on app.workspaces from public,anon,authenticated,app_server,app_worker;
revoke all on private.workspace_members,private.workspace_grants,private.workspace_invitations,private.workspace_request_results
  from public,anon,authenticated,app_user,app_server,app_worker;

create function app.current_workspace_id() returns uuid language sql stable set search_path='' as $$
  select nullif(pg_catalog.current_setting('request.workspace_id',true),'')::uuid
$$;
create function private.workspace_member(p_user uuid,p_workspace uuid,p_allow_deleted boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select p_user is not null and exists(select 1 from auth.users u
    join private.workspace_members m on m.user_id=u.id
    join app.workspaces w on w.id=m.workspace_id
    where u.id=p_user and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) and w.id=p_workspace and (p_allow_deleted or w.deleted_at is null))
$$;
-- Fixed target vocabulary, current state only; settings-write does not imply any other permission.
create function private.workspace_allows(p_user uuid,p_workspace uuid,p_kind text,p_target text,p_access text,p_allow_deleted boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select private.workspace_member(p_user,p_workspace,p_allow_deleted)
    and p_access in ('read','write') and exists (
      select 1 from private.workspace_grants g where g.workspace_id=p_workspace and g.user_id=p_user
      and g.target_kind=p_kind and g.target_id=p_target
      and (g.access='write' or (p_access='read' and g.access='read'))
      and (p_kind<>'entity_type' or exists(select 1 from app.entity_types t where t.id=g.entity_type_id and t.workspace_id=p_workspace)))
$$;
create function app.workspace_allows(p_kind text,p_target text,p_access text)
returns boolean language sql stable security definer set search_path='' as $$
  select private.workspace_allows(auth.uid(),app.current_workspace_id(),p_kind,p_target,p_access)
$$;
-- Policy calls through a current-user wrapper; never expose an arbitrary-user permission oracle.
create function app.is_workspace_member(p_workspace uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.workspace_member(auth.uid(),p_workspace)
$$;
create policy workspaces_member_read on app.workspaces for select to app_user using(app.is_workspace_member(id));
grant select on app.workspaces to app_user;

-- Each call below is its own SQL statement at READ COMMITTED. Acquire account before workspace.
-- Authorization MUST be a subsequent statement after a lock waiter resumes with a new snapshot.
create function app.lock_workspace_account() returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from auth.users where id=auth.uid() and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) for key share;
  if not found then raise exception using errcode='42501',message='request_owner_missing'; end if;
end $$;
create function app.lock_workspace(p_workspace uuid,p_control boolean) returns void language plpgsql security definer set search_path='' as $$
begin
  perform app.lock_workspace_account();
  if p_control and pg_catalog.current_setting('request.workspace_lock_mode',true)='business' then
    raise exception using errcode='22023',message='workspace_lock_upgrade';
  end if;
  if p_control then
    perform 1 from app.workspaces where id=p_workspace for update;
  else
    perform 1 from app.workspaces where id=p_workspace for share;
  end if;
  if not found then raise exception using errcode='42501',message='workspace_denied'; end if;
  perform pg_catalog.set_config('request.workspace_id',p_workspace::text,true);
  if p_control then perform pg_catalog.set_config('request.workspace_lock_mode','control',true);
  elsif coalesce(pg_catalog.current_setting('request.workspace_lock_mode',true),'')<>'control' then
    perform pg_catalog.set_config('request.workspace_lock_mode','business',true);
  end if;
end $$;
create function app.authorize_workspace(p_requirements jsonb) returns void language plpgsql security definer set search_path='' as $$
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
    if not private.workspace_allows(auth.uid(),app.current_workspace_id(),r->>'target_kind',r->>'target_id',r->>'access') then
      raise exception using errcode='42501',message='workspace_denied';
    end if;
  end loop;
end $$;
create function private.workspace_assert_manager() returns void language plpgsql security definer set search_path='' as $$
begin
  perform app.lock_workspace(app.current_workspace_id(),true);
  if not app.workspace_allows('settings','*','write') then
    raise exception using errcode='42501',message='workspace_denied';
  end if;
end $$;
create function private.workspace_assert_admin(p_workspace uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from app.workspaces where id=p_workspace and deleted_at is null)
    and not exists(select 1 from private.workspace_members m join auth.users u on u.id=m.user_id
      join private.workspace_grants g using(workspace_id,user_id)
      where m.workspace_id=p_workspace and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) and g.target_kind='settings' and g.target_id='*' and g.access='write') then
    raise exception using errcode='23514',message='workspace_final_admin';
  end if;
end $$;
create function private.workspace_validate_grants(p_workspace uuid,p_grants jsonb) returns void language plpgsql security definer set search_path='' as $$
declare g jsonb;
begin
  if p_grants is null or jsonb_typeof(p_grants)<>'array' then raise exception using errcode='22023',message='invalid_permissions'; end if;
  if exists(select 1 from jsonb_array_elements(p_grants) x group by x->>'target_kind',x->>'target_id' having count(*)>1) then
    raise exception using errcode='22023',message='invalid_permissions';
  end if;
  for g in select * from jsonb_array_elements(p_grants) loop
    if coalesce(g->>'access','') not in ('none','read','write')
      or coalesce(g->>'target_kind','') not in ('entity_type','tasks','settings')
      or (g->>'target_kind' in ('tasks','settings') and coalesce(g->>'target_id','')<>'*')
      or (g->>'target_kind'='entity_type' and not exists(select 1 from app.entity_types where workspace_id=p_workspace and id::text=g->>'target_id')) then
      raise exception using errcode='22023',message='invalid_permissions';
    end if;
  end loop;
end $$;
create function private.workspace_set_grants(p_workspace uuid,p_user uuid,p_grants jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.workspace_validate_grants(p_workspace,p_grants);
  delete from private.workspace_grants where workspace_id=p_workspace and user_id=p_user;
  insert into private.workspace_grants(workspace_id,user_id,target_kind,target_id,entity_type_id,access)
    select p_workspace,p_user,g->>'target_kind',g->>'target_id',case when g->>'target_kind'='entity_type' then (g->>'target_id')::uuid end,g->>'access'
    from jsonb_array_elements(p_grants) g;
end $$;
create function private.workspace_member_json(p_workspace uuid,p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('user_id',m.user_id,'version',m.version,'grants',coalesce((select jsonb_agg(jsonb_build_object(
    'target_kind',g.target_kind,'target_id',g.target_id,'access',g.access) order by g.target_kind,g.target_id)
    from private.workspace_grants g where g.workspace_id=m.workspace_id and g.user_id=m.user_id),'[]'::jsonb))
    from private.workspace_members m where m.workspace_id=p_workspace and m.user_id=p_user
$$;
create function app.workspace_create(p_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare w app.workspaces%rowtype;
begin
  perform app.lock_workspace_account();
  insert into app.workspaces(name,created_by) values(btrim(p_name),auth.uid()) returning * into w;
  insert into private.workspace_members(workspace_id,user_id) values(w.id,auth.uid());
  perform private.workspace_set_grants(w.id,auth.uid(),'[{"target_kind":"settings","target_id":"*","access":"write"}]');
  return jsonb_build_object('workspace',jsonb_build_object('id',w.id,'name',w.name,'deleted_at',w.deleted_at));
end $$;
create function app.workspace_details() returns jsonb language plpgsql security definer set search_path='' as $$
declare w app.workspaces%rowtype;
begin
  perform app.authorize_workspace('[]');
  select * into strict w from app.workspaces where id=app.current_workspace_id();
  return jsonb_build_object('workspace',jsonb_build_object('id',w.id,'name',w.name,'deleted_at',w.deleted_at),
    'grants',private.workspace_member_json(w.id,auth.uid())->'grants','membership_version',(private.workspace_member_json(w.id,auth.uid())->'version'),'can_manage',app.workspace_allows('settings','*','write'));
end $$;
create function app.workspace_grant_targets() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.workspace_assert_manager();
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'label',v.schema->>'title') order by v.schema->>'title',t.id)
    from app.entity_types t join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version where t.workspace_id=app.current_workspace_id()),'[]'::jsonb));
end $$;
create function app.workspace_members() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.workspace_assert_manager();
  return jsonb_build_object('items',coalesce((select jsonb_agg(private.workspace_member_json(workspace_id,user_id) order by user_id)
    from private.workspace_members where workspace_id=app.current_workspace_id()),'[]'::jsonb));
end $$;
create function app.workspace_update_member(p_user uuid,p_grants jsonb,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.workspace_assert_manager();
  update private.workspace_members set version=version+1 where workspace_id=app.current_workspace_id() and user_id=p_user and version=p_version;
  if not found then raise exception using errcode='P0001',message='workspace_version_conflict'; end if;
  perform private.workspace_set_grants(app.current_workspace_id(),p_user,p_grants);
  perform private.workspace_assert_admin(app.current_workspace_id());
  return jsonb_build_object('member',private.workspace_member_json(app.current_workspace_id(),p_user));
end $$;
create function app.workspace_remove_member(p_user uuid,p_version integer,p_leave boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform app.lock_workspace(app.current_workspace_id(),true);
  if p_leave then
    if p_user is distinct from auth.uid() then raise exception using errcode='42501',message='workspace_denied'; end if;
    perform app.authorize_workspace('[]');
  else perform private.workspace_assert_manager(); end if;
  delete from private.workspace_members where workspace_id=app.current_workspace_id() and user_id=p_user and version=p_version;
  if not found then raise exception using errcode='P0001',message='workspace_version_conflict'; end if;
  perform private.workspace_assert_admin(app.current_workspace_id());
  return case when p_leave then '{"left":true}'::jsonb else '{"removed":true}'::jsonb end;
end $$;
create function private.workspace_invitation_json(i private.workspace_invitations) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',i.id,'workspace_id',i.workspace_id,'version',i.version,'email',i.email,'grants',i.grants,
    'expires_at',i.expires_at,'revoked_at',i.revoked_at,'accepted_by',i.accepted_by,'accepted_at',i.accepted_at)
$$;
create function app.workspace_invitations() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.workspace_assert_manager();
  return jsonb_build_object('items',coalesce((select jsonb_agg(private.workspace_invitation_json(i) order by i.expires_at desc,i.id)
    from private.workspace_invitations i where workspace_id=app.current_workspace_id()),'[]'::jsonb));
end $$;
-- Local delivery is an explicit authenticated acceptance path; no external mail provider or secret token is exposed.
create function app.workspace_invite(p_email text,p_grants jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.workspace_invitations%rowtype;
begin
  perform private.workspace_assert_manager();
  perform private.workspace_validate_grants(app.current_workspace_id(),p_grants);
  update private.workspace_invitations set revoked_at=clock_timestamp(),version=version+1
    where workspace_id=app.current_workspace_id() and email=lower(btrim(p_email)) and accepted_at is null and revoked_at is null and expires_at<=clock_timestamp();
  insert into private.workspace_invitations(workspace_id,email,grants,created_by)
    values(app.current_workspace_id(),lower(btrim(p_email)),p_grants,auth.uid()) returning * into i;
  return jsonb_build_object('invitation',private.workspace_invitation_json(i),'acceptance_path','/invitations/'||i.id::text);
end $$;
create function app.workspace_cancel_invitation(p_invitation uuid,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.workspace_assert_manager();
  update private.workspace_invitations set revoked_at=clock_timestamp(),version=version+1
    where workspace_id=app.current_workspace_id() and id=p_invitation and version=p_version and accepted_at is null and revoked_at is null;
  if not found then raise exception using errcode='P0001',message='workspace_version_conflict'; end if;
  return '{"revoked":true}'::jsonb;
end $$;
-- auth.identities is written by the Auth server/provider callback, unlike editable user_metadata.
-- A password identity or profile claiming Google/email_verified never satisfies this query.
create function private.workspace_google_email_matches(p_email text) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.identities i where i.user_id=auth.uid() and i.provider='google'
    and i.identity_data->'email_verified'='true'::jsonb and lower(btrim(i.identity_data->>'email'))=p_email)
$$;
create function app.workspace_invitation_target(p_invitation uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare i private.workspace_invitations%rowtype;
begin
  select * into i from private.workspace_invitations where id=p_invitation;
  if not found or not private.workspace_google_email_matches(i.email) then raise exception using errcode='42501',message='workspace_denied'; end if;
  return i.workspace_id;
end $$;
create function app.workspace_accept_invitation(p_invitation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.workspace_invitations%rowtype; w app.workspaces%rowtype;
begin
  perform app.lock_workspace(app.current_workspace_id(),true);
  select * into i from private.workspace_invitations where id=p_invitation and workspace_id=app.current_workspace_id() for update;
  if not found or not private.workspace_google_email_matches(i.email) or i.revoked_at is not null or i.expires_at<=clock_timestamp()
    or (i.accepted_at is not null and i.accepted_by is distinct from auth.uid()) then
    raise exception using errcode='42501',message='workspace_denied';
  end if;
  select * into w from app.workspaces where id=i.workspace_id and deleted_at is null;
  if not found then raise exception using errcode='42501',message='workspace_denied'; end if;
  if i.accepted_at is null then
    -- Existing membership never receives a union or overwrite of invitation grants.
    insert into private.workspace_members(workspace_id,user_id) values(i.workspace_id,auth.uid()) on conflict do nothing;
    if found then perform private.workspace_set_grants(i.workspace_id,auth.uid(),i.grants); end if;
    update private.workspace_invitations set accepted_by=auth.uid(),accepted_at=clock_timestamp(),version=version+1 where id=i.id;
  elsif not private.workspace_member(auth.uid(),i.workspace_id) then
    raise exception using errcode='42501',message='workspace_denied';
  end if;
  return jsonb_build_object('workspace',jsonb_build_object('id',w.id,'name',w.name,'deleted_at',w.deleted_at));
end $$;

-- Both normal and retained replay validate the saved minimal footprint BEFORE returning any body.
create function private.workspace_begin_request(p_scope uuid,p_key uuid,p_operation text,p_fingerprint text,p_footprint jsonb,p_retained boolean default false)
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
    if not private.workspace_allows(auth.uid(),coalesce(r.workspace_id,r.result_workspace_id),g->>'target_kind',g->>'target_id',g->>'access') then
      raise exception using errcode='42501',message='workspace_denied';
    end if;
  end loop;
  return jsonb_build_object('state','replay','result',r.result,'completed_at',r.completed_at);
exception when lock_not_available then return '{"state":"request_in_progress"}'::jsonb;
end $$;
create function app.begin_workspace_request(p_key uuid,p_operation text,p_fingerprint text,p_footprint jsonb) returns jsonb language sql security definer set search_path='' as $$
  select private.workspace_begin_request(app.current_workspace_id(),p_key,p_operation,p_fingerprint,p_footprint)
$$;
create function app.replay_retained_workspace_request(p_key uuid,p_operation text,p_fingerprint text,p_footprint jsonb) returns jsonb language sql security definer set search_path='' as $$
  select private.workspace_begin_request(app.current_workspace_id(),p_key,p_operation,p_fingerprint,p_footprint,true)
$$;
create function app.account_workspace_request_target(p_key uuid,p_operation text,p_fingerprint text) returns uuid language sql stable security definer set search_path='' as $$
  select result_workspace_id from private.workspace_request_results where executor_id=auth.uid() and workspace_id is null
    and request_key=p_key and operation=p_operation and fingerprint=p_fingerprint
$$;
create function app.begin_account_workspace_request(p_key uuid,p_operation text,p_fingerprint text) returns jsonb language sql security definer set search_path='' as $$
  select private.workspace_begin_request(null,p_key,p_operation,p_fingerprint,'[]')
$$;
create function app.finish_workspace_request(p_key uuid,p_result jsonb,p_footprint jsonb,p_account boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare v_scope uuid:=case when p_account then null else app.current_workspace_id() end; v_workspace uuid;
begin
  if p_result is null or octet_length(p_result::text)>1048576 then raise exception using errcode='22023',message='request_result_too_large'; end if;
  if jsonb_typeof(p_footprint)<>'array' then raise exception using errcode='22023',message='invalid_permissions'; end if;
  if p_account then
    v_workspace:=(p_result->'workspace'->>'id')::uuid;
    if not private.workspace_member(auth.uid(),v_workspace) then raise exception using errcode='42501',message='workspace_denied'; end if;
  end if;
  update private.workspace_request_results set result=p_result,footprint=p_footprint,result_workspace_id=v_workspace,completed_at=clock_timestamp()
    where executor_id=auth.uid() and workspace_id is not distinct from v_scope and request_key=p_key and completed_at is null;
  if not found then raise exception using errcode='22023',message='request_result_missing'; end if;
end $$;
create or replace function private.expire_request_results() returns void language plpgsql security definer set search_path='' as $$
begin
  delete from private.request_results where completed_at is not null and completed_at<=clock_timestamp()-interval '30 days';
  delete from private.workspace_request_results where completed_at is not null and completed_at<=clock_timestamp()-interval '30 days';
end $$;
-- Default function EXECUTE is PUBLIC even in a private schema: revoke every new helper explicitly.
revoke all on function private.workspace_member(uuid,uuid,boolean),private.workspace_allows(uuid,uuid,text,text,text,boolean),
  private.workspace_assert_manager(),private.workspace_assert_admin(uuid),private.workspace_validate_grants(uuid,jsonb),
  private.workspace_set_grants(uuid,uuid,jsonb),private.workspace_member_json(uuid,uuid),
  private.workspace_invitation_json(private.workspace_invitations),private.workspace_google_email_matches(text),
  private.workspace_begin_request(uuid,uuid,text,text,jsonb,boolean)
  from public,anon,authenticated,app_user,app_server,app_worker;
revoke all on function app.current_workspace_id(),app.workspace_allows(text,text,text),app.is_workspace_member(uuid),
  app.lock_workspace_account(),app.lock_workspace(uuid,boolean),app.authorize_workspace(jsonb),
  app.workspace_create(text),app.workspace_details(),app.workspace_grant_targets(),app.workspace_members(),app.workspace_update_member(uuid,jsonb,integer),
  app.workspace_remove_member(uuid,integer,boolean),app.workspace_invitations(),app.workspace_invite(text,jsonb),
  app.workspace_cancel_invitation(uuid,integer),app.workspace_invitation_target(uuid),app.workspace_accept_invitation(uuid),
  app.begin_workspace_request(uuid,text,text,jsonb),app.replay_retained_workspace_request(uuid,text,text,jsonb),
  app.account_workspace_request_target(uuid,text,text),app.begin_account_workspace_request(uuid,text,text),app.finish_workspace_request(uuid,jsonb,jsonb,boolean)
  from public,anon,authenticated,app_user,app_server,app_worker;
grant execute on function app.current_workspace_id(),app.workspace_allows(text,text,text),app.is_workspace_member(uuid),
  app.lock_workspace_account(),app.lock_workspace(uuid,boolean),app.authorize_workspace(jsonb),
  app.workspace_create(text),app.workspace_details(),app.workspace_grant_targets(),app.workspace_members(),app.workspace_update_member(uuid,jsonb,integer),
  app.workspace_remove_member(uuid,integer,boolean),app.workspace_invitations(),app.workspace_invite(text,jsonb),
  app.workspace_cancel_invitation(uuid,integer),app.workspace_invitation_target(uuid),app.workspace_accept_invitation(uuid),
  app.begin_workspace_request(uuid,text,text,jsonb),app.replay_retained_workspace_request(uuid,text,text,jsonb),
  app.account_workspace_request_target(uuid,text,text),app.begin_account_workspace_request(uuid,text,text),app.finish_workspace_request(uuid,jsonb,jsonb,boolean) to app_user;
