# Workspace 제품 플러그인

`workspace` 0.4.0는 현재 상태·현재 원칙·기록 원문을 근거로 다음 업무를 준비하는 제품 스킬의 소스 후보다. Claude Code와 Codex가 같은 `skills/workspace/`를 사용하며 개발 스킬은 포함하지 않는다. 기존 운영 MCP `https://ayzcluvdppsppwszzaqx.supabase.co/functions/v1/mcp`에 연결하며 OAuth 로그인이 필요하다. 새 앱에서 이 패키지를 재사용할 때는 두 MCP 설정의 주소를 해당 앱의 검증한 주소로 함께 바꾼다. 토큰이나 서버 비밀을 파일에 넣지 않는다. 후보 소스 변경은 기존 설치 갱신이나 운영 서버 배포를 뜻하지 않는다.

0.4.0은 업무 설정·기록 템플릿 준비와 발급처별 엔터티 식별자·소프트 삭제·복원·식별 정보 변경 계약을 사용한다. 같은 서버 revision을 먼저 배포·검증한 뒤 클라이언트를 갱신한다. [기록 템플릿](../../docs/adr/0015-change-record-templates.md)과 [엔터티 식별자](../../docs/adr/0016-entity-source-identity.md)의 이관 기준을 따른다.

“준비만” 요청은 원문 식별자와 가능한 순서·필요한 확인을 제안한 뒤 끝낸다. 현재 원칙 부재, 자료 충돌, 검색 장애와 색인 지연을 구분한다. 다중 대상·메모·현재 원칙의 서버 계약을 안내하고 과거 캡처의 해석은 `skills/workspace/references/preservation.md`를 필요한 경우에만 읽는다. 실제 클라이언트 검증 절차와 원시 출력 없는 증거 범위는 [행동 실험](../../experiments/plugin-behavior/README.md)에 있다.

## 설치와 업데이트

이 패키지의 소유 원본은 이 저장소의 `plugins/workspace/`와 로컬/Git marketplace다. `plugin-creator:update-plugin` 스킬은 소유 원본에 맞는 갱신 경로를 선택하는 절차다. Workspace는 원본 수정·패키지 검사 후 아래 CLI 갱신/재설치를 사용하며 설치 cache를 직접 편집하지 않는다. 계정 편집 도구는 정확한 backend plugin ID·현재 release·편집 가능 scope를 확인한 eligible 계정 플러그인에만 적용한다([배포 기준](../../docs/deployment/release.md#플러그인-패키징과-배포)).

앞으로 웹/앱 UI에서 플러그인을 설치·갱신·게시하지 않는다. 대상의 도구·CLI가 지원하지 않으면 미지원/미검증으로 기록하고 UI로 대신하지 않는다. 과거 Claude 웹 설치·사용 검증은 당시 이력이며 이 새 배포 경로의 검증을 뜻하지 않는다.

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

Codex 설치·갱신은 아래 CLI 지원 경로를 사용한다. desktop에서 CLI 설치가 실제 반영되는지와 스킬 선택·OAuth·업무 수행은 별도 확인하며, 미확인 상태에서 desktop까지 갱신됐다고 표시하지 않는다. 패키지와 서버의 호환성을 먼저 검사하고 실제 제품 릴리스에서 두 manifest의 버전을 함께 올린다.

위 로컬 경로 marketplace는 원본을 수정한 뒤 `codex plugin add workspace@workspace-template --json`을 다시 실행하면 새 버전의 cache로 설치된다. `codex plugin list --json`으로 버전·enabled를 확인하고 새 세션에서 다시 사용한다. Codex CLI 0.147.0의 격리 설정에서 0.1.0→0.1.1 재설치를 확인했다.

Git source로 등록한 marketplace만 `codex plugin marketplace upgrade workspace-template`로 원격 snapshot을 갱신한 뒤 같은 `plugin add`를 실행한다. 로컬 source에서 `marketplace upgrade`는 `not configured as a Git marketplace`로 실패한다.

## 검사와 보관

```powershell
node scripts/check-plugin.mjs
node --test scripts/check-plugin.test.mjs
node scripts/package-plugin.mjs C:/release-artifacts/workspace-0.4.0.zip
```

명령은 저장소 루트에서 실행한다. ZIP과 옆의 `.json` 증거는 저장소 밖에 쓴다. 파일 순서·ZIP 시각을 고정해 같은 원본은 같은 SHA-256을 만든다. 증거에 버전, endpoint, 도구 목록, 서버 도구 원본 해시와 각 패키지 파일 해시가 들어간다. 서버 원본의 해시는 실제 운영 revision 확인을 대신하지 않는다. 운영에서 아직 배포하지 않은 도구는 연결된 서버에서 사용할 수 없다.

복구는 보관한 이전 ZIP을 추출하고 같은 marketplace 식별자의 원본을 교체한 뒤 지원되는 갱신·재설치 절차를 따른다. 서버를 함께 롤백하지 않으며 현재 서버와의 호환성을 다시 확인한다.

실클라이언트 검증은 신규 설치와 업데이트 각각에서 OAuth, 도구 발견·호출, 스킬 선택, 검색→원문→요청된 저장을 확인한다. 자동 패키지 검사는 이 행동을 대신하지 않는다. [패키지 검사](../../scripts/check-plugin.mjs)와 [제품 행동 검증 도구](../../experiments/plugin-behavior/README.md)를 제공하며 결과는 관련 GitHub 이슈·PR에서 확인한다. claude.ai·Desktop·모바일의 실제 행동은 별도로 검증한다. [Codex desktop 잔여 확인 #102](https://github.com/kimyongin/agent-workspace-template/issues/102)은 다른 클라이언트 결과로 대체하지 않는다. 0.1.1은 Entity 후보의 31개 도구 안내를 포함한다. 운영에 해당 revision을 배포했다는 의미는 아니다.

공식 형식과 명령(2026-10-04 확인): [Codex 패키징](https://developers.openai.com/plugins/build/plugins), [Claude manifest](https://code.claude.com/docs/en/plugins-reference), [Claude marketplace](https://code.claude.com/docs/en/plugin-marketplaces).
