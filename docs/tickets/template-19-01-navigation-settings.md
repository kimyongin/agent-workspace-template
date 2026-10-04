# Template-19-01 — 세 탭 하단 탐색과 프로필 설정

작성: 2026-10-04
상태: 진행 중
기준: main399b82b와 승인한 [Template-19](template-19-three-tab-release-ux.md)/[Template-20](template-20-current-principle-change-records.md)

현재 단계: navigation19 구현·독립 리뷰 지적 수정의 로컬 검증 완료, 제출 전 인계 중. 정확한 최종 commit의 새 독립 리뷰·전체 runtime CI는 메인 담당이다. 아래 최초 구현 기록의 generation 검사만으로는 SDK 저장소 복원을 막지 못했던 점을 후속 수정 기록에서 바로잡았다.

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

## navigation19 fresh CLI 수정·제출 전 인계 (2026-10-04)

사용자 지정 구현 worker가 `codex/three-tab-navigation`의 clean `9e2c397b00a901cbba3ca06276c88938081373c6`을 확인하고 작업을 이어받았다. 기존 Desktop 구현 세션의 재개가 전역 thread limit으로 차단되어 새 CLI 직접 실행을 지정받았다. 다른 worktree의 server/screens 담당 작업은 가져오거나 되돌리지 않았다. 소유 범위는 Auth·설정과 fixture/unit, 기존 전체 E2E 소비자의 탐색 경로, ui-patterns의 탐색/설정 절과 이 티켓이다. 업무 화면·backend·PRD/ADR·main seed 문서는 수정하지 않았다. spawn·공유 DB/서비스 시작/초기화·실계정·유료 모델·push·PR·merge·운영 배포를 수행하지 않았다.

### 지적별 재현과 수정

독립 리뷰 원본은 저장소 밖 `C:/Users/yongin/AppData/Local/Temp/template19-nav-review-final.md`다. 재현은 앱 코드 수정 전에 고정 `supabase-js/auth-js 2.117.2`와 실제 provider·설정·data router를 브라우저에서 실행하고 HTTP 응답만 Playwright route로 격리했다. SDK 메서드·Auth 이벤트·저장 동작을 fake로 교체하지 않았다.

| 지적 | 수정 전 직접 재현 | 수정과 회귀 검사 |
| --- | --- | --- |
| P1 늦은 프로필 응답의 로그아웃 세션 복원 | 같은/다른 탭 logout·account switch4개 모두 실패. 응답 후 provider·getSession·localStorage가 이전 A로 돌아옴을 trace attachment에서 추출했다 | 장식용 `updateUser`를 고유 storageKey·메모리 storage의 실제 AuthClient로 격리한다. 현재 계정 generation을 각 await 뒤 검사하고 주 SDK의 현재 `refreshSession()`만 사용한다. 이전 토큰을 setSession으로 재주입하지 않는다. profile 응답과 refresh 응답 각4개, 총8개 경쟁에서 provider·SDK 조회·SDK 저장소 및 다른 탭 상태를 검사한다 |
| P1 제거된 더보기/태그/로그아웃 메뉴를 찾는 기존 전체 E2E | 기존 entity-tags 소비자를 실행해 제거된 더보기 버튼 대기 timeout을 확인했다 | 메뉴→설정→활동 태그 관리, 설정→로그아웃으로 경로를 바꾼다. 설정 경유 history를 반영하고 초안 취소·초점·세션 보존·뒤로/앞으로 이동·승인 전 logout0/승인 후1 검사를 유지한다. 태그 초안의 설정 이동과 설정 초안의 logout을 각각 검사하며 skip을 추가하지 않았다 |
| P2 같은 계정 외부 갱신이 미저장 선택을 지움 | 다른 탭 SDK updateUser로 leaf 이벤트를 보내니 이 탭의 star가 해제됨을 재현했다 | 이전 저장값과 같았던 깨끗한 선택만 외부 최신값을 따른다. dirty 선택·이동 보호는 유지하고 취소는 최신값, 로컬 성공은 확인한 응답값, 계정 변경은 keyed remount로 초기화한다. 두 탭·canonical response·취소·저장 및 기존 account change 검사를 수행한다 |

프로필 저장 원본 성공 뒤 표시 재조회가 실패하면 저장 성공과 표시 실패를 구분해 안내하고 선택을 유지한다. 고정 SDK의 refresh 실패60초 cache는 시험 시 Date만61초 진행해 재시도를 확인했다. 개인 SDK의 `autoRefreshToken:false`도 요청 시 만료검사를 막지 못하므로, 고정 SDK의90초 refresh 여유에 들어온 개인 storage snapshot은 공개하지 않는다. 실제 SDK의 AuthSessionMissingError와 네트워크0을 unit으로 확인해 공유 refresh token의 별도 회전을 막았다. SDK 버전 변경 시 이 여유와 refresh commit guard를 다시 확인해야 한다.

현재 공식 [updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser)·[Auth 이벤트](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)·[refreshSession](https://supabase.com/docs/reference/javascript/auth-refreshsession)·[클라이언트 설정](https://supabase.com/docs/reference/javascript/initializing)과 설치 SDK 소스를 확인했다. changelog 원본은 `TEMP/template19-supabase-changelog.md`로 보존했다. 관련 [self-hosted SAML 주소 변경](https://supabase.com/changelog/47093-self-hosted-supabase-api-external-url-to-include-auth-v1)은 이 작업에 적용되지 않는다. metadata는 장식용이며 서버 권한·scope·데이터 접근·서비스 키를 변경하지 않았다.

### 실행 환경·증거

전용 listener 확인 뒤 실행한 Vite56580, fixture Auth/API56521과 별도 entity 소비자 Vite55584/API55585만 사용했다. 공유 포트55480·Supabase/Docker·Edge·운영 환경은 시작하거나 초기화하지 않았다. fixture route는 브라우저 문맥별로 격리하며 실제 서버/계정으로 요청을 보내지 않는다. 원래 default Playwright desktop/mobile projects와 timeout을 상속한 저장소 밖 config는 webServer를 제거하고 baseURL만56580으로 바꿔60개 관련 fixture를 실행한다. 이는 old backend 소비 계약의 화면·탐색 회귀 증거이며 실제 OAuth/DB 또는 전체 통합 runtime의 대체 증거가 아니다.

증거의 `TEMP`는 `C:/Users/yongin/AppData/Local/Temp`다.

- 수정 전: `TEMP/template19-nav-before-auth.log`(profile race4+draft1 FAIL), `TEMP/template19-nav-before-storage.log`, `TEMP/template19-nav-before-storage-evidence.json`(provider·SDK·저장소 A 복원4개), `TEMP/template19-nav-before-entity.log`(제거 메뉴 timeout). trace/context는 `TEMP/template19-nav-before/auth-profile`, `auth-storage`, `entity-consumer`에 보존했다.
- 수정 중: `TEMP/template19-nav-after*`, `template19-nav-final*`, `template19-nav-final2*`에 실패와 후속 실행을 보존했다. 이미 열린 메뉴를 toggle한 소비자 helper와 여러 output의 status locator를 수정했다. refresh 실패 cache는 SDK의 동작대로 시계를 진행했고 timeout/retry를 늘리지 않았다. 만료 거부 검사는 실제 AuthClient만 사용하도록 줄여 SupabaseClient의 불필요한 Realtime 초기 세션 조회를 없앴다. default projects 첫 실행은59 PASS/모바일1 FAIL(`TEMP/template19-nav-default-fixtures.log`, `template19-nav-exact/artifacts`): 취소 후 열린 팝오버가 본문의 logout을 가려 클릭이 차단됐다. 문서 밖에 초점이 있으면 Escape가 탐색 root에 도달하지 않는 두 번째 실행58 PASS/2 FAIL은 `template19-nav-default-final.log`에 보존했다. 메뉴 초점·열림 유지 검사를 보존하고 진입 메뉴 버튼을 다시 눌러 닫은 뒤 본문 logout을 누르는 실제 조작 순서로 수정했다.
- 단계별 증거: `TEMP/template19-nav-final-web.log`(7 files/16 PASS), `template19-nav-final-build.log`(타입/Vite PASS, 기존500kB chunk 경고), `template19-nav-adapters-fast.log`(실제 handler/schema13 PASS), `template19-nav-final2-entity.log`(desktop/mobile22 PASS), `template19-nav-verified2-fixtures.log`(Auth/탐색19 PASS). 최종 변경 source의 default projects60 PASS는 `TEMP/template19-nav-default-final2.log`, artifact는 `template19-nav-default-final2/artifacts`다. 문서·경계·diff와 최종 exact SHA·파일 hash 대조는 `TEMP/template19-nav-handoff.json`에서 연결한다.

| 제출 전 명령 | 직접 실행 결과 |
| --- | --- |
| `npm run test:web` | 7 files/16 PASS, unhandled error 없음 |
| `npm run build` | 타입/Vite PASS, 기존500kB chunk 경고 |
| `npm run check:docs` | 문서/링크/model PASS, scripts48 PASS/Windows symlink privilege1 SKIP |
| `npm run check:boundaries`, `git diff --check` | PASS |
| `npm run test:adapters:fast` | handler/schema13 PASS, DB·SDK 전송을 대체하지 않음 |
| `npx playwright test --config C:/Users/yongin/AppData/Local/Temp/template19-nav-default-fixture.config.ts` | 원래 desktop/mobile projects의 관련3 files/60 PASS, retry0·기존 timeout 유지 |

최종 runtime source와 test·설정·lockfile hash는 `TEMP/template19-nav-final-validation-source.json`으로 고정해 커밋 후 대조한다. 같은 파일들을 커밋하며 최종 SHA·clean 상태는 저장소 밖 handoff JSON/status로 연결한다. 320px 대표 모바일 screenshot을 직접 확인했으며 자동 폭별320~1440/200%·키보드·초점 검증과 실기기 검증을 구분한다.

### CLI 모델 인계 metadata

| 사건·주체 | 명시 모델·강도와 이유 | 관측·제약 |
| --- | --- | --- |
| Desktop→새 navigation19 CLI 구현 worker | 사용자 지정 `gpt-6.1-sol` 유지, medium→high: SDK 저장소·logout/account switch/cross-tab 경쟁 수정 | global thread limit으로 기존 세션을 재개하지 않았다. 새 worker가 직접 수정·검증했으며 agent spawning 없음 |
| 당일 CLI preflight | `TEMP/template20-cli-models.json`: codex-cli0.160.0/owner-desktop-codex-cli, observedAt2026-10-04T09:06:42.608Z, fixed ID와 high 지원 | 일반 advanced/high assign은 native high 대표 실행 미완료로 거부했다. 사용자 지정 fresh direct 경로에서 같은 인자에 `--evaluate`를 사용한 preflight가 수락했다. native task-advanced 검증이나 모델 우수성/비용 완료로 표시하지 않는다 |
| 실제 실행 인계 | 요청/명시 배정 `gpt-6.1-sol`/high; CLI0.160.0, session `01a10640-f364-7f21-9685-ebb16a5c2575`의 turn_context도 model=`gpt-6.1-sol`/effort=`high` | 로컬 rollout metadata에서 직접 확인했다. 요약 metadata·SHA는 `TEMP/template19-nav-handoff.json`에 연결한다. 노출된 session effort와 backend 실제 effort·실청구액을 구분하며 backend effort·비용은 미노출/미확인. 다른 모델·fallback 호출 없음 |

### 다음 담당과 한계

메인이 최종 clean commit의 새 독립 리뷰를 배정하고 정확한 revision의 전체 CI check/integration(DB·HTTP·MCP·전체 E2E)을 확인한다. 이 티켓에 리뷰 승인을 추가하지 않았다. 현재 old backend의 활동 태그 소비자는 runnable하며 `/tags/:scope`의 실제 분리 계약·업무 구현은 server/screens의 별도 범위다. 실제 Google metadata 저장·재로그인/다른 기기 조회·실제 OAuth/DB·운영 배포는 미수행이다. 실제 휴대폰 사용자 이관과 스크린리더 직접 실행 제외는 유지한다.
