# Template-19-02 — 탭 내부 검색·반응형 상세·메모와 변경 기록 화면

작성: 2026-10-04
상태: 진행 중
기준: main399b82b와 승인한 [Template-19](template-19-three-tab-release-ux.md)/[Template-20](template-20-current-principle-change-records.md)

## 목표와 소유

화면 세션은 src/components·src/features/entity/activity/principles/tags/search·해당 CSS/unit·e2e(탐색전용 제외)·공통 app.css의 모달 관련 절·디자인 정본의 목록/모달/폼/기록/원칙/태그 절·이 티켓을 소유한다. nav/App/Auth/settings와 모든 서버 contract 파일은 다른 세션 소유다. 공통 files는 해당 절만 수정하고 타인의 변경을 보존한다.

상단 등록·명시적 검색/지우기·추가조건/적용조건, 하단 목록의 보기/편집, URL 문맥 복귀를 통일한다. 할 일/기록은 활동의 내부 전환이다. 원칙은 current없음일때등록·현재본문편집, 과거본문/메모/시각 목록·정정/삭제를 보여주고 태그·active/inactive selector는 제거한다. 엔터티/활동 태그 선택과 관리 범위가 다르고 원칙에는 없다.

등록·보기·편집은640px미만전체화면/이상중앙40rem의 공통 shell, 확인28rem중앙, header/footer와본문스크롤분리, dirty/back/forward/reload/deeplink/focus/keyboard/safearea/긴내용을 검증한다. 현재 detail URLs는 유지한다. 보기→편집은 같은 shell 모드 전환이며 일반 폼 중첩을 만들지 않는다. 앱router 연결이 필요하면 nav소유자에게 요구한다.

편집 메모는 필수 입력, 생성/삭제 이유는 선택 입력이다. 전체업무입력+태그+메모를한번저장하고 unknownsave/versionconflict/getfailure 처리와중복요청키를 보존한다. 활동기록에 source/recordkind/change_note/대상/전후/삭제됨을 보여주며 종류별필터·검색을 제공한다. 자동기록도정정/삭제허용하되 systemfields는쓰기필드로 노출하지않는다. 원칙의 과거본문·활동메모를서로독립적으로잘못편집하지않는다.

정확한 새 serverendpoint/type는 서버소유자가 이 티켓/메인에게 먼저 인계한다. UI세션이 임의의 API를 만들어 가정하지 않는다. 기다리는동안 공통 shell과 CSS·mockfixture·기존 listcontext검토는 진행할 수 있다. 기존검색 route는호환용유지, 새검색은현재탭scope에서사용하며 엔터티keyword는그대로, 활동/원칙은키워드기본+자동옵션·서버실제필터를쓴다.

## 검증과 인계

explicit gpt-6.1-sol/high(여러 화면의 router/초안/저장/API교차경계), 오늘 desktop snapshot과 assignpreflight 확인. backend실제effort/비용은미관측이다. worktreeunit/build/docs/boundaries·응답mockfixtures에서 모든자료 CRUD/메모·목록복귀·원칙최신삭제승격/마지막삭제빈상태·두태그혼용·초안보호·실패·긴/짧은제목/한글IME·320/360/390/639/640/768/1024/1440px·200%·keyboard를검증한다.

로컬사용자DB/finDB/reset/서비스시작은금지한다. 실제전체E2E/DBHTTPMCP는메인이격리환경·immutablehead와단독소유자를배정한다. 실패자료와검사한head를보존, 가이드/티켓·소스·검증을묶어cleancommit인계, 독립리뷰·정확CI·최신main머지는메인이조정한다. 운영배포하지않는다.
