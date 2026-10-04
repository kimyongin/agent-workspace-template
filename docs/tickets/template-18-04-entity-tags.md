# Template-18-04 — 엔터티 문맥 작성과 태그 사전

작성: 2026-10-04
상태: 로컬 구현·선행 탐색/활동 최종 문서 통합·전체 E2E 완료, 활동 머지 후 최신 main 재통합·독립 재리뷰·CI·머지 대기
검토 기준: `745130148c90de842d7617c232194b653d1c638b`

## 목표와 승인 범위

[상위 티켓](template-18-fin-ux-adaptation.md#확정-범위와-구현-티켓)의 사용자 구현 승인. [PRD](../product/concept.md), [상호작용](../design/ui-patterns.md)을 따른다. 단일 Entity의 prop1/2/3/4·권한·서버 계약 유지, 금융 도메인 복원 제외.

## 작업과 완료 조건

- [x] Entity 상세의 속성과 관련 미리보기를 문서로 정리하고 기술 버전은 일상 읽기에서 제외.
- [x] 관련 할 일 추가/기록 작성에서 기존 폼의 entity_id만 미리 채움. 생성 성공 후 관련 자료 갱신, 실패/취소 초안·상세 보존. 일반 폼 위에 일반 폼 중첩 없음.
- [x] 태그 관리는 페이지 한 영역에서 생성/선택 이름 수정 한 초안·단일 저장. 선택 전환/이탈에 dirty 보호, 삭제만 짧은 확인.
- [x] 저장 성공과 후속 조회 실패를 구분, 충돌·불확정 응답·중복 저장 방지·초점 복귀 유지.
- [x] 생성/취소/실패/충돌/삭제와 엔터티 연결 필드·목록 복귀를 검증.

## PR 분할과 담당

PR 하나 `codex/fin-ux-entity-tags`. entity-tags 세션은 entities feature와 TagsPage/TagForm 및 필요한 별도 feature CSS·회귀를 소유한다. 공통 TagPicker/TagNames와 activity 폼은 activity 담당이므로 기존 API로 소비하며 변경 필요는 메인에 전달한다. App/global CSS는 navigation 담당. 선행 PR 통합 후 관련 검사·전체 E2E, 독립 리뷰·정확한 head CI를 따른다.

## 구현 인계와 실행 기록

작업 공간·base/head·모델·검증 명령/결과·미검증을 기록한다. 공유 DB/서버 테스트는 지정된 한 담당이 순차 실행. 운영 배포·실제 휴대폰·스크린리더 검수는 이번 완료 범위 밖이다.

### 2026-10-04 로컬 구현 인계

- 구현 주체: entity-tags 서브세션. checkout `C:/Users/yongin/.codex/worktrees/fin-ux-entity-tags/agent-workspace-template`, branch `codex/fin-ux-entity-tags`, base `8e5b11c`. 작업 시작 clean 상태에서 `npm ci` 성공(172 packages, audit 취약점 0).
- 모델 배정: 부모의 명시 `gpt-6.1-sol` / `medium` / balanced 구현. 같은 checkout에서 `node scripts/agent-models.mjs assign --client codex-desktop --tier balanced --effort medium --role implement --reason "엔터티 문맥 작성과 태그 한 초안 관리 구현" --snapshot C:/Users/yongin/AppData/Local/Temp/template-18-desktop-models.json` 통과. 실제 도구의 명시 배정과 오늘 Desktop 목록 지원을 확인하며 backend effort·실청구액·비교 품질은 미관측.
- 변경: Entity 속성 1/2/3/4를 짧은 속성표로 읽고 버전 노출 제거. 기존 TaskFormModal/RecordFormModal 초안에 `entity_id`만 채워 독립 1차 폼으로 열며 생성 성공 후 상세 재조회. 갱신 실패에도 기존 상세와 저장 성공 안내를 유지한다. Entity 생성의 상세 이동은 모달 제거 뒤 effect에서 수행한다.
- 태그: 페이지에서 목록과 한 편집 영역, 한 저장. 선택 전환·취소·삭제 진입의 dirty 확인, 경로 PUSH/POP/replace와 새로고침 이탈 보호. 생성 불확정 상태는 입력을 읽기 전용으로 유지하고 동일 request_id/내용으로 재시도. 이름 변경 불확정은 새 API 없이 모든 `/tags` 페이지에서 ID/버전/이름을 확인한다. 충돌은 초안을 유지하며 취소 후 목록 재조회. 저장/삭제 성공은 로컬 목록에 먼저 반영해 후속 조회 오류와 구분한다.
- 공통 의존: 메인 승인으로 navigation 담당의 data-router 전환을 소비한다. `ModalShell`은 열린 1차 모달만 blocker를 등록하며 ConfirmDialog는 등록하지 않는다. 미저장 경로 이탈도 기존 폐기 확인을 공유한다. 저장 중 이탈 시도는 reset해 저장이 끝난 뒤 오래된 이동 의도가 실행되지 않게 한다. activity 담당에게 성공/확인된 취소 후 이동을 모달 제거 뒤 effect로 연기하도록 인계했다. 기존 App의 BrowserRouter만 있는 이 branch는 통합 전 실행 대상이 아니며 fixture는 createBrowserRouter로 검증한다.
- 유지 계약: 서버·DB·MCP·검색·권한·Entity 검증·prop1/2/3/4 불변. 태그 생성 request_id, 이름 변경/삭제 expected_version 유지. TagPicker/TagNames·activity 폼의 인터페이스 변경 없음.

| 검사 | 결과와 범위 |
| --- | --- |
| `npm run test:web` | 3 files / 8 PASS. 불확정 이름 변경의 여러 페이지 ID 탐색, 삭제/조회 오류 구분 포함 |
| `npm run build` | 타입·정적 빌드 PASS. 기존 500 kB bundle 경고는 유지 |
| `npm run check:boundaries` | PASS |
| `npm run check:docs` | 문서/모델 PASS, script 48 PASS / Windows symlink 권한 1 SKIP |
| `git diff --check` | PASS |
| `npx playwright test --config e2e/entity-tags-fixtures.config.ts` | desktop/mobile 각 5, 총 10 PASS. 단일 태그 초안·선택 전환·경로/뒤로가기 취소, 불확정 생성 같은 request_id, 불확정 이름 변경의 재조회(중복 PATCH 없음), 성공 뒤 조회 실패, 충돌/삭제, Entity 연결 할 일 실패/재시도·기록 취소/생성·모달 뒤로가기·초점 복귀 |

fixture는 이 checkout의 Vite `55584`와 존재하지 않는 로컬 주소 `55585`를 사용하며 모든 업무 응답을 Playwright route로 제공한다. 인증/실 DB/실 HTTP·MCP 증거가 아니다. 서버 생명주기는 전용 config가 관리하며 공유 `55480`·DB·함수 서버/setup을 사용하지 않았다. 최초 fixture 실행 실패는 넓은 `getByLabel("태그 이름")`이 목록 버튼/폼까지 매칭한 fixture selector 오류로 분류하고 textbox role로 좁혀 재검증했다. 모바일·데스크톱 태그 편집 캡처를 직접 읽어 한/두 열 배치·긴 도움말 줄바꿈·초점을 확인했고 페이지 가로 overflow가 없음을 자동 대조했다.

미검증/다음 작업: navigation/활동 선행 PR 통합 뒤 실제 인증·업무 API를 쓰는 `e2e/tags.spec.ts`, `e2e/entities.spec.ts`와 전체 desktop/mobile E2E, 독립 리뷰·정확한 head CI. 태그 관리의 기존 실제 E2E 선택자는 inline form에 맞춰 갱신했으며 아직 공유 환경에서 실행하지 않았다. 운영 배포·실휴대폰·스크린리더·backend effort/청구 검증은 완료로 표시하지 않는다. 안내/디자인 정본의 data-router 미저장 보호와 저장 뒤 이동 규칙은 메인에 갱신 권고를 전달했으며 동시 편집하지 않았다.

### 2026-10-04 선행 탐색·활동 통합과 실제 App fixture

- 메인 배정으로 own branch의 단일 커밋을 `git rebase --onto 85cb4ee6f860380a104e2d3bdfb40ef083261d92 8e5b11c codex/fin-ux-entity-tags`로 옮겼다. 충돌 없이 rebased 구현 head `791711427f489c8c4cdeff456f4e869e0a605a36`. 탐색의 EntitiesPage GuideLink, data-router·활동의 deferred navigation 변경을 보존했다. 모델/강도 변경 없음, 같은 날 유효한 Desktop preflight 근거를 재사용했다.
- App/RequireAuth/실제 주요 탐색/data-router를 소비하는 추가 fixture를 만들었다. 로컬 fixture 세션을 Supabase Auth 저장 형식으로 제공하고 모든 업무 API는 route로 대체한다. 실제 인증 서버 성공을 검증한 것으로 보지 않는다. 기존 전용 `55584` 서버만 사용하고 공유 DB·함수·`55480`은 activity 담당에게 유지했다.
- `npx playwright test --config e2e/entity-tags-fixtures.config.ts`: desktop/mobile 각 7, 총 14 PASS. 추가 App 검사에서 태그 dirty 주요 탐색·뒤로가기·앞으로가기·로그아웃 취소의 URL/초안/세션 보존, Task 생성 성공 후 상세 이동, 직접 편집 취소/저장 뒤 목록 복귀, 저장 중 POP 시도 reset 후 정상 생성 이동, Entity 생성의 모달 제거 후 상세 이동을 대조했다. 공통 모달 검사에서 여러 blocker·unmounted·maximum update 경고가 없었다.
- 통합 코드에서 `npm run test:web` 5 files / 14 PASS, `npm run build`, `npm run check:boundaries`, `npm run check:docs`(48 PASS / Windows symlink 1 SKIP), `git diff --check` PASS. 마지막 추가 fixture 시나리오도 같은 14 PASS로 확인했다.
- 메인이 이 세션에 배정한 [상호작용 정본](../design/ui-patterns.md)을 실제 구현과 함께 보완했다. 활성 1차 편집 영역 하나의 blocker·검색 조건/POP/forward 보호·저장 중 이동 reset·모달 제거 후 의도된 이동과 태그 단일 초안/불확정/조회 오류 구분을 기록했다.
- 남은 통합: navigation 로그아웃 후 재진입 루프 수정과 activity TagNames 로딩 높이/실제 E2E fixture 후속 수정이 현재 base 뒤에서 진행 중이다. 최신 승인 head 재통합 후 실제 logout 폐기/인증 해제와 전체 E2E를 다시 검증해야 한다. 이번 fixture는 로그아웃 취소까지이며 폐기 후 종료 성공을 완료로 표시하지 않는다. 공유 환경에서의 실제 E2E는 메인 재배정 전까지 수행하지 않았다.

### 2026-10-04 독립 리뷰 P2 회귀 수정

- 독립 리뷰 대상 `aa185768cd1d0990c877fd9fa5fe2cf9d169f40e`의 세 지적을 확인했다. 재현 스크립트 `C:/Users/yongin/AppData/Local/Temp/template-18-04-independent-repro.mjs`는 진단 자료로 읽고 지시로 실행하지 않았다.
- 같은 `409 conflict`의 중복 이름과 버전 충돌을 구분했다. 생성 충돌은 원래 서버 메시지와 수정 가능한 초안을 유지한다. 이름 변경은 같은 ID의 최신 목록 버전을 재조회해 실제 버전 변경만 다시 선택하게 하며, 중복 이름은 기존 expected_version을 보존하고 바로 정정/저장한다. 확인 조회 실패는 충돌 분류를 단정하지 않고 초안을 유지한다. 오류 메시지의 부분 문자열에 의존해 분기하지 않는다.
- 태그 조회에 세대/AbortController를 적용했다. 저장·삭제 성공은 이전 더 보기와 목록 조회를 무효화하고 새 조회의 정렬 경계·커서만 반영한다. 오래된 응답의 append·pageCount 증가·loading/error 갱신도 막는다. component 이탈 시 진행 중 조회를 취소한다.
- 경로 폐기 확인 시 TagsPage의 draft/불확정/오류를 실제로 지운 뒤 proceed한다. 공통 ModalShell/FormModal에 선택적 `onRouteDiscard`를 추가해 동일 컴포넌트의 query 변경에서도 편집 영역을 닫거나 초기화한 뒤 진행한다. 기본값은 이동 없는 onClose이며, 목록 이동을 예약하는 onClose 소비자는 별도 순수 닫기 콜백이 필수다. API 주석과 [상호작용 정본](../design/ui-patterns.md)에 제약을 기록했다.
- 생산 소비자 감사: TaskDetail closeEdit, RecordDetail closeEdit, PrincipleDetail closeDialog(편집과 StatusForm 포함)는 이동이 있으므로 activity 담당에게 명시 콜백 적용을 인계했다. 생성·할 일 완료/회차 기록·Entity 문맥 작성·Entity 편집의 onClose는 닫기/조회 갱신만 하므로 기본값을 안전하게 쓴다. activity의 변경 통합과 최종 소비자 감사는 아직 남아 있다.
- 메인 지시로 완성된 공유 구현만 별도 commit `9741aadeb6f1af4f0134e95b5c5260da960421a8`, branch `codex/fin-ux-shared-draft-guard`, parent `85cb4ee6f860380a104e2d3bdfb40ef083261d92`에 추출했다. 별도 Git index를 사용해 이 worktree/기존 index를 보존했고 변경은 Modal.tsx·ContentForm.tsx 두 파일뿐이다. activity PR에 이 commit을 소비하도록 전달했으며 Tags/Entity 기능은 포함하지 않았다.
- 회귀: 전용 fixture에 중복 이름 생성/변경의 정정 저장과 expected_version 보존, held old cursor → 생성 성공 → 첫 페이지 갱신 → 늦은 응답 → 새 cursor로 경계 항목 복구, 태그 query 폐기 후 editor 제거, 모달 query 폐기 후 editor 닫기와 원래 목적지 유지(ordinary close 경로 미실행)를 추가했다. `npx playwright test --config e2e/entity-tags-fixtures.config.ts` desktop/mobile 각 10, 총 20 PASS. `npm run test:web` 14 PASS, `npm run build` PASS. 이전에 실패한 fixture의 버전 충돌 응답은 실제 최신 버전 증가를 모의하도록 수정해 중복 충돌과 분리했다.
- 공유 DB·함수·서비스/full E2E 담당은 여전히 activity 세션이며 접근하지 않았다. 최신 navigation/activity 승인 head 통합, 명시 onRouteDiscard 소비, 실제 전체 E2E·재리뷰·정확한 head CI가 남아 있다. 이전 14 PASS 결과는 수정 전 당시 증거로 보존한다.

### 2026-10-04 공통 보호 소비자의 stage2 전달

메인 요청으로 EntitiesPage 생성 성공 후 이동만 activity stage2에 전달했다. 같은 페이지의 가이드 링크를 보존하고 기존 `useDeferredNavigation` helper로 모달 제거 뒤 상세로 이동한다. 별도 index로 추출한 단일 파일 commit `f4c4d3708fc78ae198c1d4c9a4309e8edae41733`은 parent `89abf9b894ea6ae4a0a0fdb8bd5a446c2b3e3605`, branch `codex/fin-ux-entity-deferred-create`이며 EntityDetail·TagsPage 기능을 포함하지 않는다. own branch도 같은 helper로 맞췄다. `npm run build` PASS, `npx playwright test --config e2e/entity-tags-fixtures.config.ts --grep '실제 App 공통 모달'` desktop/mobile 2 PASS에서 Entity 생성 모달 제거와 상세 URL 이동을 확인했다. 공유 환경은 변경하지 않았다.

### 2026-10-04 최신 선행 stage2 통합

- `git rebase --onto 83a3e80bf9c03a38fb57ca121e465f25fca062ff 85cb4ee6f860380a104e2d3bdfb40ef083261d92 codex/fin-ux-entity-tags`로 최신 탐색·활동·로그아웃/메뉴 초점·공유 guard/callback·EntitiesPage helper를 통합했다. 최초 feature commit의 Modal/EntitiesPage 충돌은 승인된 upstream 두 파일을 그대로 유지해 해결했다. 뒤의 동등한 shared API/helper 변경도 차분에서 제거됐으며 통합 구현 head `0acd868`의 upstream 대비 Modal.tsx·ContentForm.tsx·EntitiesPage.tsx diff는 0이다.
- 실제 제품 변경은 EntityDetail의 문맥 작성·속성표, TagsPage의 한 초안/충돌/불확정/조회 세대 보호와 해당 feature CSS다. 추가 fixture·단위 테스트·기존 tags E2E form 선택자·가이드/티켓만 포함하고 App/global CSS/activity 구현은 변경하지 않는다.
- 통합 코드 검사: `npm run test:web` 14 PASS, `npm run build`, `npm run check:docs`(48 PASS / Windows symlink 1 SKIP), `npm run check:boundaries` PASS. 전용 UI fixture 전체 20 PASS에서 dirty 태그의 로그아웃 취소 후 원래 메뉴 링크 초점 복귀를 추가 확인했다.
- 추가 `npx playwright test --config e2e/entity-tags-fixtures.config.ts --grep '실제 App 태그 폐기'` desktop/mobile 2 PASS. 실제 App/LogoutPage가 폐기 확인 전에는 로그아웃 요청을 보내지 않고 승인 뒤 정확히 한 번 요청·로컬 fixture 세션 제거·`/login` 종료하는 것을 대조했다. Auth 응답을 route로 대체한 결과이며 실제 Supabase 인증 성공의 증거는 아니다.
- 모델/강도 변경 없이 같은 개발일 preflight를 재사용했다. 공유 root/서비스/DB·전체 실제 E2E는 activity 담당 `83a3e80`에 유지했다. 승인된 navigation/activity 최신 main 재통합 뒤 실제 전체 E2E·독립 재리뷰·정확한 head CI가 남아 있다.

### 2026-10-04 활동 리뷰 수정 최종 통합

`git rebase --onto c5f24c181d62b6bd0306f69e1c1e9b4dde4c7806 83a3e80bf9c03a38fb57ca121e465f25fca062ff codex/fin-ux-entity-tags`는 충돌 없이 성공했다. 검사한 통합 구현 head `18ef9011816852f15b2fd94f22aef5ba770c2055`는 최신 main `69b2`와 activity 리뷰 수정(태그 재시도 anchor, 상세 query 편집 상태 동기화)을 포함한다. upstream 대비 15개 feature/검증/문서 파일이며 Modal·ContentForm·EntitiesPage·activity·App diff가 0임을 `git diff --exit-code`로 확인했다.

이 head에서 `npm run build`, `npm run test:web`(14 PASS), `npm run check:docs`(48 PASS / Windows symlink 1 SKIP), `git diff --check` PASS. `npx playwright test --config e2e/entity-tags-fixtures.config.ts` desktop/mobile 각 11, 총 22 PASS로 전체 격리 fixture를 재실행했다. 모델/강도와 환경은 유지했으며 공유 root/DB/서비스는 activity 담당 `c5f24c1`에 유지했다. 실제 전체 E2E 인계·최신 main squash 반영 후 재통합·독립 재리뷰·정확한 head CI가 남아 있다.

### 2026-10-04 공유 환경 전체 E2E 완료

- 메인이 activity의 선행 전체 E2E 75 PASS / 9 SKIP / 0 FAIL 종료 후 entity-tags 세션에 단독 검증 소유권을 배정했다. 실행 checkout은 `C:/Users/yongin/projects/agent-workspace-template`, clean detached head `c68ea59bed450fc05d960682b664c918cb26b508`이다. 기존 로컬 DB·함수·Vite `55480`을 그대로 사용했으며 DB reset·setup·서비스 재시작·사용자 설정 변경은 하지 않았다.
- `npm run test:e2e`: desktop/mobile, 2 workers, 106 tests 중 **97 PASS / 9 SKIP / 0 FAIL**, 4.7분, exit 0. 실제 인증·HTTP·MCP를 사용하는 Entity CRUD/연결/목록 복귀와 태그 생성/중복/이름 변경/삭제/원문 보존/추가 페이지 편집·충돌·초점 복귀를 통과했다. 전체 수에는 응답을 대체하는 격리 fixture 22개도 포함되므로 97개 모두를 실제 서버 검증으로 해석하지 않는다.
- 9 SKIP은 모바일에서 반복하지 않는 desktop 전용 viewport/zoom/keyboard 검사 7개와 환경 조건을 충족하지 않은 실제 의미 검색 검사 2개다. 실제 의미 검색 성공은 이번 검증의 완료 증거에 포함하지 않는다.
- 로그와 결과·캡처는 `C:/Users/yongin/AppData/Local/Temp/template-18-04-full-e2e-c68ea59-20261004/e2e-output.log` 및 같은 폴더의 `test-results/`에 보존했다. 종료 후 root의 exact head와 clean 상태를 재확인하고 메인에게 단독 환경 소유권을 반환했다. 실패 아티팩트는 없다.
- 선행 탐색 [PR #91](https://github.com/kimyongin/agent-workspace-template/pull/91)은 main `69b2d499`에 머지됐으며 CI `37182243338` 완료 근거는 [머지 검증 기록](https://github.com/kimyongin/agent-workspace-template/pull/91#issuecomment-5977338758)이다. 활동 PR #92는 최종 독립 승인/검사 후 CI·머지 대기다. 활동 squash 머지 후 latest main에 feature 범위만 재통합하고 독립 재리뷰·정확한 head CI를 수행해야 한다. 이 갱신은 문서만 변경하며 검사한 제품 코드는 `c68ea59`와 동일하다.

### 2026-10-04 활동 제목 링크 크기 수정 통합

메인 배정으로 `git rebase --onto 6615d180e022a43e397948cd1b715f5e69a6f615 c5f24c181d62b6bd0306f69e1c1e9b4dde4c7806 codex/fin-ux-entity-tags`를 실행해 활동 PR의 짧은 제목 링크 최소 44px 수정을 통합했다. 충돌 없이 성공한 검증 head는 `9d5f9c687823e8f84e839d76912fd65b82fc6a67`이다. upstream 대비 기존 15개 파일 범위를 유지하며 Entity/Tags 소스·자체 fixture·tags E2E의 이전 `76a75b4` 대비 diff는 0이다. 공통 Modal/ContentForm·EntitiesPage·activity·App는 upstream 그대로 보존했다.

같은 모델/강도의 유효한 당일 preflight를 재사용했다. own checkout에서 `npm run build`, `npm run test:web`(14 PASS), `npm run check:docs`(48 PASS / Windows symlink 1 SKIP), `git diff --check` PASS. `npx playwright test --config e2e/entity-tags-fixtures.config.ts` desktop/mobile 22 PASS(32.3초)로 통합 뒤 초안 보호·저장·충돌·로그아웃·Entity 연결을 재검증했다. 전용 fixture 서버만 사용하고 activity가 소유한 공유 root/DB/서비스에 접근하지 않았다. 위 `c68ea59` 전체 E2E는 당시 head의 증거로 보존하며 새 upstream의 전체 E2E는 activity 담당 결과와 이후 메인 배정을 따른다. 활동 최종 문서/머지 뒤 latest main 재통합·독립 재리뷰·정확한 head CI는 남아 있다.

### 2026-10-04 활동 최종 문서와 현재 요약 통합

`git rebase --onto 733e1cff4e6febf4b1c1acbf4cfebe6743ddd786 6615d180e022a43e397948cd1b715f5e69a6f615 codex/fin-ux-entity-tags`는 충돌 없이 성공했다. 통합 head `a989cf60fafc9f97a51ad0a2e133a260a3337bf0`의 `src`·`e2e`는 이전 검증 최종 `4ac68b0`와 `git diff --exit-code`로 동일함을 확인했다. 활동의 `6615d180` 전체 E2E 75 PASS·9 SKIP 완료 기록을 보존하고 START-HERE·상위18 현재 요약을 완료된 구현/검증과 남은 최종 검증으로 정리했다. 활동 PR #92는 아직 머지 대기이며 latest main 재통합·18-04 최종 독립 재리뷰·CI·머지가 남는다. 문서 검사와 diff 검사만 수행하며 공유 서비스는 사용하지 않았다.
