-- Business changes enqueue the actual immutable record source in the same
-- transaction. The consumer conversion remains separate; no legacy adoption.
create or replace function app.enqueue_search_index(p_kind text,p_id text,p_hash text,p_pipeline text)
 returns void language plpgsql security definer set search_path='' as $$
declare
 w uuid:=app.current_workspace_id(); executor uuid:=auth.uid(); epoch bigint;
 parent app.records; parent_entity text; parent_task text; required jsonb; actual_hash text; prior app.search_index_state; message_id bigint;
begin
 if p_kind is distinct from 'record' or p_pipeline is null or length(p_pipeline) not between 1 and 120 then
  raise exception 'invalid_search_source' using errcode='22023';
 end if;
 -- The authenticated entry has already taken Auth then workspace. Rechecking
 -- workspace authority here never acquires another account after domain locks.
 perform app.authorize_workspace('[]'::jsonb);
 select r.entity_id,r.task_id into parent_entity,parent_task from app.records r where r.workspace_id=w and r.id=p_id;
 if not found then raise exception 'search_source_missing' using errcode='23503';end if;
 if parent_entity is not null then
  select jsonb_build_array(jsonb_build_object('target_kind','entity_type','target_id',e.entity_type_id::text,'access','write'))
   into required from app.entities e where e.workspace_id=w and e.id=parent_entity;
 else
  required:='[{"target_kind":"tasks","target_id":"*","access":"write"}]'::jsonb;
 end if;
 if required is null then raise exception 'search_source_missing' using errcode='23503';end if;
 perform app.authorize_workspace(required);
 select r.* into parent from app.records r where r.workspace_id=w and r.id=p_id for update;
 actual_hash:=encode(extensions.digest(parent.body,'sha256'),'hex');
 if actual_hash is distinct from p_hash then raise exception 'search_source_changed' using errcode='22023';end if;
 select lifecycle_generation into epoch from app.workspaces where id=w and deleted_at is null;
 if epoch is null or executor is null then raise exception 'workspace_denied' using errcode='42501';end if;
 select * into prior from app.search_index_state where workspace_id=w and kind='record' and id=p_id for update;
 if found and prior.input_hash=p_hash and prior.pipeline=p_pipeline and prior.source_version=parent.version
  and prior.workspace_generation=epoch and prior.initiated_by=executor and (
   prior.state='excluded' or (prior.state='pending' and exists(select 1 from pgmq.q_search_index q where q.msg_id=prior.message_id
    and q.message->>'workspace_id'=w::text and q.message->>'id'=p_id))) then return;end if;
 delete from pgmq.q_search_index where message->>'workspace_id'=w::text and message->>'kind'='record' and message->>'id'=p_id;
 -- Replace state instead of updating a source revision beneath an existing job.
 delete from app.search_index_state where workspace_id=w and kind='record' and id=p_id;
 select pgmq.send('search_index',jsonb_build_object('workspace_id',w,'initiated_by',executor,'workspace_generation',epoch,
  'source_version',parent.version,'kind','record','id',p_id,'input_hash',p_hash,'pipeline',p_pipeline)) into message_id;
 insert into app.search_index_state(workspace_id,initiated_by,workspace_generation,source_version,kind,id,input_hash,pipeline,message_id)
 values(w,executor,epoch,parent.version,'record',p_id,p_hash,p_pipeline,message_id);
end $$;
revoke all on function app.enqueue_search_index(text,text,text,text) from public,anon,authenticated,app_worker;
grant execute on function app.enqueue_search_index(text,text,text,text) to app_user;
