# Template-10-07 — 제품 스킬의 실제 CLI 행동

작성: 2026-10-04
상태: 진행 중 — 로컬 실제 CLI 체크포인트, Claude native OAuth·통합 패키지 갱신 대기
선행: 제품 패키지 PR #74, Entity 서버 계약과 공유 로컬 환경 인계

## 목표와 기준

T02-4의 패키지 설치와 실제 스킬 행동을 구분해 Claude Code와 Codex CLI에서 각각 검증한다. 사용자는 T02-5/6을 제외한 잔여 작업 진행을 지시했다. [배포 방법](../deployment/release.md)의 설치·업데이트·인증·도구 발견·스킬 선택·검색→원문→요청된 저장 조건과 [보안 가이드](../security/guide.md)를 따른다. PRD·ADR은 변경하지 않는다.

## 실행 범위와 계약

- 검증할 checkout/head와 공유 스킬·서버 도구 계약을 고정한다. 패키지 원본의 운영 endpoint를 임의 변경하지 않는다. 로컬 대상이 필요한 경우 저장소 밖 복사 패키지/클라이언트 임시 설정에만 loopback endpoint를 사용하고 검증 차이를 명시한다.
- 기존 CLI 계정의 정상 인증 경로를 사용한다. 개인 설정·로그인 자격 증명을 복사하거나 전역 설정을 덮어쓰지 않는다. 세션 전용 플러그인·MCP 옵션을 우선하고 부득이한 설치 변경은 기존 값 보존/정리와 실제 식별자를 기록한다.
- 로컬 Supabase 담당자로 배정된 뒤 실행별 fixture 소유자·표식을 사용한다. 실제 OAuth 동의로 얻은 MCP 전용 토큰과 실제 서버 도구를 사용하며 권한 검사·동의·PKCE를 우회하지 않는다. 클라이언트 Bearer 임시 설정을 쓰면 클라이언트 자체 OAuth 로그인 성공으로 표시하지 않는다. 토큰은 저장소 밖 비밀 파일/환경으로만 전달하고 출력·실행 로그·보고서에 남기지 않는다.
- 실제 클라이언트에서 공유 제품 스킬을 선택하고 fixture 자료 검색→원문 조회→사용자 요청 결과 저장→독립 재조회를 확인한다. 원칙·기록·태그·Entity의 도구 발견과 관련 안내가 최신 서버와 맞는지 대조한다. 실행 중 도구 이름·호출 결과·스킬 선택 증거를 비밀·본문 없이 보존한다.
- 정상 설치/업데이트와 실제 동작을 각각 기록한다. 한 클라이언트 성공으로 다른 클라이언트를 통과 처리하지 않는다. 접근할 수 없는 Claude 웹/desktop/mobile·Codex desktop 제품 플러그인은 미검증으로 남긴다.
- Entity의 새 도구와 스킬이 머지되면 두 manifest의 제품 식별자는 유지하고 버전을 함께 0.1.1로 갱신한다. 원본 운영 endpoint와 전체 도구 schema·스킬 정합을 검사하고 저장소 밖 새 ZIP/hash/sidecar를 만든다. 초기 0.1.0에서 갱신한 실제 설치 증거와 서버 revision을 구분한다.
- 정리는 해당 실행 fixture만 수행한다. 서비스 reset·운영 자료 테스트·새 서비스·Book 전환·배포 재현/복구 훈련은 범위 밖이다.

## 소유와 인계

구현 담당은 이 티켓, 필요한 `experiments/plugin-behavior/`의 격리 실행 도구·README 및 실증 결과, `experiments/README.md` 목록, 두 제품 manifest 버전과 관련 README를 소유한다. 앱 코드 변경이 필요하면 원인과 관련 담당에 인계하고 별도 실제 수정 PR로 검증한다. 메인이 환경 독점 배정·최신 main 통합·정확한 head 독립 리뷰·PR/CI·머지를 조정한다.

## 완료 조건

- [x] 두 CLI의 모델/effort 배정 preflight와 실제 설정·버전을 확인한다.
- [ ] 실제 공유 스킬 선택·MCP 도구 발견·검색/원문/저장/재조회 흐름을 각 클라이언트에서 관찰한다.
- [ ] 설치/업데이트·로컬 토큰 전달과 클라이언트 자체 OAuth·접근 불가 surface의 증거를 구분한다.
- [ ] 실행 revision·재현 명령·fixture 정리·한계·다음 판단을 기록하고 문서 검사를 통과한다.

## 현재 접근 조건

Codex CLI 0.147.0은 `exec --ignore-user-config` 및 세션 `-c` override, Claude Code 2.1.140은 `--plugin-dir`·`--mcp-config`·`--strict-mcp-config`를 help에 노출한다. 이 사실만으로 실제 스킬/도구 실행을 완료한 것으로 보지 않는다. 현재 CUA에 native 앱과 로그인된 외부 브라우저는 노출되지 않아 외부 웹/desktop/mobile의 제품 흐름은 접근할 수 없다.

## 오프라인 준비 snapshot

2026-10-04 `/root/implement_plugin`가 `codex/plugin-behavior`, base `a59d58c`에서 재개했다. 메인이 작성한 이 계획 미커밋 파일을 보존해 이어 쓴다. 명시 실행 배정은 desktop `gpt-6.1-sol`/`medium`, 같은 날 재개 preflight PASS 보고를 전달받았고 backend 실제 model/effort는 미노출이다. Entity 담당이 공유 로컬 Supabase를 독점하는 동안 서비스·DB·OAuth·API fixture 생성은 실행하지 않는다.

2026-10-04 직접 CLI 버전/help와 공식 [Codex non-interactive](https://learn.chatgpt.com/docs/non-interactive-mode), [config](https://learn.chatgpt.com/docs/config-file/config-reference), [app-server](https://learn.chatgpt.com/docs/app-server), [Claude CLI](https://code.claude.com/docs/en/cli-reference)·[model](https://code.claude.com/docs/en/model-config)를 열어 확인했다. `experiments/plugin-behavior/models.mjs` 실행은 MCP 없는 임시 작업 디렉터리에서 모델 조회만 수행한다. 개인 정상 auth 저장소는 읽는 CLI 정상 경로를 사용하고 복사/덮어쓰지 않았다.

| 직접 확인 | 결과 |
| --- | --- |
| Codex 0.147.0 app-server initialize→model/list(limit100, includeHidden=false), 마지막 nextCursor까지 | 모델 4개, 균형 `gpt-5.6-terra`·medium 지원. desktop `gpt-6.1-sol`과 별개 |
| Claude 2.1.140 `--model sonnet --effort medium`, `--setting-sources ""`, 빈 strict MCP와 tools, `--no-session-persistence`, JSON 응답 | 짧은 READY 호출 성공, modelUsage `claude-sonnet-4-6` 확인. alias/옵션 수락 증거이고 backend effort는 미노출 |
| 각 snapshot으로 `agent-models.mjs assign --client <각 CLI> --tier balanced --effort medium --role implement` | 양쪽 PASS. 실제 제품 행동 실행 시 Codex gpt-5.6-terra/medium, Claude sonnet/medium을 명시하며 각 실행 직전 assign을 다시 확인 |

같은 날의 모델 snapshot은 저장소 밖 `C:/Users/yongin/AppData/Local/Temp/plugin-behavior-models-20261004/{codex-cli,claude-cli}-snapshot.json`에 있다. observedAt은 실제 조회 시각이며 사용자 시간대 Asia/Seoul을 사용한다. 아래 실제 실행은 이 준비 이후 메인의 환경 배정으로 수행했다.

## 2026-10-04 실제 로컬 CLI 체크포인트

실험 도구 checkout은 base `a59d58cc8ca5e65f24c3d31c7504367db79d0a01`이다. 서버·공유 제품 스킬은 별도 Entity 후보 checkout `C:/Users/yongin/.codex/worktrees/example-entity/agent-workspace-template`, exact head `72d4d702afa0fc278651e2b97314b1e8a909e754`를 사용했다. 후보의 플러그인을 저장소 밖에 복사했고 SKILL.md SHA-256은 `5f9dc1ea8fae06427648ef0ba1fa25a129bf3f6761ecffd8f93faa198cd57fea`이다. 실제 MCP는 `http://127.0.0.1:55421/functions/v1/mcp`, 승인 웹은 기존 primary Vite `http://127.0.0.1:55480`이다. 운영 endpoint·원본 플러그인·앱 tracked 파일은 바꾸지 않았다. 배포된 운영 서버의 결과를 뜻하지 않는다.

메인이 공유 환경 독점을 배정한 동안 후보에서 Edge를 시작하고 기존 DB·fin·primary Vite를 유지했다. 두 로컬 owner A/B에 각각 실행 표식의 태그·Entity·원칙·원문 기록을 만들었다. 요약에 없는 고유 검증 코드를 원문 본문에만 넣어, 검색 요약만으로 결과를 만들 수 없게 했다. 실제 웹 로그인→승인 버튼→PKCE 교환으로 얻은 시험 MCP 토큰만 자식 프로세스 환경에 전달했다. 개인 자격 증명 복사·권한 검사 우회는 없었다.

| 직접 관찰 | Codex CLI 0.147.0 | Claude Code 2.1.140 |
| --- | --- | --- |
| 배정 | gpt-5.6-terra/medium, 각 실행 assign PASS. backend 실제 model/effort 미노출 | sonnet/medium, 각 실행 assign PASS. init/modelUsage claude-sonnet-4-6, 보조 haiku 사용도 보고됨. backend effort 미노출 |
| 제품 연결 | 로컬 marketplace의 공유 스킬. 번들 MCP를 끄고 동일 loopback 서버를 세션 전용 bearer_token_env_var로 연결 | 세션 plugin-dir의 공유 스킬·번들 loopback MCP, 환경 참조 Authorization header |
| 스킬 선택 | 행동 실행에서 공유 스킬 제공 확인. 별도 `$workspace` 오프라인 실행은 SKILL.md 직접 읽음 관찰; reference/hash 응답은 90초 timeout으로 미완료 | `Skill` 도구가 `workspace:workspace`를 선택하고 성공한 결과를 관찰 |
| 실제 호출 | list_principles, search, list_tags, get_record, get_principle, get_entity, create_record, get_record | search, list_principles, list_tags, get_record, get_entity, create_record. get_principle 별도 호출은 없고 list_principles의 전체 body 사용 |
| 요청 결과 | exit0, marker-result 기록 정확히 1개 | exit0, permission_denials 없음, marker-result 기록 정확히 1개 |
| 독립 SDK 재조회 | 원문 검증 코드·원칙 연결·Entity 연결·tag_ids 연결 모두 PASS | 동일 네 조건 모두 PASS |

Codex 시작/완료 이벤트의 동일 도구명 반복은 호출 이벤트이고 중복 저장이 아니다. 두 기록의 개수는 각각 별도 검색·get_record로 검증했다. Codex의 전체 스킬 선택 완료 조건은 추가 증거가 필요해 체크박스를 남긴다. Claude의 성공 실행 init에는 자동 claude.ai Claude Docs 연결 발견이 있었다. 허용 도구는 로컬 제품 범위였고 해당 외부 도구 호출은 없었다. 이후 runner에 `ENABLE_CLAUDEAI_MCP_SERVERS=false`를 추가했지만 그 변경 후 실제 흐름 재실행은 아직 하지 않았다.

재현 도구는 [실험 README](../../experiments/plugin-behavior/README.md)에 있다. 비밀 없는 구조적 실제 로그는 저장소 밖 `C:/Users/yongin/AppData/Local/Temp/plugin-behavior-fixtures-20261004/`의 `plugin-codex-cli-3902928a/codex-cli/evidence.json`, `plugin-claude-cli-25735b23/claude-cli/evidence.json`, 각 표식 폴더의 `<client>-independent.json`이다. 원시 stdout/stderr·도구 인수/본문·토큰은 증거에 저장하지 않았다.

### 절차 실패와 수정

1. fixture 준비에서 두 checkout의 Playwright를 함께 import하여 충돌했다. 후보의 단일 Playwright만 사용하도록 바꾸고 재실행했다. 이 시도에는 업무 fixture가 생성되지 않았다.
2. Claude strict MCP 옵션에 빈/직접 설정을 넣었을 때 번들 플러그인 서버가 init에서 빠졌다. ToolSearch 활성 여부와 header 환경 참조를 따로 점검했으며 header를 바꿔도 해결되지 않았다. 세션 plugin-dir 번들 경로로 연결하자 `plugin:workspace:workspace`와 31개 실제 도구를 관찰했다.
3. 허용 목록을 직접 서버 namespace `mcp__workspace__*`로 작성한 시도는 연결은 성공했지만 검색·원칙 호출이 거부되었다. 실제 `mcp__plugin_workspace_workspace__*`로 바꾼 뒤 성공했다. 이전 실패 시도는 결과 기록을 만들지 않았다.
4. 독립 검증기의 태그 판정이 `tags`를 읽어 실패했다. 실제 schema의 `tag_ids`로 좁게 수정하고 같은 저장 결과를 재조회하여 PASS했다. 서버/업무 결과 오류로 분류하지 않는다.

### CLI 자체 OAuth와 다음 native 검증

Codex는 개인 로그인 파일이 없는 새 외부 CODEX_HOME에 MCP 설정만 만들고 정상 `codex mcp login workspace --scopes openid,email`을 실행했다. Playwright의 실제 로컬 로그인·동의가 CLI callback까지 완료되었고 exit0/authenticated를 관찰했다. 별도 정상 app-server `mcpServerStatus/list`는 `authStatus=oAuth`, 도구 31개를 보고했다. 그 home에 이번 로그인으로 저장된 MCP 토큰만 메모리에서 읽은 독립 SDK의 `list_tags`도 오류 없이 구조적 결과를 반환했다. 이는 Codex native 로그인·발견 성공과 독립 harmless read이며 LLM 행동 실행 자체가 native 저장 토큰을 사용했다는 증거는 아니다. 증거는 외부 `plugin-behavior-native-20261004/{native-oauth-evidence,native-discovery,native-read-call}.json`이다.

Claude 설치 버전의 `mcp --help`에는 login/logout이 없고 `claude mcp login workspace`는 unknown command(exit1)였다. 최신 [공식 MCP 문서](https://code.claude.com/docs/en/mcp)는 더 새 버전의 login/logout과 interactive `/mcp` 인증·Clear authentication을 설명한다. 새 CLAUDE_CONFIG_DIR의 PTY는 LLM 계정 로그인 선택 화면에서 멈췄으며 MCP 인증까지 도달하지 않았다. 이 격리 경로의 실패만으로 정상 계정 인증을 읽는 CLI의 native OAuth를 불가 판정하지 않는다.

메인이 다음 시도를 승인했다. 공유 환경이 다시 배정되면 정상 CLI 인증을 복사 없이 읽고 user setting-sources를 제외하며 `ENABLE_CLAUDEAI_MCP_SERVERS=false`, 외부 세션 plugin-dir의 고유 validation 제품/서버 식별자만 사용한다. `/mcp`에서 해당 시험 연결의 정상 OAuth를 수행하고 해당 연결의 Clear authentication으로 해제한다. 기존 식별자 충돌·정상 해제 메뉴 부재·같은 endpoint의 기존 인증 공유가 확인되면 기존 인증을 덮어쓰지 않고 구체적 제약을 기록한다. 현재 Entity가 환경을 독점하므로 문서/help 준비까지만 했으며 이 후속 PTY·MCP 연결은 미실행이다.

### 정리와 잔여 조건

두 실행의 결과·원문·원칙·Entity·태그만 삭제했다. 이번 fixture/native 로그인으로 생긴 OAuth 등록 3개만 정확한 client_id로 삭제했고 외부 `cleanup-evidence.json`에 개수/소유 범위 판정을 남겼다. own Edge 프로세스만 종료하고 환경을 메인에 반환했다. DB reset·fin/primary Vite 종료·운영 테스트는 없었다. 체크포인트 보관 전 두 비밀 fixture 파일 및 이번 isolated native credentials 파일만 삭제했고 구조적 증거 파일은 유지했다. 기존 실행 토큰/fixture는 재사용할 수 없다.

체크포인트 검증: `npm run check:docs` PASS(문서 256개, 스크립트 tests 36 PASS/1 SKIP; Windows file symlink privilege 미지원), 실험 `.mjs` 전부 `node --check` PASS, `git diff --check` PASS. native home 소유 표식·기존 config 덮어쓰기 거부·현재 환경 인계 확인 등 runner 보강은 이후 실제 재실행 전 코드 검사만 수행했다.

남은 작업은 Claude native 인증·정상 해제 실증, Codex 스킬 선택 보강, Entity 최신 main 통합 후 두 manifest 0.1.1·checker·실제 설치 갱신·새 외부 ZIP/hash 검증이다. 웹/desktop/mobile 제품 흐름은 접근 불가로 미검증이며 운영 배포/새 서비스/public 제출은 수행하지 않는다.
