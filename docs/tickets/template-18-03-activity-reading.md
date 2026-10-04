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
- [ ] 페이지 추가→상세→편집/취소→복귀, 날짜 접기, 검색 원문 복귀, 오류·dirty·모달 키보드 회귀 검증.

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

- 메인이 순차 배정하는 정확한 통합 head의 실제 DB·HTTP·MCP·전체 E2E 및 검색 원문 복귀, 완료/중단/재개·브라우저 뒤로가기/새로고침 회귀는 아직 activity 세션이 실행하지 않았다. 격리 fixture 통과를 그 증거로 대신하지 않는다.
- shared ModalShell의 dirty/busy route guard는 entity-tags 담당 후속이다. 이 세션의 deferred navigation과 함께 최종 통합에서 다시 검증한다.
- 하단 탐색을 포함한 최종 앱의 200% 확대·모든 대표 화면의 computed style·전체 초점 회귀는 통합 검증에서 확인한다. 실제 휴대폰·스크린리더는 상위 티켓의 제외 범위를 유지한다.
- 독립 리뷰·정확한 최종 head CI·PR/머지는 메인이 조정한다. 운영 배포는 제외한다.
