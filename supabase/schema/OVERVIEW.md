# 스키마 색인

정본은 [`migrations/`](../migrations)다. 이 파일은 전체 migration 적용 후의 현행 스키마 색인이며 migration을 바꾸면 함께 고친다. 프로젝트 자체 테이블은 `app` 11개·`private` 2개, 총 13개다. Supabase·Postgres·큐 확장의 시스템 테이블은 제외한다.

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
| `app.search_index_state` | 검색 색인 상태·입력 해시·파이프라인·큐 메시지 참조 | `20261003090825_search_index_state.sql` |
| `app.search_chunks` | 기록 본문 구간별 파생 검색 벡터 | `20261007000002_record_body_chunk_search.sql` |
| `app.user_business_settings` | 사용자별 업무 설정과 섹션 버전 | `20261008152900_business_settings.sql`, `20261008173625_business_settings_section_versions.sql` |
| `private.request_results` | 소유자별 요청 키·입력 fingerprint·성공 결과의 30일 보관 | `20261011022626_request_results.sql`, `20261011051306_request_retention_30_days.sql` |
| `private.passage_effects` | 원본 식별·성공 벡터·실제 전송 횟수·lease·fence·결과 불명을 보관하는 단일 구간 원장 | `20261011024823_external_effect_ledger.sql`, `20261011052130_flatten_passage_effects.sql` |

`20261006210000_remove_legacy_principle_tables.sql`은 마지막 원칙 자료 이관 후 보존용 4개 테이블과 재이관 절차를 제거한다. 기존 기록과 당시 캡처는 유지한다. 과거 migration에 나오는 삭제된 객체는 현행 스키마가 아니다. 업그레이드 검증은 [`tests/migrations/`](../tests/migrations/README.md)에서 찾는다.

`20261006210100_derive_mcp_audience_from_issuer.sql`은 Auth issuer에서 MCP audience를 계산하도록 hook을 교체하고 주소 설정 테이블을 제거한다.

`20261006210200_simplify_write_retries.sql`의 당시 클라이언트 UUID·객체 버전 재시도 계약은 이후 서버 ID 발급·요청 키 계약으로 대체됐다. 현재 생성 ID는 받는 테이블의 PK로 보호하며 별도 발급 원장은 없다. 요청 키·성공 결과는 완료 후 30일간 함께 보관하고 기존 Cron이 만료 행 전체를 삭제한다. 정리 지연 중 만료 결과도 재현하지 않으며 30일 후 중복 방지는 보장하지 않는다. 업무 변경·기록·필수 큐·요청 결과는 함께 확정한다.

[스펙 #300](https://github.com/kimyongin/agent-workspace-template/issues/300)의 전진 migration은 `private.request_capacity`·`private.search_effect_intents`·`private.search_embedding_budget`를 제거한다. 계정당 평생 요청 횟수와 사용자당 분당 질의 예산은 없다. 검색 작업 의도는 기존 큐가 담당하며 원본 식별정보는 `private.passage_effects`에 직접 보관한다. 실제 Pinecone 동기 호출에는 공급자 멱등 키·작업 ID·결과 조회 계약을 두지 않는다. 성공 결과 재사용·결과 불명·최대 실제 전송 5회·동시 worker 보호·현재 원본 확인은 유지한다. 상세 계약은 [설계 원칙](../../docs/architecture/principles.md#4-일관성과-실패의-의미를-명시한다)과 [검색](../../docs/architecture/search.md)을 따른다.

업무 테이블은 PostgREST에 노출하지 않는 `app` 스키마에 둔다. `app_server`는 요청별 Actor를 트랜잭션 안에서 전달하고 `app_user`로 전환하며, 복합 FK·RLS로 같은 소유자 접근을 보장한다. 색인 큐 `search_index`는 `pgmq`가 담당한다. 권한 구성은 [아키텍처](../../docs/architecture/hexagonal-review.md#권한과-직접-접근)를 참고한다.

형식 한도는 contracts와 같고 [`tests/database/parity.test.ts`](../tests/database/parity.test.ts)가 확인한다. 업무 규칙은 core에 있다.

`20261011120713_workspace_status_overview.sql`의 `app.status_overview`는 기존 소유자 RLS 아래 현재 개수와 30일 일별 값을 한 조회 snapshot에서 집계한다. `app.status_record_indexing`은 현재 소유자·본문 hash·pipeline·기록 revision에 맞는 상태만 분류하는 읽기 전용 함수다. 비공개 구간 원장 조회 권한을 넓히지 않고 기록 ID·작성 시각·상태·안전한 이유만 내부 서버 조회에 제공한다. 새 테이블이나 이력 snapshot은 만들지 않는다.
