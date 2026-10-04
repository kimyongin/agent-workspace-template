# Template-19-01 — 세 탭 하단 탐색과 프로필 설정

작성: 2026-10-04
상태: 진행 중
기준: main399b82b와 승인한 [Template-19](template-19-three-tab-release-ux.md)/[Template-20](template-20-current-principle-change-records.md)

## 목표와 소유

사용자 구현 승인에 따라 `[프로필] [엔터티] [활동] [원칙] [메뉴]`, 가이드/설정, 고정 SVG 아이콘 선택·저장·기본 복원과 로그인 표시를 구현한다. 인증 후 브랜드 헤더는 제거하되 로그인/OAuth 동의 문맥은 유지한다. 서버 업무 데이터·공유·이미지 업로드·배포는 범위 밖이다.

navigation 세션이 src/app·src/features/settings·src/features/auth의 필요한 계정 표시·설정 코드, 해당 unit/fixture·e2e/navigation 관련 검사·정본 가이드 중 탐색/설정 절·이 티켓을 소유한다. 공통 app.css/tokens는 nav 관련 부분만 수정하고 화면 세션의 모달/CSS 변경을 보존한다. 공통 Auth 변경이 업무 권한 판단을 바꾸지 않도록 보안/Supabase 스킬을 따른다.

아이콘은 고정 목록의 안정 ID를 Auth metadata `workspace_avatar_id`에 저장한다. 기존 공급자 metadata를 덮어쓰지 않으며 이름·아이콘은 권한 근거가 아니다. unknown ID 고정 기본값, 저장실패 draft 유지, server response 후 반영, 재로그인/다른 기기/계정 전환 표시·캐시 정리를 검증한다. Auth SDK 계정 설정만 사용하며 제품 데이터 직접DML은 금지한다.

메뉴에는 가이드/설정, 설정에는 계정·프로필 아이콘·엔터티/활동 태그 관리 링크·연결 안내·로그아웃을 둔다. 태그 scoped route는 서버/화면 인계와 맞추고 임시 링크를 완료로 취급하지 않는다. 기존 /search는 호환 경로로 남기되 주요 검색 탭은 없앤다. 기존 dirty navigation/logout/팝오버 초점 회귀를 보존한다. 다른 세션이 페이지 src/components를 소유하며 충돌 시 협의한다.

## 검증과 인계

explicit gpt-6.1-sol/medium을 사용한다(일반 UI·Auth 설정 구현), 오늘 desktop snapshot/assign preflight 확인; backend 실제 effort·비용은 미관측이다. own worktree의 npm ci 이후 unit/build/docs/boundaries, mock Auth·실제 App data router fixture로 계정 표시/아이콘저장실패/메뉴로그아웃초안취소, 320~1440px/200%/키보드/초점을 검증한다. 기존 DB·서비스를 시작/초기화하지 않는다. 실제 공유 환경 검증은 메인이 단독 담당을 배정한다.

가이드와 티켓의 현재 요약·명령/결과/미검증을 함께 갱신해 cleancommit 인계한다. 정확한 head 독립 리뷰·CI·머지는 메인 담당이며 운영 배포는 하지 않는다. 다른 구현 세션의 변경을 되돌리지 않는다.

## 구현·로컬 검증 (2026-10-04)

navigation 구현 세션은 `codex/three-tab-navigation`, 기준 `773e3652834b9b7a15999016858591ba6dd3794f`의 전용 worktree에서 작업했다. 메인의 오늘 desktop snapshot `TEMP/template-18-desktop-models.json`/balanced·medium preflight 인계와 명시 `gpt-6.1-sol`/`medium` 배정을 사용했다. 실제 backend effort·청구액은 미관측이다.

- `[프로필] [엔터티] [활동] [원칙] [메뉴]`, 한 번에 하나의 팝오버, 가이드/설정 링크와 인증된 브랜드 헤더 제거를 구현했다. `/search` 호환 경로와 로그인/OAuth 제목은 유지한다.
- `/settings`는 계정·고정 SVG 네 개·미리보기·선택/취소/기본값·자료 관리·연결 안내·로그아웃을 제공한다. `person/leaf/sun/star` 안정 ID 중 하나만 `updateUser({data:{workspace_avatar_id}})`로 저장하며 SDK 서버 응답을 계정 표시의 정본으로 반영한다. 기존 metadata를 읽어 재전송하거나 공급자 필드를 덮어쓰지 않는다. unknown ID는 person으로 표시한다.
- 미저장 선택은 탭/메뉴/뒤로가기/로그아웃/페이지 종료 보호를 사용한다. 저장 중 중복 제출·이동은 막고 실패는 초안을 보존한다. 계정 변경은 keyed Outlet/설정을 새로 만들고 이전 계정의 지연 응답은 account generation으로 거부한다. 늦은 최초 getSession이 이미 받은 Auth 이벤트를 덮어쓰지 않는다.
- 태그 링크는 `/tags/entity`, `/tags/activity`, App route는 `/tags/:scope`다. screens 세션이 TagsPage의 `useParams` scope 소비와 실제 scoped API 호출을 소유하며 통합 뒤 실제 링크와 태그 업무를 검증해야 한다. 이 navigation 단독 head의 scoped 태그 업무 완료를 주장하지 않는다.
- Supabase changelog(2026-10-04)와 [updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser)/[Auth 이벤트](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)를 확인했다. 관련 Auth breaking change는 self-hosted SAML 주소 변경이며 이번 SDK metadata 작업에 적용되지 않는다. 설치된 auth-js에서 signOut 원격500에도 로컬 세션을 해제하는 것을 확인해 LogoutPage의 진행 중 상태를 계정 remount에서 보존하고 로컬 로그아웃/서버 다른 세션 해제 미확인을 구분했다. 인증 권한·scope는 바꾸지 않았다.

검사 환경은 Node/npm 잠금 의존성, 전용 Vite56580와 가짜 공개 Auth/API 주소56521이다. 실제 Auth SDK·App·data router·RequireAuth·ConfirmDialog를 실행하고 네트워크 응답만 Playwright route로 교체했다. Supabase/Docker/운영 API·계정·DB를 시작/수정하지 않았다.

| 명령/확인 | 로컬 결과 |
| --- | --- |
| `npm ci` | 172 packages, vulnerabilities0 |
| `npm run test:web` | 6 files/15 PASS (고정 icon unknown/ID와 탐색 분류 포함) |
| `npm run build` | 타입·Vite PASS, 기존 500kB chunk 경고 유지 |
| `npm run check:docs` | 텍스트/링크/model PASS, scripts48 PASS/1 Windows symlink privilege SKIP |
| `npm run check:boundaries`, `git diff --check` | PASS |
| `npx playwright test --config e2e/navigation-fixture.config.ts` | 실제 App fixture8 PASS; 폭320/360/390/639/640/768/1024/1440, 200% 글자와 720×450 reflow, 44px·본문 가림·키보드·초점 |

fixture는 아이콘 실패/재시도·성공 응답/새로고침·기본값/취소·공급자 metadata 보존·busy 이동/로그아웃 차단·unknown fallback·다른 계정 전환/세션 해제·dirty 탭/메뉴/back/logout 취소·원격 logout 실패 후 로그인·재로그인 아이콘 복원·가이드 복사 실패/성공을 검사한다. screenshot은 `e2e/test-results/navigation-fixtures`의 settings 폭별 PNG이며 320px 대표 화면을 직접 확인했다. 200% reflow는 실제 desktop 메뉴 확대 조작/가상 키보드/휴대폰 하드웨어 검증과 구분한다.

첫 검사 실패는 SDK가 metadata 외 null PKCE 필드를 전송하는데 fixture가 전체 요청 동등성을 요구한 기대값 오류였다. `body.data` 정확성을 검증하도록 수정했고 실패 trace/context를 `TEMP/template19-navigation-first-failure`에 보존했다. 추가 logout 실패 검사는 SDK의 로컬 해제 때문에 새 계정-keyed Outlet이 에러 안내를 remount로 없애는 실제 결함을 찾았다. Logout route 상태 보존·실제 세션 해제 안내로 수정했으며 수정 전 trace/context는 `TEMP/template19-navigation-logout-failure`에 보존했다. timeout·retry 횟수는 늘리지 않았다.

남은 필수 검증은 screens/server와 scoped 태그 계약 통합, 메인이 배정하는 격리 실제 OAuth/DB/전체 E2E, 정확한 commit 독립 리뷰·필수 CI·머지다. 실제 Google 계정 metadata 저장/다른 기기 조회와 운영 배포는 수행하지 않았다. 실제 휴대폰은 기존 사용자 이관, 스크린리더 직접 실행 제외는 유지한다.
