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
| MCP 인증 보조 | `@supabase/server` 1.9.0의 `withOAuthProtectedResource`(RFC 9728 metadata)와 JWKS 토큰 검증 | 같은 가이드. 비대칭 서명 키(ES256/RS256) 프로젝트가 필요하고 HS256 레거시 토큰은 거부 | `audience`·`issuer` 옵션으로 토큰을 고정한다(실험 2에서 확인) |
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

Claude의 대상 표면(2026-10-02 사용자 결정): 사용자 한 명이 개인 계정으로 쓰며 조직 관리자 배포는 대상이 아니다. 공식 문서 기준 표면별 제공 방식은 다음과 같고, 각 표면을 T02-4에서 따로 검증한다.

| 표면 | 제공 방식 | 근거 |
| --- | --- | --- |
| Claude Code | 저장소 marketplace로 플러그인 설치 | [플러그인 manifest](https://code.claude.com/docs/en/plugins-reference) |
| claude.ai 웹·Claude Desktop·Cowork | 개인 Pro/Max 계정이 직접 만든 플러그인 파일을 업로드. 같은 계정의 Claude Code에서도 사용 가능 | [플러그인 사용](https://support.claude.com/en/articles/13837440-use-plugins-in-claude) |
| Claude 모바일(iOS·Android) | 웹·데스크톱에서 추가한 사용자 지정 커넥터(원격 MCP)를 사용. 모바일에서 직접 추가는 베타. 플러그인·스킬의 모바일 지원은 공식 문서에 없음 | [사용자 지정 커넥터](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [스킬 사용](https://support.claude.com/en/articles/12512180-use-skills-in-claude) |

모바일에서는 MCP 도구만 쓰이고 제품 스킬의 안내가 빠질 수 있다. 서버가 권한·업무 규칙을 강제하므로 데이터 보호는 같지만([ADR-0005](../adr/0005-plugin-delivery-claude-codex.md)) 원문 확인·요약 작성 같은 작업 방법은 도구 설명과 MCP 서버 공통 안내에만 의존한다. 모바일의 실제 스킬 동작은 T02-4에서 확인해 기록한다. claude.ai·모바일의 커넥터는 Anthropic 클라우드에서 MCP 서버로 접속하므로 서버가 공개 인터넷에서 닿아야 하고, OAuth callback이 로컬 주소가 아니라 claude.ai의 HTTPS 주소다. 실험 2에서 Supabase의 동적 등록이 이 callback을 받는지 확인한다.

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
   - 불가하면 최소 방어: MCP는 `client_id`가 있는 토큰만, HTTP API는 `client_id`가 없는 토큰만 받는다. 명세의 audience 요구를 완전히 충족하지 못하는 부분은 [보안 가이드](../security/guide.md)의 audience 검증 기준에 대한 제한된 예외로 기록한다.
   - 사용자 판단(2026-10-02): 개인 사용 앱이라 두 토큰이 서로의 진입점을 열어도 영향이 크지 않다. 막을 수 있으면 막고, 막지 못해도 위 예외 기록으로 진행하며 별도 ADR은 만들지 않는다.
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
| 반복 할 일 | 포함(T02-2). 자동 실행·알림이 아니라 회차에 기록을 연결하는 할 일 | 2026-10-02 사용자 결정, PRD 변경 PR [#9](https://github.com/kimyongin/agent-workspace-template/pull/9) 승인 후 확정 |
| 할 일 재개(완료 취소) | 미포함. 필요하면 완료와 별도 행위로 추가 | Template-01 "재개는 완료 범위에 섞지 않음" |
| 공유·조직·첨부·실시간 갱신 | 미포함. 요구가 생기면 별도 PRD | PRD 범위 표, [ADR-0006](../adr/0006-owner-only-access-and-separate-auth.md) |

### 공통 규칙

| 항목 | 계약 |
| --- | --- |
| 소유 | 모든 항목은 소유자 한 명. 다른 사용자의 항목은 존재 여부를 드러내지 않고 `not_found` |
| ID | 서버가 만드는 UUID. 참조 ID(태그·엔터티·할 일·원칙)는 같은 소유자의 항목이어야 하며 아니면 `invalid_reference`. 대상 ID(HTTP 경로, MCP의 `id`)가 UUID가 아니면 존재 여부를 드러내지 않고 `not_found` |
| 시각 | ISO 8601 UTC(`created_at`·`updated_at`). 날짜만 쓰는 필드는 `YYYY-MM-DD` |
| 텍스트 | 길이는 Unicode 코드 포인트. 앞뒤 공백 제거 후 검사. 제목 1~100, 요약 1~300(검색 입력, [검색 가이드](../architecture/search.md)), 본문 0~20,000 마크다운 |
| 동시 수정 | 모든 항목에 `version`(정수). 수정·삭제·완료는 `expected_version`을 받고 다르면 `conflict` |
| 중복 요청 | 생성·완료·회차 기록은 선택 입력 `request_id`(클라이언트 UUID)를 받는다. 같은 소유자·같은 작업(대상 ID·회차 날짜 포함)·같은 `request_id`면 첫 결과를 다시 돌려주고, 내용이 다르면 `conflict`. 같은 키의 동시 요청은 한 번만 실행한다. 실패한 요청의 결과는 저장하지 않으므로 다시 보내면 다시 실행된다. 보관 기간은 7일이며 지나면 새 요청으로 처리한다(만료 정리 작업은 T02-6) |
| 목록 | 커서 기반. `limit` 기본 20·최대 100, 응답에 불투명한 `next_cursor`. 기본 정렬은 `updated_at` 내림차순(동점은 `id`). 커서는 소유자·필터에 묶이며 다른 조건에 쓰면 `invalid_input` |
| 부분 수정 | 수정은 바꿀 필드만 보낸다. 서버 관리 필드(`id`·`owner`·`version`·`status`·시각·`task_id`)는 수정 입력에서 거부 |
| 삭제 | 물리 삭제. `expected_version`은 HTTP에서 쿼리 문자열(`DELETE /tasks/:id?expected_version=3`), MCP에서 인자로 받는다. 파생 데이터(벡터·대기 색인 작업)는 같은 트랜잭션에서 정리하고 실행 중인 늦은 색인 결과는 저장을 거부([검색 가이드](../architecture/search.md)) |

오류는 HTTP 상태와 MCP 도구 오류(`isError: true`, 본문 `{code, message, retryable}`)가 같은 `code`를 쓴다.

| code | HTTP | 의미 | 재시도 |
| --- | --- | --- | --- |
| `invalid_input` | 400 | 형식·길이·허용 필드 위반. `fields`에 `{path, message}` 목록(허용하지 않은 필드는 필드 이름별로) | 고쳐서 |
| `invalid_reference` | 400 | 참조한 항목이 없거나 다른 소유자 | 고쳐서 |
| `unauthenticated` | 401 | 토큰 없음·만료·서명이나 발급자 검증 실패, 다른 진입점용 토큰(audience 불일치. 예: 웹 세션 토큰으로 MCP 호출). MCP 명세의 유효하지 않은 토큰 응답과 같음 | 재인증 후 |
| `forbidden` | 403 | 유효한 토큰이지만 작업 권한(scope)이 부족함. 현재 업무 scope를 두지 않아 쓰지 않는 예약 코드 | 아니오 |
| `not_found` | 404 | 없거나 다른 소유자 | 아니오 |
| `conflict` | 409 | `expected_version` 불일치, 허용하지 않는 상태 전환, 같은 `request_id`의 다른 내용 | 재조회 후 |
| `rate_limited` | 429 | 요청 한도 초과. 부분 실행 없음 | 지연 후 |
| `unavailable` | 503 | 외부 공급자·DB 일시 장애. 부분 실행이 없을 때만 사용 | 예 |
| `internal` | 500 | 그 밖의 서버 오류. 내부 정보 미포함 | 같은 `request_id`로 |

### 할 일 (Task) — T02-2

| 필드 | 타입 | 입력 | 비고 |
| --- | --- | --- | --- |
| `title`·`summary`·`body` | 텍스트 | 생성 시 제목·요약 필수 | 공통 텍스트 규칙 |
| `kind` | `once`·`recurring` | 생성 시 필수, 이후 변경 불가 | 일회성·반복 할 일 |
| `due_on` | 날짜 | 선택, `once`만 | 알림 없음 |
| `recurrence` | 규칙 | `recurring`이면 필수 | 아래 반복 할 일 계약 |
| `timezone` | IANA 시간대 | `recurring`이면 필수, `once`는 없음 | 규칙과 따로 수정할 수 있는 할 일 필드 |
| `pauses` | `{stopped_on, resumed_on}` 목록 | 서버 관리 | 반복 할 일의 중단·재개 이력. 아직 중단 중이면 `resumed_on`이 null |
| `status` | `once`: `open`·`done`, `recurring`: `active`·`stopped` | 서버 관리 | 생성 시 `open` 또는 `active` |
| `completed_at`·`result_record_id` | 시각·ID | 서버 관리, `once`만 | 완료 시 설정 |
| `entity_id` | ID | 선택(T02-4부터) | 엔터티 삭제 시 null |
| `tag_ids` | ID 목록 | 선택(T02-3부터) | 최대 10 |

| 행위 | 웹 | HTTP | MCP | 의미 |
| --- | --- | --- | --- | --- |
| 생성 | 목록의 작성 폼 | `POST /tasks` | `create_task` | `open` 할 일 생성, 색인 작업 등록 |
| 조회 | 상세 `/tasks/:id` | `GET /tasks/:id` | `get_task` | 응답에 `result_record`(`{id, title, summary}` 또는 null). 웹 링크는 `/records/:id` |
| 목록 | `/tasks` | `GET /tasks` | `list_tasks` | 필터: `kind`, `status`, `due_from`·`due_to`, `tag_id`, `entity_id`, `occurrence_on`(그 날짜에 회차가 있거나 기록이 있는 반복 할 일. 항목마다 `occurrence`에 회차 상태) |
| 수정 | 상세의 편집 | `PATCH /tasks/:id` | `update_task` | 내용 필드만. 완료된 할 일도 수정 가능 |
| 완료 | 상세의 완료 폼 | `POST /tasks/:id/complete` | `complete_task` | `once`만. 아래 완료 계약. `recurring`에 요청하면 `conflict` |
| 삭제 | 상세의 삭제 확인 | `DELETE /tasks/:id` | `delete_task` | 할 일만 삭제. 결과·회차 기록은 보존하고 `task_id`·`occurrence_on`을 null로 |

완료 계약: 입력은 `expected_version`, 결과 기록의 `title`·`summary`·`body`(제목·요약 필수), 선택 `occurred_at`·`request_id`이며 한 단계의 평평한 객체다. `open`인 할 일만 완료할 수 있고(`done`이면 `conflict`), 한 트랜잭션에서 할 일을 `done`으로 바꾸고 `task_id`가 연결된 결과 기록을 만들고 그 기록의 색인 작업을 등록한다. 하나라도 실패하면 모두 롤백한다. 응답은 할 일과 결과 기록이다.

### 반복 할 일 — T02-2

[PRD](../product/concept.md)의 반복 할 일이다. 앱이 정해진 시각에 작업을 실행하거나 알림을 보내지 않으며, 회차와 수행 여부는 저장하지 않고 규칙과 기록으로 계산한다(core 도메인).

| 항목 | 계약 |
| --- | --- |
| 규칙 `recurrence` | `freq`: `daily`·`weekly`·`monthly`. `weekly`는 `weekdays`(ISO 1=월~7=일, 1개 이상), `monthly`는 `month_days`(1~31, 1개 이상). 그 달에 없는 날짜(예: 2월 30일)는 그 달의 마지막 날 회차로 계산한다. `starts_on`(날짜) 필수 |
| 시간대 | `timezone`(IANA, 예: `Asia/Seoul`) 필수. `recurrence` 밖의 할 일 필드다. 웹은 브라우저 시간대를 기본값으로, MCP는 입력값을 쓴다. "오늘"과 회차 날짜는 이 시간대로 판단 |
| 회차 상태 | 기록 1개 이상이면 `done`. 기록이 없을 때 오늘이면 `due`, 지난 날짜면 `missed`(하지 않음), 미래면 `upcoming` |
| 중단·재개 | `active`에서만 중단, `stopped`에서만 재개(아니면 `conflict`). 중단일부터 재개일 전날까지는 회차가 없다. 중단·재개 이력(`pauses`)은 서버가 보관한다. 같은 날 중단 후 재개하면 빈 중단을 남기지 않고, 재개한 날 다시 중단하면 직전 중단을 이어 간다 |
| 규칙 수정 | `recurrence`·`timezone` 수정 가능. 회차는 새 규칙으로 다시 계산하고, 새 규칙에 맞지 않게 된 기존 기록은 보존하며 회차 목록에 "규칙 밖 기록"으로 표시 |

| 행위 | 웹 | HTTP | MCP | 의미 |
| --- | --- | --- | --- | --- |
| 회차 목록 | 상세의 회차 목록 | `GET /tasks/:id/occurrences?from&to` | `list_occurrences` | 기간은 양 끝 포함 최대 366일. 응답 `{task_id, from, to, today, items}`, 항목 `{date, status, record_ids, in_rule}`. `in_rule=false`는 규칙 밖 기록 |
| 회차 기록 | 회차의 기록 작성 폼 | `POST /tasks/:id/occurrences/:date/records` | `record_occurrence` | 기록 생성 입력과 같은 필드에 선택 `request_id`. `:date`는 규칙상 회차이고 `starts_on` 이후, 중단 기간 밖, 오늘(할 일의 시간대 기준) 또는 그 이전이어야 하며 아니면 `invalid_input`. 한 회차에 여러 번 가능. 기록 생성과 색인 등록은 한 트랜잭션 |
| 중단 | 상세의 중단 | `POST /tasks/:id/stop` | `stop_task` | `expected_version` 필요. 기존 기록 유지 |
| 재개 | 상세의 재개 | `POST /tasks/:id/resume` | `resume_task` | `expected_version` 필요. 재개일부터 회차 생성 |

### 활동 기록 (ActivityRecord) — T02-2

| 필드 | 타입 | 입력 | 비고 |
| --- | --- | --- | --- |
| `title`·`summary`·`body` | 텍스트 | 생성 시 제목·요약 필수 | 공통 텍스트 규칙 |
| `occurred_at` | 시각 | 선택, 기본은 저장 시각 | 실제 수행 시각 |
| `task_id` | ID | 서버 관리(일회성 완료 또는 회차 기록으로만 설정) | 할 일 삭제 시 null |
| `occurrence_on` | 날짜 | 서버 관리(회차 기록으로만 설정) | 반복 할 일의 회차. 할 일 삭제 시 null |
| `entity_id`·`tag_ids` | ID | 선택(T02-4·T02-3부터) | 할 일과 같음 |
| `applied_principle_ids` | ID 목록 | 선택(T02-3부터) | 판단에 적용한 원칙. 원칙 삭제 시 연결만 제거 |

| 행위 | 웹 | HTTP | MCP | 의미 |
| --- | --- | --- | --- | --- |
| 생성 | 작성 폼 | `POST /records` | `create_record` | 할 일 없이 직접 작성 |
| 조회·목록 | `/records/:id`, `/records` | `GET /records/:id`, `GET /records` | `get_record`, `list_records` | 필터: 기간(`occurred_at`), `task_id`, `tag_id`, `entity_id`. 기본 정렬은 `occurred_at` 내림차순 |
| 수정 | 편집 | `PATCH /records/:id` | `update_record` | 제목·요약이 바뀌면 재색인, 본문만 바뀌면 재임베딩 없음 |
| 삭제 | 삭제 확인 | `DELETE /records/:id` | `delete_record` | 일회성 할 일은 `done`을 유지하고 `result_record_id`만 null. 계획(할 일)과 수행 결과(기록)를 하나의 상태로 묶지 않는다(PRD). 회차 기록을 지우면 그 회차에 다른 기록이 없을 때 회차 상태가 다시 계산된다 |

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
| 검색 상태 | `search_state`: `ok` 또는 `keyword_fallback`(의미 검색 실패로 키워드 결과만). 결과 0건과 실패를 구분 |
| 의미 검색 범위 | `semantic_coverage`: 같은 소유자·`kinds`·필터 범위에서 의미 색인에 아직 없는 항목 수 `pending`과 색인에서 제외된 항목 수 `excluded`(요약 누락·입력 한도 초과 등). 결과가 0건이어도 이 값으로 "찾을 자료가 없음"과 "의미 검색 대상에서 빠진 자료가 있음"을 구분한다. 제외·대기 항목도 키워드 검색 대상이며 결과에 나오면 항목의 `index_state`로 표시한다 |
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

## 도메인 변경 계약 (작업 3·4)

2026-10-02 작성. 경로는 [폴더 구조](../design/template-structure.md)를 따른 제안이며 T02-4에서 실제 파일명으로 확정한다. 생성 스크립트·공통 배선 도구는 만들지 않고 T02-5에서 반복이 확인된 범위에만 도입한다.

### 공유 schema 정본

| 결정 | 내용 |
| --- | --- |
| 정본 | 기능별 `supabase/functions/_shared/contracts/<기능>.ts`(현재 `common.ts`·`task.ts`·`record.ts`). Zod schema(필드·생성·수정 입력·응답)와 표시 이름(`labels`)을 둔다 |
| 의존 규칙 | contracts는 `zod`만 가져온다. Deno API·환경변수·SDK·어댑터·core를 가져오지 않는다 |
| 웹 사용 | 웹은 contracts만 가져올 수 있다(Vite 별칭). 서버의 core·adapters·bootstrap·DB 타입은 가져오지 않는다 |
| core 사용 | core 도메인은 필드 타입을 contracts에서 추론해 쓰고, 필드를 넘는 업무 규칙(예: Book의 완료 날짜 규칙)은 core에 둔다. Zod는 순수 검증 라이브러리라 [ADR-0001](../adr/0001-hexagonal-shared-usecases.md)의 core 금지 의존성(SDK·SQL·HTTP·환경변수)에 해당하지 않는다 |
| 지정자 | Deno는 `deno.json` import map으로 `zod`를 `npm:zod@4`에 연결해 웹과 같은 import 문을 쓴다 |

| 대상 | 정본과의 관계 | 불일치를 잡는 검사(T02-2부터) |
| --- | --- | --- |
| HTTP 입력 검증 | 파생: 어댑터가 contracts schema로 `parse` | HTTP 계약 테스트의 경계값 |
| MCP 입력 schema | 파생: `tools/list`에는 contracts의 JSON Schema를 그대로 알리고, 검증은 핸들러가 contracts로 해서 오류 본문을 HTTP와 같게 한다. 최상위가 object여야 하므로 할 일 생성은 종류별 입력을 펼친 모양으로 알리고 `taskCreate`로 검증한다 | `supabase/tests/mcp/`에서 `tools/list`의 schema를 `z.toJSONSchema(contract)`와 비교 |
| 웹 폼 검증·라벨 | 파생: 같은 schema와 `labels` | 폼 경계값 E2E |
| DTO·도메인 필드 타입 | 파생: `z.infer` | 타입 검사 |
| DB migration(타입·NOT NULL·길이/범위 CHECK·선택지) | 수동 | 격리 DB의 parity 테스트(`supabase/tests/database/parity.test.ts`): 필드별 경계값(한도·한도+1·빈 값·선택지 밖)을 contracts와 DB에 모두 넣어 판정이 같은지, DB 컬럼 집합과 contracts 필드 집합이 같은지 |
| 웹 목록·상세 배치 | 수동 | 영향 화면 E2E |
| 제품 스킬(SKILL.md·`references/`) | 수동 | 스킬이 안내하는 도구 이름과 `tools/list`가 서로 빠짐없이 일치하는지 검사(`supabase/tests/mcp/`) |

DB CHECK는 contracts와 같은 한도를 두어 직접 쓰기 우회에도 형식을 지킨다. 업무 규칙은 DB에 두지 않는다([ADR-0003](../adr/0003-core-rules-and-local-transactions.md)).

### 바꿀 위치와 유지할 위치

| 계층 | 도메인 전환 시 바꿈 | 공통으로 유지 |
| --- | --- | --- |
| 모델·검증 | `_shared/contracts/entity.ts`, `_shared/core/entity/domain.ts` | `contracts`의 공통 오류·페이지·텍스트 규칙, `core/shared` |
| 유스케이스·포트 | `core/entity/application/`, `core/entity/ports.ts`(필터·정렬 필드) | 트랜잭션 포트, 할 일·기록·원칙·검색 유스케이스 |
| DB | 엔터티 테이블 migration, parity 테스트 | 인증·할 일·기록·원칙·태그·큐·벡터 테이블과 RLS |
| 저장 어댑터 | `adapters/supabase/`의 엔터티 저장소 | 연결·Actor 문맥·트랜잭션·pgmq·pgvector |
| HTTP·MCP | `adapters/http/`·`adapters/mcp/`의 엔터티 경로·도구 | 인증·오류 변환·요청 제한·MCP 서버 조립 |
| 웹 | `src/features/entity/`의 목록·상세·폼, `src/app`의 메뉴·브랜드 | 공통 컴포넌트·스타일 토큰(브랜드 색 외)·인증 화면 |
| 검색 표현·원문 링크 | 엔터티 상세의 연결 항목 표시 | 검색 결과 형식·원문 상세 경로(엔터티는 검색 대상 아님) |
| 제품 스킬 | `skills/workspace/references/<도메인>.md`와 SKILL.md의 링크 줄 | SKILL.md 공통 흐름, 플러그인 manifest(이름 변경은 T02-6 초기화) |
| 샘플 데이터 | 엔터티 샘플 | 할 일·기록·원칙 샘플의 형식 |

### T02-5에서 비교할 예상 변경 파일

Book 전환에서 아래 목록 밖의 파일이 바뀌면 원인과 공통 기반 수정 여부를 T02-5 기록에 남긴다.

1. `supabase/migrations/`의 엔터티 테이블 migration(새 프로젝트이므로 교체)
2. `supabase/functions/_shared/contracts/entity.ts` → `book.ts`
3. `supabase/functions/_shared/core/entity/`(domain·ports·application) → `core/books/`
4. `supabase/functions/_shared/adapters/supabase/`의 엔터티 저장소
5. `supabase/functions/_shared/adapters/http/`·`adapters/mcp/`의 엔터티 경로·도구
6. `supabase/functions/_shared/bootstrap.ts`의 엔터티 조립 한 곳
7. `src/features/entity/` → `src/features/books/`, `src/app`의 메뉴·브랜드
8. `plugins/workspace/skills/workspace/references/`의 도메인 문서와 SKILL.md 링크 줄
9. 엔터티 core 단위·DB parity·HTTP/MCP 계약·E2E 테스트와 샘플 데이터

## 실험 결과 (작업 9)

2026-10-02 수행. 실험 코드는 [`experiments/t02-1/`](../../experiments/t02-1/README.md)(`main`의 `fea0313`에서 머지)이며 앱 코드가 아니다. 격리 로컬 Supabase(CLI 2.98.2, Edge Runtime 1.73.13·Deno 2.1.4, Postgres 17)에서 실행했고 운영·기존 프로젝트는 쓰지 않았다. 호스팅 프로젝트 생성은 이 세션의 권한 정책으로 막혀 호스팅 환경 항목은 남은 실험으로 둔다.

재현 절차(서명 키 생성 등 준비 포함)는 [실험 README](../../experiments/t02-1/README.md)를 따른다. 설정이 Git에서 제외된 서명 키를 요구하므로 README의 준비 없이 `supabase start`만 실행하면 시작되지 않는다.

2026-10-02 교차 리뷰를 반영해 실험 1을 고치고 다시 실행했다. 이전 C8은 `app_server`가 `authenticated`로 전환할 권한이 없어 쓰기 전에 실패한 것을 통과로 셌고, Edge의 롤백 판정은 큐 메시지를 세지 않았다. 지금은 모든 거부 검사가 오류 코드와 함께 원인 메시지(테이블 권한·RLS·스키마 권한)를 확인하고, 직접 쓰기 차단은 역할 전환이 실제로 된 뒤에 시험한다.

### 실험 1 — 직접 Postgres 트랜잭션: 채택

| 확인 | 직접 연결(5432) | 트랜잭션 풀러(Supavisor, `prepare: false`) | Edge Runtime의 `npm:postgres` |
| --- | --- | --- | --- |
| 다른 소유자로 쓰기 거부(RLS) | 통과 | 통과 | 통과(두 연결 모두) |
| 읽기 격리, 문맥 없는 접속 역할의 접근 거부 | 통과 | 통과 | — |
| 커밋·롤백 후 같은 연결에 역할·claims가 남지 않음 | 통과 | 통과 | 통과 |
| 원본 저장과 `pgmq.send`의 함께 롤백(전송 후 실패)·함께 커밋 | 통과 | 통과 | 롤백 통과(원본·큐 개수 모두 비교) |
| 접속 역할의 큐 메시지 내용 조회·소비·삭제 거부 | 통과 | 통과 | — |
| 동시 200요청(연결 4개)에서 다른 사용자 행 노출 | 0건 | 0건 | — |

연결 방식과 무관한 검사: `authenticated` 역할로 전환이 된 것을 확인한 뒤의 업무 테이블 직접 쓰기 거부(`permission denied for table items`)와 큐 전송 거부(`permission denied for schema pgmq`), 접속·전환 역할에 superuser·BYPASSRLS 없음. 모두 통과.

`npm run exp1`: 28/28 통과. 대조 실험(`exp1-negative.mjs`)에서 트랜잭션 한정이 아닌 세션 설정을 쓰면 다음 요청이 이전 사용자의 문맥으로 행 102개를 보는 누출을 검출해, 위 검사가 실제 누출을 잡는다는 것을 확인했다.

채택한 방식:

- 접속 역할 `app_server`(LOGIN, 업무 테이블 권한 없음, superuser·BYPASSRLS 아님)가 트랜잭션마다 `set_config('request.jwt.claims', <검증된 Actor>, true)`와 `set local role app_user`를 실행한다.
- `app_user`(NOLOGIN)는 업무 테이블 권한과 RLS 정책의 대상이고 PostgREST에 노출되지 않는다. `authenticated`·`anon`은 업무 테이블 권한이 없어 Supabase API로 직접 쓰지 못한다.
- 큐 전송은 같은 트랜잭션에서 `reset role`로 접속 역할로 돌아간 뒤 실행한다. 접속 역할에는 pgmq 스키마 사용, `pgmq.send`와 `pgmq.format_table_name` 실행, 해당 큐 테이블의 INSERT와 `msg_id` 컬럼 SELECT(`INSERT … RETURNING`용)만 준다. 메시지 내용 조회·소비·삭제는 worker 역할(T02-3)의 몫이다. 일반 사용자 역할에는 pgmq 권한을 주지 않는다.
- 드라이버는 Postgres.js 3.4.9. Edge처럼 연결이 짧은 환경은 트랜잭션 풀러와 `prepare: false`를 쓴다.

ADR-0003의 대안(SQL 함수를 사용자 JWT로 호출)은 필요하지 않다.

### 실험 2 — MCP OAuth와 토큰 구분: 채택(로컬), 호스팅 확인 남음

| 확인 | 결과 |
| --- | --- |
| 토큰 없는 MCP 요청 | 401과 `WWW-Authenticate: Bearer resource_metadata=".../exp2-mcp/oauth-protected-resource"` |
| 보호 자원 metadata(`@supabase/server`의 `withOAuthProtectedResource`) | `resource`=MCP URL, `authorization_servers`=Supabase Auth |
| 권한 서버 metadata | 경로 덧붙임형(`/auth/v1/.well-known/oauth-authorization-server`)·OIDC 탐색 200. 경로 삽입형은 로컬에서 404(호스팅 확인 남음). PKCE S256 지원. CIMD·RFC 9207 `iss` 응답 표시 없음 |
| 동적 등록 | loopback HTTP·claude.ai HTTPS callback 허용, loopback이 아닌 HTTP redirect 거부(400) |
| Custom Access Token Hook | OAuth 클라이언트 토큰에 `client_id`가 있고, hook으로 `aud`를 MCP URL로 바꿀 수 있음. 갱신 토큰에도 유지 |
| 토큰 교차 사용 | MCP 토큰→MCP 200, 웹 세션 토큰→MCP 401, 웹 세션 토큰→HTTP API 200, MCP 토큰→HTTP API 401 |
| Codex 0.147.0 | 동적 등록(클라이언트 이름 `Codex`)·PKCE·`resource` 파라미터·loopback callback으로 로그인 성공. 사용자 설정과 분리한 임시 `CODEX_HOME` 사용 |
| Claude Code 2.1.140 | 사용자가 대화형 `/mcp`로 인증(동적 등록, 새 `client_id`). `whoami` 도구 호출 결과 `aud`=MCP URL, `client_id` 있음, `iss`=로컬 Auth |

`node exp2-flow.mjs`: 15/15 통과. Claude Code는 인증과 도구 호출까지, Codex는 인증까지 실제 클라이언트로 확인했다.

채택한 방식:

- MCP 서버는 `withOAuthProtectedResource()`와 `withSupabase({ auth: "user", audience: <MCP URL> })`를 쓴다. 웹용 HTTP API는 `audience: "authenticated"`로 고정한다. 기술 후보 표에서 "이 미들웨어는 audience를 검사하지 않는다"고 적은 것은 잘못이었다. `audience`·`issuer` 옵션으로 고정할 수 있다.
- Custom Access Token Hook은 `client_id`가 있는 토큰의 `aud`를 MCP 서버의 정식 URL로 바꾼다. 따라서 MCP 명세의 audience 요구를 충족하고, 위험 1의 예외 기록은 필요 없다.
- MCP 토큰의 `aud`가 바뀌면 그 토큰으로 Supabase 데이터 API(PostgREST)를 쓸 수 없다. 이 앱은 서버가 직접 SQL로 Actor 문맥을 넣으므로 영향이 없다.
- 동의 화면은 웹 앱의 `/oauth/consent` 경로에 둔다. supabase-js의 `auth.oauth.getAuthorizationDetails`·`approveAuthorization`·`denyAuthorization`으로 동작하며 클라이언트 이름과 redirect URI를 보여 준다.

### 남은 실험 (미완료)

2026-10-02 사용자 결정으로 아래 항목은 미완료로 두고 T02-1을 닫는다. 각 항목은 표의 단계에서 수행하며 그 전에는 완료로 보고하지 않는다.

| 항목 | 차단 원인 | 이어서 할 단계 |
| --- | --- | --- |
| 호스팅 환경: 경로 삽입형 metadata, Supavisor 실서버, Edge 배포 | 이 세션의 권한 정책이 호스팅 프로젝트 생성을 막음. 사용자가 격리 프로젝트를 만들어야 함 | T02-2(격리 환경의 실제 로그인·MCP 인증 재현) |
| claude.ai 웹·모바일 커넥터의 OAuth·도구 호출 | 공개 HTTPS 주소의 호스팅 프로젝트 필요 | T02-4(Claude 표면별 검증) |
| Codex의 실제 대화에서 도구 호출 | 사용자 Codex 계정의 대화 실행 필요(인증은 성공) | T02-4 |
| 실험 3 임베딩 품질 | Pinecone API 키 필요 | T02-3(모델·차원·입력 예산 확정) |
