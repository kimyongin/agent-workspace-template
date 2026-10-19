-- Atomic publication uses real persisted executors and the current workspace graph.
create table private.schema_job_commit_context(
 workspace_id uuid not null,job_id uuid not null,pid integer not null,txid bigint not null,
 primary key(pid,txid,workspace_id,job_id),
 foreign key(workspace_id,job_id) references app.entity_schema_migrations(workspace_id,id) on delete cascade
);
revoke all on private.schema_job_commit_context from public,anon,authenticated,app_user,app_server,app_worker;

CREATE OR REPLACE FUNCTION private.validate_data_model_group(p_owner uuid, p_id uuid, p_fence bigint)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_group app.data_model_changes%rowtype;v_child record;v_job app.entity_schema_migrations%rowtype;v_change app.entity_schema_changes%rowtype;v_analysis app.entity_schema_analyses%rowtype;v_type app.entity_types%rowtype;v_target jsonb;v_entry record;v_bytes bigint;
begin
 if not private.authorize_schema_group(p_owner,p_id) then raise exception 'schema_plan_stale' using errcode='P0001';end if;
 select * into strict v_group from app.data_model_changes g where g.workspace_id=p_owner and g.id=p_id for update;
 if v_group.status<>'committing' or v_group.fence is distinct from p_fence or v_group.lease_until is null or v_group.lease_until<=now() then raise exception 'group_fence_stale' using errcode='P0001';end if;
 if jsonb_typeof(v_group.plan->'conversion_refs') is distinct from 'array' or jsonb_array_length(v_group.plan->'conversion_refs')=0 or
  jsonb_typeof(v_group.plan->'protected_kind_ids') is distinct from 'array' or jsonb_typeof(v_group.source_memberships) is distinct from 'object' or jsonb_typeof(v_group.source_templates) is distinct from 'object' or private.data_model_document(p_owner) is distinct from v_group.plan->'source'
 then raise exception 'schema_plan_stale' using errcode='P0001';end if;
 if (select count(*) from jsonb_object_keys(v_group.source_memberships))<>jsonb_array_length(v_group.plan->'protected_kind_ids') or
  exists(select 1 from jsonb_array_elements_text(v_group.plan->'protected_kind_ids') t(id) where not (v_group.source_memberships ? t.id)) or
  (select count(*) from jsonb_object_keys(v_group.source_templates))<>jsonb_array_length(v_group.plan->'target'->'entity_types')
 then raise exception 'group_source_set_mismatch' using errcode='P0001';end if;
 for v_entry in select * from jsonb_each_text(v_group.source_memberships) loop
  if app.entity_schema_membership(p_owner,v_entry.key::uuid) is distinct from v_entry.value then raise exception 'schema_plan_stale' using errcode='P0001';end if;
 end loop;
 for v_target in select value from jsonb_array_elements(v_group.plan->'target'->'entity_types') loop
  if not (v_group.source_templates ? (v_target->'schema'->>'x-type-id')) or private.entity_schema_effective_templates(p_owner,(v_target->'schema'->>'x-type-id')::uuid) is distinct from v_group.source_templates->(v_target->'schema'->>'x-type-id') then raise exception 'schema_plan_stale' using errcode='P0001';end if;
 end loop;
 if (select count(distinct ref) from jsonb_array_elements_text(v_group.plan->'conversion_refs') x(ref))<>jsonb_array_length(v_group.plan->'conversion_refs') or
 (select count(*) from app.data_model_children c where c.workspace_id=p_owner and c.model_id=p_id)<>jsonb_array_length(v_group.plan->'conversion_refs') or
 exists(select 1 from jsonb_array_elements_text(v_group.plan->'conversion_refs') x(ref) where not exists(select 1 from app.data_model_children c where c.workspace_id=p_owner and c.model_id=p_id and c.type_ref=x.ref))
 then raise exception 'group_child_set_mismatch' using errcode='P0001';end if;
 perform 1 from app.entities e where e.workspace_id=p_owner and exists(select 1 from app.data_model_children c where c.workspace_id=p_owner and c.model_id=p_id and c.type_id=e.entity_type_id) order by e.entity_type_id,e.id collate "C" for update;
 for v_child in select c.* from app.data_model_children c where c.workspace_id=p_owner and c.model_id=p_id order by c.type_id loop
  if v_child.job_id is null or v_child.analysis_id is null then raise exception 'group_child_incomplete' using errcode='P0001';end if;
  select * into strict v_job from app.entity_schema_migrations j where j.workspace_id=p_owner and j.id=v_child.job_id for update;
  select * into strict v_change from app.entity_schema_changes c where c.workspace_id=p_owner and c.id=v_child.change_id for update;
  select * into strict v_analysis from app.entity_schema_analyses a where a.workspace_id=p_owner and a.id=v_child.analysis_id for update;
  select * into strict v_type from app.entity_types t where t.workspace_id=p_owner and t.id=v_child.type_id;
  select t->'schema' into v_target from jsonb_array_elements(v_group.plan->'target'->'entity_types') t where t->>'ref'=v_child.type_ref;
  if v_target is null or v_job.model_change_id is distinct from p_id or v_change.model_change_id is distinct from p_id or v_job.type_id<>v_child.type_id or v_job.change_id<>v_child.change_id or v_job.analysis_id<>v_child.analysis_id or v_analysis.type_id<>v_child.type_id or v_analysis.change_id<>v_child.change_id or v_change.type_id<>v_child.type_id or v_change.analysis_id<>v_child.analysis_id or v_job.status<>'committing' or (v_job.lease_until is null or v_job.lease_until<=now()) or v_analysis.status<>'succeeded' or v_analysis.failed<>0 or v_analysis.change_version<>v_change.version or v_analysis.fingerprint<>v_change.fingerprint or v_job.change_version<>v_change.version or v_job.fingerprint<>v_change.fingerprint or v_change.status<>'ready' or not v_type.schema_write_locked or v_type.schema_version<>v_job.source_schema_version or v_job.target->'schema' is distinct from v_target or (v_group.plan->'review'->'mapping'->'types'->>v_child.type_ref)::uuid<>v_child.type_id or v_change.source_template_fingerprint<>v_job.source_template_fingerprint or private.entity_schema_effective_templates(p_owner,v_child.type_id) is distinct from v_job.source_templates or app.entity_schema_membership(p_owner,v_child.type_id) is distinct from v_job.membership or private.workspace_entity_schema_reference_baseline(p_owner,v_child.type_id) is distinct from v_job.source_references or v_job.source_definition='{}'::jsonb or v_job.processed<>v_job.total
  then raise exception 'schema_plan_stale' using errcode='P0001';end if;
  if (select count(*) from private.entity_schema_migration_rows r where r.workspace_id=p_owner and r.job_id=v_job.id and r.prepared)<>v_job.total or exists(select 1 from private.entity_schema_migration_rows r left join app.entities e on e.workspace_id=r.workspace_id and e.id=r.entity_id where r.workspace_id=p_owner and r.job_id=v_job.id and (e.id is null or e.entity_type_id<>v_child.type_id or e.version<>r.source_version or (v_job.recovery_keys is not null and r.recovery_properties is null))) then raise exception 'schema_plan_stale' using errcode='P0001';end if;
  select coalesce(sum(octet_length(r.source_properties::text)+coalesce(octet_length(r.recovery_properties::text),0)+octet_length(r.after::text)+octet_length(r.source_identity::text)+octet_length(coalesce(r.record_body,''))+octet_length(coalesce(r.record_context,'null')::text)+octet_length(coalesce(r.record_tags,'null')::text)),0) into v_bytes from private.entity_schema_migration_rows r where r.workspace_id=p_owner and r.job_id=v_job.id;
  if v_bytes+octet_length(v_job.source_definition::text)+octet_length(v_job.target::text)+octet_length(v_job.source_references::text)+octet_length(v_job.source_templates::text)+octet_length(v_job.migration::text)>8388608 then raise exception 'migration_result_limit' using errcode='P0001';end if;
 end loop;
 if exists(with final as(select (t->'schema'->>'x-type-id')::uuid id,t->'schema' schema from jsonb_array_elements(v_group.plan->'target'->'entity_types') t union all select t.id,v.schema from app.entity_types t join app.entity_schema_versions v on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version where t.workspace_id=p_owner and not exists(select 1 from jsonb_array_elements(v_group.plan->'target'->'entity_types') x where (x->'schema'->>'x-type-id')::uuid=t.id)) select 1 from final where not coalesce((schema->>'deprecated')::boolean,false) group by schema->>'title' having count(*)>1) then raise exception 'model_final_name_conflict' using errcode='P0001';end if;
end $function$;

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
 if not v_type.schema_write_locked or v_type.schema_version<>v_job.source_schema_version or v_change.version<>v_job.change_version or v_change.fingerprint<>v_job.fingerprint or v_change.analysis_id<>v_job.analysis_id or v_change.status<>'ready' or app.entity_schema_membership(v_owner,v_type_id)<>v_job.membership or p_template_fingerprint<>v_job.source_template_fingerprint or private.entity_schema_effective_templates(v_owner,v_type_id)<>v_job.source_templates or private.workspace_entity_schema_reference_baseline(v_owner,v_type_id)<>v_job.source_references then
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
   'target_title',r.after->>((select key from jsonb_each(v_job.target->'schema'->'properties') where value->'x-representative'='true'::jsonb)),
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
end $function$;

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
  insert into private.data_model_commit_context(workspace_id,model_id,pid,txid) values(v_owner,p_id,pg_backend_pid(),txid_current());
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
end $function$;

CREATE OR REPLACE FUNCTION app.commit_entity_schema_migration(p_id uuid, p_fence bigint, p_template_fingerprint text, p_pipeline text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if exists(select 1 from app.entity_schema_migrations j where j.id=p_id and j.model_change_id is not null) then return false;end if;
 return private.commit_entity_schema_migration(p_id,p_fence,p_template_fingerprint,p_pipeline);
end $function$;
