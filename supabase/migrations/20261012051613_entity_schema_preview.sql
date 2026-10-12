-- Restricted immutable analysis output; this migration never applies entity values.
alter table app.entity_schema_changes drop column source_template_version;
alter table app.entity_schema_changes add column source_template_fingerprint text,add column migration jsonb not null default '{"rules":[],"overrides":[]}';
alter table app.entity_schema_analyses add column changed integer not null default 0,add column unchanged integer not null default 0,add column removed integer not null default 0,add column replacements integer not null default 0,add column retryable boolean not null default false,add column failure_reason text;
alter table private.entity_schema_analysis_rows add column after jsonb,add column after_bytes integer not null default 0,add column changed boolean not null default false,add column removed integer not null default 0,add column replacements integer not null default 0;
create or replace function app.claim_entity_schema_analysis() returns jsonb language plpgsql security definer set search_path='' as $$
declare a app.entity_schema_analyses%rowtype; c app.entity_schema_changes%rowtype; candidate uuid; owner uuid; type_id uuid; batch jsonb;
begin
 select x.id,x.owner_id,x.type_id into candidate,owner,type_id from app.entity_schema_analyses x
 where x.status='queued' or (x.status='running' and x.lease_until<now()) order by x.created_at limit 1;
 if candidate is null then return null; end if;
 perform 1 from app.entity_types t where t.owner_id=owner and t.id=type_id for update;
 if not found then return null; end if;
 select * into a from app.entity_schema_analyses x where x.owner_id=owner and x.id=candidate for update;
 if not found then return null; end if;
 if not(a.status='queued' or (a.status='running' and a.lease_until<now())) then return null; end if;
 select * into c from app.entity_schema_changes x where x.owner_id=owner and x.id=a.change_id;
 if c.version<>a.change_version or c.fingerprint<>a.fingerprint or c.analysis_id<>a.id or c.status<>'analyzing' then
 update app.entity_schema_analyses set status='failed',fence=fence+1,lease_until=null where id=a.id; return null; end if;
 update app.entity_schema_analyses set status='running',fence=fence+1,lease_until=now()+interval '90 seconds' where id=a.id returning * into a;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'properties',r.properties) order by r.entity_id),'[]') into batch
 from (select * from (select x.*,sum(octet_length(x.properties::text)+octet_length(x.entity_id)+256) over(order by x.entity_id) as bytes,row_number() over(order by x.entity_id) as ordinal from private.entity_schema_analysis_rows x where x.owner_id=owner and x.analysis_id=a.id and not x.processed) bounded where bytes<=524288 and ordinal<=50) r;
 return jsonb_build_object('id',a.id,'fence',a.fence,'target',c.target,'migration',c.migration,'rows',batch);
end $$;
create or replace function app.complete_entity_schema_analysis_batch(p_id uuid,p_fence bigint,p_results jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare a app.entity_schema_analyses%rowtype; c app.entity_schema_changes%rowtype; owner uuid; type_id uuid; result jsonb; n integer; bad integer; stale boolean;
begin
 select x.owner_id,x.type_id into owner,type_id from app.entity_schema_analyses x where x.id=p_id;
 if owner is null then return false; end if;
 perform 1 from app.entity_types t where t.owner_id=owner and t.id=type_id for update;
 if not found then return false; end if;
 select * into a from app.entity_schema_analyses x where x.id=p_id for update;
 if not found then return false; end if;
 if a.status<>'running' or a.fence<>p_fence or a.lease_until<=now() then return false; end if;
 select * into c from app.entity_schema_changes x where x.owner_id=owner and x.id=a.change_id for update;
 if c.version<>a.change_version or c.fingerprint<>a.fingerprint or c.analysis_id<>a.id then return false; end if;
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>50 then raise exception 'invalid analysis batch'; end if;
 for result in select value from jsonb_array_elements(p_results) loop
  if jsonb_typeof(result->'errors')<>'array' or jsonb_typeof(result->'after') not in ('object','null') or octet_length(result::text)>262144 then raise exception 'invalid analysis result'; end if;
  update private.entity_schema_analysis_rows set processed=true,errors=result->'errors',after=result->'after',after_bytes=(result->>'after_bytes')::integer,changed=(result->>'changed')::boolean,removed=(result->>'removed')::integer,replacements=(result->>'replacements')::integer where owner_id=owner and analysis_id=p_id and entity_id=result->>'entity_id' and not processed;
  if not found then raise exception 'unexpected analysis row'; end if;
 end loop;
 select count(*) filter(where processed), count(*) filter(where processed and jsonb_array_length(errors)>0) into n,bad from private.entity_schema_analysis_rows where owner_id=owner and analysis_id=p_id;
 if (select coalesce(sum(octet_length(properties::text)+octet_length(coalesce(after,'null'::jsonb)::text)+octet_length(errors::text)),0) from private.entity_schema_analysis_rows where analysis_id=p_id)>8388608 then
  update app.entity_schema_analyses set status='failed',processed=n,failed=bad,lease_until=null,retryable=false,failure_reason='analysis_result_limit' where id=p_id;
  update app.entity_schema_changes set status='draft',updated_at=now() where id=c.id;return true;
 end if;
 if n=a.total then
  select t.version<>c.source_type_version or t.schema_version<>c.source_schema_version or t.schema_write_locked or app.entity_schema_membership(owner,type_id)<>a.membership into stale from app.entity_types t where t.owner_id=owner and t.id=type_id;
  update app.entity_schema_analyses set status='succeeded',processed=n,failed=bad,changed=(select count(*) from private.entity_schema_analysis_rows where analysis_id=p_id and processed and changed),unchanged=(select count(*) from private.entity_schema_analysis_rows where analysis_id=p_id and processed and not changed),removed=(select coalesce(sum(removed),0) from private.entity_schema_analysis_rows where analysis_id=p_id and processed),replacements=(select coalesce(sum(replacements),0) from private.entity_schema_analysis_rows where analysis_id=p_id and processed),lease_until=null where id=p_id;
  update app.entity_schema_changes set status=case when stale then 'stale' else 'ready' end,updated_at=now() where id=c.id;
 else
  update app.entity_schema_analyses set status='queued',processed=n,failed=bad,changed=(select count(*) from private.entity_schema_analysis_rows where analysis_id=p_id and processed and changed),unchanged=(select count(*) from private.entity_schema_analysis_rows where analysis_id=p_id and processed and not changed),removed=(select coalesce(sum(removed),0) from private.entity_schema_analysis_rows where analysis_id=p_id and processed),replacements=(select coalesce(sum(replacements),0) from private.entity_schema_analysis_rows where analysis_id=p_id and processed),lease_until=null where id=p_id;
 end if;
 return true;
end $$;

create function app.fail_entity_schema_analysis(p_id uuid,p_fence bigint) returns boolean language plpgsql security definer set search_path='' as $$
declare owner uuid; type_id uuid; a app.entity_schema_analyses%rowtype;
begin
 select x.owner_id,x.type_id into owner,type_id from app.entity_schema_analyses x where x.id=p_id;
 if owner is null then return false; end if;
 perform 1 from app.entity_types t where t.owner_id=owner and t.id=type_id for update;
 select * into a from app.entity_schema_analyses x where x.id=p_id for update;
 if a.status<>'running' or a.fence<>p_fence or a.lease_until<=now() then return false; end if;
 update app.entity_schema_analyses set status='failed',failure_reason='analysis_worker_failed',retryable=true,lease_until=null where id=p_id;
 update app.entity_schema_changes set status='draft',updated_at=now() where id=a.change_id and analysis_id=p_id;
 return true;
end $$;
revoke all on function app.fail_entity_schema_analysis(uuid,bigint) from public,anon,authenticated,app_user,app_server,app_worker;
grant execute on function app.fail_entity_schema_analysis(uuid,bigint) to app_worker;
