-- Recovery is a trusted draft and uses the normal analysis, lease, stage and atomic commit path.
alter table app.entity_schema_changes add column recovery_source_job_id uuid, add column recovery_expires_at timestamptz, add column recovery_keys jsonb;
alter table app.entity_schema_changes add foreign key(owner_id,recovery_source_job_id) references app.entity_schema_migrations(owner_id,id) on delete cascade;
alter table app.entity_schema_migrations add column recovery_source_job_id uuid, add column recovery_keys jsonb;
alter table app.entity_schema_migrations add foreign key(owner_id,recovery_source_job_id) references app.entity_schema_migrations(owner_id,id) on delete cascade;
alter table private.entity_schema_analysis_rows add column recovery_properties jsonb;
alter table private.entity_schema_migration_rows add column recovery_properties jsonb;

-- A recovery accepted before expiry owns its bounded materialized bytes. Drafts cannot extend access.
-- All cleanup locks use type -> job/analysis/change, matching request and worker order.
create function private.cleanup_entity_schema_sources() returns void language plpgsql security definer set search_path='' as $$
declare v_item record; v_type uuid; v_job uuid; v_analysis uuid;
begin
 for v_item in select j.id,j.owner_id,j.type_id,j.analysis_id from app.entity_schema_migrations j where j.status in ('succeeded','failed','cancelled') and j.source_expires_at<=now() and j.source_definition<>'{}'::jsonb order by j.source_expires_at limit 20 loop
  select t.id into v_type from app.entity_types t where t.owner_id=v_item.owner_id and t.id=v_item.type_id for update skip locked;
  if v_type is null then continue; end if;
  select j.id into v_job from app.entity_schema_migrations j where j.id=v_item.id and j.status in ('succeeded','failed','cancelled') and j.source_expires_at<=now() for update skip locked;
  if v_job is null then continue; end if;
  delete from private.entity_schema_migration_rows where job_id=v_job;
  delete from private.entity_schema_analysis_rows where analysis_id=v_item.analysis_id;
  update app.entity_schema_analyses set status='failed',retryable=false,failure_reason='analysis_source_expired' where id=v_item.analysis_id;
  update app.entity_schema_changes set analysis_id=null,status='draft',updated_at=now() where analysis_id=v_item.analysis_id and status not in ('applied','cancelled');
  update app.entity_schema_migrations set source_definition='{}',source_templates='{}',source_references=null,committed_references=null,migration='{}',recovery_keys=null where id=v_job;
 end loop;
 for v_item in select a.id,a.owner_id,a.type_id from app.entity_schema_analyses a where a.created_at<=now()-interval '30 days' and exists(select 1 from private.entity_schema_analysis_rows r where r.analysis_id=a.id) and not exists(select 1 from app.entity_schema_migrations j where j.analysis_id=a.id and j.status in ('queued','preparing','ready_to_commit','committing')) order by a.created_at limit 20 loop
  select t.id into v_type from app.entity_types t where t.owner_id=v_item.owner_id and t.id=v_item.type_id for update skip locked;
  if v_type is null then continue; end if;
  select a.id into v_analysis from app.entity_schema_analyses a where a.id=v_item.id for update skip locked;
  if v_analysis is null then continue; end if;
  delete from private.entity_schema_analysis_rows where analysis_id=v_analysis;
  update app.entity_schema_analyses set status='failed',fence=fence+1,lease_until=null,retryable=false,failure_reason='analysis_source_expired' where id=v_analysis;
  update app.entity_schema_changes set analysis_id=null,status='draft',updated_at=now() where analysis_id=v_analysis and status not in ('applied','cancelled');
 end loop;
end $$;
revoke all on function private.cleanup_entity_schema_sources() from public,anon,authenticated,app_user,app_server,app_worker;

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
 return jsonb_build_object('id',v_job.id,'owner_id',v_job.owner_id,'type_id',v_job.type_id,'fence',v_job.fence,'status',v_job.status,'target',v_job.target,'source_definition',v_job.source_definition,'recovery_keys',v_job.recovery_keys,'migration',v_job.migration,'source_schema_version',v_job.source_schema_version,'source_template_fingerprint',v_job.source_template_fingerprint,'templates',private.entity_schema_effective_templates(v_owner,v_type_id),'available_tags',coalesce((select jsonb_agg(id order by id) from app.tags where owner_id=v_owner and scope='record'),'[]'::jsonb),'type',(select jsonb_build_object('id',t.id,'label',t.label,'icon_id',t.icon_id,'archived',t.archived) from app.entity_types t where t.owner_id=v_owner and t.id=v_type_id),'rows',v_batch);
end $$;


create or replace function app.claim_entity_schema_analysis() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_a app.entity_schema_analyses%rowtype; v_c app.entity_schema_changes%rowtype; v_candidate uuid; v_owner uuid; v_type_id uuid; v_batch jsonb;
begin
 select x.id,x.owner_id,x.type_id into v_candidate,v_owner,v_type_id from app.entity_schema_analyses x
 where x.status='queued' or (x.status='running' and x.lease_until<now()) order by x.created_at limit 1;
 if v_candidate is null then return null; end if;
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
  select t.version<>v_c.source_type_version or t.schema_version<>v_c.source_schema_version or t.schema_write_locked or app.entity_schema_membership(v_owner,v_type_id)<>v_a.membership into v_stale from app.entity_types t where t.owner_id=v_owner and t.id=v_type_id;
  update app.entity_schema_analyses set status='succeeded',processed=v_n,failed=v_bad,changed=(select count(*) from private.entity_schema_analysis_rows where analysis_id=p_id and processed and changed),unchanged=(select count(*) from private.entity_schema_analysis_rows where analysis_id=p_id and processed and not changed),removed=(select coalesce(sum(removed),0) from private.entity_schema_analysis_rows where analysis_id=p_id and processed),replacements=(select coalesce(sum(replacements),0) from private.entity_schema_analysis_rows where analysis_id=p_id and processed),lease_until=null where id=p_id;
  update app.entity_schema_changes set status=case when v_stale then 'stale' else 'ready' end,updated_at=now() where id=v_c.id;
 else
  update app.entity_schema_analyses set status='queued',processed=v_n,failed=v_bad,changed=(select count(*) from private.entity_schema_analysis_rows where analysis_id=p_id and processed and changed),unchanged=(select count(*) from private.entity_schema_analysis_rows where analysis_id=p_id and processed and not changed),removed=(select coalesce(sum(removed),0) from private.entity_schema_analysis_rows where analysis_id=p_id and processed),replacements=(select coalesce(sum(replacements),0) from private.entity_schema_analysis_rows where analysis_id=p_id and processed),lease_until=null where id=p_id;
 end if;
 return true;
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
 if (select coalesce(sum(octet_length(source_properties::text)+coalesce(octet_length(recovery_properties::text),0)+octet_length(after::text)+octet_length(source_identity::text)+octet_length(coalesce(record_body,''))+octet_length(coalesce(record_context,'null')::text)+octet_length(coalesce(record_tags,'null')::text)),0) from private.entity_schema_migration_rows where job_id=p_id)+octet_length(v_job.source_definition::text)+octet_length(v_job.target::text)+octet_length(v_job.source_references::text)+octet_length(v_job.source_templates::text)+octet_length(v_job.migration::text)>8388608 then
 update app.entity_schema_migrations set status='failed',version=version+1,processed=v_count,lease_until=null,retryable=false,failure_reason='migration_result_limit',updated_at=now() where id=p_id;
 update app.entity_types set schema_write_locked=false where owner_id=v_owner and id=v_type_id;
 return true; end if;
 update app.entity_schema_migrations set status=case when v_count=total then 'ready_to_commit' else 'queued' end,version=version+1,processed=v_count,lease_until=null,updated_at=now() where id=p_id;
 return true;
end $$;
