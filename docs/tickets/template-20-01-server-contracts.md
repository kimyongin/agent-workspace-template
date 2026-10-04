# Template-20-01 — 현재 원칙·태그 범위·원자 변경 기록 서버

작성: 2026-10-04
상태: 진행 중
기준: main399b82b와 승인한 Template-19/20·PRD

## 목표와 승인

사용자의 “좋아. 티켓 정리하고 개발해줘” 승인으로 [Template-20](template-20-current-principle-change-records.md)을 구현한다. [PRD](../product/concept.md)·ADR-0001/0003/0004·보안·검색 가이드를 따른다. 현재 원칙0~1개/과거본 정정·삭제/현재 삭제 시 이전본 승격, 수정 메모 필수·생성/삭제 이유 선택, 사용자 기록/자동 변경 기록 CRUD, 유한한 자동 기록, 두 태그 사전, 웹/MCP 동등성이 확정 범위다. 운영 변경은 금지한다.

## 소유와 계약 인계

server 세션이 supabase/functions·supabase/migrations·supabase/tests·plugins/workspace의 관련 서버/제품 계약·스킬·테스트, 서버 계약 문서와 이 티켓을 소유한다. 웹 src/e2e는 다른 구현 세션 소유다. 공통 타입을 서버 세션만 수정하고 확정한 endpoint/input/result를 웹 세션에 먼저 전달한다. 패키지 버전/manifest 변경이 필요하면 제품 플러그인 스킬과 배포 정본을 읽고 소스만 갱신하며 외부 게시/계정 설치는 하지 않는다.

초기 조사 뒤 원칙의 current/history save/correct/delete, scoped tags, entity tag 연결, 변경 메모/record_kind/change metadata/출처, 검색 조건과 직접 링크 반환의 정확한 타입을 이 티켓에 정리해 메인과 웹 세션에 전달한다. 실행 가능한 계약이 확정되기 전에 병렬 웹 구현자가 API 의미를 추측하게 하지 않는다. 일관된 HTTP/MCP·typed 포트와 기존 테이블 확장을 우선하고 범용 payload CRUD/event sourcing을 만들지 않는다.

## 검증과 환경

## 확정 서버 입력과 결과 (2026-10-04 구현 인계)

- `GET /principles/current` → `{current: PrincipleResult|null}`. `POST /principles/current` → `{title,summary,body,expected_version?,change_note?,request_id?}`. 기존 현재본이 있으면 expected_version와 공백 아닌 change_note가 필수다. 새 저장본을 반환하며 ID가 바뀐다. 기존 `POST /principles`는 최초 등록만 허용하고 `PATCH /principles/:id`는 현재본 새 저장 별칭이다.
- `GET /principles?view=current|history|all` (기본 current, limit/cursor). `PATCH /principles/:id/correct` → `{expected_version,title?,summary?,body?,change_note,request_id?}`는 과거본만 정정한다. `DELETE /principles/:id?expected_version=&change_note=&request_id=`는204, 현재 삭제 시 남은 saved_at/id 최신본을 승격한다. 활성/비활성 행위는 제거한다.
- 원칙 결과는 기존 호환 필드에 `is_current:boolean,saved_at:string,change_note:string|null,origin:'saved'|'legacy',legacy_context:object|null`를 추가한다. 새 입력은 entity_id/tag_ids/applies_when/status를 받지 않는다. 기존 metadata는 legacy_context에 보존하며 원칙 tag_ids는 빈 배열, entity_id는 null로 반환한다. 이관은 기존 active 중 created_at/id 최신본을 현재로 선택하고 나머지를 legacy 과거 자료로 표시한다. 과거 실제 편집 사건이나 변경 기록을 소급 생성하지 않는다.
- 태그 `POST /tags` 입력은 `{scope:'entity'|'activity',name,request_id?}`; `GET /tags?scope=entity|activity` 기본 activity. 결과에 scope 추가. 같은 이름은 사전별 허용. entity create/update/result에 tag_ids 추가하고 목록에 tag_id 조건을 추가한다. task/record는 activity 사전만 연결한다.
- entity/task/record/principle 수정은 `change_note` 필수와 `request_id?`를 받는다. 생성/삭제의 change_note는 선택이다. DELETE는 expected_version/change_note/request_id query를 받는다. no-op는 기존 결과를 반환하며 버전과 활동을 늘리지 않는다.
- 기록 결과에 `record_kind:'user'|'result'|'change',change_note:string|null,change:null|{event_id,target_kind:'entity'|'task'|'record'|'principle',target_id,target_title,action:'create'|'update'|'delete'|'stop'|'resume',source:'http'|'mcp',before:object|null,after:object|null,path:string|null}`를 추가한다. 시스템 metadata는 편집 입력에 없으며 자동 기록도 title/summary/body/change_note를 정정하거나 삭제할 수 있다. `GET /records`는 record_kind 선택 조건을 받는다.
- 검색은 기존 조건에 `task_kind,task_status,principle_view:'current'|'history'|'all',record_kind`를 추가한다. 활동 tag_id는 원칙 검색에서 제외하며 모든 조건은 cursor scope와 실제 SQL 후보/coverage/anchor에 적용한다.
- 원칙 당시 적용 자료는 record에 title/summary/body/version/saved_at snapshot을 보존한다. 이후 정정/삭제는 당시 문맥을 바꾸지 않는다. 원칙 활동 기록은 저장본 ID로 연결하며 해당 본문 정본은 원칙 저장본이다. 활동 설명 정정은 원칙 본문을 바꾸지 않는다.

실행 분할: (1) 계약·변경 기록+Entity, (2) 현재 원칙·이관·scoped tags, (3) 활동 CRUD/검색/MCP/제품 안내와 격리 검증. 모든 단계는 같은 승인 범위의 구현이며 제출/리뷰 단위는 메인이 조정한다.

- core/빠른 handler·타입/lint/format·경계·웹 build 소비 계약을 검증한다.
- 기존 사용자 DB와 fin DB를 reset하거나 이관하지 않는다. worktree 전용 Supabase project_id/포트/설정/함수 소스/계정/정리 대상을 모두 격리한 새 로컬 stack을 사용한다. 그 격리가 준비되기 전 기존 공유 DB에는 변경하지 않는다.
- 격리 DB·HTTP·MCP에서 이관 fixtures(복수 기존 원칙·기존 태그/원칙 연결 보존), 최초/동시 원칙 저장·정정/삭제, 두 사전 혼용·다른 사용자 거부, 원자 변경+이력 실패 rollback·재시도·기록 재귀 종료·이력 삭제와 원본 독립을 검증한다.
- 읽기/취소/실패/no-op는 변경 기록을 생성하지 않는다. 업무 전이를 완료 결과와 묶어 중복 표시를 피한다. 실제 변경 전후·메모를 보존하며 비밀값을 snapshot에 포함하지 않는다.
- 검색은 할 일 종류/상태·원칙 현재/과거·기록 종류·활동 태그의 실제 서버 필터와 cursor scope를 함께 지원한다. entity keyword는 기존 의미를 유지한다.
- 기존 적용 migration은 수정하지 않는다. 새 migration은 설치된 CLI help로 생성하고 격리 환경에서 전후 자료 보존·권한을 검증한다. 실패 아티팩트를 보존하고 검사 기준/timeout을 완화하지 않는다.

## 인계와 결과

모델은 explicit gpt-6.1-sol/high, 복잡한 일관성·권한·전환 작업이라 high를 선택한다. desktop 지원 snapshot은 TEMP/template-18-desktop-models.json(오늘 KST 조회 재사용), assign preflight 확인. backend 실제 effort/실청구액은 미관측이다.

소스/테스트/가이드/티켓과 검증 증거를 묶어 clean commit으로 인계한다. 정확한 finalhead 독립 리뷰·CI·latestmain 통합은 메인이 조정한다. 실행 명령·격리 환경/포트·실패/미검증·현재 계약·head를 이 티켓에 기록한다. PR 하나가 과도해지면 실행 가능한 수직 단계로 커밋/PR를 나누도록 메인에 제안한다.
