-- Private outbox: invitation creation and its immutable message snapshot commit together.
-- Worker transitions inspect real initiator state without manufacturing request.jwt.claims.
create table private.workspace_invitation_deliveries (
  invitation_id uuid primary key references private.workspace_invitations(id) on delete cascade,
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  initiator_id uuid references auth.users(id) on delete set null,
  message jsonb not null,
  status text not null default 'pending' check(status in ('pending','running','sent','failed','unknown','unconfigured','cancelled')),
  fence uuid,
  lease_until timestamptz,
  prepared jsonb,
  first_send_at timestamptz,
  ambiguous boolean not null default false,
  started_in_lease boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
alter table private.workspace_invitation_deliveries enable row level security;
revoke all on private.workspace_invitation_deliveries from public,anon,authenticated,app_user,app_server,app_worker;

create function private.enqueue_workspace_invitation_delivery(p_invitation uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  -- Called only from the manager-controlled invitation transaction.
  if not app.workspace_allows('settings','*','write') then raise exception using errcode='42501',message='workspace_denied'; end if;
  insert into private.workspace_invitation_deliveries(invitation_id,workspace_id,initiator_id,message)
    select i.id,i.workspace_id,auth.uid(),jsonb_build_object('invitation_id',i.id,'email',i.email,'workspace_name',w.name,'acceptance_path','/invitations/'||i.id::text)
    from private.workspace_invitations i join app.workspaces w on w.id=i.workspace_id
    where i.id=p_invitation and i.workspace_id=app.current_workspace_id() and i.created_by=auth.uid()
      and i.accepted_at is null and i.revoked_at is null and i.expires_at>clock_timestamp()
    on conflict(invitation_id) do nothing;
end $$;
create function private.workspace_invitation_delivery_status(p_invitation uuid) returns text
language sql stable security definer set search_path='' as $$
  select coalesce((select case when d.status='running' and d.lease_until<=clock_timestamp() then 'unknown'
    when d.status='running' then 'pending' when d.status='cancelled' then 'failed' else d.status end
    from private.workspace_invitation_deliveries d where d.invitation_id=p_invitation),'unconfigured')
$$;
create function private.retry_workspace_invitation_delivery(p_invitation uuid) returns text
language plpgsql security definer set search_path='' as $$
declare d private.workspace_invitation_deliveries%rowtype;
begin
  perform private.workspace_assert_manager();
  if not exists(select 1 from private.workspace_invitations i where i.id=p_invitation and i.workspace_id=app.current_workspace_id()
    and i.accepted_at is null and i.revoked_at is null and i.expires_at>clock_timestamp()) then
    raise exception using errcode='42501',message='workspace_denied';
  end if;
  select * into d from private.workspace_invitation_deliveries where invitation_id=p_invitation for update;
  if not found then raise exception using errcode='22023',message='invitation_delivery_missing'; end if;
  if d.status='running' and d.lease_until<=clock_timestamp() then d.status:='unknown'; d.ambiguous:=true; end if;
  -- Mailpit has no provider deduplication promise. Ambiguous outcomes are never repeated.
  if d.status='unknown' and (d.prepared->>'provider' is distinct from 'resend' or d.first_send_at is null
    or d.first_send_at+interval '23 hours 59 minutes'<=clock_timestamp()) then
    raise exception using errcode='22023',message='invitation_delivery_ambiguous';
  end if;
  if d.status in ('failed','unconfigured','unknown') then
    -- Never move the real original initiator: authorization is rechecked on claim and pre-send.
    update private.workspace_invitation_deliveries set status='pending',ambiguous=d.ambiguous,fence=null,lease_until=null,updated_at=clock_timestamp()
      where invitation_id=p_invitation;
    return 'pending';
  end if;
  return private.workspace_invitation_delivery_status(p_invitation);
end $$;

-- A single helper enforces account -> workspace -> outbox lock ordering on every transition.
-- It does not grant permission from the stored initiator; it re-evaluates current DB permission.
create function private.lock_workspace_invitation_delivery(p_invitation uuid)
returns private.workspace_invitation_deliveries language plpgsql security definer set search_path='' as $$
declare d private.workspace_invitation_deliveries%rowtype;
begin
  select * into d from private.workspace_invitation_deliveries where invitation_id=p_invitation;
  if not found then return null; end if;
  perform 1 from auth.users where id=d.initiator_id for key share;
  perform 1 from app.workspaces where id=d.workspace_id for share;
  select * into d from private.workspace_invitation_deliveries where invitation_id=p_invitation for update skip locked;
  if not found then return null; end if;
  if not private.workspace_allows(d.initiator_id,d.workspace_id,'settings','*','write')
    or not exists(select 1 from private.workspace_invitations i where i.id=d.invitation_id and i.workspace_id=d.workspace_id
      and i.revoked_at is null and i.accepted_at is null and i.expires_at>clock_timestamp()) then
    update private.workspace_invitation_deliveries set status='cancelled',fence=null,lease_until=null,updated_at=clock_timestamp()
      where invitation_id=p_invitation and status<>'sent';
    return null;
  end if;
  return d;
end $$;
create function app.claim_workspace_invitation_delivery(p_invitation uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record; d private.workspace_invitation_deliveries%rowtype;
begin
  for candidate in select invitation_id from private.workspace_invitation_deliveries
    where (p_invitation is null or invitation_id=p_invitation)
      and (status='pending' or (status='running' and lease_until<=clock_timestamp())) order by updated_at,invitation_id limit 20 loop
    d:=private.lock_workspace_invitation_delivery(candidate.invitation_id);
    if d.invitation_id is null then continue; end if;
    if d.status='running' and d.lease_until<=clock_timestamp() then
      update private.workspace_invitation_deliveries set status='unknown',ambiguous=true,fence=null,lease_until=null,updated_at=clock_timestamp() where invitation_id=d.invitation_id;
      continue;
    end if;
    if d.status<>'pending' then continue; end if;
    update private.workspace_invitation_deliveries set status='running',started_in_lease=false,fence=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp()
      where invitation_id=d.invitation_id returning * into d;
    return d.message||jsonb_build_object('fence',d.fence,'prepared',d.prepared);
  end loop;
  return null;
end $$;
create function app.prepare_workspace_invitation_delivery(p_invitation uuid,p_fence uuid,p_prepared jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d private.workspace_invitation_deliveries%rowtype;
begin
  d:=private.lock_workspace_invitation_delivery(p_invitation);
  if d.invitation_id is null or d.status<>'running' or d.fence is distinct from p_fence or d.lease_until<=clock_timestamp() then return null; end if;
  if d.prepared is null then
    if jsonb_typeof(p_prepared)<>'object' or p_prepared->>'provider' not in ('resend','mailpit')
      or length(p_prepared->>'body')>32768 or p_prepared->>'body' is null
      or p_prepared->>'idempotency_key' is distinct from 'workspace-invitation/'||p_invitation::text then
      raise exception using errcode='22023',message='invalid_invitation_mail';
    end if;
    update private.workspace_invitation_deliveries set prepared=p_prepared where invitation_id=p_invitation returning * into d;
  end if;
  return d.prepared;
end $$;
create function app.start_workspace_invitation_delivery(p_invitation uuid,p_fence uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare d private.workspace_invitation_deliveries%rowtype;
begin
  d:=private.lock_workspace_invitation_delivery(p_invitation);
  if d.invitation_id is null or d.status<>'running' or d.fence is distinct from p_fence or d.lease_until<=clock_timestamp() or d.prepared is null or d.started_in_lease then return false; end if;
  -- Reserve one minute for HTTP timeout/transport inside Resend's documented 24h window.
  if d.ambiguous and d.first_send_at is not null and (d.prepared->>'provider'<>'resend' or d.first_send_at+interval '23 hours 59 minutes'<=clock_timestamp()) then
    update private.workspace_invitation_deliveries set status='unknown',fence=null,lease_until=null,updated_at=clock_timestamp() where invitation_id=p_invitation;
    return false;
  end if;
  update private.workspace_invitation_deliveries set started_in_lease=true,first_send_at=coalesce(first_send_at,clock_timestamp()) where invitation_id=p_invitation;
  return true;
end $$;
create function app.finish_workspace_invitation_delivery(p_invitation uuid,p_fence uuid,p_status text) returns boolean
language plpgsql security definer set search_path='' as $$
declare d private.workspace_invitation_deliveries%rowtype;
begin
  d:=private.lock_workspace_invitation_delivery(p_invitation);
  if d.invitation_id is null or d.status<>'running' or d.fence is distinct from p_fence or d.lease_until<=clock_timestamp() then return false; end if;
  if p_status not in ('sent','failed','unknown','unconfigured') then raise exception using errcode='22023',message='invalid_delivery_status'; end if;
  update private.workspace_invitation_deliveries set status=p_status,ambiguous=ambiguous or p_status='unknown',
    first_send_at=case when not ambiguous and p_status in ('failed','unconfigured') then null else first_send_at end,
    fence=null,lease_until=null,updated_at=clock_timestamp() where invitation_id=p_invitation;
  return true;
end $$;
revoke all on function private.enqueue_workspace_invitation_delivery(uuid),private.workspace_invitation_delivery_status(uuid),
  private.retry_workspace_invitation_delivery(uuid),private.lock_workspace_invitation_delivery(uuid)
  from public,anon,authenticated,app_user,app_server,app_worker;
revoke all on function app.claim_workspace_invitation_delivery(uuid),app.prepare_workspace_invitation_delivery(uuid,uuid,jsonb),
  app.start_workspace_invitation_delivery(uuid,uuid),app.finish_workspace_invitation_delivery(uuid,uuid,text)
  from public,anon,authenticated,app_user,app_server,app_worker;
grant execute on function app.claim_workspace_invitation_delivery(uuid),app.prepare_workspace_invitation_delivery(uuid,uuid,jsonb),
  app.start_workspace_invitation_delivery(uuid,uuid),app.finish_workspace_invitation_delivery(uuid,uuid,text) to app_worker;
