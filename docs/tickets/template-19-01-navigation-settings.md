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
