-- #551 completes the workspace transition without deleting business data.
-- The #551/#543 reset is a separate, explicit maintenance operation. A store
-- with unassigned historical model rows must complete that operation first.
do $cutover$
declare
  target record;
  constraint_row record;
  reference jsonb;
  references_to_restore jsonb;
  blocked boolean;
  targets regclass[]:=array[
    'app.entities','app.entity_types','app.entity_schema_versions',
    'app.entity_issuers','app.entity_identifier_rules','app.entity_type_identity',
    'app.entity_type_identity_sources','app.entity_relation_definitions',
    'app.entity_relation_links','app.data_model_changes','app.data_model_children',
    'app.entity_schema_changes','app.entity_schema_analyses','app.entity_schema_migrations',
    'private.entity_schema_analysis_rows','private.entity_schema_migration_rows'
  ]::regclass[];
begin
  -- Lock the complete bounded graph before inspecting it. Never infer a
  -- workspace from an old owner, or silently remove an unassigned row.
  for target in select unnest(targets) as relation loop
    execute format('lock table %s in access exclusive mode',target.relation);
    execute format('select exists(select 1 from %s where workspace_id is null)',target.relation) into blocked;
    if blocked then
      raise exception 'entity_workspace_cutover_requires_explicit_reset: % has unassigned rows',target.relation
        using errcode='55000',hint='Use the reviewed #551/#543 maintenance reset plan; migrations never delete these rows.';
    end if;
  end loop;

  -- Rebind incoming FKs to the actual primary keys after promotion. Their
  -- complete definitions (delete actions, deferral and validation) survive.
  -- Owner-based FKs belonged only to the retired unassigned graph.
  select coalesce(jsonb_agg(jsonb_build_object(
    'relation',c.conrelid::regclass::text,'name',c.conname,
    'definition',pg_get_constraintdef(c.oid),
    'legacy',exists(select 1 from pg_attribute a where a.attrelid=c.conrelid
      and a.attnum=any(c.conkey) and a.attname='owner_id'))),'[]'::jsonb)
    into references_to_restore
  from pg_constraint c where c.contype='f' and
    (c.confrelid=any(targets) or (c.conrelid=any(targets) and exists(
      select 1 from pg_attribute a where a.attrelid=c.conrelid
      and a.attnum=any(c.conkey) and a.attname='owner_id') and c.confrelid<>'auth.users'::regclass));
  for reference in select value from jsonb_array_elements(references_to_restore) loop
    execute format('alter table %s drop constraint %I',reference->>'relation',reference->>'name');
  end loop;

  for target in select * from (values
    ('app.entities','workspace_id,id'),
    ('app.entity_types','workspace_id,id'),
    ('app.entity_schema_versions','workspace_id,type_id,schema_version'),
    ('app.entity_issuers','workspace_id,code'),
    ('app.entity_identifier_rules','workspace_id,id'),
    ('app.entity_type_identity','workspace_id,type_id'),
    ('app.entity_type_identity_sources','workspace_id,type_id,code'),
    ('app.entity_relation_definitions','workspace_id,id'),
    ('app.entity_relation_links','workspace_id,definition_id,left_entity_id,right_entity_id'),
    ('app.data_model_changes','workspace_id,id'),
    ('app.data_model_children','workspace_id,model_id,type_ref'),
    ('app.entity_schema_changes','workspace_id,id'),
    ('app.entity_schema_analyses','workspace_id,id'),
    ('app.entity_schema_migrations','workspace_id,id'),
    ('private.entity_schema_analysis_rows','workspace_id,analysis_id,entity_id'),
    ('private.entity_schema_migration_rows','workspace_id,job_id,entity_id')
  ) as identities(relation,columns) loop
    -- Remove only obsolete owner uniqueness and duplicate copies of the exact
    -- new primary key. Other workspace-qualified alternate keys remain: source
    -- qualified rules, schema job lineage and model child correspondence.
    for constraint_row in
      select c.conname from pg_constraint c where c.conrelid=target.relation::regclass and c.contype='u'
      and (exists(select 1 from pg_attribute a where a.attrelid=c.conrelid and a.attnum=any(c.conkey) and a.attname='owner_id')
        or (target.relation='app.entity_types' and cardinality(c.conkey)=1 and exists(select 1 from pg_attribute a where a.attrelid=c.conrelid and a.attnum=c.conkey[1] and a.attname='id'))
        or (select string_agg(a.attname,',' order by k.position)
          from unnest(c.conkey) with ordinality k(attnum,position)
          join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)=target.columns)
    loop
      execute format('alter table %s drop constraint %I',target.relation,constraint_row.conname);
    end loop;
    execute format('alter table %s alter column workspace_id set not null',target.relation);
    execute format('alter table %s add primary key (%s)',target.relation,target.columns);
  end loop;
  for reference in select value from jsonb_array_elements(references_to_restore) loop
    if not (reference->>'legacy')::boolean then
      execute format('alter table %s add constraint %I %s',reference->>'relation',reference->>'name',reference->>'definition');
    end if;
  end loop;
  -- Prepared record identities belong to a workspace just like their jobs.
  alter table private.entity_schema_migration_rows drop constraint entity_schema_migration_rows_job_id_record_id_key;
  alter table private.entity_schema_migration_rows add unique(workspace_id,job_id,record_id);
  -- Current adapters filter by workspace, never by legacy ownership. Constraint
  -- indexes already disappeared with their keys; remove only standalone owner
  -- indexes on this audited entity-model allowlist, with RESTRICT semantics.
  for constraint_row in
    select i.indexrelid::regclass as relation from pg_index i
    where i.indrelid=any(targets)
      and not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid)
      and exists(select 1 from pg_attribute a where a.attrelid=i.indrelid
        and a.attname='owner_id' and a.attnum=any(i.indkey))
  loop
    execute format('drop index %s',constraint_row.relation);
  end loop;
end $cutover$;

-- NULL affiliation is no longer a supported state. Remove the unreachable
-- owner query branches while preserving publication-time authorization.
create or replace function app.guard_entity_relation_definition_kinds() returns trigger language plpgsql security definer set search_path='' as $$
declare requires_active boolean; available integer; expected integer;
begin
  if new.workspace_id is distinct from app.current_workspace_id() then
   raise exception 'workspace_denied' using errcode='42501';
  end if;
  perform private.authorize_model_publication_requirements(new.workspace_id,'[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb);
  requires_active:=tg_op='INSERT';
  if tg_op='UPDATE' then requires_active:=(not new.archived and old.archived) or new.left_type_id<>old.left_type_id or new.right_type_id<>old.right_type_id;end if;
  if requires_active and not exists(select 1 from private.data_model_publication_context c where c.workspace_id=new.workspace_id and c.pid=pg_backend_pid() and c.txid=txid_current()) then
   perform 1 from app.entity_types t where t.workspace_id=new.workspace_id and t.id in(new.left_type_id,new.right_type_id) order by t.id for share;
   select count(*) into available from app.entity_types t join app.entity_schema_versions v on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version
    where t.workspace_id=new.workspace_id and t.id in(new.left_type_id,new.right_type_id) and not coalesce((v.schema->>'deprecated')::boolean,false);
   expected:=case when new.left_type_id=new.right_type_id then 1 else 2 end;
   if available<>expected then raise exception 'relation_kind_unavailable' using errcode='23514';end if;
  end if;
  return new;
end $$;

create or replace function app.guard_entity_relation_definition() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text||':entity-relations',0));
  if new.workspace_id is distinct from old.workspace_id or new.id is distinct from old.id or new.version<>old.version+1 then
   raise exception 'immutable_relation_identity_or_version' using errcode='23514';
  end if;
  if (new.left_type_id,new.right_type_id,new.left_cardinality,new.right_cardinality) is distinct from
     (old.left_type_id,old.right_type_id,old.left_cardinality,old.right_cardinality) then
   perform private.authorize_workspace_model_kinds(array[old.left_type_id,old.right_type_id,new.left_type_id,new.right_type_id]);
   if exists(select 1 from app.entity_relation_links l join app.entities e on e.workspace_id=l.workspace_id and e.id=l.left_entity_id join app.entities r on r.workspace_id=l.workspace_id and r.id=l.right_entity_id
    where l.workspace_id=new.workspace_id and l.definition_id=new.id and (e.entity_type_id<>new.left_type_id or r.entity_type_id<>new.right_type_id)) then
    raise exception 'relation_type_in_use' using errcode='23514';
   end if;
   if new.left_cardinality='one' and exists(select 1 from app.entity_relation_links where workspace_id=new.workspace_id and definition_id=new.id group by left_entity_id having count(*)>1)
    or new.right_cardinality='one' and exists(select 1 from app.entity_relation_links where workspace_id=new.workspace_id and definition_id=new.id group by right_entity_id having count(*)>1) then
    raise exception 'relation_cardinality_in_use' using errcode='23514';
   end if;
  end if;
  return new;
end $$;

create or replace function private.mark_entity_identity_reference() returns trigger
 language plpgsql security definer set search_path='' as $$
begin

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

-- FK rebinding can change cascade order. A deleted workspace parent permits
-- its exact child teardown independently of whether the kind cascade ran first;
-- deleting an identity assignment from a live workspace remains protected.
create or replace function private.guard_type_identity_source() returns trigger
 language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then
  if exists(select 1 from app.workspaces where id=old.workspace_id)
   and exists(select 1 from app.entity_types where workspace_id=old.workspace_id and id=old.type_id) then
   perform private.authorize_workspace_model_kinds(array[old.type_id]);
   if old.referenced then raise exception 'referenced_mapping_immutable' using errcode='23514';end if;
  end if;
  return old;
 end if;
 if new.rule_id is distinct from old.rule_id or old.referenced and not new.referenced then
  perform private.authorize_workspace_model_kinds(array[old.type_id]);
 end if;
 if new.workspace_id is distinct from old.workspace_id or new.type_id is distinct from old.type_id
  or new.code is distinct from old.code or (old.referenced and (not new.referenced or new.rule_id is distinct from old.rule_id)) then
  raise exception 'referenced_mapping_immutable' using errcode='23514';
 end if;
 return new;
end $$;
