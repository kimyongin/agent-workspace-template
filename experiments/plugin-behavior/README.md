# 제품 스킬의 실제 CLI 행동 실험

추적: [Template-10-07](../../docs/tickets/template-10-07-plugin-behavior.md). 앱이 이 폴더를 import하거나 배포하지 않는다. 기존 정상 CLI 로그인은 그대로 사용하고 개인 설정·자격 증명을 복사하지 않는다. 외부 웹·desktop·mobile 검증과 구분한다.

## 모델과 일회성 설정 준비

```powershell
node experiments/plugin-behavior/models.mjs C:/Users/yongin/AppData/Local/Temp/plugin-behavior-models-20261004
node scripts/agent-models.mjs assign --client codex-cli --tier balanced --effort medium --role implement --reason "제품 스킬 행동 검증" --snapshot C:/Users/yongin/AppData/Local/Temp/plugin-behavior-models-20261004/codex-cli-snapshot.json
node scripts/agent-models.mjs assign --client claude-cli --tier balanced --effort medium --role implement --reason "제품 스킬 행동 검증" --snapshot C:/Users/yongin/AppData/Local/Temp/plugin-behavior-models-20261004/claude-cli-snapshot.json
```

`models.mjs`는 현재 Codex app-server의 전체 `model/list` 페이지를 읽고 Claude의 명시 sonnet/medium 호출을 도구·MCP 없이 실행해 alias의 actual 모델을 확인한다. 전자는 capability 조회, 후자는 alias·옵션 수락 확인이며 품질/비용이나 backend 실제 effort 평가가 아니다. 결과에는 메일·로그인·토큰을 포함하지 않는다.

실제 서비스 실행은 메인의 Entity 통합 및 공유 로컬 Supabase 독점 배정 후에만 한다. loopback OAuth 토큰을 fixture 소유자가 실제 동의·PKCE·코드 교환으로 받아 세션 MCP 설정에 전달한다. 이는 CLI 자체 OAuth 로그인 성공과 다르다. 원본 운영 endpoint는 유지하고 복사 패키지·세션 설정만 loopback 대상으로 쓴다. 토큰과 원시 클라이언트 출력은 저장소 밖에만 두며 보관하는 증거는 도구 이름/성공/모델/스킬 선택과 독립 재조회 판정만 남긴다.

## 실제 실행과 증거

2026-10-04 후보 서버/스킬 head `72d4d702afa0fc278651e2b97314b1e8a909e754`로 두 CLI가 요청된 결과 기록을 만들었고 별도 SDK의 재조회가 원문 코드·원칙·Entity·태그 연결을 확인했다. Codex native MCP OAuth는 새 home에서 승인/callback·31개 도구 발견까지 확인했다. 상세 호출·실패 시도·정리·미검증 범위는 연결한 티켓이 정본이다. 최종 제품 패키지 0.1.1 설치 갱신은 Entity main 통합 후 별도로 검증한다.

아래는 메인의 공유 환경 독점 인계가 필요한 명령이다. `setup`은 후보 checkout의 `.env.local`을 정상 helper로 읽는다. `verify`/`cleanup`은 같은 실행 파일을 사용한다. output은 반드시 저장소 밖 새 실행 폴더로 지정한다. Node 22의 TypeScript 지원과 설치된 저장소 의존성을 사용한다.

setup은 첫 변경 전에 비밀 journal을 만들고 token·생성 전 request_id/입력·반환 ID를 단계별 저장한다. 부분 실패 후에도 같은 `cleanup` 명령을 사용하며 정리 진행을 보존해 다시 실행할 수 있다. 응답 유실의 pending create는 같은 request_id로만 멱등 재시도하며, 미실행 요청이었다면 해당 시험 항목을 생성한 뒤 삭제할 수 있다. 업무 자료 뒤 이번 OAuth 등록만 정리하고 token을 journal에서 제거한다. 기존 fixture 파일은 덮어쓰지 않으므로 새로운 setup에는 새 폴더를 쓴다. token 미반환/검증 실패·만료는 티켓에 기록한 정상 인증 확인/인계 대상이다.

`node --experimental-transform-types --test experiments/plugin-behavior/journal.test.mjs`는 서비스 연결 없이 실제 비밀 journal 파일과 모의 도구에 생성/삭제/인증 정리/디스크 실패를 주입해 소유 범위·재시도를 검사한다. 모의 도구는 실제 MCP ToolDef의 input schema로 모든 요청을 먼저 검증한다. 앱 TypeScript의 parameter property를 읽기 위해 transform flag가 필요하며 현재 Node 24.15.0에서 확인했다. runner와 같은 `setupOwned` 경계의 listTools callback에 실패를 주입한다. 원칙 정리는 지원되는 active/inactive를 각각 마지막 페이지까지 확인하며 cursor를 섞지 않는다.

```powershell
$env:PLUGIN_ENV_HANDOFF = 'exclusive-local'
node experiments/plugin-behavior/fixture.mjs setup <candidate-checkout> codex-cli <outside-output>
node experiments/plugin-behavior/run-client.mjs codex-cli <outside-output>/codex-cli-fixture.json <codex-snapshot>
node experiments/plugin-behavior/fixture.mjs verify <candidate-checkout> codex-cli <outside-output>
node experiments/plugin-behavior/fixture.mjs cleanup <candidate-checkout> codex-cli <outside-output>
```

Claude 실행에는 client 인수를 `claude-cli`로, snapshot을 해당 클라이언트로 바꾼다. `run-client.mjs`는 복사 플러그인·세션 허용 목록과 환경 토큰만 사용하고 원시 출력 대신 구조적 이벤트를 저장한다. token은 fixture 비밀 파일에만 있고 MCP JSON에는 `${WORKSPACE_MCP_TOKEN}` 참조만 저장한다. 현재 runner의 claude.ai MCP 제외 환경 변수는 성공 실행 뒤 보강했으며 이후 실제 실행은 아직 하지 않았다.

```powershell
node experiments/plugin-behavior/native-oauth.mjs <allocated-env-file> <new-outside-native-output> http://127.0.0.1:55480
node experiments/plugin-behavior/native-discovery.mjs <new-outside-native-output>/codex-native-home
```

첫 명령은 새 Codex home에만 MCP 설정을 생성하며 기존 config가 있으면 덮어쓰지 않는다. 둘째는 이번 실험 home에 생긴 workspace MCP 토큰만 메모리에서 읽어 정상 CLI 발견과 독립 harmless read를 비교한다. 개인 auth 파일을 복사하지 않는다. 완료 후 정확히 이번 fixture/등록만 삭제하고 시험 token 파일을 정리한다. 현재 결과의 OAuth 등록은 이미 삭제했으므로 기존 fixture를 다시 쓰지 않는다.

`select-codex.mjs <outside-copy-marketplace> <codex-snapshot>`은 MCP를 끈 오프라인 `$workspace` 선택 증거를 따로 모은다. 첫 실행은 패키지에 없는 example-entity 참고 파일과 hash 응답을 요구했고 timeout으로 미완료였다. 실제 SKILL.md만 읽고 Entity 도구를 보고하도록 수정한 재실행은 읽기 완료·5개 도구 보고·MCP 호출 0·exit0을 확인했다. 이 선택 검사는 별도 로컬 조회/저장 행동 실행과 구분한다.

`install-update.mjs <new-outside-output>`은 서비스/LLM 없이 git의 원래 0.1.0 패키지를 외부 marketplace에 복원한 뒤 새 CODEX_HOME·CLAUDE_CONFIG_DIR에 설치한다. 최신 원본을 복사하고 Codex 재설치 및 Claude marketplace/plugin update로 0.1.1·enabled·양 cache의 공유 SKILL 해시를 검사한다. 개인 설정을 복사/수정하지 않는다. `claude plugin marketplace add`에는 `./`를 사용한다(`.`은 2.1.140에서 거부됨).

## Claude native OAuth 후속 준비

설치된 2.1.140은 `mcp login/logout` 명령이 없다. 정상 개인 CLI 계정 인증을 그대로 읽는 interactive 세션의 `--setting-sources project,local --plugin-dir <outside-unique-plugin>`과 `ENABLE_CLAUDEAI_MCP_SERVERS=false`로 `/mcp`의 실제 Authenticate/Clear authentication을 완료했다. 고유 시험 plugin/server 이름, Authorization header 없는 loopback MCP를 사용했다. `--strict-mcp-config`는 번들 서버를 제외했으므로 이 경로에 쓰지 않는다.

공식 [MCP 문서](https://code.claude.com/docs/en/mcp)의 Clear authentication을 실제 설치 메뉴에서 확인했다. 시험 서버는 처음 미인증이었다. 이미 로그인된 같은 endpoint를 발견하거나 시험 연결만 정상 해제할 수 없으면 기존 인증을 덮어쓰지 않는다. 이번 실행은 정상 동의/CLI callback→connected31→native 저장 auth의 list_tags→own Clear authentication→own DCR 등록 삭제를 완료하고 공유 환경을 반환했다. 자세한 frozen head·사용한 환경·메인의 런타임 컨테이너 정리 인계는 티켓에 있다.

`authorize-native-web.mjs <allocated-env> <outside-cli-issued-request.json> <loopback-web-url> <outside-evidence>`는 실제 CLI PKCE 요청을 정상 로그인·승인 UI로 완료한다. 승인 요청 URL/원시 PTY 로그를 증거에 넣지 않으며 해당 외부 임시 요청 파일은 완료 후 삭제한다. `read-native-claude.mjs <outside-unique-plugin> <current-claude-snapshot> <outside-evidence>`는 정상 CLI가 저장한 native 인증을 읽어 정확한 list_tags 한 번만 허용한다. 개인 token 파일을 직접 읽거나 전달하지 않는다. 두 명령 모두 공유 환경 독점 인계가 필요하다.

`node --test experiments/plugin-behavior/native-guards.test.mjs`는 외부 issuer/callback·PKCE 누락과 canonical 제품/외부 endpoint/주입 header 거부를 오프라인 검증한다. 범용 경로·guard 보강 뒤 실제 native 연결을 반복하지 않았으며 실제 성공 실행과 정적/거부 검증을 구분한다.
