# 아키텍처 결정 기록(ADR)

되돌리기 비싼 구조·기술·보안 경계의 결정과 그 이유를 기록한다. ADR은 사람이 소유한다. 에이전트는 초안을 쓸 수 있지만 채택은 사람이 한다. 소유권과 분류 기준은 [ADR-0008](0008-document-ownership.md)을 따른다.

## 목록

| 번호 | 제목 | 상태 |
| --- | --- | --- |
| [0001](0001-hexagonal-shared-usecases.md) | 헥사고날 구조와 HTTP·MCP 공통 유스케이스 | 채택 |
| [0002](0002-default-tech-stack.md) | 기본 기술 구성 | 채택 |
| [0003](0003-core-rules-and-local-transactions.md) | 업무 규칙은 core, 일관성은 로컬 트랜잭션과 큐 | 채택 |
| [0004](0004-summary-single-vector-search.md) | 제목+요약 단일 벡터 검색 | 채택 |
| [0005](0005-plugin-delivery-claude-codex.md) | 에이전트 제공 단위는 플러그인, Claude·Codex 지원 | 채택 |
| [0006](0006-owner-only-access-and-separate-auth.md) | 소유자 한정 접근과 로그인·MCP 인증 분리 | 채택 |
| [0007](0007-dual-development-agents.md) | 개발 에이전트 Codex·Claude Code 공용 정본 | 채택 |
| [0008](0008-document-ownership.md) | 문서 소유권: 사람은 PRD·ADR, 에이전트는 나머지 | 채택 (머지 절은 0009로 대체) |
| [0009](0009-review-without-cross-agent.md) | 리뷰는 필수, 다른 에이전트의 교차 리뷰는 선택 | 채택 |

0001~0007은 2026-10-01 이전에 합의해 여러 문서에 흩어져 있던 결정을 소급 기록한 것이다.

## 작성 규칙

- 파일 이름은 `NNNN-영문-요약.md`, 번호는 순서대로 붙이고 재사용하지 않는다.
- 상태는 `제안`, `채택`, `대체됨(ADR-NNNN)`, `폐기` 중 하나다.
- 채택한 ADR의 결정을 바꿀 때는 본문을 고쳐 쓰지 않고 새 ADR을 만들어 이전 ADR을 `대체됨`으로 표시한다. 오탈자·링크 수정은 예외다.
- 결정의 일부만 바꿀 때는 새 ADR에 대체하는 절을 밝히고, 이전 ADR은 상태를 `채택 (… 절은 ADR-NNNN으로 대체)`로 표시하며 해당 절 첫머리에 대체 안내 한 줄만 추가한다.
- 결정의 실행 방법과 세부 기준은 가이드에 두고 ADR은 링크로 연결한다. ADR에는 결정·이유·대가만 짧게 적는다.

```markdown
# ADR-NNNN: 제목

- 상태: 제안 | 채택 | 대체됨(ADR-NNNN) | 폐기
- 날짜: YYYY-MM-DD

## 배경
## 결정
## 결과
## 관련 문서
```
