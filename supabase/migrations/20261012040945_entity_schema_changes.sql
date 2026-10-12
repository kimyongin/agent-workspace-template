-- Drafts reserve property numbers permanently. Published versions remain immutable.
create table app.entity_schema_changes (
 owner_id uuid not null, type_id uuid not null, id uuid not null default gen_random_uuid(),
 source_type_version integer not null, source_schema_version integer not null, source_template_version integer not null,
 version integer not null default 1 check(version>0),
 status text not null default 'draft' check(status in ('draft','analyzing','ready','stale','invalid','applied','cancelled')),
 kind text not null check(kind in ('compatible','migration_required')),
 edits jsonb not null, reservations jsonb not null, target jsonb not null, diff jsonb not null,
 fingerprint text not null, analysis_id uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(owner_id,id), unique(id),
 foreign key(owner_id,type_id) references app.entity_types(owner_id,id) on delete cascade,
 check(octet_length((target->'schema')::text)+octet_length((target->'display')::text)<=65536)
);
create table app.entity_schema_analyses (
 owner_id uuid not null, type_id uuid not null, change_id uuid not null, id uuid not null default gen_random_uuid(),
 change_version integer not null, fingerprint text not null, membership text not null,
 status text not null default 'queued' check(status in ('queued','running','succeeded','failed')),
 total integer not null check(total between 0 and 2000), processed integer not null default 0,
 failed integer not null default 0, fence bigint not null default 0, lease_until timestamptz,
 created_at timestamptz not null default now(), primary key(owner_id,id), unique(id),
 foreign key(owner_id,change_id) references app.entity_schema_changes(owner_id,id) on delete cascade
);
create table private.entity_schema_analysis_rows (
 owner_id uuid not null, analysis_id uuid not null, entity_id text not null, source_version integer not null,
 source_schema_version integer not null, properties jsonb not null, deleted_at timestamptz,
 processed boolean not null default false, errors jsonb not null default '[]',
 primary key(owner_id,analysis_id,entity_id),
 foreign key(owner_id,analysis_id) references app.entity_schema_analyses(owner_id,id) on delete cascade
);
create index entity_schema_analysis_queue on app.entity_schema_analyses(created_at) where status in ('queued','running');
alter table app.entity_schema_changes enable row level security;
alter table app.entity_schema_analyses enable row level security;
alter table private.entity_schema_analysis_rows enable row level security;
create policy schema_change_owner on app.entity_schema_changes for all to app_user using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy schema_analysis_owner on app.entity_schema_analyses for all to app_user using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy schema_analysis_rows_owner on private.entity_schema_analysis_rows for all to app_user using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
grant usage on schema private to app_user;
grant select,insert,update on app.entity_schema_changes,app.entity_schema_analyses,private.entity_schema_analysis_rows to app_user;
alter table app.entity_schema_versions add constraint entity_schema_definition_bytes check(octet_length(schema::text)+octet_length(display::text)<=65536);
-- No table grants to the worker; these narrow functions expose only claimed analysis batches.
create function app.entity_schema_membership(p_owner uuid,p_type uuid) returns text language sql stable set search_path='' as $$
 select md5(coalesce(jsonb_agg(jsonb_build_array(e.id,e.version,e.schema_version,e.properties,e.deleted_at) order by e.id)::text,'[]'))
 from app.entities e where e.owner_id=p_owner and e.entity_type_id=p_type
$$;
revoke all on function app.entity_schema_membership(uuid,uuid) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.entity_schema_membership(uuid,uuid) to app_user;
create function app.claim_entity_schema_analysis() returns jsonb language plpgsql security definer set search_path='' as $$
declare a app.entity_schema_analyses%rowtype; c app.entity_schema_changes%rowtype; candidate uuid; owner uuid; type_id uuid; batch jsonb;
begin
 select x.id,x.owner_id,x.type_id into candidate,owner,type_id from app.entity_schema_analyses x
 where x.status='queued' or (x.status='running' and x.lease_until<now()) order by x.created_at limit 1;
 if candidate is null then return null; end if;
 perform 1 from app.entity_types t where t.owner_id=owner and t.id=type_id for update;
 select * into a from app.entity_schema_analyses x where x.owner_id=owner and x.id=candidate for update;
 if not(a.status='queued' or (a.status='running' and a.lease_until<now())) then return null; end if;
 select * into c from app.entity_schema_changes x where x.owner_id=owner and x.id=a.change_id;
 if c.version<>a.change_version or c.fingerprint<>a.fingerprint or c.analysis_id<>a.id or c.status<>'analyzing' then
 update app.entity_schema_analyses set status='failed',fence=fence+1,lease_until=null where id=a.id; return null; end if;
 update app.entity_schema_analyses set status='running',fence=fence+1,lease_until=now()+interval '90 seconds' where id=a.id returning * into a;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'properties',r.properties) order by r.entity_id),'[]') into batch
 from (select * from private.entity_schema_analysis_rows x where x.owner_id=owner and x.analysis_id=a.id and not x.processed order by x.entity_id limit 50) r;
 return jsonb_build_object('id',a.id,'fence',a.fence,'target',c.target,'rows',batch);
end $$;
create function app.complete_entity_schema_analysis_batch(p_id uuid,p_fence bigint,p_results jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare a app.entity_schema_analyses%rowtype; c app.entity_schema_changes%rowtype; owner uuid; type_id uuid; result jsonb; n integer; bad integer; stale boolean;
begin
 select x.owner_id,x.type_id into owner,type_id from app.entity_schema_analyses x where x.id=p_id;
 if owner is null then return false; end if;
 perform 1 from app.entity_types t where t.owner_id=owner and t.id=type_id for update;
 select * into a from app.entity_schema_analyses x where x.id=p_id for update;
 if a.status<>'running' or a.fence<>p_fence or a.lease_until<=now() then return false; end if;
 select * into c from app.entity_schema_changes x where x.owner_id=owner and x.id=a.change_id for update;
 if c.version<>a.change_version or c.fingerprint<>a.fingerprint or c.analysis_id<>a.id then return false; end if;
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>50 then raise exception 'invalid analysis batch'; end if;
 for result in select value from jsonb_array_elements(p_results) loop
  if jsonb_typeof(result->'errors')<>'array' then raise exception 'invalid analysis result'; end if;
  update private.entity_schema_analysis_rows set processed=true,errors=result->'errors' where owner_id=owner and analysis_id=p_id and entity_id=result->>'entity_id' and not processed;
  if not found then raise exception 'unexpected analysis row'; end if;
 end loop;
 select count(*) filter(where processed), count(*) filter(where processed and jsonb_array_length(errors)>0) into n,bad from private.entity_schema_analysis_rows where owner_id=owner and analysis_id=p_id;
 if n=a.total then
  select t.version<>c.source_type_version or t.schema_version<>c.source_schema_version or t.schema_write_locked or coalesce((select s.version from app.user_business_settings s where s.owner_id=owner and s.id='record_templates'),0)<>c.source_template_version or app.entity_schema_membership(owner,type_id)<>a.membership into stale from app.entity_types t where t.owner_id=owner and t.id=type_id;
  update app.entity_schema_analyses set status='succeeded',processed=n,failed=bad,lease_until=null where id=p_id;
  update app.entity_schema_changes set status=case when stale then 'stale' else 'ready' end,updated_at=now() where id=c.id;
 else
  update app.entity_schema_analyses set status='queued',processed=n,failed=bad,lease_until=null where id=p_id;
 end if;
 return true;
end $$;
revoke all on function app.claim_entity_schema_analysis(),app.complete_entity_schema_analysis_batch(uuid,bigint,jsonb) from public,anon,authenticated,app_user,app_server,app_worker;
grant execute on function app.claim_entity_schema_analysis(),app.complete_entity_schema_analysis_batch(uuid,bigint,jsonb) to app_worker;
