-- Explicit retries create new immutable activation identities and retain failed history.
alter table app.entity_schema_migrations add column retry_source_job_id uuid;
alter table app.entity_schema_migrations add foreign key(workspace_id,retry_source_job_id)
 references app.entity_schema_migrations(workspace_id,id);
create function private.guard_schema_retry_attempt() returns trigger language plpgsql set search_path='' as $$
declare source app.entity_schema_migrations%rowtype;
 mutable text[]:=array['id','status','version','fence','lease_until','retryable','failure_reason','result',
  'created_by','created_by_name','initiated_by','actor_source','created_at','updated_at','retry_source_job_id'];
begin
 if tg_op='UPDATE' then
  if new.retry_source_job_id is distinct from old.retry_source_job_id then
   raise exception 'schema_retry_source_immutable' using errcode='23514';end if;
  return new;
 end if;
 if new.retry_source_job_id is null then return new;end if;
 select * into source from app.entity_schema_migrations j where j.workspace_id=new.workspace_id and j.id=new.retry_source_job_id for share;
 if not found or source.status<>'failed' or not source.retryable or source.source_expires_at is null
  or source.source_expires_at<=clock_timestamp() or new.status<>'queued' or new.version<>1 or new.fence<>0
  or new.lease_until is not null or new.retryable or new.failure_reason is not null
  or (to_jsonb(new)-mutable) is distinct from (to_jsonb(source)-mutable) then
  raise exception 'schema_retry_source_invalid' using errcode='23514';end if;
 return new;
end $$;
revoke all on function private.guard_schema_retry_attempt() from public,anon,authenticated,app_user,app_server,app_worker;
create trigger schema_retry_attempt before insert or update on app.entity_schema_migrations
 for each row execute function private.guard_schema_retry_attempt();
