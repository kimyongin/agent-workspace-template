# 템플릿 문서 시작점

사람에게는 웹 앱(HTTP), 에이전트에게는 MCP 연결과 제품 스킬을 함께 패키징한 플러그인을 제공한다. 두 접점은 같은 업무 기능과 데이터를 사용한다.

전체 그림을 먼저 보려면 [프로젝트 지도](overview.html)를 브라우저로 연다. 처음 보는 용어는 [용어집](glossary.md)에서 찾는다. 무엇을 만들고, 어떻게 쓰고, 어떻게 개발을 시키며, 코드가 어떻게 생겼는지 그림으로 안내하는 페이지이며 정본이 아니다. 개념·역할·문서 구조가 바뀔 때 이 페이지도 갱신한다. 진행 상태·PR 완료 목록·실행 수치·검증 근거는 이 시작 문서와 기능 티켓에 기록하며 overview에 누적하지 않는다.

사람이 에이전트에게 일을 시키는 방법은 [에이전트와 일하는 방법](development/working-with-agents.md)을 따른다. 개발 에이전트에게 작업을 위임할 때는 [AGENTS.md](../AGENTS.md)와 [develop-agent-app 스킬](../.agents/skills/develop-agent-app/SKILL.md)을 사용한다. 설계·구현·리뷰·배포·운영 요청에 필요한 문서를 선택해 읽는 진입점이며 제품 사용자용 스킬과 별개다.

## 읽는 순서와 문서의 책임

이 문서 묶음은 새 프로젝트의 초기 기준이다. 도메인에 맞게 원칙·구조·기술 선택·디자인·개발 및 제품 스킬을 변경하거나 정리할 수 있다. 현재 정본은 함께 작업하기 위한 기준이며, 프로젝트가 발전하면 그 기준도 함께 갱신한다. 변경과 충돌을 다루는 절차는 [개발 방법](development/workflow.md)의 ‘구현과 지침을 함께 발전시키기’를 따른다.

| 순서 | 문서 | 답하는 질문 |
| --- | --- | --- |
| 1 | [제품 요구사항(PRD)](product/concept.md) | 어떤 앱을 만들며 사람과 에이전트는 어떻게 사용하는가? |
| 1-1 | [아키텍처 결정(ADR)](adr/README.md) | 되돌리기 비싼 구조·기술·보안 결정은 무엇이며 왜 그렇게 정했는가? |
| 2 | [코드 설계 원칙](architecture/principles.md) | 코드를 나누고 변경할 때 어떤 기준을 따르는가? |
| 3 | [아키텍처](architecture/hexagonal-review.md) | 호출·저장·권한·비동기 처리에 그 원칙을 어떻게 적용하는가? |
| 4 | [폴더 구조](design/template-structure.md) | 각 책임의 파일은 어디에 두고 새 도메인은 어디에 추가하는가? |
| 5 | [디자인 가이드](design/guide.md) | 어떤 시각 규격과 공통 상호작용으로 화면을 만드는가? |
| 6 | [개발과 검증](development/workflow.md) | 어떤 단위로 만들고 어떤 증거로 완료를 판단하는가? |
| 7 | [구현형 템플릿 티켓](tickets/template-02-implementation-base.md) | 전체 구현 순서·도메인 교체·완성 기준은 무엇인가? |
| 첫 기능 상세 | [Template-01](tickets/template-01-task-record-search.md) | 첫 할 일·기록·검색의 계약과 검증 조건은 무엇인가? |
| 8 | [배포 방법](deployment/release.md) | 새 프로젝트를 설치하고 변경을 공개·복구하는 순서는 무엇인가? |
| 9 | [운영 방법](operations/runbook.md) | 서비스 상태·큐·검색·인증·비용·백업과 장애를 어떻게 관리하는가? |
| 공통 필수 | [보안 가이드](security/guide.md) | 인증·데이터·에이전트·외부 서비스의 신뢰 경계를 어떻게 보호하는가? |
| 검색 작업 시 | [요약 기반 검색](architecture/search.md) | 요약을 어떻게 작성하고 청킹 없이 단일 벡터로 색인·검색하는가? |
| 문서 정리 | [Template-03](tickets/template-03-docs-for-people.md) | 문서를 사람이 읽기 쉽게 하고 복제된 규칙을 정본 하나로 모으는 일은 무엇인가? |

PRD와 ADR은 사람이 소유하고 나머지 문서·티켓·구현은 에이전트가 소유한다([ADR-0008](adr/0008-document-ownership.md)). 제품 의미는 PRD, 되돌리기 비싼 결정은 ADR, 코드 판단 기준은 원칙 문서, 기술 구성은 아키텍처, 코드 배치는 폴더 구조가 소유한다. 화면 원칙·시각 규격·상호작용은 디자인 가이드, 구현·검증 절차는 개발 문서, 설치·릴리스는 배포 문서, 일상 점검·장애·데이터 복구는 운영 문서가 담당한다. 기능별 상세 계약과 미정 결정·검증 결과는 티켓에서 관리한다. 같은 규칙을 여러 문서에 복제하기보다 담당 문서로 연결한다.

## 현재 상태

fin UX의 배포 화면·로컬 코드와 [fin 문서](tickets/template-18-01-fin-docs-review.md)를 비교한 [Template-18 적용안](tickets/template-18-fin-ux-adaptation.md)은 PR #91/#92/#93의 구현·독립 리뷰·필수 CI·머지를 완료했다. 최종 main은 `399b82b744f3ea9471dc335ccf5b13c972c16e93`이며 단일 Entity와 기존 업무/권한 계약을 유지한다. [탐색 완료](https://github.com/kimyongin/agent-workspace-template/pull/91#issuecomment-5977338758), [활동 완료](https://github.com/kimyongin/agent-workspace-template/pull/92#issuecomment-5977860336), [엔터티·태그 완료](https://github.com/kimyongin/agent-workspace-template/pull/93#issuecomment-5977999865)가 제출 이후의 최종 사실을 소유한다. 마지막 CI `37187276858`은 DB70·HTTP17·MCP17·웹97 PASS/9 SKIP이며 웹 통과 수에는 격리 fixture22개가 포함된다. 9 SKIP은 실제 의미 검색 조건 미충족2건과 desktop 전용 반복 검사7건이다. 활동 CI의 최초 조작 영역 결함 수정과 후속 runtime500의 관측 한계·재실행 성공은 활동 완료 기록에 보존했다. 이번 UX 변경의 운영 배포는 수행하지 않았다.

2026-10-04 후속 사용자 요청의 세 탭·탭 내부 검색·프로필/설정·반응형 상세와 출시 UX는 [Template-19](tickets/template-19-three-tab-release-ux.md)에 정리했다. 추가 설명의 현재 원칙 하나·태그 사전 분리·CRUD 편집 메모와 활동 변경 기록은 [Template-20](tickets/template-20-current-principle-change-records.md)이 의미와 승인 범위를 소유한다. 사용자의 구현 승인 후 PRD를 반영하고 서버·탐색/설정·업무 화면의 세 구현 티켓으로 나눠 구현·로컬 통합 검증을 마쳤다. 최종 정확한 통합 head의 독립 리뷰·필수 CI·머지는 제출 단계에서 확인한다. 기존 다중 활성 원칙/원칙 태그를 목표로 삼지 않으며 운영 배포는 이번 승인 범위에 포함하지 않는다.

사용자 승인 이후 [서버 구현과 독립 리뷰 수정](tickets/template-20-01-server-contracts.md)을 새 격리 template20fix에서 검증했다. 서버 checkout의 기준 소비 오류는 화면의 canonical contract 통합 build에서 해소했으며 실제 leased 환경의 전체 E2E가 진행 중이다. 서버·화면·탐색의 exact-head 독립 리뷰·필수 CI·머지는 메인 담당이고 운영 배포는 수행하지 않았다.

작은 문서·웹 문구/간격 수정의 검증을 줄이는 [Template-13](tickets/template-13-ci-change-impact.md)의 구현·서비스 없는 로컬 검사를 마쳤다. [변경 영향별 CI](development/workflow.md#변경-영향별-ci)는 필수 `check`·`integration` 이름을 유지하고 불명확한 변경은 전체 검증하며, 단순 표시 변경에도 웹 unit·타입/build와 티켓의 화면 확인을 요구한다. 독립 리뷰·실제 full CI·머지는 후속이다.

기본 기술 선택은 GitHub Pages 웹 배포, Supabase 서버·DB, Supabase Auth를 통한 Google OAuth 로그인, Pinecone Inference 임베딩 생성, Supabase pgvector 저장·검색이다. 구체적인 계약·연결 설정은 [T02-1 계약](tickets/template-02-t02-1-contracts.md), 채택한 `llama-text-embed-v2`·1024차원·cosine·초기 임계값 0.27과 실제 평가 근거는 [T02-3 이력](tickets/template-02-implementation-base.md#이력)에서 확인한다. 새 앱의 자료·질의에는 다시 평가한다.

보안 가이드는 설계·구현·배포·운영을 가로지르는 보호 기준과 검증 항목을 소유한다. 인증·데이터 접근·외부 통신을 변경하기 전에 관련 항목을 읽고 해당 기능 티켓에 적용 범위를 기록한다.

2026-10-02 Template-02 T02-1(계약·문서 정리)을 마쳤고 일부 실험은 미완료로 후속 단계에 넘겼다. 2026-10-03 T02-2(실행 기반·할 일과 기록)를 구현해 로컬 Supabase와 CI 러너에서 검증했다. 웹(React)·HTTP API·MCP 서버·DB migration·최소 CI와 core·DB·HTTP·MCP·E2E 테스트가 있다.

2026-10-03 운영 Supabase 프로젝트 `workspace-template`과 웹(https://kimyongin.github.io/agent-workspace-template/)에 첫 배포를 해 실제 Google 로그인과 MCP 연결(소유자 PC의 웹 경유)을 확인했다. claude.ai·Codex 같은 외부 클라이언트 연결은 T02-4에서 확인한다. 이 배포는 배포 문서의 준비 게이트(롤백·백업 복원·운영 점검) 이전에 한 것이라 그 항목은 T02-6에서 갖춘다(티켓의 이력).

T02-3의 원칙·태그·검색·임베딩 worker와 T02-4의 Entity·활동 목록 복원·제품 패키징/가능한 CLI 행동은 독립 리뷰·필수 CI 후 머지됐다. T02-4 보류는 2026-10-04 사용자 지시로 해제됐고 T02-5/6은 제외됐다. [Template-10](tickets/template-10-priority-completion.md)이 각 자식·최종 PR 증거를 연결한다. 최종 main `1730dc983eb10e282e28f3a200ffbd265978480e`의 [기존 운영 반영](tickets/template-10-06-existing-release.md)은 migration11/총13·worker 서버Secrets·API/MCPv6/workerv2·같은 SHA [Pages 배포](https://github.com/kimyongin/agent-workspace-template/actions/runs/37161621033)까지 완료했다. 다운로드한 실행 source49개는 검증 revision과 byte동일, API/MCP/worker 미인증401·정확metadata200·빈 큐 limit1 한 번은 전부0이다. 당시 실제 사용자 세션/업무·소량 색인 성공을 확인하지 못해 Cron을 보류했다. 이후 [Template-12 운영 검증](tickets/template-12-production-verification.md)에서 본인 기록 생성·수정의 scoped 색인과 의미 검색 최신성을 확인했고, 매분 limit5 Cron을 활성화해 실제 SQL 성공·HTTP200·빈 큐를 대조했다. 아래 첫 배포·각 티켓의 당시 이력과 현재 결과를 구분한다.

2026-10-03 [Template-03](tickets/template-03-docs-for-people.md)(사람이 읽기 쉬운 문서와 규칙 정본 정리)을 마쳤다. 용어집·티켓 작성 규칙·ADR-0010·PRD의 대상 사용자와 문제가 추가됐다.

개발 절차의 검증·세션 인계 보강은 [Template-04](tickets/template-04-development-workflow-hardening.md)에서 추적한다. 문서 절차는 PR #64의 최종 리뷰·CI·머지로 완료했으며 실제 환경 격리는 미수행이다. 후속 PR #69는 사용자 지시로 미머지 종료하고 [Template-08](tickets/template-08-mock-first-testing.md)의 포트 교체 검사로 방향을 바꿨다.

모델·추론 강도 선택과 갱신은 [개발 정책](development/workflow.md#모델과-추론-강도-선택갱신)·[현재 선택표](development/agent-models.json)·[클라이언트 실행](development/agent-model-execution.md)으로 연결한다. [Template-05](tickets/template-05-agent-model-policy.md)의 정책·도구는 PR #65, [대표 과제](tickets/template-10-05-model-execution-evaluation.md)는 PR #76, [지원 재개 확인](tickets/template-10-08-model-resume.md)은 PR #78로 독립 리뷰·CI·머지를 완료했다. 당시 Codex custom child·Claude 원 child 재개는 미지원이었고 backend 실제 effort·실청구액·광범위 신규 후보 평가는 미확인이다. CLI/desktop의 모델 지원은 서로 다르며 실제 품질·비용 평가와 실행 smoke를 구분한다. 2026-10-04 사용자 지시의 Codex GPT-6.1 Sol / Claude Opus 5.5만 사용하는 정책과 강제 검사는 [Template-11](tickets/template-11-model-allowlist.md)의 [PR #83](https://github.com/kimyongin/agent-workspace-template/pull/83)에서 독립 리뷰·CI·머지를 마쳤다. 같은 날 최초 0.147.0/2.1.140 거부 기록은 당시 이력이다. 사용자 승인 업데이트 후 0.160.0의 6.1 Sol/medium 직접 부모·child·동일 ID 재개와 2.1.289의 Opus 5.5/medium native 역할·child·동일 ID 부모/child 재개를 실제 확인해 선택표를 갱신했다. 이 후속 문서의 독립 리뷰·CI·머지는 대기한다. Codex custom 정의 selector·다른 강도의 새 실행·backend 실제 effort/실청구액·대표 품질/비용 평가는 미확인/미지원으로 남는다.

세션별 작업 목적·모델/추론 강도 선택 이유·결과와 다음 판단의 보고는 [운영 브리핑](development/workflow.md#세션-운영-브리핑)을 따른다. [Template-06](tickets/template-06-agent-session-briefings.md)의 절차와 실행 증거·리뷰/CI/머지는 PR #66으로 완료했다.

지침 후속 정리는 [Template-07](tickets/template-07-guidance-review-followup.md)에서 추적한다. 개발일 조회·재개 절차는 PR #67로 완료했다. 티켓 영역·완료 기록·설계/리뷰 역할의 [PR #68](https://github.com/kimyongin/agent-workspace-template/pull/68)은 `29071c1`로 머지됐다. 제출 후 최종 리뷰·CI 결과는 그 PR 완료 코멘트와 [checks](https://github.com/kimyongin/agent-workspace-template/pull/68/checks)가 소유한다([기록 규칙](development/workflow.md#변경과-완료-기록)).

2026-10-04 업무·어댑터 수정의 빠른 검증은 [Template-08](tickets/template-08-mock-first-testing.md)에서 진행한다. 서비스 없는 할 일 생성·완료·직렬 재시도와 HTTP/MCP handler 계약은 [PR #70](https://github.com/kimyongin/agent-workspace-template/pull/70)으로 독립 리뷰·실제 통합 CI를 통과해 `3166941`로 머지됐다([완료 증거](https://github.com/kimyongin/agent-workspace-template/pull/70#issuecomment-5971872108)). B의 worker 실패 검사와 동의 요청 생명주기 회귀도 [PR #71](https://github.com/kimyongin/agent-workspace-template/pull/71)로 독립 리뷰·전체 CI를 통과해 `a2e59dd`로 머지됐다([최종 증거](https://github.com/kimyongin/agent-workspace-template/pull/71#issuecomment-5972322159), [로컬 기록](tickets/template-08-01-worker-fast-tests.md)). A의 실제 할 일 수정·삭제/기록 보존·HTTP/MCP 입력과 오류 검사도 [PR #72](https://github.com/kimyongin/agent-workspace-template/pull/72) 최종 head `b2e71e8`의 독립 리뷰·전체 CI를 통과해 `4143b84`로 머지됐다([최종 증거](https://github.com/kimyongin/agent-workspace-template/pull/72#issuecomment-5972536260)). 기록·원칙·태그 업무와 HTTP/MCP 오류의 후속 [PR #75](https://github.com/kimyongin/agent-workspace-template/pull/75/checks)도 독립 리뷰·CI·머지를 완료했다. 실제 인증·DB·화면 검증은 각 통합 증거와 구분한다. 명령과 실제 통합의 역할은 [개발 방법](development/workflow.md#실행-검증)을 따른다. 기존 환경 격리 [PR #69](https://github.com/kimyongin/agent-workspace-template/pull/69)는 미머지 종료했고 미커밋 변경을 Git stash·저장소 밖 경로에 보존했다(위 티켓). T02-4 보류는 2026-10-04 사용자 재개 지시로 해제됐으며 기록·원칙·태그 연결의 후속 빠른 검사 완료 증거는 [Template-10-01](tickets/template-10-01-fast-knowledge.md)에 있다.

로컬 커밋·독립 리뷰를 먼저 마치고 같은 head를 제출하는 [마무리 순서](development/workflow.md#마무리-순서)는 [Template-09](tickets/template-09-finishing-flow.md)에서 정리했다. [PR #73 완료 기록](https://github.com/kimyongin/agent-workspace-template/pull/73#issuecomment-5972743090)과 [checks](https://github.com/kimyongin/agent-workspace-template/pull/73/checks)에 따라 최종 리뷰·CI·머지를 마쳤으며, 실제 운영 속도 개선을 측정한 결과는 아니다.

제품 방향·기능 계약의 정본은 PRD·ADR·[T02-1](tickets/template-02-t02-1-contracts.md)이다. [Entity](tickets/template-10-02-example-entity.md) PR #77·[활동](tickets/template-10-04-activity-return.md) PR #79/81·[제품 행동](tickets/template-10-07-plugin-behavior.md) PR #80은 최종 리뷰·CI·머지를 마쳤다. 로컬 두 CLI의 실제 단일 저장/재조회/정리와 Claude 새 native 인증·발견31·단일 읽기·정상 해제는 source8c94, Codex native 인증/발견은 source72d4의 별도 근거다. 최종0.1.1 ZIP은 cleanmain1730dc 출처를 고정했다. [Template-12](tickets/template-12-production-verification.md)는 운영 Google 로그인·본인 기록 version2와 색인·의미 검색, Claude 웹0.1.1/OAuth의 실제 검색·원문 읽기, Codex CLI native OAuth/31tools와 SDK 원문 읽기를 확인했다. 실제 휴대폰 확인은 사용자에게 이관했고 스크린리더 검증은 사용자 요청으로 이번 범위에서 제외했다. 남은 클라이언트 검증은 Codex desktop 제품 UI다. backend effort·실청구액과 provider 전체백업/복구 검증도 완료로 표시하지 않는다.

## 문서 검증과 다음 단계

Entity는 [PR #77 완료 기록](https://github.com/kimyongin/agent-workspace-template/pull/77#issuecomment-5973772100)과 [CI check/integration](https://github.com/kimyongin/agent-workspace-template/actions/runs/37155546745)에 따라 `24d1251`로 머지됐다. 메인 인계의 exact `03df8bc` 독립 승인·standalone 4/통합 18 PASS와 최종 CI 성공을 연결한다. [활동 PR #79 완료](https://github.com/kimyongin/agent-workspace-template/pull/79#issuecomment-5974064551)는 merge `ff1863d`로 반영됐다. 제품 행동 [PR #80 완료](https://github.com/kimyongin/agent-workspace-template/pull/80#issuecomment-5974516525)는 로컬 실제 양 CLI 업무·정리와 Claude native 새 인증·발견31·단일 읽기·해제를 확인했고 [최종 CI 성공](https://github.com/kimyongin/agent-workspace-template/actions/runs/37160563892) 후 `1730dc983eb10e282e28f3a200ffbd265978480e`로 머지됐다. 당시 운영 본인 계정 접근과 claude.ai 웹/mobile의 업무 성공은 확인하지 못했다. 같은 검증 SHA의 기존 운영 DB·API/MCP·worker·Pages 적용은 [Template-10-06](tickets/template-10-06-existing-release.md)에 따라 완료됐다. 최신 [Template-12](tickets/template-12-production-verification.md)는 실제 본인 업무·생성/수정 각각 indexed1·현재 해시/1024차원 벡터 일치와 Claude 웹 읽기를 확인했다. 활성 Cron의 복수 주기 HTTP200·queue0과 net Data API406 거부도 별도 관측했다. 실제 휴대폰·스크린리더는 에이전트 작업 목록에서 제외하며 Codex desktop 제품 UI 검증은 남아 있다.

문서를 바꾸면 [개발 방법의 문서 검사](development/workflow.md#문서-검사) 명령을 실행하고 결과를 해당 티켓에 기록한다. 앱·DB·브라우저 테스트는 구현 이후 해당 기능의 검증으로 수행한다.

최신 검증 기록은 [PR #84](https://github.com/kimyongin/agent-workspace-template/pull/84)에서 독립 리뷰·필수 CI를 통과해 머지됐다. 남은 작업은 Codex desktop 제품 UI 확인이며 현재 도구 접근 제약으로 미확인이다. 2026-10-04 사용자 지시에 따라 실제 휴대폰 확인은 사용자에게 이관하고 스크린리더 검증은 이번 범위에서 제외했다. T02-5/6과 대표 모델 품질·비용 평가는 사용자 제외 범위로 유지한다. 전체 증거와 미확인은 [Template-10](tickets/template-10-priority-completion.md), [Template-10-06](tickets/template-10-06-existing-release.md), 최신 [Template-12](tickets/template-12-production-verification.md)에서 추적한다. 할 일·기록·검색 등의 계약과 기술 선택은 [T02-1 기술 후보와 계약](tickets/template-02-t02-1-contracts.md)에 있다. 목표는 도메인 엔터티·화면·설정·제품 스킬을 조정해 새 앱을 시작할 수 있는 구현형 템플릿이다. 할 일·기록·사용자 원칙·RAG는 기본 기능이며, Template-01의 상세 계약과 검증을 이어서 6단계로 구현한다. 제품 스킬은 [plugins/workspace/skills/workspace](../plugins/workspace/skills/workspace/SKILL.md)에 있다. 실제 명령·CI·알림·복원 경로는 해당 단계에서 구현·검증하고 새 프로젝트의 서비스 설정과 비밀값은 독립적으로 구성한다.
