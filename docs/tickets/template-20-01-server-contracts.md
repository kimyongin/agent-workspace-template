# Template-20-01 — 현재 원칙·태그 범위·원자 변경 기록 서버

> 이전 기록이다. 현재 작업과 완료 근거는 [GitHub 이관 대응표](migration-to-github.md)에서 확인한다.

작성: 2026-10-04
상태: 독립 리뷰4건 수정·새 격리 서버 검증 완료, exact-head 독립 재리뷰/화면 통합·CI 대기
기준: main399b82b와 승인한 Template-19/20·PRD

## 목표와 승인

사용자의 “좋아. 티켓 정리하고 개발해줘” 승인으로 [Template-20](template-20-current-principle-change-records.md)을 구현한다. [PRD](../product/concept.md)·ADR-0001/0003/0004·보안·검색 가이드를 따른다. 현재 원칙0~1개/과거본 정정·삭제/현재 삭제 시 이전본 승격, 수정 메모 필수·생성/삭제 이유 선택, 사용자 기록/자동 변경 기록 CRUD, 유한한 자동 기록, 두 태그 사전, 웹/MCP 동등성이 확정 범위다. 운영 변경은 금지한다.

## 소유와 계약 인계

server 세션이 supabase/functions·supabase/migrations·supabase/tests·plugins/workspace의 관련 서버/제품 계약·스킬·테스트, 서버 계약 문서와 이 티켓을 소유한다. 웹 src/e2e는 다른 구현 세션 소유다. 공통 타입을 서버 세션만 수정하고 확정한 endpoint/input/result를 웹 세션에 먼저 전달한다. 패키지 버전/manifest 변경이 필요하면 제품 플러그인 스킬과 배포 정본을 읽고 소스만 갱신하며 외부 게시/계정 설치는 하지 않는다.

초기 조사 뒤 원칙의 current/history save/correct/delete, scoped tags, entity tag 연결, 변경 메모/record_kind/change metadata/출처, 검색 조건과 직접 링크 반환의 정확한 타입을 이 티켓에 정리해 메인과 웹 세션에 전달한다. 실행 가능한 계약이 확정되기 전에 병렬 웹 구현자가 API 의미를 추측하게 하지 않는다. 일관된 HTTP/MCP·typed 포트와 기존 테이블 확장을 우선하고 범용 payload CRUD/event sourcing을 만들지 않는다.

## 확정 서버 입력과 결과 (2026-10-04 구현 인계)

- `GET /principles/current` → `{current: PrincipleResult|null}`. `POST /principles/current` → `{title,summary,body,expected_version?,change_note?,request_id?}`. 기존 현재본이 있으면 expected_version와 공백 아닌 change_note가 필수다. 새 저장본을 반환하며 ID가 바뀐다. 기존 `POST /principles`는 최초 등록만 허용하고 `PATCH /principles/:id`는 현재본 새 저장 별칭이다.
- `GET /principles?view=current|history|all` (기본 current, limit/cursor). `PATCH /principles/:id/correct` → `{expected_version,title?,summary?,body?,change_note,request_id?}`는 과거본만 정정하며 메모만 입력해도 허용한다. 동일 메모·본문은 버전·활동·색인을 늘리지 않는다. 현재본 PATCH의 본문 필드 요구는 별도 schema로 유지한다. `DELETE /principles/:id?expected_version=&change_note=&request_id=`는204, 현재 삭제 시 남은 saved_at/id 최신본을 승격한다. 활성/비활성 행위는 제거한다.
- 원칙 결과는 기존 호환 필드에 `is_current:boolean,saved_at:string,change_note:string|null,origin:'saved'|'legacy',legacy_context:object|null`를 추가한다. 새 입력은 entity_id/tag_ids/applies_when/status를 받지 않는다. 기존 metadata는 legacy_context에 보존하며 원칙 tag_ids는 빈 배열, entity_id는 null로 반환한다. 이관은 기존 active 중 created_at/id 최신본을 현재로 선택하고 나머지를 legacy 과거 자료로 표시한다. 과거 실제 편집 사건이나 변경 기록을 소급 생성하지 않는다.
- 태그 `POST /tags` 입력은 `{scope?:'entity'|'activity',name,request_id?}`이며 scope 생략은 기존 클라이언트 호환으로 activity; `GET /tags?scope=entity|activity` 기본 activity. 결과에 scope 추가. 같은 이름은 사전별 허용. entity create/update/result에 tag_ids 추가하고 목록에 tag_id 조건을 추가한다. task/record는 activity 사전만 연결한다. 사전 rename/delete는 기존 expected_version 계약으로 메모를 요구하지 않으며 별도 변경 기록을 만들지 않는다. 같은 사전의 대소문자 무시 중복명은409 conflict, 다른 scope/없음/다른 사용자 태그 연결은400 invalid_reference, 다른 소유자 태그 단건·편집·삭제는404 not_found, 오래된 버전은409 conflict다. 사용 중 태그 삭제는 기존 정책대로 연결을 해제하고 연결 항목 버전을 올리며 본문·이미 기록한 tag 이름 snapshot을 보존한다(사용 중이라는 별도 거부 오류는 없다).
- entity/task/record/principle 수정은 `change_note` 필수와 `request_id?`를 받는다. 생성/삭제의 change_note는 선택이다. DELETE는 expected_version/change_note/request_id query를 받는다. no-op는 기존 결과를 반환하며 버전과 활동을 늘리지 않는다.
- 기록 결과에 `record_kind:'user'|'result'|'change',change_note:string|null,change:null|{event_id,target_kind:'entity'|'task'|'record'|'principle',target_id,target_title,action:'create'|'update'|'delete'|'stop'|'resume',source:'http'|'mcp',before:object|null,after:object|null,path:string|null}`를 추가한다. 시스템 metadata는 편집 입력에 없으며 자동 기록도 title/summary/body/change_note를 정정하거나 삭제할 수 있다. `GET /records`는 record_kind 선택 조건을 받는다.
- 검색은 기존 조건에 `task_kind,task_status,principle_view:'current'|'history'|'all',record_kind`를 추가한다. 명시한 principle_view가 legacy status보다 우선하고 생략할 때만 status active/inactive/all을 current/history/all로 정규화한다. 정규화한 동등 필터는 같은 cursor scope를 사용한다. 활동 tag_id는 원칙 검색에서 제외하며 모든 조건은 cursor scope와 실제 SQL 후보/coverage/anchor에 적용한다.
- 기록의 `applied_principle_snapshots`는 `{id,title,summary,body,version,saved_at,status:'active'|'inactive',captured_at:'application'|'migration'}[]`이며 contracts에 유효 응답 schema를 정의했다. 새 연결 application 캡처는 이후 원칙 정정/삭제와 독립이다. 같은 ID 연결을 유지한 기록 설명 수정은 이전 캡처를 유지한다. 이관 migration 캡처는 당시 DB 자료를 보존한 것으로 과거 실제 적용 시점 본문을 보증하지 않는다. 삭제된 원칙의 live applied_principle_ids는 제거해도 캡처·기록 버전은 유지한다. 원칙 활동 기록은 저장본 ID로 연결하며 해당 본문 정본은 원칙 저장본이다. 활동 설명 정정은 원칙 본문을 바꾸지 않는다.
- owner revision은 새 저장·현재 삭제의 승격/빈 상태 전환 이후에도 재사용하지 않는다. 전용 owner 행이 마지막 문서 삭제 뒤에도 다음 버전을 유지한다. 승격본의 version은 올라가지만 saved_at/본문/이전 적용 캡처는 그대로다. 이는 동시성 토큰 갱신이며 과거 본문 정정이 아니다. 과거 저장본 자체의 정정 버전도 다음 owner 할당 시 상한으로 고려한다. 버전 숫자를 연속된 본문 편집 횟수로 해석하지 않는다. 자동 기록은 title/summary/body/change_note만 편집 가능하며 메모만 정정도 허용한다; change metadata·record_kind·시간·연결·태그·적용 원칙 편집 입력은400이다.

실행 분할: (1) 계약·변경 기록+Entity, (2) 현재 원칙·이관·scoped tags, (3) 활동 CRUD/검색/MCP/제품 안내와 격리 검증. 모든 단계는 같은 승인 범위의 구현이며 제출/리뷰 단위는 메인이 조정한다.

## 검증과 환경

- core/빠른 handler·타입/lint/format·경계·웹 build 소비 계약을 검증한다.
- 기존 사용자 DB와 fin DB를 reset하거나 이관하지 않는다. worktree 전용 Supabase project_id/포트/설정/함수 소스/계정/정리 대상을 모두 격리한 새 로컬 stack을 사용한다. 그 격리가 준비되기 전 기존 공유 DB에는 변경하지 않는다.
- 격리 DB·HTTP·MCP에서 이관 fixtures(복수 기존 원칙·기존 태그/원칙 연결 보존), 최초/동시 원칙 저장·정정/삭제, 두 사전 혼용·다른 사용자 거부, 원자 변경+이력 실패 rollback·재시도·기록 재귀 종료·이력 삭제와 원본 독립을 검증한다.
- 읽기/취소/실패/no-op는 변경 기록을 생성하지 않는다. 업무 전이를 완료 결과와 묶어 중복 표시를 피한다. 실제 변경 전후·메모를 보존하며 비밀값을 snapshot에 포함하지 않는다.
- 검색은 할 일 종류/상태·원칙 현재/과거·기록 종류·활동 태그의 실제 서버 필터와 cursor scope를 함께 지원한다. entity keyword는 기존 의미를 유지한다.
- 기존 적용 migration은 수정하지 않는다. 새 migration은 설치된 CLI help로 생성하고 격리 환경에서 전후 자료 보존·권한을 검증한다. 실패 아티팩트를 보존하고 검사 기준/timeout을 완화하지 않는다.

## 인계와 결과

모델은 explicit gpt-6.1-sol/high, 복잡한 일관성·권한·전환 작업이라 high를 선택한다. desktop 지원 snapshot은 TEMP/template-18-desktop-models.json(오늘 KST 조회 재사용), assign preflight 확인. backend 실제 effort/실청구액은 미관측이다.

소스/테스트/가이드/티켓과 검증 증거를 묶어 clean commit으로 인계한다. 정확한 finalhead 독립 리뷰·CI·latestmain 통합은 메인이 조정한다. 실행 명령·격리 환경/포트·실패/미검증·현재 계약·head를 이 티켓에 기록한다. PR 하나가 과도해지면 실행 가능한 수직 단계로 커밋/PR를 나누도록 메인에 제안한다.

### 격리 실행 증거 (2026-10-04)

- worktree `C:/Users/yongin/.codex/worktrees/current-principle-server/agent-workspace-template`, branch `codex/current-principle-server`, base773e365. 계약 immutable head8af1be0은 별도로 UI에 인계했다. 운영 연결/게시/비용이 드는 공급자 실험은 하지 않았다.
- 새 project_id `template20server`: API56421, DB56422, Studio56423, mail56424, pooler56429, inspector8583. 시작 전 이 포트 listener 없음과 Docker 프로젝트 목록을 확인했다. 기존 template root55421/55422와 fin54321/54322 프로젝트는 재시작·reset·이관하지 않았다. 테스트 함수 소스·설정·서명 키·계정은 전용 runtime으로 복사/생성했으며 remote 설정을 제거했다. 계정은 template20-a@example.test / template20-b@example.test다. 비밀값은 커밋/로그/문서에 남기지 않는다.
- CLI2.119.0의 `migration new --help`, `start --help`, `db reset --help`를 읽고 새 migration을 CLI로 생성했다. [Supabase changelog](https://supabase.com/changelog), [RLS 문서](https://supabase.com/docs/guides/database/postgres/row-level-security), [CLI reference](https://supabase.com/docs/reference/cli/introduction)를 확인했다. 적용된 이전 migration13개는 수정하지 않았다.
- 이관 스크립트 `supabase/tests/migrations/current-principle.ts prepare|verify <fixture-json>`는 localhost DB56422만 허용하고 스스로 reset하지 않는다. config의 project/DB port를 확인한 뒤 전용 stack만 migration13으로 reset, 자신의 random owner fixture를 prepare하고 migration14를 적용·verify했다. 독립 원칙3개(활성2개·더 최신 비활성1개), body/date/legacy origin/context/tag 이름/entity/tag/applied links 보존, 최신 활성 선택, migration 캡처 한계, 허구 활동/색인 작업0, 직접 사용자 역할 접근 거부를 확인했다. 검증 후 fixture owner와 큐를 제거한다.
- DB 실행은 `LOCAL_POOLER_PORT=56429`와 전용 `.env.local`로 실제 app_server→app_user/RLS 경로를 썼다. HTTP는 전용 Edge Runtime API56421, MCP는 실제 로컬 OAuth 발급 토큰과 공식 SDK로 호출했다. index worker의 공급자는 stub/누락 키 환경이며 실제 Pinecone 호출은 하지 않았다.
- 필수 검증: core+fast70 PASS, 전체 DB77 PASS, HTTP17 PASS, MCP16 PASS, migration13→14 PASS, Deno check/lint/fmt·의존 경계·docs check PASS. 최종 head 확인은 아래 인계에 추가한다. 프런트 source/e2e/build 소비 검증과 CI/latestmain exact-head 독립 리뷰는 담당 세션의 통합 단계에 남는다.
- 실제 DB 경합은 같은 version의 서로 다른 저장2개 중1개 성공/1개 conflict, same request 재시도1회, 현재0~1개를 확인한다. 승격/마지막 삭제 후 재생성 stale version 거부, saved_at/body/snapshot 유지, 삭제 event1개도 확인했다. 필수 change 저장 실패 injection은 entity/task/record/principle mutation·version·index·request를 모두 rollback하고 재시도 한 번만 남긴다. 자동 기록 편집·삭제는 재귀 없이 한 행위 한 기록이고 원본에 독립이다. 동일 recurrence object/key 순서·태그 set 순서 변경은 version/index/history를 늘리지 않는다.
- 사용 중 태그 삭제는 `unlinkUses` 포트로 부모 연결의 실제 변화마다 required update 기록을 같은 트랜잭션에 저장한다. 태그 자체 target 사건은 없으며 직접 부모 편집의 필수 메모와 달리 삭제 reason은 선택이다. HTTP `DELETE /tags/:id?expected_version&change_note?&request_id?`와 MCP `delete_tag(id,expected_version,change_note?,request_id?)`의 선택 입력을 동등하게 받는다. request_id를 재사용하면 원래 결과를 반환하고 부모 기록을 반복하지 않는다. before의 tag 이름은 삭제 전에 캡처하고 after는 해제된 tag_ids다. record_kind=change 부모의 내부 연결 해제는 추가 기록을 만들지 않아 재귀가 끝난다. 두 번째 부모 기록 실패 주입은 앞서 만든 기록/모든 연결·버전·태그·큐·request를 rollback한다. 실제 HTTP 태그 삭제→같은 요청 MCP 재시도도 부모 한 개 기록과 최초 source=http를 검증했다.
- 초기 실패는 승인 전 원칙의 다중 active/태그/엔터티 연결 기대값, 필수 메모 fixture, 새 자동 기록의 검색/큐 포함과 기존 owner fixture 잔존에서 발생했다. 새 계약/별도 random owner를 적용하고 보존/권한/경합 검증을 유지했다. 함수 복사 watcher 재시작과 겹친 초기 HTTP 인증503은 source가 안정된 뒤 동일 assertion으로17 PASS였다. owner revision 보강 이후 승격본의 이전 version 삭제가409인 검증을 추가했다. assertion/timeout을 완화하지 않았다. 실패/성공 로그와 docs 다운로드는 저장소 밖 `C:/Users/yongin/.codex/tmp/template20-server-artifacts`에 보존한다.

### 독립 리뷰 수정 인계 (2026-10-04, 제출 전 snapshot)

독립 리뷰 `C:/Users/yongin/AppData/Local/Temp/template20-server-review-final.md`의 결론은 기준 clean `c887c55b2f1e5dc61dce212417688394b8da5079`에 대해 수정 필요다. 이 구현 세션이4건을 수정했으며 독립 승인으로 표시하지 않는다. PRD·ADR 변경은 필요하지 않았다. 메인이 서버 최종 소스와 화면 소스를 함께 통합할 수 있으며 exact-head 재리뷰·CI·PR·머지는 메인이 소유한다. 이 세션은 푸시·PR·머지·운영 배포·다른 에이전트 생성 없이 로컬 clean commit까지 수행한다.

| 발견 | 재현과 수정 | 검증 |
| --- | --- | --- |
| P1 태그 삭제의 Read Committed stale 연결 | 독립 fake 재현에 더해 새 실제 DB에서 entity/task/record 모두 부모 잠금 대기 후 다른 태그를 복원함을 수정 전에 확인(0 PASS/3 예상 FAIL). 부모만 먼저 잠근 뒤 새 문장으로 연결을 조회하고 없어진 부모·이미 제거한 태그는 건너뛴다 | 실제 app_server→app_user/RLS 경합9 PASS: 연결 동시 제거·본문 동시 편집·부모 동시 삭제 ×3유형. 실제 제거만 version/기록1회, unrelated 태그/최신 본문 보존. 원본 archive의 같은 확장 검사3 PASS/6 예상 FAIL과 수정본을 함께 보존 |
| P2 삭제된 원칙 캡처 명시 비우기 | 독립 재현에서 live IDs=[]인 기록의 명시 []가 no-op였음. 선택에서 빠지는 snapshot도 변경 판단에 포함 | [] 실제 삭제·필수 기록 실패 rollback·같은 request 재시도1회·다시 [] no-op. 생략 및 같은 저장본 선택은 원래 캡처 보존 |
| P2 명시 principle_view를 legacy status가 덮음 | 독립 SQL-store 재현에서 current+inactive/all이 다른 범위를 반환. shared schema가 생략한 view에만 alias를 적용하고 scope도 정규화 | current/history/all × active/inactive/all의 실제 후보·coverage·anchor·전체 cursor. 동등 alias cursor 재사용·다른 view cursor 거부. 실제 HTTP와 OAuth MCP 검색 응답 직접 동등 비교 |
| P2 과거 메모만 정정 schema 거부 | 독립 schema 재현에서 expected_version/change_note만400. 별도 principleCorrection을 HTTP correct와 MCP correct_principle 및 도구 schema에 적용 | 메모만 수정·동일 메모 no-op·재시도1회·required history rollback. 본문/saved_at/current 유지, principle 재색인 없음, 다음 owner revision 상한 유지 |

전용 프로젝트는 `template20fix`: API57421, DB57422, Studio57423, mail57424, pooler57429, Edge inspector8783. 시작 전 listener/Docker inventory를 확인했고 root55421·fin54321·UI 독점 template20server56421에는 변경·이관·초기화·재시작·정리를 하지 않았다. 외부 기존 runtime은 참고로 읽었으며 새 source/config를 별도 runtime에 복사하고 새로운 서명 키·비밀번호·`template20fix-a/b@example.test` 계정을 생성했다. 원격 연결 설정과 공급자 키는 넣지 않았다. Studio/mail/realtime/storage/analytics/vector/pg_meta는 제외했다. tracked config·migration14개는 변경하지 않았다. 이관 fixture의 로컬 전용 guard만 이번 DB57422로 맞췄다.

증거 위치는 `C:/Users/yongin/.codex/tmp/template20-fix-artifacts`; runtime은 그 아래 `runtime`, 진행/최종 head는 `C:/Users/yongin/AppData/Local/Temp/template20-server-fix-status.md`다. 원래4개 재현, 실제 DB baseline/확장 재현·수정 회귀, migration reset13/prepare/up14/verify 성공, 원본·최종 소스 SHA-256 manifest와 count, 실행 로그 및 clean commit의 최종 검증을 보존한다. 최초 DB 전체82 PASS/1 FAIL은 hybrid 테스트가 파싱된 current view를 유지하면서 legacy status만 바꾸던 입력 문제였다. assertion/기대값·timeout을 보존하고 view 생략 alias 입력을 schema로 파싱하도록3곳을 수정했다. 새 경합 테스트 추가 중 발견한 TypeScript 제어문 오류도 수정했고 실패 로그를 보존했다.

실행 검증은 package.json에 고정된 CLI2.119.0/Deno2.9.6으로 수행했다. `npm run test:fast`의 core60·빠른 handler10·웹unit14 PASS, `deno test --config supabase/functions/deno.json --allow-env --allow-net --allow-read --env-file=<own runtime/.env.local>`의 DB89·HTTP18·OAuthMCP17 PASS(LOCAL_POOLER_PORT=57429), migration13→14 fixture PASS, `check:deno`·`check:boundaries`·`check:docs`·diff PASS다. 기능 검사에 새 skip이나 assertion/timeout 완화는 없고 docs script49 중 기존 Windows symlink1 SKIP/48 PASS가 그대로다. DB 전체에는 사용자 격리/직접 DML 거부/Actor 연결 재사용/필수 기록 rollback/유한 재귀/중복 처리/current promotion·마지막 삭제 후 revision 재사용 거부를 포함한다.

제출 전 한계: `npm run build`의 프런트 소비 오류7개는 깨끗한 c887 archive에서도 동일한 진단7개를 확인했다. `src/features/principles/forms.tsx`의 제거된 legacy 입력 필드 소비6개와 `src/features/tags/resolve-tag.test.ts`의 scope 없는 fixture1개이며 src/e2e/App/Auth는 이 세션에서 수정하지 않았다. 화면 담당이 계약과 맞춘 source revision을 병합해 build·전체 E2E를 검증해야 한다. 서버 SDK/OAuth 검사와 실제 Claude/Codex 제품 스킬 행동은 구분하며 실제 클라이언트 행동/Google 로그인 브라우저 검증·공급자 실모델 호출·exact-head 독립 승인/CI는 이번 구현 증거로 주장하지 않는다. 같은 날 CLI 모델 snapshot preflight는 gpt-6.1-sol/high를 명시 허용했고 backend actual effort·실청구액은 미관측이다.

최종 검증 뒤에는 자기 Edge process/container와 자기 lease만 종료한다. `template20fix` DB·볼륨·계정·함수 runtime·실패/성공 증거는 보존하며, UI가 빌린 원래 template20server 환경과 lease는 그대로 둔다. 최종 종료/보존 결과와 정확한 clean SHA는 외부 최종 status와 인계 응답에 남긴다.
