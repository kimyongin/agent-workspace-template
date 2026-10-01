# Template-02 T02-1 — 기술 후보와 계약

[Template-02](template-02-implementation-base.md) T02-1의 산출물을 모은다. 이 파일은 T02-1의 작업 6(기술 후보), 2·5(기능 계약), 3·4(도메인 변경 계약)를 소유하고, 진행 상태는 Template-02의 진행 기록 표가 소유한다. 채택한 결과는 PR 7에서 아키텍처·배포·보안 가이드와 개발 스킬에 반영한다.

## 기술 후보 (작업 6)

2026-10-02 공식 자료와 npm 레지스트리로 확인했다. 모든 항목은 **후보**이며 PR 7의 실험(작업 9)과 T02-2의 첫 구현으로 채택한다. [ADR-0002](../adr/0002-default-tech-stack.md)의 기술 구성 안에서 고르는 세부 선택이므로 ADR 변경이 아니다. 버전은 확인 시점의 최신이며 T02-2에서 lockfile로 고정한다.

### 런타임·라이브러리

| 영역 | 후보 | 근거 | 대안·남은 확인 |
| --- | --- | --- | --- |
| 서버 런타임 | Supabase Edge Runtime(Deno 2 호환), TypeScript | ADR-0002의 Edge Functions. Supabase 예제가 `jsr:`·`npm:` 지정자를 사용 | 정확한 Deno 버전은 T02-2에서 고정한 Supabase CLI(`supabase` 2.119.0)의 로컬 runtime으로 확인 |
| SQL 드라이버 | Postgres.js(`npm:postgres` 3.4.9) | [Edge의 Postgres 연결](https://supabase.com/docs/guides/functions/connect-to-postgres)이 안내하는 직접 연결 드라이버 중 하나. `sql.begin`으로 한 연결의 트랜잭션을 보장 | Edge 같은 서버리스에는 Supavisor 트랜잭션 모드(6543)가 권장되며 이 모드는 prepared statement를 지원하지 않으므로([연결 방법](https://supabase.com/docs/guides/database/connecting-to-postgres)) `prepare: false` 필요. 대안은 deno-postgres. 실험 1에서 확정 |
| MCP 서버 | `@modelcontextprotocol/server` 2.2.0의 `createMcpHandler`(Streamable HTTP, 요청별 무상태 서버) | [Supabase BYO MCP 가이드](https://supabase.com/docs/guides/getting-started/byo-mcp)의 공식 SDK 예제 | `mcp-lite`(0.10.0)는 경량 대안. 가이드 예제의 supabase-js·RLS 데이터 접근은 ADR-0003과 달라 데이터 접근은 위 SQL 드라이버를 쓴다 |
| MCP 인증 보조 | `@supabase/server` 1.9.0의 `withOAuthProtectedResource`(RFC 9728 metadata)와 JWKS 토큰 검증 | 같은 가이드. 비대칭 서명 키(ES256/RS256) 프로젝트가 필요하고 HS256 레거시 토큰은 거부 | 이 미들웨어는 `client_id`·audience를 검사하지 않는다. 아래 MCP OAuth 위험 참고 |
| HTTP 라우팅 | Hono 4.13 | Deno·Edge 호환 경량 라우터, 목적별 경로(`/tasks` 등) 구성 | `Deno.serve`와 직접 분기도 가능. T02-2에서 경로 수가 적으면 생략 가능 |
| 공유 schema | Zod 4.6 | MCP SDK의 도구 `inputSchema`가 Zod를 받고, 웹 폼·HTTP 입력 검증에 같은 정의를 쓸 수 있으며 `z.toJSONSchema`로 JSON Schema를 만든다 | Deno는 `npm:zod`, Vite는 `zod`로 해석되므로 import map(`deno.json`)으로 같은 지정자를 맞춘다. 배치는 작업 3·4에서 정함 |
| 웹 | React 19.3, Vite 8.3, React Router 8.4, TypeScript | 정적 빌드로 GitHub Pages에 배포. 디자인 가이드의 컴포넌트 단위와 맞음 | Pages의 상세 URL 직접 진입은 `404.html` 대체 또는 hash 라우팅 중 T02-2에서 선택하고 새로고침·로그인 복귀로 검증 |
| 테스트 | core·어댑터는 `deno test`, 웹은 Vitest 5, E2E는 Playwright 1.63 | core가 Deno 코드 기반에 있고 웹은 Node 도구 체인을 씀 | 개발 환경 요구: Node 22+, Deno 2, Docker(Supabase 로컬). T02-2에서 실제 명령으로 확정 |

### 플러그인 형식 (Claude·Codex)

| 항목 | Claude | Codex |
| --- | --- | --- |
| 공식 자료 | [Claude Code 플러그인 manifest](https://code.claude.com/docs/en/plugins-reference), [MCP](https://code.claude.com/docs/en/mcp) | [플러그인 패키징](https://developers.openai.com/plugins/build/plugins), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) |
| manifest | `.claude-plugin/plugin.json`(선택, `name`만 필수) | 플러그인 루트의 `plugin.json`(Agent Plugins 1.0 schema, `name`·`version`·`description` 필수). OpenAI 전용 설정은 `extensions.com.openai`, 구형 `.codex-plugin/plugin.json`은 호환용 |
| MCP 연결 | 루트 `.mcp.json`, 원격은 `"type": "http"`와 `url` | 루트 `mcp.json`, 원격은 `"type": "streamable-http"`와 `url`. 공개 배포는 HTTPS 필수 |
| 스킬 | 기본 `skills/<이름>/SKILL.md` | 루트 `skills/<이름>/SKILL.md` 자동 발견 |
| 경로 규칙 | 모든 경로는 플러그인 루트 안(`..` 금지) | 모든 경로는 `./`로 시작하고 플러그인 루트 안 |
| 저장소 marketplace | 저장소 루트 `.claude-plugin/marketplace.json` | 저장소 루트 `.agents/plugins/marketplace.json`(`policy.installation`·`policy.authentication` 필수) |
| 검사 명령 | `claude plugin validate <dir>` | 확인한 문서에 별도 검사 명령 없음. `codex plugin marketplace add`로 설치 시험 |

후보 구성: `plugins/workspace/` 하나를 두 클라이언트의 플러그인 루트로 쓴다. `.claude-plugin/plugin.json`·`.mcp.json`(Claude)과 `plugin.json`·`mcp.json`(Codex)을 나란히 두고 `skills/workspace/`를 공유한다. 두 클라이언트 모두 스킬이 플러그인 루트 안에 있어야 하므로 현재 위치(`plugins/workspace/skills/workspace/`)를 유지하면 복제 없이 공유된다. 서로의 manifest 파일을 무시하는지는 T02-4에서 두 클라이언트로 설치해 확인한다. Agent Plugins 1.0의 루트 `plugin.json`을 Claude Code가 읽는다는 공식 근거는 찾지 못했다.

Claude의 대상 표면: Claude Code 플러그인 문서는 같은 패키지를 claude.ai·Cowork에도 조직 설정으로 배포할 수 있다고 안내한다. 기본 검증 대상은 Claude Code와 Codex로 두고, claude.ai·Cowork는 조직 배포 권한이 있을 때 추가 검증한다. ADR-0005의 "Claude"를 이 범위로 해석하는 것이 맞는지 사람의 확인이 필요하다.

### Google 로그인과 MCP OAuth

| 항목 | Google 로그인(웹) | MCP OAuth(플러그인) |
| --- | --- | --- |
| 목적 | 사람이 웹 앱 세션을 얻음 | 에이전트 클라이언트가 사용자 대신 MCP를 호출할 토큰을 얻음 |
| 권한 서버 | Supabase Auth + Google provider | Supabase Auth의 [OAuth 2.1 서버](https://supabase.com/docs/guides/auth/oauth-server)(추가 요금 없음) |
| 사용자 확인 | Google 동의 → Supabase callback → Pages 복귀 | 앱이 직접 만드는 인가·동의 화면(웹 앱의 한 경로). 사용자는 이 화면에서 Google 로그인 세션으로 승인 |
| 토큰 | Supabase 세션 JWT(`aud`=`authenticated`, `client_id` 없음) | Supabase가 발급한 JWT(`aud`=`authenticated`, `client_id` 있음). scope는 `openid`·`email`·`profile`·`phone`뿐이고 데이터 접근 권한을 뜻하지 않음 |
| 문서 근거 | [Google 로그인](https://supabase.com/docs/guides/auth/social-login/auth-google) | [MCP 인증](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication), [토큰 보안](https://supabase.com/docs/guides/auth/oauth-server/token-security) |

클라이언트별 OAuth 지원(2026-10-02 공식 문서):

| 항목 | Claude Code | Codex | Supabase OAuth 서버 |
| --- | --- | --- | --- |
| 동적 클라이언트 등록(DCR) | 기본 | 지원 | 지원(대시보드에서 활성화 필요, 아무 클라이언트나 등록 가능해짐) |
| Client ID Metadata Document(CIMD) | 자동 발견 | 지원(`--oauth-client-registration`으로 선택) | 공식 문서에 없음([지원 요청 토론](https://github.com/orgs/supabase/discussions/41695)) |
| 사전 등록 client | `--client-id`·`--client-secret`·`--callback-port` 또는 `.mcp.json`의 `oauth.clientId`·`callbackPort` | `[mcp_servers.<이름>.oauth]`의 `client_id`·`callback_url`, `mcp_oauth_callback_port` | 대시보드에서 등록 |
| 탐색 | RFC 9728 → RFC 8414 순서 | 서버의 `scopes_supported` 우선 | `/.well-known/oauth-authorization-server/auth/v1` |
| 로그인 | 연결 시 브라우저 | `codex mcp login <이름>` | — |

후보 계약: 두 클라이언트가 공통으로 지원하는 DCR을 기본으로 하고, CIMD는 Supabase 지원이 공식화되면 전환한다. MCP 서버는 RFC 9728 metadata로 Supabase 권한 서버를 알리고 JWKS로 서명을 검증한다.

### 위험과 실험으로 넘길 항목

1. **MCP 토큰의 audience.** [MCP 인가 명세 2026-07-28](https://modelcontextprotocol.io/specification/latest/basic/authorization)은 MCP 서버가 자신을 audience로 발급된 토큰만 받도록 요구한다(RFC 8707). Supabase 문서에는 resource indicator나 클라이언트별 audience 설정이 없고 MCP 토큰도 `aud`=`authenticated`라 웹 세션 토큰과 audience로 구분되지 않는다. 그대로 쓰면 웹 세션 토큰으로 MCP를 호출하거나 MCP 토큰으로 HTTP API를 호출할 수 있다. 실험 2에서 다음 순서로 확인한다.
   - Supabase Custom Access Token Hook으로 `client_id`가 있는 토큰의 `aud`를 MCP 정식 URI로 바꿀 수 있는지와 이때 RLS·`@supabase/server` 검증이 동작하는지.
   - 불가하면 최소 방어: MCP는 `client_id`가 있는 토큰만, HTTP API는 `client_id`가 없는 토큰만 받는다. 명세의 audience 요구를 완전히 충족하지 못하므로 [보안 가이드](../security/guide.md)의 audience 검증 기준에 대한 제한된 예외로 기록할지, ADR-0006을 보완하는 ADR 초안으로 사람의 결정을 받을지 정한다.
2. **DCR 개방.** DCR을 켜면 누구나 클라이언트를 등록할 수 있다. 등록만으로 데이터 접근이 생기지는 않지만(사용자 동의·소유자 검사 필요) 동의 화면에 클라이언트 이름·redirect URI를 표시하고 loopback·허용 redirect만 받는지 실험 2에서 확인한다.
3. **직접 Postgres 트랜잭션의 Actor 문맥.** 실험 1에서 최소 권한 접속 역할이 트랜잭션 안에서 `set local role authenticated`와 `set_config('request.jwt.claims', ..., true)`로 RLS를 적용하는지, 커밋·롤백 후 연결 재사용 시 문맥이 남지 않는지, 원본 저장과 `pgmq.send`가 함께 롤백되는지 확인한다. 성립하지 않으면 ADR-0003의 대안(업무 규칙 없는 SQL 함수를 사용자 JWT로 호출)을 평가한다.
4. **임베딩.** 후보 모델은 [검색 가이드](../architecture/search.md)의 `llama-text-embed-v2`(1,024차원)다. 실험 3에서 한국어 관련/무관 질의로 평가한다.

## 기능 계약 (작업 2·5)

2026-10-02 작성. [PRD](../product/concept.md)의 필수 기본 기능과 예제 엔터티를 웹·HTTP·MCP가 같은 의미로 제공하기 위한 계약이다. HTTP와 MCP는 같은 유스케이스를 호출한다([ADR-0001](../adr/0001-hexagonal-shared-usecases.md)). 필드 schema의 정본 위치는 작업 3·4(PR 6)에서 정한다. 아래 수치 한도는 기본안이며 실측(검색 모델 입력 예산 등)으로 바뀌면 이 표를 고친다.

### 첫 버전 범위

| 범위 | 판단 | 근거 |
| --- | --- | --- |
| 할 일·기록·사용자 원칙·태그·검색과 원문 확인, 단일 예제 엔터티 | 포함 | PRD 필수 기본 기능·템플릿 완성 범위 |
| 원칙과 RAG | 선택 기능이 아니라 기본 기능(T02-3) | PRD "필수 기본 기능" |
| 반복 일정 | **미정. 사람의 결정 필요.** 결정 전에는 구현하지 않고 할 일은 일회성 | PRD "첫 버전 포함 여부 미정" |
| 할 일 재개(완료 취소) | 미포함. 필요하면 완료와 별도 행위로 추가 | Template-01 "재개는 완료 범위에 섞지 않음" |
| 공유·조직·첨부·실시간 갱신 | 미포함. 요구가 생기면 별도 PRD | PRD 범위 표, [ADR-0006](../adr/0006-owner-only-access-and-separate-auth.md) |

### 공통 규칙

| 항목 | 계약 |
| --- | --- |
| 소유 | 모든 항목은 소유자 한 명. 다른 사용자의 항목은 존재 여부를 드러내지 않고 `not_found` |
| ID | 서버가 만드는 UUID. 참조 ID(태그·엔터티·할 일·원칙)는 같은 소유자의 항목이어야 하며 아니면 `invalid_reference` |
| 시각 | ISO 8601 UTC(`created_at`·`updated_at`). 날짜만 쓰는 필드는 `YYYY-MM-DD` |
| 텍스트 | 길이는 Unicode 코드 포인트. 앞뒤 공백 제거 후 검사. 제목 1~100, 요약 1~300(검색 입력, [검색 가이드](../architecture/search.md)), 본문 0~20,000 마크다운 |
| 동시 수정 | 모든 항목에 `version`(정수). 수정·삭제·완료는 `expected_version`을 받고 다르면 `conflict` |
| 중복 요청 | 생성과 완료는 선택 입력 `request_id`(클라이언트 UUID)를 받는다. 같은 소유자·같은 작업·같은 `request_id`면 첫 결과를 다시 돌려주고, 내용이 다르면 `conflict`. 보관 기간은 T02-2에서 정함 |
| 목록 | 커서 기반. `limit` 기본 20·최대 100, 응답에 불투명한 `next_cursor`. 기본 정렬은 `updated_at` 내림차순(동점은 `id`). 커서는 소유자·필터에 묶이며 다른 조건에 쓰면 `invalid_input` |
| 부분 수정 | 수정은 바꿀 필드만 보낸다. 서버 관리 필드(`id`·`owner`·`version`·`status`·시각·`task_id`)는 수정 입력에서 거부 |
| 삭제 | 물리 삭제. 파생 데이터(벡터·대기 색인 작업)는 같은 트랜잭션에서 정리하고 실행 중인 늦은 색인 결과는 저장을 거부([검색 가이드](../architecture/search.md)) |

오류는 HTTP 상태와 MCP 도구 오류(`isError: true`, 본문 `{code, message, retryable}`)가 같은 `code`를 쓴다.

| code | HTTP | 의미 | 재시도 |
| --- | --- | --- | --- |
| `invalid_input` | 400 | 형식·길이·허용 필드 위반. 위반 필드 목록 포함 | 고쳐서 |
| `invalid_reference` | 400 | 참조한 항목이 없거나 다른 소유자 | 고쳐서 |
| `unauthenticated` | 401 | 토큰 없음·만료·검증 실패 | 재인증 후 |
| `forbidden` | 403 | 토큰 종류가 이 진입점에 맞지 않음(예: 웹 세션 토큰으로 MCP 호출) | 아니오 |
| `not_found` | 404 | 없거나 다른 소유자 | 아니오 |
| `conflict` | 409 | `expected_version` 불일치, 허용하지 않는 상태 전환, 같은 `request_id`의 다른 내용 | 재조회 후 |
| `rate_limited` | 429 | 요청 한도 초과. 부분 실행 없음 | 지연 후 |
| `unavailable` | 503 | 외부 공급자·DB 일시 장애. 부분 실행이 없을 때만 사용 | 예 |
| `internal` | 500 | 그 밖의 서버 오류. 내부 정보 미포함 | 같은 `request_id`로 |

### 할 일 (Task) — T02-2

| 필드 | 타입 | 입력 | 비고 |
| --- | --- | --- | --- |
| `title`·`summary`·`body` | 텍스트 | 생성 시 제목·요약 필수 | 공통 텍스트 규칙 |
| `due_on` | 날짜 | 선택 | 알림·반복 없음 |
| `status` | `open`·`done` | 서버 관리 | 생성 시 `open` |
| `completed_at`·`result_record_id` | 시각·ID | 서버 관리 | 완료 시 설정 |
| `entity_id` | ID | 선택(T02-4부터) | 엔터티 삭제 시 null |
| `tag_ids` | ID 목록 | 선택(T02-3부터) | 최대 10 |

| 행위 | 웹 | HTTP | MCP | 의미 |
| --- | --- | --- | --- | --- |
| 생성 | 목록의 작성 폼 | `POST /tasks` | `create_task` | `open` 할 일 생성, 색인 작업 등록 |
| 조회 | 상세 `/tasks/:id` | `GET /tasks/:id` | `get_task` | 결과 기록 요약과 링크 포함 |
| 목록 | `/tasks` | `GET /tasks` | `list_tasks` | 필터: `status`, `due_on` 범위, `tag_id`, `entity_id` |
| 수정 | 상세의 편집 | `PATCH /tasks/:id` | `update_task` | 내용 필드만. 완료된 할 일도 수정 가능 |
| 완료 | 상세의 완료 폼 | `POST /tasks/:id/complete` | `complete_task` | 아래 완료 계약 |
| 삭제 | 상세의 삭제 확인 | `DELETE /tasks/:id` | `delete_task` | 할 일만 삭제. 결과 기록은 보존하고 `task_id`를 null로 |

완료 계약: 입력은 `expected_version`, 결과 기록의 `title`·`summary`·`body`(제목·요약 필수), 선택 `occurred_at`·`request_id`다. `open`인 할 일만 완료할 수 있고(`done`이면 `conflict`), 한 트랜잭션에서 할 일을 `done`으로 바꾸고 `task_id`가 연결된 결과 기록을 만들고 그 기록의 색인 작업을 등록한다. 하나라도 실패하면 모두 롤백한다. 응답은 할 일과 결과 기록이다.

### 활동 기록 (ActivityRecord) — T02-2

| 필드 | 타입 | 입력 | 비고 |
| --- | --- | --- | --- |
| `title`·`summary`·`body` | 텍스트 | 생성 시 제목·요약 필수 | 공통 텍스트 규칙 |
| `occurred_at` | 시각 | 선택, 기본은 저장 시각 | 실제 수행 시각 |
| `task_id` | ID | 서버 관리(완료로만 설정) | 할 일 삭제 시 null |
| `entity_id`·`tag_ids` | ID | 선택(T02-4·T02-3부터) | 할 일과 같음 |
| `applied_principle_ids` | ID 목록 | 선택(T02-3부터) | 판단에 적용한 원칙. 원칙 삭제 시 연결만 제거 |

| 행위 | 웹 | HTTP | MCP | 의미 |
| --- | --- | --- | --- | --- |
| 생성 | 작성 폼 | `POST /records` | `create_record` | 할 일 없이 직접 작성 |
| 조회·목록 | `/records/:id`, `/records` | `GET /records/:id`, `GET /records` | `get_record`, `list_records` | 필터: 기간(`occurred_at`), `task_id`, `tag_id`, `entity_id`. 기본 정렬은 `occurred_at` 내림차순 |
| 수정 | 편집 | `PATCH /records/:id` | `update_record` | 제목·요약이 바뀌면 재색인, 본문만 바뀌면 재임베딩 없음 |
| 삭제 | 삭제 확인 | `DELETE /records/:id` | `delete_record` | 연결된 할 일은 `done`을 유지하고 `result_record_id`만 null. 계획(할 일)과 수행 결과(기록)를 하나의 상태로 묶지 않는다(PRD) |

### 사용자 원칙 (Principle) — T02-3

| 필드 | 타입 | 입력 | 비고 |
| --- | --- | --- | --- |
| `title`·`summary`·`body` | 텍스트 | 생성 시 제목·요약 필수 | 본문에 이유·예외 |
| `applies_when` | 텍스트 0~300 | 선택 | 적용 조건 |
| `status` | `active`·`inactive` | 생성 시 `active`, 상태 전환 행위로만 변경 | |
| `replaced_by_id` | ID | 선택 | 의미를 바꿔 새 원칙으로 대체할 때 |
| `entity_id`·`tag_ids` | ID | 선택 | 할 일과 같음 |

| 행위 | 웹 | HTTP | MCP | 의미 |
| --- | --- | --- | --- | --- |
| 생성·조회·목록 | `/principles`, `/principles/:id` | `POST /principles`, `GET /principles/:id`, `GET /principles` | `create_principle`, `get_principle`, `list_principles` | 목록 기본 필터는 `status=active`. 활성 원칙 전체를 페이지로 빠짐없이 조회할 수 있는 경로 |
| 수정 | 편집 | `PATCH /principles/:id` | `update_principle` | 표현 수정용. 의미가 바뀌면 새 원칙을 만들고 기존을 비활성화하며 `replaced_by_id`로 연결(웹·제품 스킬이 안내, 서버는 강제하지 않음) |
| 비활성·재활성 | 상세의 상태 전환 | `POST /principles/:id/deactivate`, `POST /principles/:id/activate` | `set_principle_status` | 비활성 원칙은 목록·검색 기본 결과에서 빠지지만 상세와 기록의 연결은 유지 |
| 삭제 | 삭제 확인 | `DELETE /principles/:id` | `delete_principle` | 기록의 `applied_principle_ids`에서 연결만 제거. 기록 내용은 보존 |

원칙 탐색: 에이전트는 `list_principles(status=active)`로 현재 원칙을 빠짐없이 확인하고 `search`로 관련 원칙·기록을 찾는다. 기록의 적용 원칙은 원칙의 현재 내용을 가리키므로 응답에 원칙의 `updated_at`·`status`를 함께 주어 기록 이후 바뀐 원칙을 구분하게 한다.

### 태그 (Tag) — T02-3

이름 1~30자, 소유자 안에서 대소문자 무시 고유. 웹 `/tags`, HTTP `GET/POST /tags`·`PATCH/DELETE /tags/:id`, MCP `list_tags`·`create_tag`·`rename_tag`·`delete_tag`. 항목에는 수정의 `tag_ids`로 붙인다. 태그 삭제는 연결만 제거한다. 태그는 임베딩 입력에 넣지 않는다(검색 가이드).

### 검색 (Search) — T02-3

| 항목 | 계약 |
| --- | --- |
| 진입 | 웹 `/search?q=`, HTTP `POST /search`, MCP `search` |
| 입력 | `query` 1~200자, `kinds`(`task`·`record`·`principle`, 기본 전체), 필터(`tag_id`·`entity_id`·기간·원칙 `status` 기본 `active`), `mode`(`auto`·`keyword`, 기본 `auto`), `limit`·`cursor` |
| 대상 | 의미 검색은 제목+요약 벡터, 키워드 검색은 제목·요약·본문. 엔터티는 검색 대상이 아니며 엔터티 목록의 키워드 필터로 찾는다 |
| 결과 항목 | `kind`·`id`·`title`·`summary`·대표 시각·`tag_ids`·`match`(`semantic`·`keyword`·`both`)·`index_state`(`indexed`·`pending`·`excluded`)·웹 상세 경로 |
| 검색 상태 | `ok`, `keyword_fallback`(의미 검색 실패로 키워드 결과만), `index_pending`(색인 대기 항목이 있어 의미 검색에서 빠졌을 수 있음). 결과 0건과 실패를 구분 |
| 원문 | 각 `get_*`로 읽는다. 검색 결과에 본문·청크를 넣지 않는다 |

### 예제 엔터티 (Entity) — T02-4

PRD의 단일 예제다. 여러 속성 타입의 교체를 시험할 수 있게 네 속성을 둔다. 표시 이름은 중립적인 "속성 1~4"이며 새 앱에서 이름·타입·검증을 바꾼다.

| 필드 | 타입 | 필수 | 검증 | 목록 | 상세·편집 |
| --- | --- | --- | --- | --- | --- |
| `id` | UUID | 서버 | — | 링크 | 읽기 |
| `prop1` | 텍스트 | 예 | 1~100자, 앞뒤 공백 제거 | 표시·키워드 필터·정렬 | 편집 |
| `prop2` | 정수 | 아니오 | 0~1,000,000 | 표시·정렬 | 편집 |
| `prop3` | 날짜 | 아니오 | 유효한 날짜 | 표시·범위 필터·정렬 | 편집 |
| `prop4` | 선택 | 예, 기본 `a` | `a`·`b`·`c` | 표시·필터 | 편집 |
| `version`·`created_at`·`updated_at` | 서버 | — | 공통 규칙 | 정렬(`updated_at`) | 읽기 |

웹 `/entities`, `/entities/:id`, HTTP `GET/POST /entities`·`GET/PATCH/DELETE /entities/:id`, MCP `list_entities`·`get_entity`·`create_entity`·`update_entity`·`delete_entity`. 상세 응답은 연결된 할 일·기록·원칙의 최근 항목과 개수를 포함하고, 각 목록은 `entity_id` 필터로 전체를 탐색한다. 엔터티 삭제는 연결된 항목을 지우지 않고 `entity_id`를 null로 만든다. 엔터티는 임베딩하지 않는다.

### T02-5 전환 도메인

책 읽기 관리(Book) 하나를 단일 테이블로 시험한다. 이름·타입 변경, 속성 추가, 작은 업무 규칙을 모두 포함한다.

| 예제 | 전환 후 | 변화 |
| --- | --- | --- |
| `prop1` 텍스트 | `title` 텍스트 1~200 | 이름·한도 |
| (없음) | `author` 텍스트 0~100 | 속성 추가 |
| `prop2` 정수 | `pages` 정수 1~10,000 | 이름·범위 |
| `prop3` 날짜 | `finished_on` 날짜 | 이름 |
| `prop4` 선택 | `reading_status`(`want`·`reading`·`done`) | 이름·선택지 |
| — | `reading_status=done`이면 `finished_on` 필수 | 업무 규칙(core 도메인) |

이 도메인의 할 일·기록·원칙(예: "300쪽 넘는 책은 휴가 때 읽는다")으로 지식 활용 흐름을 실행한다. 기본 템플릿에는 넣지 않는다.
