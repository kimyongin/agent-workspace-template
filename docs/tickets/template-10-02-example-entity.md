# Template-10-02 — 예제 Entity 수직 슬라이스

상태: 진행 중. 부모 [Template-10](template-10-priority-completion.md)의 T02-4 하위 작업이며 확정 계약은 [T02-1](template-02-t02-1-contracts.md#예제-엔터티-entity--t02-4)을 따른다.

## 배정과 승인 범위

- 2026-10-04 Asia/Seoul 사용자 재개 승인: T02-4. T02-5 Book·T02-6 초기화/배포 게이트는 제외.
- 구현 서브세션 `implement_entity`: base `46f4cbe`, branch `codex/example-entity`, checkout `C:/Users/yongin/.codex/worktrees/example-entity/agent-workspace-template`.
- 배정 모델 `gpt-6.1-sol`, medium. 같은 날 desktop preflight는 메인이 수행한 `TEMP/overnight-desktop-snapshot.json` 근거를 전달받음. 실제 backend 모델/effort metadata는 미노출.
- 이 세션은 Entity 계약·core·저장·migration·HTTP/MCP·UI·연결 필터·제품 스킬 안내·검증을 소유한다. 별도 fast worker와 plugin packaging worker의 파일은 수정하지 않는다. 시작 문서·overview·Template-10 부모 요약은 메인이 조정한다.
- 메인이 shared local Supabase 검증 exclusive 담당을 이 세션에 배정했다. 운영 DB·배포·비용 작업은 범위 밖이다.

## 계약과 구현 범위

단일 `app.entities`에 prop1 텍스트, prop2 정수, prop3 날짜, prop4 선택과 버전·시각을 명시한다. generic payload/엔진은 만들지 않는다. Entity는 임베딩/검색 큐 대상이 아니다.

`keyword`는 prop1 대소문자 무시 부분 일치, `prop3_from`·`prop3_to`는 포함 날짜 범위, `prop4`는 선택값이며 함께 쓰면 AND다. `sort`는 기본 updated_at 내림차순, prop1/2/3은 오름차순, id가 동점 정렬 키다. 빈 숫자/날짜는 먼저 표시한다. 커서는 owner·필터·sort에 묶는다.

메인과 합의: 상세는 tasks/records/principles 각 최근 5개(updated_at desc, id desc)와 전체 count를 반환한다. 관련 목록의 entity_id로 전체 조회한다. 참조는 같은 owner여야 하고 보이지 않는 참조는 invalid_reference다. Entity 삭제는 링크만 비우고 연결 항목 version·updated_at을 갱신한다. 데이터 원문·태그·원칙 적용 연결은 보존한다. 할 일 완료 결과는 해당 할 일의 Entity 연결을 이어받으며 회차 기록은 생략 시 할 일의 연결을 이어받는다.

UI는 공통 Field/FormModal/ConfirmDialog, panel/list/action 토큰을 소비한다. Entity 목록의 URL 필터·누적 페이지·상세 복귀 초점/스크롤, 로딩·빈 결과·오류 재시도·더 보기 실패 보존과 작성/편집 초안 보존을 검증한다. 연결은 별도 관리 모달 없이 폼에서 선택한다.

## PR와 검증 계획

Entity의 실제 소비자까지 한 수직 기능 경계로 구현한다. DB→공통 유스케이스→HTTP/MCP→UI와 task/record/principle 링크가 함께 있어야 FK/참조 거부/삭제 보존 의미를 확인할 수 있어 400줄을 넘을 수 있다. 독립 기능인 플러그인 패키징·활동 목록 복원은 별도 작업이다. PR 분할 필요 시 메인과 조정한다.

- 서비스 없는 검증: npm ci, contracts/core·handler 회귀, web tests, build, Deno check/lint/fmt, boundary, docs, git diff 체크.
- 격리 실제 검증: Entity DB RLS·같은 owner FK·커서·conflict·멱등성·링크 해제와 버전 보존, 실제 인증 HTTP/MCP CRUD parity, 웹 CRUD/연결/삭제·필터·초안·반응형 E2E. 공유 로컬 환경 배정 또는 통합 CI에서 수행하고 실제 실행과 인계를 구분한다.
- Supabase 공식 문서 확인(2026-10-04 KST): changelog.md를 PowerShell Invoke-WebRequest로 조회(web 도구의 text/markdown 미지원 fallback). 최근 Database breaking change는 PostgreSQL 15.19/17.11 extension 관련 공지이며 Entity의 일반 FK/RLS에는 새 API 변경이 없음. [RLS 공식 문서](https://supabase.com/docs/guides/database/postgres/row-level-security)의 grant와 policy를 함께 적용하는 기준을 확인함.
- CLI `supabase migration new example_entity`로 생성한 `20261003194119_example_entity.sql`은 UTC 2026-10-03 / KST 2026-10-04 작업이다.

## 실행 기록

- 재리뷰 `72d4d70`의 추가 P2 두 건: lookahead의 실제 페이지 수를 버려 더 보기 첫 클릭이 중복 조회되는 문제, 추가 조회/재시도마다 복귀 초점을 재설정하는 문제. 패키지 담당의 고정 소스/환경 독점 반환 후 Entity UI·E2E만 수정한다. 실제 count·누적 결과·next_cursor를 필터/hash 문맥별로 보존하고 추가/실패 재시도는 마지막 성공 cursor부터 append한다. 복귀 초점 완료 표식은 pages/retry에 의해 지우지 않으며 동일 버튼을 실패 재시도와 완료 상태까지 유지해 초점·위치를 보호한다. 61개+동시 1개 actual fixture로 40→60→추가 실패/같은 cursor 재시도→62행을 검증한다. 최신 main 통합과 소스 checkpoint 뒤 own runtime 검증을 시작한다.
- 최신 main `09851bb`로 rebase한 고정 `8b9840c`(마지막 UI 변경 `e2e9bcf`)에서 Entity E2E 8/8, 전체 E2E 57 passed / 9 skipped / 0 failed(2.3m) 통과. desktop/mobile 모두 61+1 actual fixture의 40행 복원→첫 더 보기 60행/추가 cursor 1회→실패 시 60행·버튼 초점/viewport 보존→같은 cursor 재시도 62행·완료 버튼 초점/이전 anchor 미복귀를 확인했다. HTTP 17/17·MCP 17/17, fast(core 60/handler 13/web 1), build·Deno·boundary·docs(298개, scripts 36/1 Windows skip)·plugin checker 통과. SQL/서버 코드는 이전 실제 DB 70/70 검증과 동일하다. 전체 E2E 제외 9개는 기존 모바일 중복 검사 7개와 유료 실제 모델 opt-in 2개다.
- 이 회귀의 실패 자료는 `TEMP/entity-e2e-run8`~`run9`에 보존했다. run8은 새 Edge의 초기 DB 이름 해석 실패 2건과 page navigation의 hash 삭제로 cache 문맥/버튼이 재생성된 구현 실패 2건이었다. hash 명시 보존·preventScrollReset을 적용하고 실제 인증 HTTP/MCP 준비 검증 뒤 재실행했다. run9의 2건은 오류 안내 높이에 따른 브라우저 scroll anchoring을 절대 scrollY 동일로 검사한 테스트 오류로, 버튼의 viewport 실제 위치와 유지된 초점을 검사하도록 수정했다. 성공 자료는 `TEMP/entity-e2e-run10`(Entity 8개), `run11`(전체)에 보존했다.
- 최종 전체 검증 뒤 own Edge runtime/functions serve를 중지하고 exclusive 환경 담당을 메인에 반환했다. DB·fin·primary Vite 55480을 유지하고 own Vite 55481은 Playwright가 종료했다. 최종 증거 문서 commit 뒤 독립 재리뷰·CI·머지는 메인이 맡는다.

- 독립 리뷰 `017bc29`: P2 두 건(검색 entity_id 계약 누락, Entity 복원의 대상 없음 전체 스캔·hash 유지·제목 초점/늦은 응답 보호 누락). 리뷰 종료 후 검색 계약/공통 SQL 범위/웹/제품 스킬과 회귀를 추가한다. HTTP/MCP는 같은 strict schema를 소비하며 cursor scope는 이미 모든 필터를 포함한다. 복원은 저장 pages(최대 250)에 추가 1페이지까지만 허용해 동시 추가로 한 페이지 밀린 항목을 찾고, 대상 없음은 제목 초점으로 끝낸다. 활동 목록 helper는 다른 세션 소유로 변경하지 않는다. 공유 로컬 검증 exclusive를 재배정받았으며 소스 고정 후 own runtime을 시작한다.
- 리뷰 수정 checkpoint를 만든 뒤 최신 main `db70cbf`(PR #75)로 rebase했다. 신규 fast PrincipleResult fixture에 `entity_id ?? null`을 반영해 계약 통합 타입 오류를 고쳤으며 기존 principle routes/tools refinement를 보존했다. `c7e9b8b`에서 실제 DB 70/70·HTTP 17/17·MCP 17/17(검색 필터, 원칙 Entity-only 수정과 malformed Entity의 HTTP/MCP 오류 동등성 포함), fast(core 60/handler 13/web 1), Deno 통과. 같은 앱/서버 코드의 `1d4e385`에서 Entity·검색 E2E 12/12 통과. build·boundary·plugin checker·docs(268개, scripts 36/1 Windows skip) 통과.
- 리뷰 수정 1차 실패는 DB excluded fixture의 summary 필수/빈 문자열 제약 누락과, 동시 추가 복원이 이미 마지막 페이지까지 가져온 뒤 더 보기 버튼을 기다린 E2E 검사 오류였다. 정상 요약과 현재 excluded index state를 만든 fixture 및 동시 추가 검사를 분리한 뒤 통과했다. E2E 실패 자료 `TEMP/entity-e2e-run5`, 성공 자료 `TEMP/entity-e2e-run6`에 보존함.
- `8de419c`에서 실제 삭제 후 목록 제목 초점 fallback을 포함한 Entity E2E 6/6 추가 통과(`TEMP/entity-e2e-run7`). 이 head의 마지막 앱/서버 코드 변경은 `272ba5c`이며 이후 변경은 검증 fixture·E2E·증거 문서다. docs/diff 검사도 재통과. 서비스 검증 종료 후 own Edge runtime/functions serve를 중지했고 DB·fin·primary Vite 55480은 유지, worktree Vite 55481은 Playwright가 종료했다. exclusive 담당을 메인에 반환하고 재리뷰·최종 head CI는 남겨 둔다.

- npm ci: 성공, 168 packages 설치, audit 0 vulnerabilities.
- 최종 서비스 없는 검사: build, check:deno(check/lint/fmt), check:boundaries, check:docs(문서 254개·스크립트 테스트 32개), git diff --check 성공. test:fast는 core 60개·handler 8개·web 1개 통과. build의 기존 큰 번들 경고는 남음.
- 독립 리뷰·제출·통합 CI·머지·배포·실클라이언트 검증: 아직 수행하지 않음.
- 메인이 공유 로컬 검증 exclusive 담당을 Entity 세션에 배정함. 원본 로컬 설정 3개만 worktree로 안전 복사했고 `supabase/.env`는 복사하지 않음. `2f17a2f`로 1차 코드를 고정한 뒤 migration up --local 성공(기존 DB reset 없음).
- 기존 Edge runtime의 primary source bind mount를 확인하고 해당 runtime 하나만 stop/rm한 뒤 worktree source의 functions serve로 교체함. fin 컨테이너는 변경하지 않음.
- 1차 실제 DB 69/70, fast 7/8: 신규 테스트 fixture가 Task.status 필수 컬럼을 누락한 오류와 sync MCP handler를 assertRejects에 직접 넘긴 검사 오류 각각 1건. fixture/검사 수정 뒤 실제 DB 70/70, HTTP 17/17, MCP 17/17 통과. DB security advisors도 이슈 없음.
- 실제 E2E: `b2923a0`에서 전체 53 passed / 9 skipped / 0 failed. Entity desktop/mobile 4개, 공통 360/390/768/1024/1440 폭·키보드·200% 확대·대비 검사가 통과함. 제외는 모바일 중복 검사 7개와 유료 Pinecone 명시적 opt-in 검사 2개다.
- E2E 실패는 run1 UI handler 구문 오류(수정 후 build), run2 consent가 primary 55480으로 이동한 로컬 harness 오류, run3 삭제 완료 전 부분 일치 heading을 찾던 테스트 race였다. 실제 OAuth authorize/PKCE/동의를 유지하면서 http localhost/127.0.0.1 consent 경로만 활성 앱 origin으로 표시하고, 정확한 목록 heading을 기다리게 수정함. 실패 자료는 `TEMP/entity-e2e-run1`~`run3`, 성공 자료는 `TEMP/entity-e2e-run4`에 보존했다.
- DB/HTTP/MCP 검증 뒤 변경은 UI·E2E harness·문서이며 서버/SQL 동작은 동일하다. 최종 제출 head의 통합 CI·독립 리뷰는 메인이 수행한다. 로컬 DB에는 migration up만 적용했고 테스트 자료는 운영 DB에 만들지 않았다.
- 최종 local-origin protocol 제한 후 Entity E2E 4/4 재통과. 검증 세션 종료 시 own functions serve와 해당 Edge runtime을 중지했으며 DB·fin·primary Vite 55480은 유지했다. primary runtime 자동 복구는 하지 않았고 exclusive 검증 담당을 메인에 반환했다.
- 최신 main `a59d58c`(플러그인 PR #74)로 rebase한 구현 head `f54256e`에서 build·fast(core 60/handler 8/web 1)·Deno·boundary·docs(텍스트 265개, 스크립트 36 passed/1 skipped) 통과. Windows 권한 부족으로 archive symlink 검사 1개가 명시적으로 제외됨. `node scripts/check-plugin.mjs`도 Entity 5개 도구와 제품 SKILL/server 정의 정합성 통과. 부모 티켓 링크는 해당 파일이 main에 포함된 뒤 메인이 연결한다.
