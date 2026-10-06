-- CLI generated, renamed after the already committed 20261006210200 migration.
-- Apply after 20261007000001_minimal_content_model.sql. No source text is copied.
drop trigger tasks_delete_index on app.tasks;
drop trigger principles_delete_index on app.principles;
delete from pgmq.q_search_index;
delete from app.search_index_state;
alter table app.search_index_state drop column embedding;
alter table app.search_index_state drop constraint search_index_state_kind_check;
alter table app.search_index_state add constraint search_index_state_kind_check check(kind='record');
alter table app.search_index_state add column generation bigint;

create table app.search_chunks (
  owner_id uuid not null,
  record_id uuid not null,
  generation bigint not null,
  ordinal integer not null check(ordinal>=0),
  start_offset integer not null check(start_offset>=0),
  end_offset integer not null check(end_offset>start_offset),
  embedding extensions.vector(1024) not null,
  primary key(owner_id,record_id,ordinal),
  foreign key(record_id,owner_id) references app.records(id,owner_id) on delete cascade
);
alter table app.search_chunks enable row level security;
revoke all on app.search_chunks from public,anon,authenticated,app_server,app_worker;
grant select on app.search_chunks to app_user;
create policy search_chunks_owner on app.search_chunks for select to app_user using(owner_id=(select auth.uid()));

-- This function alone allows user code to enqueue its own current record.
create or replace function app.enqueue_search_index(p_kind text,p_id uuid,p_hash text,p_pipeline text)
returns void language plpgsql security definer set search_path='' as $$
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
end $$;
revoke all on function app.enqueue_search_index(text,uuid,text,text) from public,anon,authenticated;
grant execute on function app.enqueue_search_index(text,uuid,text,text) to app_user;

create or replace function app.claim_search_index(p_limit integer,p_owner uuid default null,p_kind text default null,p_id uuid default null)
returns table(msg_id bigint,read_ct integer)
language plpgsql security definer set search_path='' as $$
begin
  if p_limit not between 1 and 5 or (p_kind is not null and p_kind not in ('task','record','principle')) then
    raise exception '잘못된 worker 범위' using errcode='22023';
  end if;
  -- Scopes for current tasks/principles are a valid empty request, never jobs.
  if p_kind is not null and p_kind<>'record' then return; end if;
  return query select m.msg_id,m.read_ct from pgmq.read('search_index',90,p_limit,
    jsonb_strip_nulls(jsonb_build_object('owner_id',p_owner,'kind','record','id',p_id))) m;
end $$;

create or replace function app.prepare_search_index(p_message bigint,p_pipeline text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j jsonb; o uuid; i uuid; h text; b text; r app.search_index_state;
begin
  select message into j from pgmq.q_search_index where msg_id=p_message;
  if not found then return null; end if;
  begin
    o:=(j->>'owner_id')::uuid; i:=(j->>'id')::uuid; h:=j->>'input_hash';
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
end $$;

drop function app.finish_search_index(bigint,text,text,text,extensions.vector,integer);
-- Check current source again and replace all chunks in the same transaction as
-- the record state and queue completion. A failed partial run saves no chunks.
create function app.finish_search_index(p_message bigint,p_pipeline text,p_state text,p_reason text,
  p_chunks jsonb default null,p_delay integer default 0)
returns boolean language plpgsql security definer set search_path='' as $$
declare source jsonb; c jsonb; v extensions.vector; s integer; e integer; covered integer:=0;
  n integer:=0; o uuid; i uuid; body_length integer;
begin
  if p_state is null or p_state not in ('indexed','excluded','failed','retry')
    or (p_state='indexed' and (p_chunks is null or jsonb_typeof(p_chunks)<>'array' or jsonb_array_length(p_chunks)=0))
    or (p_state<>'indexed' and (p_reason is null or p_reason not in
      ('invalid_input','input_limit','configuration','retry_exhausted','transient','invalid_response')))
    or p_delay not between 0 and 3600 then raise exception '잘못된 색인 결과' using errcode='22023'; end if;
  source:=app.prepare_search_index(p_message,p_pipeline);
  if source is null then return false; end if;
  if p_state='retry' then perform pgmq.set_vt('search_index',p_message,p_delay); return true; end if;
  o:=(source->>'owner_id')::uuid; i:=(source->>'id')::uuid; body_length:=char_length(source->>'body');
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
end $$;
revoke all on function app.claim_search_index(integer,uuid,text,uuid) from public,anon,authenticated;
revoke all on function app.prepare_search_index(bigint,text) from public,anon,authenticated;
revoke all on function app.finish_search_index(bigint,text,text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function app.claim_search_index(integer,uuid,text,uuid) to app_worker;
grant execute on function app.prepare_search_index(bigint,text) to app_worker;
grant execute on function app.finish_search_index(bigint,text,text,text,jsonb,integer) to app_worker;

-- Reindex every preserved body once; no current task/principle vectors remain.
do $$
declare r record; m bigint; h text; p text:='llama-v2-1024-record-body-utf8-1800-overlap180-v1';
begin
  for r in select owner_id,id,body from app.records loop
    h:=encode(extensions.digest(r.body,'sha256'),'hex');
    select pgmq.send('search_index',jsonb_build_object('owner_id',r.owner_id,'kind','record','id',r.id,
      'input_hash',h,'pipeline',p)) into m;
    insert into app.search_index_state(owner_id,kind,id,input_hash,pipeline,message_id) values(r.owner_id,'record',r.id,h,p,m);
  end loop;
end $$;
