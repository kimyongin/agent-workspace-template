-- worker는 원본 DML·사용자 역할 전환 없이 아래 제한된 작업만 실행한다.
create extension if not exists vector with schema extensions;
create role app_worker login noinherit nosuperuser nobypassrls;
grant usage on schema app,extensions to app_worker;
alter table app.search_index_state add column embedding extensions.vector(1024);

create function app.claim_search_index(p_limit integer,p_owner uuid default null,p_kind text default null,p_id uuid default null)
returns table(msg_id bigint,read_ct integer)
language plpgsql security definer set search_path='' as $$
begin
  if p_limit not between 1 and 5 or (p_kind is not null and p_kind not in ('task','record','principle')) then
    raise exception '잘못된 worker 범위' using errcode='22023';
  end if;
  return query select m.msg_id,m.read_ct from pgmq.read('search_index',90,p_limit,
    jsonb_strip_nulls(jsonb_build_object('owner_id',p_owner,'kind',p_kind,'id',p_id))) m;
end $$;

-- 큐 자체에서 소유자·ID·해시를 읽는다. 원본 → 상태 순서로 잠그고 현재 입력만 반환한다.
-- 구 서버가 등록한 pipeline 없는 메시지도 실제 현재 원본과 일치할 때만 인계한다.
create function app.prepare_search_index(p_message bigint,p_pipeline text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j jsonb; o uuid; k text; i uuid; h text; t text; s text; r app.search_index_state;
begin
  select message into j from pgmq.q_search_index where msg_id=p_message;
  if not found then return null; end if;
  begin
    o:=(j->>'owner_id')::uuid; i:=(j->>'id')::uuid; k:=j->>'kind'; h:=j->>'input_hash';
  exception when invalid_text_representation then
    perform pgmq.archive('search_index',p_message); return null;
  end;
  if o is null or i is null or k is null or k not in ('task','record','principle')
    or h is null or h !~ '^[0-9a-f]{64}$' or p_pipeline is null or char_length(p_pipeline) not between 1 and 120
    or (j ? 'pipeline' and j->>'pipeline' is distinct from p_pipeline) then
    perform pgmq.archive('search_index',p_message); return null;
  end if;
  if k='task' then select title,summary into t,s from app.tasks where owner_id=o and id=i for update;
  elsif k='record' then select title,summary into t,s from app.records where owner_id=o and id=i for update;
  else select title,summary into t,s from app.principles where owner_id=o and id=i for update; end if;
  if not found or h is distinct from encode(extensions.digest(t||E'\n'||coalesce(s,''),'sha256'),'hex') then
    perform pgmq.delete('search_index',p_message); return null;
  end if;
  select * into r from app.search_index_state where owner_id=o and kind=k and id=i for update;
  if found and (r.input_hash is distinct from h or r.pipeline is distinct from p_pipeline
    or r.state<>'pending' or r.message_id is distinct from p_message) then
    perform pgmq.delete('search_index',p_message); return null;
  end if;
  -- 원본 삭제가 대기 중인 prepare와 경쟁해도 잠금 아래에서만 상태를 만든다.
  insert into app.search_index_state(owner_id,kind,id,input_hash,pipeline,message_id)
    values(o,k,i,h,p_pipeline,p_message) on conflict(owner_id,kind,id) do nothing;
  return jsonb_build_object('owner_id',o,'kind',k,'id',i,'input_hash',h,'title',t,'summary',s);
end $$;

-- 외부 호출 뒤 같은 현재성 검사를 다시 수행한다. 파생 저장과 큐 완료는 한 트랜잭션이다.
create function app.finish_search_index(p_message bigint,p_pipeline text,p_state text,p_reason text,
  p_vector extensions.vector default null,p_delay integer default 0)
returns boolean language plpgsql security definer set search_path='' as $$
declare source jsonb;
begin
  if p_state is null or p_state not in ('indexed','excluded','failed','retry')
    or (p_state='indexed' and (p_vector is null or extensions.vector_dims(p_vector)<>1024
      or extensions.vector_norm(p_vector)=0))
    or (p_state<>'indexed' and (p_reason is null or p_reason not in
      ('invalid_input','input_limit','configuration','retry_exhausted','transient','invalid_response')))
    or p_delay not between 0 and 3600 then
    raise exception '잘못된 색인 결과' using errcode='22023';
  end if;
  source:=app.prepare_search_index(p_message,p_pipeline);
  if source is null then return false; end if;
  if p_state='retry' then
    perform pgmq.set_vt('search_index',p_message,p_delay); return true;
  end if;
  update app.search_index_state set state=p_state,reason=p_reason,embedding=case when p_state='indexed' then p_vector end,
    message_id=null,updated_at=now()
    where owner_id=(source->>'owner_id')::uuid and kind=source->>'kind' and id=(source->>'id')::uuid;
  if p_state='indexed' then perform pgmq.delete('search_index',p_message);
  else perform pgmq.archive('search_index',p_message); end if;
  return true;
end $$;
revoke all on function app.claim_search_index(integer,uuid,text,uuid) from public,anon,authenticated;
revoke all on function app.prepare_search_index(bigint,text) from public,anon,authenticated;
revoke all on function app.finish_search_index(bigint,text,text,text,extensions.vector,integer) from public,anon,authenticated;
grant execute on function app.claim_search_index(integer,uuid,text,uuid) to app_worker;
grant execute on function app.prepare_search_index(bigint,text) to app_worker;
grant execute on function app.finish_search_index(bigint,text,text,text,extensions.vector,integer) to app_worker;
