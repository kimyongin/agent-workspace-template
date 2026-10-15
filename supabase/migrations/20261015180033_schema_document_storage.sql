begin;

-- One publication document owns properties, presentation and type metadata.
-- Historical metadata was never recorded: normalize only facts actually retained.
-- Locking waits for in-flight atomic commits, then fences every old worker snapshot.
lock table app.entity_types, app.entity_schema_versions, app.entity_schema_changes,
 app.entity_schema_analyses, app.entity_schema_migrations in access exclusive mode;

create function private.normalize_legacy_entity_schema(p_schema jsonb,p_display jsonb,p_type uuid,p_version integer)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v_properties jsonb:='{}'; v_key text; v_field jsonb; v_options jsonb; v_n integer; v_list integer; v_separate_list boolean;
begin
 select coalesce(jsonb_agg(value order by ordinality),'[]')<>coalesce(p_display->'list_columns','[]') into v_separate_list
 from jsonb_array_elements_text(coalesce(p_display->'order','[]')) with ordinality
 where coalesce(p_display->'list_columns','[]') ? value;
 for v_key,v_field in select key,value from jsonb_each(p_schema->'properties') loop
  select ordinality::integer into v_n from jsonb_array_elements_text(coalesce(p_display->'order','[]')) with ordinality where value=v_key;
  select ordinality::integer into v_list from jsonb_array_elements_text(coalesce(p_display->'list_columns','[]')) with ordinality where value=v_key;
  v_field:=v_field||jsonb_build_object('x-order',coalesce(v_n,substring(v_key from 6)::integer));
  if p_display->>'representative'=v_key then v_field:=v_field||'{"x-representative":true}'::jsonb; end if;
  if v_list is not null then v_field:=v_field||'{"x-show-in-list":true}'::jsonb; end if;
  if coalesce(p_display->'archived' ? v_key,false) then v_field:=v_field||'{"deprecated":true}'::jsonb; end if;
  if v_list is not null and v_separate_list then v_field:=v_field||jsonb_build_object('x-list-order',v_list); end if;
  if v_field ? 'enum' then
   select jsonb_agg(jsonb_build_object('const',value)||case when value<>'null'::jsonb and (p_display->'option_labels'->v_key) ? (value#>>'{}') and p_display->'option_labels'->v_key->>(value#>>'{}')<>value#>>'{}' then jsonb_build_object('title',p_display->'option_labels'->v_key->>(value#>>'{}')) else '{}'::jsonb end order by ordinality)
    into v_options from jsonb_array_elements(v_field->'enum') with ordinality;
   v_field:=(v_field-'enum')||jsonb_build_object('oneOf',v_options);
  end if;
  v_properties:=v_properties||jsonb_build_object(v_key,v_field);
 end loop;
 return (p_schema-'properties')||jsonb_build_object('x-type-id',p_type,'x-version',p_version,'properties',v_properties);
end $$;
revoke all on function private.normalize_legacy_entity_schema(jsonb,jsonb,uuid,integer) from public,anon,authenticated,app_user,app_server,app_worker;

-- A valid old document can expand under oneOf and root metadata. Refuse atomically,
-- with an actionable diagnostic; never truncate facts or raise the product size cap.
do $$ declare v record; begin
 for v in
  select s.type_id,s.schema_version,octet_length(private.normalize_legacy_entity_schema(s.schema,s.display,s.type_id,s.schema_version)::text) as bytes
  from app.entity_schema_versions s
  union all
  select t.id,t.schema_version+1,octet_length((private.normalize_legacy_entity_schema(s.schema,s.display,s.type_id,t.schema_version+1)||jsonb_build_object('title',t.label,'x-icon',t.icon_id,'deprecated',t.archived))::text)
  from app.entity_types t join app.entity_schema_versions s on s.owner_id=t.owner_id and s.type_id=t.id and s.schema_version=t.schema_version
 loop
  if v.bytes>262144 then raise exception 'schema_document_upgrade_size_limit: type %, version %, bytes %, limit 262144',v.type_id,v.schema_version,v.bytes using errcode='54000'; end if;
 end loop;
end $$;

-- The commit function updates publication, values, records and result in one transaction.
-- After the locks above, a job still marked committing has not committed successfully.
-- Retain targets, source bytes, analyses and request receipts exactly; never re-hash/re-run.
update app.entity_schema_migrations set status='failed',fence=fence+1,version=version+1,
 lease_until=null,retryable=false,failure_reason='schema_plan_stale',updated_at=now()
 where status in ('queued','preparing','ready_to_commit','committing');
update app.entity_schema_analyses set status='failed',fence=fence+1,lease_until=null,
 retryable=false,failure_reason='schema_plan_stale' where status in ('queued','running');
update app.entity_schema_changes set status='stale',updated_at=now()
 where status not in ('applied','cancelled');
update app.entity_types set schema_write_locked=false;

-- Capture every inbound FK before replacing the two independent input columns.
create temporary table schema_document_inbound_fks on commit drop as
 select conrelid::regclass::text as relation,conname,pg_get_constraintdef(oid) as definition
 from pg_constraint where contype='f' and confrelid='app.entity_schema_versions'::regclass;
do $$ declare v record; begin
 for v in select * from schema_document_inbound_fks loop
  execute format('alter table %s drop constraint %I',v.relation,v.conname);
 end loop;
end $$;
-- Approved document-only expansion; properties JSON remains limited to 64 KiB.
alter table app.entity_schema_versions drop constraint entity_schema_definition_bytes;
alter table app.entity_schema_versions drop constraint entity_schema_versions_schema_check;
alter table app.entity_schema_versions add constraint entity_schema_document_bytes check(jsonb_typeof(schema)='object' and octet_length(schema::text)<=262144);
alter table app.entity_schema_versions disable trigger immutable_entity_schema;
update app.entity_schema_versions set schema=private.normalize_legacy_entity_schema(schema,display,type_id,schema_version);
alter table app.entity_schema_versions drop constraint entity_schema_versions_pkey;
alter table app.entity_schema_versions drop constraint entity_schema_versions_owner_id_type_id_fkey;
alter table app.entity_schema_versions drop column type_id,drop column schema_version,drop column display;
alter table app.entity_schema_versions
 add column type_id uuid generated always as ((schema->>'x-type-id')::uuid) stored not null,
 add column schema_version integer generated always as ((schema->>'x-version')::integer) stored not null,
 add constraint entity_schema_versions_pkey primary key(owner_id,type_id,schema_version),
 add constraint entity_schema_versions_owner_id_type_id_fkey foreign key(owner_id,type_id) references app.entity_types(owner_id,id) on delete cascade,
 add constraint entity_schema_document_version check(jsonb_typeof(schema->'x-version')='number' and schema_version>0 and (schema->>'x-version')::numeric=schema_version),
 add constraint entity_schema_document_id check(jsonb_typeof(schema->'x-type-id')='string');
do $$ declare v record; begin
 for v in select * from schema_document_inbound_fks loop
  execute format('alter table %s add constraint %I %s',v.relation,v.conname,v.definition);
 end loop;
end $$;
-- Publish the first complete head. Existing entities keep their original saved version.
insert into app.entity_schema_versions(owner_id,schema)
 select t.owner_id,v.schema||jsonb_build_object('x-version',t.schema_version+1,'title',t.label,'x-icon',t.icon_id,'deprecated',t.archived)
 from app.entity_types t join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version;
update app.entity_types set schema_version=schema_version+1,updated_at=now();
set constraints all immediate;
alter table app.entity_schema_versions enable trigger immutable_entity_schema;
alter table app.entity_types drop column label,drop column icon_id,drop column archived,drop column version;
-- Legacy targets remain internal evidence until the owner creates a fresh reviewed draft.
-- New targets have a single schema document and use the same 256 KiB publication bound.
alter table app.entity_schema_changes drop constraint entity_schema_changes_target_check;
alter table app.entity_schema_changes add constraint entity_schema_change_document_bytes check(octet_length((target->'schema')::text)<=262144);
drop function private.normalize_legacy_entity_schema(jsonb,jsonb,uuid,integer);

create or replace function app.claim_entity_schema_migration() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_candidate uuid; v_owner uuid; v_type_id uuid; v_job app.entity_schema_migrations%rowtype; v_batch jsonb;
begin
 perform private.cleanup_entity_schema_sources();
 select x.id,x.owner_id,x.type_id into v_candidate,v_owner,v_type_id from app.entity_schema_migrations x where x.status in ('queued','ready_to_commit') or (x.status in ('preparing','committing') and x.lease_until<now()) order by x.created_at,x.id limit 1;
 if v_candidate is null then return null; end if;
 perform 1 from app.entity_types t where t.owner_id=v_owner and t.id=v_type_id for update;
 select * into v_job from app.entity_schema_migrations where id=v_candidate for update;
 if not(v_job.status in ('queued','ready_to_commit') or (v_job.status in ('preparing','committing') and v_job.lease_until<now())) then return null; end if;
 update app.entity_schema_migrations set status=case when status in ('ready_to_commit','committing') then 'committing' else 'preparing' end,fence=fence+1,version=version+1,lease_until=now()+interval '90 seconds',updated_at=now() where id=v_job.id returning * into v_job;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'properties',r.source_properties,'after',r.after,'source',r.source_identity->>'source','external_id',r.source_identity->>'external_id','tag_ids',r.source_identity->'tag_ids','changed',r.changed,'recovery_properties',r.recovery_properties) order by r.entity_id collate "C"),'[]'::jsonb) into v_batch from
 (select * from (select x.*,sum(octet_length(source_properties::text)+octet_length(after::text)+coalesce(octet_length(recovery_properties::text),0)+octet_length(entity_id)+512) over(order by entity_id collate "C") as bytes,row_number() over(order by entity_id collate "C") as ordinal from private.entity_schema_migration_rows x where x.job_id=v_job.id and not prepared) bounded where bytes<=524288 and ordinal<=50) r;
 return jsonb_build_object('id',v_job.id,'owner_id',v_job.owner_id,'type_id',v_job.type_id,'fence',v_job.fence,'status',v_job.status,'target',v_job.target,'source_definition',v_job.source_definition,'recovery_keys',v_job.recovery_keys,'migration',v_job.migration,'source_schema_version',v_job.source_schema_version,'source_template_fingerprint',v_job.source_template_fingerprint,'templates',private.entity_schema_effective_templates(v_owner,v_type_id),'available_tags',coalesce((select jsonb_agg(id order by id) from app.tags where owner_id=v_owner and scope='record'),'[]'::jsonb),'type',(select jsonb_build_object('id',t.id,'label',s.schema->>'title','icon_id',s.schema->>'x-icon','archived',coalesce((s.schema->>'deprecated')::boolean,false)) from app.entity_types t join app.entity_schema_versions s on s.owner_id=t.owner_id and s.type_id=t.id and s.schema_version=t.schema_version where t.owner_id=v_owner and t.id=v_type_id),'rows',v_batch);
end $$;


create or replace function app.complete_entity_schema_analysis_batch(p_id uuid,p_fence bigint,p_results jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare v_a app.entity_schema_analyses%rowtype; v_c app.entity_schema_changes%rowtype; v_owner uuid; v_type_id uuid; v_result jsonb; v_n integer; v_bad integer; v_stale boolean;
begin
 select x.owner_id,x.type_id into v_owner,v_type_id from app.entity_schema_analyses x where x.id=p_id;
 if v_owner is null then return false; end if;
 perform 1 from app.entity_types t where t.owner_id=v_owner and t.id=v_type_id for update;
 if not found then return false; end if;
 select * into v_a from app.entity_schema_analyses x where x.id=p_id for update;
 if not found then return false; end if;
 if v_a.status<>'running' or v_a.fence<>p_fence or v_a.lease_until<=now() then return false; end if;
 select * into v_c from app.entity_schema_changes x where x.owner_id=v_owner and x.id=v_a.change_id for update;
 if v_c.version<>v_a.change_version or v_c.fingerprint<>v_a.fingerprint or v_c.analysis_id<>v_a.id then return false; end if;
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>50 then raise exception 'invalid analysis batch'; end if;
 for v_result in select value from jsonb_array_elements(p_results) loop
  if jsonb_typeof(v_result->'errors')<>'array' or jsonb_typeof(v_result->'after') not in ('object','null') or octet_length(v_result::text)>262144 then raise exception 'invalid analysis result'; end if;
  update private.entity_schema_analysis_rows set processed=true,errors=v_result->'errors',after=v_result->'after',after_bytes=(v_result->>'after_bytes')::integer,changed=(v_result->>'changed')::boolean,removed=(v_result->>'removed')::integer,replacements=(v_result->>'replacements')::integer where owner_id=v_owner and analysis_id=p_id and entity_id=v_result->>'entity_id' and not processed;
  if not found then raise exception 'unexpected analysis row'; end if;
 end loop;
 select count(*) filter(where processed), count(*) filter(where processed and jsonb_array_length(errors)>0) into v_n,v_bad from private.entity_schema_analysis_rows where owner_id=v_owner and analysis_id=p_id;
 if (select coalesce(sum(octet_length(properties::text)+coalesce(octet_length(recovery_properties::text),0)+octet_length(coalesce(after,'null'::jsonb)::text)+octet_length(errors::text)),0) from private.entity_schema_analysis_rows where analysis_id=p_id)>8388608 then
  update app.entity_schema_analyses set status='failed',processed=v_n,failed=v_bad,lease_until=null,retryable=false,failure_reason='analysis_result_limit' where id=p_id;
  update app.entity_schema_changes set status='draft',updated_at=now() where id=v_c.id;return true;
 end if;
 if v_n=v_a.total then
  select t.schema_version<>v_c.source_schema_version or t.schema_write_locked or app.entity_schema_membership(v_owner,v_type_id)<>v_a.membership into v_stale from app.entity_types t where t.owner_id=v_owner and t.id=v_type_id;
  update app.entity_schema_analyses set status='succeeded',processed=v_n,failed=v_bad,changed=(select count(*) from private.entity_schema_analysis_rows where analysis_id=p_id and processed and changed),unchanged=(select count(*) from private.entity_schema_analysis_rows where analysis_id=p_id and processed and not changed),removed=(select coalesce(sum(removed),0) from private.entity_schema_analysis_rows where analysis_id=p_id and processed),replacements=(select coalesce(sum(replacements),0) from private.entity_schema_analysis_rows where analysis_id=p_id and processed),lease_until=null where id=p_id;
  update app.entity_schema_changes set status=case when v_stale then 'stale' else 'ready' end,updated_at=now() where id=v_c.id;
 else
  update app.entity_schema_analyses set status='queued',processed=v_n,failed=v_bad,changed=(select count(*) from private.entity_schema_analysis_rows where analysis_id=p_id and processed and changed),unchanged=(select count(*) from private.entity_schema_analysis_rows where analysis_id=p_id and processed and not changed),removed=(select coalesce(sum(removed),0) from private.entity_schema_analysis_rows where analysis_id=p_id and processed),replacements=(select coalesce(sum(replacements),0) from private.entity_schema_analysis_rows where analysis_id=p_id and processed),lease_until=null where id=p_id;
 end if;
 return true;
end $$;


create or replace function app.commit_entity_schema_migration(p_id uuid,p_fence bigint,p_template_fingerprint text,p_pipeline text) returns boolean language plpgsql security definer set search_path='' as $$
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
 if not coalesce((v_job.target->'schema'->>'deprecated')::boolean,false)
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
 if v_count<>v_job.total then raise exception 'migration source changed' using errcode='40001'; end if;
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

-- Read retained success for an obsolete request shape without creating a new write.
-- Caller verifies the original fingerprint; no alias accepts old mutation payloads.
create function app.replay_retained_request(p_key uuid,p_operation text,p_fingerprint text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_row private.request_results%rowtype;
begin
 if v_owner is null then raise exception 'request_owner_missing' using errcode='42501'; end if;
 perform 1 from auth.users where id=v_owner for key share;
 if not found then raise exception 'request_owner_missing' using errcode='42501'; end if;
 select * into v_row from private.request_results where owner_id=v_owner and request_key=p_key;
 if not found then return jsonb_build_object('state','missing'); end if;
 if v_row.operation<>p_operation or v_row.fingerprint<>p_fingerprint then return jsonb_build_object('state','idempotency_key_reused'); end if;
 if v_row.completed_at is null then return jsonb_build_object('state','request_in_progress'); end if;
 if v_row.result is null or v_row.completed_at+interval '30 days'<=clock_timestamp() then return jsonb_build_object('state','result_expired'); end if;
 return jsonb_build_object('state','replay','result',v_row.result,'completed_at',v_row.completed_at);
end $$;
revoke all on function app.replay_retained_request(uuid,text,text) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.replay_retained_request(uuid,text,text) to app_user;

commit;
