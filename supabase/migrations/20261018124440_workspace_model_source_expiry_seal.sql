-- A newly accepted group cannot retain execution sources beyond any accepted
-- child. Retrying preserves the original deadline; progress cannot extend it.
create function private.keep_model_source_expiry() returns trigger
 language plpgsql set search_path='' as $$
declare deadline timestamptz;children integer;bounded_children integer;
begin
 if old.workspace_id is null or current_user<>'app_user'
   or new.source_expires_at is not distinct from old.source_expires_at then return new;end if;
 if old.status not in ('ready','failed') or new.status<>'queued' or new.version<>old.version+1 then
  raise exception 'model_plan_source_expiry_immutable' using errcode='23514';end if;
 perform private.authorize_model_activation(old.workspace_id,old.id,new.initiated_by);
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
