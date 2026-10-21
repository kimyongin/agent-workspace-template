-- A pure projection: callers retain their existing workspace/row authorization.
create function app.entity_title(p_schema jsonb,p_properties jsonb,p_fallback text)
returns text language plpgsql immutable parallel safe security invoker set search_path='' as $function$
declare
 v_template text:=p_schema->>'x-title-template';v_key text;v_field jsonb;v_raw jsonb;v_choice text;
 v_position integer:=1;v_open integer;v_start integer;v_end integer;v_legacy boolean;
 v_value text;v_result text:='';v_has_content boolean:=false;
 v_whitespace constant text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
 -- Expansion only: retained pre-cutover current documents keep their exact old title.
 if v_template is null then
  select key into v_key from jsonb_each(p_schema->'properties') where value->>'x-representative'='true' limit 1;
  v_template:=case when v_key is null then '' else '$'||v_key||'$' end;
 end if;
 while v_position<=char_length(v_template) loop
  v_open:=strpos(substr(v_template,v_position),'$');
  if v_open=0 then
   v_value:=substr(v_template,v_position);v_position:=char_length(v_template)+1;
  elsif v_open>1 then
   v_value:=substr(v_template,v_position,v_open-1);v_position:=v_position+v_open-1;
  elsif substr(v_template,v_position,2)='$$' then
   v_value:='$';v_position:=v_position+2;
  else
   v_legacy:=substr(v_template,v_position,2)='${';
   v_start:=v_position+case when v_legacy then 2 else 1 end;
   v_end:=strpos(substr(v_template,v_start),case when v_legacy then '$}' else '$' end);
   if v_end=0 then exit;end if;
   v_key:=substr(v_template,v_start,v_end-1);
   v_position:=v_start+v_end-1+case when v_legacy then 2 else 1 end;
   v_field:=p_schema->'properties'->v_key;v_raw:=p_properties->v_key;
   select item->>'title' into v_choice from jsonb_array_elements(
    case when jsonb_typeof(v_field->'oneOf')='array' then v_field->'oneOf' else '[]'::jsonb end
   ) item where item->'const'=v_raw and item ? 'title' limit 1;
   if found then v_value:=v_choice;
   elsif jsonb_typeof(v_raw)='boolean' then v_value:=case when v_raw='true'::jsonb then '예' else '아니오' end;
   elsif jsonb_typeof(v_raw)='number' then
    v_value:=v_raw#>>'{}';
    -- JSONB can retain numeric scale; JavaScript's validated Number projection does not.
    if v_value::numeric=0 then v_value:='0';
    elsif strpos(v_value,'.')>0 then v_value:=rtrim(rtrim(v_value,'0'),'.');end if;
   elsif jsonb_typeof(v_raw)='string' then v_value:=v_raw#>>'{}';
   else v_value:='';end if;
  end if;
  v_has_content:=v_has_content or btrim(v_value,v_whitespace)<>'';
  -- Keep at most one overflow code point while still inspecting later parts for fallback.
  v_result:=left(v_result||v_value,4097);
 end loop;
 if not v_has_content then v_result:=coalesce(p_fallback,'');end if;
 return case when char_length(v_result)>4096 then left(v_result,4095)||'…' else v_result end;
end $function$;
revoke all on function app.entity_title(jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function app.entity_title(jsonb,jsonb,text) to app_user,app_worker;

-- Preserve the current atomic publication, changing only new event title projection.
CREATE OR REPLACE FUNCTION private.commit_entity_schema_migration(p_id uuid, p_fence bigint, p_template_fingerprint text, p_pipeline text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid; v_type_id uuid; v_job app.entity_schema_migrations%rowtype; v_type app.entity_types%rowtype; v_change app.entity_schema_changes%rowtype; v_next_schema integer; v_count integer;
begin
 select x.workspace_id,x.type_id into v_owner,v_type_id from app.entity_schema_migrations x where x.id=p_id;
 if v_owner is null or not private.authorize_schema_job(v_owner,p_id) then return false; end if;
 perform private.lock_data_model_owner(v_owner);
 if not private.schema_job_current(v_owner,p_id) then return false;end if;
 select * into v_type from app.entity_types x where x.workspace_id=v_owner and x.id=v_type_id for update;
 select * into v_job from app.entity_schema_migrations where workspace_id=v_owner and id=p_id for update;
 if v_job.status<>'committing' or v_job.fence is distinct from p_fence or v_job.lease_until is null or v_job.lease_until<=now() then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':record_templates',0));
 select * into v_change from app.entity_schema_changes where workspace_id=v_owner and id=v_job.change_id for update;
 if not v_type.schema_write_locked or v_type.schema_version<>v_job.source_schema_version or v_change.version<>v_job.change_version or v_change.fingerprint<>v_job.fingerprint or v_change.analysis_id<>v_job.analysis_id or v_change.status<>'ready' or app.entity_schema_membership(v_owner,v_type_id)<>v_job.membership or p_template_fingerprint<>v_job.source_template_fingerprint or private.entity_schema_effective_templates(v_owner,v_type_id)<>v_job.source_templates or private.workspace_entity_schema_reference_baseline(v_owner,v_type_id)<>v_job.source_references then
 perform private.fail_entity_schema_migration(p_id,p_fence,'schema_plan_stale',false); return false; end if;
 if p_pipeline is null or char_length(p_pipeline) not between 1 and 120 then raise exception 'invalid pipeline' using errcode='22023'; end if;
 if v_job.processed<>v_job.total or (select count(*) from private.entity_schema_migration_rows where workspace_id=v_owner and job_id=p_id and prepared)<>v_job.total then raise exception 'incomplete migration' using errcode='22023'; end if;
 perform 1 from app.entities e where e.workspace_id=v_owner and e.entity_type_id=v_type_id order by e.id collate "C" for update;
 if not exists(select 1 from private.data_model_commit_context ctx where ctx.workspace_id=v_owner and ctx.model_id=v_job.model_change_id and ctx.pid=pg_backend_pid() and ctx.txid=txid_current()) and not coalesce((v_job.target->'schema'->>'deprecated')::boolean,false)
 and exists(select 1 from app.entity_schema_versions s where s.workspace_id=v_owner and s.type_id=v_type_id and s.schema_version=v_type.schema_version
  and (coalesce((s.schema->>'deprecated')::boolean,false) or s.schema->>'title' is distinct from v_job.target->'schema'->>'title'))
 and exists(select 1 from app.entity_types t join app.entity_schema_versions s on s.workspace_id=t.workspace_id and s.type_id=t.id and s.schema_version=t.schema_version
  where t.workspace_id=v_owner and t.id<>v_type_id and not coalesce((s.schema->>'deprecated')::boolean,false) and s.schema->>'title'=v_job.target->'schema'->>'title') then
  perform private.fail_entity_schema_migration(p_id,p_fence,'schema_plan_stale',false); return false;
 end if;
 insert into private.schema_job_commit_context(workspace_id,job_id,pid,txid) values(v_owner,p_id,pg_backend_pid(),txid_current());
 v_next_schema=v_type.schema_version+1;
 insert into app.entity_schema_versions(workspace_id,schema) values(v_owner,(v_job.target->'schema')||jsonb_build_object('x-type-id',v_type_id,'x-version',v_next_schema));
 update app.entities e set properties=r.after,schema_version=v_next_schema,version=e.version+1,updated_at=now() from private.entity_schema_migration_rows r where r.workspace_id=v_owner and r.job_id=p_id and r.workspace_id=e.workspace_id and r.entity_id=e.id and e.entity_type_id=v_type_id and e.version=r.source_version;
 get diagnostics v_count=row_count;
 if v_count<>v_job.total then
  if exists(select 1 from private.data_model_commit_context ctx where ctx.workspace_id=v_owner and ctx.model_id=v_job.model_change_id and ctx.pid=pg_backend_pid() and ctx.txid=txid_current()) then raise exception 'schema_plan_stale' using errcode='P0001';end if;
  raise exception 'migration source changed' using errcode='40001';
 end if;
 update private.entity_schema_migration_rows set committed_version=source_version+1 where workspace_id=v_owner and job_id=p_id;
 insert into app.records(workspace_id,id,entity_id,created_by,created_by_name,body,record_kind,change_metadata)
 select v_owner,r.record_id,r.entity_id,v_job.initiated_by,v_job.created_by_name,r.record_body,'change',
  jsonb_build_object('event_id',r.record_id,'target_kind','entity','target_id',r.entity_id,
   'target_title',app.entity_title(v_job.target->'schema',r.after,coalesce((select e.external_id from app.entities e where e.workspace_id=r.workspace_id and e.id=r.entity_id),r.entity_id)),
   'action','update','source',v_job.actor_source,'before',null,'after',null,'path',r.record_path,'schema_migration_id',v_job.id,'target_snapshot',r.record_context->0)
 from private.entity_schema_migration_rows r where r.workspace_id=v_owner and r.job_id=p_id and r.changed;
 insert into app.record_tags(workspace_id,record_id,tag_id)
 select v_owner,r.record_id,tag.id from private.entity_schema_migration_rows r
 cross join lateral jsonb_array_elements_text(r.record_tags) ids(id)
 join app.tags tag on tag.workspace_id=r.workspace_id and tag.scope='record' and tag.id=ids.id
 where r.workspace_id=v_owner and r.job_id=p_id and r.changed;
 with queued as (
  insert into pgmq.q_search_index(vt,message)
  select now(),jsonb_build_object('workspace_id',v_owner,'initiated_by',v_job.initiated_by,'workspace_generation',v_job.workspace_generation,
   'source_version',record.version,'kind','record','id',r.record_id,'input_hash',r.record_hash,'pipeline',p_pipeline)
  from private.entity_schema_migration_rows r join app.records record on record.workspace_id=r.workspace_id and record.id=r.record_id
  where r.workspace_id=v_owner and r.job_id=p_id and r.changed returning msg_id,message)
 insert into app.search_index_state(workspace_id,initiated_by,workspace_generation,source_version,kind,id,input_hash,pipeline,message_id)
 select v_owner,v_job.initiated_by,v_job.workspace_generation,(message->>'source_version')::bigint,'record',message->>'id',message->>'input_hash',p_pipeline,msg_id from queued;
 update app.entity_types set schema_version=v_next_schema,schema_write_locked=false,updated_at=now() where workspace_id=v_owner and id=v_type_id;
 update app.entity_schema_changes set status='applied',updated_at=now() where workspace_id=v_owner and id=v_job.change_id;
 update app.entity_schema_migrations set status='succeeded',version=version+1,lease_until=null,retryable=false,failure_reason=null,source_expires_at=coalesce(source_expires_at,now()+interval '30 days'),committed_membership=app.entity_schema_membership(v_owner,v_type_id),committed_references=private.workspace_entity_schema_reference_baseline(v_owner,v_type_id),result=jsonb_build_object('schema_version',v_next_schema,'total',v_job.total,'changed',(select count(*) from private.entity_schema_migration_rows where workspace_id=v_owner and job_id=p_id and changed),'committed_at',now()),updated_at=now() where workspace_id=v_owner and id=p_id;
 delete from private.schema_job_commit_context ctx where ctx.workspace_id=v_owner and ctx.job_id=p_id and ctx.pid=pg_backend_pid() and ctx.txid=txid_current();
 return true;
end $function$;
