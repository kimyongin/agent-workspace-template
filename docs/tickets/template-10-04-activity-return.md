# Template-10-04 — 활동 목록 왕복 복원과 접근성 검증

작성: 2026-10-04
상태: 진행 중
검토 기준: `46f4cbef3c8098626647055ec741463eb1aa3066`
선행: [Template-10](template-10-priority-completion.md)의 승인 범위, Entity 변경은 통합 시 반영

## 목표와 기준 문서

할 일·기록 목록의 추가 페이지에서 상세·편집·삭제를 거쳐 돌아오면 필터·펼친 페이지·스크롤·초점을 보존한다. 기존 [T02-4](template-02-implementation-base.md#t02-4--단일-예제-엔터티화면플러그인)와 [디자인 가이드](../design/guide.md)·[교차 검증](../development/workflow.md#기능-계약과-교차-검증)의 구현이다. PRD/ADR 변경 없이 수행하며 Entity 계약·모델 정책·배포 자동화·T02-5/6은 변경하지 않는다.

## 작업과 완료 조건

- [x] 할 일·기록 목록의 URL 필터와 추가 페이지 범위·대상 anchor·스크롤을 상세 왕복 및 브라우저 뒤로 가기·새로고침에서 복원한다.
- [x] 상세 편집 저장/취소·삭제 후에도 목록 문맥을 유지하고 대상 삭제/필터 이탈이면 유효한 초점으로 복귀한다.
- [x] 복원 중 필터 전환·이탈 뒤 늦은 응답을 버리고 조회 실패·종료 cursor에서 무한 복원을 막는다.
- [x] 360/390/768/1024/1440px, 긴 값, 빈/오류 상태·키보드·초점·확대/대비의 가능한 검증을 기록한다.
- [ ] Entity worker의 `entity_id` 목록/상세 연결과 함께 최신 main에서 통합한다.

## PR 분할 계획

| 순서 | 브랜치 | 결과 | 기준 |
| --- | --- | --- | --- |
| 1 | `codex/activity-return` | 두 활동 목록의 복원과 소비 상세·브라우저 회귀 | 디자인·workflow |

## 검증

서비스 없는 웹 검사와 Deno·경계·build·문서 검사를 수행한다. 변경 화면의 브라우저 회귀와 공통 변경 시 전체 E2E는 main이 배정한 한 공유 환경 담당 또는 격리 CI에서 수행한다. 브라우저 viewport/확대 모사와 실제 OS 확대·실기기·스크린리더의 검증을 구분한다.

## 구현 인계와 완료 기록

위 base의 별도 activity-return worktree와 `codex/activity-return` branch에서 아래 구현 세션이 오프라인 구현·검사를 맡았다. 다른 worker의 Entity/shared bootstrap·제품 패키지 변경을 보존한다. 상세 복귀는 기존 search 복귀가 우선이며 내부 목록 경로만 허용한다. 새 mount는 첫 페이지부터 최신 원본을 조회하며 서버 cursor 계약은 유지한다. Entity 머지 main 반영과 실제 브라우저 검증은 아직 남아 있다.

### 배정과 오프라인 구현 snapshot

- 담당: `/root/implement_fast_knowledge`가 앞 fast 검사 작업을 끝낸 뒤 같은 설정으로 재개했다. 소유는 활동 TasksPage/RecordsPage/TaskDetailPage/RecordDetailPage, 새 `list-state.ts`·`useActivityList.ts`·`list-state.test.ts`·`e2e/activity-return.spec.ts`와 이 티켓이다. 별도 `activity-return` worktree에서 branch `codex/activity-return`, 위 base로 시작했고 미커밋 변경은 메인이 작성한 이 계획 하나였다. 기존 fast-knowledge의 최종 커밋은 수정하지 않는다.
- 모델·강도: desktop balanced `gpt-6.1-sol`/medium. 일반적인 확정 UI 복원 계약이라 균형 모델과 medium을 유지한다. 메인이 같은날 actual desktop tool catalog snapshot/preflight 통과를 인계했다. backend 실제 모델/effort·개별 비용은 미노출이며 명시 배정과 구분한다.
- 실행 환경: 공유 Supabase·DB·함수·웹 서버는 Entity 구현 세션이 독점한다. 이 단계에서는 서비스 실행/환경 변경/DB/E2E를 수행하지 않는다. Entity 머지 main을 반영한 뒤 메인의 공유 환경 배정으로 실제 브라우저 회귀·viewport/키보드·확대 검사를 수행한다.
- 구현: 목록 URL의 필터·pages·scroll·hash를 상세의 내부 `list` 복귀 값에 넣고 브라우저 history의 원래 목록 entry도 갱신한다. 기존 검색 복귀가 우선이며 같은 종류의 `/tasks` 또는 `/records`만 목록 복귀로 허용한다. 추가 페이지 뒤 상세 편집은 이 URL을 그대로 유지하고 삭제도 같은 목록으로 복귀한다.
- 조회: 새 목록 mount/새로고침은 첫 페이지부터 최신 원본을 조회한다. 같은 mount의 더 보기만 합쳐진 범위를 재사용하며 ID 중복을 제거한다. 재진입에 raw 항목 cache를 사용하지 않는다. 연속 재조회는 서버 끝 cursor·조회 오류·반복 cursor·화면 이탈/필터 교체에서 종료한다. 복원 pages는 최대 250, 동시 추가로 밀린 anchor는 저장 범위 뒤 최대 5페이지만 추가 탐색하며 전체 250페이지 상한을 넘지 않는다. 못 찾으면 제목으로 초점을 돌리고 더 보기는 사용자의 명시 조작으로 계속할 수 있다. 못 찾은 anchor 때문에 추가 조회 범위를 URL에 자동 확장해 재시작하지 않는다.
- 초점: 조회가 끝난 뒤 행 link를 초점 대상으로 삼고 저장 scroll을 적용한다. 대상 삭제·필터 이탈·오류로 행이 없으면 focus 가능한 목록 제목을 화면 안으로 복귀시킨다. 더 보기의 자동 갱신은 기존 초점을 다시 빼앗지 않는다. 필터 변경은 pages/scroll/hash를 지우며 새로운 필터의 응답만 적용한다.
- 테스트 자료: 새 브라우저 검사는 실행별 태그로 목록을 격리하며 이 실행이 만든 기록/할 일과 태그만 정리한다. 실제 MCP·DB를 쓰는 회귀는 아직 미실행이다. 순수 helper 테스트는 페이지 replay·동시 추가·없어진 anchor·부분 실패·늦은 응답·반복 cursor·명시 상한·내부 복귀 경로를 검사하며 실제 DOM focus/브라우저 증거가 아니다.

| 시점·사건 / 담당 | 직접 실행·확인 | 결과·미확인 / 다음 행동 |
| --- | --- | --- |
| 배정·설치 / 구현 세션 | checkout·AGENTS·개발 skill·START-HERE·자식 계획·workflow·디자인/시각/상호작용·기존 search 복원·activity/API/실제 package 확인, `npm ci` | 168 packages·audit 0 vulnerabilities. Entity 변경과 겹치는 activity 파일은 별도 checkout에서만 편집하며 통합은 Entity 머지 뒤 수행 |
| 오프라인 구현·빠른 검사 / 구현 세션 | `npm run test:fast` | base의 core 59·adapter fast 6·web 6=71 tests 통과. 웹 6개 중 새 helper 5개. 브라우저 두 목록 왕복 회귀 작성만 완료, 실제 실행 없음 |
| 정적 검사 / 구현 세션 | `check:deno`, `check:boundaries`, `build`, `git diff --check` | Deno 타입·lint·fmt 77/81 files와 경계·diff 통과. 최종 웹 타입/build 통과(423 modules·기존 큰 chunk 경고 유지). 새 파일 formatter 적용 후 web/build 재통과 |
| 문서 의존성 검사 / 구현 세션 | `npm run check:docs` | 부모 계획의 `template-10-priority-completion.md` 상대 링크가 이 base에 아직 없어 1건 실패(241 text files). PR #75의 최신 main 통합 뒤 다시 검사할 의존성이다. 부모 티켓을 복제하지 않는다 |
| 작성한 E2E의 별도 정적 검사 / 구현 세션 | `npx tsc --ignoreConfig --noEmit --target es2022 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --skipLibCheck --types node --strict false e2e/activity-return.spec.ts` | 통과. 처음 TS7의 명시 파일/설정 선택 오류와 기존 support의 Node 타입·환경값 strict 오류를 확인해 별도 명령 인자를 맞췄다. 런타임·브라우저·인증 성공 증거가 아니며 기존 shared support는 수정하지 않음 |

다음은 Entity 머지 revision 반영·필터 `entity_id` 연결 보존, 문서 링크 검사, 배정받은 공유 환경에서 실제 변경 E2E와 전체 회귀·디자인 체크리스트 검증이다. 그 뒤 정확한 최종 head의 독립 리뷰·CI·머지를 메인이 확인한다. 위 체크박스는 실제 브라우저 검증까지 마치기 전 완료로 표시하지 않는다.

### 첫 독립 리뷰 수정 — 추가 조회 실패 재시도

- 메인이 `origin/main`의 `db70cbf`를 반영한 검토 head는 `a288ad0464fd1038d1b2472b2ff3454713926ca4`였다. 독립 리뷰는 P2 한 건을 보고했다. `useActivityList.retry`가 추가 페이지 조회 실패에도 누적 값을 비워 첫 페이지를 다시 읽어 [목록 실패 재시도 기준](../design/ui-patterns.md#필터와-목록)에 어긋났다. PRD/ADR 이탈이나 다른 차단 발견은 보고되지 않았다.
- 같은 구현 세션을 desktop `gpt-6.1-sol`/medium으로 재개했다. 메인이 당일 preflight PASS와 동일 설정을 인계했으며 backend 실행 metadata는 여전히 미노출이다. 공유 서비스는 Entity 담당이 독점하므로 오프라인 수정·검사만 수행했다.
- 수정은 추가 조회에서 실패한 scope/cursor를 기억하고 같은 조건의 재시도에서 해당 cursor의 `more`를 다시 실행한다. 누적 항목·cursor·복원 초점 표시를 초기화하지 않는다. 최초 조회/전체 복원 재시도의 기존 첫 페이지 재조회는 유지하며 필터 변경은 실패 정보를 폐기한다.
- 두 목록의 실제 E2E에 첫 cursor 요청의 503 실패와 지연시킨 재시도를 넣었다. 재시도가 첫 페이지를 읽지 않고 동일 cursor를 요청하며 응답 대기 중 기존 20행·스크롤·행 초점, 성공 후 22행·행 초점을 유지하는지 검사한다. 네트워크 실패만 브라우저 route로 주입하고 성공 응답·자료 생성/정리는 실제 서비스에 맡긴다. 현재는 작성·타입 검사만 통과했으며 공유 환경 해제 후 실제 실행해야 한다.
- 직접 재검사: `test:fast` core 59 + adapter 11 + web 6 = 76 통과, `build` 423 modules 통과(기존 큰 chunk 경고), `check:deno` 78/82 files 통과, `check:boundaries`·`git diff --check` 통과, `check:docs` 255 text files·36 pass/1 Windows symlink 권한 skip 통과, 위 E2E 별도 타입 검사 통과. 최신 main 반영으로 이전 부모 상대 링크 실패는 해결됐다. Entity 최종 검색/filter 수정은 아직 미머지이며 실제 E2E·화면 폭/키보드/접근성/확대 검증은 미실행이다.

### Entity 후보 통합과 첫 실제 브라우저 검증

- 메인은 검증을 마친 Entity 후보 `cba11dd1892f2c0a5848903201c927077aecf76c`(base `09851bb`)로 rebase를 시작하고 공유 로컬 환경을 이 구현 세션에 단독 배정했다. 소유 활동 4파일의 충돌은 Entity picker·`entity_id` 필터·상세 연결과 기존 search 복귀를 보존하고 목록 helper/복귀 값을 함께 적용해 해결했다. Task 직접 상세 fallback도 kind/status/tag/entity를 보존한다. rebase 후 head `aeddd0fa502f6b1abb9733c8656a0bbba470e8bd`에서 첫 실제 검사를 시작했다. Entity는 아직 독립 재리뷰/CI/머지 전이며 최종 squash main의 Git 정리는 메인이 담당한다.
- 환경은 공유 로컬 DB/SQL·backend 후보를 고정하고 `npm run serve:functions`와 `npm run dev -- --port 55482`를 이 worktree에서 실행했다. primary 앱 55480·fin·기존 DB/자료를 유지했고 reset/운영 접근은 하지 않았다. primary의 로컬 env/signing key를 이 checkout의 ignored 경로에 복사했다. 첫 functions 실행은 signing key 파일 누락으로 종료했으며 기존 로컬 파일을 복사한 뒤 정상 실행했다. OAuth helper의 loopback consent를 own 앱 origin으로 연결하는 실제 등록/PKCE 동의 경로를 보존했다.
- 초기 활동 4개는 모두 재시도 시작 시 scroll 122px 이동으로 실패했다. 첫 head의 `test-results/activity-first/**/trace.zip`·`error-context.md`를 보존했다. 누적 행을 비우지는 않았지만 오류 안내를 바로 제거해 문서 높이가 줄었던 원인이므로 `more`의 오류 안내는 성공 응답까지 유지하게 했다. 다음 `activity-retry`는 이 scroll 검사를 통과한 뒤 테스트의 `.last()` locator가 새 append 행을 가리키는 문제를 확인했다. 테스트가 동일 row ID를 유지하게 수정했다. 두 실행의 실패 자료를 성공 실행 디렉터리로 덮지 않았다.
- 수정·Entity 문맥 회귀를 커밋한 정확한 source head는 `8ddd4b4395d57c91bca083a431b2612c91aef18b`이다. 실행마다 생성한 own tag/entity로 격리한 22행→상세 중 21행 추가→43행 복원, Entity filter/상세 link, 편집 저장/취소, 삭제, entity 연결 해제에 따른 조건 이탈, hash/pages/scroll 해제를 검사했다. own 활동·태그·Entity만 `finally`에서 정리했다. 503과 지연 응답만 route로 주입하며 정상 HTTP·MCP·DB·OAuth는 실제 경계를 실행했다.
- ignored `test-results/activity-integrated.config.ts`는 기존 Playwright 설정을 가져오고 baseURL `http://127.0.0.1:55482`, webServer 없이 `outputDir=activity-integrated`로 지정한다. `npx playwright test -c test-results/activity-integrated.config.ts e2e/activity-return.spec.ts --workers=1`: desktop/mobile 활동 4 PASS(43.8s). 같은 source head에서 `activity-full.config.ts`·`outputDir=activity-full`로 전체 실행: 70개 중 61 PASS/9 skip(4.6m), Entity 8 포함. skip은 두 실제 의미모델 opt-in 검사와 desktop에서 수행한 폭/키보드 검사의 mobile 중복 7개다. 양쪽 `.last-run.json`은 PASS이고 실패 artifact는 별도 경로에 남았다.
- 전체 E2E는 태그 조건 전환 뒤 늦은 more 응답 격리, 실제 원문/활동/원칙 CRUD·권한·OAuth 회귀를 포함한다. `layout.spec.ts`의 360/390/768/1024/1440px 목록·상세·작성, 긴 공백 없는 제목과 긴 요약, 가로 넘침·44px 조작 영역, 640x400 CSS viewport의 200% 확대 모사·16px root 글자, 키보드 Enter/Tab/Escape·모달 초점/초안 보호, CSS 대비 검사도 직접 PASS를 확인했다. 빈 상태와 503 오류/재시도는 활동 회귀에서 실제 렌더링했다. 자동 Chromium viewport·CSS 폭 모사이며 실제 OS 확대·실기기·스크린리더 접근은 없었다. 스크린리더 동작과 실기기 터치 완료로 주장하지 않는다.
- 같은 source head의 직접 오프라인 검사: fast core 60+adapter 13+web 6=79, Deno 89/93 files, build 428 modules(기존 큰 chunk 경고), boundaries·diff 통과. docs 303 text files(보존한 로컬 artifact 포함)·36 pass/1 Windows symlink 권한 skip 통과. 실제 서비스 회귀와 모의/pure 검사 증거를 구분한다.
- 남은 의존성: Entity 후보 독립 리뷰의 manual 250→251 페이지 경계 수정·재리뷰/CI/머지 및 최종 main 반영. 활동에도 동일한 clamp 경계의 재조회 가능성을 발견해 메인에 보고했다. 현재 성공 head/자료를 보존하고 추가 회귀·좁은 수정과 새 Entity 후보 반영 후 필요한 실제 검사를 반복한다. 최종 head 독립 리뷰·CI·머지는 아직 완료가 아니다.

### 수동 페이지 경계와 새 Entity 후보의 통합 재검증

- 활동의 수동 251페이지 성공 뒤 URL 복원 범위가 250으로 clamp되어 기존 251페이지를 버릴 수 있는 같은 결함을 수정했다. 같은 mount의 누적 범위 비교에는 자동 복원 상한을 적용해 이미 펼친 수동 페이지를 재사용한다. 사용자의 수동 more는 현재 cursor부터 251·252로 이어지고 새 mount/새로고침은 첫 페이지부터 최대 250페이지만 자동 조회한다. 서버 cursor 계약과 필터 변경 시 fresh read는 유지한다.
- 두 목록×두 프로젝트의 새 boundary E2E는 한 행씩 250개 페이지를 route로 제공하고, 251번째 요청 실패 뒤 동일 cursor 재시도·250행 보존·251/252행 append·원래 행 초점·첫 페이지 재조회 없음·reload 250회 상한을 검사한다. 이 검사는 실제 브라우저/hook/HTTP 클라이언트를 실행하지만 목록 페이지 응답은 모의이며 5000개 DB 원문 자료나 실제 cursor 증거로 주장하지 않는다. 최초 `ec9c4f3` 검사에서는 할 일 2 PASS, 기록 2는 250회 순차 렌더링이 기본 5초 assertion 대기를 넘겨 실패했다(185/186행까지 진행). `test-results/activity-boundary` 자료를 보존하고, 두 자동 복원 count assertion만 20초로 맞췄다. timeout으로 실제 조회 상한을 늘리지 않았다.
- 메인의 새 Entity 후보 `8a7c5034f8b2c1fca83ba74b010f67ccf551d74e` 배정과 동일 medium preflight PASS를 받아 own functions/Vite를 먼저 정지한 뒤 rebase했다. 새 frozen 통합 source head는 `6f396d2fbd212813c433211bde4db05ecf87ea87`이다. Entity는 별도 owner 소유이므로 통합 검증에서 그 코드를 수정하지 않았다.
- standalone 증거를 분리하려고 exact `8a7c503` detached checkout `C:/Users/yongin/.codex/worktrees/activity-entity-boundary/agent-workspace-template`에서 `npm ci`(168 packages·audit 0), own Vite 55483을 사용했다. `npx playwright test -c test-results/entity-8a.config.ts e2e/entities.spec.ts --grep "자동 복원 250" --workers=1`: Entity 새 boundary desktop/mobile 2 PASS(10.9s). config는 baseURL 55483·webServer 없음, outputDir `test-results/entity-8a-boundary`이며 그 `.last-run.json`은 PASS다. 활동 통합 결과와 구분한 exact Entity head의 결과다.
- standalone Vite를 정지하고 frozen 통합 checkout의 own Vite 55482로 전환했다. `npx playwright test -c test-results/activity-final-targeted.config.ts e2e/activity-return.spec.ts e2e/entities.spec.ts --workers=1`: 18개 중 16 PASS/2 FAIL(2.6m). 활동 8개와 Entity 새 boundary 2개는 모두 PASS지만 기존 Entity lookahead→more의 desktop/mobile 두 개가 동일 cursor 두 요청을 받았다. 정확한 assertion은 `e2e/entities.spec.ts:218`의 요청 길이 1 기대/2 실제다. outputDir `test-results/activity-final-targeted`의 두 `entities-Entity-lookahead--d1d0e-append·실패-retry·행과-버튼-초점-보존-{desktop,mobile}`에 trace/error-context를 보존했다. trace network 요약에서도 동일 cursor 두 응답 모두 200을 확인했다. header/token은 증거 요약에 출력하지 않았다.
- 메인에 소스 원인 후보(동일 조작의 `setManualPage`와 URL pages 변경을 모두 effect dependency로 읽어 같은 cursor 요청을 다시 시작함)를 보고했고 Entity owner의 별도 오프라인 수정으로 인계했다. standalone exact `8a7c503`에서도 `npx playwright test -c test-results/entity-8a-lookahead.config.ts e2e/entities.spec.ts --grep "lookahead" --workers=1`로 기존 회귀를 한 번씩 실행해 양쪽 2 FAIL(6.9s/6.3s)을 재현했다. outputDir `test-results/entity-8a-lookahead`와 두 trace/error-context·FAILED `.last-run.json`을 보존했다. 활동 통합에서 생긴 문제가 아니라 Entity 후보 자체의 회귀로 구분된다. 앞 새 boundary PASS artifact를 덮지 않았다.
- 새 통합 head의 build 428 modules·web 6, fast 60+13+6=79, Deno 89/93, boundaries, E2E 별도 타입, diff 통과. docs 303 text files·36 pass/1 Windows symlink 권한 skip 통과. Entity의 알려진 실패를 반복할 전체 76개 실행은 메인과 합의해 보류했다. 이전 `8ddd4b4`의 전체 61 PASS/9 skip을 이 새 head의 전체 성공 증거로 재사용하지 않는다.
- 재현 종료 후 own Vite 55482/55483과 own functions CLI를 모두 정지했다. 기존 listener 55480과 로컬 DB/API 55421을 확인했고 DB/primary/fin·기존 자료를 유지했다. standalone checkout과 ignored artifact는 재리뷰 증거를 위해 보존한다. 메인에 환경 반환 가능 상태를 보고했으며 다음은 Entity 수정·독립 리뷰 뒤 새 exact 통합 head의 영향/전체 E2E 배정이다. 최종 main 정리·새 head 독립 리뷰·CI·머지는 남아 있다.
