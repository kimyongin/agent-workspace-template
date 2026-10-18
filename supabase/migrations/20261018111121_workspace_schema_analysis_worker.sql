-- Internal worker authority comes exclusively from persisted execution facts.
-- No internal processing token or forged JWT grants business permission.
create function private.schema_execution_allows(p_user uuid,p_workspace uuid,p_generation bigint,p_kinds uuid[])
 returns boolean language sql stable set search_path='' as $$
 select p_user is not null and p_workspace is not null and p_generation is not null
  and cardinality(p_kinds)>0
  and exists(select 1 from app.workspaces w where w.id=p_workspace and w.deleted_at is null and w.lifecycle_generation=p_generation)
  and private.workspace_allows(p_user,p_workspace,'settings','*','write')
  and not exists(select 1 from unnest(p_kinds) id where not private.workspace_allows(p_user,p_workspace,'entity_type',id::text,'write'))
$$;
create function private.lock_schema_execution(p_user uuid,p_workspace uuid) returns boolean
 language plpgsql set search_path='' as $$
begin
 if p_user is null or p_workspace is null then return false;end if;
 perform 1 from auth.users where id=p_user for share;
 if not found then return false;end if;
 perform 1 from app.workspaces where id=p_workspace for share;
 if not found then return false;end if;
 perform set_config('request.workspace_id',p_workspace::text,true);
 perform set_config('request.workspace_lock_mode','business',true);
 return true;
end $$;
create function private.schema_analysis_current(p_id uuid) returns boolean language sql stable set search_path='' as $$
 select coalesce((select private.schema_execution_allows(a.initiated_by,a.workspace_id,a.workspace_generation,a.required_kind_ids)
  from app.entity_schema_analyses a where a.id=p_id),false)
$$;
create function private.authorize_schema_analysis(p_id uuid) returns boolean language plpgsql set search_path='' as $$
declare a app.entity_schema_analyses%rowtype;
begin
 select * into a from app.entity_schema_analyses where id=p_id;
 if not found or not private.lock_schema_execution(a.initiated_by,a.workspace_id) then return false;end if;
 -- New statement after both lock waits: current account, membership, grants and generation.
 return private.schema_analysis_current(p_id);
end $$;
revoke all on function private.schema_execution_allows(uuid,uuid,bigint,uuid[]),private.lock_schema_execution(uuid,uuid),
 private.schema_analysis_current(uuid),private.authorize_schema_analysis(uuid) from public,anon,authenticated,app_user,app_server,app_worker;

CREATE OR REPLACE FUNCTION private.lock_data_model_analysis(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_owner uuid;v_group uuid;
begin
 if not private.authorize_schema_analysis(p_id) then return null;end if;
 select c.workspace_id,c.model_change_id into v_owner,v_group from app.entity_schema_analyses a join app.entity_schema_changes c on c.workspace_id=a.workspace_id and c.id=a.change_id where a.id=p_id;
 if v_group is null then return null;end if;
 perform private.lock_data_model_owner(v_owner);
 perform 1 from app.data_model_changes g where g.workspace_id=v_owner and g.id=v_group for update;
 return v_group;
end $function$;

CREATE OR REPLACE FUNCTION private.complete_entity_schema_analysis_batch(p_id uuid, p_fence bigint, p_results jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_a app.entity_schema_analyses%rowtype; v_c app.entity_schema_changes%rowtype; v_owner uuid; v_type_id uuid; v_result jsonb; v_n integer; v_bad integer; v_stale boolean;
begin
 if not private.authorize_schema_analysis(p_id) then return false;end if;
 select x.workspace_id,x.type_id into v_owner,v_type_id from app.entity_schema_analyses x where x.id=p_id;
 if v_owner is null then return false; end if;
 perform 1 from app.entity_types t where t.workspace_id=v_owner and t.id=v_type_id for update;
 if not found then return false; end if;
 select * into v_a from app.entity_schema_analyses x where x.id=p_id for update;
 if not found then return false; end if;
 if v_a.status<>'running' or v_a.fence<>p_fence or v_a.lease_until<=now() then return false; end if;
 select * into v_c from app.entity_schema_changes x where x.workspace_id=v_owner and x.id=v_a.change_id for update;
 if v_c.version<>v_a.change_version or v_c.fingerprint<>v_a.fingerprint or v_c.analysis_id<>v_a.id then return false; end if;
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>50 then raise exception 'invalid analysis batch'; end if;
 for v_result in select value from jsonb_array_elements(p_results) loop
  if jsonb_typeof(v_result->'errors')<>'array' or jsonb_typeof(v_result->'after') not in ('object','null') or octet_length(v_result::text)>262144 then raise exception 'invalid analysis result'; end if;
  update private.entity_schema_analysis_rows set processed=true,errors=v_result->'errors',after=v_result->'after',after_bytes=(v_result->>'after_bytes')::integer,changed=(v_result->>'changed')::boolean,removed=(v_result->>'removed')::integer,replacements=(v_result->>'replacements')::integer where workspace_id=v_owner and analysis_id=p_id and entity_id=v_result->>'entity_id' and not processed;
  if not found then raise exception 'unexpected analysis row'; end if;
 end loop;
 select count(*) filter(where processed), count(*) filter(where processed and jsonb_array_length(errors)>0) into v_n,v_bad from private.entity_schema_analysis_rows where workspace_id=v_owner and analysis_id=p_id;
 if (select coalesce(sum(octet_length(properties::text)+coalesce(octet_length(recovery_properties::text),0)+octet_length(coalesce(after,'null'::jsonb)::text)+octet_length(errors::text)),0) from private.entity_schema_analysis_rows where analysis_id=p_id)>8388608 then
  update app.entity_schema_analyses set status='failed',processed=v_n,failed=v_bad,lease_until=null,retryable=false,failure_reason='analysis_result_limit' where id=p_id;
  update app.entity_schema_changes set status='draft',updated_at=now() where id=v_c.id;return true;
 end if;
 if v_n=v_a.total then
  select t.schema_version<>v_c.source_schema_version or t.schema_write_locked or app.entity_schema_membership(v_owner,v_type_id)<>v_a.membership into v_stale from app.entity_types t where t.workspace_id=v_owner and t.id=v_type_id;
  update app.entity_schema_analyses set status='succeeded',processed=v_n,failed=v_bad,changed=(select count(*) from private.entity_schema_analysis_rows where analysis_id=p_id and processed and changed),unchanged=(select count(*) from private.entity_schema_analysis_rows where analysis_id=p_id and processed and not changed),removed=(select coalesce(sum(removed),0) from private.entity_schema_analysis_rows where analysis_id=p_id and processed),replacements=(select coalesce(sum(replacements),0) from private.entity_schema_analysis_rows where analysis_id=p_id and processed),lease_until=null where id=p_id;
  update app.entity_schema_changes set status=case when v_stale then 'stale' else 'ready' end,updated_at=now() where id=v_c.id;
 else
  update app.entity_schema_analyses set status='queued',processed=v_n,failed=v_bad,changed=(select count(*) from private.entity_schema_analysis_rows where analysis_id=p_id and processed and changed),unchanged=(select count(*) from private.entity_schema_analysis_rows where analysis_id=p_id and processed and not changed),removed=(select coalesce(sum(removed),0) from private.entity_schema_analysis_rows where analysis_id=p_id and processed),replacements=(select coalesce(sum(replacements),0) from private.entity_schema_analysis_rows where analysis_id=p_id and processed),lease_until=null where id=p_id;
 end if;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION private.fail_entity_schema_analysis(p_id uuid, p_fence bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare owner uuid; type_id uuid; a app.entity_schema_analyses%rowtype;
begin
 if not private.authorize_schema_analysis(p_id) then return false;end if;
 select x.workspace_id,x.type_id into owner,type_id from app.entity_schema_analyses x where x.id=p_id;
 if owner is null then return false; end if;
 perform 1 from app.entity_types t where t.workspace_id=owner and t.id=type_id for update;
 select * into a from app.entity_schema_analyses x where x.id=p_id for update;
 if a.status<>'running' or a.fence<>p_fence or a.lease_until<=now() then return false; end if;
 update app.entity_schema_analyses set status='failed',failure_reason='analysis_worker_failed',retryable=true,lease_until=null where id=p_id;
 update app.entity_schema_changes set status='draft',updated_at=now() where id=a.change_id and analysis_id=p_id;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION app.claim_entity_schema_analysis()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_a app.entity_schema_analyses%rowtype; v_c app.entity_schema_changes%rowtype; v_candidate uuid; v_owner uuid; v_type_id uuid; v_batch jsonb; v_group uuid;
begin
 select x.id,x.workspace_id,x.type_id into v_candidate,v_owner,v_type_id from app.entity_schema_analyses x
 where private.schema_analysis_current(x.id) and (x.status='queued' or (x.status='running' and x.lease_until<now())) and exists(select 1 from app.entity_schema_changes c where c.workspace_id=x.workspace_id and c.id=x.change_id and (c.model_change_id is null or exists(select 1 from app.data_model_changes g where g.workspace_id=c.workspace_id and g.id=c.model_change_id and g.status='analyzing'))) order by x.created_at limit 1;
 if v_candidate is null then return null; end if;
 if not private.authorize_schema_analysis(v_candidate) then return null;end if;
 v_group:=private.lock_data_model_analysis(v_candidate);
 perform 1 from app.entity_types t where t.workspace_id=v_owner and t.id=v_type_id for update;
 if not found then return null; end if;
 select * into v_a from app.entity_schema_analyses x where x.workspace_id=v_owner and x.id=v_candidate for update;
 if not found then return null; end if;
 if not(v_a.status='queued' or (v_a.status='running' and v_a.lease_until<now())) then return null; end if;
 select * into v_c from app.entity_schema_changes x where x.workspace_id=v_owner and x.id=v_a.change_id;
 if v_c.recovery_expires_at<=now() then update app.entity_schema_analyses set status='failed',failure_reason='analysis_source_expired',fence=fence+1,lease_until=null where workspace_id=v_owner and id=v_a.id; if v_group is not null then perform private.refresh_workspace_model_analysis(v_owner,v_group);end if; return null; end if;
 if v_c.version<>v_a.change_version or v_c.fingerprint<>v_a.fingerprint or v_c.analysis_id<>v_a.id or v_c.status<>'analyzing' then
 update app.entity_schema_analyses set status='failed',fence=fence+1,lease_until=null where workspace_id=v_owner and id=v_a.id; if v_group is not null then perform private.refresh_workspace_model_analysis(v_owner,v_group);end if; return null; end if;
 update app.entity_schema_analyses set status='running',fence=fence+1,lease_until=now()+interval '90 seconds' where workspace_id=v_owner and id=v_a.id returning * into v_a;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'properties',r.properties,'recovery_properties',r.recovery_properties) order by r.entity_id),'[]') into v_batch
 from (select * from (select x.*,sum(octet_length(x.properties::text)+coalesce(octet_length(x.recovery_properties::text),0)+octet_length(x.entity_id)+256) over(order by x.entity_id) as bytes,row_number() over(order by x.entity_id) as ordinal from private.entity_schema_analysis_rows x where x.workspace_id=v_owner and x.analysis_id=v_a.id and not x.processed) bounded where bytes<=524288 and ordinal<=50) r;
 return jsonb_build_object('id',v_a.id,'workspace_id',v_a.workspace_id,'initiated_by',v_a.initiated_by,'workspace_generation',v_a.workspace_generation,'fence',v_a.fence,'target',v_c.target,'recovery_keys',v_c.recovery_keys,'migration',v_c.migration,'rows',v_batch);
end $function$;

CREATE OR REPLACE FUNCTION private.refresh_workspace_model_analysis(p_workspace uuid,p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid:=p_workspace;v_group app.data_model_changes%rowtype;v_status text;v_pending boolean;v_failed boolean;
begin
 perform private.lock_data_model_owner(v_owner);
 select * into v_group from app.data_model_changes g where g.workspace_id=v_owner and g.id=p_id for update;
 if not found or v_group.status not in ('analyzing','needs_conversion','ready') then return;end if;
 select coalesce(bool_or(a.status in ('queued','running')),false),coalesce(bool_or(a.status='failed' or a.failed>0 or d.status='stale'),false) into v_pending,v_failed
 from app.data_model_children c join app.entity_schema_analyses a on a.workspace_id=c.workspace_id and a.id=c.analysis_id join app.entity_schema_changes d on d.workspace_id=c.workspace_id and d.id=c.change_id where c.workspace_id=v_owner and c.model_id=p_id;
 v_status:=case when v_pending then 'analyzing' when v_failed then 'needs_conversion' else 'ready' end;
 update app.data_model_changes g set status=v_status,version=g.version+case when g.status<>v_status then 1 else 0 end,
 plan=jsonb_set(g.plan,'{review,can_apply}',to_jsonb(v_status='ready')),updated_at=now() where g.workspace_id=v_owner and g.id=p_id;
end $function$;

create or replace function app.refresh_data_model_analysis(p_id uuid) returns void
 language plpgsql security definer set search_path='' as $$
declare w uuid:=app.current_workspace_id();g app.data_model_changes%rowtype;k uuid;
begin
 perform app.lock_workspace_account();perform app.lock_workspace(w,false);
 select * into g from app.data_model_changes where workspace_id=w and id=p_id;
 if not found then return;end if;
 if not private.workspace_allows(auth.uid(),w,'settings','*','write') or g.workspace_generation is distinct from app.workspace_generation() then
  raise exception 'workspace_denied' using errcode='42501';
 end if;
 for k in select value::uuid from jsonb_array_elements_text(coalesce(g.plan->'protected_kind_ids','[]')) loop
  if not private.workspace_allows(auth.uid(),w,'entity_type',k::text,'write') then raise exception 'workspace_denied' using errcode='42501';end if;
 end loop;
 perform private.refresh_workspace_model_analysis(w,p_id);
end $$;
CREATE OR REPLACE FUNCTION app.complete_entity_schema_analysis_batch(p_id uuid, p_fence bigint, p_results jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_group uuid;v_result boolean;v_workspace uuid;
begin
 if not private.authorize_schema_analysis(p_id) then return false;end if;
 select workspace_id into v_workspace from app.entity_schema_analyses where id=p_id;
 v_group:=private.lock_data_model_analysis(p_id);
 v_result:=private.complete_entity_schema_analysis_batch(p_id,p_fence,p_results);
 if v_group is not null and v_result then perform private.refresh_workspace_model_analysis(v_workspace,v_group);end if;
 return v_result;
end $function$;

CREATE OR REPLACE FUNCTION app.fail_entity_schema_analysis(p_id uuid, p_fence bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_group uuid;v_result boolean;v_workspace uuid;
begin
 if not private.authorize_schema_analysis(p_id) then return false;end if;
 select workspace_id into v_workspace from app.entity_schema_analyses where id=p_id;
 v_group:=private.lock_data_model_analysis(p_id);
 v_result:=private.fail_entity_schema_analysis(p_id,p_fence);
 if v_group is not null and v_result then perform private.refresh_workspace_model_analysis(v_workspace,v_group);end if;
 return v_result;
end $function$;

revoke all on function private.refresh_workspace_model_analysis(uuid,uuid) from public,anon,authenticated,app_user,app_server,app_worker;
-- New workspace rows can never become legacy Auth-owned rows, even for privileged writers.
alter table app.entity_schema_changes add check(workspace_id is null or owner_id is null);
alter table app.entity_schema_analyses add check(workspace_id is null or owner_id is null);
alter table app.entity_schema_migrations add check(workspace_id is null or owner_id is null);
alter table private.entity_schema_analysis_rows add check(workspace_id is null or owner_id is null);
alter table private.entity_schema_migration_rows add check(workspace_id is null or owner_id is null);
alter table app.data_model_children add check(workspace_id is null or owner_id is null);
