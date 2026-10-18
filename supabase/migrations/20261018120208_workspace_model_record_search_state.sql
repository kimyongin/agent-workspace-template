-- Preserve legacy state and uncertain provider effects; only new scoped record
-- jobs use this namespace. #516 converts the consumer and passage/chunk stores.
alter table app.search_index_state add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.search_index_state add column initiated_by uuid references auth.users(id) on delete set null;
alter table app.search_index_state add column workspace_generation bigint;
alter table app.search_index_state add column source_version bigint;
alter table app.search_index_state drop constraint search_index_state_pkey;
alter table app.search_index_state add constraint search_state_legacy_owner_key unique(owner_id,kind,id);
alter table app.search_index_state alter column owner_id drop not null;
alter table app.search_index_state drop constraint search_index_state_owner_id_fkey;
alter table app.search_index_state add constraint search_state_legacy_author_fk foreign key(owner_id) references auth.users(id) on delete set null;
alter table app.search_index_state add constraint search_state_workspace_key unique(workspace_id,kind,id);
alter table app.search_index_state add constraint search_state_workspace_record_fk foreign key(workspace_id,id) references app.records(workspace_id,id) on delete cascade;
alter table app.search_index_state add constraint search_state_scoped_revision check(workspace_id is null or
 (kind='record' and owner_id is null and workspace_generation is not null and workspace_generation>0 and source_version is not null and source_version>0));
create trigger workspace_model_anchor before insert or update on app.search_index_state
 for each row execute function private.guard_workspace_model_anchor();
drop policy search_index_owner on app.search_index_state;
create policy search_state_workspace_read on app.search_index_state for select to app_user
 using(workspace_id=app.current_workspace_id() and exists(select 1 from app.records r
  where r.workspace_id=search_index_state.workspace_id and r.id=search_index_state.id));
create index search_queue_workspace_item on pgmq.q_search_index
 ((message->>'workspace_id'),(message->>'kind'),(message->>'id'));

create function private.check_workspace_record_search_source() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if new.workspace_id is not null and (new.initiated_by is null or not exists(
   select 1 from app.workspaces w join app.records r on r.workspace_id=w.id
   where w.id=new.workspace_id and w.deleted_at is null and w.lifecycle_generation=new.workspace_generation
    and r.id=new.id and r.version=new.source_version
    and encode(extensions.digest(r.body,'sha256'),'hex')=new.input_hash)) then
  raise exception 'workspace_search_source_invalid' using errcode='23514';end if;
 return new;
end $$;
revoke all on function private.check_workspace_record_search_source() from public,anon,authenticated,app_user,app_server,app_worker;
create trigger check_workspace_record_search_source before insert on app.search_index_state
 for each row execute function private.check_workspace_record_search_source();

-- Exact parent deletion removes only that workspace's queued source. Retained
-- ambiguous provider effects are deliberately left to the #516 effect protocol.
create or replace function app.delete_search_index() returns trigger
 language plpgsql security definer set search_path='' as $$
declare v_kind text:=left(tg_table_name,length(tg_table_name)-1);
begin
 if old.workspace_id is not null then
  delete from app.search_index_state where workspace_id=old.workspace_id and kind=v_kind and id=old.id;
  delete from pgmq.q_search_index where message->>'workspace_id'=old.workspace_id::text
   and message->>'kind'=v_kind and message->>'id'=old.id;
 else
  delete from app.search_index_state where owner_id=old.owner_id and kind=v_kind and id=old.id;
  delete from pgmq.q_search_index where message->>'owner_id'=old.owner_id::text
   and message->>'kind'=v_kind and message->>'id'=old.id;
 end if;
 return old;
end $$;
