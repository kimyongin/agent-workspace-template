# 개발과 검증 방법

## 개발 방법의 정본

단계별 작업 방법은 [공식 스킬 전체](matt-skills.md)가 소유한다. 이 문서는 프로젝트 문맥과 실제 환경을 연결한다. 이전의 강제 구현 배정·브리핑·티켓·리뷰 절차는 대체됐다([ADR-0011](../adr/0011-matt-skills-and-github-workflow.md)). 원본 절차를 이 문서에 복제하지 않는다.

## 에이전트에게 위임하기

[사람용 안내](working-with-agents.md)의 예시로 필요한 스킬을 선택한다. user-invoked와 model-invoked 구분은 원본을 유지한다. 요구가 이미 확정됐으면 해당 실행 스킬부터 시작하며 모든 작업에 전체 설계 흐름을 강제하지 않는다.

## 작업의 출발점

[START-HERE](../START-HERE.md), 실제 checkout·branch·변경과 [GitHub issue/spec](../agents/issue-tracker.md)을 확인한다. [domain](../agents/domain.md)과 [triage labels](../agents/triage-labels.md)를 사용한다. 중요한 결정은 대화의 구체적인 합의를 문서로 반영하고 미정 사항만 확인한다.

## 세션 배정과 인계

implement와 implement-spec, ask-matt의 phase-boundary 판단과 handoff를 따른다. 구현 세션이 어디인지에 대한 기존 고정 정책은 없다. 실제 실행 설정과 담당은 작업에서 확인한다.

### 세션 운영 브리핑

중요한 진행·문제·결과를 실행 주체와 근거로 설명한다. 전달받은 보고와 직접 확인을 구분한다. 원본의 pointer 중심 인계를 사용한다.

### 병렬 작업

implement-spec의 blocker·frontier·별도 worktree·통합 branch 방식을 사용한다. 공유 DB·포트·자료의 실행 담당은 [검증 환경](verification.md#공유-환경과-테스트-자료)에서 확인한다.

### 모델과 추론 강도 선택·갱신

사용자 정책은 Codex `gpt-6.1-sol`, Claude Code `claude-opus-5-5`다. 역할별 강도와 확인된 지원은 [선택표](agent-models.json)에 있다. 실제 클라이언트 지원을 확인하고 명시 모델/강도를 전달한다. [선택 검증 도구](agent-model-execution.md)는 이 설정을 확인하는 보조 도구이며 원본 개발 단계에 추가 승인·일일 절차를 강제하지 않는다. 관측되지 않은 backend effort·비용을 추정하지 않는다.

## 구현과 지침을 함께 발전시키기

제품 요구와 되돌리기 비싼 결정은 [PRD](../product/concept.md)·[ADR](../adr/README.md), 코드 판단은 [원칙](../architecture/principles.md), 도구·계약과 환경은 실제 구현을 확인한다. 원본 스킬은 실제 사용에서 확인된 문제를 근거로 수정한다. 기계적으로 검사할 수 있는 반복 결함은 retro 관점으로 기존 검사 도구에 반영한다.

## 변경 단위와 PR·리뷰

### 작게 나누기

to-tickets의 수직 기능·blocker·넓은 변경의 expand–contract를 사용한다. 작업 크기·PR 분할은 실제 기능·의존성과 검증 가능성으로 판단한다.

### 브랜치와 PR

작업 branch를 확인하고 `main`에 직접 푸시하지 않는다. 기본 branch 접두어는 `codex/`이며 사용자의 이름을 존중한다. PR 본문은 [양식](../../.github/pull_request_template.md)과 원본 pr의 증거·영향 설명을 사용한다.

### 마무리 순서

원본 implement/implement-spec/code-review/pr를 따른다. code-review의 diff가 검사하려는 변경을 포함하는지 확인한다. 원본이 HEAD를 기준으로 할 때 미커밋 변경은 그 비교에 포함되지 않으므로 검토할 snapshot을 commit하거나 명시적인 diff를 전달한다.

### 리뷰

Standards와 Spec을 구현한 작업과 분리해 검토하고 각 결과를 보존한다. 코드와 원본 요구의 차이·위험·직접 확인과 한계를 설명한다. 원본 smell heuristic은 프로젝트의 실제 기준과 구분한다.

### 머지

합의한 결정과 범위 안의 변경은 분리된 리뷰·필요 자동 검사 후 머지한다([ADR-0011](../adr/0011-matt-skills-and-github-workflow.md)). 실제 제출 head가 검사한 변경과 같고 최신 main을 포함하며 필수 `check`·`integration`이 성공했는지 확인한다. 보호 설정을 우회하지 않는다. 합의하지 않은 결정과 운영 실행은 별도 사용자 범위로 판단한다.

## 환경과 제품 계약

[검증·명령·공유 환경](verification.md)에 현재 앱이 보장하는 인터페이스와 실행 조건이 있다. 내부 테스트 구조·파일 배치가 고정된 요구는 아니며 새 인터페이스로 이동·대체할 수 있다. 제품의 권한·일관성·웹/MCP 계약·실패 의미는 실제 적절한 경계에서 확인한다.

- [기술 실험](verification.md#기술-실험)
- [최소 기반과 완결된 기능](verification.md#최소-기반과-완결된-기능)
- [기능 계약과 교차 검증](verification.md#기능-계약과-교차-검증)
- [검증 환경과 증거](verification.md#검증-환경과-증거)
- [문서 검사](verification.md#문서-검사)
- [실행 검증](verification.md#실행-검증)
- [변경 영향별 CI](verification.md#변경-영향별-ci)

## 변경과 완료 기록

진행 상태·blocker·실행 결과·PR·CI·남은 일은 GitHub issue에서 관리한다. 로컬 문서는 계약·환경·용어·실험과 이전 근거를 담는다. 지도는 현재 문서 구조·역할을 안내하며 작업 실행 로그를 누적하지 않는다. 이전 티켓의 과거 상태 문구는 최신 증거를 대조한 [이전 작업 #98](https://github.com/kimyongin/agent-workspace-template/issues/98)에서 판정한다.
