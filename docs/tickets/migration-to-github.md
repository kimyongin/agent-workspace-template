# 이전 Template 티켓 판정과 GitHub 이전

이 문서는 [전환 #96](https://github.com/kimyongin/agent-workspace-template/issues/96)의 [기록 이전 #98](https://github.com/kimyongin/agent-workspace-template/issues/98)을 위한 이관 시점의 판정 기록이다. 이후 상태는 GitHub에서 확인한다. 최초 조사 기준은 clean main `2639a466feed874c0d8ddf393069c2b00661d39f`의 38개였다. 조사 중 병행 UI [PR #100](https://github.com/kimyongin/agent-workspace-template/pull/100)이 main `893294c7fc52abe506e7228f5ee7b9819bd2744c`에 머지되어, 그 delta와 신규 Template-22를 추가 대조했다. 현재 `template*.md` 39개를 모두 포함한다.

현재 상태·blocker·작업 결과는 GitHub Issues, 정확한 제출 head의 리뷰·CI·머지는 관련 PR과 checks가 소유한다. 기존 Markdown의 계약·실험·실패·제출 시점 snapshot은 근거로 보존한다. 머리말의 ‘진행 중’이나 미체크 항목만으로 작업을 다시 열지 않는다. 이전 근거를 현재 성공처럼 바꾸거나 최신 PR 결과를 오래된 문구로 덮어쓰지 않는다.

## 39개 파일 대응표

‘완료’는 각 행의 승인 범위에 대한 판정이다. 배포·실클라이언트·미관측 비용까지 모두 완료했다는 뜻은 아니다. PR 링크의 `/checks`에서 당시 검사 범위를 확인한다. 초기 문서 PR #1~29에는 현재 조회 가능한 CI 기록이 없어, 머지 사실과 로컬 문서 검증을 구분한다.

| 이전 ID와 파일 | 판정 | 최신 관련 근거 |
| --- | --- | --- |
| [Template-01](template-01-task-record-search.md) | 첫 흐름 계약과 과거 체크리스트 보존. 후속 승인 구현 완료; 제외 단계와 desktop UI를 구분 | [#63](https://github.com/kimyongin/agent-workspace-template/pull/63), [#84 checks](https://github.com/kimyongin/agent-workspace-template/pull/84/checks), [#95 checks](https://github.com/kimyongin/agent-workspace-template/pull/95/checks) |
| [Template-02](template-02-implementation-base.md) | T02-1~4 승인 범위 완료. T02-5/6 사용자 제외. 옛 Cron 보류는 후속 성공으로 해소 | [#82](https://github.com/kimyongin/agent-workspace-template/pull/82), [#84 checks](https://github.com/kimyongin/agent-workspace-template/pull/84/checks) |
| [Template-02 / T02-1 계약](template-02-t02-1-contracts.md) | 계약·실험 이력. 후속 채택 계약을 함께 읽으며 미합의 기능을 만들지 않음 | [#14](https://github.com/kimyongin/agent-workspace-template/pull/14), [#40 checks](https://github.com/kimyongin/agent-workspace-template/pull/40/checks), [#94 checks](https://github.com/kimyongin/agent-workspace-template/pull/94/checks) |
| [Template-03](template-03-docs-for-people.md) | 완료; 당시 사람용 안내·문서 정본 정리 이력 | [#28](https://github.com/kimyongin/agent-workspace-template/pull/28) |
| [Template-04](template-04-development-workflow-hardening.md) | 문서 완료. 환경 lifecycle 자동화는 사용자 방향 전환으로 재개하지 않음 | [#64 checks](https://github.com/kimyongin/agent-workspace-template/pull/64/checks), [#69 미머지 종료](https://github.com/kimyongin/agent-workspace-template/pull/69), [#70](https://github.com/kimyongin/agent-workspace-template/pull/70) |
| [Template-05](template-05-agent-model-policy.md) | 승인 정책·지원 실행 증거 완료; 대표 품질/비용 제외, backend 관측 한계 유지 | [#65](https://github.com/kimyongin/agent-workspace-template/pull/65), [#78](https://github.com/kimyongin/agent-workspace-template/pull/78), [#84 checks](https://github.com/kimyongin/agent-workspace-template/pull/84/checks) |
| [Template-06](template-06-agent-session-briefings.md) | 완료; 개발 방법 전환은 #97이 담당 | [#66 checks](https://github.com/kimyongin/agent-workspace-template/pull/66/checks) |
| [Template-07](template-07-guidance-review-followup.md) | 완료; 제출 당시 리뷰/CI 대기 문구는 새 작업 아님 | [#67](https://github.com/kimyongin/agent-workspace-template/pull/67), [#68 checks](https://github.com/kimyongin/agent-workspace-template/pull/68/checks) |
| [Template-08](template-08-mock-first-testing.md) | 승인 fast 검사 확대 완료; 모의 검사를 실제 인증·DB 증거로 승격하지 않음 | [#70](https://github.com/kimyongin/agent-workspace-template/pull/70), [#72](https://github.com/kimyongin/agent-workspace-template/pull/72), [#75 checks](https://github.com/kimyongin/agent-workspace-template/pull/75/checks) |
| [Template-08-01](template-08-01-worker-fast-tests.md) | worker 실패·동의 요청 회귀 완료 | [#71 checks](https://github.com/kimyongin/agent-workspace-template/pull/71/checks) |
| [Template-09](template-09-finishing-flow.md) | 완료; 처리 속도 개선 실측은 완료 주장하지 않음 | [#73 checks](https://github.com/kimyongin/agent-workspace-template/pull/73/checks) |
| [Template-10](template-10-priority-completion.md) | 승인 구현·기존 운영 검증 완료; desktop UI만 잔여 issue로 연결 | [#84](https://github.com/kimyongin/agent-workspace-template/pull/84), [#85 checks](https://github.com/kimyongin/agent-workspace-template/pull/85/checks), [잔여 #102](https://github.com/kimyongin/agent-workspace-template/issues/102) |
| [Template-10-01](template-10-01-fast-knowledge.md) | 기록·원칙·태그 fast 검사 완료 | [#75 checks](https://github.com/kimyongin/agent-workspace-template/pull/75/checks) |
| [Template-10-02](template-10-02-example-entity.md) | Entity 승인 구현 완료; 후속 화면도 머지 | [#77](https://github.com/kimyongin/agent-workspace-template/pull/77), [#93](https://github.com/kimyongin/agent-workspace-template/pull/93), [#95 checks](https://github.com/kimyongin/agent-workspace-template/pull/95/checks) |
| [Template-10-03](template-10-03-product-plugin.md) | 패키징·가능한 클라이언트 검증 완료; desktop UI 미확인만 연결 | [#74](https://github.com/kimyongin/agent-workspace-template/pull/74), [#84 checks](https://github.com/kimyongin/agent-workspace-template/pull/84/checks), [잔여 #102](https://github.com/kimyongin/agent-workspace-template/issues/102) |
| [Template-10-04](template-10-04-activity-return.md) | 활동 복원·진행 상한 회귀 완료 | [#79](https://github.com/kimyongin/agent-workspace-template/pull/79), [#81 checks](https://github.com/kimyongin/agent-workspace-template/pull/81/checks) |
| [Template-10-05](template-10-05-model-execution-evaluation.md) | 당시 대표 실행과 지원 범위 기록 완료; 추가 대표 품질/비용 평가는 제외 | [#76](https://github.com/kimyongin/agent-workspace-template/pull/76), [#84 checks](https://github.com/kimyongin/agent-workspace-template/pull/84/checks) |
| [Template-10-06](template-10-06-existing-release.md) | 기존 운영 적용·본인 색인·Cron 후속 완료; 전체백업/복구 미검증, 새 배포 미승인 | [#82](https://github.com/kimyongin/agent-workspace-template/pull/82), [#84](https://github.com/kimyongin/agent-workspace-template/pull/84), [#85 checks](https://github.com/kimyongin/agent-workspace-template/pull/85/checks) |
| [Template-10-07](template-10-07-plugin-behavior.md) | 실제 로컬 CLI 행동·native 인증과 Claude 웹 읽기 완료; desktop UI만 연결 | [#80](https://github.com/kimyongin/agent-workspace-template/pull/80), [#84 checks](https://github.com/kimyongin/agent-workspace-template/pull/84/checks), [잔여 #102](https://github.com/kimyongin/agent-workspace-template/issues/102) |
| [Template-10-08](template-10-08-model-resume.md) | 지원 재개 확인 완료; 당시 미지원과 후속 지원 증거를 구분 | [#78](https://github.com/kimyongin/agent-workspace-template/pull/78), [#84 checks](https://github.com/kimyongin/agent-workspace-template/pull/84/checks) |
| [Template-11](template-11-model-allowlist.md) | 정책과 업데이트 후 CLI smoke 완료; 후속 리뷰/CI 대기 문구 해소 | [#83](https://github.com/kimyongin/agent-workspace-template/pull/83), [#84 checks](https://github.com/kimyongin/agent-workspace-template/pull/84/checks) |
| [Template-12](template-12-production-verification.md) | 본인 생성/수정 색인·Cron·가능한 실제 읽기 완료. desktop UI 잔여, 휴대폰 사용자 이관·스크린리더 제외 | [#84](https://github.com/kimyongin/agent-workspace-template/pull/84), [#85 checks](https://github.com/kimyongin/agent-workspace-template/pull/85/checks), [잔여 #102](https://github.com/kimyongin/agent-workspace-template/issues/102) |
| [Template-13](template-13-ci-change-impact.md) | CI 영향 분류·필수 상태 유지와 docs 후속 완료 | [#86](https://github.com/kimyongin/agent-workspace-template/pull/86), [#88 checks](https://github.com/kimyongin/agent-workspace-template/pull/88/checks) |
| [Template-14](template-14-overview-reader-guide.md) | 개요 간소화 완료; 역할 설명 제안은 후속 승인 구현으로 해소 | [#87](https://github.com/kimyongin/agent-workspace-template/pull/87), [#88 checks](https://github.com/kimyongin/agent-workspace-template/pull/88/checks) |
| [Template-15](template-15-plugin-update-overview.md) | 문서·협업 역할·docs CI 후속 완료. 실제 게시/설치는 해당 문서 작업 범위 밖 | [#88 checks](https://github.com/kimyongin/agent-workspace-template/pull/88/checks) |
| [Template-16](template-16-overview-sessions.md) | 세션·컨텍스트 설명 완료 | [#89 checks](https://github.com/kimyongin/agent-workspace-template/pull/89/checks) |
| [Template-17](template-17-overview-flow-diagram.md) | 흐름 그림 완료 | [#90 checks](https://github.com/kimyongin/agent-workspace-template/pull/90/checks) |
| [Template-18](template-18-fin-ux-adaptation.md) | 조사와 승인 UX 적용 완료; 금융 도메인 복원·운영 배포 없음 | [#91](https://github.com/kimyongin/agent-workspace-template/pull/91), [#92](https://github.com/kimyongin/agent-workspace-template/pull/92), [#93 checks](https://github.com/kimyongin/agent-workspace-template/pull/93/checks) |
| [Template-18-01](template-18-01-fin-docs-review.md) | fin 문서 조사·구분 완료; 조사 자체를 앱 반영 증거로 보지 않음 | 승인 적용은 [#91](https://github.com/kimyongin/agent-workspace-template/pull/91)~[#93 checks](https://github.com/kimyongin/agent-workspace-template/pull/93/checks)로 완료 |
| [Template-18-02](template-18-02-navigation-guide.md) | 탐색·가이드·초안/초점 후속 완료 | [#91](https://github.com/kimyongin/agent-workspace-template/pull/91), 후속 공통 소비 [#93 checks](https://github.com/kimyongin/agent-workspace-template/pull/93/checks) |
| [Template-18-03](template-18-03-activity-reading.md) | 활동 읽기·짧은 제목 조작 영역·전체 회귀 완료 | [#92 checks](https://github.com/kimyongin/agent-workspace-template/pull/92/checks) |
| [Template-18-04](template-18-04-entity-tags.md) | 엔터티 문맥 작성·태그 사전과 최신 main 통합 완료 | [#93 checks](https://github.com/kimyongin/agent-workspace-template/pull/93/checks) |
| [Template-19](template-19-three-tab-release-ux.md) | 승인 세 탭/모달 구현 완료; 조건부 출시 항목은 배포 승인 아님 | [#94 checks](https://github.com/kimyongin/agent-workspace-template/pull/94/checks) |
| [Template-19-01](template-19-01-navigation-settings.md) | 탐색·설정·계정 프로필 완료 | [#94 checks](https://github.com/kimyongin/agent-workspace-template/pull/94/checks) |
| [Template-19-02](template-19-02-workspace-screens.md) | 업무 화면·통합 회귀·최종 CI 수정 완료 | [#94 checks](https://github.com/kimyongin/agent-workspace-template/pull/94/checks) |
| [Template-20](template-20-current-principle-change-records.md) | 현재 원칙·태그 범위·원자 변경 기록 승인 구현 완료 | [#94 checks](https://github.com/kimyongin/agent-workspace-template/pull/94/checks) |
| [Template-20-01](template-20-01-server-contracts.md) | 서버 계약·격리 이관·동시성·수정 후 통합 완료; 운영 이관은 범위 밖 | [#94 checks](https://github.com/kimyongin/agent-workspace-template/pull/94/checks) |
| [Template-21](template-21-fin-visual-parity.md) | 승인 화면·검색·타임라인, 머지와 사용자 로컬 acceptance까지 완료 | [#95 checks](https://github.com/kimyongin/agent-workspace-template/pull/95/checks), [완료 기록](https://github.com/kimyongin/agent-workspace-template/pull/95#issuecomment-5983464078) |
| [Template-22](template-22-fin-modal-details.md) | 승인 모달·문서 보기·엔터티 직접 편집·목록 구획 완료. 초기 환경 실패와 좁은 재검증 보존; root 반영은 PR 실행자 보고 | [#100 checks](https://github.com/kimyongin/agent-workspace-template/pull/100/checks), [최종 완료](https://github.com/kimyongin/agent-workspace-template/pull/100#issuecomment-5989169107) |

## 최신 완료 증거

- [#84 완료](https://github.com/kimyongin/agent-workspace-template/pull/84#issuecomment-5975318940): 리뷰/제출 head `a477b2f5f70835d128c91443060a10abb826b181`, [CI 37166996479](https://github.com/kimyongin/agent-workspace-template/actions/runs/37166996479) check·integration 성공, merge `90708ff287a82d46cdf1bfe3f6c9289f49733863`. Template-11 후속과 Template-12 실행 증거, Claude 웹 Search/Get record를 포함한다.
- [#94 완료](https://github.com/kimyongin/agent-workspace-template/pull/94#issuecomment-5981010891): 최종 독립 승인 head `6964eef4870b5358ed47f283ffd8bb05f83db42c`, [CI 37208221606](https://github.com/kimyongin/agent-workspace-template/actions/runs/37208221606) 성공, merge `87c8f93e26f73ac55536a96b570b87c83a07c67d`. Template-19/20과 자식의 완료를 명시한다. 최초 실패는 수정 후 성공과 함께 보존한다.
- [#95 완료](https://github.com/kimyongin/agent-workspace-template/pull/95#issuecomment-5983464078): 최종 독립 승인 head `a90e4687c15e01977da232c0fc8ac95edd3604fa`, [CI 37226010259](https://github.com/kimyongin/agent-workspace-template/actions/runs/37226010259) 성공, merge `2639a466feed874c0d8ddf393069c2b00661d39f`. 사용자 root main FF·clean과 실제 로컬 읽기 전용 acceptance도 완료했다. 이를 잔여 ‘로컬 반영’으로 다시 등록하지 않는다.
- [#100 완료](https://github.com/kimyongin/agent-workspace-template/pull/100#issuecomment-5989169107): 독립 승인/검증 head `9e3dbab864b2c73d4282fb608f6aed04b5909a0b`, [CI 37269856482](https://github.com/kimyongin/agent-workspace-template/actions/runs/37269856482) check·integration 성공, 브라우저148 PASS/12 SKIP, merge `893294c7fc52abe506e7228f5ee7b9819bd2744c`. 로컬 통합은79 PASS/12 SKIP/1 OS worker 실행 실패(본문 시작 전 `0xC0000409`)였고 동일 head의 해당 기록 왕복 desktop/mobile2개 재검증 PASS다. 이를 로컬 전체92개 한 번 PASS로 바꾸지 않는다. 최종 코멘트는 root FF·의존성 설치/Vite 복구·소유자 GET11개200과 모바일/desktop acceptance 완료를 보고한다. 이번 기록 이전 담당이 root 화면을 직접 검사한 증거는 아니며 실행자 보고와 CI 조회를 구분한다. fin 보호 화면 직접 비교와 운영 배포는 미수행이다.

## 실제 남은 승인 작업

[Codex desktop 제품 UI 검증 #102](https://github.com/kimyongin/agent-workspace-template/issues/102) 한 건으로 모았다. 현재 OPEN/needs-info이며 실행 완료나 구현 가능 상태가 아니다. 원래 근거는 Template-10-03/07, Template-12와 #84/#85다. 목표는 문서화한 제품 패키지·서버 revision에 대해 실제 desktop 접점의 발견·인증·원문 읽기 행동을 확인하는 것이다. CLI/SDK 결과를 desktop UI 성공으로 대신 표시하지 않는다. 설치/업데이트는 기존 지원 CLI·원본 정책을 따르며 UI 게시로 우회하지 않는다.

당시 blocker는 desktop 제품 UI/연결에 접근할 수 있는 지원 도구가 없었다는 점이다. 실행 시 실제 도구 접근을 다시 확인하고, 클라이언트 버전·정확한 source·행동·미확인을 issue에 남긴다. 기록 이전은 운영 쓰기·새 배포·비용 발생 권한을 늘리지 않는다. #98의 문서 이전 완료가 이 제품 검증의 성공을 전제로 하지는 않는다. 실제 잔여와 과거 근거를 연결하며 무관한 완료 티켓을 부모/차단 관계로 재생성하지 않는다.

## 제외·사용자 이관·증거 부족의 경계

- T02-5 도메인 전환, T02-6 새 프로젝트 초기화/출시 준비·백업 복원 연습과 대표 모델 품질/비용 평가는 사용자 제외 범위다. 전환 시험을 위해 자동 재개하지 않는다.
- 실제 휴대폰 확인은 [#85](https://github.com/kimyongin/agent-workspace-template/pull/85)의 사용자 이관, 스크린리더 직접 검증은 사용자 제외다. 통과로 바꾸지 않으며 에이전트 실행 대기열에 넣지 않는다.
- provider 전체백업/복구 가능성과 backend 실제 effort·실청구액은 미검증이다. 부분 dump·CLI metadata는 그 증거를 대신하지 못한다. 새 검증 실행 승인이 없어 실행 가능한 issue로 승격하지 않는다.
- #94/#95 운영 DB 이관·API/MCP·Pages 배포는 해당 승인 범위 밖이었다. 머지를 배포로 표시하지 않고 이전 릴리스의 실행 권한을 새 배포로 확대하지 않는다. 유료 의미검색 추가 검사도 이번 전환 범위 밖이다.
- #69 환경 lifecycle 구현은 미머지 종료·보존했고 사용자 방향은 #70 이후 fast 검사로 전환했다. 실패 로그나 옛 ‘다음 작업’만으로 되살리지 않는다.

## 파일럿 후보를 조사한 근거

기존 티켓에서 작고 이미 승인된 구현 후보는 발견하지 못했다. 조사 시점의 desktop UI 검증에는 접근 blocker가 있으며 작은 코드 수정으로 대체할 수 없다.

구체적인 새 후보는 `e2e/support.ts`의 nullable 환경값 오류 3건이다. [#99 후보 확인](https://github.com/kimyongin/agent-workspace-template/issues/99#issuecomment-5988959859)에 strict TypeScript 재현 명령·10/17/18행 TS2345와 제안 범위를 기록했다. 필수 환경값 존재 검사·명확한 오류·올바른 기존 설정의 정상 행동 보존을 제안했으며 조사 시점에는 사용자 응답을 기다렸다. 이후 선택과 실행 상태는 [파일럿 #99](https://github.com/kimyongin/agent-workspace-template/issues/99)가 소유한다. 일반 build/필수 CI 실패로 오인하지 않는다. 승인되기 전에는 업무 issue를 구현 가능 상태로 만들거나 파일럿을 시작하지 않는다.
