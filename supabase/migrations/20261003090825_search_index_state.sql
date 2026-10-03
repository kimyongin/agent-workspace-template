-- 검색의 현재 파생 상태와 최신 논리 작업. 원문이나 작업 이력을 복제하지 않는다.
create table app.search_index_state (
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in ('task','record','principle')),
  id uuid not null,
  input_hash text not null check(input_hash ~ '^[0-9a-f]{64}$'),
  pipeline text not null check(char_length(pipeline) between 1 and 120),
  state text not null default 'pending' check(state in ('pending','indexed','excluded','failed')),
  reason text,
  message_id bigint,
  updated_at timestamptz(3) not null default now(),
  primary key(owner_id,kind,id)
);
alter table app.search_index_state enable row level security;
revoke all on app.search_index_state from public,anon,authenticated;
grant select on app.search_index_state to app_user;
create policy search_index_owner on app.search_index_state for select to app_user
  using(owner_id=(select auth.uid()));
create index search_queue_item on pgmq.q_search_index
  ((message->>'owner_id'),(message->>'kind'),(message->>'id'));

-- SECURITY DEFINER를 쓸 이유: 사용자/접속 역할에 큐 조회·삭제 권한을 주지 않고
-- 현재 소유자의 실제 원본 하나에 한해서 기존 메시지를 교체한다. PUBLIC 실행은 금지한다.
create function app.enqueue_search_index(p_kind text,p_id uuid,p_hash text,p_pipeline text)
returns void language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_hash text; v_prior app.search_index_state; v_message bigint;
begin
  if p_kind='task' then
    select owner_id,encode(extensions.digest(title||E'\n'||summary,'sha256'),'hex')
      into v_owner,v_hash from app.tasks where id=p_id and owner_id=auth.uid() for update;
  elsif p_kind='record' then
    select owner_id,encode(extensions.digest(title||E'\n'||summary,'sha256'),'hex')
      into v_owner,v_hash from app.records where id=p_id and owner_id=auth.uid() for update;
  elsif p_kind='principle' then
    select owner_id,encode(extensions.digest(title||E'\n'||summary,'sha256'),'hex')
      into v_owner,v_hash from app.principles where id=p_id and owner_id=auth.uid() for update;
  end if;
  if v_owner is null then raise exception '원본이 없거나 접근할 수 없습니다' using errcode='23503'; end if;
  if v_hash is distinct from p_hash or p_pipeline is null or char_length(p_pipeline) not between 1 and 120 then
    raise exception '현재 검색 입력과 다릅니다' using errcode='22023';
  end if;
  select * into v_prior from app.search_index_state where owner_id=v_owner and kind=p_kind and id=p_id for update;
  if found and v_prior.input_hash=p_hash and v_prior.pipeline=p_pipeline and (
    v_prior.state in ('indexed','excluded') or (v_prior.state='pending' and exists(
      select 1 from pgmq.q_search_index where msg_id=v_prior.message_id))) then return; end if;
  delete from pgmq.q_search_index where message->>'owner_id'=v_owner::text
    and message->>'kind'=p_kind and message->>'id'=p_id::text;
  select pgmq.send('search_index',jsonb_build_object('owner_id',v_owner,'kind',p_kind,'id',p_id,
    'input_hash',p_hash,'pipeline',p_pipeline)) into v_message;
  insert into app.search_index_state(owner_id,kind,id,input_hash,pipeline,message_id)
    values(v_owner,p_kind,p_id,p_hash,p_pipeline,v_message)
    on conflict(owner_id,kind,id) do update set input_hash=excluded.input_hash,pipeline=excluded.pipeline,
      state='pending',reason=null,message_id=excluded.message_id,updated_at=now();
end $$;
revoke all on function app.enqueue_search_index(text,uuid,text,text) from public,anon,authenticated;
grant execute on function app.enqueue_search_index(text,uuid,text,text) to app_user;

-- 원본 삭제와 같은 트랜잭션에서 파생 상태와 대기 메시지를 정리한다.
create function app.delete_search_index() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_kind text:=left(tg_table_name,length(tg_table_name)-1);
begin
  delete from app.search_index_state where owner_id=old.owner_id and kind=v_kind and id=old.id;
  delete from pgmq.q_search_index where message->>'owner_id'=old.owner_id::text
    and message->>'kind'=v_kind and message->>'id'=old.id::text;
  return old;
end $$;
revoke all on function app.delete_search_index() from public,anon,authenticated;
create trigger tasks_delete_index before delete on app.tasks for each row execute function app.delete_search_index();
create trigger records_delete_index before delete on app.records for each row execute function app.delete_search_index();
create trigger principles_delete_index before delete on app.principles for each row execute function app.delete_search_index();

-- 기존 원문은 바꾸지 않고 현재 입력만 등록한다. 이전 중복 메시지는 해당 원본의 새 메시지로 교체한다.
insert into app.search_index_state(owner_id,kind,id,input_hash,pipeline)
select owner_id,kind,id,encode(extensions.digest(title||E'\n'||summary,'sha256'),'hex'),
  'llama-v2-1024-title-summary-v1' from (
  select owner_id,'task' as kind,id,title,summary from app.tasks
  union all select owner_id,'record',id,title,summary from app.records
  union all select owner_id,'principle',id,title,summary from app.principles
) originals;
do $$
declare r app.search_index_state; v_message bigint;
begin
  for r in select * from app.search_index_state loop
    delete from pgmq.q_search_index where message->>'owner_id'=r.owner_id::text
      and message->>'kind'=r.kind and message->>'id'=r.id::text;
    select pgmq.send('search_index',jsonb_build_object('owner_id',r.owner_id,'kind',r.kind,'id',r.id,
      'input_hash',r.input_hash,'pipeline',r.pipeline)) into v_message;
    update app.search_index_state set message_id=v_message where owner_id=r.owner_id and kind=r.kind and id=r.id;
  end loop;
end $$;
