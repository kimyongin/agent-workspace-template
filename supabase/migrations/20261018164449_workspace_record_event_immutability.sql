-- Shared records keep their recorded kind and event facts independently of memo edits.
-- This trigger does not touch author identifiers: Auth deletion may still SET NULL.
create function private.guard_workspace_record_event() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.workspace_id is not null and (
   new.record_kind is distinct from old.record_kind or
   new.change_metadata is distinct from old.change_metadata or
   (old.record_kind='change' and new.occurred_at is distinct from old.occurred_at)
 ) then
   raise exception 'record_event_immutable' using errcode='23514';
 end if;
 return new;
end
$$;
revoke all on function private.guard_workspace_record_event() from public,anon,authenticated,app_user,app_worker;
create trigger workspace_record_event before update on app.records
 for each row execute function private.guard_workspace_record_event();
