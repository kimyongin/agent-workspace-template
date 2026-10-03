# Template-09 — 로컬 리뷰부터 제출·머지까지 마무리 흐름

작성: 2026-10-04
상태: 완료
검토 기준: base `4143b8475a0935e982d5339c495a8c11f955b4b3`
선행: Template-08 PR #72 머지

## 목표와 기준 문서

사용자가 “마무리 흐름을 개선해봐”로 승인했다. 로컬 구현·필요 검증·문서 인계를 마친 커밋을 먼저 독립 리뷰하고 같은 head를 제출해, 증거만 추가하는 커밋과 불필요한 중간 CI를 줄인다. 외부 CI 검사·원격 공동 검토를 위한 조기 PR은 허용하며 최종 head의 독립 리뷰·필수 CI·최신 main 조건은 유지한다. 실제 운영 속도 개선율을 측정한 작업은 아니다.

[PRD](../product/concept.md)·[ADR-0008](../adr/0008-document-ownership.md)·[ADR-0010](../adr/0010-merge-authority.md) 안의 절차 개선이며 [마무리 순서](../development/workflow.md#마무리-순서)와 [기록 규칙](../development/workflow.md#변경과-완료-기록)이 정본이다. PRD·ADR 이탈이 필요하면 변경안을 사람에게 제시한다. 앱·테스트·CI·브랜치 보호·모델 정책·운영 배포는 변경 범위 밖이다.

## 작업과 완료 조건

- [x] workflow에 마무리 순서를 모으고 기존 리뷰·쌓은 PR·기록의 충돌을 해소한다.
- [x] 사람용 안내·용어집·티켓 형식·개발 스킬·프로젝트 지도를 짧은 요약과 정본 링크로 맞춘다.
- [x] Template-08/START-HERE의 현재 요약에 PR #72 최종 증거를 연결하고 과거 제출 snapshot·전체 fast 확대 미완료·T02-4 보류를 보존한다.
- [x] 문서·링크/앵커·diff 검사 완료.
- [x] 정확한 최종 head의 독립 리뷰·필수 check/integration CI·최신 main·머지 확인. [PR #73 완료 기록](https://github.com/kimyongin/agent-workspace-template/pull/73#issuecomment-5972743090)·[checks](https://github.com/kimyongin/agent-workspace-template/pull/73/checks)가 제출 후 증거를 소유한다.

## PR 분할 계획

| 순서 | 브랜치 | 내용과 직접 확인할 결과 | 관련 결정 |
| --- | --- | --- | --- |
| 1 | `codex/finish-flow` | 문서 하나의 작은 PR. 로컬 커밋부터 리뷰·제출·머지 순서와 증거 위치를 같은 지침으로 확인 | ADR-0008·0010 유지 |

## 검증

실제 package/CI를 확인했다. 구현 세션이 `npm ci`, `npm run check:docs`, `git diff --check`와 로컬 문서 링크·내부 앵커 검사를 수행한다. 문서 전용 변경이라 앱·DB·E2E·새 테스트는 필요하지 않다. 필수 CI의 `check`·`integration`은 기존 workflow 그대로 제출 후 메인이 최종 head에서 확인한다.

## 구현 인계와 완료 기록 (제출 snapshot)

- 승인 범위·선택 이유: 위 목표의 절차 개선. 방법 정본 한 곳과 짧은 연결을 유지해 새 자동화 도구·복잡한 상태 관리를 추가하지 않는다.
- 작업 공간: `C:/Users/yongin/.codex/worktrees/finish-flow/agent-workspace-template`, branch `codex/finish-flow`, 위 base에서 clean으로 시작했다.
- 구현·검사·실패 조사·수정·재검증 담당: `/root/implement_finish_flow`. 단독 소유는 workflow·working-with-agents·티켓 README·glossary·개발 SKILL·START-HERE·overview·이 티켓과 Template-08 현재 요약이다. 메인은 commit·독립 리뷰·push/PR·CI·머지를 조정한다.
- 모델·강도: 같은날 desktop balanced/medium implement preflight 통과를 메인이 인계하고 `gpt-6.1-sol`/`medium`을 명시 배정했다. 기존 결정 안의 문서 절차 개선이라 균형 모델·medium을 유지한다. backend 모델/effort metadata·세션 비용은 미노출이며 추정하지 않는다.
- 선행 증거: 메인이 PR #72 final head `b2e71e8c38e6df55ffc22c8978da11134a2573c5`, merge `4143b84`와 [독립 리뷰](https://github.com/kimyongin/agent-workspace-template/pull/72#issuecomment-5972463220)·[CI](https://github.com/kimyongin/agent-workspace-template/actions/runs/37146097764)·[최종 완료](https://github.com/kimyongin/agent-workspace-template/pull/72#issuecomment-5972536260)를 인계했다. 이번 구현 세션이 이전 앱 검사를 직접 실행한 결과는 아니다.
- 리뷰 인계: 메인이 로컬 커밋 후 정확한 base/head·diff·티켓/정본 위치만 별도 새 리뷰 세션에 전달한다. 로컬 커밋 hash와 독립 리뷰 결과는 제출 PR 코멘트에 연결하고, 그 head가 바뀌면 새 head로 다시 확인한다.
- 후속 최종 증거 위치: 이번 PR이 생기면 해당 PR의 완료 코멘트와 checks가 최종 head·발견 사항/처리·리뷰·CI·머지를 소유한다. 그 결과를 붙이려고 이 제출 snapshot을 다시 커밋하지 않는다.

| 시점·사건 / 세션·역할 | 직접 실행·확인 | 결과·미확인 / 다음 행동 |
| --- | --- | --- |
| 배정·문서 구현 / 구현 세션 | base·clean checkout, START-HERE·개발 SKILL·workflow·티켓 형식·ADR-0008/0010·실제 package/CI 확인 | PR 번호를 필수로 받는 기존 리뷰와 로컬 선리뷰의 충돌을 해소. 앱/CI 변경 없음 |
| 로컬 검증·인계 / 구현 세션 | `npm ci` 통과(168 packages, audit 0 vulnerabilities), `npm run check:docs` 통과(텍스트 236개·32 tests·모델 정합성), `git diff --check` 통과. 별도 일회성 Node 검사로 소유 9파일의 로컬 fragment 링크 130개를 대상 Markdown heading/HTML id와 대조해 실패 0건 | UTF-8 BOM 없음·LF·상대 링크·스킬 frontmatter 검사 포함. 앱·DB·E2E 실행 없음. 메인이 로컬 commit 후 정확한 head의 독립 리뷰·PR·기존 필수 CI·머지를 확인 |

이번 기록은 제출 준비 당시 snapshot이다. 최종 커밋·독립 리뷰·외부 CI·머지는 아직 완료로 표시하지 않는다.
