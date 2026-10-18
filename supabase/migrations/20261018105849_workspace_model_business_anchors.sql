-- Shared model snapshots must see every permitted entity in the workspace,
-- independently of its creator. Preserve the unassigned legacy graph for #518.
do $$
declare fks jsonb;r jsonb;
begin
 select jsonb_agg(jsonb_build_object('relation',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid))) into fks
 from pg_constraint c where c.contype='f' and c.confrelid='app.entities'::regclass;
 for r in select value from jsonb_array_elements(fks) loop
  execute format('alter table %s drop constraint %I',r->>'relation',r->>'name');
 end loop;
 alter table app.entities drop constraint entities_pkey;
 alter table app.entities add constraint entity_legacy_owner_key unique(owner_id,id);
 alter table app.entities alter column owner_id drop not null;
 for r in select value from jsonb_array_elements(fks) loop
  execute format('alter table %s add constraint %I %s',r->>'relation',r->>'name',r->>'definition');
 end loop;
end $$;
alter table app.entities drop constraint entities_owner_id_fkey;
alter table app.entities add constraint entity_legacy_author_fk foreign key(owner_id) references auth.users(id) on delete set null;
alter table app.entities add constraint entity_workspace_stored_schema_fk foreign key(workspace_id,entity_type_id,schema_version)
 references app.entity_schema_versions(workspace_id,type_id,schema_version);
create trigger workspace_model_anchor before insert or update on app.entities
 for each row execute function private.guard_workspace_model_anchor();
create policy entity_workspace_read on app.entities for select to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('entity_type',entity_type_id::text,'read'));
create policy entity_workspace_write on app.entities for all to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('entity_type',entity_type_id::text,'write'))
 with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('entity_type',entity_type_id::text,'write'));

-- Creating a permitted entity may mark its exact identity assignment as used;
-- it does not grant the creator general identity/settings mutation authority.
create or replace function private.mark_entity_identity_reference() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if new.workspace_id is null then
  update app.entity_type_identity_sources set referenced=true where owner_id=new.owner_id and type_id=new.entity_type_id and code=new.source and not referenced;
  if not exists(select 1 from app.entity_type_identity_sources where owner_id=new.owner_id and type_id=new.entity_type_id and code=new.source) then
   raise exception 'identity_source_missing' using errcode='23503';
  end if;
  return new;
 end if;
 if new.workspace_id is distinct from app.current_workspace_id() then
  raise exception 'workspace_denied' using errcode='42501';
 end if;
 perform app.authorize_workspace(jsonb_build_array(jsonb_build_object('target_kind','entity_type','target_id',new.entity_type_id::text,'access','write')));
 update app.entity_type_identity_sources set referenced=true
  where workspace_id=new.workspace_id and type_id=new.entity_type_id and code=new.source and not referenced;
 if not exists(select 1 from app.entity_type_identity_sources where workspace_id=new.workspace_id and type_id=new.entity_type_id and code=new.source) then
  raise exception 'identity_source_missing' using errcode='23503';
 end if;
 return new;
end $$;
revoke all on function private.mark_entity_identity_reference() from public,anon,authenticated,app_user,app_server,app_worker;
