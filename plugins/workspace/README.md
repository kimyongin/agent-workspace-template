# Workspace 제품 플러그인

`workspace` 0.1.1은 Claude Code와 Codex가 같은 `skills/workspace/`를 사용하는 패키지다. 개발 스킬은 포함하지 않는다. 기존 운영 MCP `https://ayzcluvdppsppwszzaqx.supabase.co/functions/v1/mcp`에 연결하며 OAuth 로그인이 필요하다. 새 앱에서 이 패키지를 재사용할 때는 두 MCP 설정의 주소를 해당 앱의 검증한 주소로 함께 바꾼다. 토큰이나 서버 비밀을 파일에 넣지 않는다.

## 설치와 업데이트

저장소 루트에서 Claude Code:

```powershell
claude plugin validate ./plugins/workspace
claude plugin validate .
claude plugin marketplace add ./
claude plugin install workspace@workspace-template
claude plugin details workspace@workspace-template
```

새 세션에서 `/workspace:workspace`를 선택하고 MCP OAuth 로그인을 완료한다. 로컬/Git marketplace 원본의 버전을 올린 뒤 `claude plugin marketplace update workspace-template`와 `claude plugin update workspace@workspace-template`를 실행하고 새 세션 또는 `/reload-plugins`에서 반영한다. Claude Code 2.1.140의 격리 홈에서 로컬 0.1.0→0.1.1 업데이트를 확인했다.

Codex CLI:

```powershell
codex plugin marketplace add .
codex plugin add workspace@workspace-template
codex plugin list --json
```

Codex desktop의 프로젝트 marketplace 검색·설치는 앱의 Plugins 화면에서 진행한다. CLI 설치가 desktop 스킬 선택·OAuth·업무 수행을 검증했다는 의미는 아니다. 패키지와 서버의 호환성을 먼저 검사하고 업데이트 시 두 manifest의 버전을 함께 올린다.

위 로컬 경로 marketplace는 원본을 수정한 뒤 `codex plugin add workspace@workspace-template --json`을 다시 실행하면 새 버전의 cache로 설치된다. `codex plugin list --json`으로 버전·enabled를 확인하고 새 세션에서 다시 사용한다. Codex CLI 0.147.0의 격리 설정에서 0.1.0→0.1.1 재설치를 확인했다.

Git source로 등록한 marketplace만 `codex plugin marketplace upgrade workspace-template`로 원격 snapshot을 갱신한 뒤 같은 `plugin add`를 실행한다. 로컬 source에서 `marketplace upgrade`는 `not configured as a Git marketplace`로 실패한다.

## 검사와 보관

```powershell
node scripts/check-plugin.mjs
node --test scripts/check-plugin.test.mjs
node scripts/package-plugin.mjs C:/release-artifacts/workspace-0.1.1.zip
```

명령은 저장소 루트에서 실행한다. ZIP과 옆의 `.json` 증거는 저장소 밖에 쓴다. 파일 순서·ZIP 시각을 고정해 같은 원본은 같은 SHA-256을 만든다. 증거에 버전, endpoint, 도구 목록, 서버 도구 원본 해시와 각 패키지 파일 해시가 들어간다. 서버 원본의 해시는 실제 운영 revision 확인을 대신하지 않는다. 운영에서 아직 배포하지 않은 도구는 연결된 서버에서 사용할 수 없다.

복구는 보관한 이전 ZIP을 추출하고 같은 marketplace 식별자의 원본을 교체한 뒤 지원되는 갱신·재설치 절차를 따른다. 서버를 함께 롤백하지 않으며 현재 서버와의 호환성을 다시 확인한다.

실클라이언트 검증은 신규 설치와 업데이트 각각에서 OAuth, 도구 발견·호출, 스킬 선택, 검색→원문→요청된 저장을 확인한다. 자동 패키지 검사는 이 행동을 대신하지 않는다. claude.ai·Desktop·모바일의 실제 행동은 별도로 검증한다. 패키지 검증은 저장소의 `docs/tickets/template-10-03-product-plugin.md`, 실제 로컬 CLI 행동과 미검증 범위는 `docs/tickets/template-10-07-plugin-behavior.md`에 기록한다. 0.1.1은 Entity 후보의 31개 도구 안내를 포함한다. 운영에 해당 revision을 배포했다는 의미는 아니다.

공식 형식과 명령(2026-10-04 확인): [Codex 패키징](https://developers.openai.com/plugins/build/plugins), [Claude manifest](https://code.claude.com/docs/en/plugins-reference), [Claude marketplace](https://code.claude.com/docs/en/plugin-marketplaces).
