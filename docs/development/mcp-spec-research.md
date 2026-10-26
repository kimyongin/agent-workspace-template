# MCP 2026-07-28 규격 조사

2026-10-26 조사 노트. 공식 규격과 현재 checkout의 접점을 확인한 자료이며 제품 계약·ADR 또는 배포 상태를 변경하지 않는다.

## 최신 규격과 버전의 의미

공식 `latest`는 **2026-07-28**로 연결되고 공식 버전 안내도 이를 Current로 명시한다. 사용자가 언급한 2026년 7월 규격이 맞다. 규격 버전은 마지막 비호환 변경 날짜이며, 이후 호환 변경은 같은 버전에 들어갈 수 있다. 따라서 버전명만으로 SDK의 구현 범위까지 확정하면 안 된다. [최신 규격](https://modelcontextprotocol.io/specification/latest), [공식 버전 안내](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning).

공식 변경표의 비교 기준은 이전 규격 `2025-11-25`다. 공식 스키마 원본도 `schema/2026-07-28/schema.ts`에 존재한다. 여기서 확인한 것은 규격 식별자와 현재 상태이며 GitHub 릴리스의 실제 게시 시각을 별도로 검증한 것은 아니다. [변경표](https://modelcontextprotocol.io/specification/2026-07-28/changelog), [공식 스키마](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts).

## HTTP 서버에 직접 영향을 주는 변경

| 항목 | 2026-07-28 요구사항 | 이 앱의 점검 지점 |
| --- | --- | --- |
| 초기화·버전 | `initialize`/`notifications/initialized` 제거. 요청마다 `_meta`에 protocolVersion과 clientCapabilities를 전달한다. | HTTP 요청별 서버 생성만으로 새 규격 준수를 단정할 수 없다. SDK가 실제 wire 형식을 처리하는지 확인한다. |
| 발견 | 서버는 `server/discover`를 반드시 구현한다. 클라이언트의 호출은 선택이다. | 등록한 도구와 별개로 SDK의 발견 응답과 supportedVersions를 확인한다. |
| 전송 | protocol session, `Mcp-Session-Id`, GET stream, SSE 재개를 제거한다. 알림 구독은 `subscriptions/listen`으로 옮긴다. | 기존 endpoint 동작과 SDK의 구 규격 호환 처리를 확인한다. |
| 요청 헤더 | `MCP-Protocol-Version`과 `Mcp-Method` 필수. 도구 호출 등은 `Mcp-Name`도 필수이며 본문과 일치해야 한다. | 프록시·CORS·클라이언트·통합 검사의 헤더 처리를 확인한다. |
| 결과 | 모든 결과에 `resultType` 필수. 추가 입력은 `input_required` 결과와 원래 요청 재시도(MRTR)로 처리한다. | 도구 결과 envelope를 SDK가 자동 생성하는지 확인한다. |
| 캐시 | discovery, 목록, resource read의 complete 결과에 `ttlMs`, `cacheScope`가 필수다. | 사용자별 데이터는 `private`로 권한 문맥 간 공유를 방지한다. |
| 확장 | 실험적 Tasks가 핵심 규격 밖의 공식 확장으로 이동한다. Skills over MCP와 MCP Apps도 선택적 확장이다. | 최신 규격 지원과 모든 확장 구현을 같은 의미로 취급하지 않는다. |

위 표의 초기화·결과·Tasks 변경은 [공식 변경표](https://modelcontextprotocol.io/specification/2026-07-28/changelog), 발견 의무는 [Discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover), 전송·헤더는 [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), 캐시 범위는 [Caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching), 확장의 선택성은 [규격 개요](https://modelcontextprotocol.io/specification/2026-07-28)를 근거로 한다. 점검 지점은 이 앱에 대한 해석이며 공식 문서의 직접 지시는 아니다.

Roots, Sampling, Logging, OAuth Dynamic Client Registration은 **폐기 예정**이다. 현재 규격에서 즉시 제거된 것이 아니다. 공식 레지스트리는 이 기능들의 제거 가능 시점을 2027-07-28 이후 첫 revision으로 명시한다. DCR의 권장 전환 대상은 Client ID Metadata Documents다. [폐기 예정 기능 레지스트리](https://modelcontextprotocol.io/specification/2026-07-28/deprecated).

## 현재 checkout에서 확인한 사실과 남은 검증

- [Deno import map](../../supabase/functions/deno.json)은 MCP server/client SDK를 `2.2.0`으로 고정한다. SDK 패키지 버전은 MCP 날짜 규격 버전과 별개다.
- [MCP 앱 조립](../../supabase/functions/_shared/adapters/mcp/app.ts)은 `createMcpHandler`, `McpServer`를 사용하고 요청마다 actor 검증 후 서버를 만든다. 서버 identity는 `workspace`, 소프트웨어 버전은 `0.4.0`이다.
- [MCP 진입점](../../supabase/functions/mcp/index.ts)은 Streamable HTTP로 제공하며 audience를 MCP URL로 제한한다.
- 설치된 SDK `@modelcontextprotocol/server@2.2.0`의 `dist/index.mjs`에서 `createMcpHandler`는 `2026-07-28`을 제공하고 기본값으로 2025년 규격의 stateless fallback도 제공한다고 명시한다. 앱은 이 기본 handler를 사용하므로 **현재 checkout은 2026-07-28을 지원하는 구성**이다. 구 실험 코드의 `2025-11-25` 문자열이나 legacy 상수 `LATEST_PROTOCOL_VERSION`만으로 현재 서비스를 판정하면 안 된다.
- [도구 등록](../../supabase/functions/_shared/adapters/mcp/tools.ts)은 도구와 annotations·structuredContent를 제공한다. [앱 조립](../../supabase/functions/_shared/adapters/mcp/app.ts)에는 resources/prompts 또는 선택적 확장을 등록하는 코드가 없다. 기본 규격 지원과 모든 선택 기능의 지원은 다르다.
- [통합 검사 연결](../../supabase/tests/mcp/_mcp.ts)의 `Client`는 버전 협상 옵션을 지정하지 않는다. 설치된 client SDK의 기본 모드는 `legacy`이므로 기존 통합 검사만으로 새 규격 경로까지 검증했다고 볼 수 없다.

SDK 전송 계층의 smoke 검사와 실제 앱 통합 검사는 구분한다. 새 [프로토콜 계약 검사](../../supabase/tests/mcp/modern-protocol.test.ts)는 SDK 연결을 `2026-07-28`로 고정해 실제 OAuth 인증·도구 호출·재접속 요청 재현·공간 격리와 wire 형식을 확인한다. Origin 검증은 [보안 가이드](../security/guide.md#인증과-세션)의 `WEB_ORIGINS` 경계를 따르며, 미허용 Origin이 403 대신 200을 반환했던 결함과 교정 근거는 [#573](https://github.com/kimyongin/agent-workspace-template/issues/573)에서 추적한다. 최신 프로토콜 지원이 모든 필수 보안 요건 충족을 뜻하지 않는다. OAuth 등록 방식 전환과 운영 endpoint·실클라이언트 검증은 별도 점검 대상이다.
