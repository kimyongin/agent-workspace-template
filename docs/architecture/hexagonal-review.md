# 기본 기술 구성과 헥사고날 설계

## 문서의 책임

이 문서는 [코드 설계 원칙](principles.md)을 실행 구조에 적용한다. TypeScript 도메인 모델·유스케이스와 Supabase 어댑터를 사용하며, 호출 경계·저장·권한·비동기 처리·검색의 기술 책임을 정의한다. 할 일·기록·검색의 상세 API는 [Template-01](../tickets/template-01-task-record-search.md), 구현 순서와 미정 기술 선택은 [Template-02](../tickets/template-02-implementation-base.md)가 소유한다.

## 기본 기술 구성

기본 플랫폼 선택의 결정은 [ADR-0002](../adr/0002-default-tech-stack.md)가 소유하고 이 표는 각 서비스의 역할을 설명한다. 바꾸려면 ADR-0002를 대체하는 ADR을 사람이 승인한 뒤 관련 가이드·스킬·검증을 함께 갱신한다.

| 영역 | 기본 선택 | 역할 |
| --- | --- | --- |
| 웹 배포 | GitHub Pages | 정적 웹 빌드 배포 |
| 서버·데이터 기반 | Supabase | HTTP/MCP·worker, Postgres·큐·세션 관리 |
| 사용자 로그인 | Google OAuth + Supabase Auth | Google 계정 로그인과 앱 세션 발급 |
| 임베딩 생성 | Pinecone Inference | 기록 및 검색 질의를 벡터로 변환 |
| 벡터 저장·검색 | Supabase Postgres/pgvector | 사용자 권한 범위의 벡터 저장과 검색 |

Pinecone은 임베딩 생성 공급자로 사용하며 Pinecone 벡터 인덱스 생성은 기본 구성에 포함하지 않는다. 구체적인 모델·차원·API 버전은 품질·입력 한도·비용 검증 후 확정한다.

### Supabase 기능별 역할

| 기능 | 담당하는 역할 |
| --- | --- |
| Postgres | 도메인 원본 저장, 제약과 로컬 트랜잭션 |
| Auth | Google OAuth 로그인을 기본 제공하고 앱 세션 관리. MCP 인증 연동과 실제 클라이언트 검증은 첫 계약에서 확정 |
| RLS·DB 권한 | 사용자 격리와 업무 유스케이스를 우회하는 직접 쓰기 제한 |
| Edge Functions | HTTP·MCP 진입점과 비동기 worker 실행 |
| Queues(pgmq) | 무거운 작업의 보관·소비·재전달. 검색 색인은 첫 사용처 |
| Cron + pg_net | 내부 worker의 주기적 실행 |
| pgvector + SQL 검색 | 벡터 저장과 키워드·유사도 검색 |
| Vault / 함수 Secrets | DB의 worker 호출 및 함수의 외부 공급자 인증 설정 |

Storage와 Realtime은 실제 첨부·자동 갱신 요구가 생길 때 추가한다. 웹은 GitHub Pages에 배포한다. 새 프로젝트의 서비스 설정과 비밀값은 독립적으로 구성한다.

## Google 로그인과 MCP 인증

기본 웹 로그인은 웹→Supabase Auth→Google 인증→Supabase callback→웹 복귀 흐름이다. 앱의 사용자 식별과 서버 권한은 검증된 Supabase 사용자 문맥을 따른다. Google의 access token을 앱 업무 API나 MCP의 인증 토큰으로 그대로 사용하지 않는다.

플러그인의 MCP OAuth는 에이전트가 앱에 접근할 권한을 얻는 별도 흐름이다. 사용자 확인 단계에서 Google 로그인 기반 앱 계정을 사용할 수 있지만, MCP 토큰 발급·audience·scope·동의 화면과 클라이언트 callback은 별도 계약으로 확정한다. Google 로그인 성공만으로 MCP 연결을 검증했다고 하지 않는다.

MCP OAuth는 Supabase Auth의 OAuth 2.1 서버를 권한 서버로 쓴다. 클라이언트는 동적 등록과 PKCE로 토큰을 받고, 사용자는 웹 앱의 `/oauth/consent` 화면에서 Google 로그인 세션으로 승인한다. Custom Access Token Hook은 `client_id`가 있는 토큰의 `aud`를 MCP 서버의 정식 URL로 바꾼다. MCP 서버는 그 audience만, 웹용 HTTP API는 `authenticated`만 받으므로 두 토큰은 서로의 진입점에서 거부된다. MCP 서버는 RFC 9728 metadata로 권한 서버를 알린다. 이 방식은 [T02-1 실험](../tickets/template-02-t02-1-contracts.md#실험-결과-작업-9)에서 로컬 Supabase와 Claude Code·Codex로 확인했다.

## 호출과 의존성

```text
웹 → HTTP 어댑터 ─────┐
                      ├→ 유스케이스 → 도메인 모델
에이전트 → MCP 어댑터 ┘       └→ 포트 → Supabase / 임베딩 어댑터

Cron → 내부 Edge worker → 해당 작업의 유스케이스 → 필요한 포트
```

위 도식은 실행 시 호출 흐름이다. 코드 의존성은 HTTP/MCP 어댑터→application→domain과 Supabase/외부 서비스 어댑터→core의 포트 방향이다. core가 구체적인 어댑터를 import하지 않는다.

HTTP와 MCP는 같은 유스케이스를 직접 호출한다. 서로의 endpoint를 다시 호출하지 않는다. 공개 진입점은 api와 mcp, 첫 비동기 작업 진입점은 search-index다. api는 /tasks, /records, /search 같은 목적별 경로를 가진다. 새로운 비동기 작업의 진입점은 실제 기능이 추가될 때 정한다.

core는 SDK, React, Request/Response, Deno.env, 직접 SQL·네트워크에 의존하지 않는다. adapters가 core의 계약에 의존한다. bootstrap은 검증된 사용자 문맥과 실제 구현을 요청별로 조립한다. 웹은 제품 데이터에 직접 .rpc/.from 쓰기를 하지 않는다. Auth SDK의 로그인/세션 처리는 별개다.

## 책임

| 위치 | 소유하는 책임 |
| --- | --- |
| domain | Task·ActivityRecord·Principle, 내용 검증, 일회성 할 일의 완료 조건, 반복 할 일의 회차 계산·회차 상태·중단/재개 조건 |
| application | 인증된 행위자의 작업 범위 확인, 읽기→도메인 판단→저장 순서, 트랜잭션 경계, 후속 비동기 작업 결정, 검색 fallback |
| ports | 필요한 저장·조회·트랜잭션·큐·검색·임베딩 계약; SDK와 SQL 타입을 노출하지 않음 |
| Supabase 어댑터 | SQL·데이터 매핑·같은 연결의 트랜잭션·조건부 쓰기·잠금·큐 전달·pgvector 조회 |
| DB | 데이터·FK/UNIQUE/CHECK·RLS/권한·원자성·경쟁 방지. 업무 상태 엔진과 완료 조건을 프로시저에 구현하지 않음 |
| auth 어댑터 | 세션/OAuth 토큰 검증과 안전한 Actor 생성 |

DB 제약과 보안 정책, pgmq 같은 인프라 함수는 유지한다. SQL 함수나 트리거 자체를 금지하는 규칙이 아니다. 업무 규칙의 두 번째 구현을 DB에 만들지 않는 것이 기준이다.

## 로컬 트랜잭션

서버 Supabase 어댑터가 PostgreSQL 연결을 확보하고 하나의 트랜잭션으로 유스케이스의 저장을 실행하는 방식을 우선한다. Edge Functions에서 Postgres.js로 연결하며, 연결이 짧은 환경이므로 Supavisor 트랜잭션 모드와 `prepare: false`를 쓴다. 역할과 문맥 전달은 아래 '권한과 직접 접근'의 방식을 따른다([T02-1 실험](../tickets/template-02-t02-1-contracts.md#실험-결과-작업-9)). 여러 supabase-js HTTP 호출을 하나의 트랜잭션처럼 취급하지 않는다.

설명용 transaction 포트는 콜백 안의 모든 저장·큐 등록이 같은 연결을 사용한다는 계약을 가진다. 실제 범위는 첫 할 일 완료 기능에 한정하며 모든 시스템을 위한 Unit of Work 프레임워크를 만들지 않는다.

완료 예시: 동일 요청의 성공 결과 확인 → 사용자 소유 할 일 읽기와 필요한 잠금 → 도메인 모델의 완료 판단 → 할 일·결과 기록·색인 큐 메시지·필요한 요청 결과 저장 → 커밋. 실패하면 모두 롤백한다. 기대 버전 검사 또는 잠금으로 읽기와 저장 사이 경쟁을 다루되 최종 조합은 계약에서 정한다. 외부 임베딩 호출을 이 트랜잭션 안에서 수행하지 않는다.

업무 판단에 사용한 시간은 검증 가능한 값으로 core에 전달한다. 서로 다른 요청의 충돌과 같은 요청의 재전송은 별도 문제다. 중복 생성이 문제인 작업에만 안정적 요청 키/고유 ID와 결과 재사용을 적용하고 모든 변경에 새 이력/영수증 테이블을 강제하지 않는다.

## 권한과 직접 접근

보호 규칙과 부정 경로 검증의 정본은 [보안 가이드](../security/guide.md)다. 이 절은 그 기준을 서버·DB 연결 구조에 적용한다.

업무 로직을 DB 밖으로 옮기므로 일반 사용자에게 상태를 직접 쓰는 DB API를 열어두면 유스케이스를 우회할 수 있다. 제품 데이터 변경은 인증된 HTTP/MCP 경로를 통하게 하고 테이블/저장 함수 권한을 제한한다. RLS와 참조 제약은 유지한다.

직접 Postgres 연결에는 사용자 JWT의 RLS 문맥이 자동 적용되지 않는다. 다음 역할 구성과 트랜잭션 한정 문맥 전달을 쓴다([T02-1 실험](../tickets/template-02-t02-1-contracts.md#실험-결과-작업-9)).

| 역할 | 권한 | 사용 |
| --- | --- | --- |
| 접속 역할(예: `app_server`) | LOGIN. 업무 테이블 권한 없음, superuser·BYPASSRLS 아님. 사용자 역할로 전환과 큐 전송만 가능 | 서버 어댑터의 연결 |
| 사용자 역할(예: `app_user`) | NOLOGIN. 업무 테이블 권한과 RLS 정책의 대상. Supabase API에 노출하지 않음 | 트랜잭션 안에서만 전환 |
| `authenticated`·`anon` | 업무 테이블·큐 권한 없음 | 일반 사용자의 직접 쓰기 차단 |

트랜잭션마다 `set_config('request.jwt.claims', <검증된 Actor>, true)`와 `set local role <사용자 역할>`을 실행하고, 큐 전송은 같은 트랜잭션에서 `reset role` 뒤에 한다. 트랜잭션 한정 설정이라 커밋·롤백 후 연결에 문맥이 남지 않는다. 세션 단위 설정은 연결 재사용 때 다른 요청에 문맥을 넘기므로 쓰지 않는다. 앱의 실제 테스트에서도 RLS 적용과 요청 사이 문맥 해제를 확인한다. 접속 역할이 RLS를 우회하는지도 검사한다. 입력 user_id를 신뢰하거나 관리자 권한을 사용했다는 이유로 격리가 된다고 주장하지 않는다.

큐와 worker는 내부 권한으로 분리하고 사용자/에이전트가 임의 큐를 소비·삭제하지 못하게 한다. 초기 owner-only와 추후 공유의 권한은 별도 계약으로 관리한다. OAuth의 issuer/audience/scope 및 실제 클라이언트 동의 흐름도 별도 검증한다.

## 큐 기반 비동기 작업

시간이 오래 걸리거나 외부 응답 대기·재시도가 필요한 작업은 큐로 분리한다. 작업의 입력과 완료 조건, 멱등성 기준, 재시도·영구 실패 처리 및 진행 상태를 목적에 맞게 정의한다. 데이터 가져오기·변환·외부 동기화 등에도 같은 원칙을 적용할 수 있다. 모든 작업을 실행하는 범용 엔진을 선행 구축하지 않고 구체적 소비자에서 공통 처리만 추출한다.

관련 원본 변경과 작업 등록은 같은 로컬 트랜잭션으로 처리한다. 작업 등록 성공과 실제 처리 완료는 구분하며, 업무상 필수 결과가 생기기 전에는 해당 업무를 완료로 표시하지 않는다. 외부 서비스 변경은 로컬 DB 트랜잭션으로 롤백되지 않으므로 해당 작업의 재시도/중복/복구 계약이 필요하다. 긴 작업은 실행 환경에 맞는 단위로 나눈다.

### 첫 활용 사례: 검색 색인

1. 유스케이스가 검색 입력 변경을 판단한다. 원본 저장과 메시지 등록을 같은 Postgres 트랜잭션으로 커밋한다. pgmq가 같은 DB에 있으므로 별도 메시지 브로커·복제 Outbox 테이블을 선행 도입하지 않는다.
2. 메시지에는 원본 종류·ID·소유자·검색 입력 해시/버전을 둔다. durable 기본 큐를 사용하며 본문 전체를 불필요하게 복제하지 않는다.
3. Cron/pg_net이 내부 Edge worker를 주기적으로 호출한다. 큐는 pull 기반이므로 메시지를 넣었다고 worker가 자동 실행되는 것은 아니다. 주기·배치 크기·동시성은 처리량에 맞춰 정한다.
4. worker는 visibility timeout을 두고 메시지를 읽는다. pop으로 처리 전에 삭제하지 않는다. 원본 존재/권한/버전을 확인하고 외부 임베딩 API를 호출한다.
5. 짧은 DB 트랜잭션에서 현재 원본/모델 버전을 다시 확인하고 벡터를 조건부 upsert하며 메시지를 삭제 또는 완료 보관한다. 오래된 작업과 삭제된 원본은 되살리지 않는다.
6. 중간 종료나 일시 실패는 메시지가 다시 보이게 해 재시도한다. 재전달을 전제로 벡터 쓰기를 멱등적으로 처리한다. 영구 실패·입력 오류·할당량 소진은 제한 재시도 후 확인/재처리 경로를 둔다. 큐가 있다는 이유로 무한 재시도하지 않는다.

큐의 visibility 보장은 전체 임베딩 API 호출의 exactly-once 실행이나 과금 중복 방지를 의미하지 않는다. 목표는 원본에 맞는 현재 벡터를 중복 효과 없이 유지하는 것이다. 원본 저장은 즉시, 의미 검색 반영은 지연될 수 있다. 검색 불가/색인 중 상태와 키워드 fallback은 공통 search 유스케이스가 처리한다.

## RAG

검색 입력은 제목과 요약을 합친 하나의 문자열이며 항목당 현재 벡터 하나를 관리한다. 본문 청킹·자동 절단·청크 점수 병합을 두지 않는다. 사용자 또는 외부 에이전트가 요약을 작성하고, 본문은 키워드 검색과 상세 조회에 사용한다. 입력·갱신·품질 검증의 정본은 [요약 기반 단일 벡터 검색](search.md)이다. Pinecone Inference로 임베딩하고 PostgreSQL/pgvector에 저장하며 같은 사용자 권한으로 키워드와 의미 검색을 조합한다.

기록 색인은 큐 worker가 Pinecone을 호출해 비동기로 생성한다. 의미 검색 질의의 임베딩도 서버의 같은 어댑터를 사용하며, 문서/질의의 입력 종류는 선택 모델의 계약에 맞춰 전달한다. 질의 처리에는 짧은 timeout과 계약된 fallback을 적용한다. 모델·차원이 다른 벡터를 혼합하지 않는다. Pinecone API 키는 Edge Secrets에만 두고 브라우저·플러그인 패키지에 포함하지 않는다.

검색 응답은 원본 종류·ID·제목·요약·날짜·태그·페이지 정보와 검색 상태다. 외부 에이전트가 상세를 읽고 추론하며, 사용자가 저장한 결과가 다시 지식으로 축적된다. 앱 내부의 임베딩 생성은 검색을 위한 수치 변환이고 사용자 업무를 판단하는 대화형 추론과 구분한다.

검색 후보의 안정 ID로 권한을 적용한 원본 상세 조회와 웹 화면 연결을 제공한다. 검색 결과에도 원본과 같은 접근 범위를 적용한다. 검색 결과 없음·색인 지연·검색 실패를 구분하며 정확한 상태 schema는 첫 티켓에서 확정한다. 제목·요약만으로 필요한 내용을 회수할 수 있는지는 실제 검색 품질 평가로 판단한다.

## 에이전트 연결 계약

에이전트 접점은 MCP 연결과 제품 스킬을 묶은 플러그인이다. 클라이언트는 패키지의 연결 설정으로 MCP 서버를 사용하고, 포함된 스킬로 업무 절차를 안내받는다. MCP 서버 코드는 Edge Functions에 배포하며 플러그인 패키지는 서버 연결 정보/참조·설치 metadata·스킬을 제공한다. 패키지에 서버 런타임이나 서버 비밀을 포함하지 않는다.

```text
웹 앱 ── HTTP ───────────────────→ 공통 유스케이스
에이전트 + 설치한 플러그인
            ├─ 제품 스킬: 작업 방법 안내
            └─ MCP 연결 ── 서버 ─→ 공통 유스케이스
```

| 구성 | 소유하는 내용 |
| --- | --- |
| 플러그인 manifest·연결 설정 | 제품 식별·버전·지원 클라이언트·MCP endpoint 또는 등록 앱 참조·스킬 패키징 |
| 제품 스킬 | 관련 자료 선택·원문 확인·결과 정리·사용자 요청 범위에 맞는 도구 사용 순서 |
| MCP 도구 schema/설명/응답 | 입력·출력, 수정·삭제 영향, 오류와 재시도 의미 |
| MCP 서버 공통 안내 | 현재값 조회와 실제 실행 결과에 근거한 보고 등 짧은 공통 안내 |
| 유스케이스·도메인·저장 계층 | 접근 검사, 업무 조건, 일관성과 중복 방지의 강제 |

스킬에 도구 schema나 서버 규칙을 복제하지 않는다. 개발용 AGENTS와 사용자 원칙(principles) 데이터도 제품 스킬과 분리한다. MCP 연결과 클라이언트별 스킬 설치·행동은 각각 검증한다. 스킬이 없는 클라이언트에도 서버의 권한과 업무 규칙은 동일하게 적용된다.

## 검증 게이트

이 구조를 구현할 때 같은 연결의 트랜잭션, 업무 데이터+큐의 함께 롤백, 사용자 격리와 우회 차단, 응답 유실 재시도, 큐 중복/늦은 응답/삭제 경쟁, 실제 모델 품질을 검증한다. core는 DB 없는 테스트로 업무 규칙을 검증하고 adapter는 실제 격리 DB로 검사한다. 검사 항목은 [Template-01](../tickets/template-01-task-record-search.md), 런타임·SQL 드라이버·임베딩 모델의 선정과 실험은 [Template-02 T02-1](../tickets/template-02-implementation-base.md)이 소유한다.

폴더는 [폴더 구조](../design/template-structure.md)를 따른다. 방향 합의가 구현·배포 완료를 의미하지 않는다.

## 공식 참고

- [Supabase Queues](https://supabase.com/docs/guides/queues), [큐 quickstart](https://supabase.com/docs/guides/queues/quickstart), [PGMQ API](https://supabase.com/docs/guides/queues/pgmq).
- [예약 Edge 실행](https://supabase.com/docs/guides/functions/schedule-functions), [Edge의 Postgres 연결](https://supabase.com/docs/guides/functions/connect-to-postgres), [벡터 저장](https://supabase.com/docs/guides/ai/vector-columns).
- [헥사고날 원문](https://alistair.cockburn.us/hexagonal-architecture).
- [Pinecone 임베딩 생성](https://docs.pinecone.io/guides/inference/generate-embeddings), [Supabase Google 로그인](https://supabase.com/docs/guides/auth/social-login/auth-google).
