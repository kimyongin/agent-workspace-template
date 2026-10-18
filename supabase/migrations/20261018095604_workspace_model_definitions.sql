-- #513 owns configuration in a workspace. Existing owner rows remain unassigned and
-- inaccessible to new business entry points until #518's explicit test-store cleanup.
-- No owner-to-workspace mapping or data deletion is performed.
do $$
declare
 names text[]:=array['entity_types','entity_schema_versions','entity_issuers','entity_identifier_rules','entity_type_identity','entity_type_identity_sources'];
 name text; r record; saved_fks jsonb; item jsonb; definition text;
begin
 for name in select unnest(names) loop
  execute format('alter table app.%I add column if not exists workspace_id uuid references app.workspaces(id) on delete cascade',name);
 end loop;
 select jsonb_agg(jsonb_build_object('relation',c.conrelid::regclass::text,'name',c.conname,
  'definition',pg_get_constraintdef(c.oid),'converted_child',c.conrelid=any(select ('app.'||n)::regclass from unnest(names)n),
  'converted_parent',c.confrelid=any(select ('app.'||n)::regclass from unnest(names)n))) into saved_fks
 from pg_constraint c where c.contype='f' and (c.conrelid=any(select ('app.'||n)::regclass from unnest(names)n)
  or c.confrelid=any(select ('app.'||n)::regclass from unnest(names)n));
 for item in select value from jsonb_array_elements(saved_fks) loop
  execute format('alter table %s drop constraint %I',item->>'relation',item->>'name');
 end loop;
 for name in select unnest(names) loop
  for r in select c.conname,pg_get_constraintdef(c.oid) definition from pg_constraint c
   where c.conrelid=('app.'||name)::regclass and c.contype='p' loop
   execute format('alter table app.%I drop constraint %I',name,r.conname);
   -- Nullable legacy ownership is temporary, with the old unique keys retaining
   -- references for preserved historical rows. New rows never populate owner_id.
   execute format('alter table app.%I add constraint %I %s',name,name||'_legacy_owner_key',replace(r.definition,'PRIMARY KEY','UNIQUE'));
   execute format('alter table app.%I add constraint %I %s',name,name||'_workspace_key',replace(replace(r.definition,'PRIMARY KEY','UNIQUE'),'owner_id','workspace_id'));
  end loop;
  execute format('alter table app.%I alter column owner_id drop not null',name);
 end loop;
 -- Rules also use a source-qualified key for type/source references.
 alter table app.entity_identifier_rules add constraint identifier_rule_workspace_source_key unique(workspace_id,source,id);
 for item in select value from jsonb_array_elements(saved_fks) loop
  definition:=item->>'definition';
  if (item->>'converted_child')::boolean and definition like '%REFERENCES auth.users%' then
   definition:=replace(definition,'ON DELETE CASCADE','ON DELETE SET NULL');
  end if;
  execute format('alter table %s add constraint %I %s',item->>'relation',item->>'name',definition);
  if (item->>'converted_child')::boolean and (item->>'converted_parent')::boolean and definition like '%owner_id%' then
   execute format('alter table %s add constraint %I %s',item->>'relation',(item->>'name')||'_workspace',replace(definition,'owner_id','workspace_id'));
  end if;
 end loop;
end $$;

-- The effective registry's immutability/default/version guards retain their rules,
-- changing only the already resolved compound ownership key.
do $$
declare name text; definition text;
begin
 foreach name in array array['guard_identity_definition','guard_type_identity_source','check_identity_default_active','bump_type_identity_configuration'] loop
  select pg_get_functiondef(p.oid) into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='private' and p.proname=name;
  execute replace(definition,'owner_id','workspace_id');
 end loop;
end $$;

create function private.guard_workspace_model_anchor() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.workspace_id is null or new.workspace_id is distinct from app.current_workspace_id() or new.owner_id is not null then
   raise exception 'workspace_model_anchor_required' using errcode='23514';
  end if;
 elsif old.workspace_id is not null and new.workspace_id is distinct from old.workspace_id then
  raise exception 'workspace_model_anchor_immutable' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function private.guard_workspace_model_anchor() from public,anon,authenticated;

do $$
declare name text; p record; read_predicate text;
begin
 foreach name in array array['entity_types','entity_schema_versions','entity_issuers','entity_identifier_rules','entity_type_identity','entity_type_identity_sources'] loop
  for p in select policyname from pg_policies where schemaname='app' and tablename=name loop
   execute format('drop policy %I on app.%I',p.policyname,name);
  end loop;
  read_predicate:=case
   when name='entity_types' then 'app.workspace_allows(''entity_type'',id::text,''read'')'
   when name in ('entity_schema_versions','entity_type_identity','entity_type_identity_sources') then 'app.workspace_allows(''entity_type'',type_id::text,''read'')'
   when name='entity_issuers' then 'exists(select 1 from app.entity_type_identity_sources s where s.workspace_id=entity_issuers.workspace_id and s.code=entity_issuers.code and app.workspace_allows(''entity_type'',s.type_id::text,''read''))'
   else 'exists(select 1 from app.entity_type_identity_sources s where s.workspace_id=entity_identifier_rules.workspace_id and s.rule_id=entity_identifier_rules.id and app.workspace_allows(''entity_type'',s.type_id::text,''read''))' end;
  execute format('create policy workspace_definition_read on app.%I for select to app_user using(workspace_id=app.current_workspace_id() and (app.workspace_allows(''settings'',''*'',''read'') or %s))',name,read_predicate);
  execute format('create policy workspace_definition_write on app.%I for all to app_user using(workspace_id=app.current_workspace_id() and app.workspace_allows(''settings'',''*'',''write'')) with check(workspace_id=app.current_workspace_id() and owner_id is null and app.workspace_allows(''settings'',''*'',''write''))',name);
  execute format('create trigger workspace_model_anchor before insert or update on app.%I for each row execute function private.guard_workspace_model_anchor()',name);
 end loop;
end $$;

-- The manager's grant picker consumes the same newly scoped published definition.
create or replace function app.workspace_grant_targets() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.workspace_assert_manager();
 return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'label',v.schema->>'title') order by v.schema->>'title',t.id)
  from app.entity_types t join app.entity_schema_versions v on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version
  where t.workspace_id=app.current_workspace_id()),'[]'::jsonb));
end $$;
