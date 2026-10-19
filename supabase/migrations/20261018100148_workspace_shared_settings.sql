-- Shared business configuration is owned by the current workspace, not its manager.
-- Historical unassigned test rows are preserved for the explicit #518 store gate.
alter table app.user_business_settings add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.user_business_settings drop constraint user_business_settings_pkey;
alter table app.user_business_settings alter column owner_id drop not null;
alter table app.user_business_settings add constraint settings_legacy_owner_key unique(owner_id,id);
alter table app.user_business_settings add constraint settings_workspace_key unique(workspace_id,id);
alter table app.user_business_settings drop constraint user_business_settings_owner_id_fkey;
alter table app.user_business_settings add constraint settings_legacy_author_fk foreign key(owner_id) references auth.users(id) on delete set null;
drop policy business_settings_owner on app.user_business_settings;
create policy workspace_settings_read on app.user_business_settings for select to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','read'));
create policy workspace_settings_write on app.user_business_settings for all to app_user
 using(workspace_id=app.current_workspace_id() and app.workspace_allows('settings','*','write'))
 with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows('settings','*','write'));
create trigger workspace_model_anchor before insert or update on app.user_business_settings
 for each row execute function private.guard_workspace_model_anchor();
