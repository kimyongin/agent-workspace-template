-- Preparation and recovery are owner/type scoped. Workers only execute fenced RPCs.
create table app.entity_schema_migrations (
 owner_id uuid not null, type_id uuid not null, id uuid not null default gen_random_uuid(),
 change_id uuid not null, change_version integer not null, analysis_id uuid not null,
 fingerprint text not null, membership text not null,
 source_type_version integer not null, source_schema_version integer not null,
 source_template_fingerprint text not null, source_templates jsonb not null,
 source_definition jsonb not null, target jsonb not null, migration jsonb not null,
 source_references jsonb, committed_references jsonb,
 status text not null default 'queued' check(status in ('queued','preparing','ready_to_commit','committing','succeeded','failed','cancelled')),
 version integer not null default 1, total integer not null check(total between 0 and 2000), processed integer not null default 0,
 fence bigint not null default 0, lease_until timestamptz,
 retryable boolean not null default false, failure_reason text, result jsonb, source_expires_at timestamptz,
 actor_source text not null check(actor_source in ('http','mcp')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(owner_id,id), unique(id),
 foreign key(owner_id,type_id) references app.entity_types(owner_id,id) on delete cascade,
 foreign key(owner_id,change_id) references app.entity_schema_changes(owner_id,id),
 foreign key(owner_id,analysis_id) references app.entity_schema_analyses(owner_id,id)
);
create unique index entity_schema_one_active_job on app.entity_schema_migrations(owner_id,type_id) where status in ('queued','preparing','ready_to_commit','committing');
create index entity_schema_job_queue on app.entity_schema_migrations(created_at,id) where status in ('queued','preparing','ready_to_commit','committing');
create table private.entity_schema_migration_rows (
 owner_id uuid not null, job_id uuid not null, entity_id text not null,
 source_version integer not null, source_schema_version integer not null, source_properties jsonb not null,
 source_deleted_at timestamptz, source_identity jsonb not null,
 after jsonb not null, changed boolean not null, prepared boolean not null default false,
 record_id text, record_body text, record_context jsonb, record_tags jsonb, record_hash text, record_path text,
 committed_version integer,
 primary key(owner_id,job_id,entity_id), unique(job_id,record_id),
 foreign key(owner_id,job_id) references app.entity_schema_migrations(owner_id,id) on delete cascade
);
alter table app.entity_schema_migrations enable row level security;
alter table private.entity_schema_migration_rows enable row level security;
create policy migration_owner on app.entity_schema_migrations for all to app_user using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy migration_rows_owner on private.entity_schema_migration_rows for all to app_user using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
grant select,insert,update on app.entity_schema_migrations,private.entity_schema_migration_rows to app_user;
grant delete on private.entity_schema_migration_rows to app_user;

-- Semantic references, not task/record note versions or peer values. Historical contexts are retained.
create function app.entity_schema_reference_baseline(p_owner uuid,p_type uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
 'pairs',coalesce((select jsonb_agg(jsonb_build_array(p.entity_id,p.other_id,p.created_at) order by p.entity_id collate "C",p.other_id collate "C") from app.entity_pairs p where p.owner_id=p_owner and exists(select 1 from app.entities e where e.owner_id=p_owner and e.entity_type_id=p_type and e.id in (p.entity_id,p.other_id))),'[]'::jsonb),
 'tasks',coalesce((select jsonb_agg(jsonb_build_array(t.id,t.entity_ids,t.entity_context) order by t.id collate "C") from app.tasks t where t.owner_id=p_owner and exists(select 1 from app.entities e where e.owner_id=p_owner and e.entity_type_id=p_type and e.id=any(t.entity_ids))),'[]'::jsonb),
 'records',coalesce((select jsonb_agg(jsonb_build_array(r.id,r.task_id,r.entity_ids,r.entity_context) order by r.id collate "C") from app.records r where r.owner_id=p_owner and r.record_kind<>'change' and exists(select 1 from app.entities e where e.owner_id=p_owner and e.entity_type_id=p_type and e.id=any(r.entity_ids))),'[]'::jsonb))
$$;
revoke all on function app.entity_schema_reference_baseline(uuid,uuid) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.entity_schema_reference_baseline(uuid,uuid) to app_user;

-- JSONB semantic equality reproduces the app's effective type template boundary.
create function private.entity_schema_effective_templates(p_owner uuid,p_type uuid) returns jsonb language sql stable set search_path='' as $$
 with settings as (select coalesce((select settings from app.user_business_settings where owner_id=p_owner and id='record_templates'),'{}'::jsonb) as data),
 actions as (select action,coalesce(data->'entity_types'->p_type::text->action,data->'entity'->action,'{}'::jsonb) as value from settings cross join unnest(array['create','update','delete','restore']) action)
 select jsonb_build_object('entity',jsonb_object_agg(action,jsonb_build_object(
 'memo',case when coalesce(value->>'memo','')~'^[[:space:]]*$' then case when action='update' then '$대상$ $액션$ ($변경항목$)' else '$대상$ $액션$' end else regexp_replace(value->>'memo','\$\{([^$]*?)\$\}','\$\1\$','g') end,
 'tag_ids',coalesce((select jsonb_agg(tag order by tag collate "C") from jsonb_array_elements_text(coalesce(value->'tag_ids','[]'::jsonb)) tag),'[]'::jsonb)))) from actions
$$;

create function app.claim_entity_schema_migration() returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate uuid; owner uuid; type_id uuid; j app.entity_schema_migrations%rowtype; batch jsonb;
begin
 with expired as materialized (select id,analysis_id from app.entity_schema_migrations where source_expires_at<=now() and source_definition<>'{}'::jsonb order by source_expires_at limit 20 for update skip locked), removed as (delete from private.entity_schema_migration_rows r using expired x where r.job_id=x.id returning r.job_id), preview_removed as (delete from private.entity_schema_analysis_rows r using expired x where r.analysis_id=x.analysis_id returning r.analysis_id) update app.entity_schema_migrations j set source_definition='{}',source_templates='{}',source_references=null,committed_references=null,migration='{}' from expired x where j.id=x.id;
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

create function app.stage_entity_schema_migration(p_id uuid,p_fence bigint,p_results jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare owner uuid; type_id uuid; j app.entity_schema_migrations%rowtype; n integer;
begin
 select x.owner_id,x.type_id into owner,type_id from app.entity_schema_migrations x where x.id=p_id;
 if owner is null then return false; end if;
 perform 1 from app.entity_types t where t.owner_id=owner and t.id=type_id for update;
 select * into j from app.entity_schema_migrations where id=p_id for update;
 if j.status<>'preparing' or j.fence<>p_fence or j.lease_until<=now() then return false; end if;
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>50 or octet_length(p_results::text)>1048576 then raise exception 'invalid migration batch' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_results) r left join private.entity_schema_migration_rows s on s.job_id=p_id and s.entity_id=r->>'entity_id' where s.entity_id is null or s.prepared or s.after<>r->'after' or s.changed<>(r->>'changed')::boolean or (s.changed and (jsonb_typeof(r->'record_context')<>'array' or jsonb_typeof(r->'record_tags')<>'array' or length(r->>'record_body')>20000))) then raise exception 'invalid migration row' using errcode='22023'; end if;
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

create function app.fail_entity_schema_migration(p_id uuid,p_fence bigint,p_reason text,p_retryable boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare owner uuid; type_id uuid; j app.entity_schema_migrations%rowtype;
begin
 select x.owner_id,x.type_id into owner,type_id from app.entity_schema_migrations x where x.id=p_id;
 if owner is null then return false; end if;
 perform 1 from app.entity_types t where t.owner_id=owner and t.id=type_id for update;
 select * into j from app.entity_schema_migrations where id=p_id for update;
 if j.status not in ('preparing','committing') or j.fence<>p_fence or j.lease_until<=now() then return false; end if;
 if p_reason not in ('migration_worker_failed','schema_plan_stale','migration_result_limit') then raise exception 'invalid migration failure' using errcode='22023'; end if;
 update app.entity_schema_migrations set status='failed',version=version+1,retryable=p_retryable and p_reason='migration_worker_failed',failure_reason=p_reason,lease_until=null,updated_at=now() where id=p_id;
 update app.entity_types set schema_write_locked=false where owner_id=owner and id=type_id;
 return true;
end $$;

-- A single transaction commits the pointer, every row (including deleted), facts, index intents and result.
-- No prepare transaction spans requests and no worker receives table privileges.
create function app.commit_entity_schema_migration(p_id uuid,p_fence bigint,p_template_fingerprint text,p_pipeline text) returns boolean language plpgsql security definer set search_path='' as $$
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
 update app.entity_schema_migrations set status='succeeded',version=version+1,lease_until=null,retryable=false,failure_reason=null,source_expires_at=now()+interval '30 days',committed_references=app.entity_schema_reference_baseline(owner,type_id),result=jsonb_build_object('schema_version',next_schema,'type_version',t.version+1,'total',j.total,'changed',(select count(*) from private.entity_schema_migration_rows where job_id=p_id and changed),'committed_at',now()),updated_at=now() where id=p_id;
 return true;
end $$;
revoke all on function private.entity_schema_effective_templates(uuid,uuid) from public,anon,authenticated,app_user,app_server,app_worker;
revoke all on function app.claim_entity_schema_migration(),app.stage_entity_schema_migration(uuid,bigint,jsonb),app.fail_entity_schema_migration(uuid,bigint,text,boolean),app.commit_entity_schema_migration(uuid,bigint,text,text) from public,anon,authenticated,app_user,app_server,app_worker;
grant execute on function app.claim_entity_schema_migration(),app.stage_entity_schema_migration(uuid,bigint,jsonb),app.fail_entity_schema_migration(uuid,bigint,text,boolean),app.commit_entity_schema_migration(uuid,bigint,text,text) to app_worker;
