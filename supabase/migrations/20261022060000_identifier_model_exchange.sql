-- CLI-generated timestamp was behind existing 146; ordered after that migration.
begin;

-- Resolve pending assignment policy only from an authorized, persisted model plan.
create function private.analysis_identifier_kind_active(p_analysis uuid,p_kind uuid) returns boolean
language plpgsql stable set search_path='' as $$
declare workspace uuid; model uuid; plan jsonb; kind jsonb; issuer jsonb;
begin
 select a.workspace_id,c.model_change_id into workspace,model from app.entity_schema_analyses a
 join app.entity_schema_changes c on c.workspace_id=a.workspace_id and c.id=a.change_id where a.id=p_analysis;
 if model is not null then
  select g.plan into plan from app.data_model_changes g where g.workspace_id=workspace and g.id=model;
  select r into kind from jsonb_array_elements(plan->'target'->'identity_definitions'->'rules') r where r->>'id'=p_kind::text;
  if kind is not null then
   select i into issuer from jsonb_array_elements(plan->'target'->'identity_definitions'->'issuers') i where i->>'code'=kind->>'source';
   return coalesce((kind->>'active')::boolean and (issuer->>'active')::boolean,false);
  end if;
 end if;
 return exists(select 1 from app.entity_identifier_rules r join app.entity_issuers i on i.workspace_id=r.workspace_id and i.code=r.source where r.workspace_id=workspace and r.id=p_kind and r.active and i.active);
end $$;
revoke all on function private.analysis_identifier_kind_active(uuid,uuid) from public,anon,authenticated,app_server,app_user,app_worker;

-- During the final atomic group transaction, compare against the exact registry
-- version changes approved by the persisted plan. Outside that context, compare
-- the original snapshot directly so concurrent registry edits remain stale.
create function private.identifier_analysis_registry_current(p_analysis uuid) returns boolean
language plpgsql stable set search_path='' as $$
declare a app.entity_schema_analyses%rowtype; c app.entity_schema_changes%rowtype; plan jsonb;
 expected jsonb; fact jsonb; kind jsonb; previous jsonb; issuer jsonb; previous_issuer jsonb; updated jsonb:='[]'::jsonb;
 kind_version int; issuer_version int;
begin
 select * into a from app.entity_schema_analyses x where x.id=p_analysis;
 if not found or a.identifier_registry_snapshot is null then return false;end if;
 select * into c from app.entity_schema_changes x where x.workspace_id=a.workspace_id and x.id=a.change_id;
 expected:=a.identifier_registry_snapshot;
 if exists(select 1 from private.data_model_commit_context ctx where ctx.workspace_id=a.workspace_id
  and ctx.model_id=c.model_change_id and ctx.pid=pg_backend_pid() and ctx.txid=txid_current()) then
  select g.plan into plan from app.data_model_changes g where g.workspace_id=a.workspace_id and g.id=c.model_change_id;
  for fact in select value from jsonb_array_elements(expected) loop
   select r into kind from jsonb_array_elements(plan->'target'->'identity_definitions'->'rules') r where r->>'id'=fact->>0;
   if kind is null then updated:=updated||jsonb_build_array(fact);continue;end if;
   select r into previous from jsonb_array_elements(plan->'source'->'identity_definitions'->'rules') r where r->>'id'=kind->>'id';
   select i into issuer from jsonb_array_elements(plan->'target'->'identity_definitions'->'issuers') i where i->>'code'=kind->>'source';
   select i into previous_issuer from jsonb_array_elements(plan->'source'->'identity_definitions'->'issuers') i where i->>'code'=kind->>'source';
   kind_version:=case when previous is null then 1 else (previous->>'version')::int+case when kind->>'source'<>'app' and (previous->'label',previous->'meaning',previous->'active') is distinct from (kind->'label',kind->'meaning',kind->'active') then 1 else 0 end end;
   issuer_version:=case when previous_issuer is null then 1 else (previous_issuer->>'version')::int+case when issuer->>'code'<>'app' and (previous_issuer->'label',previous_issuer->'active') is distinct from (issuer->'label',issuer->'active') then 1 else 0 end end;
   updated:=updated||jsonb_build_array(jsonb_build_array(kind->>'id',kind->>'source',kind_version,(kind->>'active')::boolean,kind->>'meaning',kind->>'generation',issuer_version,(issuer->>'active')::boolean));
  end loop;
  expected:=updated;
 end if;
 return expected=private.identifier_registry_snapshot(a.workspace_id,a.type_id,c.target);
end $$;
revoke all on function private.identifier_analysis_registry_current(uuid) from public,anon,authenticated,app_server,app_user,app_worker;

CREATE OR REPLACE FUNCTION private.publish_model_identifier_registry(p_owner uuid, p_plan jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare target jsonb:=p_plan->'target'; source jsonb:=p_plan->'source'; x jsonb; old jsonb;
 v_type_id uuid; v_rule_id uuid; next_property integer;
 ends jsonb; old_ends jsonb; counts jsonb; result jsonb;
begin
 perform private.authorize_model_publication_requirements(p_owner,'[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb);
 perform private.assert_model_publication_plan(p_owner,p_plan);
 if not exists(select 1 from app.data_model_changes g where g.workspace_id=p_owner and g.plan=p_plan) then raise exception 'model_publication_plan_mismatch' using errcode='23514';end if;
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
   if (old->'label',old->'meaning',old->'active') is distinct from (x->'label',x->'meaning',x->'active') then
    update app.entity_identifier_rules r set label=x->>'label',meaning=x->>'meaning',
     active=(x->>'active')::boolean,version=r.version+1
     where r.workspace_id=p_owner and r.id=v_rule_id and r.version=(old->>'version')::integer;
    if not found then raise exception 'schema_plan_stale' using errcode='P0001'; end if;
   end if;
  end if;
 end loop;

end $function$;
revoke all on function private.publish_model_identifier_registry(uuid,jsonb) from public,anon,authenticated,app_server,app_worker;
grant execute on function private.publish_model_identifier_registry(uuid,jsonb) to app_user;

CREATE OR REPLACE FUNCTION private.publish_prepared_model_definitions(p_owner uuid, p_plan jsonb, p_skip uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare target jsonb:=p_plan->'target'; source jsonb:=p_plan->'source'; x jsonb; old jsonb;
 v_type_id uuid; v_rule_id uuid; next_property integer;
 ends jsonb; old_ends jsonb; counts jsonb; result jsonb;
begin
 perform private.authorize_model_publication_requirements(p_owner,'[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb);
 perform private.assert_model_publication_plan(p_owner,p_plan);
 if app.current_workspace_id() is distinct from p_owner then
  raise exception 'request_owner_missing' using errcode='42501'; end if;
 if not exists(select 1 from private.data_model_commit_context ctx where ctx.workspace_id=p_owner
  and exists(select 1 from app.data_model_changes g where g.workspace_id=p_owner and g.id=ctx.model_id and g.plan=p_plan)
  and ctx.pid=pg_backend_pid() and ctx.txid=txid_current()) then
  perform private.publish_model_identifier_registry(p_owner,p_plan);
 end if;
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
;
CREATE OR REPLACE FUNCTION private.commit_entity_schema_migration(p_id uuid, p_fence bigint, p_template_fingerprint text, p_pipeline text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid; v_type_id uuid; v_job app.entity_schema_migrations%rowtype; v_type app.entity_types%rowtype; v_change app.entity_schema_changes%rowtype; v_next_schema integer; v_count integer;
begin
 select x.workspace_id,x.type_id into v_owner,v_type_id from app.entity_schema_migrations x where x.id=p_id;
 if v_owner is null or not private.authorize_schema_job(v_owner,p_id) then return false; end if;
 perform private.lock_data_model_owner(v_owner);
 if not private.schema_job_current(v_owner,p_id) then return false;end if;
 select * into v_type from app.entity_types x where x.workspace_id=v_owner and x.id=v_type_id for update;
 select * into v_job from app.entity_schema_migrations where workspace_id=v_owner and id=p_id for update;
 if v_job.status<>'committing' or v_job.fence is distinct from p_fence or v_job.lease_until is null or v_job.lease_until<=now() then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':record_templates',0));
 select * into v_change from app.entity_schema_changes where workspace_id=v_owner and id=v_job.change_id for update;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':entity-identity-registry',0));
 if not private.identifier_analysis_registry_current(v_job.analysis_id) or not v_type.schema_write_locked or v_type.schema_version<>v_job.source_schema_version or v_change.version<>v_job.change_version or v_change.fingerprint<>v_job.fingerprint or v_change.analysis_id<>v_job.analysis_id or v_change.status<>'ready' or app.entity_schema_membership(v_owner,v_type_id)<>v_job.membership or p_template_fingerprint<>v_job.source_template_fingerprint or private.entity_schema_effective_templates(v_owner,v_type_id)<>v_job.source_templates or private.workspace_entity_schema_reference_baseline(v_owner,v_type_id)<>v_job.source_references then
 perform private.fail_entity_schema_migration(p_id,p_fence,'schema_plan_stale',false); return false; end if;
 if p_pipeline is null or char_length(p_pipeline) not between 1 and 120 then raise exception 'invalid pipeline' using errcode='22023'; end if;
 if v_job.processed<>v_job.total or (select count(*) from private.entity_schema_migration_rows where workspace_id=v_owner and job_id=p_id and prepared)<>v_job.total then raise exception 'incomplete migration' using errcode='22023'; end if;
 perform 1 from app.entities e where e.workspace_id=v_owner and e.entity_type_id=v_type_id order by e.id collate "C" for update;
 if not exists(select 1 from private.data_model_commit_context ctx where ctx.workspace_id=v_owner and ctx.model_id=v_job.model_change_id and ctx.pid=pg_backend_pid() and ctx.txid=txid_current()) and not coalesce((v_job.target->'schema'->>'deprecated')::boolean,false)
 and exists(select 1 from app.entity_schema_versions s where s.workspace_id=v_owner and s.type_id=v_type_id and s.schema_version=v_type.schema_version
  and (coalesce((s.schema->>'deprecated')::boolean,false) or s.schema->>'title' is distinct from v_job.target->'schema'->>'title'))
 and exists(select 1 from app.entity_types t join app.entity_schema_versions s on s.workspace_id=t.workspace_id and s.type_id=t.id and s.schema_version=t.schema_version
  where t.workspace_id=v_owner and t.id<>v_type_id and not coalesce((s.schema->>'deprecated')::boolean,false) and s.schema->>'title'=v_job.target->'schema'->>'title') then
  perform private.fail_entity_schema_migration(p_id,p_fence,'schema_plan_stale',false); return false;
 end if;
 insert into private.schema_job_commit_context(workspace_id,job_id,pid,txid) values(v_owner,p_id,pg_backend_pid(),txid_current());
 v_next_schema=v_type.schema_version+1;
 insert into app.entity_schema_versions(workspace_id,schema) values(v_owner,(v_job.target->'schema')||jsonb_build_object('x-type-id',v_type_id,'x-version',v_next_schema));
 update app.entities e set properties=r.after,schema_version=v_next_schema,version=e.version+1,updated_at=now() from private.entity_schema_migration_rows r where r.workspace_id=v_owner and r.job_id=p_id and r.workspace_id=e.workspace_id and r.entity_id=e.id and e.entity_type_id=v_type_id and e.version=r.source_version;
 get diagnostics v_count=row_count;
 if v_count<>v_job.total then
  if exists(select 1 from private.data_model_commit_context ctx where ctx.workspace_id=v_owner and ctx.model_id=v_job.model_change_id and ctx.pid=pg_backend_pid() and ctx.txid=txid_current()) then raise exception 'schema_plan_stale' using errcode='P0001';end if;
  raise exception 'migration source changed' using errcode='40001';
 end if;
 update private.entity_schema_migration_rows set committed_version=source_version+1 where workspace_id=v_owner and job_id=p_id;
 insert into app.records(workspace_id,id,entity_id,created_by,created_by_name,body,record_kind,change_metadata)
 select v_owner,r.record_id,r.entity_id,v_job.initiated_by,v_job.created_by_name,r.record_body,'change',
  jsonb_build_object('event_id',r.record_id,'target_kind','entity','target_id',r.entity_id,
   'target_title',app.entity_title(v_job.target->'schema',r.after,app.identifier_raw(substr(r.entity_id,38))),
   'action','update','source',v_job.actor_source,'before',null,'after',null,'path',r.record_path,'schema_migration_id',v_job.id,'target_snapshot',r.record_context->0)
 from private.entity_schema_migration_rows r where r.workspace_id=v_owner and r.job_id=p_id and r.changed;
 insert into app.record_tags(workspace_id,record_id,tag_id)
 select v_owner,r.record_id,tag.id from private.entity_schema_migration_rows r
 cross join lateral jsonb_array_elements_text(r.record_tags) ids(id)
 join app.tags tag on tag.workspace_id=r.workspace_id and tag.scope='record' and tag.id=ids.id
 where r.workspace_id=v_owner and r.job_id=p_id and r.changed;
 with queued as (
  insert into pgmq.q_search_index(vt,message)
  select now(),jsonb_build_object('workspace_id',v_owner,'initiated_by',v_job.initiated_by,'workspace_generation',v_job.workspace_generation,
   'source_version',record.version,'kind','record','id',r.record_id,'input_hash',r.record_hash,'pipeline',p_pipeline)
  from private.entity_schema_migration_rows r join app.records record on record.workspace_id=r.workspace_id and record.id=r.record_id
  where r.workspace_id=v_owner and r.job_id=p_id and r.changed returning msg_id,message)
 insert into app.search_index_state(workspace_id,initiated_by,workspace_generation,source_version,kind,id,input_hash,pipeline,message_id)
 select v_owner,v_job.initiated_by,v_job.workspace_generation,(message->>'source_version')::bigint,'record',message->>'id',message->>'input_hash',p_pipeline,msg_id from queued;
 update app.entity_types set schema_version=v_next_schema,schema_write_locked=false,updated_at=now() where workspace_id=v_owner and id=v_type_id;
 update app.entity_schema_changes set status='applied',updated_at=now() where workspace_id=v_owner and id=v_job.change_id;
 update app.entity_schema_migrations set status='succeeded',version=version+1,lease_until=null,retryable=false,failure_reason=null,source_expires_at=coalesce(source_expires_at,now()+interval '30 days'),committed_membership=app.entity_schema_membership(v_owner,v_type_id),committed_references=private.workspace_entity_schema_reference_baseline(v_owner,v_type_id),result=jsonb_build_object('schema_version',v_next_schema,'total',v_job.total,'changed',(select count(*) from private.entity_schema_migration_rows where workspace_id=v_owner and job_id=p_id and changed),'committed_at',now()),updated_at=now() where workspace_id=v_owner and id=p_id;
 delete from private.schema_job_commit_context ctx where ctx.workspace_id=v_owner and ctx.job_id=p_id and ctx.pid=pg_backend_pid() and ctx.txid=txid_current();
 return true;
end $function$
;
CREATE OR REPLACE FUNCTION private.complete_entity_schema_analysis_batch(p_id uuid, p_fence bigint, p_results jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_a app.entity_schema_analyses%rowtype; v_c app.entity_schema_changes%rowtype; v_owner uuid; v_type_id uuid; v_result jsonb; v_n integer; v_bad integer; v_stale boolean; v_field record; v_before jsonb; v_kind uuid; v_active boolean;
begin
 select x.workspace_id,x.type_id into v_owner,v_type_id from app.entity_schema_analyses x where x.id=p_id;
 if v_owner is null or not private.authorize_schema_analysis(v_owner,p_id) then return false; end if;
 perform 1 from app.entity_types t where t.workspace_id=v_owner and t.id=v_type_id for update;
 if not found then return false; end if;
 select * into v_a from app.entity_schema_analyses x where x.workspace_id=v_owner and x.id=p_id for update;
 if not found then return false; end if;
 if v_a.status<>'running' or v_a.fence<>p_fence or v_a.lease_until<=now() then return false; end if;
 select * into v_c from app.entity_schema_changes x where x.workspace_id=v_owner and x.id=v_a.change_id for update;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':entity-identity-registry',0));
 if v_c.version<>v_a.change_version or v_c.fingerprint<>v_a.fingerprint or v_c.analysis_id<>v_a.id then return false; end if;
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>50 then raise exception 'invalid analysis batch'; end if;
 for v_result in select value from jsonb_array_elements(p_results) loop
  if jsonb_typeof(v_result->'errors')<>'array' or jsonb_typeof(v_result->'after') not in ('object','null') or octet_length(v_result::text)>262144 then raise exception 'invalid analysis result'; end if;
  select properties into v_before from private.entity_schema_analysis_rows where workspace_id=v_owner and analysis_id=p_id and entity_id=v_result->>'entity_id';
  for v_field in select key,value from jsonb_each(v_c.target->'schema'->'properties') where value ? 'x-identifier' loop
   if v_result->'after'->v_field.key is null or v_result->'after'->v_field.key='null'::jsonb
    or v_result->'after'->v_field.key is not distinct from v_before->v_field.key then continue;end if;
   v_active:=false;
   begin
    v_kind:=app.identifier_kind(v_result->'after'->>v_field.key);
    select private.analysis_identifier_kind_active(p_id,v_kind) and v_field.value->'x-identifier'->'allowed_kind_ids' ? v_kind::text into v_active;
   exception when check_violation then v_active:=false;end;
   if not v_active and not exists(select 1 from jsonb_array_elements(v_result->'errors') e where e->>'path'='properties.'||v_field.key) then
    v_result:=jsonb_set(v_result,'{errors}',v_result->'errors'||jsonb_build_array(jsonb_build_object('path','properties.'||v_field.key,'message','허용된 활성 식별자 종류를 선택하세요')));
   end if;
  end loop;
  update private.entity_schema_analysis_rows set processed=true,errors=v_result->'errors',after=v_result->'after',after_bytes=(v_result->>'after_bytes')::integer,changed=(v_result->>'changed')::boolean,removed=(v_result->>'removed')::integer,replacements=(v_result->>'replacements')::integer where workspace_id=v_owner and analysis_id=p_id and entity_id=v_result->>'entity_id' and not processed;
  if not found then raise exception 'unexpected analysis row'; end if;
 end loop;
 select count(*) filter(where processed), count(*) filter(where processed and jsonb_array_length(errors)>0) into v_n,v_bad from private.entity_schema_analysis_rows where workspace_id=v_owner and analysis_id=p_id;
 if (select coalesce(sum(octet_length(properties::text)+coalesce(octet_length(recovery_properties::text),0)+octet_length(coalesce(after,'null'::jsonb)::text)+octet_length(errors::text)),0) from private.entity_schema_analysis_rows where workspace_id=v_owner and analysis_id=p_id)>8388608 then
  update app.entity_schema_analyses set status='failed',processed=v_n,failed=v_bad,lease_until=null,retryable=false,failure_reason='analysis_result_limit' where workspace_id=v_owner and id=p_id;
  update app.entity_schema_changes set status='draft',updated_at=now() where workspace_id=v_owner and id=v_c.id;return true;
 end if;
 if v_n=v_a.total then
  select t.schema_version<>v_c.source_schema_version or t.schema_write_locked or app.entity_schema_membership(v_owner,v_type_id)<>v_a.membership or v_a.identifier_registry_snapshot is distinct from private.identifier_registry_snapshot(v_owner,v_type_id,v_c.target) into v_stale from app.entity_types t where t.workspace_id=v_owner and t.id=v_type_id;
  update app.entity_schema_analyses set status='succeeded',processed=v_n,failed=v_bad,changed=(select count(*) from private.entity_schema_analysis_rows where workspace_id=v_owner and analysis_id=p_id and processed and changed),unchanged=(select count(*) from private.entity_schema_analysis_rows where workspace_id=v_owner and analysis_id=p_id and processed and not changed),removed=(select coalesce(sum(removed),0) from private.entity_schema_analysis_rows where workspace_id=v_owner and analysis_id=p_id and processed),replacements=(select coalesce(sum(replacements),0) from private.entity_schema_analysis_rows where workspace_id=v_owner and analysis_id=p_id and processed),lease_until=null where workspace_id=v_owner and id=p_id;
  update app.entity_schema_changes set status=case when v_stale then 'stale' else 'ready' end,updated_at=now() where workspace_id=v_owner and id=v_c.id;
 else
  update app.entity_schema_analyses set status='queued',processed=v_n,failed=v_bad,changed=(select count(*) from private.entity_schema_analysis_rows where workspace_id=v_owner and analysis_id=p_id and processed and changed),unchanged=(select count(*) from private.entity_schema_analysis_rows where workspace_id=v_owner and analysis_id=p_id and processed and not changed),removed=(select coalesce(sum(removed),0) from private.entity_schema_analysis_rows where workspace_id=v_owner and analysis_id=p_id and processed),replacements=(select coalesce(sum(replacements),0) from private.entity_schema_analysis_rows where workspace_id=v_owner and analysis_id=p_id and processed),lease_until=null where workspace_id=v_owner and id=p_id;
 end if;
 return true;
end $function$
;
CREATE OR REPLACE FUNCTION app.commit_data_model_conversion(p_id uuid, p_fence bigint, p_pipeline text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid;v_group app.data_model_changes%rowtype;v_child record;v_result jsonb;v_reason text;
begin
 select g.workspace_id into v_owner from app.data_model_changes g where g.id=p_id;if v_owner is null or not private.authorize_schema_group(v_owner,p_id) then return false;end if;
 perform private.lock_data_model_owner(v_owner);
 select * into v_group from app.data_model_changes g where g.workspace_id=v_owner and g.id=p_id for update;
 if v_group.status<>'committing' or v_group.fence is distinct from p_fence or v_group.lease_until is null or v_group.lease_until<=now() then return false;end if;
 if p_pipeline is null or char_length(p_pipeline) not between 1 and 120 then raise exception 'invalid pipeline' using errcode='22023';end if;
 begin
  perform private.validate_data_model_group(v_owner,p_id,p_fence);
  if not private.schema_permissions_allow(v_group.initiated_by,v_owner,private.search_model_permissions(v_group.plan)) then raise exception 'workspace_denied' using errcode='42501';end if;
 perform set_config('request.search_publication_permissions',private.search_model_permissions(v_group.plan)::text,true);
 insert into private.data_model_commit_context(workspace_id,model_id,pid,txid) values(v_owner,p_id,pg_backend_pid(),txid_current());
  perform private.publish_model_identifier_registry(v_owner,v_group.plan);
  for v_child in select j.* from app.data_model_children c join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id where c.workspace_id=v_owner and c.model_id=p_id order by c.type_id loop
   if not private.commit_entity_schema_migration(v_child.id,v_child.fence,v_child.source_template_fingerprint,p_pipeline) then raise exception 'schema_plan_stale' using errcode='P0001';end if;
  end loop;
  v_result:=private.publish_prepared_model_definitions(v_owner,v_group.plan,array(select c.type_id from app.data_model_children c where c.workspace_id=v_owner and c.model_id=p_id));
  update app.entity_schema_migrations j set committed_membership=app.entity_schema_membership(v_owner,j.type_id),committed_references=private.workspace_entity_schema_reference_baseline(v_owner,j.type_id) where j.workspace_id=v_owner and exists(select 1 from app.data_model_children c where c.workspace_id=v_owner and c.model_id=p_id and c.job_id=j.id);
  delete from private.data_model_commit_context ctx where ctx.workspace_id=v_owner and ctx.model_id=p_id and ctx.pid=pg_backend_pid() and ctx.txid=txid_current();
  update app.data_model_changes g set status='applied',version=g.version+1,lease_until=null,retryable=false,failure_reason=null,result=v_result,source_expires_at=coalesce(g.source_expires_at,now()+interval '30 days'),updated_at=now() where g.workspace_id=v_owner and g.id=p_id;
  return true;
 exception
  when serialization_failure or deadlock_detected then perform private.fail_data_model_group(v_owner,p_id,p_fence,'migration_worker_failed',true);return false;
  when others then
   v_reason:=case when sqlstate='P0001' and sqlerrm in ('schema_plan_stale','migration_result_limit','group_child_set_mismatch','group_source_set_mismatch','model_final_name_conflict','group_child_incomplete') then sqlerrm else 'group_commit_failed' end;
   perform private.fail_data_model_group(v_owner,p_id,p_fence,v_reason,false);return false;
 end;
end $function$
;
commit;
