# 스키마 색인

정본은 [`migrations/`](../migrations)다. 이 파일은 전체 migration 적용 후의 현행 스키마 색인이며 migration을 바꾸면 함께 고친다. 프로젝트 자체 테이블은 `app` 11개·`private` 1개, 총 12개다. Supabase·Postgres·큐 확장의 시스템 테이블은 제외한다.

| 테이블 | 내용 | 주요 migration |
| --- | --- | --- |
| `app.entities` | 템플릿 업무 대상의 최신 네 속성. 검색 색인에서 제외 | `20261003194119_example_entity.sql` |
| `app.tasks` | 일회성·반복 할일의 최신 상태와 결과 기록 참조. 선택 엔터티·당시 문맥 저장 | `20261003000000_activity.sql`, `20261005162844_optional_entity_links.sql` |
| `app.records` | 일반 메모·수행 결과·변경 메모의 통합 기록. 삭제된 대상과 과거 원칙 캡처도 보존 | `20261003000000_activity.sql`, `20261004090531_current_principle_changes.sql` |
| `app.principles` | 사용자별 현재 원칙 문서. 업무 역할은 현재 문서에만 접근 | `20261003065427_principles.sql`, `20261006190000_retire_unused_contracts.sql` |
| `app.tags` | 소유자·범위별 고유 태그 | `20261003080756_tags.sql`, `20261004090531_current_principle_changes.sql` |
| `app.entity_tags` | 같은 소유자의 엔터티·태그 연결 | `20261004090531_current_principle_changes.sql` |
| `app.task_tags` | 같은 소유자의 할일·태그 연결 | `20261003081643_task_tags.sql` |
| `app.record_tags` | 같은 소유자의 기록·태그 연결 | `20261003083425_knowledge_tags.sql` |
| `app.request_results` | 요청 재전송에 첫 결과를 반환하는 멱등성 저장. 보관 7일 | `20261003000000_activity.sql` |
| `app.principle_versions` | 원칙 삭제·재생성에도 이어지는 소유자별 버전 번호. 이력 본문 아님 | `20261004090531_current_principle_changes.sql` |
| `app.search_index_state` | 검색 색인 상태·입력 해시·파이프라인·큐 메시지 참조 | `20261003090825_search_index_state.sql` |
| `private.search_embedding_budget` | HTTP·MCP 공통 사용자별 임베딩 호출 예산 | `20261003100850_search_query_budget.sql` |

`20261006210000_remove_legacy_principle_tables.sql`은 마지막 원칙 자료 이관 후 보존용 4개 테이블과 재이관 절차를 제거한다. 기존 기록과 당시 캡처는 유지한다. 과거 migration에 나오는 삭제된 객체는 현행 스키마가 아니다. 업그레이드 검증은 [`tests/migrations/`](../tests/migrations/README.md)에서 찾는다.

`20261006210100_derive_mcp_audience_from_issuer.sql`은 Auth issuer에서 MCP audience를 계산하도록 hook을 교체하고 주소 설정 테이블을 제거한다.

업무 테이블은 PostgREST에 노출하지 않는 `app` 스키마에 둔다. `app_server`는 요청별 Actor를 트랜잭션 안에서 전달하고 `app_user`로 전환하며, 복합 FK·RLS로 같은 소유자 접근을 보장한다. 색인 큐 `search_index`는 `pgmq`가 담당한다. 권한 구성은 [아키텍처](../../docs/architecture/hexagonal-review.md#권한과-직접-접근)를 참고한다.

형식 한도는 contracts와 같고 [`tests/database/parity.test.ts`](../tests/database/parity.test.ts)가 확인한다. 업무 규칙은 core에 있다.
