-- Preserve existing IDs and references; allocate all new application IDs centrally.
alter table app.records drop constraint records_task_id_owner_id_fkey;
alter table app.tasks drop constraint tasks_result_record_id_owner_id_fkey;
alter table app.record_tags drop constraint record_tags_tag_id_owner_id_fkey;
alter table app.task_tags drop constraint task_tags_task_id_owner_id_fkey;
alter table app.task_tags drop constraint task_tags_tag_id_owner_id_fkey;
alter table app.record_tags drop constraint record_tags_record_id_owner_id_fkey;
alter table app.entity_tags drop constraint entity_tags_tag_id_owner_id_fkey;
alter table app.search_chunks drop constraint search_chunks_record_id_owner_id_fkey;
alter table app.entity_tags drop constraint entity_tags_owner_id_entity_id_fkey;
drop function app.enqueue_search_index(text,uuid,text,text);
drop function app.claim_search_index(integer,uuid,text,uuid);
alter table app.entity_tags alter column tag_id drop default;
alter table app.entity_tags alter column tag_id type text using tag_id::text;
alter table app.principles alter column id drop default;
alter table app.principles alter column id type text using id::text;
alter table app.record_tags alter column record_id drop default;
alter table app.record_tags alter column record_id type text using record_id::text;
alter table app.record_tags alter column tag_id drop default;
alter table app.record_tags alter column tag_id type text using tag_id::text;
alter table app.records alter column id drop default;
alter table app.records alter column id type text using id::text;
alter table app.records alter column task_id drop default;
alter table app.records alter column task_id type text using task_id::text;
alter table app.search_chunks alter column record_id drop default;
alter table app.search_chunks alter column record_id type text using record_id::text;
alter table app.search_index_state alter column id drop default;
alter table app.search_index_state alter column id type text using id::text;
alter table app.tags alter column id drop default;
alter table app.tags alter column id type text using id::text;
alter table app.task_tags alter column task_id drop default;
alter table app.task_tags alter column task_id type text using task_id::text;
alter table app.task_tags alter column tag_id drop default;
alter table app.task_tags alter column tag_id type text using tag_id::text;
alter table app.tasks alter column id drop default;
alter table app.tasks alter column id type text using id::text;
alter table app.tasks alter column result_record_id drop default;
alter table app.tasks alter column result_record_id type text using result_record_id::text;
alter table app.records add constraint records_task_id_owner_id_fkey FOREIGN KEY (task_id, owner_id) REFERENCES app.tasks(id, owner_id) ON DELETE SET NULL (task_id);
alter table app.tasks add constraint tasks_result_record_id_owner_id_fkey FOREIGN KEY (result_record_id, owner_id) REFERENCES app.records(id, owner_id) ON DELETE SET NULL (result_record_id);
alter table app.record_tags add constraint record_tags_tag_id_owner_id_fkey FOREIGN KEY (tag_id, owner_id) REFERENCES app.tags(id, owner_id) ON DELETE CASCADE;
alter table app.task_tags add constraint task_tags_task_id_owner_id_fkey FOREIGN KEY (task_id, owner_id) REFERENCES app.tasks(id, owner_id) ON DELETE CASCADE;
alter table app.task_tags add constraint task_tags_tag_id_owner_id_fkey FOREIGN KEY (tag_id, owner_id) REFERENCES app.tags(id, owner_id) ON DELETE CASCADE;
alter table app.record_tags add constraint record_tags_record_id_owner_id_fkey FOREIGN KEY (record_id, owner_id) REFERENCES app.records(id, owner_id) ON DELETE CASCADE;
alter table app.entity_tags add constraint entity_tags_tag_id_owner_id_fkey FOREIGN KEY (tag_id, owner_id) REFERENCES app.tags(id, owner_id) ON DELETE CASCADE;
alter table app.search_chunks add constraint search_chunks_record_id_owner_id_fkey FOREIGN KEY (record_id, owner_id) REFERENCES app.records(id, owner_id) ON DELETE CASCADE;
alter table app.entity_tags add constraint entity_tags_owner_id_entity_id_fkey FOREIGN KEY (owner_id, entity_id) REFERENCES app.entities(owner_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

create table private.data_id_reservations(id text primary key, allocated_at timestamptz not null default now());
revoke all on private.data_id_reservations from public,anon,authenticated,app_user,app_server,app_worker;
create function app.data_id_candidate() returns text language plpgsql set search_path='' as $$
declare suffix text:=''; alphabet constant text:='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; random_bytes bytea; b integer; n integer;
begin
  while length(suffix)<8 loop
    random_bytes:=extensions.gen_random_bytes(16);
    for n in 0..15 loop
      b:=get_byte(random_bytes,n);
      if b<252 then suffix:=suffix||substr(alphabet,(b%36)+1,1); end if;
      exit when length(suffix)=8;
    end loop;
  end loop;
  return to_char(clock_timestamp() at time zone 'Asia/Seoul','YYYYMMDD')||'-'||suffix;
end $$;
revoke all on function app.data_id_candidate() from public,anon,authenticated,app_user,app_server,app_worker;
create function app.issue_data_id() returns text language plpgsql security definer set search_path='' as $$
declare candidate text; attempt integer;
begin
  for attempt in 1..64 loop
    candidate:=app.data_id_candidate();
    insert into private.data_id_reservations(id) values(candidate) on conflict do nothing;
    if found then return candidate; end if;
  end loop;
  raise exception 'ID allocation retry limit reached' using errcode='54000';
end $$;
revoke all on function app.issue_data_id() from public,anon,authenticated;
grant execute on function app.issue_data_id() to app_user,app_server,app_worker;
alter table app.tags alter column id set default app.issue_data_id();
alter table app.tasks alter column id set default app.issue_data_id();
alter table app.records alter column id set default app.issue_data_id();
alter table app.principles alter column id set default app.issue_data_id();
CREATE OR REPLACE FUNCTION app.enqueue_search_index(p_kind text, p_id text, p_hash text, p_pipeline text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid; v_hash text; v_prior app.search_index_state; v_message bigint;
begin
  if p_kind is distinct from 'record' then raise exception '기록만 색인할 수 있습니다' using errcode='22023'; end if;
  select owner_id,encode(extensions.digest(body,'sha256'),'hex') into v_owner,v_hash
    from app.records where id=p_id and owner_id=auth.uid() for update;
  if v_owner is null then raise exception '원본이 없거나 접근할 수 없습니다' using errcode='23503'; end if;
  if v_hash is distinct from p_hash or p_pipeline is null or char_length(p_pipeline) not between 1 and 120 then
    raise exception '현재 검색 입력과 다릅니다' using errcode='22023';
  end if;
  select * into v_prior from app.search_index_state where owner_id=v_owner and kind='record' and id=p_id for update;
  if found and v_prior.input_hash=p_hash and v_prior.pipeline=p_pipeline and (
    v_prior.state='excluded' or (v_prior.state='indexed' and exists(select 1 from app.search_chunks
      where owner_id=v_owner and record_id=p_id and generation=v_prior.generation)) or
    (v_prior.state='pending' and exists(select 1 from pgmq.q_search_index where msg_id=v_prior.message_id))) then return; end if;
  delete from pgmq.q_search_index where message->>'owner_id'=v_owner::text
    and message->>'kind'='record' and message->>'id'=p_id::text;
  delete from app.search_chunks where owner_id=v_owner and record_id=p_id;
  select pgmq.send('search_index',jsonb_build_object('owner_id',v_owner,'kind','record','id',p_id,
    'input_hash',p_hash,'pipeline',p_pipeline)) into v_message;
  insert into app.search_index_state(owner_id,kind,id,input_hash,pipeline,message_id)
    values(v_owner,'record',p_id,p_hash,p_pipeline,v_message)
    on conflict(owner_id,kind,id) do update set input_hash=excluded.input_hash,pipeline=excluded.pipeline,
      state='pending',reason=null,message_id=excluded.message_id,generation=null,updated_at=now();
end $function$
;
CREATE OR REPLACE FUNCTION app.claim_search_index(p_limit integer, p_owner uuid DEFAULT NULL::uuid, p_kind text DEFAULT NULL::text, p_id text DEFAULT NULL::text)
 RETURNS TABLE(msg_id bigint, read_ct integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_limit not between 1 and 5 or (p_kind is not null and p_kind not in ('task','record','principle')) then
    raise exception '잘못된 worker 범위' using errcode='22023';
  end if;
  -- Scopes for current tasks/principles are a valid empty request, never jobs.
  if p_kind is not null and p_kind<>'record' then return; end if;
  return query select m.msg_id,m.read_ct from pgmq.read('search_index',90,p_limit,
    jsonb_strip_nulls(jsonb_build_object('owner_id',p_owner,'kind','record','id',p_id))) m;
end $function$
;
CREATE OR REPLACE FUNCTION app.prepare_search_index(p_message bigint, p_pipeline text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j jsonb; o uuid; i text; h text; b text; r app.search_index_state;
begin
  select message into j from pgmq.q_search_index where msg_id=p_message;
  if not found then return null; end if;
  begin
    o:=(j->>'owner_id')::uuid; i:=(j->>'id')::text; h:=j->>'input_hash';
  exception when invalid_text_representation then
    perform pgmq.archive('search_index',p_message); return null;
  end;
  if o is null or i is null or j->>'kind' is distinct from 'record' or h is null or h !~ '^[0-9a-f]{64}$'
    or p_pipeline is null or char_length(p_pipeline) not between 1 and 120 or j->>'pipeline' is distinct from p_pipeline then
    perform pgmq.archive('search_index',p_message); return null;
  end if;
  select body into b from app.records where owner_id=o and id=i for update;
  if not found or h is distinct from encode(extensions.digest(b,'sha256'),'hex') then
    perform pgmq.delete('search_index',p_message); return null;
  end if;
  select * into r from app.search_index_state where owner_id=o and kind='record' and id=i for update;
  if not found or r.input_hash is distinct from h or r.pipeline is distinct from p_pipeline
    or r.state<>'pending' or r.message_id is distinct from p_message then
    perform pgmq.delete('search_index',p_message); return null;
  end if;
  return jsonb_build_object('owner_id',o,'kind','record','id',i,'input_hash',h,'body',b);
end $function$
;
CREATE OR REPLACE FUNCTION app.finish_search_index(p_message bigint, p_pipeline text, p_state text, p_reason text, p_chunks jsonb DEFAULT NULL::jsonb, p_delay integer DEFAULT 0)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare source jsonb; c jsonb; v extensions.vector; s integer; e integer; covered integer:=0;
  n integer:=0; o uuid; i text; body_length integer;
begin
  if p_state is null or p_state not in ('indexed','excluded','failed','retry')
    or (p_state='indexed' and (p_chunks is null or jsonb_typeof(p_chunks)<>'array' or jsonb_array_length(p_chunks)=0))
    or (p_state<>'indexed' and (p_reason is null or p_reason not in
      ('invalid_input','input_limit','configuration','retry_exhausted','transient','invalid_response')))
    or p_delay not between 0 and 3600 then raise exception '잘못된 색인 결과' using errcode='22023'; end if;
  source:=app.prepare_search_index(p_message,p_pipeline);
  if source is null then return false; end if;
  if p_state='retry' then perform pgmq.set_vt('search_index',p_message,p_delay); return true; end if;
  o:=(source->>'owner_id')::uuid; i:=(source->>'id')::text; body_length:=char_length(source->>'body');
  delete from app.search_chunks where owner_id=o and record_id=i;
  if p_state='indexed' then
    for c in select value from jsonb_array_elements(p_chunks) loop
      s:=(c->>'start')::integer; e:=(c->>'end')::integer; v:=(c->>'vector')::extensions.vector;
      if s is null or e is null or s<0 or s>covered or e<=s or e>body_length
        or v is null or extensions.vector_dims(v)<>1024 or extensions.vector_norm(v)=0 then
        raise exception '잘못된 본문 구간' using errcode='22023';
      end if;
      insert into app.search_chunks(owner_id,record_id,generation,ordinal,start_offset,end_offset,embedding)
        values(o,i,p_message,n,s,e,v);
      covered:=greatest(covered,e); n:=n+1;
    end loop;
    if covered<>body_length then raise exception '누락된 본문 구간' using errcode='22023'; end if;
  end if;
  update app.search_index_state set state=p_state,reason=p_reason,generation=case when p_state='indexed' then p_message end,
    message_id=null,updated_at=now() where owner_id=o and kind='record' and id=i;
  if p_state='indexed' then perform pgmq.delete('search_index',p_message);
  else perform pgmq.archive('search_index',p_message); end if;
  return true;
end $function$
;
revoke all on function app.enqueue_search_index(text,text,text,text) from public,anon,authenticated;
grant execute on function app.enqueue_search_index(text,text,text,text) to app_user;
revoke all on function app.claim_search_index(integer,uuid,text,text) from public,anon,authenticated;
grant execute on function app.claim_search_index(integer,uuid,text,text) to app_worker;
