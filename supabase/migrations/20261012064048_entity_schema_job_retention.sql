-- Forward retention refinement. The original job migration is immutable.
alter table app.entity_schema_migrations add column committed_membership text;
alter table app.entity_schema_migrations alter column source_expires_at set default (now()+interval '30 days');
update app.entity_schema_migrations set source_expires_at=created_at+interval '30 days' where source_expires_at is null;
create or replace function app.claim_entity_schema_migration() returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate uuid; owner uuid; type_id uuid; j app.entity_schema_migrations%rowtype; batch jsonb;
begin
 with expired as materialized (select id,analysis_id from app.entity_schema_migrations where status in ('succeeded','failed','cancelled') and source_expires_at<=now() and source_definition<>'{}'::jsonb order by source_expires_at limit 20 for update skip locked),
 removed as (delete from private.entity_schema_migration_rows r using expired x where r.job_id=x.id returning r.job_id),
 preview_removed as (delete from private.entity_schema_analysis_rows r using expired x where r.analysis_id=x.analysis_id returning r.analysis_id),
 analyses_expired as (update app.entity_schema_analyses a set status='failed',retryable=false,failure_reason='analysis_source_expired' from expired x where a.id=x.analysis_id returning a.id),
 changes_expired as (update app.entity_schema_changes c set analysis_id=null,status='draft',updated_at=now() from expired x where c.analysis_id=x.analysis_id and c.status not in ('applied','cancelled') returning c.id)
 update app.entity_schema_migrations j set source_definition='{}',source_templates='{}',source_references=null,committed_references=null,migration='{}' from expired x where j.id=x.id;
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

create or replace function app.commit_entity_schema_migration(p_id uuid,p_fence bigint,p_template_fingerprint text,p_pipeline text) returns boolean language plpgsql security definer set search_path='' as $$
declare owner uuid; type_id uuid; j app.entity_schema_migrations%rowtype; t app.entity_types%rowtype; c app.entity_schema_changes%rowtype; next_schema integer; n integer;
begin
 select x.owner_id,x.type_id into owner,type_id from app.entity_schema_migrations x where x.id=p_id;
 if owner is null then return false; end if;
 select * into t from app.entity_types x where x.owner_id=owner and x.id=type_id for update;
 select * into j from app.entity_schema_migrations where id=p_id for update;
 if j.status<>'committing' or j.fence<>p_fence or j.lease_until<=now() then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text||':record_templates',0));
 select * into c from app.entity_schema_changes where owner_id=owner and id=j.change_id for update;
 if not t.schema_write_locked or t.version<>j.source_type_version or t.schema_version<>j.source_schema_version or c.version<>j.change_version or c.fingerprint<>j.fingerprint or c.analysis_id<>j.analysis_id or c.status<>'ready' or app.entity_schema_membership(owner,type_id)<>j.membership or p_template_fingerprint<>j.source_template_fingerprint or private.entity_schema_effective_templates(owner,type_id)<>j.source_templates or app.entity_schema_reference_baseline(owner,type_id)<>j.source_references then
 perform app.fail_entity_schema_migration(p_id,p_fence,'schema_plan_stale',false); return false; end if;
 if p_pipeline is null or char_length(p_pipeline) not between 1 and 120 then raise exception 'invalid pipeline' using errcode='22023'; end if;
 if j.processed<>j.total or (select count(*) from private.entity_schema_migration_rows where job_id=p_id and prepared)<>j.total then raise exception 'incomplete migration' using errcode='22023'; end if;
 perform 1 from app.entities e where e.owner_id=owner and e.entity_type_id=type_id order by e.id collate "C" for update;
 next_schema=t.schema_version+1;
 insert into app.entity_schema_versions(owner_id,type_id,schema_version,schema,display) values(owner,type_id,next_schema,j.target->'schema',j.target->'display');
 update app.entities e set properties=r.after,schema_version=next_schema,version=e.version+1,updated_at=now() from private.entity_schema_migration_rows r where r.job_id=p_id and r.owner_id=e.owner_id and r.entity_id=e.id and e.entity_type_id=type_id and e.version=r.source_version;
 get diagnostics n=row_count;
 if n<>j.total then raise exception 'migration source changed' using errcode='40001'; end if;
 update private.entity_schema_migration_rows set committed_version=source_version+1 where job_id=p_id;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);
 insert into app.records(owner_id,id,entity_ids,entity_context,body,record_kind,change_metadata)
 select owner,r.record_id,array[r.entity_id],r.record_context,r.record_body,'change',jsonb_build_object('event_id',r.record_id,'target_kind','entity','target_id',r.entity_id,'target_title',r.after->>(j.target->'display'->>'representative'),'action','update','source',j.actor_source,'before',null,'after',null,'path',r.record_path,'schema_migration_id',j.id)
 from private.entity_schema_migration_rows r where r.job_id=p_id and r.changed;
 insert into app.record_tags(owner_id,record_id,tag_id) select owner,r.record_id,tag.id from private.entity_schema_migration_rows r cross join lateral jsonb_array_elements_text(r.record_tags) ids(id) join app.tags tag on tag.owner_id=owner and tag.scope='record' and tag.id=ids.id where r.job_id=p_id and r.changed;
 with queued as (insert into pgmq.q_search_index(vt,message) select now(),jsonb_build_object('owner_id',owner,'kind','record','id',r.record_id,'input_hash',r.record_hash,'pipeline',p_pipeline) from private.entity_schema_migration_rows r where r.job_id=p_id and r.changed returning msg_id,message)
 insert into app.search_index_state(owner_id,kind,id,input_hash,pipeline,message_id) select owner,'record',message->>'id',message->>'input_hash',p_pipeline,msg_id from queued;
 update app.entity_types set schema_version=next_schema,version=version+1,schema_write_locked=false,updated_at=now() where owner_id=owner and id=type_id;
 update app.entity_schema_changes set status='applied',updated_at=now() where owner_id=owner and id=j.change_id;
 update app.entity_schema_migrations set status='succeeded',version=version+1,lease_until=null,retryable=false,failure_reason=null,source_expires_at=now()+interval '30 days',committed_membership=app.entity_schema_membership(owner,type_id),committed_references=app.entity_schema_reference_baseline(owner,type_id),result=jsonb_build_object('schema_version',next_schema,'type_version',t.version+1,'total',j.total,'changed',(select count(*) from private.entity_schema_migration_rows where job_id=p_id and changed),'committed_at',now()),updated_at=now() where id=p_id;
 return true;
end $$;
