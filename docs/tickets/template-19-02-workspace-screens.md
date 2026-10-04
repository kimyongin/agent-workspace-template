# Template-19-02 — 탭 내부 검색·반응형 상세·메모와 변경 기록 화면

작성: 2026-10-04
상태: 화면 구현·격리 자동 검증 완료, 메인의 소스 통합·독립 리뷰·전체 E2E 대기
기준: main399b82b와 승인한 [Template-19](template-19-three-tab-release-ux.md)/[Template-20](template-20-current-principle-change-records.md)

## 목표와 소유

화면 세션은 src/components·src/features/entity/activity/principles/tags/search·해당 CSS/unit·e2e(탐색전용 제외)·공통 app.css의 모달 관련 절·디자인 정본의 목록/모달/폼/기록/원칙/태그 절·이 티켓을 소유한다. nav/App/Auth/settings와 모든 서버 contract 파일은 다른 세션 소유다. 공통 files는 해당 절만 수정하고 타인의 변경을 보존한다.

상단 등록·명시적 검색/지우기·추가조건/적용조건, 하단 목록의 보기/편집, URL 문맥 복귀를 통일한다. 할 일/기록은 활동의 내부 전환이다. 원칙은 current없음일때등록·현재본문편집, 과거본문/메모/시각 목록·정정/삭제를 보여주고 태그·active/inactive selector는 제거한다. 엔터티/활동 태그 선택과 관리 범위가 다르고 원칙에는 없다.

등록·보기·편집은640px미만전체화면/이상중앙40rem의 공통 shell, 확인28rem중앙, header/footer와본문스크롤분리, dirty/back/forward/reload/deeplink/focus/keyboard/safearea/긴내용을 검증한다. 현재 detail URLs는 유지한다. 보기→편집은 같은 shell 모드 전환이며 일반 폼 중첩을 만들지 않는다. 앱router 연결이 필요하면 nav소유자에게 요구한다.

편집 메모는 필수 입력, 생성/삭제 이유는 선택 입력이다. 전체업무입력+태그+메모를한번저장하고 unknownsave/versionconflict/getfailure 처리와중복요청키를 보존한다. 활동기록에 source/recordkind/change_note/대상/전후/삭제됨을 보여주며 종류별필터·검색을 제공한다. 자동기록도정정/삭제허용하되 systemfields는쓰기필드로 노출하지않는다. 원칙의 과거본문·활동메모를서로독립적으로잘못편집하지않는다.

정확한 새 serverendpoint/type는 서버소유자가 이 티켓/메인에게 먼저 인계한다. UI세션이 임의의 API를 만들어 가정하지 않는다. 기다리는동안 공통 shell과 CSS·mockfixture·기존 listcontext검토는 진행할 수 있다. 기존검색 route는호환용유지, 새검색은현재탭scope에서사용하며 엔터티keyword는그대로, 활동/원칙은키워드기본+자동옵션·서버실제필터를쓴다.

## 검증과 인계

explicit gpt-6.1-sol/high(여러 화면의 router/초안/저장/API교차경계). desktop의 새 생성과 기존 세션 재개 모두 전체 thread limit으로 거부되어 CLI0.160.0의 fresh 실행으로 전환했다. 실제 model/list8개를2026-10-04T09:06:42.608Z에 조회한 TEMP/template20-cli-models.json과 balanced/high assign preflight를 확인했다. explicit exec thread `01a1062b-6b2f-7dc2-a58b-b686e0acf113` 시작을 관측했다. 지원/명시 실행과 backend실제effort/비용은 구분하며 후자는미관측이다. worktreeunit/build/docs/boundaries·응답mockfixtures에서 모든자료 CRUD/메모·목록복귀·원칙최신삭제승격/마지막삭제빈상태·두태그혼용·초안보호·실패·긴/짧은제목/한글IME·320/360/390/639/640/768/1024/1440px·200%·keyboard를검증한다.

CLI와 메인의 인계는 저장소 밖 TEMP/template20-screens-inbox.md(계약/배정)·template20-screens-status.md(진행/요청)·template20-screens-final.md(완료)에서 전달하며 최종 필요한 증거는 이 티켓에 연결한다. CLI가 서버/탐색 세션의 코드를 직접 편집하지 않는다.

로컬사용자DB/finDB/reset/서비스시작은금지한다. 실제전체E2E/DBHTTPMCP는메인이격리환경·immutablehead와단독소유자를배정한다. 실패자료와검사한head를보존, 가이드/티켓·소스·검증을묶어cleancommit인계, 독립리뷰·정확CI·최신main머지는메인이조정한다. 운영배포하지않는다.

## 화면 세션 실행 기록 — 2026-10-04

실행 주체는 별도 CLI 화면 구현 세션이다. worktree는 `fin-ux-activity/agent-workspace-template`, branch는 `codex/three-tab-screens`, base는 `773e3652834b9b7a15999016858591ba6dd3794f`다. explicit gpt-6.1-sol/high와 오늘 사용자 제공 모델 preflight를 사용했고 모델 대체·자식 에이전트는 없었다. backend 실제 effort/실청구액은 미관측이다.

### 구현과 경계

- 공통 `DetailSurface`가 읽기·편집을 하나의 native dialog와 portal로 유지한다. 등록은 목록의 `create=1`, 편집은 기존 detail URL의 `edit=1`이다. 읽기에서 연 편집은 `edit_from=view`로 같은 history 항목의 모드만 바꾸며 취소·저장 뒤 읽기로 복귀한다. 행의 직접 편집은 목록으로 복귀한다. 엔터티 연결 작성은 detail URL의 `create=task|record`다.
- 640px 미만 전체 화면/이상 최대40rem, 확인28rem, 고정 header/footer·본문 스크롤·safe-area·visualViewport 높이를 공통화했다. 편집 재조회 중 읽기 surface와 초점 대상을 보존하고 최신 GET 뒤 editor를 연다.
- 엔터티 키워드 의미를 유지하고 각 탭의 명시 검색·별도 지우기·추가/적용 조건·보기/편집 행을 연결했다. 활동·과거 원칙 검색은 keyword 기본/auto 선택이며 실제 서버 조건을 보낸다. 기존 `/search`의 혼합 검색·목록 복귀를 유지하고 원칙 범위를 current/history/all로 표시한다.
- 엔터티·활동 태그를 분리했다. nav 세션에 `/tags/entity`, `/tags/activity` → `TagsPage` 연결을 요청했다. 기존 `/tags`는 activity 호환 경로다. 태그 이름 충돌/버전 충돌·불확정 생성/rename 확인·늦은 cursor 무시·저장 성공 뒤 조회 실패를 유지했다. 태그 사전 실패 재시도는 접힌 조건 밖에 표시한다.
- 계정 전체 current0~1, 현재 저장 새 ID, 과거 정정/삭제, 최신 삭제 승격 본문 확인/영향 조회 실패 시 취소·GET 재시도/삭제 금지, 마지막 삭제 빈 상태를 구현했다. 원칙에 태그/엔터티/상태 선택은 없다. 기록의 당시 본문 snapshot과 migration 캡처의 한계를 구분한다.
- 편집 메모1,000 Unicode 문자 필수, 생성/삭제 이유 선택, 반복 중단/재개 메모, 동일 uncertain 요청의 키 재사용/초안 고정과 폐기 뒤 새 작성·편집의 새 키를 적용했다. 작성 모드를 유지한 승인 URL 변경도 새 draft를 연다. 변경 기록은 출처·대상·행동·전후·삭제 문맥·메모를 표시하며 정정/삭제가 업무 상태를 되돌리지 않음을 알린다. 시스템 필드는 자동 기록 폼에 노출하거나 PATCH하지 않는다.
- server 세션의 외부 checkout `current-principle-server/agent-workspace-template/docs/tickets/template-20-01-server-contracts.md`와 실제 contract를 읽었다. 부모의 immutable 통합 head 배정은 이 세션 inbox에 아직 없다. 서버 source/type를 복사·cherry-pick하지 않았고 새 필드는 소유 화면의 구조 타입으로 한정했다. App/Navigation/Auth/settings·공통 CSS의 탐색 절·서버/contracts/migrations/plugins는 수정하지 않았다.

### 직접 실행한 검증

| 명령 | 결과와 범위 |
| --- | --- |
| `npm run test:web` | 7 files / 18 PASS |
| `npm run build` | 타입·Vite build PASS; 기존500kB chunk 권고 남음 |
| `npm run check:boundaries` | PASS |
| `npm run check:docs` | 문서/인코딩/링크·모델 설정 PASS, script48 PASS/Windows symlink 권한1 SKIP |
| `npx tsc -p e2e/workspace-screens.tsconfig.json --noEmit` | 실제 화면·격리 fixture strict 타입 PASS |
| `npx playwright test -c e2e/workspace-screens.config.ts` | 67 PASS(앞선 source); 실제 소유 feature/router, API 응답 mock |
| `npx playwright test -c e2e/entity-tags-fixtures.config.ts --grep-invert '실제 App'` | 16 PASS; desktop/mobile 비탐색 fixture |
| `npx playwright test -c e2e/workspace-screens.config.ts --grep 'forward 새 요청키\|복합 직접 링크\|엔터티 관련 작성'` | 4 PASS; 최종 추가 회귀 |
| `git diff --check` | PASS |

화면 fixture는 시작 전 listener를 확인한55580(Vite)/55581(가상 API, Playwright intercept)을 쓴다. 기존 태그 fixture는 별도55584/55585를 확인해 썼다. DB·Auth·서버 업무·실제 모델을 호출하지 않는다. 최종 추가 회귀를 포함한70개 화면 검사의 exact-head 결과·커밋 전체 SHA와 현재 남은 인계는 `TEMP/template20-screens-status.md`에 기록한다. 기존55480 listener와 root55421/fin54321 서비스를 변경하지 않았다.

자료 CRUD·메모·동일 요청키 재시도/폐기 뒤 새 요청키/연결 작성 forward 새 키와 복합 create/edit URL의 단일 폼·충돌 초안·확인된 저장 뒤 GET 실패·재조회만 재시도·원칙 새 ID/정정/승격/빈 상태·자동 기록 시스템 입력 제외/독립 삭제·scoped tags·IME·조건·busy POP/dirty back/forward/reload/deeplink·목록 cursor/anchor/scroll/focus를 검증했다. 320/360/390/639/640/768/1024/1440px의 모든 소비 화면과 긴/한 글자 제목, CSS200%와 축소 viewport, 긴 승격 본문 확인창을 검증했다. 스크린샷은 `e2e/test-results/workspace-screens`에 생성하고320px 태그/390px 엔터티 등 대표 자료를 직접 보았다.

초기 fixture 실패는 Vite HTML preamble, 저장 뒤 blocker 정리 시점, CSS zoom 높이, scoped 태그 cursor URL, 빠른 관련 폼 재개방, 과거 원칙 재진입 조회와 읽기 편집 초점 복귀와 연결 작성의 uncertain 폐기→forward 요청키에서 발생했다. source/fixture 원인을 고친 뒤 같은 검증을 재실행했다. 원래 assertion/timeout을 완화하지 않았다. 실패 자료는 ignored `test-results/screens-failures/screens-failure-run01..09`, `entity-tags-run01`, `activity-run01..03`에 보존했다. 같은 fixture config를 종료 전에 다시 실행한 한 번의 실수로 occupied-port 거부와 마지막 mobile trace ENOENT가 있었다. 이미 복사한 desktop 실패 자료는 남았고 이후 종료를 기다린 순차 재실행은 통과했다.

### 메인의 남은 통합과 검증

- immutable backend/type 및 navigation head 통합 후 위 검사와 전체 DB/HTTP/MCP/web E2E를 exact head에서 실행한다. 이 세션은 실제 DB 실행·운영 이관·서비스 시작·push/PR/merge/배포를 하지 않았다.
- 현재 원칙은 계정 전체 하나이므로 실제 principle/layout/search 통합 E2E는 격리된 계정을 단독 소유하고 desktop/mobile을 한 project씩 `--workers=1`로 실행한다. 공급자는 stub 또는 비용 없는 설정이며 `RUN_PINECONE_E2E`는 활성화하지 않는다.
- 통합 spec의 메모·current/history·snapshot·scoped tag·manual record 검색 가정을 갱신했다. `npx playwright test --list`는 이 checkout의 `.env.local` 부재로 수집 단계에서 ENOENT였다. Auth/support는 소유 경계 때문에 수정하지 않았다. 전체 e2e를 임시 확장 tsconfig로 검사했을 때 남은 오류는 기존 consent의 ES2023 `Promise.withResolvers`와 support의 dotenv nullable 타입5곳이다. 소유 fixture 타입 검사는 별도로 통과했다.
- `e2e/entity-tags-fixtures.spec.ts`의 중간3개 “실제 App…” 탐색/Auth 테스트는 nav 소유자에게 인계했다. 기존 inline 태그 editor 뒤 탐색 클릭, `/tags`와 작성 query 없는 URL 기대를 새 native surface와 scoped route에 맞춰야 한다. 해당 테스트 본문은 수정하지 않았다.
- 실제 휴대전화 소프트웨어 키보드·safe-area·화면 읽기 도구와 실제 브라우저200% zoom은 확인하지 않았다. 자동 viewport/CSS 확대·키보드 조작 증거와 구분하며 최종 독립 리뷰/CI/최신 main/실환경 확인은 메인이 담당한다.


### 부모 immutable 통합·격리 실환경 인계 수신

부모 inbox가 화면 단독 검증 뒤 도착했다. own head `aa452566a1cde317ceb19978026327f0d5430c0a`에서70 screen/16 desktop·mobile/18 unit·build/docs/boundaries/strict fixture TS가 통과했다. 부모가 지정한 backend `8af1be0`+`7b18c4261391dd982d6b9f5914b1eef73ad1889a`와 nav `f4f7c31`/`952cccb`/`9e2c397`/`e00ea0e`/`25ee7dc45c48a2d2c2a0e0deac68f0eecf926fbc`를 순서대로 cherry-pick했다. 충돌은 없고 nav/modal CSS와 E2E 부분 변경을 함께 보존했다. source 결과 타입은 이제 canonical contract 별칭으로 바꿨다. scope 필수 tag 단위 fixture를 맞췄고 build가 통과했다.

부모가 App의 태그 경로 통합만 추가 배정했다. `/tags/:scope/:id`를 연결하고 scope param을 읽으며 legacy `/tags/:id`와 scoped detail/edit를 query shell로 canonical redirect한다. 다른 App/Auth/nav 동작은 수정하지 않았다. 새 직접 링크 fixture1 PASS다. 실패 원인은 fixture의 활동 설명 문자열 오기였고 screenshot/trace를 `screens-failure-run10`에 보존했다.

부모가 API56421/DB56422/pooler56429의 `template20server` 단독 환경 lease를 넘겼다. 외부 private environment-handoff의 runtime/config와 Docker project를 먼저 확인했고56680 listener 없음도 확인했다. private Auth site/redirect와 Edge CORS만56680으로 바꿨다. private runtime에 한정한 stop/start로 DB volume을 보존했고 reset·이관·공유 root/fin 변경은 없다. 이전 serve PID28896은 functions serve와 private runtime 경로를 다시 검증해 종료했고 같은 immutable runtime source로 새 serve를 시작했다. 비밀값을 출력하지 않고 공급받은 env를 ignored `.env.local`에 복사했다. 별도 `e2e/workspace-integration.config.ts`가 strict Vite56680/reuse=false/한 worker와 desktop·mobile project를 사용한다. 실제 모델 검사는 opt-in을 켜지 않는다.

통합 nav/Auth mock19 PASS. nav 소유 실제 App 태그 fixture는 native dialog의 배경 inert와 새 작성 query를 아직 반영하지 못해 부모에게 source/trace/요청을 status로 보냈다. 소유하지 않은 nav/Auth 테스트 본문은 고치지 않는다. 실제 전체 E2E는 이 lease에서 실행 중이며 부모 backend/nav 추가 수정 immutable delta와 최종 실환경·exact-head 결과는 status에 갱신한다. 앞 절의 inbox/env 부재 한계는 이 새 인계로 해소됐다. 독립 리뷰·CI·최종 머지는 계속 부모 책임이다.
