# Workspace 제품 플러그인

`workspace` 0.1.0은 Claude Code와 Codex가 같은 `skills/workspace/`를 사용하는 패키지다. 개발 스킬은 포함하지 않는다. 기존 운영 MCP `https://ayzcluvdppsppwszzaqx.supabase.co/functions/v1/mcp`에 연결하며 OAuth 로그인이 필요하다. 새 앱에서 이 패키지를 재사용할 때는 두 MCP 설정의 주소를 해당 앱의 검증한 주소로 함께 바꾼다. 토큰이나 서버 비밀을 파일에 넣지 않는다.

## 설치와 업데이트

저장소 루트에서 Claude Code:

```powershell
claude plugin validate ./plugins/workspace
claude plugin validate .
claude plugin marketplace add ./
claude plugin install workspace@workspace-template
claude plugin details workspace@workspace-template
```

새 세션에서 `/workspace:workspace`를 선택하고 MCP OAuth 로그인을 완료한다. 로컬 marketplace의 수정은 새 세션 또는 `/reload-plugins`에서 반영한다. Git marketplace 설치는 버전을 올린 뒤 `claude plugin marketplace update workspace-template`와 `claude plugin update workspace@workspace-template`를 실행한다.

Codex CLI:

```powershell
codex plugin marketplace add .
codex plugin add workspace@workspace-template
codex plugin list --json
```

Codex desktop의 프로젝트 marketplace 검색·설치는 앱의 Plugins 화면에서 진행한다. CLI 설치가 desktop 스킬 선택·OAuth·업무 수행을 검증했다는 의미는 아니다. 업데이트는 패키지 버전을 올리고 `codex plugin marketplace upgrade workspace-template` 후 같은 식별자를 다시 설치한다. 패키지와 서버의 호환성을 먼저 검사한다.

## 검사와 보관

```powershell
node scripts/check-plugin.mjs
node --test scripts/check-plugin.test.mjs
node scripts/package-plugin.mjs C:/release-artifacts/workspace-0.1.0.zip
```

명령은 저장소 루트에서 실행한다. ZIP과 옆의 `.json` 증거는 저장소 밖에 쓴다. 파일 순서·ZIP 시각을 고정해 같은 원본은 같은 SHA-256을 만든다. 증거에 버전, endpoint, 도구 목록, 서버 도구 원본 해시와 각 패키지 파일 해시가 들어간다. 서버 원본의 해시는 실제 운영 revision 확인을 대신하지 않는다. 운영에서 아직 배포하지 않은 도구는 연결된 서버에서 사용할 수 없다.

복구는 보관한 이전 ZIP을 추출하고 같은 marketplace 식별자의 원본을 교체한 뒤 지원되는 갱신·재설치 절차를 따른다. 첫 릴리스라 이전 정상 패키지는 아직 없다. 서버를 함께 롤백하지 않으며 현재 서버와의 호환성을 다시 확인한다.

실클라이언트 검증은 신규 설치와 업데이트 각각에서 OAuth, 도구 발견·호출, 스킬 선택, 검색→원문→요청된 저장을 확인한다. 자동 패키지 검사는 이 행동을 대신하지 않는다. claude.ai·Desktop·모바일의 실제 행동은 별도로 검증한다. 실행 결과와 제약은 저장소의 `docs/tickets/template-10-03-product-plugin.md`에 기록한다.

공식 형식과 명령(2026-10-04 확인): [Codex 패키징](https://developers.openai.com/plugins/build/plugins), [Claude manifest](https://code.claude.com/docs/en/plugins-reference), [Claude marketplace](https://code.claude.com/docs/en/plugin-marketplaces).
