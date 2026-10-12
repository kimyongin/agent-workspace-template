-- Forward-only fix: PL/pgSQL j row variable must not share a table alias.
create or replace function app.claim_entity_schema_migration() returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate uuid; owner uuid; type_id uuid; j app.entity_schema_migrations%rowtype; batch jsonb;
begin
 with expired as materialized (select id,analysis_id from app.entity_schema_migrations where status in ('succeeded','failed','cancelled') and source_expires_at<=now() and source_definition<>'{}'::jsonb order by source_expires_at limit 20 for update skip locked),
 removed as (delete from private.entity_schema_migration_rows r using expired x where r.job_id=x.id returning r.job_id),
 preview_removed as (delete from private.entity_schema_analysis_rows r using expired x where r.analysis_id=x.analysis_id returning r.analysis_id),
 analyses_expired as (update app.entity_schema_analyses a set status='failed',retryable=false,failure_reason='analysis_source_expired' from expired x where a.id=x.analysis_id returning a.id),
 changes_expired as (update app.entity_schema_changes c set analysis_id=null,status='draft',updated_at=now() from expired x where c.analysis_id=x.analysis_id and c.status not in ('applied','cancelled') returning c.id)
 update app.entity_schema_migrations expired_job set source_definition='{}',source_templates='{}',source_references=null,committed_references=null,migration='{}' from expired x where expired_job.id=x.id;
 select x.id,x.owner_id,x.type_id into candidate,owner,type_id from app.entity_schema_migrations x where x.status in ('queued','ready_to_commit') or (x.status in ('preparing','committing') and x.lease_until<now()) order by x.created_at,x.id limit 1;
 if candidate is null then return null; end if;
 perform 1 from app.entity_types t where t.owner_id=owner and t.id=type_id for update;
 select * into j from app.entity_schema_migrations where id=candidate for update;
 if not(j.status in ('queued','ready_to_commit') or (j.status in ('preparing','committing') and j.lease_until<now())) then return null; end if;
 update app.entity_schema_migrations set status=case when status in ('ready_to_commit','committing') then 'committing' else 'preparing' end,fence=fence+1,version=version+1,lease_until=now()+interval '90 seconds',updated_at=now() where id=j.id returning * into j;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'properties',r.source_properties,'after',r.after,'source',r.source_identity->>'source','external_id',r.source_identity->>'external_id','tag_ids',r.source_identity->'tag_ids','changed',r.changed) order by r.entity_id collate "C"),'[]'::jsonb) into batch from
 (select * from (select x.*,sum(octet_length(source_properties::text)+octet_length(after::text)+octet_length(entity_id)+512) over(order by entity_id collate "C") as bytes,row_number() over(order by entity_id collate "C") as ordinal from private.entity_schema_migration_rows x where x.job_id=j.id and not prepared) bounded where bytes<=524288 and ordinal<=50) r;
 return jsonb_build_object('id',j.id,'owner_id',j.owner_id,'type_id',j.type_id,'fence',j.fence,'status',j.status,'target',j.target,'source_definition',j.source_definition,'migration',j.migration,'source_schema_version',j.source_schema_version,'source_template_fingerprint',j.source_template_fingerprint,'templates',private.entity_schema_effective_templates(owner,type_id),'available_tags',coalesce((select jsonb_agg(id order by id) from app.tags where owner_id=owner and scope='record'),'[]'::jsonb),'type',(select jsonb_build_object('id',t.id,'label',t.label,'icon_id',t.icon_id,'archived',t.archived) from app.entity_types t where t.owner_id=owner and t.id=type_id),'rows',batch);
end $$;

-- Preserve the shared 22000-codepoint record body contract during staging.
create or replace function app.stage_entity_schema_migration(p_id uuid,p_fence bigint,p_results jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare owner uuid; type_id uuid; j app.entity_schema_migrations%rowtype; n integer;
begin
 select x.owner_id,x.type_id into owner,type_id from app.entity_schema_migrations x where x.id=p_id;
 if owner is null then return false; end if;
 perform 1 from app.entity_types t where t.owner_id=owner and t.id=type_id for update;
 select * into j from app.entity_schema_migrations where id=p_id for update;
 if j.status<>'preparing' or j.fence<>p_fence or j.lease_until<=now() then return false; end if;
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>50 or octet_length(p_results::text)>1048576 then raise exception 'invalid migration batch' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_results) r left join private.entity_schema_migration_rows s on s.job_id=p_id and s.entity_id=r->>'entity_id' where s.entity_id is null or s.prepared or s.after<>r->'after' or s.changed<>(r->>'changed')::boolean or (s.changed and (jsonb_typeof(r->'record_context')<>'array' or jsonb_typeof(r->'record_tags')<>'array' or length(r->>'record_body')>22000))) then raise exception 'invalid migration row' using errcode='22023'; end if;
 update private.entity_schema_migration_rows s set prepared=true,record_id=case when s.changed then app.data_id_candidate() end,record_body=r->>'record_body',record_context=r->'record_context',record_tags=r->'record_tags',record_hash=r->>'record_hash',record_path=r->>'record_path' from jsonb_array_elements(p_results) r where s.job_id=p_id and s.entity_id=r->>'entity_id' and not s.prepared;
 get diagnostics n=row_count;
 if n<>jsonb_array_length(p_results) then raise exception 'duplicate migration rows' using errcode='22023'; end if;
 select count(*) into n from private.entity_schema_migration_rows where job_id=p_id and prepared;
 if (select coalesce(sum(octet_length(source_properties::text)+octet_length(after::text)+octet_length(source_identity::text)+octet_length(coalesce(record_body,''))+octet_length(coalesce(record_context,'null')::text)+octet_length(coalesce(record_tags,'null')::text)),0) from private.entity_schema_migration_rows where job_id=p_id)+octet_length(j.source_definition::text)+octet_length(j.target::text)+octet_length(j.source_references::text)+octet_length(j.source_templates::text)+octet_length(j.migration::text)>8388608 then
 update app.entity_schema_migrations set status='failed',version=version+1,processed=n,lease_until=null,retryable=false,failure_reason='migration_result_limit',updated_at=now() where id=p_id;
 update app.entity_types set schema_write_locked=false where owner_id=owner and id=type_id;
 return true; end if;
 update app.entity_schema_migrations set status=case when n=total then 'ready_to_commit' else 'queued' end,version=version+1,processed=n,lease_until=null,updated_at=now() where id=p_id;
 return true;
end $$;
