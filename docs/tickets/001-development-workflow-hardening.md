# 001 — 개발 검증과 세션 인계 절차 보강

작성: 2026-10-03
상태: 진행 중
검토 기준: `7afef78014a92cc955b9001ec6d2e61b0fe1a6ab`
선행: Template-02의 사용자 지시 1~3번 완료(PR #63 머지), 4번은 재개 전 보류

## 목표와 기준 문서

기존 구현·리뷰에서 발견한 검증 누락과 공유 환경 간섭을 개발 절차에 반영하고, 본 세션·작은 구현 세션·독립 리뷰 사이의 인계를 문서로 남긴다. 사용자가 승인한 개발 방식 보강만 수행한다.

제품 범위는 [PRD](../product/concept.md), 공용 지침은 [ADR-0007](../adr/0007-dual-development-agents.md), 소유권·실행 범위는 [ADR-0008](../adr/0008-document-ownership.md), 독립 리뷰·CI를 전제로 한 머지 권한은 [ADR-0010](../adr/0010-merge-authority.md)을 따른다. PRD·ADR은 변경하지 않으며 이를 벗어나야 하면 멈추고 사람의 승인을 받는다.

절차 정본은 [개발과 검증 방법](../development/workflow.md), 화면 복귀·초안의 정본은 [디자인 가이드](../design/guide.md)다. 개발 스킬·진입 문서·사람용 안내·프로젝트 지도는 정본 연결을 맞춘다. 새 용어를 만들지 않아 용어집은 수정하지 않는다.

## 작업

- 기능별 화면 왕복, 필드/필터의 접점·특수 분기, 반복 초기화 검증과 실패 증거 보존·원인 분류를 정착시킨다.
- 실행별 테스트 자료·정리 범위와 공유 환경의 순차 관리, 본 세션의 통합·리뷰·CI·머지 책임 및 새 세션 인계를 정한다.
- START-HERE와 Template-02의 현재 요약만 PR #63 머지·4번 보류와 맞춘다. 과거 실행 이력은 당시의 증거로 보존한다.
- 문서 반영과 실제 환경 격리 구현·운영 검증을 구분하고 후속 제약을 남긴다.

## 완료 조건

- [x] 상세 절차가 workflow 정본에 모이고 관련 문서·스킬이 링크로 연결된다.
- [x] 기존 디자인 기준·독립 리뷰·필수 CI·승인 범위를 유지한다.
- [x] 인계 필드와 작업 공간/실행 환경의 구분, 공유 환경 담당·순서가 명시된다.
- [x] START-HERE·Template-02 현재 요약의 1~3번 머지와 4번 보류가 일치한다.
- [x] 문서·공백·스킬 검사와 변경 문서의 내부 앵커 확인을 통과한다.
- [ ] 최종 PR head의 독립 리뷰·필수 CI가 통과하고 본 세션이 머지를 확인한다.

상태·체크박스·아래 기록 표는 PR 제출 시점의 기록이다. 마지막 조건의 최종 증거는 이 PR의 리뷰 코멘트·checks·머지 결과에서 확인한다. 기록을 갱신하려고 머지 후 별도 상태 PR을 반복하지 않는다.

## PR 분할 계획

| 순서 | 브랜치 | 내용 | 완료 기준 | 관련 결정 |
| --- | --- | --- | --- | --- |
| 1 | `codex/development-workflow-hardening` | 개발 방식 정본·스킬·인계 양식 및 현재 상태 정리 | 머지 후 새 기능 세션이 티켓으로 시작하고 위험별 검증·공유 환경 실행 순서를 찾을 수 있음 | ADR-0007·0008·0010 |

문서만 변경하는 작은 PR 하나로 진행한다. 앱·테스트 코드, PRD·ADR, 환경 격리 구현, T02-4 재개, 운영 배포는 범위 밖이다.

## 검증

| 검사 | 명령·확인 방법 |
| --- | --- |
| 저장소 정본 검사 | `npm run check:docs` — 인코딩·링크·frontmatter와 기존 검사기/환경 파일 회귀 검사 |
| 공백 | `git diff --check` |
| 개발 스킬 형식 | Python·PyYAML 사용 가능 여부 확인 후 skill-creator의 `quick_validate.py .agents/skills/develop-agent-app` |
| 내부 앵커·계약 | 변경 문서 링크의 대상 제목/HTML id 직접 대조, 승인 범위와 관련 정본·상태 기록 수동 확인 |
| 필수 CI·독립 리뷰 | PR의 최종 head 기준 `check`·`integration`과 별도 새 리뷰 세션의 결론 확인 |

문서 변경이므로 새 테스트나 로컬 앱 전체 검증은 추가하지 않는다. 기존 필수 CI는 유지한다. 문서 검사는 운영 서비스의 실제 동작이나 병렬 환경 격리 구현을 검증한 증거가 아니다.

## 구현 인계와 완료 기록

| 필드 | 이번 작업의 인계 |
| --- | --- |
| 목표·승인 범위 | 2026-10-03 본 대화에서 개발 방식 보강안을 검토한 뒤 사용자가 “좋아, 반영하자”고 지시한 범위. 본 세션의 인계로 확인했으며 이전 승인 범위의 확대 없음 |
| 기준·작업 공간 | base `7afef78014a92cc955b9001ec6d2e61b0fe1a6ab`, `codex/development-workflow-hardening`, `C:\Users\yongin\projects\agent-workspace-template`, 시작 시 깨끗한 working tree |
| 담당 변경 | 구현 서브세션만 tracked 문서·스킬을 편집. 본 세션은 읽기·조정·통합·독립 리뷰·CI 확인·머지·브리핑 담당 |
| 계약·의존성 | 위 정본과 [Template-02 이력](template-02-implementation-base.md#t02-3--사용자-원칙rag지식-연결). 다른 병렬 구현 없음 |
| 환경·순서 | 로컬 문서 검사만 사용, Python 3.13.2·PyYAML 6.0.2·Node 24.15.0 확인. DB·서버·setup·migration 조작 없음 |
| 결과·다음 행동 | 아래 검사 결과와 PR의 최종 head를 본 세션에 전달. 독립 리뷰 수정은 이 구현 세션에서 수행 |

| 단계 | 상태 | revision / 변경 | 검증 명령·결과 | 남은 작업 |
| --- | --- | --- | --- | --- |
| 1 | 구현(리뷰 대기) | 위 base 이후 이 PR의 문서 diff, 최종 head는 PR에서 확인 | `npm run check:docs` 텍스트 216개·기존 회귀 13/13 통과; `git diff --check` 통과; `python -X utf8 C:/Users/yongin/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/develop-agent-app` 통과; 내부 앵커 38개 대상 제목/id 일치 | 정확한 head의 독립 리뷰·필수 CI·머지 |

### 이력과 환경 제약

- 2026-10-03: [PR #63](https://github.com/kimyongin/agent-workspace-template/pull/63)이 `7afef78014a92cc955b9001ec6d2e61b0fe1a6ab`으로 머지되었음을 조회했다. T02-4 재개나 운영 배포로 확장하지 않는다.
- 보강 근거: Template-02 이력의 추가 페이지 복원·필터 전달·회차 분기·MCP schema 누락, fixture 범위 오류, env 재저장에 따른 `WorkerAlreadyRetired`다. 이력은 수정하지 않고 일반 절차로 연결했다.
- [`scripts/local-env.mjs`](../../scripts/local-env.mjs)는 같은 byte이면 쓰기를 생략하며 기존 mtime 회귀 검사가 있다. 이번 작업은 그 구현을 다시 만들지 않고 초기화 변경의 검증 방법을 정착시켰다.
- [`scripts/test-all.mjs`](../../scripts/test-all.mjs)는 고정 로컬 프로젝트·포트와 setup 계정을 공유하며, 프로젝트 이름으로 Edge Runtime을 정리해 다른 함수 서버에도 영향을 줄 수 있다. 별도 worktree만으로 격리되지 않으므로 공유 환경 실행 담당이 순차 관리한다.
- 남은 과제: 작업별 프로젝트·포트·계정·DB·함수 서버·결과/로그·정리 범위를 분리하는 실제 환경 격리 구현과 동시 실행 검증. 이번 PR에서 구현하거나 수행하지 않았다. 실제 운영·클라이언트 검증도 미수행이다.
- 문서 정본 검사·스킬 검증·앵커 대조를 통과했다. 스킬의 name·description·UI metadata를 변경하지 않았으며 Claude 연결 파일도 그대로다. 내용 변경의 형식/정본 연결 검증이며 독립 에이전트 행동 실험은 수행하지 않았다.
