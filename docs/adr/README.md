# 아키텍처 결정 기록(ADR)

되돌리기 비싼 구조·기술·보안 경계의 결정과 이유를 기록한다. ADR의 결정권은 사람이 가지며, 에이전트는 초안과 구체적으로 합의한 변경을 작성한다([문서 소유권](0008-document-ownership.md)).

## 목록

| 번호 | 제목 | 상태 |
| --- | --- | --- |
| [0001](0001-hexagonal-shared-usecases.md) | 헥사고날 구조와 HTTP·MCP 공통 유스케이스 | 채택 |
| [0002](0002-default-tech-stack.md) | 기본 기술 구성 | 채택 |
| [0003](0003-core-rules-and-local-transactions.md) | 업무 규칙은 core, 일관성은 로컬 트랜잭션과 큐 | 채택 |
| [0004](0004-summary-single-vector-search.md) | 제목+요약 단일 벡터 검색 | ADR-0014로 대체 |
| [0005](0005-plugin-delivery-claude-codex.md) | 에이전트 제공 단위는 플러그인, Claude·Codex 지원 | 채택 |
| [0006](0006-owner-only-access-and-separate-auth.md) | 소유자 한정 접근과 로그인·MCP 인증 분리 | 채택 |
| [0008](0008-document-ownership.md) | 문서 소유권 | 채택 |
| [0011](0011-matt-skills-and-github-workflow.md) | Matt Pocock 스킬과 GitHub 작업 정본 | 채택 |
| [0012](0012-current-state-and-unified-records.md) | 최신 상태와 메모 기반 통합 기록 | 채택 |
| [0013](0013-retire-unused-contracts.md) | 실제 사용처를 기준으로 미사용 계약 제거 | 채택 |
| [0014](0014-minimal-content-model.md) | 요약 제거와 본문 하나로 쓰는 기록 | 채택 |
| [0015](0015-change-record-templates.md) | 공통 변경 기록 템플릿과 사용자 업무 설정 | 채택 |
| [0016](0016-entity-source-identity-and-restoration.md) | 발급처별 엔터티 식별과 소프트 삭제·복원 | 채택 |
| [0017](0017-dated-data-id-allocation.md) | 날짜 기반 앱 ID 예약과 기존 UUID 보존 | 예약·재시도는 ADR-0018, 발급 원장은 ADR-0019로 대체 |
| [0018](0018-server-ids-and-request-idempotency.md) | 서버 내부 ID 발급과 요청·외부 작업 멱등성 | 설계 채택, 구현 전환은 #289 |

| [0019](0019-pk-based-data-id-generation.md) | 테이블 PK 기반 서버 ID 생성 | 채택 |

| [0020](0020-typed-entity-schema.md) | 자료 종류별 JSON Schema와 불변 게시 버전 | 설계 채택, 구현은 #343 |

## 문서의 책임

ADR에는 결정·이유·대가를 담는다. 제품의 의미와 범위는 [PRD](../product/concept.md), 설계·개발 방법은 [Matt 스킬](../development/matt-skills.md)이 담당한다. 번호는 재사용하지 않는다. 합의한 변경과 과거 근거는 Git/GitHub에서 추적한다.
