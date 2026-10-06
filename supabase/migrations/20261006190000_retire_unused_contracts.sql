-- Cut off unused product contracts only after capturing complete pre-DDL sources.
-- Historical migrations remain unchanged; this archive is admin-only recovery input.
create table private.retired_principle_sources (
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null check(source_kind in ('principle','record_principle_context')),
  source_id uuid not null, title text not null, summary text not null, payload jsonb not null,
  primary key(owner_id,source_kind,source_id)
);
revoke all on private.retired_principle_sources from public,anon,authenticated,app_user,app_server;
insert into private.retired_principle_sources(owner_id,source_kind,source_id,title,summary,payload)
    select p.owner_id, 'principle'::text as kind, p.id, p.title, p.summary,
      jsonb_build_object('principle',to_jsonb(p)) as payload
    from app.principles p where true
    union all
    select r.owner_id,'record_principle_context',r.id,r.title,r.summary,
      jsonb_build_object(
        'source_record',jsonb_build_object('id',r.id,'title',r.title,'occurred_at',r.occurred_at),
        'applied_principle_snapshots',r.applied_principle_snapshots,
        -- 연결된 문서의 현재 조회는 실제 적용 시점의 스냅샷으로 표현하지 않는다.
        'linked_principles_at_capture',coalesce((select jsonb_agg(to_jsonb(p) order by p.id)
          from app.record_principles rp join app.principles p on p.id=rp.principle_id and p.owner_id=rp.owner_id
          where rp.record_id=r.id and rp.owner_id=r.owner_id),'[]'::jsonb))
    from app.records r where (true)
      and (r.applied_principle_snapshots <> '[]'::jsonb or exists(
        select 1 from app.record_principles rp where rp.record_id=r.id and rp.owner_id=r.owner_id));

create or replace procedure private.preserve_principle_sources(p_owner uuid default null)
language plpgsql security invoker set search_path='' as $$
declare
  source record;
  serialized text;
  v_source_hash text;
  v_part integer;
  total_parts integer;
  captured_at timestamptz(3);
  record_id uuid;
  record_title text;
  record_summary text;
  prior_claims text := current_setting('request.jwt.claims',true);
begin
  -- 같은 원본의 동시 이관도 같은 매핑 하나만 남긴다.
  perform pg_advisory_xact_lock(hashtextextended('preserve-principle-sources',0));
  for source in
    select owner_id,source_kind as kind,source_id as id,title,summary,payload
      from private.retired_principle_sources where p_owner is null or owner_id=p_owner
  loop
    serialized := jsonb_pretty(source.payload);
    v_source_hash := encode(extensions.digest(serialized,'sha256'),'hex');
    -- JS/Zod 한도는 UTF-16이다. 9,000 codepoint면 astral 문자도 머리말 포함 20,000 이내다.
    total_parts := greatest(1,ceil(char_length(serialized)/9000.0)::integer);
    captured_at := clock_timestamp();
    for v_part in 1..total_parts loop
      -- 사용자가 이관 기록을 삭제해도 매핑은 남는다. 재실행으로 다시 만들지 않는다.
      if exists(select 1 from app.legacy_principle_record_parts m where m.owner_id=source.owner_id
        and m.source_kind=source.kind and m.source_id=source.id and m.source_hash=v_source_hash and m.part=v_part)
      then continue; end if;
      record_title := left('원칙 보존 자료 · '||source.title||' · '||v_part||'/'||total_parts,50);
      record_summary := left('기존 원칙 근거의 이관 캡처. 실제 적용 시각이 아닙니다. '||source.summary,150);
      insert into app.records(owner_id,title,summary,body,record_kind,occurred_at)
        values(source.owner_id,record_title,record_summary,
          '이관 캡처: '||captured_at||' / 원본: '||source.kind||' '||source.id||' / 조각: '||v_part||'/'||total_parts||E'\n'
          ||'실제 적용 시각이 아닙니다. 원본 시각과 captured_at 의미는 아래 자료 그대로 보존합니다.'||E'\n\n'
          ||substring(serialized from (v_part-1)*9000+1 for 9000),'user',captured_at)
        returning id into record_id;
      insert into app.legacy_principle_record_parts values(source.owner_id,source.kind,source.id,v_source_hash,v_part,record_id,captured_at);
      -- 기존 색인 진입점의 소유자·입력 검증을 그대로 재사용한다. 비용 발생 호출은 없다.
      perform set_config('request.jwt.claims',jsonb_build_object('sub',source.owner_id,'role','authenticated')::text,true);
      perform app.enqueue_search_index('record',record_id,
        encode(extensions.digest(record_title||E'\n'||record_summary,'sha256'),'hex'),'llama-v2-1024-title-summary-v1');
    end loop;
  end loop;
  perform set_config('request.jwt.claims',coalesce(prior_claims,''),true);
end $$;
revoke all on procedure private.preserve_principle_sources(uuid) from public,anon,authenticated,app_user,app_server;


-- Source hashes and existing parts are unchanged because the archived payload is exact.
call private.preserve_principle_sources();

drop trigger task_legacy_entity_selection on app.tasks;
drop trigger record_legacy_entity_selection on app.records;
drop function app.sync_legacy_entity_selection();
create or replace function app.detach_deleted_task_entity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  update app.tasks t set entity_ids=array_remove(t.entity_ids,old.id),
    entity_context=(select coalesce(jsonb_agg(context),'[]'::jsonb)
      from jsonb_array_elements(t.entity_context) context where context->>'id'<>old.id::text),
    version=t.version+1,updated_at=now()
    where t.owner_id=old.owner_id and t.entity_ids @> array[old.id];
  return old;
end $$;
alter table app.tasks drop column entity_id;
alter table app.records drop column entity_id;
alter table app.principles drop column entity_id, drop column applies_when,
  drop column status, drop column replaced_by_id;

-- Current documents alone remain reachable/writable through the business role.
drop policy principles_owner on app.principles;
create policy principles_owner on app.principles for all to app_user
  using(owner_id=(select auth.uid()) and is_current)
  with check(owner_id=(select auth.uid()) and is_current);
revoke all on app.record_principles,app.principle_tags from app_user;
-- Historical JSON captures may be read but can no longer be injected or rewritten.
revoke insert,update on app.records from app_user;
grant insert(id,owner_id,title,summary,body,occurred_at,task_id,occurrence_on,version,created_at,updated_at,
  record_kind,change_note,change_metadata,entity_ids,entity_context) on app.records to app_user;
grant update(title,summary,body,occurred_at,task_id,occurrence_on,version,updated_at,
  record_kind,change_note,change_metadata,entity_ids,entity_context) on app.records to app_user;
