begin;
-- Durable whole-model coordination; the single-kind preparation material stays canonical.
alter table app.data_model_changes drop constraint data_model_changes_status_check;
alter table app.data_model_changes add constraint data_model_changes_status_check check(status in ('needs_conversion','analyzing','ready','queued','preparing','ready_to_commit','committing','failed','applied','cancelled'));
alter table app.data_model_changes add column fence bigint not null default 0,add column lease_until timestamptz,add column retryable boolean not null default false,add column failure_reason text,add column source_memberships jsonb,add column source_templates jsonb,add column source_expires_at timestamptz,add column updated_at timestamptz not null default now();
alter table app.entity_schema_changes add column model_change_id uuid,add foreign key(owner_id,model_change_id) references app.data_model_changes(owner_id,id) on delete cascade;
alter table app.entity_schema_migrations add column model_change_id uuid,add foreign key(owner_id,model_change_id) references app.data_model_changes(owner_id,id) on delete cascade;
create table app.data_model_children(
 owner_id uuid not null,model_id uuid not null,type_ref text not null,type_id uuid not null,change_id uuid not null,analysis_id uuid,job_id uuid,
 primary key(owner_id,model_id,type_ref),unique(owner_id,model_id,type_id),unique(owner_id,change_id),
 foreign key(owner_id,model_id) references app.data_model_changes(owner_id,id) on delete cascade,
 foreign key(owner_id,type_id) references app.entity_types(owner_id,id),
 foreign key(owner_id,change_id) references app.entity_schema_changes(owner_id,id) on delete cascade,
 foreign key(owner_id,analysis_id) references app.entity_schema_analyses(owner_id,id),
 foreign key(owner_id,job_id) references app.entity_schema_migrations(owner_id,id));
alter table app.data_model_children enable row level security;
create policy model_children_owner on app.data_model_children for all to app_user using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on app.data_model_children from public,anon,authenticated,app_server,app_worker;
grant select,insert,update on app.data_model_children to app_user;
create index model_children_analysis on app.data_model_children(analysis_id) where analysis_id is not null;
create unique index model_children_job on app.data_model_children(job_id) where job_id is not null;
create index model_job_affiliation on app.entity_schema_migrations(owner_id,model_change_id) where model_change_id is not null;
create index model_group_queue on app.data_model_changes(created_at,id) where status in ('queued','preparing','ready_to_commit','committing');

-- Every group writer, including analysis completion, obtains these before child/entity rows.
create function private.lock_data_model_owner(p_owner uuid) returns void language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':entity-relations',0));
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':entity-types',0));
 perform 1 from app.entity_relation_definitions d where d.owner_id=p_owner order by d.id for update;
 perform 1 from app.entity_types t where t.owner_id=p_owner order by t.id for update;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':entity-identity-registry',0));
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':record_templates',0));
end $$;
revoke all on function private.lock_data_model_owner(uuid) from public,anon,authenticated,app_user,app_server,app_worker;

-- Called by writes/worker completions only. GET never consumes or advances work.
create function app.refresh_data_model_analysis(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();v_group app.data_model_changes%rowtype;v_status text;v_pending boolean;v_failed boolean;
begin
 if v_owner is null then raise exception 'request_owner_missing' using errcode='42501';end if;
 perform private.lock_data_model_owner(v_owner);
 select * into v_group from app.data_model_changes g where g.owner_id=v_owner and g.id=p_id for update;
 if not found or v_group.status not in ('analyzing','needs_conversion','ready') then return;end if;
 select coalesce(bool_or(a.status in ('queued','running')),false),coalesce(bool_or(a.status='failed' or a.failed>0 or d.status='stale'),false) into v_pending,v_failed
 from app.data_model_children c join app.entity_schema_analyses a on a.owner_id=c.owner_id and a.id=c.analysis_id join app.entity_schema_changes d on d.owner_id=c.owner_id and d.id=c.change_id where c.owner_id=v_owner and c.model_id=p_id;
 v_status:=case when v_pending then 'analyzing' when v_failed then 'needs_conversion' else 'ready' end;
 update app.data_model_changes g set status=v_status,version=g.version+case when g.status<>v_status then 1 else 0 end,
 plan=jsonb_set(g.plan,'{review,can_apply}',to_jsonb(v_status='ready')),updated_at=now() where g.owner_id=v_owner and g.id=p_id;
end $$;
revoke all on function app.refresh_data_model_analysis(uuid) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.refresh_data_model_analysis(uuid) to app_user;

create function private.data_model_document(p_owner uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object(
 'format','workspace-data-model','format_version',1,'title','자료 모델',
 'entity_types',coalesce((select jsonb_agg(jsonb_build_object(
  'ref','type_'||t.id::text,'schema',v.schema,
  'identity',jsonb_build_object('version',i.version,'label',i.label,
   'default_source',i.default_source,'sources',coalesce((
    select jsonb_agg(jsonb_build_object('code',s.code,'rule_id',s.rule_id,'active',s.active)
                     order by s.code)
    from app.entity_type_identity_sources s
    where s.owner_id=p_owner and s.type_id=t.id),'[]'::jsonb))) order by t.id)
  from app.entity_types t join app.entity_schema_versions v
   on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version
  join app.entity_type_identity i on i.owner_id=t.owner_id and i.type_id=t.id
  where t.owner_id=p_owner),'[]'::jsonb),
 'relations',coalesce((select jsonb_agg(jsonb_build_object(
  'id',d.id,'version',d.version,'archived',d.archived,'ends',jsonb_build_array(
   jsonb_build_object('type_ref','type_'||d.left_type_id::text,'label',d.left_label,'cardinality',d.left_cardinality),
   jsonb_build_object('type_ref','type_'||d.right_type_id::text,'label',d.right_label,'cardinality',d.right_cardinality))) order by d.id)
  from app.entity_relation_definitions d where d.owner_id=p_owner),'[]'::jsonb),
 'identity_definitions',jsonb_build_object(
  'issuers',coalesce((select jsonb_agg(jsonb_build_object('code',i.code,'label',i.label,
   'active',i.active,'system',i.system,'version',i.version) order by i.code)
   from app.entity_issuers i where i.owner_id=p_owner),'[]'::jsonb),
  'rules',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'source',r.source,
   'label',r.label,'meaning',r.meaning,'generation',r.generation,
   'active',r.active,'version',r.version) order by r.id)
   from app.entity_identifier_rules r where r.owner_id=p_owner),'[]'::jsonb)))
$$;
revoke all on function private.data_model_document(uuid)
 from public,anon,authenticated,app_user,app_server,app_worker;

create function private.publish_prepared_model_definitions(p_owner uuid,p_plan jsonb,p_skip uuid[])
returns jsonb language plpgsql set search_path='' as $$
declare target jsonb:=p_plan->'target'; source jsonb:=p_plan->'source'; x jsonb; old jsonb;
 v_type_id uuid; v_rule_id uuid; next_property integer; identity_doc jsonb; old_identity jsonb;
 ends jsonb; old_ends jsonb; counts jsonb; result jsonb;
begin
 if auth.uid() is distinct from p_owner then
  raise exception 'request_owner_missing' using errcode='42501'; end if;
 if (select count(*) from app.entity_types t where t.owner_id=p_owner)
   +(select count(*) from jsonb_array_elements(target->'entity_types') z
     where not exists(select 1 from app.entity_types t where t.owner_id=p_owner
      and t.id=(z->'schema'->>'x-type-id')::uuid))>64
 then raise exception 'entity_type_limit' using errcode='P0001'; end if;
 if (select count(distinct code) from (
  select i.code from app.entity_issuers i where i.owner_id=p_owner
  union all select z->>'code' from jsonb_array_elements(target->'identity_definitions'->'issuers') z) q)>64
 then raise exception 'issuer_limit' using errcode='P0001'; end if;
 if exists(select 1 from (
  select r.source,r.id from app.entity_identifier_rules r where r.owner_id=p_owner
  union select z->>'source',(z->>'id')::uuid
   from jsonb_array_elements(target->'identity_definitions'->'rules') z) q
  group by q.source having count(*)>64)
 then raise exception 'rule_limit' using errcode='P0001'; end if;
 for x in select value from jsonb_array_elements(target->'identity_definitions'->'issuers') loop
  select value into old from jsonb_array_elements(source->'identity_definitions'->'issuers') z
   where z->>'code'=x->>'code';
  if (x->>'system')::boolean then
   if x->>'code'<>'app' then raise exception 'invalid system issuer'; end if;
   if old is null then insert into app.entity_issuers(owner_id,code,label,active,system)
    values(p_owner,'app','앱',true,true); end if;
  elsif old is null then
   insert into app.entity_issuers(owner_id,code,label,active,system)
    values(p_owner,x->>'code',x->>'label',(x->>'active')::boolean,false);
  elsif (old->'label',old->'active') is distinct from (x->'label',x->'active') then
   update app.entity_issuers i set label=x->>'label',active=(x->>'active')::boolean,version=i.version+1
    where i.owner_id=p_owner and i.code=x->>'code' and i.version=(old->>'version')::integer;
   if not found then raise exception 'schema_plan_stale' using errcode='P0001'; end if;
  end if;
 end loop;
 for x in select value from jsonb_array_elements(target->'identity_definitions'->'rules') loop
  v_rule_id:=(x->>'id')::uuid;
  select value into old from jsonb_array_elements(source->'identity_definitions'->'rules') z
   where (z->>'id')::uuid=v_rule_id;
  if old is null then
   insert into app.entity_identifier_rules(owner_id,id,source,label,meaning,generation,active)
    values(p_owner,v_rule_id,x->>'source',x->>'label',x->>'meaning',x->>'generation',(x->>'active')::boolean);
  elsif v_rule_id<>'00000000-0000-4000-8000-000000000001'::uuid then
   if (old->'source',old->'generation') is distinct from (x->'source',x->'generation')
    then raise exception 'immutable rule identity' using errcode='P0001'; end if;
   if old->'meaning' is distinct from x->'meaning' and exists(
    select 1 from app.entity_type_identity_sources s where s.owner_id=p_owner
     and s.rule_id=v_rule_id and s.referenced)
    then raise exception 'referenced rule meaning' using errcode='P0001'; end if;
   if (old->'label',old->'meaning',old->'active') is distinct from (x->'label',x->'meaning',x->'active') then
    update app.entity_identifier_rules r set label=x->>'label',meaning=x->>'meaning',
     active=(x->>'active')::boolean,version=r.version+1
     where r.owner_id=p_owner and r.id=v_rule_id and r.version=(old->>'version')::integer;
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
   insert into app.entity_types(owner_id,id,next_property_number) values(p_owner,v_type_id,next_property);
  end if;
  if not (v_type_id=any(p_skip)) then
   if exists(select 1 from app.entity_types t where t.owner_id=p_owner and t.id=v_type_id
    and t.schema_write_locked) then raise exception 'schema_migration_in_progress' using errcode='P0001'; end if;
   if old is null or ((old->'schema') - 'x-version') is distinct from ((x->'schema') - 'x-version') then
    insert into app.entity_schema_versions(owner_id,schema) values(p_owner,x->'schema');
    update app.entity_types t set schema_version=(x->'schema'->>'x-version')::integer,
     next_property_number=greatest(t.next_property_number,next_property),updated_at=now()
     where t.owner_id=p_owner and t.id=v_type_id;
   end if;
  elsif not exists(select 1 from app.entity_types t join app.entity_schema_versions v
   on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version
   where t.owner_id=p_owner and t.id=v_type_id and v.schema=x->'schema') then
   raise exception 'group_schema_publication_mismatch' using errcode='P0001';
  end if;
  identity_doc:=jsonb_set(x->'identity','{sources}',(select jsonb_agg(z order by z->>'code') from jsonb_array_elements(x->'identity'->'sources') z)); old_identity:=old->'identity';
  if old is null then
   insert into app.entity_type_identity(owner_id,type_id,label,default_source)
    values(p_owner,v_type_id,identity_doc->>'label',identity_doc->>'default_source');
   insert into app.entity_type_identity_sources(owner_id,type_id,code,rule_id,active)
    select p_owner,v_type_id,z->>'code',(z->>'rule_id')::uuid,(z->>'active')::boolean
     from jsonb_array_elements(identity_doc->'sources') z;
  elsif (old_identity-'version') is distinct from (identity_doc-'version') then
   if exists(select 1 from app.entity_type_identity_sources s
    where s.owner_id=p_owner and s.type_id=v_type_id and s.referenced and not exists(
     select 1 from jsonb_array_elements(identity_doc->'sources') z
     where z->>'code'=s.code and (z->>'rule_id')::uuid=s.rule_id))
    then raise exception 'referenced identity source' using errcode='P0001'; end if;
   if exists(select 1 from jsonb_array_elements(identity_doc->'sources') z
    where not exists(select 1 from app.entity_identifier_rules r join app.entity_issuers i
     on i.owner_id=r.owner_id and i.code=r.source where r.owner_id=p_owner
     and i.owner_id=p_owner and r.id=(z->>'rule_id')::uuid and r.source=z->>'code'))
    then raise exception 'identity source unavailable' using errcode='P0001'; end if;
   delete from app.entity_type_identity_sources s where s.owner_id=p_owner and s.type_id=v_type_id
    and not exists(select 1 from jsonb_array_elements(identity_doc->'sources') z where z->>'code'=s.code);
   insert into app.entity_type_identity_sources(owner_id,type_id,code,rule_id,active)
    select p_owner,v_type_id,z->>'code',(z->>'rule_id')::uuid,(z->>'active')::boolean
     from jsonb_array_elements(identity_doc->'sources') z
    on conflict(owner_id,type_id,code) do update set rule_id=excluded.rule_id,active=excluded.active;
   update app.entity_type_identity i set label=identity_doc->>'label',default_source=identity_doc->>'default_source',version=i.version+1
    where i.owner_id=p_owner and i.type_id=v_type_id and i.version=(old_identity->>'version')::integer;
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
end $$;
revoke all on function private.publish_prepared_model_definitions(uuid,jsonb,uuid[])
 from public,anon,authenticated,app_user,app_server,app_worker;

-- App users supply a stored review identity, never a worker plan or owner.
create function app.publish_prepared_data_model(p_id uuid,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();v_group app.data_model_changes%rowtype;
begin
 if v_owner is null then raise exception 'request_owner_missing' using errcode='42501';end if;
 perform private.lock_data_model_owner(v_owner);
 select * into v_group from app.data_model_changes g where g.owner_id=v_owner and g.id=p_id for update;
 if not found or v_group.version<>p_version or v_group.status<>'ready' or not coalesce((v_group.plan->'review'->>'can_apply')::boolean,false)
  or exists(select 1 from app.data_model_children c where c.owner_id=v_owner and c.model_id=p_id)
  or private.data_model_document(v_owner) is distinct from v_group.plan->'source'
 then raise exception 'schema_plan_stale' using errcode='P0001';end if;
 return private.publish_prepared_model_definitions(v_owner,v_group.plan,'{}'::uuid[]);
end $$;
revoke all on function app.publish_prepared_data_model(uuid,integer) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.publish_prepared_data_model(uuid,integer) to app_user;

create table private.data_model_commit_context(owner_id uuid not null,model_id uuid not null,pid integer not null,txid bigint not null,primary key(owner_id,model_id,pid,txid));
revoke all on private.data_model_commit_context from public,anon,authenticated,app_user,app_server,app_worker;
alter function app.stage_entity_schema_migration(uuid,bigint,jsonb) set schema private;
revoke all on function private.stage_entity_schema_migration(uuid,bigint,jsonb) from public,anon,authenticated,app_user,app_server,app_worker;
alter function app.fail_entity_schema_migration(uuid,bigint,text,boolean) set schema private;
revoke all on function private.fail_entity_schema_migration(uuid,bigint,text,boolean) from public,anon,authenticated,app_user,app_server,app_worker;
alter function app.commit_entity_schema_migration(uuid,bigint,text,text) set schema private;
revoke all on function private.commit_entity_schema_migration(uuid,bigint,text,text) from public,anon,authenticated,app_user,app_server,app_worker;
alter function app.complete_entity_schema_analysis_batch(uuid,bigint,jsonb) set schema private;
revoke all on function private.complete_entity_schema_analysis_batch(uuid,bigint,jsonb) from public,anon,authenticated,app_user,app_server,app_worker;
alter function app.fail_entity_schema_analysis(uuid,bigint) set schema private;
revoke all on function private.fail_entity_schema_analysis(uuid,bigint) from public,anon,authenticated,app_user,app_server,app_worker;

create function private.lock_data_model_analysis(p_id uuid) returns uuid language plpgsql set search_path='' as $$
declare v_owner uuid;v_group uuid;
begin
 select c.owner_id,c.model_change_id into v_owner,v_group from app.entity_schema_analyses a join app.entity_schema_changes c on c.owner_id=a.owner_id and c.id=a.change_id where a.id=p_id;
 if v_group is null then return null;end if;
 perform private.lock_data_model_owner(v_owner);
 perform 1 from app.data_model_changes g where g.owner_id=v_owner and g.id=v_group for update;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
 return v_group;
end $$;
revoke all on function private.lock_data_model_analysis(uuid) from public,anon,authenticated,app_user,app_server,app_worker;
create function app.complete_entity_schema_analysis_batch(p_id uuid,p_fence bigint,p_results jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare v_group uuid;v_result boolean;
begin
 v_group:=private.lock_data_model_analysis(p_id);
 v_result:=private.complete_entity_schema_analysis_batch(p_id,p_fence,p_results);
 if v_group is not null and v_result then perform app.refresh_data_model_analysis(v_group);end if;
 return v_result;
end $$;
create function app.fail_entity_schema_analysis(p_id uuid,p_fence bigint) returns boolean language plpgsql security definer set search_path='' as $$
declare v_group uuid;v_result boolean;
begin
 v_group:=private.lock_data_model_analysis(p_id);
 v_result:=private.fail_entity_schema_analysis(p_id,p_fence);
 if v_group is not null and v_result then perform app.refresh_data_model_analysis(v_group);end if;
 return v_result;
end $$;
create function app.stage_entity_schema_migration(p_id uuid,p_fence bigint,p_results jsonb) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from app.entity_schema_migrations j where j.id=p_id and j.model_change_id is not null) then return false;end if;
 return private.stage_entity_schema_migration(p_id,p_fence,p_results);
end $$;
create function app.fail_entity_schema_migration(p_id uuid,p_fence bigint,p_reason text,p_retryable boolean) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from app.entity_schema_migrations j where j.id=p_id and j.model_change_id is not null) then return false;end if;
 return private.fail_entity_schema_migration(p_id,p_fence,p_reason,p_retryable);
end $$;
create function app.commit_entity_schema_migration(p_id uuid,p_fence bigint,p_template_fingerprint text,p_pipeline text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from app.entity_schema_migrations j where j.id=p_id and j.model_change_id is not null) then return false;end if;
 return private.commit_entity_schema_migration(p_id,p_fence,p_template_fingerprint,p_pipeline);
end $$;
revoke all on function app.complete_entity_schema_analysis_batch(uuid,bigint,jsonb),app.fail_entity_schema_analysis(uuid,bigint),app.stage_entity_schema_migration(uuid,bigint,jsonb),app.fail_entity_schema_migration(uuid,bigint,text,boolean),app.commit_entity_schema_migration(uuid,bigint,text,text) from public,anon,authenticated,app_user,app_server;
grant execute on function app.complete_entity_schema_analysis_batch(uuid,bigint,jsonb),app.fail_entity_schema_analysis(uuid,bigint),app.stage_entity_schema_migration(uuid,bigint,jsonb),app.fail_entity_schema_migration(uuid,bigint,text,boolean),app.commit_entity_schema_migration(uuid,bigint,text,text) to app_worker;

create or replace function private.commit_entity_schema_migration(p_id uuid,p_fence bigint,p_template_fingerprint text,p_pipeline text) returns boolean language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_type_id uuid; v_job app.entity_schema_migrations%rowtype; v_type app.entity_types%rowtype; v_change app.entity_schema_changes%rowtype; v_next_schema integer; v_count integer;
begin
 select x.owner_id,x.type_id into v_owner,v_type_id from app.entity_schema_migrations x where x.id=p_id;
 if v_owner is null then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':entity-types',0));
 select * into v_type from app.entity_types x where x.owner_id=v_owner and x.id=v_type_id for update;
 select * into v_job from app.entity_schema_migrations where id=p_id for update;
 if v_job.status<>'committing' or v_job.fence<>p_fence or v_job.lease_until<=now() then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':record_templates',0));
 select * into v_change from app.entity_schema_changes where owner_id=v_owner and id=v_job.change_id for update;
 if not v_type.schema_write_locked or v_type.schema_version<>v_job.source_schema_version or v_change.version<>v_job.change_version or v_change.fingerprint<>v_job.fingerprint or v_change.analysis_id<>v_job.analysis_id or v_change.status<>'ready' or app.entity_schema_membership(v_owner,v_type_id)<>v_job.membership or p_template_fingerprint<>v_job.source_template_fingerprint or private.entity_schema_effective_templates(v_owner,v_type_id)<>v_job.source_templates or app.entity_schema_reference_baseline(v_owner,v_type_id)<>v_job.source_references then
 perform app.fail_entity_schema_migration(p_id,p_fence,'schema_plan_stale',false); return false; end if;
 if p_pipeline is null or char_length(p_pipeline) not between 1 and 120 then raise exception 'invalid pipeline' using errcode='22023'; end if;
 if v_job.processed<>v_job.total or (select count(*) from private.entity_schema_migration_rows where job_id=p_id and prepared)<>v_job.total then raise exception 'incomplete migration' using errcode='22023'; end if;
 perform 1 from app.entities e where e.owner_id=v_owner and e.entity_type_id=v_type_id order by e.id collate "C" for update;
 if not exists(select 1 from private.data_model_commit_context ctx where ctx.owner_id=v_owner and ctx.model_id=v_job.model_change_id and ctx.pid=pg_backend_pid() and ctx.txid=txid_current()) and not coalesce((v_job.target->'schema'->>'deprecated')::boolean,false)
 and exists(select 1 from app.entity_schema_versions s where s.owner_id=v_owner and s.type_id=v_type_id and s.schema_version=v_type.schema_version
  and (coalesce((s.schema->>'deprecated')::boolean,false) or s.schema->>'title' is distinct from v_job.target->'schema'->>'title'))
 and exists(select 1 from app.entity_types t join app.entity_schema_versions s on s.owner_id=t.owner_id and s.type_id=t.id and s.schema_version=t.schema_version
  where t.owner_id=v_owner and t.id<>v_type_id and not coalesce((s.schema->>'deprecated')::boolean,false) and s.schema->>'title'=v_job.target->'schema'->>'title') then
  perform app.fail_entity_schema_migration(p_id,p_fence,'schema_plan_stale',false); return false;
 end if;
 v_next_schema=v_type.schema_version+1;
 insert into app.entity_schema_versions(owner_id,schema) values(v_owner,(v_job.target->'schema')||jsonb_build_object('x-type-id',v_type_id,'x-version',v_next_schema));
 update app.entities e set properties=r.after,schema_version=v_next_schema,version=e.version+1,updated_at=now() from private.entity_schema_migration_rows r where r.job_id=p_id and r.owner_id=e.owner_id and r.entity_id=e.id and e.entity_type_id=v_type_id and e.version=r.source_version;
 get diagnostics v_count=row_count;
 if v_count<>v_job.total then
  if exists(select 1 from private.data_model_commit_context ctx where ctx.owner_id=v_owner and ctx.model_id=v_job.model_change_id and ctx.pid=pg_backend_pid() and ctx.txid=txid_current()) then raise exception 'schema_plan_stale' using errcode='P0001';end if;
  raise exception 'migration source changed' using errcode='40001';
 end if;
 update private.entity_schema_migration_rows set committed_version=source_version+1 where job_id=p_id;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
 insert into app.records(owner_id,id,entity_ids,entity_context,body,record_kind,change_metadata)
 select v_owner,r.record_id,array[r.entity_id],r.record_context,r.record_body,'change',jsonb_build_object('event_id',r.record_id,'target_kind','entity','target_id',r.entity_id,'target_title',r.after->>((select key from jsonb_each(v_job.target->'schema'->'properties') where value->'x-representative'='true'::jsonb)),'action','update','source',v_job.actor_source,'before',null,'after',null,'path',r.record_path,'schema_migration_id',v_job.id)
 from private.entity_schema_migration_rows r where r.job_id=p_id and r.changed;
 insert into app.record_tags(owner_id,record_id,tag_id) select v_owner,r.record_id,tag.id from private.entity_schema_migration_rows r cross join lateral jsonb_array_elements_text(r.record_tags) ids(id) join app.tags tag on tag.owner_id=v_owner and tag.scope='record' and tag.id=ids.id where r.job_id=p_id and r.changed;
 with queued as (insert into pgmq.q_search_index(vt,message) select now(),jsonb_build_object('owner_id',v_owner,'kind','record','id',r.record_id,'input_hash',r.record_hash,'pipeline',p_pipeline) from private.entity_schema_migration_rows r where r.job_id=p_id and r.changed returning msg_id,message)
 insert into app.search_index_state(owner_id,kind,id,input_hash,pipeline,message_id) select v_owner,'record',message->>'id',message->>'input_hash',p_pipeline,msg_id from queued;
 update app.entity_types set schema_version=v_next_schema,schema_write_locked=false,updated_at=now() where owner_id=v_owner and id=v_type_id;
 update app.entity_schema_changes set status='applied',updated_at=now() where owner_id=v_owner and id=v_job.change_id;
 update app.entity_schema_migrations set status='succeeded',version=version+1,lease_until=null,retryable=false,failure_reason=null,source_expires_at=now()+interval '30 days',committed_membership=app.entity_schema_membership(v_owner,v_type_id),committed_references=app.entity_schema_reference_baseline(v_owner,v_type_id),result=jsonb_build_object('schema_version',v_next_schema,'total',v_job.total,'changed',(select count(*) from private.entity_schema_migration_rows where job_id=p_id and changed),'committed_at',now()),updated_at=now() where id=p_id;
 return true;
end $$;

create or replace function app.claim_entity_schema_migration() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_candidate uuid; v_owner uuid; v_type_id uuid; v_job app.entity_schema_migrations%rowtype; v_batch jsonb;
begin
 perform private.cleanup_entity_schema_sources();
 select x.id,x.owner_id,x.type_id into v_candidate,v_owner,v_type_id from app.entity_schema_migrations x where x.model_change_id is null and (x.status in ('queued','ready_to_commit') or (x.status in ('preparing','committing') and x.lease_until<now())) order by x.created_at,x.id limit 1;
 if v_candidate is null then return null; end if;
 perform 1 from app.entity_types t where t.owner_id=v_owner and t.id=v_type_id for update;
 select * into v_job from app.entity_schema_migrations where id=v_candidate for update;
 if v_job.model_change_id is not null then return null;end if;
 if not(v_job.status in ('queued','ready_to_commit') or (v_job.status in ('preparing','committing') and v_job.lease_until<now())) then return null; end if;
 update app.entity_schema_migrations set status=case when status in ('ready_to_commit','committing') then 'committing' else 'preparing' end,fence=fence+1,version=version+1,lease_until=now()+interval '90 seconds',updated_at=now() where id=v_job.id returning * into v_job;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'properties',r.source_properties,'after',r.after,'source',r.source_identity->>'source','external_id',r.source_identity->>'external_id','tag_ids',r.source_identity->'tag_ids','changed',r.changed,'recovery_properties',r.recovery_properties) order by r.entity_id collate "C"),'[]'::jsonb) into v_batch from
 (select * from (select x.*,sum(octet_length(source_properties::text)+octet_length(after::text)+coalesce(octet_length(recovery_properties::text),0)+octet_length(entity_id)+512) over(order by entity_id collate "C") as bytes,row_number() over(order by entity_id collate "C") as ordinal from private.entity_schema_migration_rows x where x.job_id=v_job.id and not prepared) bounded where bytes<=524288 and ordinal<=50) r;
 return jsonb_build_object('id',v_job.id,'owner_id',v_job.owner_id,'type_id',v_job.type_id,'fence',v_job.fence,'status',v_job.status,'target',v_job.target,'source_definition',v_job.source_definition,'recovery_keys',v_job.recovery_keys,'migration',v_job.migration,'source_schema_version',v_job.source_schema_version,'source_template_fingerprint',v_job.source_template_fingerprint,'templates',private.entity_schema_effective_templates(v_owner,v_type_id),'available_tags',coalesce((select jsonb_agg(id order by id) from app.tags where owner_id=v_owner and scope='record'),'[]'::jsonb),'type',(select jsonb_build_object('id',t.id,'label',s.schema->>'title','icon_id',s.schema->>'x-icon','archived',coalesce((s.schema->>'deprecated')::boolean,false)) from app.entity_types t join app.entity_schema_versions s on s.owner_id=t.owner_id and s.type_id=t.id and s.schema_version=t.schema_version where t.owner_id=v_owner and t.id=v_type_id),'rows',v_batch);
end $$;

create or replace function app.claim_entity_schema_analysis() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_a app.entity_schema_analyses%rowtype; v_c app.entity_schema_changes%rowtype; v_candidate uuid; v_owner uuid; v_type_id uuid; v_batch jsonb;
begin
 select x.id,x.owner_id,x.type_id into v_candidate,v_owner,v_type_id from app.entity_schema_analyses x
 where (x.status='queued' or (x.status='running' and x.lease_until<now())) and exists(select 1 from app.entity_schema_changes c where c.owner_id=x.owner_id and c.id=x.change_id and (c.model_change_id is null or exists(select 1 from app.data_model_changes g where g.owner_id=c.owner_id and g.id=c.model_change_id and g.status='analyzing'))) order by x.created_at limit 1;
 if v_candidate is null then return null; end if;
 perform private.lock_data_model_analysis(v_candidate);
 perform 1 from app.entity_types t where t.owner_id=v_owner and t.id=v_type_id for update;
 if not found then return null; end if;
 select * into v_a from app.entity_schema_analyses x where x.owner_id=v_owner and x.id=v_candidate for update;
 if not found then return null; end if;
 if not(v_a.status='queued' or (v_a.status='running' and v_a.lease_until<now())) then return null; end if;
 select * into v_c from app.entity_schema_changes x where x.owner_id=v_owner and x.id=v_a.change_id;
 if v_c.recovery_expires_at<=now() then update app.entity_schema_analyses set status='failed',failure_reason='analysis_source_expired',fence=fence+1,lease_until=null where id=v_a.id; return null; end if;
 if v_c.version<>v_a.change_version or v_c.fingerprint<>v_a.fingerprint or v_c.analysis_id<>v_a.id or v_c.status<>'analyzing' then
 update app.entity_schema_analyses set status='failed',fence=fence+1,lease_until=null where id=v_a.id; return null; end if;
 update app.entity_schema_analyses set status='running',fence=fence+1,lease_until=now()+interval '90 seconds' where id=v_a.id returning * into v_a;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'properties',r.properties,'recovery_properties',r.recovery_properties) order by r.entity_id),'[]') into v_batch
 from (select * from (select x.*,sum(octet_length(x.properties::text)+coalesce(octet_length(x.recovery_properties::text),0)+octet_length(x.entity_id)+256) over(order by x.entity_id) as bytes,row_number() over(order by x.entity_id) as ordinal from private.entity_schema_analysis_rows x where x.owner_id=v_owner and x.analysis_id=v_a.id and not x.processed) bounded where bytes<=524288 and ordinal<=50) r;
 return jsonb_build_object('id',v_a.id,'fence',v_a.fence,'target',v_c.target,'recovery_keys',v_c.recovery_keys,'migration',v_c.migration,'rows',v_batch);
end $$;

create function private.fail_data_model_group(p_owner uuid,p_id uuid,p_fence bigint,p_reason text,p_retryable boolean) returns boolean language plpgsql set search_path='' as $$
declare v_group app.data_model_changes%rowtype;
begin
 select * into v_group from app.data_model_changes g where g.owner_id=p_owner and g.id=p_id for update;
 if not found or v_group.fence<>p_fence or v_group.status not in ('queued','preparing','ready_to_commit','committing') then return false;end if;
 update app.entity_schema_migrations j set status='failed',version=j.version+1,fence=j.fence+1,lease_until=null,retryable=p_retryable,failure_reason=case when p_retryable then 'migration_worker_failed' else p_reason end,updated_at=now() where j.owner_id=p_owner and j.model_change_id=p_id and j.status in ('queued','preparing','ready_to_commit','committing');
 update app.entity_types t set schema_write_locked=false,updated_at=now() where t.owner_id=p_owner and exists(select 1 from app.data_model_children c where c.owner_id=p_owner and c.model_id=p_id and c.type_id=t.id);
 update app.data_model_changes g set status='failed',version=g.version+1,fence=g.fence+1,lease_until=null,retryable=p_retryable,failure_reason=p_reason,updated_at=now() where g.owner_id=p_owner and g.id=p_id;
 return true;
end $$;
revoke all on function private.fail_data_model_group(uuid,uuid,bigint,text,boolean) from public,anon,authenticated,app_user,app_server,app_worker;

-- Validate every source and final schema before a first child can publish anything.
create function private.validate_data_model_group(p_owner uuid,p_id uuid,p_fence bigint) returns void language plpgsql set search_path='' as $$
declare v_group app.data_model_changes%rowtype;v_child record;v_job app.entity_schema_migrations%rowtype;v_change app.entity_schema_changes%rowtype;v_analysis app.entity_schema_analyses%rowtype;v_type app.entity_types%rowtype;v_target jsonb;v_entry record;v_bytes bigint;
begin
 select * into strict v_group from app.data_model_changes g where g.owner_id=p_owner and g.id=p_id for update;
 if v_group.status<>'committing' or v_group.fence is distinct from p_fence or v_group.lease_until is null or v_group.lease_until<=now() then raise exception 'group_fence_stale' using errcode='P0001';end if;
 if jsonb_typeof(v_group.plan->'conversion_refs') is distinct from 'array' or jsonb_array_length(v_group.plan->'conversion_refs')=0 or
  jsonb_typeof(v_group.source_memberships) is distinct from 'object' or jsonb_typeof(v_group.source_templates) is distinct from 'object' or private.data_model_document(p_owner) is distinct from v_group.plan->'source'
 then raise exception 'schema_plan_stale' using errcode='P0001';end if;
 if (select count(*) from jsonb_object_keys(v_group.source_memberships))<>jsonb_array_length(v_group.plan->'source'->'entity_types') or
  exists(select 1 from jsonb_array_elements(v_group.plan->'source'->'entity_types') t where not (v_group.source_memberships ? (t->'schema'->>'x-type-id'))) or
  (select count(*) from jsonb_object_keys(v_group.source_templates))<>jsonb_array_length(v_group.plan->'target'->'entity_types')
 then raise exception 'group_source_set_mismatch' using errcode='P0001';end if;
 for v_entry in select * from jsonb_each_text(v_group.source_memberships) loop
  if app.entity_schema_membership(p_owner,v_entry.key::uuid) is distinct from v_entry.value then raise exception 'schema_plan_stale' using errcode='P0001';end if;
 end loop;
 for v_target in select value from jsonb_array_elements(v_group.plan->'target'->'entity_types') loop
  if not (v_group.source_templates ? (v_target->'schema'->>'x-type-id')) or private.entity_schema_effective_templates(p_owner,(v_target->'schema'->>'x-type-id')::uuid) is distinct from v_group.source_templates->(v_target->'schema'->>'x-type-id') then raise exception 'schema_plan_stale' using errcode='P0001';end if;
 end loop;
 if (select count(distinct ref) from jsonb_array_elements_text(v_group.plan->'conversion_refs') x(ref))<>jsonb_array_length(v_group.plan->'conversion_refs') or
 (select count(*) from app.data_model_children c where c.owner_id=p_owner and c.model_id=p_id)<>jsonb_array_length(v_group.plan->'conversion_refs') or
 exists(select 1 from jsonb_array_elements_text(v_group.plan->'conversion_refs') x(ref) where not exists(select 1 from app.data_model_children c where c.owner_id=p_owner and c.model_id=p_id and c.type_ref=x.ref))
 then raise exception 'group_child_set_mismatch' using errcode='P0001';end if;
 perform 1 from app.entities e where e.owner_id=p_owner and exists(select 1 from app.data_model_children c where c.owner_id=p_owner and c.model_id=p_id and c.type_id=e.entity_type_id) order by e.entity_type_id,e.id collate "C" for update;
 for v_child in select c.* from app.data_model_children c where c.owner_id=p_owner and c.model_id=p_id order by c.type_id loop
  if v_child.job_id is null or v_child.analysis_id is null then raise exception 'group_child_incomplete' using errcode='P0001';end if;
  select * into strict v_job from app.entity_schema_migrations j where j.owner_id=p_owner and j.id=v_child.job_id for update;
  select * into strict v_change from app.entity_schema_changes c where c.owner_id=p_owner and c.id=v_child.change_id for update;
  select * into strict v_analysis from app.entity_schema_analyses a where a.owner_id=p_owner and a.id=v_child.analysis_id for update;
  select * into strict v_type from app.entity_types t where t.owner_id=p_owner and t.id=v_child.type_id;
  select t->'schema' into v_target from jsonb_array_elements(v_group.plan->'target'->'entity_types') t where t->>'ref'=v_child.type_ref;
  if v_target is null or v_job.model_change_id is distinct from p_id or v_change.model_change_id is distinct from p_id or v_job.type_id<>v_child.type_id or v_job.change_id<>v_child.change_id or v_job.analysis_id<>v_child.analysis_id or v_analysis.type_id<>v_child.type_id or v_analysis.change_id<>v_child.change_id or v_change.type_id<>v_child.type_id or v_change.analysis_id<>v_child.analysis_id or v_job.status<>'committing' or (v_job.lease_until is null or v_job.lease_until<=now()) or v_analysis.status<>'succeeded' or v_analysis.failed<>0 or v_analysis.change_version<>v_change.version or v_analysis.fingerprint<>v_change.fingerprint or v_job.change_version<>v_change.version or v_job.fingerprint<>v_change.fingerprint or v_change.status<>'ready' or not v_type.schema_write_locked or v_type.schema_version<>v_job.source_schema_version or v_job.target->'schema' is distinct from v_target or (v_group.plan->'review'->'mapping'->'types'->>v_child.type_ref)::uuid<>v_child.type_id or v_change.source_template_fingerprint<>v_job.source_template_fingerprint or private.entity_schema_effective_templates(p_owner,v_child.type_id) is distinct from v_job.source_templates or app.entity_schema_membership(p_owner,v_child.type_id) is distinct from v_job.membership or app.entity_schema_reference_baseline(p_owner,v_child.type_id) is distinct from v_job.source_references or v_job.source_definition='{}'::jsonb or v_job.processed<>v_job.total
  then raise exception 'schema_plan_stale' using errcode='P0001';end if;
  if (select count(*) from private.entity_schema_migration_rows r where r.owner_id=p_owner and r.job_id=v_job.id and r.prepared)<>v_job.total or exists(select 1 from private.entity_schema_migration_rows r left join app.entities e on e.owner_id=r.owner_id and e.id=r.entity_id where r.owner_id=p_owner and r.job_id=v_job.id and (e.id is null or e.entity_type_id<>v_child.type_id or e.version<>r.source_version or (v_job.recovery_keys is not null and r.recovery_properties is null))) then raise exception 'schema_plan_stale' using errcode='P0001';end if;
  select coalesce(sum(octet_length(r.source_properties::text)+coalesce(octet_length(r.recovery_properties::text),0)+octet_length(r.after::text)+octet_length(r.source_identity::text)+octet_length(coalesce(r.record_body,''))+octet_length(coalesce(r.record_context,'null')::text)+octet_length(coalesce(r.record_tags,'null')::text)),0) into v_bytes from private.entity_schema_migration_rows r where r.owner_id=p_owner and r.job_id=v_job.id;
  if v_bytes+octet_length(v_job.source_definition::text)+octet_length(v_job.target::text)+octet_length(v_job.source_references::text)+octet_length(v_job.source_templates::text)+octet_length(v_job.migration::text)>8388608 then raise exception 'migration_result_limit' using errcode='P0001';end if;
 end loop;
 if exists(with final as(select (t->'schema'->>'x-type-id')::uuid id,t->'schema' schema from jsonb_array_elements(v_group.plan->'target'->'entity_types') t union all select t.id,v.schema from app.entity_types t join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version where t.owner_id=p_owner and not exists(select 1 from jsonb_array_elements(v_group.plan->'target'->'entity_types') x where (x->'schema'->>'x-type-id')::uuid=t.id)) select 1 from final where not coalesce((schema->>'deprecated')::boolean,false) group by schema->>'title' having count(*)>1) then raise exception 'model_final_name_conflict' using errcode='P0001';end if;
end $$;
revoke all on function private.validate_data_model_group(uuid,uuid,bigint) from public,anon,authenticated,app_user,app_server,app_worker;

create function app.claim_data_model_conversion() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid;v_id uuid;v_group app.data_model_changes%rowtype;v_job app.entity_schema_migrations%rowtype;v_batch jsonb;
begin
 perform private.cleanup_data_model_sources();
 select g.owner_id,g.id into v_owner,v_id from app.data_model_changes g where g.status in ('queued','ready_to_commit') or (g.status in ('preparing','committing') and g.lease_until<now()) order by g.created_at,g.id limit 1;
 if v_id is null then return null;end if;
 perform private.lock_data_model_owner(v_owner);
 select * into v_group from app.data_model_changes g where g.owner_id=v_owner and g.id=v_id for update;
 if not(v_group.status in ('queued','ready_to_commit') or(v_group.status in ('preparing','committing') and v_group.lease_until<now())) then return null;end if;
 if not exists(select 1 from app.data_model_children c where c.owner_id=v_owner and c.model_id=v_id and c.job_id is not null) then perform private.fail_data_model_group(v_owner,v_id,v_group.fence,'schema_plan_stale',false);return null;end if;
 if v_group.status in ('ready_to_commit','committing') or not exists(select 1 from app.data_model_children c join app.entity_schema_migrations j on j.owner_id=c.owner_id and j.id=c.job_id where c.owner_id=v_owner and c.model_id=v_id and j.status<>'ready_to_commit') then
  update app.data_model_changes g set status='committing',fence=g.fence+1,version=g.version+1,lease_until=now()+interval '90 seconds',updated_at=now() where g.owner_id=v_owner and g.id=v_id returning * into v_group;
  update app.entity_schema_migrations j set status='committing',fence=j.fence+1,version=j.version+1,lease_until=now()+interval '90 seconds',updated_at=now() where j.owner_id=v_owner and exists(select 1 from app.data_model_children c where c.owner_id=v_owner and c.model_id=v_id and c.job_id=j.id) and j.status in ('ready_to_commit','committing');
  return jsonb_build_object('id',v_id,'fence',v_group.fence,'status','committing');
 end if;
 select j.* into v_job from app.entity_schema_migrations j join app.data_model_children c on c.owner_id=j.owner_id and c.job_id=j.id where c.owner_id=v_owner and c.model_id=v_id and (j.status='queued' or(j.status='preparing' and j.lease_until<now())) order by c.type_id limit 1 for update of j;
 if not found then perform private.fail_data_model_group(v_owner,v_id,v_group.fence,'schema_plan_stale',false);return null;end if;
 update app.data_model_changes g set status='preparing',fence=g.fence+1,version=g.version+1,lease_until=now()+interval '90 seconds',updated_at=now() where g.owner_id=v_owner and g.id=v_id returning * into v_group;
 update app.entity_schema_migrations j set status='preparing',fence=j.fence+1,version=j.version+1,lease_until=now()+interval '90 seconds',updated_at=now() where j.owner_id=v_owner and j.id=v_job.id returning * into v_job;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'properties',r.source_properties,'after',r.after,'source',r.source_identity->>'source','external_id',r.source_identity->>'external_id','tag_ids',r.source_identity->'tag_ids','changed',r.changed,'recovery_properties',r.recovery_properties) order by r.entity_id collate "C"),'[]'::jsonb) into v_batch from(select * from(select x.*,sum(octet_length(source_properties::text)+octet_length(after::text)+coalesce(octet_length(recovery_properties::text),0)+octet_length(entity_id)+512) over(order by entity_id collate "C") bytes,row_number() over(order by entity_id collate "C") ordinal from private.entity_schema_migration_rows x where x.owner_id=v_owner and x.job_id=v_job.id and not prepared) bounded where bytes<=524288 and ordinal<=50) r;
 return jsonb_build_object('id',v_id,'fence',v_group.fence,'status','preparing','child',jsonb_build_object('id',v_job.id,'owner_id',v_owner,'type_id',v_job.type_id,'fence',v_job.fence,'status',v_job.status,'target',v_job.target,'source_definition',v_job.source_definition,'recovery_keys',v_job.recovery_keys,'migration',v_job.migration,'source_schema_version',v_job.source_schema_version,'source_template_fingerprint',v_job.source_template_fingerprint,'templates',private.entity_schema_effective_templates(v_owner,v_job.type_id),'available_tags',coalesce((select jsonb_agg(t.id order by t.id) from app.tags t where t.owner_id=v_owner and t.scope='record'),'[]'::jsonb),'type',(select jsonb_build_object('id',t.id,'label',s.schema->>'title','icon_id',s.schema->>'x-icon','archived',coalesce((s.schema->>'deprecated')::boolean,false)) from app.entity_types t join app.entity_schema_versions s on s.owner_id=t.owner_id and s.type_id=t.id and s.schema_version=t.schema_version where t.owner_id=v_owner and t.id=v_job.type_id),'rows',v_batch));
end $$;
create function app.stage_data_model_conversion(p_id uuid,p_fence bigint,p_job uuid,p_child_fence bigint,p_results jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare v_owner uuid;v_group app.data_model_changes%rowtype;v_job app.entity_schema_migrations%rowtype;v_saved boolean;
begin
 select g.owner_id into v_owner from app.data_model_changes g where g.id=p_id;if v_owner is null then return false;end if;
 perform private.lock_data_model_owner(v_owner);
 select * into v_group from app.data_model_changes g where g.owner_id=v_owner and g.id=p_id for update;
 if v_group.status<>'preparing' or v_group.fence is distinct from p_fence or v_group.lease_until is null or v_group.lease_until<=now() then return false;end if;
 select j.* into v_job from app.entity_schema_migrations j join app.data_model_children c on c.owner_id=j.owner_id and c.job_id=j.id where c.owner_id=v_owner and c.model_id=p_id and j.id=p_job and j.model_change_id=p_id for update of j;
 if not found or v_job.status<>'preparing' or v_job.fence is distinct from p_child_fence or v_job.lease_until is null or v_job.lease_until<=now() then return false;end if;
 v_saved:=private.stage_entity_schema_migration(p_job,p_child_fence,p_results);
 if not v_saved then return false;end if;
 select * into v_job from app.entity_schema_migrations j where j.owner_id=v_owner and j.id=p_job;
 if v_job.status='failed' then perform private.fail_data_model_group(v_owner,p_id,p_fence,v_job.failure_reason,false);return true;end if;
 update app.data_model_changes g set status=case when not exists(select 1 from app.data_model_children c join app.entity_schema_migrations j on j.owner_id=c.owner_id and j.id=c.job_id where c.owner_id=v_owner and c.model_id=p_id and j.status<>'ready_to_commit') then 'ready_to_commit' else 'queued' end,version=g.version+1,lease_until=null,updated_at=now() where g.owner_id=v_owner and g.id=p_id;
 return true;
end $$;
create function app.fail_data_model_conversion(p_id uuid,p_fence bigint,p_job uuid,p_child_fence bigint,p_reason text,p_retryable boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare v_owner uuid;v_group app.data_model_changes%rowtype;
begin
 if p_reason not in ('migration_worker_failed','schema_plan_stale','migration_result_limit') then raise exception 'invalid migration failure' using errcode='22023';end if;
 select g.owner_id into v_owner from app.data_model_changes g where g.id=p_id;if v_owner is null then return false;end if;
 perform private.lock_data_model_owner(v_owner);
 select * into v_group from app.data_model_changes g where g.owner_id=v_owner and g.id=p_id for update;
 if v_group.status not in ('preparing','committing') or v_group.fence is distinct from p_fence or v_group.lease_until is null or v_group.lease_until<=now() then return false;end if;
 if p_job is null or p_child_fence is null or not exists(select 1 from app.entity_schema_migrations j join app.data_model_children c on c.owner_id=j.owner_id and c.job_id=j.id where j.owner_id=v_owner and c.model_id=p_id and j.id=p_job and j.model_change_id=p_id and j.fence=p_child_fence and j.status='preparing' and j.lease_until>now()) then return false;end if;
 return private.fail_data_model_group(v_owner,p_id,p_fence,p_reason,p_retryable and p_reason='migration_worker_failed');
end $$;
create function app.commit_data_model_conversion(p_id uuid,p_fence bigint,p_pipeline text) returns boolean language plpgsql security definer set search_path='' as $$
declare v_owner uuid;v_group app.data_model_changes%rowtype;v_child record;v_result jsonb;v_reason text;
begin
 select g.owner_id into v_owner from app.data_model_changes g where g.id=p_id;if v_owner is null then return false;end if;
 perform private.lock_data_model_owner(v_owner);
 select * into v_group from app.data_model_changes g where g.owner_id=v_owner and g.id=p_id for update;
 if v_group.status<>'committing' or v_group.fence is distinct from p_fence or v_group.lease_until is null or v_group.lease_until<=now() then return false;end if;
 if p_pipeline is null or char_length(p_pipeline) not between 1 and 120 then raise exception 'invalid pipeline' using errcode='22023';end if;
 begin
  perform private.validate_data_model_group(v_owner,p_id,p_fence);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
  insert into private.data_model_commit_context values(v_owner,p_id,pg_backend_pid(),txid_current());
  for v_child in select j.* from app.data_model_children c join app.entity_schema_migrations j on j.owner_id=c.owner_id and j.id=c.job_id where c.owner_id=v_owner and c.model_id=p_id order by c.type_id loop
   if not private.commit_entity_schema_migration(v_child.id,v_child.fence,v_child.source_template_fingerprint,p_pipeline) then raise exception 'schema_plan_stale' using errcode='P0001';end if;
  end loop;
  v_result:=private.publish_prepared_model_definitions(v_owner,v_group.plan,array(select c.type_id from app.data_model_children c where c.owner_id=v_owner and c.model_id=p_id));
  update app.entity_schema_migrations j set committed_membership=app.entity_schema_membership(v_owner,j.type_id),committed_references=app.entity_schema_reference_baseline(v_owner,j.type_id) where j.owner_id=v_owner and exists(select 1 from app.data_model_children c where c.owner_id=v_owner and c.model_id=p_id and c.job_id=j.id);
  delete from private.data_model_commit_context ctx where ctx.owner_id=v_owner and ctx.model_id=p_id and ctx.pid=pg_backend_pid() and ctx.txid=txid_current();
  update app.data_model_changes g set status='applied',version=g.version+1,lease_until=null,retryable=false,failure_reason=null,result=v_result,source_expires_at=now()+interval '30 days',updated_at=now() where g.owner_id=v_owner and g.id=p_id;
  return true;
 exception
  when serialization_failure or deadlock_detected then perform private.fail_data_model_group(v_owner,p_id,p_fence,'migration_worker_failed',true);return false;
  when others then
   v_reason:=case when sqlstate='P0001' and sqlerrm in ('schema_plan_stale','migration_result_limit','group_child_set_mismatch','group_source_set_mismatch','model_final_name_conflict','group_child_incomplete') then sqlerrm else 'group_commit_failed' end;
   perform private.fail_data_model_group(v_owner,p_id,p_fence,v_reason,false);return false;
 end;
end $$;
revoke all on function app.claim_data_model_conversion(),app.stage_data_model_conversion(uuid,bigint,uuid,bigint,jsonb),app.fail_data_model_conversion(uuid,bigint,uuid,bigint,text,boolean),app.commit_data_model_conversion(uuid,bigint,text) from public,anon,authenticated,app_user,app_server;
grant execute on function app.claim_data_model_conversion(),app.stage_data_model_conversion(uuid,bigint,uuid,bigint,jsonb),app.fail_data_model_conversion(uuid,bigint,uuid,bigint,text,boolean),app.commit_data_model_conversion(uuid,bigint,text) to app_worker;

-- Terminal parent metadata expires without touching history or extending child material lifetime.
create function private.cleanup_data_model_sources() returns void language plpgsql set search_path='' as $$
declare v_item record;
begin
 for v_item in select g.owner_id,g.id from app.data_model_changes g where g.status in ('applied','cancelled','failed') and g.source_expires_at<=now() and g.source_templates is not null order by g.source_expires_at limit 20 loop
  perform private.lock_data_model_owner(v_item.owner_id);
  update app.data_model_changes g set source_templates=null,source_memberships=null,retryable=false where g.owner_id=v_item.owner_id and g.id=v_item.id and g.status in ('applied','cancelled','failed') and g.source_expires_at<=now();
 end loop;
end $$;
revoke all on function private.cleanup_data_model_sources() from public,anon,authenticated,app_user,app_server,app_worker;

commit;
