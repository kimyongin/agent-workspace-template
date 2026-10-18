-- Each admitted record revision replaces its derived projection atomically.
-- Source-state insertion is shared by ordinary and model-publication producers;
-- this never touches another workspace, source kind, or retained provider effect.
create function private.invalidate_record_search_chunks() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 delete from app.search_chunks
  where workspace_id=new.workspace_id and source_kind='record' and source_id=new.id;
 return new;
end $$;
create trigger invalidate_record_search_chunks after insert on app.search_index_state
 for each row when (new.workspace_id is not null and new.kind='record')
 execute function private.invalidate_record_search_chunks();
revoke all on function private.invalidate_record_search_chunks()
 from public,anon,authenticated,app_user,app_server,app_worker;
