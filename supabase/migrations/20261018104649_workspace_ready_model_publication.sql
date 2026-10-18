-- Publish stored ready plans into their actual workspace. Unassigned historical
-- rows are retained; the legacy argument name p_owner is temporarily kept only
-- to preserve function signatures until all durable callers are converted.
alter table app.data_model_children add column workspace_id uuid references app.workspaces(id) on delete cascade;
alter table app.data_model_children add constraint model_child_workspace_parent_fk foreign key(workspace_id,model_id)
 references app.data_model_changes(workspace_id,id) on delete cascade;
create trigger workspace_model_anchor before insert or update on app.data_model_children
 for each row execute function private.guard_workspace_model_anchor();

CREATE OR REPLACE FUNCTION private.lock_data_model_owner(p_owner uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':entity-relations',0));
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':entity-types',0));
 perform 1 from app.entity_relation_definitions d where d.workspace_id=p_owner order by d.id for update;
 perform 1 from app.entity_types t where t.workspace_id=p_owner order by t.id for update;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':entity-identity-registry',0));
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':record_templates',0));
end $function$

CREATE OR REPLACE FUNCTION private.publish_prepared_model_definitions(p_owner uuid, p_plan jsonb, p_skip uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare target jsonb:=p_plan->'target'; source jsonb:=p_plan->'source'; x jsonb; old jsonb;
 v_type_id uuid; v_rule_id uuid; next_property integer; identity_doc jsonb; old_identity jsonb;
 ends jsonb; old_ends jsonb; counts jsonb; result jsonb;
begin
 perform app.authorize_workspace('[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb);
 if app.current_workspace_id() is distinct from p_owner then
  raise exception 'request_owner_missing' using errcode='42501'; end if;
 if (select count(*) from app.entity_types t where t.workspace_id=p_owner)
   +(select count(*) from jsonb_array_elements(target->'entity_types') z
     where not exists(select 1 from app.entity_types t where t.workspace_id=p_owner
      and t.id=(z->'schema'->>'x-type-id')::uuid))>64
 then raise exception 'entity_type_limit' using errcode='P0001'; end if;
 if (select count(distinct code) from (
  select i.code from app.entity_issuers i where i.workspace_id=p_owner
  union all select z->>'code' from jsonb_array_elements(target->'identity_definitions'->'issuers') z) q)>64
 then raise exception 'issuer_limit' using errcode='P0001'; end if;
 if exists(select 1 from (
  select r.source,r.id from app.entity_identifier_rules r where r.workspace_id=p_owner
  union select z->>'source',(z->>'id')::uuid
   from jsonb_array_elements(target->'identity_definitions'->'rules') z) q
  group by q.source having count(*)>64)
 then raise exception 'rule_limit' using errcode='P0001'; end if;
 for x in select value from jsonb_array_elements(target->'identity_definitions'->'issuers') loop
  select value into old from jsonb_array_elements(source->'identity_definitions'->'issuers') z
   where z->>'code'=x->>'code';
  if (x->>'system')::boolean then
   if x->>'code'<>'app' then raise exception 'invalid system issuer'; end if;
   if old is null then insert into app.entity_issuers(workspace_id,code,label,active,system)
    values(p_owner,'app','앱',true,true); end if;
  elsif old is null then
   insert into app.entity_issuers(workspace_id,code,label,active,system)
    values(p_owner,x->>'code',x->>'label',(x->>'active')::boolean,false);
  elsif (old->'label',old->'active') is distinct from (x->'label',x->'active') then
   update app.entity_issuers i set label=x->>'label',active=(x->>'active')::boolean,version=i.version+1
    where i.workspace_id=p_owner and i.code=x->>'code' and i.version=(old->>'version')::integer;
   if not found then raise exception 'schema_plan_stale' using errcode='P0001'; end if;
  end if;
 end loop;
 for x in select value from jsonb_array_elements(target->'identity_definitions'->'rules') loop
  v_rule_id:=(x->>'id')::uuid;
  select value into old from jsonb_array_elements(source->'identity_definitions'->'rules') z
   where (z->>'id')::uuid=v_rule_id;
  if old is null then
   insert into app.entity_identifier_rules(workspace_id,id,source,label,meaning,generation,active)
    values(p_owner,v_rule_id,x->>'source',x->>'label',x->>'meaning',x->>'generation',(x->>'active')::boolean);
  elsif v_rule_id<>'00000000-0000-4000-8000-000000000001'::uuid then
   if (old->'source',old->'generation') is distinct from (x->'source',x->'generation')
    then raise exception 'immutable rule identity' using errcode='P0001'; end if;
   if old->'meaning' is distinct from x->'meaning' and exists(
    select 1 from app.entity_type_identity_sources s where s.workspace_id=p_owner
     and s.rule_id=v_rule_id and s.referenced)
    then raise exception 'referenced rule meaning' using errcode='P0001'; end if;
   if (old->'label',old->'meaning',old->'active') is distinct from (x->'label',x->'meaning',x->'active') then
    update app.entity_identifier_rules r set label=x->>'label',meaning=x->>'meaning',
     active=(x->>'active')::boolean,version=r.version+1
     where r.workspace_id=p_owner and r.id=v_rule_id and r.version=(old->>'version')::integer;
    if not found then raise exception 'schema_plan_stale' using errcode='P0001'; end if;
   end if;
  end if;
 end loop;
 for x in select value from jsonb_array_elements(target->'entity_types') loop
  v_type_id:=(x->'schema'->>'x-type-id')::uuid;
  select value into old from jsonb_array_elements(source->'entity_types') z
   where (z->'schema'->>'x-type-id')::uuid=v_type_id;
  select coalesce(max(substring(k from 6)::integer),1)+1 into next_property
   from jsonb_object_keys(x->'schema'->'properties') k;
  if old is null then
   insert into app.entity_types(workspace_id,id,next_property_number) values(p_owner,v_type_id,next_property);
  end if;
  if not (v_type_id=any(p_skip)) then
   if exists(select 1 from app.entity_types t where t.workspace_id=p_owner and t.id=v_type_id
    and t.schema_write_locked) then raise exception 'schema_migration_in_progress' using errcode='P0001'; end if;
   if old is null or ((old->'schema') - 'x-version') is distinct from ((x->'schema') - 'x-version') then
    insert into app.entity_schema_versions(workspace_id,schema) values(p_owner,x->'schema');
    update app.entity_types t set schema_version=(x->'schema'->>'x-version')::integer,
     next_property_number=greatest(t.next_property_number,next_property),updated_at=now()
     where t.workspace_id=p_owner and t.id=v_type_id;
   end if;
  elsif not exists(select 1 from app.entity_types t join app.entity_schema_versions v
   on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version
   where t.workspace_id=p_owner and t.id=v_type_id and v.schema=x->'schema') then
   raise exception 'group_schema_publication_mismatch' using errcode='P0001';
  end if;
  identity_doc:=jsonb_set(x->'identity','{sources}',(select jsonb_agg(z order by z->>'code') from jsonb_array_elements(x->'identity'->'sources') z)); old_identity:=old->'identity';
  if old is null then
   insert into app.entity_type_identity(workspace_id,type_id,label,default_source)
    values(p_owner,v_type_id,identity_doc->>'label',identity_doc->>'default_source');
   insert into app.entity_type_identity_sources(workspace_id,type_id,code,rule_id,active)
    select p_owner,v_type_id,z->>'code',(z->>'rule_id')::uuid,(z->>'active')::boolean
     from jsonb_array_elements(identity_doc->'sources') z;
  elsif (old_identity-'version') is distinct from (identity_doc-'version') then
   if exists(select 1 from app.entity_type_identity_sources s
    where s.workspace_id=p_owner and s.type_id=v_type_id and s.referenced and not exists(
     select 1 from jsonb_array_elements(identity_doc->'sources') z
     where z->>'code'=s.code and (z->>'rule_id')::uuid=s.rule_id))
    then raise exception 'referenced identity source' using errcode='P0001'; end if;
   if exists(select 1 from jsonb_array_elements(identity_doc->'sources') z
    where not exists(select 1 from app.entity_identifier_rules r join app.entity_issuers i
     on i.workspace_id=r.workspace_id and i.code=r.source where r.workspace_id=p_owner
     and i.workspace_id=p_owner and r.id=(z->>'rule_id')::uuid and r.source=z->>'code'))
    then raise exception 'identity source unavailable' using errcode='P0001'; end if;
   delete from app.entity_type_identity_sources s where s.workspace_id=p_owner and s.type_id=v_type_id
    and not exists(select 1 from jsonb_array_elements(identity_doc->'sources') z where z->>'code'=s.code);
   insert into app.entity_type_identity_sources(workspace_id,type_id,code,rule_id,active)
    select p_owner,v_type_id,z->>'code',(z->>'rule_id')::uuid,(z->>'active')::boolean
     from jsonb_array_elements(identity_doc->'sources') z
    on conflict(workspace_id,type_id,code) do update set rule_id=excluded.rule_id,active=excluded.active;
   update app.entity_type_identity i set label=identity_doc->>'label',default_source=identity_doc->>'default_source',version=i.version+1
    where i.workspace_id=p_owner and i.type_id=v_type_id and i.version=(old_identity->>'version')::integer;
   if not found then raise exception 'schema_plan_stale' using errcode='P0001'; end if;
  end if;
 end loop;
 for x in select value from jsonb_array_elements(target->'relations') loop
  select value into old from jsonb_array_elements(source->'relations') z where z->>'id'=x->>'id';
  select jsonb_agg(jsonb_build_object('type_id',p_plan->'review'->'mapping'->'types'->>(z->>'type_ref'),
   'label',z->>'label','cardinality',z->>'cardinality') order by ord) into ends
   from jsonb_array_elements(x->'ends') with ordinality q(z,ord);
  select jsonb_agg(jsonb_build_object('type_id',t->'schema'->>'x-type-id',
   'label',z->>'label','cardinality',z->>'cardinality') order by ord) into old_ends
   from jsonb_array_elements(old->'ends') with ordinality q(z,ord)
   join lateral (select y from jsonb_array_elements(source->'entity_types') y
    where y->>'ref'=z->>'type_ref') matched(t) on true;
  if old is null or ends is distinct from old_ends or old->'archived' is distinct from x->'archived' then
   -- Executes with function owner privileges, but the public actor remains the verified stored owner.
   -- app_worker receives no grant on this public function itself.
   perform app.publish_data_model_relation((x->>'id')::uuid,(old->>'version')::integer,
     ends,(x->>'archived')::boolean);
  end if;
 end loop;
 with entries as (
  select z,case when exists(select 1 from jsonb_array_elements(target->'entity_types') t where t->>'ref'=z->>'ref') then 'types' when z->>'ref' like 'relation:%' then 'relations'
   when z->>'ref' like 'issuer:%' then 'issuers'
   when z->>'ref' like 'rule:%' then 'rules' else 'types' end category
  from jsonb_array_elements(p_plan->'review'->'items') z),
 summaries as (
  select category,jsonb_build_object(
   'added',count(*) filter(where z->>'kind'='new'),
   'updated',count(*) filter(where z->>'kind' in ('compatible','migration_required')),
   'unchanged',count(*) filter(where z->>'kind'='unchanged')) value
  from entries group by category)
 select jsonb_build_object('types',coalesce((select value from summaries where category='types'),'{"added":0,"updated":0,"unchanged":0}'::jsonb),
  'relations',coalesce((select value from summaries where category='relations'),'{"added":0,"updated":0,"unchanged":0}'::jsonb),
  'issuers',coalesce((select value from summaries where category='issuers'),'{"added":0,"updated":0,"unchanged":0}'::jsonb),
  'rules',coalesce((select value from summaries where category='rules'),'{"added":0,"updated":0,"unchanged":0}'::jsonb)) into counts;
 result:=jsonb_build_object('counts',counts,'changed',exists(
  select 1 from jsonb_each(counts) q where (q.value->>'added')::integer+(q.value->>'updated')::integer>0),
  'type_ids',coalesce((select jsonb_agg(z->'schema'->>'x-type-id') from jsonb_array_elements(target->'entity_types') z),'[]'::jsonb),
  'relation_ids',coalesce((select jsonb_agg(z->>'id') from jsonb_array_elements(target->'relations') z),'[]'::jsonb));
 return result;
end $function$

create or replace function app.publish_prepared_data_model(p_id uuid,p_version integer) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare v_workspace uuid:=app.current_workspace_id();v_group app.data_model_changes%rowtype;
begin
 perform app.lock_workspace_account();
 perform app.lock_workspace(v_workspace,false);
 perform app.authorize_workspace('[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb);
 perform private.lock_data_model_owner(v_workspace);
 select * into v_group from app.data_model_changes g where g.workspace_id=v_workspace and g.id=p_id for update;
 if not found or v_group.workspace_generation is distinct from app.workspace_generation()
  or v_group.version<>p_version or v_group.status<>'ready'
  or not coalesce((v_group.plan->'review'->>'can_apply')::boolean,false)
  or exists(select 1 from app.data_model_children c where c.workspace_id=v_workspace and c.model_id=p_id)
  or private.data_model_document(v_workspace) is distinct from v_group.plan->'source'
 then raise exception 'schema_plan_stale' using errcode='P0001';end if;
 return private.publish_prepared_model_definitions(v_workspace,v_group.plan,'{}'::uuid[]);
end $$;
revoke all on function app.publish_prepared_data_model(uuid,integer) from public,anon,authenticated,app_worker;
grant execute on function app.publish_prepared_data_model(uuid,integer) to app_user;
