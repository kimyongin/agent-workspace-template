-- Selected identifiers must remain writable on initial assignment.
begin;
CREATE OR REPLACE FUNCTION private.guard_identifier_definition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_type uuid:=(new.schema->>'x-type-id')::uuid;identity_key text:=new.schema->>'x-identity-property';field record;settings jsonb;v_kind_text text;current_document jsonb; old_identity text;
begin
 -- This trigger is also the final direct-SQL publication boundary. Drafts live
 -- elsewhere; a published document always contains exactly one identity field.
 if identity_key is null or not(new.schema->'properties' ? identity_key)
  or not(new.schema->'required' ? identity_key) then
  raise exception 'identifier_definition_invalid' using errcode='23514';end if;
 perform 1 from app.entity_types where workspace_id=new.workspace_id and id=v_type for update;
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text||':entity-identity-registry',0));
 for field in select key,value from jsonb_each(new.schema->'properties') loop
  if field.key=identity_key and (not(field.value ? 'x-identifier') or field.value->'type'<>'"string"'::jsonb
   or field.value ? 'default' or coalesce((field.value->>'deprecated')::boolean,false)
   or coalesce((field.value->>'readOnly')::boolean,false)) then
   raise exception 'identifier_definition_invalid' using errcode='23514';end if;
  if not(field.value ? 'x-identifier') then continue;end if;
  settings:=field.value->'x-identifier';
  if not coalesce(field.value->'type' in ('"string"'::jsonb,'["string","null"]'::jsonb,'["null","string"]'::jsonb),false)
   or field.value ?| array['minLength','maxLength','pattern','format','oneOf','enum']
   or jsonb_typeof(settings) is distinct from 'object'
   or jsonb_typeof(settings->'allowed_kind_ids') is distinct from 'array'
   or jsonb_array_length(settings->'allowed_kind_ids')<1
   or not(settings->'allowed_kind_ids' ? (settings->>'default_kind_id')) then
   raise exception 'identifier_definition_invalid' using errcode='23514';end if;
  if (select count(*) from jsonb_array_elements(settings->'allowed_kind_ids'))<>
   (select count(distinct value) from jsonb_array_elements(settings->'allowed_kind_ids')) then
   raise exception 'identifier_definition_invalid' using errcode='23514';end if;
  for v_kind_text in select jsonb_array_elements_text(settings->'allowed_kind_ids') loop
   if not exists(select 1 from app.entity_identifier_rules r join app.entity_issuers i
    on i.workspace_id=r.workspace_id and i.code=r.source where r.workspace_id=new.workspace_id and r.id::text=v_kind_text)
    then raise exception 'identifier_kind_unavailable' using errcode='23514';end if;
  end loop;
  perform 1 from app.entity_identifier_rules r join app.entity_issuers i on i.workspace_id=r.workspace_id and i.code=r.source
   where r.workspace_id=new.workspace_id and settings->'allowed_kind_ids' ? r.id::text order by r.id for share of r,i;
  if not exists(select 1 from app.entity_identifier_rules r join app.entity_issuers i
   on i.workspace_id=r.workspace_id and i.code=r.source where r.workspace_id=new.workspace_id
   and r.id::text=settings->>'default_kind_id' and r.active and i.active) then
   raise exception 'identity_default_inactive' using errcode='23514',detail=field.key;end if;
  if field.value ? 'default' and field.value->'default'<>'null'::jsonb then
   if not(settings->'allowed_kind_ids' ? app.identifier_kind(field.value->>'default')::text) then
    raise exception 'identifier_kind_not_allowed' using errcode='23514';end if;
   if not exists(select 1 from app.entity_identifier_rules r join app.entity_issuers i
    on i.workspace_id=r.workspace_id and i.code=r.source where r.workspace_id=new.workspace_id
    and r.id=app.identifier_kind(field.value->>'default') and r.active and i.active) then
    raise exception 'identifier_default_value_inactive' using errcode='23514',detail=field.key;end if;
  end if;
 end loop;
 if exists(select 1 from app.entities where workspace_id=new.workspace_id and entity_type_id=v_type) then
  select s.schema into current_document from app.entity_types t join app.entity_schema_versions s
   on s.workspace_id=t.workspace_id and s.type_id=t.id and s.schema_version=t.schema_version
   where t.workspace_id=new.workspace_id and t.id=v_type;
  old_identity:=current_document->>'x-identity-property';
  if identity_key is distinct from old_identity or new.schema->'properties'->identity_key->'type' is distinct from
   current_document->'properties'->old_identity->'type' then
   raise exception 'entity_identity_definition_immutable' using errcode='23514';end if;
  for field in select key,value from jsonb_each(current_document->'properties') where value ? 'x-identifier' loop
   if exists(select 1 from app.entities e where e.workspace_id=new.workspace_id and e.entity_type_id=v_type
    and e.properties->field.key is not null and e.properties->field.key<>'null'::jsonb
    and not coalesce(new.schema->'properties'->field.key->'x-identifier'->'allowed_kind_ids'
     ? app.identifier_kind(e.properties->>field.key)::text,false)) then
    raise exception 'identifier_kind_in_use' using errcode='23514',detail=field.key;end if;
  end loop;
 end if;
 return new;
end $function$
;

alter table app.entity_schema_analyses add column identifier_registry_snapshot jsonb;

-- A captured analysis is bound to the exact registry rows referenced by source and target.
-- Private only: arbitrary documents are never accepted at a public definer boundary.
create function private.identifier_registry_snapshot(p_workspace uuid,p_type uuid,p_target jsonb)
returns jsonb language sql stable set search_path='' as $$
 with documents as (
  select p_target->'schema' as document
  union all select s.schema from app.entity_types t join app.entity_schema_versions s
   on s.workspace_id=t.workspace_id and s.type_id=t.id and s.schema_version=t.schema_version
   where t.workspace_id=p_workspace and t.id=p_type
 ), ids as (
  select distinct jsonb_array_elements_text(f.value->'x-identifier'->'allowed_kind_ids') as id
  from documents d cross join lateral jsonb_each(d.document->'properties') f
  where f.value ? 'x-identifier'
 )
 select coalesce(jsonb_agg(jsonb_build_array(ids.id,r.source,r.version,r.active,r.meaning,r.generation,i.version,i.active)
  order by ids.id),'[]'::jsonb)
 from ids left join app.entity_identifier_rules r on r.workspace_id=p_workspace and r.id::text=ids.id
 left join app.entity_issuers i on i.workspace_id=r.workspace_id and i.code=r.source
$$;
revoke all on function private.identifier_registry_snapshot(uuid,uuid,jsonb) from public,anon,authenticated,app_user,app_server,app_worker;

create function private.guard_schema_identifier_registry() returns trigger
language plpgsql security definer set search_path='' as $$
declare target jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text||':entity-identity-registry',0));
 select c.target into target from app.entity_schema_changes c where c.workspace_id=new.workspace_id and c.id=new.change_id;
 if tg_op='INSERT' then
  new.identifier_registry_snapshot:=private.identifier_registry_snapshot(new.workspace_id,new.type_id,target);
 elsif new.identifier_registry_snapshot is distinct from old.identifier_registry_snapshot then
  raise exception 'schema_analysis_source_immutable' using errcode='23514';
 end if;
 return new;
end $$;
create trigger schema_identifier_registry before insert or update of status,identifier_registry_snapshot
on app.entity_schema_analyses for each row execute function private.guard_schema_identifier_registry();
revoke all on function private.guard_schema_identifier_registry() from public,anon,authenticated,app_user,app_server,app_worker;

create function app.entity_schema_registry_current(p_analysis uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare analysis app.entity_schema_analyses%rowtype; target jsonb;
begin
 select * into analysis from app.entity_schema_analyses a where a.workspace_id=app.current_workspace_id() and a.id=p_analysis;
 if not found then return false;end if;
 perform app.authorize_workspace(jsonb_build_array(
  jsonb_build_object('target_kind','settings','target_id','*','access','read'),
  jsonb_build_object('target_kind','entity_type','target_id',analysis.type_id::text,'access','read')));
 perform pg_advisory_xact_lock(hashtextextended(analysis.workspace_id::text||':entity-identity-registry',0));
 select c.target into target from app.entity_schema_changes c where c.workspace_id=analysis.workspace_id and c.id=analysis.change_id;
 return analysis.identifier_registry_snapshot is not null and analysis.identifier_registry_snapshot =
  private.identifier_registry_snapshot(analysis.workspace_id,analysis.type_id,target);
end $$;
revoke all on function app.entity_schema_registry_current(uuid) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.entity_schema_registry_current(uuid) to app_user;

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
 if not exists(select 1 from app.entity_schema_analyses a where a.workspace_id=v_owner and a.id=v_job.analysis_id
  and a.identifier_registry_snapshot=private.identifier_registry_snapshot(v_owner,v_type_id,v_job.target)) or not v_type.schema_write_locked or v_type.schema_version<>v_job.source_schema_version or v_change.version<>v_job.change_version or v_change.fingerprint<>v_job.fingerprint or v_change.analysis_id<>v_job.analysis_id or v_change.status<>'ready' or app.entity_schema_membership(v_owner,v_type_id)<>v_job.membership or p_template_fingerprint<>v_job.source_template_fingerprint or private.entity_schema_effective_templates(v_owner,v_type_id)<>v_job.source_templates or private.workspace_entity_schema_reference_baseline(v_owner,v_type_id)<>v_job.source_references then
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
    select exists(select 1 from app.entity_identifier_rules r join app.entity_issuers i on i.workspace_id=r.workspace_id and i.code=r.source
     where r.workspace_id=v_owner and r.id=v_kind and r.active and i.active
      and v_field.value->'x-identifier'->'allowed_kind_ids' ? r.id::text) into v_active;
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

commit;
