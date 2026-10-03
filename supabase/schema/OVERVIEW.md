# 스키마 색인

정본은 [`migrations/`](../migrations)다. 이 파일은 위치를 찾기 위한 색인이며 migration을 바꾸면 함께 고친다. 권한 구성의 이유는 [아키텍처의 권한과 직접 접근](../../docs/architecture/hexagonal-review.md#권한과-직접-접근)에 있다.

| 대상 | 위치 | 내용 |
| --- | --- | --- |
| `app` 스키마 | `20261003000000_activity.sql` | 업무 테이블. PostgREST에 노출하지 않으며 `anon`·`authenticated`는 접근 권한이 없다 |
| `app.tasks` | 같은 파일 | 할 일(일회성·반복). 종류별 필드 모양 CHECK, 중단 이력 `pauses`(jsonb) |
| `app.records` | 같은 파일 | 활동 기록. `(task_id, owner_id)` 복합 외래 키로 같은 소유자의 할 일만 참조 |
| `app.principles` | `20261003065427_principles.sql` | 사용자 원칙·적용 조건·현재 상태. 소유자 RLS, 대체 원칙은 같은 소유자만 참조 |
| `app.record_principles` | `20261003074639_record_principles.sql` | 기록에 적용한 원칙. 양쪽 복합 FK·소유자 RLS. 원칙 삭제는 연결만 제거 |
| `app.tags` | `20261003080756_tags.sql` | 소유자 안에서 대소문자 무시 고유 이름·낙관적 버전·소유자 RLS |
| `app.task_tags` | `20261003081643_task_tags.sql` | 같은 소유자 복합 FK·RLS. 태그 삭제는 연결만 제거 |
| `app.request_results` | 같은 파일 | `request_id` 재전송에 첫 결과를 돌려주는 요청 결과(보관 7일) |
| 큐 `search_index` | 같은 파일 | 색인 작업. 접속 역할은 전송만 가능 |
| 역할 `app_server`·`app_user` | 같은 파일 | 접속 역할(전환·큐 전송만), 사용자 역할(RLS 대상, NOLOGIN) |

형식 한도는 contracts와 같고 [`tests/database/parity.test.ts`](../tests/database/parity.test.ts)가 확인한다. 업무 규칙(완료 조건·회차·상태 전환)은 core에만 있다.
