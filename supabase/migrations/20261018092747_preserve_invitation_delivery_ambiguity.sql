-- Preserve unresolved prior provider acceptance across explicit retry outcomes.
create or replace function app.claim_workspace_invitation_delivery(p_invitation uuid default null) returns jsonb
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
    return d.message||jsonb_build_object('fence',d.fence,'prepared',d.prepared,'ambiguous',d.ambiguous);
  end loop;
  return null;
end $$;
create or replace function app.finish_workspace_invitation_delivery(p_invitation uuid,p_fence uuid,p_status text) returns boolean
language plpgsql security definer set search_path='' as $$
declare d private.workspace_invitation_deliveries%rowtype;
begin
  d:=private.lock_workspace_invitation_delivery(p_invitation);
  if d.invitation_id is null or d.status<>'running' or d.fence is distinct from p_fence or d.lease_until<=clock_timestamp() then return false; end if;
  if p_status not in ('sent','failed','unknown','unconfigured') then raise exception using errcode='22023',message='invalid_delivery_status'; end if;
  -- A rejection/configuration failure describes only this attempt, not the earlier possible send.
  if d.ambiguous and p_status<>'sent' then p_status:='unknown'; end if;
  update private.workspace_invitation_deliveries set status=p_status,ambiguous=ambiguous or p_status='unknown',
    first_send_at=case when not ambiguous and p_status in ('failed','unconfigured') then null else first_send_at end,
    fence=null,lease_until=null,updated_at=clock_timestamp() where invitation_id=p_invitation;
  return true;
end $$;
