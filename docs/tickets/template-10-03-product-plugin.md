# Template-10-03: 공유 제품 플러그인 패키징

[Template-02](template-02-implementation-base.md)의 T02-4 중 제품 패키징·클라이언트 검증을 맡는다. 계약은 [T02-1](template-02-t02-1-contracts.md#플러그인-형식-claudecodex), 결정은 [ADR-0005](../adr/0005-plugin-delivery-claude-codex.md), 실행 기준은 [배포](../deployment/release.md#플러그인-패키징과-배포)·[보안](../security/guide.md#큐비밀값공급망)이다.

## 범위와 인계

- 2026-10-04 사용자는 T02-5/6을 제외한 잔여 구현과 기존 운영 환경 후속 진행을 승인했다는 메인의 배정을 전달받았다. T02-4를 재개한다. 새 호스팅·프로젝트나 공개 디렉터리 제출은 범위 밖이다.
- 작업 공간 `C:/Users/yongin/.codex/worktrees/workspace-plugin/agent-workspace-template`, branch `codex/workspace-plugin`, base `46f4cbe`. 시작 checkout은 clean이었다.
- 단독 구현·검증 담당 `/root/implement_plugin`. 제품 manifest/MCP 설정/README, 두 저장소 marketplace, 패키지 검사·ZIP 도구와 이 티켓을 소유한다. Entity 담당이 제품 SKILL.md·도메인 참고를 맡고, 메인이 통합·독립 리뷰·CI·머지를 조정한다. package.json·CI·개발 스킬은 수정하지 않았다.
- 명시 배정은 Codex desktop 균형 `gpt-6.1-sol`/`medium`. 같은 날 preflight 통과를 메인으로부터 전달받았다(`TEMP/overnight-desktop-snapshot.json`). 실제 backend model/effort/token metadata는 미노출이다.

## 결과와 완료 경계

`plugins/workspace` 하나에 portable Agent Plugins 1.0의 `plugin.json`/`mcp.json`과 Claude의 `.claude-plugin/plugin.json`/`.mcp.json`을 둔다. 식별자 `workspace`, 버전 `0.1.0`, 공유 제품 스킬은 `skills/workspace` 한 개다. marketplace 이름은 두 클라이언트 모두 `workspace-template`이다. 개발 스킬은 패키지에 포함하지 않는다.

기존 운영 endpoint는 `https://ayzcluvdppsppwszzaqx.supabase.co/functions/v1/mcp`다. 2026-10-04 읽기 전용 비인증 initialize는 HTTP 401 및 이 서버의 protected-resource metadata challenge를 반환했고 metadata는 HTTP 200, resource가 위 URL, issuer가 같은 프로젝트의 `/auth/v1`, bearer 방식이 header인 것을 직접 확인했다. credential·업무 쓰기·원격 설정 변경은 없었다.

`scripts/check-plugin.mjs`는 manifest 식별자·버전·설명, 두 transport의 실제 endpoint 일치, marketplace source·정책, 파일 허용 목록·symlink 거부·인코딩, 공유 스킬 frontmatter와 내부 링크를 검사한다. 제품 스킬의 도구 표와 서버 `*-tools.ts`의 정적 도구 이름을 비교한다. 이는 실제 인증된 `tools/list` schema/행동 검증의 대체가 아니다. 기존 `check:docs`의 `scripts/*.test.mjs` glob으로 신규 검사도 CI에 들어간다.

`scripts/package-plugin.mjs`는 숨김 파일을 포함한 `workspace/` 디렉터리 하나의 ZIP을 만든다. 파일 순서와 ZIP 시각을 고정해 같은 원본을 같은 SHA-256으로 보관하며 결과는 저장소 밖에만 쓴다. 옆의 `.json`은 package/version/endpoint, 도구 원본 해시·목록, 파일 해시와 archive 해시를 보관한다. 해시가 실제 운영 배포 revision을 증명하지는 않는다. 신규 설치/업데이트/복구의 실제 명령과 한계는 [패키지 README](../../plugins/workspace/README.md)에 있다.

메인이 조회한 기존 운영 서버는 api/mcp ACTIVE v3, migration 2만 적용돼 있다. 이 branch의 추가 원칙·태그·검색 도구와 이후 Entity까지 서버 호환성 확인·배포가 필요하다. 현재 서버에 해당 도구가 있다고 선언하거나 패키지를 실업무 검증 완료로 처리하지 않는다. 첫 버전이므로 이전 정상 패키지 artifact는 아직 없다.

## 실행 기록과 제출 snapshot

2026-10-04 `/root/implement_plugin`가 위 worktree에서 직접 실행했다. Windows PowerShell, Node 24.15.0, Codex CLI 0.147.0, Claude Code 2.1.140. 같은 날 desktop preflight는 전달받은 보고이며 아래 CLI 출력은 직접 관찰했다.

| 명령·경계 | 결과 |
| --- | --- |
| `npm ci` | exit 0, 168 packages, audit 0 vulnerabilities |
| `npm run check:docs` | UTF-8/BOM/LF/링크·모델 설정 검사 통과, script tests 35 passed/0 failed(신규 3개 포함) |
| `npm run build` | exit 0, TypeScript/Vite 빌드 통과. 기존 bundle 500kB 경고 유지 |
| `claude plugin validate ./plugins/workspace` / `claude plugin validate .` | manifest/marketplace 통과. 처음 marketplace description 경고 후 description을 추가해 재검사 |
| 격리 `CODEX_HOME`에서 `codex plugin marketplace add . --json`, `codex plugin add workspace@workspace-template --json`, `codex plugin list --json` | marketplace 등록·0.1.0 설치 성공, enabled=true, authPolicy=ON_INSTALL. TEMP helper alias 생성 경고는 설치 성공과 별개 |
| 격리 `CLAUDE_CONFIG_DIR`에서 `claude plugin marketplace add <절대 checkout>`, `claude plugin install workspace@workspace-template`, `claude plugin details workspace@workspace-template`, `claude plugin list --json` | 등록·0.1.0 설치 성공, enabled=true, 공유 skill workspace 1개. list JSON에는 workspace HTTP MCP 설정 1개. 이 버전의 details inventory는 MCP servers(0)를 표시하여 실제 연결 성공의 증거로 쓰지 않음 |
| `node scripts/package-plugin.mjs <TEMP>/workspace-plugin-artifacts/workspace-0.1.0.zip`와 PowerShell `Expand-Archive`, 추출 폴더 `claude plugin validate` | 생성·독립 ZIP 추출·숨김 manifest 검증 통과 |

CLI isolated root는 `C:/Users/yongin/AppData/Local/Temp/workspace-plugin-cli-185d28c3596947de920a015deed6d91c`다. 각 명령 프로세스의 `CODEX_HOME`·`CLAUDE_CONFIG_DIR`만 바꿨으며 개인 설정은 수정하지 않았다. Claude의 `marketplace add .`는 이 버전에서 잘못된 source 형식으로 실패했고 절대 checkout 경로를 사용해 성공했다. 개인 기존 OAuth credential을 복사하거나 노출하지 않았다.

보관 위치는 `C:/Users/yongin/AppData/Local/Temp/workspace-plugin-artifacts/workspace-0.1.0.zip` 및 옆의 `.json`. 이번 파일 원본의 archive SHA-256은 `ff828bf3e84444f849cad0a659f71cdc932219088ad1ee5e570e9b78e75f5501`, 서버 도구 원본 집합 SHA-256은 `6f919cbd861e7984a8565e55646e9ce5ebf9362247e019f12ff3119de0ca6ec6`, 정적 도구는 26개다. Entity와 제품 스킬을 통합한 뒤 같은 명령으로 최종 archive와 hash를 다시 보관해야 한다.

## 미검증과 다음 작업

- 인증된 discovery/도구 호출, 스킬 선택·검색→원문→요청된 저장, 신규 설치 후 실제 업무와 실제 버전 업데이트 후 업무는 미검증이다. 격리 homes에 인증은 없고 MCP는 401을 반환한다. OAuth는 소유자 Google 로그인·동의가 필요하다.
- 메인이 확인한 CUA surfaces는 현재 채팅의 빈 IAB와 MCP Apps뿐이며 native apps는 disabled다. 기존 로그인 Chrome, Claude 웹/desktop/mobile, 외부 Codex desktop 설치 화면은 접근할 수 없다. 이들의 지원 여부 또는 실제 행동 성공을 추정하지 않는다.
- 현재 2.1.140 Claude validate는 현재 공식 문서가 안내하는 2.1.281 이후의 MCP entry 상세 검사를 제공하지 않을 수 있다. 설정 정합성은 자체 검사와 설치 list로 확인했으며 transport/OAuth는 후속 실제 확인이 필요하다.
- 메인은 Entity 결과 통합 후 정적 parity·패키지 검사와 archive 생성, 최신 서버 revision의 실제 schema 비교·사용자 클라이언트 OAuth/행동 확인을 배정한다. 운영 reset/로컬 Supabase 실행은 하지 않았다.
- 이 제출 snapshot에서 로컬 구현·오프라인 검사·격리 CLI 설치는 완료, 독립 리뷰·CI·머지·운영 서버 후속 배포·실클라이언트 업무 검증은 남아 있다. 제출 후 최종 head·리뷰·CI·머지는 PR 완료 코멘트와 checks가 소유한다.

공식 자료는 2026-10-04 직접 열어 확인했다: [OpenAI 패키징](https://developers.openai.com/plugins/build/plugins), [Claude manifest](https://code.claude.com/docs/en/plugins-reference), [Claude marketplace](https://code.claude.com/docs/en/plugin-marketplaces).

## 독립 리뷰 수정 snapshot

2026-10-04 메인으로부터 기존 head `a61a539`의 독립 리뷰 결과(수정 필요, P2 두 개, PRD/ADR 이탈 없음)를 전달받아 같은 구현 담당·`gpt-6.1-sol`/`medium` 명시 배정으로 재개했다. 같은 날 preflight 유지 보고를 받았으며 backend 실제 metadata는 여전히 미노출이다. 다른 worktree의 작업과 공유 제품 스킬을 수정하지 않는다.

1. README가 로컬 marketplace 등록 다음에 Git 전용 `marketplace upgrade`를 안내했다. 격리 Codex CLI 0.147.0에서 기존 명령을 직접 재현했고 `not configured as a Git marketplace`로 실패했다. 로컬 source는 원본 수정·버전 증가 후 같은 `plugin add`로 재설치하며 Git source의 snapshot 갱신과 분리하도록 고쳤다.
2. ZIP 출력 경계의 lexical 경로 검사는 저장소를 가리키는 저장소 밖 junction을 통과시켰고 기존 destination symlink를 따라 쓸 수 있었다는 리뷰어 재현을 받았다. archive와 sidecar를 모두 쓰기 전에 기존 ancestor의 `realpath`로 저장소 안을 거부하고 기존 출력 symlink/junction·비정규 파일을 거부하도록 고쳤다. 디렉터리 생성 후에도 두 경로를 재검사한다. 어떤 출력도 만들기 전 양쪽을 확인해 sidecar 거부 때 archive만 남는 것을 막는다.

| 직접 실행 | 결과 |
| --- | --- |
| 격리 `<TEMP>/workspace-plugin-update-f5f8bb60a60947f8834977599483342d`의 Codex `marketplace add <fixture>`, 최초 `plugin add`, local `marketplace upgrade` | 첫 설치 0.1.0 성공, 기존 upgrade 실패 재현 |
| 위 fixture manifest를 0.1.1로 변경 후 같은 `plugin add`, `plugin list --json` | 0.1.1 cache 경로·enabled=true 확인 |
| 위 fixture skill에 증거 문장을 추가하고 manifest를 0.1.2로 변경 후 같은 `plugin add` | 0.1.2 설치 성공, cache의 SKILL.md와 수정 source 내용이 정확히 일치. 제품 원본 0.1.0은 유지 |
| `node --test scripts/check-plugin.test.mjs` | 4 passed/0 failed/1 skipped. 저장소를 향하는 바깥 junction, archive/sidecar leaf junction 모두 거부, 원본 보존·부분 출력 없음 확인 |
| file symlink 회귀 | Windows file symlink 생성이 EPERM으로 거부돼 이 로컬 검사만 skip. 같은 회귀는 생성 권한이 있는 환경에서 실행하며 CI에 인계. directory junction은 실제 Windows에서 통과 |
| `npm run check:docs`, `git diff --check` | docs·모델 설정 통과, 37 script tests 중 36 passed/0 failed/1 file-symlink skip. diff 검사 통과 |
| 수정본 ZIP 생성, `Expand-Archive`, 추출 폴더 `claude plugin validate` | 저장소 밖 정상 출력·추출·manifest 검증 통과 |

수정본 artifact는 `<TEMP>/workspace-plugin-artifacts/workspace-0.1.0-reviewed.zip`과 `.json`, archive SHA-256은 `afd96e8309880025daca1f6e2a91e859490240df66ec4b0f792d0b6b77c8e68d`다. README 변경에 따른 원본 해시 차이이며 서버 도구·공유 스킬은 기존과 같다. OAuth·실클라이언트 업무 검증 범위는 앞의 미검증 목록을 유지한다. 수정 새 head의 독립 리뷰·CI·머지는 메인 인계다.
