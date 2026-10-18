-- Tag roots and associations required by model-generated records. General tag
-- dictionary/mutation callers are converted by #514/#515; no new permission kind.
alter table app.tags add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.tags alter column owner_id drop not null;
alter table app.tags add unique(workspace_id,id),add unique(workspace_id,id,scope);
create unique index workspace_tag_scope_name on app.tags(workspace_id,scope,lower(name));
alter table app.tags drop constraint tags_owner_id_fkey;
alter table app.tags add constraint tag_legacy_author_fk foreign key(owner_id) references auth.users(id) on delete set null;
create trigger workspace_model_anchor before insert or update on app.tags for each row execute function private.guard_workspace_model_anchor();

alter table app.record_tags add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.record_tags add column tag_scope text generated always as ('record'::text) stored;
alter table app.record_tags alter column owner_id drop not null;
alter table app.record_tags add unique(workspace_id,record_id,tag_id),
 add constraint record_tag_workspace_record_fk foreign key(workspace_id,record_id) references app.records(workspace_id,id) on delete cascade,
 add constraint record_tag_workspace_tag_fk foreign key(workspace_id,tag_id,tag_scope) references app.tags(workspace_id,id,scope) on delete cascade;
alter table app.record_tags drop constraint record_tags_owner_id_fkey;
alter table app.record_tags add constraint record_tag_legacy_author_fk foreign key(owner_id) references auth.users(id) on delete set null;
create trigger workspace_model_anchor before insert or update on app.record_tags for each row execute function private.guard_workspace_model_anchor();
create policy record_tag_workspace_read on app.record_tags for select to app_user
 using(workspace_id=app.current_workspace_id() and exists(select 1 from app.records r where r.workspace_id=record_tags.workspace_id and r.id=record_tags.record_id));
create policy record_tag_workspace_write on app.record_tags for all to app_user
 using(workspace_id=app.current_workspace_id() and exists(select 1 from app.records r where r.workspace_id=record_tags.workspace_id and r.id=record_tags.record_id and (
  (r.task_id is not null and app.workspace_allows('tasks','*','write')) or
  exists(select 1 from app.entities e where e.workspace_id=r.workspace_id and e.id=r.entity_id and app.workspace_allows('entity_type',e.entity_type_id::text,'write')))))
 with check(workspace_id=app.current_workspace_id() and owner_id is null and exists(select 1 from app.records r where r.workspace_id=record_tags.workspace_id and r.id=record_tags.record_id and (
  (r.task_id is not null and app.workspace_allows('tasks','*','write')) or
  exists(select 1 from app.entities e where e.workspace_id=r.workspace_id and e.id=r.entity_id and app.workspace_allows('entity_type',e.entity_type_id::text,'write')))));

alter table app.entity_tags add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.entity_tags add column tag_scope text generated always as ('entity'::text) stored;
alter table app.entity_tags drop constraint entity_tags_pkey;
alter table app.entity_tags add unique(owner_id,entity_id,tag_id);
alter table app.entity_tags alter column owner_id drop not null;
alter table app.entity_tags add unique(workspace_id,entity_id,tag_id),
 add foreign key(workspace_id,entity_id) references app.entities(workspace_id,id) on delete cascade,
 add foreign key(workspace_id,tag_id,tag_scope) references app.tags(workspace_id,id,scope) on delete cascade;
alter table app.entity_tags drop constraint entity_tags_owner_id_fkey;
alter table app.entity_tags add constraint entity_tag_legacy_author_fk foreign key(owner_id) references auth.users(id) on delete set null;
create trigger workspace_model_anchor before insert or update on app.entity_tags for each row execute function private.guard_workspace_model_anchor();
create policy entity_tag_workspace_read on app.entity_tags for select to app_user
 using(workspace_id=app.current_workspace_id() and exists(select 1 from app.entities e where e.workspace_id=entity_tags.workspace_id and e.id=entity_tags.entity_id));
create policy entity_tag_workspace_write on app.entity_tags for all to app_user
 using(workspace_id=app.current_workspace_id() and exists(select 1 from app.entities e where e.workspace_id=entity_tags.workspace_id and e.id=entity_tags.entity_id and app.workspace_allows('entity_type',e.entity_type_id::text,'write')))
 with check(workspace_id=app.current_workspace_id() and owner_id is null and exists(select 1 from app.entities e where e.workspace_id=entity_tags.workspace_id and e.id=entity_tags.entity_id and app.workspace_allows('entity_type',e.entity_type_id::text,'write')));

-- Return only the submitted same-space record tag IDs. Settings changes and
-- target-authorized memo preparation have distinct, explicitly verified purposes.
create function app.workspace_record_template_tag_ids(p_ids text[],p_target jsonb default null) returns text[]
 language plpgsql security definer set search_path='' as $$
declare result text[];
begin
 perform app.lock_workspace_account();perform app.lock_workspace(app.current_workspace_id(),false);
 if p_ids is null then raise exception 'invalid_template_tags' using errcode='22023';end if;
 if p_target is null or p_target='null'::jsonb then
  perform app.authorize_workspace('[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb);
 else
  perform app.workspace_business_template(p_target->>'model',p_target->>'action',p_target->>'target_id',(p_target->>'entity_type_id')::uuid);
 end if;
 select coalesce(array_agg(t.id order by t.id),'{}'::text[]) into result from app.tags t
  where t.workspace_id=app.current_workspace_id() and t.scope='record' and t.id=any(p_ids);
 return result;
end $$;
revoke all on function app.workspace_record_template_tag_ids(text[],jsonb) from public,anon,authenticated,app_worker;
grant execute on function app.workspace_record_template_tag_ids(text[],jsonb) to app_user;
