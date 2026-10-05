# Template-22 — fin 모달과 문서 보기 정리

작성: 2026-10-05
상태: 진행 중
검토 기준: `2639a466feed874c0d8ddf393069c2b00661d39f`
선행: [Template-21](template-21-fin-visual-parity.md), [PR #95 완료 기록](https://github.com/kimyongin/agent-workspace-template/pull/95#issuecomment-5983464078)

## 목표와 기준 문서

사용자가 승인한 모달·스크롤·문서 보기·구획 정리를 구현한다. [PRD](../product/concept.md)·[ADR-0008](../adr/0008-document-ownership.md) 안에서 [디자인 가이드](../design/guide.md)와 시각 규격·상호작용 정본을 함께 갱신한다. 업무 의미·권한·API·DB 계약은 유지하며 이탈이 필요하면 메인에 변경안을 보고한다.

메인이 fin 배포 사이트 `https://kimyongin.github.io/fin/#overview`에 직접 접속해 HTTP200 로그인 첫 화면을 확인했다. 보호된 내부 화면은 접속하지 못했다. 외부 증거는 `C:/Users/yongin/.codex/tmp/template22-fin-reference/{fin-live.json,fin-live-1440.png}`다. 로컬 fin source는 읽기 전용 참고이며 옛 밝은 디자인 PNG를 현재 구현의 증거로 사용하지 않는다. 이번 사용자의 제목·본문만 표시하는 보기 계약이 fin의 이전 metadata 표시보다 우선한다.

사용자가 이후 fin 로그인을 완료했으나 메인의 CUA와 computer-use 초기화가 모두 kernel assets 경로 `os error 3`으로 실패했다. 로그인한 내부 화면을 실제 조회·검수했다고 주장하지 않는다. fin source의 mobile16px/desktop24px header·body 기준선을 적용하고 템플릿의 실제 화면 검증을 별도로 수행한다.

## 확정 구현 계약

1. 모달의 복귀 수단은 공통 닫기다. 중복 `← 목록`·`목록으로` 링크/버튼은 제거한다. 저장·삭제 확인·미저장 계속 편집 등 업무 버튼, Escape·브라우저 뒤로가기·초점·목록 조건 복원을 유지한다.
2. 모든 scrollbar 표시를 숨기고 실제 세로/가로 스크롤·키보드·터치 기능을 유지한다. 넘침을 숨기는 해결책을 쓰지 않는다. native modal의 기존 배경 스크롤 잠금은 뒤 화면 보호로 유지한다.
3. 모든 모달 본문을 감싼 불필요한 panel/card/박스 장식을 제거한다. 입력 식별 경계·코드/표 스크롤 영역·확인 내용은 필요한 기능에 맞게 유지한다.
4. 할 일·기록·원칙 보기는 공통 제목·닫기와 안전하게 렌더링한 본문만 보여준다. 빈 본문 안내는 허용한다. 요약·태그·연결·상태·날짜·메타데이터·업무 행동은 보기 본문에 표시하지 않는다. 완료·반복 회차·삭제·원문 대상 확인/변경 diff/참조 조회 등은 편집 공간에서 접근할 수 있게 유지한다. 엔터티는 보기 행동 없이 편집만 제공하며 기존 detail URL도 편집으로 진입한다. 엔터티 관련 조회/작성 기능은 편집 상세에서 유지한다.
5. 할 일 행은 fin의 pending article `p-3` 기준을 적용해 왼쪽 12px 여백을 확보한다.
6. 엔터티·원칙의 상단 제목·메뉴·검색·필터 기능 패널과 하단 목록/현재 원칙/과거 이력 구획을 Activity처럼 분리한다. 필터·검색 범위·서버 cursor·타임라인 날짜 의미는 바꾸지 않는다.
7. 관련 전체 조회 보존을 위한 최소 호환 예외: 엔터티 관련 링크의 기존 `entity_id` URL 범위를 할 일·기록·검색에 공통 적용한다. 일반 활동 필터는 검색어·기록 날짜·활동 태그만 유지하고 새로운 엔터티 선택 입력을 만들지 않는다. owner GET으로 확인한 `연결된 엔터티: 이름` 문맥과 44px inline 범위 해제를 제공한다. 잘못된 UUID·owner 조회 실패는 이름을 신뢰하지 않고 실패 안내/범위 해제를 제공하며 조용히 전역 범위로 넓히지 않는다. 기존 API/DB 계약을 그대로 쓴다.

## 작업과 완료 조건

- [ ] 공통 shell의 중복 복귀/본문 장식/scrollbar를 정리한다.
- [ ] 세 문서 viewer와 편집 업무 영역을 분리하고 엔터티 편집 호환 진입을 제공한다.
- [ ] 할 일 여백과 엔터티/원칙 상하 구획을 맞춘다.
- [ ] 직접 편집·보기 왕복/저장/삭제/완료/반복/참조 조회를 보존한다.
- [ ] desktop/mobile의 긴 본문·마크다운 안전·실제 스크롤·초점·dirty/Escape/POP/목록 복원을 검증한다.
- [ ] 정본 안내·START-HERE·실행 증거를 소스와 함께 커밋하고 독립 리뷰에 인계한다.

## PR 분할 계획

`codex/fin-modal-details` 하나의 UI 기능 PR에서 shell·viewer·편집 행동 이동·목록 구획과 관련 회귀/가이드를 함께 검증한다. HTTP/MCP·DB·migration·운영 배포는 변경하지 않는다. 메인이 독립 리뷰·정확한 head CI·PR·머지와 요청한 로컬 반영을 조정한다.

## 검증

서비스 없는 기존 workspace/entity-tags fixture를 우선 사용해 변경한 DOM·동작·스크롤을 직접 확인한다. 모달 여러 소비자의 구조/행동이 바뀌므로 최종 전체 브라우저 회귀를 owned 격리 runtime에서 수행한다. unit·build·boundaries·docs·diff 검사를 수행한다. backend source는 변경하지 않으므로 같은 backend의 DB/HTTP/MCP 배치를 UI 수정 때문에 중복하지 않는다. 외부 유료 의미 검색·사용자 DB 검증·실기기/스크린리더 확인은 이번 자동 검사로 완료를 주장하지 않는다.

## 구현 인계와 실행 기록

구현 담당 implement_fin_ui는 기존 clean worktree `C:/Users/yongin/.codex/worktrees/fin-visual-parity/agent-workspace-template`에서 기준 main2639로 새 branch를 만들었다. UI/CSS·관련 E2E·이 티켓·디자인 정본·START-HERE를 소유한다. 메인은 설계·Git/리뷰/CI 통합을 소유하며 타인 변경은 보존한다. root55421/Vite55480·fin54321과 사용자 자료/설정은 변경하지 않는다. 이전 template21ui584xx는 백업을 보존하고 중단된 상태며 전체 통합 때 소유 환경만 재사용한다.

| 사건 / 담당 | 목적·기준 | 모델·강도 / 확인 | 결과·다음 행동 |
| --- | --- | --- | --- |
| 2026-10-05 / implement_fin_ui 재개 | 승인한 Template-22 UI / main2639 | balanced, 명시 gpt-6.1-sol/medium의 동일 worker 재사용. 메인이 오늘 CLI snapshot TEMP/template20-cli-models.json preflight PASS를 전달했다. 구현·메인 세션의 실제 backend 모델/effort는 별도 관측하지 않았다 | 읽기 전용 조사·branch 생성·계약 기록, 구현과 회귀 진행 |

최종 source revision·검증 수치·아티팩트·제약은 구현 후 추가한다. 독립 리뷰·CI·머지 결과는 PR 완료 코멘트/checks가 소유한다.

### 구현 결정과 초기 검증

- 모달의 확인창을 숨긴 viewer 영역 밖 body portal에 표시한다. 엔터티 연결 작성에서 편집으로 돌아갈 때 새 form이 준비된 후 작성 버튼 초점을 복원한다. 확인된 엔터티를 가진 후속 GET 실패는 기존 필드·업무 행동과 재조회 실패 안내를 유지한다.
- 표 지원을 완결하기 위해 사용자 승인 범위에서 `remark-gfm`을 현재 npm `4.0.1`로 정확 고정하고 lockfile을 갱신했다. [공식 GFM 문서](https://github.com/remarkjs/remark-gfm)와 [react-markdown 공식 사용 문서](https://github.com/remarkjs/react-markdown#use), npm version/dependency 정보로 unified11 조합을 확인했다. HTML 비실행·위험 URL 차단·이미지 자동 요청 금지·disabled 체크리스트·40열 표 가로 스크롤을 브라우저에서 직접 확인한다. 의존성 변경이므로 제출 CI는 full 분류다.
- 신규 계약 focused13개 PASS. 최초10개 중6개 실패는 숨긴 내부 ConfirmDialog footer까지 세었던 fixture selector를 주 모달 footer로 한정해 10/10 PASS로 재검증했다. 최초 반복 완료 실패는 mode 전환 직후 이전 form에 제목을 채운 fixture race로 실제 완료 DOM의 빈 제목 validation·업무 POST 미도달을 확인했고 완료 제목 대기 후 PASS다.
- 기존 focused16개는9 PASS/7 FAIL이었다. 삭제 확인창 hidden 회귀4개·연결 작성 초점 회귀2개를 수정하고 원칙 목록의 실제 fallback focus 제목 selector를 정정했다. 확인창 관련5개와 초점6개 focused가 통과했다.
- 최초 전체 workspace fixture는116 PASS/4 FAIL(4.4m)이었다. 엔터티 삭제 anchor·원칙 생성 후 URL 대기·변경 기록 저장 후 편집 재진입의 기대3개를 정정했다. 640px 소비 화면1개는 trace에서 `/tags/entity` 진입 중 `forms.tsx net::ERR_NETWORK_CHANGED`로 DOM이 로드되지 않았음을 확인했다. assertion·timeout·retry를 변경하지 않은 focused6개 재검증이 모두 PASS(18.5s)다.
- 최초 entity/tag 전체22개는20 PASS/2 FAIL. 연결 작성 성공 후 GET503에서 편집 영역까지 숨겨지던 회귀를 수정했으며 같은 desktop/mobile2개 모두 PASS(6.4s)다. 업무 참조·snapshot·diff assertion은 viewer에서 편집으로 이동하며 내용/권한/쓰기 수 검증을 유지한다.

최종 전체 검증은 위 초기 실패와 별개로 아래에 기록한다. 소유 runtime `template21ui`584xx는 기존 backup으로 복원했고 functions inspector8883을 포함한 소유 포트만 사용한다. 사용자 root554xx·fin543xx와 환경 파일은 변경하지 않았다.

실제 통합의 관련 전체 조회 검증에서 Template-21 Activity URL 정규화가 `entity_id`를 제거하던 기능 누락을 발견했다. 기존 spec의 동명 관련 행은 이동 전에도 보여 즉시 URL assertion이 우연히 통과할 수 있었다. 목적 URL과 최종 범위 보존을 명시적으로 확인해 이 증거 한계를 드러냈다. 메인은 PRD의 관련 조회 보존을 위해 위 7번 최소 호환 예외를 승인했다. task/record/search의 기존 UUID `entity_id` 입력과 owner repository 범위를 확인했으며 backend·migration은 변경하지 않았다. owner 이름 조회·범위 해제·q/태그/날짜/독립 cursor 경합을 추가 검증하고 독립 리뷰에 발견과 해결을 인계한다.

### 리뷰 인계용 source freeze — 2026-10-05 14:31 KST

이 문서를 포함한 단일 소스 커밋이 독립 리뷰 기준이다. 기준 main은 `2639a466feed874c0d8ddf393069c2b00661d39f`이며 커밋 후 정확한 새 HEAD와 최종 전체 검증 결과는 PR 본문·완료 코멘트/checks 및 아래 외부 로그에 연결한다. 이 snapshot에서 최종 HEAD의 전체 검증·독립 리뷰·CI·머지·사용자 로컬 반영은 pending이며 완료로 주장하지 않는다.

- 소스 freeze 전 전체 workspace fixture **124 PASS(2.9m)**, entity/tag fixture **22 PASS(27.5s)**, 소유 실제 통합 **80 PASS/12 SKIP(7.7m)**. 통합 SKIP은 모바일에서 중복인 desktop 전용 layout10개와 유료 의미 검색 공급자가 구성되지 않은 desktop/mobile2개다. 실제 paid-provider 품질 통과를 주장하지 않는다.
- 직전 workspace 전체는 **123 PASS/1 FAIL**이었다. 원칙 snapshot 해제 후 닫히는 editor의 이전 snapshot과 hidden viewer를 동시에 찾던 selector를 실제 서버 version2 응답·URL editor 해제·viewer 제목 확인·새 편집 GET 뒤로 정정했다. snapshot 해제의 false 입력·빈 ID 배열과 새 편집 본문에 snapshot 없음 assertion을 유지한 focused2개와 위 전체124개가 통과했다. 실패 trace는 `snapshot-failure/`에 보존했다.
- 관련 범위 fixture4개는 UUID 실패·owner404·명시 해제·검색/태그/날짜 보존·늦은 추가 페이지 응답 격리를 검증했다. 처음의 잘못된 추가 버튼 이름과 20개 행을 단일 locator로 비교하던 fixture 기대를 실제 종류별 버튼/행 배열로 정정했다. 업무 assertion·timeout·retry를 약화하지 않았다.
- 시각 검수에서 상단 엔터티 패널은 정상 inset이었다(390px 패널 x16, 제목/입력 x33). 하단은 `.list { padding:0 }`이 `.panel`을 덮어 제목 x17로 붙는 실제 결함이었다. `.list.panel`의 mobile16px/desktop24px inset을 복원하고 제목·입력·행 좌표를 측정하는 기존 desktop/mobile fixture **2 PASS(8.1s)**로 확인했다. 모달 본문 장식 제거 규칙은 원인이 아니었다.
- `test:fast` core60/adapters10/web26 PASS. 최종 inset 변경 뒤 `test:web` **26 PASS**, build PASS(549 modules), boundaries PASS, docs PASS(429개 파일 및 script48 PASS/1 조건 SKIP), `git diff --check` PASS. build의 기존 500kB chunk 경고는 남아 있으며 bundle918.78kB다.
- artifact 기준 위치는 `C:/Users/yongin/.codex/tmp/template22-artifacts/`다. `workspace-final-pass.log`, `entity-tags-final.log`, `integration-final.log`는 위 freeze 전 전체 결과이며, `final/`은 390/1440px 탭·viewer·edit·표/코드 캡처다. 최종 inset 캡처와 정확한 HEAD 전체 재검증은 별도 `head-final/`에 남긴다. 독립 reviewer는 59580/59581 mock 서비스만 사용하고 소유 통합584xx 자료를 건드리지 않는다.

backend·DB·migration 변경 없음. root/fin 서비스·자료·환경은 변경하지 않았다. 신규 의존성 때문에 승인 후 로컬 반영은 root의 기존 lock 기준 `npm ci`가 필요하며, 현재 Vite PID 보존을 우선하고 optimizer/잠금 오류는 재시작 전에 진단한다. 로컬 반영 권한과 검증은 메인이 별도 조정한다.

### 독립 리뷰 수정 — 기록 POP 편집 첫 진입 조회 실패

독립 reviewer가 `171507dd`에서 P2를 재현했다. 기록 viewer의 확인된 원문을 가진 같은 컴포넌트에서 POP으로 `edit=1&edit_from=view`에 진입할 때 재조회503이면 Form이 아직 등록되지 않아 편집 영역 안의 오류와 재시도가 숨겨졌다. 초안이 없는 이 상태에서 공통 surface에 확인된 본문·오류·조회 재시도를 표시하고 성공 재조회 뒤 새 Form을 연다. 오류 surface 닫기도 편집 복귀 의미를 유지한다. 실제 Form이 등록된 기존 편집 초안·dirty 보호는 그대로 유지한다.

최초 수정은 실패한 조회 뒤 기존 자료로 Form을 먼저 여는 방식이었고, focused2개에서 재시도 성공 version2 자료를 Form이 초기 초안으로 유지하는 문제가 확인됐다. 이 방식을 폐기하고 아직 초안이 없는 첫 진입 실패를 명시 오류 상태로 유지하는 위 수정으로 desktop/mobile focused **2 PASS(4.4s)**를 확인했다. viewer 원문 보존·업무 쓰기0·첫 실패 때 저장 없음·재시도 GET 뒤 새 제목/삭제 행동·닫기 후 viewer 제목과 버튼1개를 검사한다.

`171507dd` 첫 exact-head 전체는123 PASS/1 FAIL이었다. 실패 trace에서 원칙 첫 편집 진입 모듈 GET5개가 `net::ERR_NETWORK_CHANGED`이고 원문 GET200 외 업무 POST가 없음을 확인했다. 원본 trace/캡처와 network 진단은 `head-final/uncertain-failure/`에 보존했으며 assertion·timeout·retry 변경 없이 동일HEAD uncertain4개 focused는 모두 PASS(10.6s)였다. 다음 전체는 새 독립 리뷰 결함 수정 때문에 11개 진행에서 안전 중단했고 성공으로 기록하지 않는다. 이 수정 포함 새 HEAD의 전체126→22→92 검사와 독립 재리뷰가 다시 pending이다. 결과는 PR 증거와 새 HEAD 외부 로그로 인계한다.
