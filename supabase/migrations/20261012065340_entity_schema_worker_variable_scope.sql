-- Forward-only repair after actual owner-role tests: all PL/pgSQL locals have v_ prefixes.
-- Real table columns and RPC parameter names are unchanged.

create or replace function app.claim_entity_schema_migration() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_candidate uuid; v_owner uuid; v_type_id uuid; v_job app.entity_schema_migrations%rowtype; v_batch jsonb;
begin
 with expired as materialized (select id,analysis_id from app.entity_schema_migrations where status in ('succeeded','failed','cancelled') and source_expires_at<=now() and source_definition<>'{}'::jsonb order by source_expires_at limit 20 for update skip locked),
 removed as (delete from private.entity_schema_migration_rows r using expired x where r.job_id=x.id returning r.job_id),
 preview_removed as (delete from private.entity_schema_analysis_rows r using expired x where r.analysis_id=x.analysis_id returning r.analysis_id),
 analyses_expired as (update app.entity_schema_analyses a set status='failed',retryable=false,failure_reason='analysis_source_expired' from expired x where a.id=x.analysis_id returning a.id),
 changes_expired as (update app.entity_schema_changes c set analysis_id=null,status='draft',updated_at=now() from expired x where c.analysis_id=x.analysis_id and c.status not in ('applied','cancelled') returning c.id)
 update app.entity_schema_migrations expired_job set source_definition='{}',source_templates='{}',source_references=null,committed_references=null,migration='{}' from expired x where expired_job.id=x.id;
 select x.id,x.owner_id,x.type_id into v_candidate,v_owner,v_type_id from app.entity_schema_migrations x where x.status in ('queued','ready_to_commit') or (x.status in ('preparing','committing') and x.lease_until<now()) order by x.created_at,x.id limit 1;
 if v_candidate is null then return null; end if;
 perform 1 from app.entity_types t where t.owner_id=v_owner and t.id=v_type_id for update;
 select * into v_job from app.entity_schema_migrations where id=v_candidate for update;
 if not(v_job.status in ('queued','ready_to_commit') or (v_job.status in ('preparing','committing') and v_job.lease_until<now())) then return null; end if;
 update app.entity_schema_migrations set status=case when status in ('ready_to_commit','committing') then 'committing' else 'preparing' end,fence=fence+1,version=version+1,lease_until=now()+interval '90 seconds',updated_at=now() where id=v_job.id returning * into v_job;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'properties',r.source_properties,'after',r.after,'source',r.source_identity->>'source','external_id',r.source_identity->>'external_id','tag_ids',r.source_identity->'tag_ids','changed',r.changed) order by r.entity_id collate "C"),'[]'::jsonb) into v_batch from
 (select * from (select x.*,sum(octet_length(source_properties::text)+octet_length(after::text)+octet_length(entity_id)+512) over(order by entity_id collate "C") as bytes,row_number() over(order by entity_id collate "C") as ordinal from private.entity_schema_migration_rows x where x.job_id=v_job.id and not prepared) bounded where bytes<=524288 and ordinal<=50) r;
 return jsonb_build_object('id',v_job.id,'owner_id',v_job.owner_id,'type_id',v_job.type_id,'fence',v_job.fence,'status',v_job.status,'target',v_job.target,'source_definition',v_job.source_definition,'migration',v_job.migration,'source_schema_version',v_job.source_schema_version,'source_template_fingerprint',v_job.source_template_fingerprint,'templates',private.entity_schema_effective_templates(v_owner,v_type_id),'available_tags',coalesce((select jsonb_agg(id order by id) from app.tags where owner_id=v_owner and scope='record'),'[]'::jsonb),'type',(select jsonb_build_object('id',t.id,'label',t.label,'icon_id',t.icon_id,'archived',t.archived) from app.entity_types t where t.owner_id=v_owner and t.id=v_type_id),'rows',v_batch);
end $$;

create or replace function app.stage_entity_schema_migration(p_id uuid,p_fence bigint,p_results jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_type_id uuid; v_job app.entity_schema_migrations%rowtype; v_count integer;
begin
 select x.owner_id,x.type_id into v_owner,v_type_id from app.entity_schema_migrations x where x.id=p_id;
 if v_owner is null then return false; end if;
 perform 1 from app.entity_types t where t.owner_id=v_owner and t.id=v_type_id for update;
 select * into v_job from app.entity_schema_migrations where id=p_id for update;
 if v_job.status<>'preparing' or v_job.fence<>p_fence or v_job.lease_until<=now() then return false; end if;
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>50 or octet_length(p_results::text)>1048576 then raise exception 'invalid migration batch' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_results) r left join private.entity_schema_migration_rows s on s.job_id=p_id and s.entity_id=r->>'entity_id' where s.entity_id is null or s.prepared or s.after<>r->'after' or s.changed<>(r->>'changed')::boolean or (s.changed and (jsonb_typeof(r->'record_context')<>'array' or jsonb_typeof(r->'record_tags')<>'array' or length(r->>'record_body')>22000))) then raise exception 'invalid migration row' using errcode='22023'; end if;
 update private.entity_schema_migration_rows s set prepared=true,record_id=case when s.changed then app.data_id_candidate() end,record_body=r->>'record_body',record_context=r->'record_context',record_tags=r->'record_tags',record_hash=r->>'record_hash',record_path=r->>'record_path' from jsonb_array_elements(p_results) r where s.job_id=p_id and s.entity_id=r->>'entity_id' and not s.prepared;
 get diagnostics v_count=row_count;
 if v_count<>jsonb_array_length(p_results) then raise exception 'duplicate migration rows' using errcode='22023'; end if;
 select count(*) into v_count from private.entity_schema_migration_rows where job_id=p_id and prepared;
 if (select coalesce(sum(octet_length(source_properties::text)+octet_length(after::text)+octet_length(source_identity::text)+octet_length(coalesce(record_body,''))+octet_length(coalesce(record_context,'null')::text)+octet_length(coalesce(record_tags,'null')::text)),0) from private.entity_schema_migration_rows where job_id=p_id)+octet_length(v_job.source_definition::text)+octet_length(v_job.target::text)+octet_length(v_job.source_references::text)+octet_length(v_job.source_templates::text)+octet_length(v_job.migration::text)>8388608 then
 update app.entity_schema_migrations set status='failed',version=version+1,processed=v_count,lease_until=null,retryable=false,failure_reason='migration_result_limit',updated_at=now() where id=p_id;
 update app.entity_types set schema_write_locked=false where owner_id=v_owner and id=v_type_id;
 return true; end if;
 update app.entity_schema_migrations set status=case when v_count=total then 'ready_to_commit' else 'queued' end,version=version+1,processed=v_count,lease_until=null,updated_at=now() where id=p_id;
 return true;
end $$;

create or replace function app.fail_entity_schema_migration(p_id uuid,p_fence bigint,p_reason text,p_retryable boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_type_id uuid; v_job app.entity_schema_migrations%rowtype;
begin
 select x.owner_id,x.type_id into v_owner,v_type_id from app.entity_schema_migrations x where x.id=p_id;
 if v_owner is null then return false; end if;
 perform 1 from app.entity_types t where t.owner_id=v_owner and t.id=v_type_id for update;
 select * into v_job from app.entity_schema_migrations where id=p_id for update;
 if v_job.status not in ('preparing','committing') or v_job.fence<>p_fence or v_job.lease_until<=now() then return false; end if;
 if p_reason not in ('migration_worker_failed','schema_plan_stale','migration_result_limit') then raise exception 'invalid migration failure' using errcode='22023'; end if;
 update app.entity_schema_migrations set status='failed',version=version+1,retryable=p_retryable and p_reason='migration_worker_failed',failure_reason=p_reason,lease_until=null,updated_at=now() where id=p_id;
 update app.entity_types set schema_write_locked=false where owner_id=v_owner and id=v_type_id;
 return true;
end $$;

create or replace function app.commit_entity_schema_migration(p_id uuid,p_fence bigint,p_template_fingerprint text,p_pipeline text) returns boolean language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_type_id uuid; v_job app.entity_schema_migrations%rowtype; v_type app.entity_types%rowtype; v_change app.entity_schema_changes%rowtype; v_next_schema integer; v_count integer;
begin
 select x.owner_id,x.type_id into v_owner,v_type_id from app.entity_schema_migrations x where x.id=p_id;
 if v_owner is null then return false; end if;
 select * into v_type from app.entity_types x where x.owner_id=v_owner and x.id=v_type_id for update;
 select * into v_job from app.entity_schema_migrations where id=p_id for update;
 if v_job.status<>'committing' or v_job.fence<>p_fence or v_job.lease_until<=now() then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':record_templates',0));
 select * into v_change from app.entity_schema_changes where owner_id=v_owner and id=v_job.change_id for update;
 if not v_type.schema_write_locked or v_type.version<>v_job.source_type_version or v_type.schema_version<>v_job.source_schema_version or v_change.version<>v_job.change_version or v_change.fingerprint<>v_job.fingerprint or v_change.analysis_id<>v_job.analysis_id or v_change.status<>'ready' or app.entity_schema_membership(v_owner,v_type_id)<>v_job.membership or p_template_fingerprint<>v_job.source_template_fingerprint or private.entity_schema_effective_templates(v_owner,v_type_id)<>v_job.source_templates or app.entity_schema_reference_baseline(v_owner,v_type_id)<>v_job.source_references then
 perform app.fail_entity_schema_migration(p_id,p_fence,'schema_plan_stale',false); return false; end if;
 if p_pipeline is null or char_length(p_pipeline) not between 1 and 120 then raise exception 'invalid pipeline' using errcode='22023'; end if;
 if v_job.processed<>v_job.total or (select count(*) from private.entity_schema_migration_rows where job_id=p_id and prepared)<>v_job.total then raise exception 'incomplete migration' using errcode='22023'; end if;
 perform 1 from app.entities e where e.owner_id=v_owner and e.entity_type_id=v_type_id order by e.id collate "C" for update;
 v_next_schema=v_type.schema_version+1;
 insert into app.entity_schema_versions(owner_id,type_id,schema_version,schema,display) values(v_owner,v_type_id,v_next_schema,v_job.target->'schema',v_job.target->'display');
 update app.entities e set properties=r.after,schema_version=v_next_schema,version=e.version+1,updated_at=now() from private.entity_schema_migration_rows r where r.job_id=p_id and r.owner_id=e.owner_id and r.entity_id=e.id and e.entity_type_id=v_type_id and e.version=r.source_version;
 get diagnostics v_count=row_count;
 if v_count<>v_job.total then raise exception 'migration source changed' using errcode='40001'; end if;
 update private.entity_schema_migration_rows set committed_version=source_version+1 where job_id=p_id;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
 insert into app.records(owner_id,id,entity_ids,entity_context,body,record_kind,change_metadata)
 select v_owner,r.record_id,array[r.entity_id],r.record_context,r.record_body,'change',jsonb_build_object('event_id',r.record_id,'target_kind','entity','target_id',r.entity_id,'target_title',r.after->>(v_job.target->'display'->>'representative'),'action','update','source',v_job.actor_source,'before',null,'after',null,'path',r.record_path,'schema_migration_id',v_job.id)
 from private.entity_schema_migration_rows r where r.job_id=p_id and r.changed;
 insert into app.record_tags(owner_id,record_id,tag_id) select v_owner,r.record_id,tag.id from private.entity_schema_migration_rows r cross join lateral jsonb_array_elements_text(r.record_tags) ids(id) join app.tags tag on tag.owner_id=v_owner and tag.scope='record' and tag.id=ids.id where r.job_id=p_id and r.changed;
 with queued as (insert into pgmq.q_search_index(vt,message) select now(),jsonb_build_object('owner_id',v_owner,'kind','record','id',r.record_id,'input_hash',r.record_hash,'pipeline',p_pipeline) from private.entity_schema_migration_rows r where r.job_id=p_id and r.changed returning msg_id,message)
 insert into app.search_index_state(owner_id,kind,id,input_hash,pipeline,message_id) select v_owner,'record',message->>'id',message->>'input_hash',p_pipeline,msg_id from queued;
 update app.entity_types set schema_version=v_next_schema,version=version+1,schema_write_locked=false,updated_at=now() where owner_id=v_owner and id=v_type_id;
 update app.entity_schema_changes set status='applied',updated_at=now() where owner_id=v_owner and id=v_job.change_id;
 update app.entity_schema_migrations set status='succeeded',version=version+1,lease_until=null,retryable=false,failure_reason=null,source_expires_at=now()+interval '30 days',committed_membership=app.entity_schema_membership(v_owner,v_type_id),committed_references=app.entity_schema_reference_baseline(v_owner,v_type_id),result=jsonb_build_object('schema_version',v_next_schema,'type_version',v_type.version+1,'total',v_job.total,'changed',(select count(*) from private.entity_schema_migration_rows where job_id=p_id and changed),'committed_at',now()),updated_at=now() where id=p_id;
 return true;
end $$;
