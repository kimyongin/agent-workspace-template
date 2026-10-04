# Template-18-03 — 활동 목록과 문서형 읽기

작성: 2026-10-04
상태: 진행 중(구현·격리 화면 검증 완료, 공유 통합·독립 리뷰·CI 대기)
검토 기준: `745130148c90de842d7617c232194b653d1c638b`

## 목표와 승인 범위

[상위 티켓](template-18-fin-ux-adaptation.md#확정-범위와-구현-티켓)의 사용자 승인 범위. [PRD](../product/concept.md), [상호작용](../design/ui-patterns.md), [시각 규격](../design/visual-spec.md)을 따른다. 서버·DB·MCP·검색 의미와 Entity는 유지한다.

## 작업과 완료 조건

- [x] 기록을 업무 시간대 날짜별로 묶고 동일 날짜 페이지 병합·중복 제거·접힘/복귀 유지. 검색/할 일에는 날짜 그룹 강제하지 않음.
- [x] 활동/원칙 목록의 제목 선택·복사와 명시적 보기·편집 제공. 실제 이동 링크·대상별 접근성 이름. 직접 편집 취소/저장 후 진입 문맥 복귀.
- [x] 활동/원칙 상세를 제목→요약→필요 메타→본문→관련 대상으로 정리. 현재 원칙 연결은 당시 원칙 snapshot을 뜻하지 않음.
- [x] 작성 필드 순서 정돈, 상시 필터 구획과 해제 제공. 기존 필드 검증·완료·중단·재개·멱등성·버전 충돌 유지.
- [x] 저장 성공 뒤 재조회 실패는 저장 실패와 구분하고 조회만 재시도. 늦은 조회가 초안 덮어쓰지 않음.
- [x] 페이지 추가→상세→편집/취소→복귀, 날짜 접기, 검색 원문 복귀, 오류·dirty·모달 키보드 회귀 검증.

## PR 분할과 담당

PR 하나 `codex/fin-ux-activity`. activity 세션이 activity/principles feature, 필요한 공통 읽기·태그 표시/선택 표현과 회귀를 소유한다. App/global CSS/TagsPage/EntityDetail은 다른 담당이다. 스타일은 별도 feature CSS로 작성해 전역 동시 편집을 피한다. 선행18-02의 목록 삽입 변경은 메인 통합 후 보존한다. 공유 통합 환경은 순차 담당 배정을 기다리고 unit/build는 독립 실행한다.

## 구현 인계와 실행 기록

배정 worktree·branch/base/head·모델·명령/결과·미검증 기록 후 독립 리뷰와 정확한 head CI가 필요하다. 배포 제외. 실제 휴대폰·스크린리더는 기존 검수 제외 범위 유지.

### activity 구현 세션 — 2026-10-04

- 실행 주체: 배정된 activity 서브세션. 작업 위치 `C:/Users/yongin/.codex/worktrees/fin-ux-activity/agent-workspace-template`, branch `codex/fin-ux-activity`, 최초 base `8e5b11c`. 사용자 개발 승인 범위에서 실행했으며 운영 배포는 수행하지 않았다.
- 모델: 본 세션이 명시 배정한 `gpt-6.1-sol / medium`(balanced). `npm ci` 성공 후 `node scripts/agent-models.mjs assign --client codex-desktop --tier balanced --effort medium --role implement --reason activity-reading-implementation --snapshot C:/Users/yongin/AppData/Local/Temp/template-18-desktop-models.json` 통과. 관측 시각 `2026-10-04T05:37:29Z`; backend 실제 effort·실청구액은 미관측이다.
- 최초 구현 커밋 `8c411483c88b45c386890f095af86df223e6645f`을 navigation의 `ee4ca9b90c666bcb999e3548eff1ec8055fcfdd7` 위로 rebase했다. 통합 구현 head `43438a6f6d4dec4aae8d71d21366d1d30acf1660`에서 할 일/기록의 ActivityTabs 삽입을 보존했다. 이 기록과 상호작용 가이드만 후속 문서 커밋에 포함한다.

### 구현 계약과 근거

- 기록에는 저장된 시간대 필드가 없다. 기존 `formatDateTime`·기록 datetime-local 입력과 같은 브라우저 시간대를 그룹 기준으로 사용하고 목록에 기준을 명시했다. 연결된 반복 할 일의 시간대를 기록 그룹에 적용하지 않는다. 시간대·자정 경계와 서버 순서 보존은 `timeline.test.ts`에서 검사한다.
- 페이지 항목은 ID로 중복 제거하고 날짜 그룹에 합친다. 접힘은 `collapsed` URL 조건에 보존하되 조회 조건에서 제외한다. 기존 페이지 복원·실패 구간 재시도·anchor 탐색 한도를 원칙 목록에도 재사용했다.
- 제목 링크와 선택·복사를 유지하면서 대상 이름을 포함하는 별도 보기·편집 링크를 제공했다. 직접 편집은 기존 상세 URL의 `edit=1` 상태로 연다. 목록에서 직접 편집하면 취소·저장 뒤 목록으로, 상세에서 연 편집이면 상세로 복귀한다. 의도된 이동은 편집 영역 제거 이후 effect에서 실행한다.
- 활동·원칙의 읽기와 작성 순서를 [상호작용 가이드](../design/ui-patterns.md)와 함께 맞췄다. 기록의 현재 원칙 연결이 당시 snapshot이 아니라는 문구는 보존했다. 필터는 상시 보이고 적용 조건 해제를 제공한다.
- 태그 선택은 ID를 유지하고 이름 변경·삭제 상태를 표시한다. 읽기 태그는 비조작 칩으로 표시하며 목록마다 한 조회를 공유하는 scope-local provider를 사용해 행별 중복 조회와 소유자 간 전역 캐시를 피했다.
- Task PATCH 결과의 저장값·버전을 먼저 반영하고 후속 조회 실패를 저장 완료와 구분한다. 조회 재시도는 GET만 실행한다. 활동 상세 조회는 generation으로 오래된 응답을 무시하고 편집 초안은 최초 값 snapshot과 함께 유지한다. 서버·DB·MCP·검색·Entity schema와 검증·멱등성 계약은 변경하지 않았다.

### 로컬 검증

통합 구현 head `43438a6f6d4dec4aae8d71d21366d1d30acf1660`과 상호작용 문서 변경만 있는 상태에서 실행했다.

| 명령 | 결과와 범위 |
| --- | --- |
| `npm run test:web` | 4 파일·12 테스트 PASS. 기록 날짜의 Seoul 자정/Los Angeles 경계·정렬·같은 날짜 병합·중복 제거·접힘 scope/복귀와 기존 bounded 목록 복원 포함 |
| `npm run build` | 타입 검사·Vite build PASS. 기존 번들 크기 경고는 남음 |
| `npm run check:docs` | 텍스트 360개와 모델/native 정합성 PASS; 검사기 48 PASS·Windows symlink 권한에 따른 기존 1 SKIP |
| `npm run check:boundaries` / `git diff --check` | PASS |
| `npx playwright test --config playwright.activity.config.ts` | 격리 route fixture desktop/mobile 총 10 PASS. 55483 전용 Vite·모의 HTTP 응답으로 실행하며 DB·Auth·MCP·공유 함수 서버를 사용하지 않음 |

격리 브라우저는 같은 날짜의 페이지 병합/중복 제거·날짜 접힘 왕복, 직접 편집 취소/저장 후 anchor 초점, 상세 편집 취소 후 읽기, PATCH409 초안·Escape·확인 취소 초점, 저장 뒤 GET503 구분/GET만 재시도, 원칙 추가 페이지 복귀를 검사했다. 360/390/768/1024/1440px의 긴 제목·태그 가로 넘침 없음·보기/편집 최소44px·키보드 Enter와 작성 필드 순서를 검사하고 390px 목록·360px 편집 PNG를 직접 확인했다. fixture는 기본 실제 E2E에 섞이지 않도록 `activity.fixture.ts`와 별도 config로 관리한다.

초기 fixture 실패는 CSS pseudo-element가 날짜 버튼 이름에 포함된 점과 필수 label/확인 dialog의 기존 접근성 이름을 잘못 가정한 검사 오류였다. 날짜 버튼의 명시적 접근성 이름과 실제 필수 textbox·확인 dialog 이름으로 수정했으며 timeout을 늘리지 않았다. 첫/두 번째 실패의 trace·error-context는 저장소 밖 `C:/Users/yongin/AppData/Local/Temp/template18-activity-fixture-first-failure`·`template18-activity-fixture-second-failure`에 보존했다.

### 남은 검증과 인계

- 실제 DB·HTTP·MCP·전체 E2E와 검색 원문 복귀, 완료/반복 회차·브라우저 뒤로가기/새로고침 회귀는 아래 최종 `c5f24c1` 실행 기록을 따른다. 격리 fixture의 추가 경계 검사와 실제 전체 E2E는 별도 근거다.
- shared ModalShell의 dirty/busy route guard는 entity-tags 담당 전용 커밋을 받아 즉시 소비하는 활동 폼과 함께 통합·검증했다. 일반 닫기와 route-discard는 분리한다.
- 하단 탐색·대표 viewport·200% 확대·누름 영역·키보드·대비·초점 회귀는 실제 전체 E2E가 통과했다. 실제 휴대폰·스크린리더는 상위 티켓의 제외 범위를 유지한다.
- 독립 리뷰·정확한 최종 head CI·PR/머지는 메인이 조정한다. 운영 배포는 제외한다.

### 첫 실제 전체 E2E와 수정 — 2026-10-04

- 메인의 공유 환경 순차 배정으로 root `C:/Users/yongin/projects/agent-workspace-template`의 detached `85cb4ee6f860380a104e2d3bdfb40ef083261d92`에서 `npm run test:e2e`를 실행했다. 전후 checkout은 같은 SHA·clean이고 setup/reset·추적 파일 수정·서비스 재시작은 하지 않았다. 기존 55480 Vite·55421 로컬 Auth/API/DB를 사용했다.
- 결과: 80개 중 59 PASS·9 기존 SKIP·12 FAIL, 3.7분. 실제 검색 원문 복귀·작성/완료·반복 회차·원칙 충돌/초안·대표 viewport·200% 확대·대비·키보드와 다른 사용자 거부 흐름은 통과했지만 전체 회귀 통과로 표시하지 않는다.
- 실패 분류: 데스크톱/모바일의 할 일·기록 목록 4건은 태그 이름 로딩의 paragraph가 읽기 칩으로 바뀌며 행 높이가 줄어 기존 scroll/행 위치를 바꾼 구현 회귀였다. 250→251페이지 4건은 수동 API fixture의 필수 `tag_ids` 누락, 원칙 왕복 2건은 새 `scroll` URL 상태를 고려하지 않은 문자열 equality, 웹/MCP 기록 2건은 새 보기·편집 링크까지 일치하는 부분 제목 locator였다.
- 재실행 전에 root 전체 traces/error-context를 `C:/Users/yongin/AppData/Local/Temp/template18-activity-full85cb4ee-failure`, 수집 출력은 `template18-activity-full85cb4ee-output.txt`에 보존하고 공유 환경 소유권을 메인에 반환했다.
- 수정 커밋 `55e07202676136f8c94623d03de59b374d3620fb`: compact 태그 로딩에도 실제 읽기 칩과 같은 구조·글자·padding을 사용했다. 제목·행·버튼 위치 허용치를 늘리지 않았다. 수동 fixture에 필수 태그/엔터티 목록 필드를 추가하고, 원칙은 원래 필터·최소 페이지 범위·새 scroll 상태와 원래 anchor 초점을 검증하며, 웹/MCP는 대상별 명시적 보기 링크를 사용한다.
- 같은 실행 소스에서 build·웹 12 PASS·격리 브라우저 12 PASS. 추가한 늦은 dictionary 응답 검사는 20개 태그 행에서 읽던 행의 y·scroll·초점이 응답 전후 정확히 유지되는지 desktop/mobile에서 확인했다. 수정 head의 실제 전체 E2E는 메인이 새 root checkout을 고정한 뒤 순차 재배정해야 한다.

### 수정 head 실제 전체 E2E와 긴 태그 복원 — 2026-10-04

- 메인이 고정한 root detached `e15c9e95d9599043e72297d97b11cef28f939427`에서 `npm run test:e2e`: 71 PASS·9 기존 SKIP·0 FAIL, 4.6분. setup/reset 없이 동일 로컬 환경을 사용했고 전후 SHA·clean을 확인했다. 결과 자료는 `C:/Users/yongin/AppData/Local/Temp/template18-activity-fulle15c9e9-pass`와 `template18-activity-fulle15c9e9-output.txt`에 보존하고 공유 환경 소유권을 반환했다.
- 추가 검사에서 유효한 30자 한글 태그가 360px에서 줄바꿈되면 로딩 칩과 높이가 달라 복귀 행 y가 90px 이동하는 실제 회귀를 재현했다. 실패 trace는 `template18-activity-long-tag-failure`에 보존했다. 고정 높이·이름 생략·허용치 확대 대신 필터와 목록의 사전 조회를 하나로 공유하고 최초 태그 목록 표시 및 scroll/focus 복원을 사전 응답 완료 뒤에 수행한다. 페이지 추가에는 이미 받은 사전을 유지한다.
- 긴 태그 수정 소스에서 build PASS, 격리 브라우저 14 PASS. 늦은 8자/30자 이름 응답과 줄바꿈, 목록→상세→목록 왕복의 원래 행 y·scroll·초점을 desktop/mobile에서 검사했다. 실제 전체 E2E 통과 증거는 위 `e15c9e9`에 한정하며 이 후속 수정과 최종 탐색/공유 route guard 통합 head의 전체 검증은 아직 남아 있다.

### 최종 탐색·공유 초안 보호 통합 — 2026-10-04

- navigation 수정 `08d580506a8bd25eb3567fe8426b305404a5fabc` 위로 activity 커밋을 rebase하고, entity-tags 담당의 전용 공유 guard/API `9741aadeb6f1af4f0134e95b5c5260da960421a8`를 `f35b4bc`로 cherry-pick했다. Entity/TagsPage feature는 포함하지 않았다.
- Task/Record/Principle 작성·편집과 원칙 상태/대체 폼은 `onRouteDiscard`를 순수 편집 종료 콜백으로 연결했다. 일반 취소의 deferred 목록 복귀는 별도로 유지하여 요청한 라우트와 경합하지 않는다. 공유 guard는 dirty/busy 라우트 이탈과 beforeunload를 보호한다.
- 해당 통합 및 caller 소스에서 build·문서 검사 PASS(48 PASS·기존 1 SKIP), 격리 브라우저 26 PASS. 실제 작성/직접 편집 폼의 같은 경로 query 이동에서 확인 취소의 초안 보존, 버리기 후 편집 종료·새 작성 초기값, 직접 편집의 요청 상세 조건 유지(목록으로 잘못 복귀하지 않음)를 desktop/mobile로 추가 검사했다. 기존 저장/취소·오류·긴 태그 복원 검사는 함께 통과했다. 최종 정확한 head의 실제 전체 E2E는 공유 환경 재배정 후 수행한다.

### 최종 실제 전체 E2E — 2026-10-04

- 공유 환경 배정 root detached `83a3e80bf9c03a38fb57ca121e465f25fca062ff`에서 `npm run test:e2e`: 75 PASS·9 기존 SKIP·0 FAIL, 4.8분. navigation 최종 로그아웃/초점 수정, 긴 태그 사전 복원, 공유 모달 route guard와 순수 route-discard, EntitiesPage 작성 성공 후 deferred navigation 소비자를 포함한 소스다.
- 할 일/기록의 추가 페이지→상세→편집→취소/저장→뒤로가기/새로고침/삭제 복귀, 수동250→251페이지, 검색 원문 종류별 복귀, 원칙 충돌·초안, 작성/완료·반복 회차·웹/MCP·다른 사용자 거부, 탐색 로그아웃 후 재로그인·초안 이동 확인 취소 초점, 대표 viewport·200% 확대·키보드·대비가 통과했다. 9 SKIP은 기존 실제 의미 검색 키 미설정 2건과 desktop에 집중된 중복 viewport/키보드 검사 7건이다.
- 전후 SHA와 clean을 확인하고 setup/reset·서비스 변경·root tracked 파일 편집 없이 실행했다. 자료는 `C:/Users/yongin/AppData/Local/Temp/template18-activity-full83a3e80-pass`·`template18-activity-full83a3e80-output.txt`에 보존했다. 공유 환경 소유권을 메인에 반환했다. 독립 리뷰·정확한 최종 PR head CI와 실제 휴대폰/스크린리더 제외 범위는 남는다.
- 탐색 PR #91 머지 후 `git fetch origin` 및 `git rebase --onto origin/main 08d580506a8bd25eb3567fe8426b305404a5fabc`를 수행했다. 새 base `69b2d4991634c707f7d75970d3270bafb0568aff`는 이전 탐색 head와 전체 tree가 같다. rebase 후 검증 소스 `83a3e80`와의 차이는 티켓/인계 문서뿐이며 제품 소스는 동일하다.

### 독립 리뷰 P2 두 건 수정 — 2026-10-04

- 리뷰가 `83a3e80`에서 태그 사전 최초 실패 후 재시도 시 목록 unmount·스크롤/초점 소실, 같은 대상 `edit=1` query로 뒤로갈 때 편집 미재진입을 재현했다. 위 전체 E2E 통과는 해당 head의 기존 검사 근거이며 이 경계를 검사한 완료 증거로 사용하지 않는다.
- 사전 재시도는 기존 실패 상태/행을 응답까지 유지한다. 목록별 공유 사전의 응답 반영 직전에 현재 읽던 행을 기록하고 layout 반영 뒤 행 y와 초점을 유지한다. 반복되는 행 오류 카드 대신 짧은 읽기 칩을 사용하고 필터의 단일 재시도 조작을 제공한다. 긴 이름은 그대로 줄바꿈하며 고정 높이·잘림·허용치 확대를 사용하지 않았다.
- 상세의 query 진입 상태를 ID 조회와 별도로 동기화했다. 허용된 query 이동에서 편집을 닫고 `edit=1`로 돌아오면 새 원문을 조회해 새 폼으로 연다. 이탈 확인 취소는 URL·기존 초안을 유지한다. 단순 query 변경 때문에 진행 중 초안을 같은 대상 조회로 덮어쓰지 않는다.
- 수정 소스의 build·웹12 PASS, 격리 브라우저32 PASS. 세 목록 모두 20번째 행의 초점/y를 초기 사전503→응답 보류→30자 한글 성공 전후 검사하고, 세 상세 모두 직접 편집 초안 확인 취소→버리기→서버 제목 변경→Back 편집 최신값→Forward 읽기를 검사했다. 첫 retry fixture는 반복 오류 카드 제거 전 응답 뒤 마지막 행 y의 62px/44px 이동을 드러냈으며 trace를 `C:/Users/yongin/AppData/Local/Temp/template18-activity-review-retry-first-failure`에 보존했다. 최종 수정 head의 실제 전체 E2E·독립 재리뷰·CI는 다시 필요하다.

### 리뷰 수정 head 실제 전체 검증과 환경 실패 기록 — 2026-10-04

- root detached `c5f24c181d62b6bd0306f69e1c1e9b4dde4c7806`의 첫 `npm run test:e2e`는 74 PASS·9 기존 SKIP·1 FAIL(4.9분)이었다. mobile 웹/MCP 할 일 생성 POST가 HTTP500을 받아 상세 이동을 기대한 검사가 실패했다. 화면은 초안과 저장 여부 불명 안내를 유지했다. 실패 trace·출력은 TEMP `template18-activity-fullc5f24c1-failure`·`template18-activity-fullc5f24c1-output.txt`에 보존했다.
- 실패 POST 시작은 `2026-10-04T06:47:58.805Z`, 응답 Date는 `06:47:58 GMT`, Kong upstream/proxy latency는 17/0ms다. 응답 `{code:"Internal Server Error",message:"Request failed due to an internal server error"}`는 앱의 `toErrorBody`가 반환하는 `code:"internal"`/`retryable` 형식과 다르다. Kong은 `06:47:58.835353Z` POST/tasks500을, Edge Runtime은 같은 시각 `06:47:58.827` worker already retired 및 `06:47:58.834523` `WorkerAlreadyRetired`/`UserWorker.fetch` 오류를 기록했다. 인접 CPU soft-limit/early-termination과 BadResource도 관측했다. runtime worker에서 발생한 실패라는 근거는 강하지만 해당 POST와 특정 isolate 연결·CPU 제한의 직접 인과·근본 CPU 원인은 관측하지 못했다. 이를 확정된 일시 장애나 앱 버그 없음의 근거로 과장하지 않는다. scoped 로그는 TEMP `template18-activity-c5-edge-failure.log`·`template18-activity-c5-kong-failure.log`에 보존했다.
- 같은 코드의 해당 mobile 시나리오 재검사는 1 PASS(3.5초), 이어 전체 재검사는 75 PASS·9 기존 SKIP·0 FAIL(4.6분)이었다. 같은 `c5f24c1` 소스·검사·timeout을 사용하고 setup/reset·서비스 재시작·fixture 정리·root tracked 수정은 하지 않았다. 전후 root SHA·clean을 확인했다. 재검사 증거는 TEMP `template18-activity-fullc5f24c1-targeted-rerun.txt`와 `template18-activity-fullc5f24c1-pass-rerun`·`template18-activity-fullc5f24c1-pass-rerun-output.txt`다. 첫 실패를 지우지 않고 재검증 통과와 분리해 남겼다. 공유 환경 소유권을 메인에 반환했다.
- 이 후속 변경은 티켓/인계 문서만이며 검증한 제품 소스는 `c5f24c1`와 동일하다. 독립 재리뷰·최종 정확한 PR head CI·머지는 메인이 조정하며 운영 배포는 제외한다.

### PR92 CI 짧은 제목 조작 영역 수정 — 2026-10-04

- PR [#92](https://github.com/kimyongin/agent-workspace-template/pull/92)의 exact head `77630a0209be31a1852407493817836e2b04349f`, [CI37184500491](https://github.com/kimyongin/agent-workspace-template/actions/runs/37184500491)는 check PASS·integration FAIL이었다. DB·HTTP·MCP 계약은 PASS, 전체 E2E는 69 PASS·9 기존 SKIP·6 FAIL이다. 5개 viewport 목록과 200% 확대의 조작 영역 검사에서 짧은 제목 링크가 32/38×44px, 기록 한 글자 제목은 16×44px로 측정됐다. 환경 오류가 아닌 실제 UI 회귀다.
- `.activity-item-heading > .item-title`의 `min-width:0` 때문에 제목 링크가 글자 폭으로 줄어든 원인을 확인했다. 제목의 복사·링크·긴 글자 줄바꿈은 유지하면서 최소 폭을 44px로 수정했다. 기존 assertion·timeout·예외 처리는 변경하지 않았다. CI 로그와 error-context/trace/artifacts는 TEMP `template18-activity-ci37184500491-failed.log`·`template18-activity-ci37184500491-artifacts`에 보존했다.
- 별도 실제 feature fixture에 한 글자 제목을 추가해 변경 전 세 목록×desktop/mobile 6건 모두 16px 폭 실패를 재현했다. 실패 trace는 TEMP `template18-activity-short-title-first-failure`에 보존했다. 수정 후 전체 격리 fixture 38 PASS(32.8초): 세 목록의 짧은 제목 360/390/768/1024/1440px 44px 이상·넘침 없음과 기존 긴 제목/태그·복귀·초안 보호도 함께 PASS. build PASS(기존 bundle 경고). root 서비스/DB/추적 파일은 변경하지 않았다. 새 exact head의 독립 리뷰·CI와 필요 공유 검증은 메인 재배정을 따른다.

### 짧은 제목 수정 head 전체 E2E — 2026-10-04

- 메인이 고정한 root detached `6615d180e022a43e397948cd1b715f5e69a6f615`에서 `npm run test:e2e`: 75 PASS·9 기존 SKIP·0 FAIL(5.4분). 대표 viewport·200% 확대·기존 목록/상세/작성·복귀/초안·검색·웹/MCP 연동을 포함해 전체 회귀가 통과했다. 한 글자 제목의 별도 격리 6건을 포함한 38 PASS는 위 수정 기록의 독립 근거다.
- 제품 코드·assertion·timeout을 추가 변경하지 않고 기존 서비스/DB/사용자 설정을 유지했다. setup/reset·fixture 정리·서비스 재시작·root tracked 수정 없이 전후 SHA·clean을 확인했다. 전체 출력/자료는 TEMP `template18-activity-full6615d18-output.txt`·`template18-activity-full6615d18-pass`에 보존하고 공유 환경 소유권을 메인에 반환했다. 이 후속 커밋은 티켓 문서만 바꾸며 제품 소스는 검증한 `6615d18`와 동일하다. 최종 정확한 PR head CI와 머지는 메인이 조정한다.
