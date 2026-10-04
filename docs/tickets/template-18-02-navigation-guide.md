# Template-18-02 — 탐색과 첫 사용 안내

작성: 2026-10-04
상태: 진행 중
검토 기준: `745130148c90de842d7617c232194b653d1c638b`

## 목표와 승인 범위

[상위 티켓의 확정 범위](template-18-fin-ux-adaptation.md#확정-범위와-구현-티켓)를 구현한다. 사용자 “티켓 정리해서 개발해줘” 승인. [PRD](../product/concept.md), [디자인 가이드](../design/guide.md), [상호작용](../design/ui-patterns.md) 안에서 웹만 변경한다. 배포·PRD·ADR·서버 계약 변경 제외.

## 작업과 완료 조건

- [x] 모든 폭 하단 주요 탐색과 더보기, 현재 경로·safe-area·본문 여백·키보드 메뉴 제공.
- [x] 기존 tasks/records URL에 활동 로컬 탐색 제공. 첫 진입 tasks 유지.
- [x] 중립적 엔터티→할 일/기록→플러그인 연결→검색/원문→명시 저장/웹 확인 안내 route 제공.
- [x] 연결 주소는 현재 공개 설정에서 생성. OAuth와 제품 스킬을 구분하고 미설정·복사 실패 처리. 지원 클라이언트의 상세 설치 절차는 기존 검증된 배포 문서로 연결하고 추측하지 않음.
- [x] 대표 빈 상태에서 가이드 진입, 모바일/데스크톱/200%/키보드 검증(route fixture; 실제 인증/DB 전체 E2E는 아래 후속).

## PR 분할과 담당

PR 하나 `codex/fin-ux-navigation`. navigation 세션이 App route/layout, 새 탐색/가이드 컴포넌트, 전역 CSS, 활동 로컬 탐색 컴포넌트와 각 목록의 삽입만 소유한다. 다른 세션은 전역 CSS를 동시에 수정하지 않는다. 소비 기능과 가이드 정본을 함께 갱신한다. 단위·build·docs 검사와 전체 E2E는 구현 세션이 담당하며 공유 환경은 메인과 조정한다.

## 구현 인계와 실행 기록

작업 공간·base/head·실행 명령과 결과·실패 근거·미검증은 배정/결과 인계 때 기록한다. 제출 전 독립 리뷰·CI·머지는 대기이며 최종 증거는 PR checks/완료 코멘트가 소유한다. 실제 휴대폰·스크린리더 검수는 기존 제외 범위를 유지한다.

### navigation 구현 세션 — 2026-10-04

- 작업 공간: `C:/Users/yongin/.codex/worktrees/fin-ux-navigation/agent-workspace-template`, branch `codex/fin-ux-navigation`, base `8e5b11c`. 메인의 승인·배정 상태 문서 `0eaa692`를 `60dbf2c`로 cherry-pick했다. 최종 head는 결과 인계와 PR의 exact revision으로 고정한다.
- 역할/모델: navigation 구현 세션. `npm ci` 후 `node scripts/agent-models.mjs assign --client codex-desktop --tier balanced --effort medium --role implement --reason "승인된 탐색과 사용 가이드 UI 구현" --snapshot C:/Users/yongin/AppData/Local/Temp/template-18-desktop-models.json` PASS. `gpt-6.1-sol`/`medium` 명시 배정과 도구 노출을 확인했고 일반 웹 구현이므로 balanced/medium을 유지했다. backend 실제 effort·실청구액은 미관측이다.
- 구현: 주요 하단 탐색·보조 disclosure·활동 로컬 링크·guide route·엔터티/할 일/기록 최초 빈 상태 안내. 공개 `VITE_API_URL`에서 `/mcp`를 계산하고 선택 `VITE_REPOSITORY_URL`/Pages `PROD_REPOSITORY_URL`로 이 앱의 설치·배포 문서만 연결한다. 미설정 안내와 주소 직접 복사 경로를 제공한다.
- 경로/초안 의존성: `createBrowserRouter`/`RouterProvider`로 기존 basename·인증 wrapper·routes를 보존했다. `/logout` 경로 진입 뒤 기존 기본 scope `signOut()`을 실행해 후속 Tags/Modal `useBlocker`가 경로 이동을 먼저 보호할 수 있게 했다. 공통 보호 구현은 18-04 담당이며 이 PR만으로 전체 초안 회귀를 완료했다고 표시하지 않는다. 실패는 같은 화면에서 재시도 가능하다.
- 설정/인증 확인: [Supabase signOut 공식 문서](https://supabase.com/docs/reference/javascript/auth-signout)와 [changelog](https://supabase.com/changelog.md)를 2026-10-04 확인했다. 로그아웃 SDK 호출과 기본 scope는 유지하며 DB/서버/Auth 공급자 설정은 바꾸지 않았다. 제품 설치 내용은 저장소의 기존 `plugins/workspace/README.md`·배포 정본으로 연결하고 클라이언트 UI 설치 절차를 새로 작성하지 않았다.
- 직접 검증: `npm run test:web` 3파일/9 PASS, `npm run build` 타입·Vite PASS(기존 큰 bundle 경고 유지), `npm run check:docs` 텍스트352개·모델/native PASS 및 회귀48 PASS/0 FAIL/기존 Windows file-symlink권한1 SKIP, `git diff --check` PASS.
- 브라우저 격리: 별도 Vite `55482`, 가짜 공개 loopback Supabase/API `55591`와 임시 Auth storage를 사용했다. `e2e/navigation-fixture.config.ts`의 `npx playwright test --config e2e/navigation-fixture.config.ts` 2 PASS. 모든 API 응답은 route fixture, 다른 origin 요청은 차단하여 DB·함수·운영 데이터에 연결하지 않았다. 실행 시 Vite에 `VITE_SUPABASE_URL=http://127.0.0.1:55591`, `VITE_SUPABASE_PUBLISHABLE_KEY=ui-fixture-public-key`, `VITE_API_URL=http://127.0.0.1:55591/functions/v1/api`, 선택 `VITE_REPOSITORY_URL=https://github.com/example/neutral-app`을 전달했다.
- 화면 증거: 360/390/768/1024/1440 CSS px의 실제 guide/tasks 소비 화면·가로 넘침·44px 주요 조작·하단 뒤 가림 없는 마지막 링크 초점 PASS. 200% 글자 확대와 zoom에 해당하는 reflow 폭도 검사했다. `test-results/navigation-fixture-…/guide-*.png`, `tasks-*.png`를 생성했고 360 guide·1440 guide·390 tasks를 직접 시각 확인했다. 더보기 Enter/방향키/Escape·바깥 클릭·경로 이동 닫기, 복사 성공/실패·주소 유지 PASS. safe-area는 CSS 계약이며 실제 기기 확인으로 주장하지 않는다.
- 후속: 메인 조정 후 공유 로컬 환경의 실제 전체 E2E, independent review·full CI·머지. 운영 배포·제품 설치·실기기·스크린리더 검증은 수행하지 않았다. 안내 읽기는 저장/검색/설치를 자동 실행하지 않는다.
