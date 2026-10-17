begin;
-- Preserve standalone retention, acquiring the group owner/parent locks before kinds.
create or replace function private.cleanup_entity_schema_sources() returns void language plpgsql security definer set search_path='' as $$
declare v_item record; v_type uuid; v_job uuid; v_analysis uuid; v_group uuid;
begin
 for v_item in select j.id,j.owner_id,j.type_id,j.analysis_id from app.entity_schema_migrations j where j.status in ('succeeded','failed','cancelled') and j.source_expires_at<=now() and j.source_definition<>'{}'::jsonb order by j.source_expires_at limit 20 loop
  v_group:=private.lock_data_model_analysis(v_item.analysis_id);
  select t.id into v_type from app.entity_types t where t.owner_id=v_item.owner_id and t.id=v_item.type_id for update skip locked;
  if v_type is null then continue; end if;
  select j.id into v_job from app.entity_schema_migrations j where j.owner_id=v_item.owner_id and j.id=v_item.id and j.status in ('succeeded','failed','cancelled') and j.source_expires_at<=now() for update skip locked;
  if v_job is null then continue; end if;
  delete from private.entity_schema_migration_rows where owner_id=v_item.owner_id and job_id=v_job;
  delete from private.entity_schema_analysis_rows where owner_id=v_item.owner_id and analysis_id=v_item.analysis_id;
  update app.entity_schema_analyses set status='failed',retryable=false,failure_reason='analysis_source_expired' where owner_id=v_item.owner_id and id=v_item.analysis_id;
  update app.entity_schema_changes set analysis_id=null,status='draft',updated_at=now() where owner_id=v_item.owner_id and analysis_id=v_item.analysis_id and status not in ('applied','cancelled');
  update app.entity_schema_migrations set source_definition='{}',source_templates='{}',source_references=null,committed_references=null,migration='{}',recovery_keys=null where owner_id=v_item.owner_id and id=v_job;
  if v_group is not null then perform app.refresh_data_model_analysis(v_group);end if;
 end loop;
 for v_item in select a.id,a.owner_id,a.type_id from app.entity_schema_analyses a where a.created_at<=now()-interval '30 days' and exists(select 1 from private.entity_schema_analysis_rows r where r.owner_id=a.owner_id and r.analysis_id=a.id) and not exists(select 1 from app.entity_schema_migrations j where j.owner_id=a.owner_id and j.analysis_id=a.id and j.status in ('queued','preparing','ready_to_commit','committing')) order by a.created_at limit 20 loop
  v_group:=private.lock_data_model_analysis(v_item.id);
  select t.id into v_type from app.entity_types t where t.owner_id=v_item.owner_id and t.id=v_item.type_id for update skip locked;
  if v_type is null then continue; end if;
  select a.id into v_analysis from app.entity_schema_analyses a where a.owner_id=v_item.owner_id and a.id=v_item.id for update skip locked;
  if v_analysis is null then continue; end if;
  delete from private.entity_schema_analysis_rows where owner_id=v_item.owner_id and analysis_id=v_analysis;
  update app.entity_schema_analyses set status='failed',fence=fence+1,lease_until=null,retryable=false,failure_reason='analysis_source_expired' where owner_id=v_item.owner_id and id=v_analysis;
  update app.entity_schema_changes set analysis_id=null,status='draft',updated_at=now() where owner_id=v_item.owner_id and analysis_id=v_analysis and status not in ('applied','cancelled');
  if v_group is not null then perform app.refresh_data_model_analysis(v_group);end if;
 end loop;
end $$;
revoke all on function private.cleanup_entity_schema_sources() from public,anon,authenticated,app_user,app_server,app_worker;

create or replace function app.claim_entity_schema_analysis() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_a app.entity_schema_analyses%rowtype; v_c app.entity_schema_changes%rowtype; v_candidate uuid; v_owner uuid; v_type_id uuid; v_batch jsonb; v_group uuid;
begin
 select x.id,x.owner_id,x.type_id into v_candidate,v_owner,v_type_id from app.entity_schema_analyses x
 where (x.status='queued' or (x.status='running' and x.lease_until<now())) and exists(select 1 from app.entity_schema_changes c where c.owner_id=x.owner_id and c.id=x.change_id and (c.model_change_id is null or exists(select 1 from app.data_model_changes g where g.owner_id=c.owner_id and g.id=c.model_change_id and g.status='analyzing'))) order by x.created_at limit 1;
 if v_candidate is null then return null; end if;
 v_group:=private.lock_data_model_analysis(v_candidate);
 perform 1 from app.entity_types t where t.owner_id=v_owner and t.id=v_type_id for update;
 if not found then return null; end if;
 select * into v_a from app.entity_schema_analyses x where x.owner_id=v_owner and x.id=v_candidate for update;
 if not found then return null; end if;
 if not(v_a.status='queued' or (v_a.status='running' and v_a.lease_until<now())) then return null; end if;
 select * into v_c from app.entity_schema_changes x where x.owner_id=v_owner and x.id=v_a.change_id;
 if v_c.recovery_expires_at<=now() then update app.entity_schema_analyses set status='failed',failure_reason='analysis_source_expired',fence=fence+1,lease_until=null where owner_id=v_owner and id=v_a.id; if v_group is not null then perform app.refresh_data_model_analysis(v_group);end if; return null; end if;
 if v_c.version<>v_a.change_version or v_c.fingerprint<>v_a.fingerprint or v_c.analysis_id<>v_a.id or v_c.status<>'analyzing' then
 update app.entity_schema_analyses set status='failed',fence=fence+1,lease_until=null where owner_id=v_owner and id=v_a.id; if v_group is not null then perform app.refresh_data_model_analysis(v_group);end if; return null; end if;
 update app.entity_schema_analyses set status='running',fence=fence+1,lease_until=now()+interval '90 seconds' where owner_id=v_owner and id=v_a.id returning * into v_a;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'properties',r.properties,'recovery_properties',r.recovery_properties) order by r.entity_id),'[]') into v_batch
 from (select * from (select x.*,sum(octet_length(x.properties::text)+coalesce(octet_length(x.recovery_properties::text),0)+octet_length(x.entity_id)+256) over(order by x.entity_id) as bytes,row_number() over(order by x.entity_id) as ordinal from private.entity_schema_analysis_rows x where x.owner_id=v_owner and x.analysis_id=v_a.id and not x.processed) bounded where bytes<=524288 and ordinal<=50) r;
 return jsonb_build_object('id',v_a.id,'fence',v_a.fence,'target',v_c.target,'recovery_keys',v_c.recovery_keys,'migration',v_c.migration,'rows',v_batch);
end $$;

commit;
