-- 원문을 일반 기록의 본문 한도 안에서 보존한다. 과거 업무 사건을 새로 만들지 않는다.
-- 이 매핑은 이관 중복 방지 전용이며 제품의 원칙 적용 관계가 아니다.
create table app.legacy_principle_record_parts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null check(source_kind in ('principle','record_principle_context')),
  source_id uuid not null,
  source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
  part integer not null check(part > 0),
  record_id uuid,
  captured_at timestamptz(3) not null,
  primary key(owner_id,source_kind,source_id,source_hash,part),
  foreign key(record_id,owner_id) references app.records(id,owner_id) on delete set null(record_id)
);
alter table app.legacy_principle_record_parts enable row level security;
revoke all on app.legacy_principle_record_parts from public,anon,authenticated;
grant select on app.legacy_principle_record_parts to app_user;
create policy legacy_principle_parts_owner on app.legacy_principle_record_parts
  for select to app_user using(owner_id=(select auth.uid()));

-- 관리자의 명시적 이관/검증에서만 실행한다. 사용자에게 실행 권한을 주지 않는다.
-- SECURITY INVOKER: 관리자의 기존 권한만 사용하며 업무 역할을 승격시키지 않는다.
create procedure private.preserve_principle_sources(p_owner uuid default null)
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
    select p.owner_id, 'principle'::text as kind, p.id, p.title, p.summary,
      jsonb_build_object('principle',to_jsonb(p)) as payload
    from app.principles p where p_owner is null or p.owner_id=p_owner
    union all
    select r.owner_id,'record_principle_context',r.id,r.title,r.summary,
      jsonb_build_object(
        'source_record',jsonb_build_object('id',r.id,'title',r.title,'occurred_at',r.occurred_at),
        'applied_principle_snapshots',r.applied_principle_snapshots,
        -- 연결된 문서의 현재 조회는 실제 적용 시점의 스냅샷으로 표현하지 않는다.
        'linked_principles_at_capture',coalesce((select jsonb_agg(to_jsonb(p) order by p.id)
          from app.record_principles rp join app.principles p on p.id=rp.principle_id and p.owner_id=rp.owner_id
          where rp.record_id=r.id and rp.owner_id=r.owner_id),'[]'::jsonb))
    from app.records r where (p_owner is null or r.owner_id=p_owner)
      and (r.applied_principle_snapshots <> '[]'::jsonb or exists(
        select 1 from app.record_principles rp where rp.record_id=r.id and rp.owner_id=r.owner_id))
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

-- 신규 현재 문서의 덮어쓰기 전에 기존 자료를 보존한다. 운영 적용은 별도 승인 범위다.
call private.preserve_principle_sources();
