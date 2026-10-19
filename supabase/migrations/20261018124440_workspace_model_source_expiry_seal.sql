-- A newly accepted group cannot retain execution sources beyond any accepted
-- child. Retrying preserves the original deadline; progress cannot extend it.
create function private.authorize_model_source_snapshot(p_workspace uuid,p_model uuid,p_actor uuid,p_templates jsonb,p_memberships jsonb)
 returns void language plpgsql security definer set search_path='' as $$
declare captured jsonb;expected_templates jsonb;expected_memberships jsonb;
begin
 perform private.authorize_model_activation(p_workspace,p_model,p_actor);
 select g.plan into strict captured from app.data_model_changes g where g.workspace_id=p_workspace and g.id=p_model;
 select coalesce(jsonb_object_agg(t.value->'schema'->>'x-type-id',
  private.entity_schema_effective_templates(p_workspace,(t.value->'schema'->>'x-type-id')::uuid)),'{}'::jsonb)
  into expected_templates from jsonb_array_elements(captured->'target'->'entity_types') t;
 select coalesce(jsonb_object_agg(t.value->'schema'->>'x-type-id',
  app.entity_schema_membership(p_workspace,(t.value->'schema'->>'x-type-id')::uuid)),'{}'::jsonb)
  into expected_memberships from jsonb_array_elements(captured->'source'->'entity_types') t
  where captured->'protected_kind_ids' ? (t.value->'schema'->>'x-type-id');
 if p_templates is distinct from expected_templates or p_memberships is distinct from expected_memberships then
  raise exception 'model_plan_source_snapshot_immutable' using errcode='23514';end if;
end $$;
revoke all on function private.authorize_model_source_snapshot(uuid,uuid,uuid,jsonb,jsonb)
 from public,anon,authenticated,app_server,app_worker;
grant execute on function private.authorize_model_source_snapshot(uuid,uuid,uuid,jsonb,jsonb) to app_user;

create function private.keep_model_source_expiry() returns trigger
 language plpgsql set search_path='' as $$
declare deadline timestamptz;children integer;bounded_children integer;snapshot_changed boolean;expiry_changed boolean;
begin
 if old.workspace_id is null or current_user<>'app_user' then return new;end if;
 snapshot_changed:=new.source_templates is distinct from old.source_templates
  or new.source_memberships is distinct from old.source_memberships;
 expiry_changed:=new.source_expires_at is distinct from old.source_expires_at;
 if not snapshot_changed and not expiry_changed then return new;end if;
 if old.status not in ('ready','failed') or new.status<>'queued' or new.version<>old.version+1 then
  if snapshot_changed then raise exception 'model_plan_source_snapshot_immutable' using errcode='23514';end if;
  raise exception 'model_plan_source_expiry_immutable' using errcode='23514';end if;
 if snapshot_changed then
  perform private.authorize_model_source_snapshot(old.workspace_id,old.id,new.initiated_by,new.source_templates,new.source_memberships);
 else perform private.authorize_model_activation(old.workspace_id,old.id,new.initiated_by);end if;
 if not expiry_changed then return new;end if;
 select count(*),count(j.source_expires_at),min(j.source_expires_at)
  into children,bounded_children,deadline
  from app.data_model_children c join app.entity_schema_migrations j
   on j.workspace_id=c.workspace_id and j.id=c.job_id
  where c.workspace_id=old.workspace_id and c.model_id=old.id;
 if children=0 or bounded_children<>children or new.source_expires_at is null
   or not isfinite(new.source_expires_at) or new.source_expires_at<=clock_timestamp()
   or new.source_expires_at>deadline then
  raise exception 'model_plan_source_expiry_immutable' using errcode='23514';end if;
 return new;
end $$;
revoke all on function private.keep_model_source_expiry() from public,anon,authenticated,app_user,app_server,app_worker;
create trigger keep_model_source_expiry before update on app.data_model_changes
 for each row execute function private.keep_model_source_expiry();
