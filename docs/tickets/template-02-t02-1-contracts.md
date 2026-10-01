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
