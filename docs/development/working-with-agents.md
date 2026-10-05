# 에이전트와 일하는 방법

이 문서는 Codex와 Claude Code로 이 프로젝트를 개발하는 사람을 위한 안내다. 단계별 방법은 [Matt Pocock 공식 스킬](matt-skills.md), 제품 의미·승인된 결정·환경은 [프로젝트 개발 문맥](workflow.md)에서 확인한다. 도메인 용어는 [GLOSSARY.md](../../GLOSSARY.md)에 있다.

## 역할과 승인

사람은 제품 요구와 중요한 결정을 정한다. 에이전트는 합의한 내용을 PRD·ADR에 반영하고 작업을 계획·구현·검증한다. 대화에서 구체적으로 합의한 내용은 승인 근거이며 같은 결정을 문서나 PR 형식으로 다시 승인받지 않는다. 미정 결정과 승인 범위 밖 실행은 확인한다([ADR-0011](../adr/0011-matt-skills-and-github-workflow.md)).

- [PRD](../product/concept.md): 앱의 목적·필수 기능·사용자 시나리오.
- [ADR](../adr/README.md): 되돌리기 비싼 구조·기술·보안 결정과 이유.
- [GitHub Issues](https://github.com/kimyongin/agent-workspace-template/issues): 새 작업과 실제 진행 작업의 spec·티켓·blocker·상태·검증 근거.
- 로컬 문서: 제품 계약·환경·이전 실험과 검증 근거. 과거 티켓은 [이력 안내](../tickets/README.md)를 통해 읽는다.

## 시작하기

두 클라이언트는 같은 정본을 읽는다. Codex는 `.agents/skills/`, Claude Code는 `.claude/skills/` 연결 파일을 통해 그 정본을 사용한다. 스킬과 참조 자료는 저장소에 함께 포함되어 있다.

| 목적 | Codex 예시 | Claude Code 예시 |
| --- | --- | --- |
| 알맞은 방법 찾기 | `$ask-matt 기록 첨부 기능을 어떻게 시작할까?` | `/ask-matt 기록 첨부 기능을 어떻게 시작할까?` |
| 요구 정리 | `$grill-with-docs 기록에 사진을 첨부하고 싶어` | `/grill-with-docs 기록에 사진을 첨부하고 싶어` |
| 확정 작업 구현 | `$implement GitHub issue #N을 구현해줘` | `/implement GitHub issue #N을 구현해줘` |
| spec 전체 구현 | `$implement-spec GitHub spec #N을 구현해줘` | `/implement-spec GitHub spec #N을 구현해줘` |

호출 표기와 사용 가능한 도구는 실제 클라이언트에서 확인한다. 일반 요청도 가능하며 에이전트는 AGENTS.md(Claude Code는 CLAUDE.md)를 통해 프로젝트 문맥을 읽는다. 특정 실행 스킬을 확실히 시작하려면 위 예시처럼 이름을 지정한다. [호출 정책과 내부 연결](matt-skills.md#사람이-선택하는-시작점과-내부-사용)에 명시 시작 16개·자동 선택 가능 11개의 전체 목록이 있다. 자동 선택 가능한 스킬도 직접 요청할 수 있으며, 모든 스킬이 매번 실행되는 것은 아니다.

## 작업에 맞는 흐름

대표 흐름은 아래와 같다. 모든 요청에서 전 단계를 실행할 필요는 없다. 이미 확정한 작은 작업은 implement부터 시작한다.

```text
아이디어 → grill-with-docs → to-spec → to-tickets
                                      ├→ implement: 티켓별로 구현
                                      └→ implement-spec: task graph 전체를 배정·통합
                구현 → code-review → pr → 필요한 CI·머지
```

grill-with-docs는 질문으로 요구를 구체화하고 용어와 중요한 결정을 문서에 남긴다. 여러 세션에 걸친 작업은 to-spec으로 spec을 만들고 to-tickets로 작은 수직 기능과 blocker 관계를 정리한다. 새 작업의 spec과 티켓은 GitHub Issues에 있다([tracker 설정](../agents/issue-tracker.md)).

**implement**는 확정한 작업을 현재 세션에서 구현한다. 티켓별로 진행한다면 다음 티켓은 새 문맥에서 그 티켓을 읽고 시작할 수 있다. **implement-spec**는 여러 티켓을 task graph로 읽고 blocker가 해결된 작업을 별도 worktree의 구현 에이전트에 맡긴다. 결과는 통합 branch에 합친다. 선택은 작업의 크기와 원하는 실행 방식에 따른다.

implement는 미리 합의한 검증 지점에서 가능한 경우 tdd를 사용하고 구현 뒤 code-review를 호출한다. implement-spec은 각 구현 에이전트가 tdd를 사용하고 전체 통합 뒤 code-review를 호출한다. 구현을 맡겼다면 리뷰를 별도로 요청할 필요가 없다. 리뷰는 Standards와 Spec 관점을 분리해 diff를 검토한다. PR 본문을 쓸 때 pr 스킬로 변경 모습·실행 증거·머지 위험을 설명한다. 스킬의 리뷰 호출은 GitHub의 자동 검사(CI)와 별개다. 같은 변경의 리뷰와 필수 CI를 확인한 뒤 [머지 기준](workflow.md#머지)을 적용한다. 머지는 서비스 배포와 별개다.

단계가 바뀌거나 새 세션에서 이어갈 때는 ask-matt의 phase-boundary 판단과 handoff를 사용한다. spec·티켓·자료·commit의 포인터로 문맥을 전달하고 GitHub issue에 결과·미확인·남은 작업을 남긴다. 상세한 원본 절차는 각 스킬에서 읽는다.

## 상황별 요청

| 상황 | 요청 예시 |
| --- | --- |
| 새 기능의 의미가 불명확하다 | `$grill-with-docs 기록 첨부의 사용자 흐름을 정리하자` |
| 요구를 구현 가능한 계획으로 만들고 싶다 | `$to-spec 지금 합의한 기능을 spec으로 만들어줘`, 이어서 `$to-tickets 이 spec을 나눠줘` |
| 확정한 작은 변경을 구현한다 | `$implement issue #N의 빈 상태 문구를 고쳐줘` |
| 여러 의존 작업을 맡긴다 | `$implement-spec spec #N과 연결된 티켓을 구현해줘` |
| 재현이 어려운 버그가 있다 | `할 일 완료 뒤 결과가 사라져. diagnosing-bugs로 재현하고 고쳐줘` |
| 어디까지 했는지 알고 싶다 | `GitHub issue #N의 결과·blocker·남은 작업을 정리해줘` |
| 새 세션에서 이어간다 | `issue #N과 연결된 PR·handoff를 읽고 남은 작업을 이어가줘` |
| 다른 에이전트의 검토가 필요하다 | `PR #N을 code-review로 검토해줘` |
| 사용 경험을 개선하고 싶다 | `$retro 이번 작업에서 반복된 문제를 정리해줘` |

Claude Code에서는 사용자 호출 예시의 `$스킬`을 `/스킬`로 바꾼다. 들어온 외부 요청을 triage할 때는 [프로젝트 label 설정](../agents/triage-labels.md)을 사용한다. to-tickets가 만든 티켓은 이미 구현할 수 있게 정리된 작업이므로 다시 triage하지 않는다.

## 모델과 실제 실행

사용자 정책은 Codex `gpt-6.1-sol`, Claude Code `claude-opus-5-5`다. 역할별 기본 강도와 확인된 지원은 [선택표](agent-models.json)에 있으며, 보통 medium에서 시작해 작업의 난이도·위험·실패 근거에 따라 같은 모델의 강도를 조절한다. 다른 모델 사용은 명시적인 사람의 정책 변경이 필요하다.

실제 클라이언트에서 모델과 강도가 적용됐는지 확인한다. [모델 설정 도구](agent-model-execution.md)는 설정 확인을 돕는 보조 도구다. 스킬 사용에 추가 일일 승인 절차를 붙이지 않는다. 관측하지 못한 backend effort나 실청구액을 완료 증거로 쓰지 않는다.

동시 구현은 별도 worktree·branch·소유 범위를 사용한다. DB·포트·테스트 자료는 worktree만으로 격리되지 않으므로 [검증 환경](verification.md#공유-환경과-테스트-자료)을 확인한다. 실제 수행자와 실행 결과·미확인을 설명하고, 전달받은 보고와 직접 확인한 증거를 구분한다.

## 운영 실행

운영 배포·운영 DB 변경·비용이 드는 서비스 생성·비밀값 교체·데이터 복원은 사용자가 지시한 범위에서 수행한다. `배포해 운영`처럼 대상과 행동을 명시한 지시가 승인이다. 스킬 설치나 코드 머지만으로 운영 실행 권한이 생기지 않는다. 실제 절차와 복구 조건은 [배포](../deployment/release.md)·[운영](../operations/runbook.md) 문서에서 확인한다.
