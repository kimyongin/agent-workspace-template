# Template-10-07 — 제품 스킬의 실제 CLI 행동

작성: 2026-10-04
상태: 로컬 실제 CLI·native 인증 검증 완료 — 최신 main 통합·최종 artifact 후속
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
- [x] 실제 공유 스킬 선택·MCP 도구 발견·검색/원문/저장/재조회 흐름을 각 클라이언트에서 관찰한다(별도 선택 검사와 행동 실행의 범위는 아래 구분).
- [x] 설치/업데이트·로컬 토큰 전달과 클라이언트 자체 OAuth·접근 불가 surface의 증거를 구분한다.
- [x] 실행 revision·재현 명령·fixture 정리·한계·다음 판단을 기록하고 문서 검사를 통과한다.

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

## 최신 후보의 오프라인 통합

메인이 `cba11dd1892f2c0a5848903201c927077aecf76c`로 시작한 rebase에서 `experiments/README.md`의 model-evaluation/plugin-behavior 두 행을 모두 보존하고 continue했다. 이전 체크포인트는 `7af5856ff20b04206a4a3eca2321bc0d405c383f`로 재작성되었다. 최종 후보의 서버/스킬을 받아 두 manifest를 0.1.1로 함께 갱신했고 version 테스트의 고정 0.1.0 기대값을 portable 정본 manifest에서 읽도록 좁게 수정했다. 서버/SKILL 도구명 31개, 숨김 manifest·동일 운영 endpoint·UTF-8 LF·파일 포함 범위 checker PASS. SKILL 자체는 수정하지 않았다.

메인이 허용한 오프라인 선택 재실행은 같은 balanced/medium assign PASS 뒤 MCP를 끄고 정상 LLM으로 `$workspace`를 선택했다. 첫 90초 timeout 프롬프트가 없는 `example-entity.md` 참고 파일을 요구했던 절차 오류를 확인했다(실제 정본은 참고 자료 없음). 불필요한 참고/hash 요구를 제거한 재실행은 SKILL.md 파일 명령의 exit0 완료, Entity 도구 list_entities/get_entity/create_entity/update_entity/delete_entity 보고, MCP 호출 0, CLI exit0을 확인했다. 기존 timeout의 런타임 원인을 모두 단정하지 않는다. 원문/저장 행동과 동일 세션의 선택 증거라고 표현하지 않는다. 구조적 선택 증거는 기존 외부 Codex 표식 폴더의 `codex-cli/skill-selection.json`에 있다.

두 설치 CLI는 새 외부 home에 git base `a59d58c`의 실제 0.1.0 패키지만 설치하고 후보 원본으로 갱신했다. Codex는 로컬 marketplace `plugin add` 재실행, Claude는 로컬 marketplace update와 plugin update를 사용했다. 각 list JSON에서 처음 0.1.0→나중 0.1.1, installed/enabled를 관찰했고 두 cache의 공유 SKILL SHA-256을 원본과 비교했다. 기존 개인 auth/설정을 복사하거나 덮어쓰지 않았고 OAuth/MCP/LLM은 실행하지 않았다. 첫 자동화의 Claude marketplace add `.` 실패를 `./`로 수정했다. 실제 명령과 결과는 외부 `plugin-offline-update-20261004-c/install-update.json`에 보존한다.

후보 ZIP와 sidecar는 저장소 밖 `C:/Users/yongin/AppData/Local/Temp/plugin-candidate-artifacts-20261004/`에 만들었다. `workspace-0.1.1.zip` 및 역검증용 `repeat-0.1.1.zip`의 bytes/hash가 같다. SHA-256 `78974e53e41615a85943037a91db04c30c766a2b6e353e8d992ef71013fa60e3`, 서버 도구 원본 해시 `859d8df7ffbf2ce5c022bcc7ad04559e0b5d6f740187b4e2f71d750c0f54bddc`. 파일 6개는 portable/Claude manifest·각 MCP 설정·README·단일 shared SKILL뿐이며 개발 스킬/앱/서버/자격 증명을 넣지 않는다. sidecar에는 버전·endpoint·31개 도구·각 파일 해시가 있고 별도 candidate-revision.json에 후보/미커밋 packaging 구분을 남긴다. 최종 공개 artifact/sidecar revision은 Entity/활동이 머지된 main으로 다시 고정해야 한다.

검증: `npm ci` PASS(168 packages, audit0), `npm run check:docs` PASS(문서 308개, tests36 PASS/1 file-symlink privilege SKIP), `npm run test:adapters:fast` PASS(13개 실제 유스케이스/HTTP/MCP ToolDef schema·handler 검사, 외부 서비스 없음), `npm run build` PASS(기존 large chunk 경고). 후보 ZIP 결정성/포함 범위 PASS. 이 단계에서 DB·API·OAuth·PTY/MCP 연결은 실행하지 않았다. 공유 환경은 활동 담당의 독점을 유지한다. Claude native 정상 계정 인증/해제는 재배정 후, 운영/외부 surface는 여전히 미검증이다.

## 독립 리뷰 P2 — 부분 fixture의 정리 journal

exact `244fb00` 리뷰에서 setup은 tag→Entity→원칙→기록→listTools가 모두 성공한 뒤에만 fixture 파일을 저장했다. tag 성공 후 Entity transport 실패를 mock으로 재현하면 ID/token 정리 근거가 남지 않았다. 실제 서비스 없이 수정했다.

새 setup은 OAuth 시작 전에 저장소 밖 새 실행 journal을 `wx`로 생성하여 기존 실행을 덮어쓰지 않는다. OAuth가 반환한 token을 즉시 비밀 파일에 보존하고 검증한 owner/client_id를 넣은 뒤 MCP에 연결한다. 각 create의 exact 입력과 고유 request_id를 먼저 원자 저장하고 반환 ID도 다음 변경 전에 저장한다. 이후 listTools 실패에도 앞선 ID는 남는다. ready 상태인 journal만 클라이언트 실행/검증에 사용할 수 있다. 새 journal에는 endpoint·client·실행 표식과 token의 owner/client_id 정합 검사, 기존 파일/심볼릭 링크 거부가 적용된다.

cleanup은 완성 여부와 관계없이 journal을 읽는다. 생성 응답을 잃었다면 기록한 같은 request_id/입력으로만 멱등 재시도해 ID를 복원한다. 원래 요청이 실행되지 않았으면 의도했던 시험 항목을 만들어 즉시 정리할 수 있다는 부수효과를 명시한다. 현재 소유자 목록의 전 페이지에서 기록된 ID와 정확한 표식/제목을 확인하고 현재 버전으로 삭제한다. 결과 기록에는 표식뿐 아니라 journal의 Entity/태그 연결도 확인한다. 각 삭제 진행을 저장하고, 응답 유실 뒤 이미 없는 ID는 정리된 것으로 처리한다. 다른 ID/변경된 표식은 삭제하지 않는다.

업무 fixture 정리가 끝난 뒤 이번 token의 exact OAuth client_id만 정상 로컬 admin API로 삭제하며 404는 이미 정리된 등록으로 처리한다. 등록 정리 실패/응답 유실은 업무 삭제 진행을 유지한 채 재시도한다. 전체 정리 성공 후 journal의 token을 제거한다. OAuth 자체가 token을 반환하기 전 실패하거나 token 검증에 실패한 상태는 자동 정리하지 않고 own 인증 시도 확인 대상으로 남긴다. 만료된 token으로 업무 자료를 조회할 수 없으면 안전한 정리 재실행은 별도 정상 인증 인계가 필요하다.

`node --test experiments/plugin-behavior/journal.test.mjs`의 실제 journal 파일+모의 transport fault injection 5개 PASS: tag 뒤 Entity 실행 전 실패/commit 뒤 응답 유실, 삭제 응답 유실·OAuth 정리 실패 재시도, journal 디스크 실패에서 무쓰기·기존 파일/owner/endpoint/object 변경 거부, 네 생성 뒤 목록 발견 실패의 ID 보존/정리. foreign 자료는 보존하고 같은 request_id의 생성은 중복되지 않음을 확인했다. 이 결과는 실제 DB/OAuth/클라이언트 재실행을 대신하지 않는다. 공유 환경 UI 독점 중 연결·서비스·fixture 실행은 없었으며 강화 runner의 실제 실행과 Claude native 인증은 재배정 후 진행한다.

### 재리뷰 P2 — 원칙 목록의 실제 입력 계약

exact `2e57a2e` 재리뷰에서 cleanup의 `list_principles(status=all)`은 실제 `principleListQuery`의 active/inactive enum에 없는 값으로 거부됨을 확인했다. 첫 journal 문제는 해결됐지만 이전 모의 transport가 입력 schema를 검사하지 않아 이 정리 실패를 놓쳤다. 또 listTools 실패 테스트의 독립 rejected Promise는 runner의 실제 setup 경계를 실행하지 않았다.

원칙 목록 정리는 active/inactive를 별도로 마지막 페이지까지 조회하고 각 상태의 cursor를 새로 시작하도록 바꿨다. 생성 4단계와 listTools·ready 저장을 `setupOwned`로 옮겨 실제 fixture runner와 테스트가 같은 setup 경계를 호출한다. 목록 발견 실패는 그 listTools callback에서 발생시키고 callback 진입 시 디스크의 생성 ID 4개를 검사한다.

모의 transport는 실제 앱의 activity/entity/principle/tag MCP ToolDef를 import하고 각 `input.parse`를 통과한 요청만 수행한다. UUID·필수 필드·기본값도 실제 입력 계약을 따른다. source ToolDef의 TypeScript parameter property 때문에 일반 Node strip-only import는 실패했으며 `node --experimental-transform-types --test experiments/plugin-behavior/journal.test.mjs`로 Node 24.15.0에서 실행했다(실험 경고 있음). 앱 코드·의존성·전역 설정은 바꾸지 않았다.

실제 schema가 all/status를 invalid_value로 거부하고 그 시점 OAuth 삭제 0/token 잔존임을 재현했다. 그 뒤 수정된 cleanup은 active/inactive 각각의 여러 페이지에서 자기 원칙만 찾아 지웠다. 자기 원칙이 각 상태의 세 번째 페이지인 두 회귀에서 foreign 원칙 4개 보존·상태별 cursor 분리·own OAuth 삭제 1·journal token 제거를 확인했다. 기존 부분 생성/삭제/인증/디스크 failure와 실제 setup 목록 실패를 합쳐 7개 PASS. 이 검증은 실제 입력 계약+모의 저장/전송이며 실제 DB/OAuth/CLI 흐름 성공으로 표시하지 않는다. 공유 UI 독점 중 서비스·PTY·OAuth·MCP 호출은 없었다.

## 강화 runner의 실제 재실행과 Claude native 인증

UI 담당이 명시 반환한 뒤 메인이 공유 local 환경 독점과 medium 실제 구현 검증을 재배정했다. 서버·스킬·runner를 승인 head `8c94b4b1e6c43be5463e6ddb91e17c22e34cc4d5`(main base `24d1251`)에 고정했다. master의 `.env.local`, `supabase/functions/.env`, `supabase/signing_keys.json` 세 로컬 파일만 ignored 위치에 복사했고 prod `supabase/.env`는 복사하지 않았다. 기존 DB55421/primary55480/fin을 유지하며 자기 checkout에서 `npx supabase functions serve --env-file supabase/functions/.env`를 실행했다.

2026-10-04(KST) `models.mjs`를 다시 실행해 Codex0.147.0 model/list 4개 및 Terra/medium 지원, Claude2.1.140 sonnet→claude-sonnet-4-6과 medium 옵션 수락을 확인했다. 새 snapshot은 외부 `plugin-behavior-models-20261004-final/`에 있고 실제 행동 runner가 각 실행 직전 assign PASS를 다시 확인했다. Codex backend 실제 model/effort는 미노출, Claude init/modelUsage는 Sonnet4.6이며 backend effort는 미노출이다.

| 실제 0.1.1 로컬 실행 | Codex | Claude |
| --- | --- | --- |
| 실행 표식 | plugin-codex-cli-d21d493b9e6d | plugin-claude-cli-93882ffb54a3 |
| 발견/선택 | 31개 MCP 도구, 동일 shared SKILL hash. 별도 `$workspace` 선택 증거와 구분 | init에 workspace 제품만 connected31, Skill workspace:workspace 성공. claude.ai discovery 제외 확인 |
| 실제 호출 | list_principles/search/list_entities/list_tags/get_record/get_principle/get_entity/create_record | search/list_principles/list_tags/get_record/get_entity/create_record. 별도 get_principle는 미호출이며 목록의 전체 원칙 body를 사용 |
| 독립 재조회 | resultCount1, 원문 코드·원칙·Entity·tag_ids 모두 PASS | 동일 PASS, permission_denials0, exit0 |
| 실제 강화 cleanup | active 자기 원칙 및 자기 자료만 삭제, journal cleaned/deleted4/OAuth 삭제/token 제거 | 자기 원칙을 inactive로 전환한 뒤 같은 cleanup으로 삭제, 동일 journal/인증 정리 PASS |

두 행동은 실제 웹 동의로 발급한 시험 MCP Bearer를 환경으로 전달한 실행이며 native 인증 사용 실행과 구분한다. 시작/완료 도구 이벤트의 반복은 중복 저장이 아니며 재조회에서 정확히 한 기록을 확인했다. 비밀 없는 실행/독립 재조회/정리 증거는 외부 `C:/Users/yongin/AppData/Local/Temp/plugin-behavior-final-20261004/`의 각 표식 디렉터리와 `cleanup-evidence.json`, `own-inactive-evidence.json`이다. 정리된 두 journal에는 token이 없다. Codex cleanup 프로세스가 아직 종료 전인 순간 첫 증거 수집이 cleaned를 기대해 실패했으나, 실행 완료를 기다린 뒤 두 journal의 정리 완료를 확인했다. 서버 정리 실패나 blind retry로 처리하지 않았다.

### 정상 기존 계정의 Claude native OAuth

일반 CLI 계정 인증을 복사 없이 읽는 PTY에서 `--setting-sources project,local --plugin-dir <outside-copy> --model sonnet --effort medium`, `ENABLE_CLAUDEAI_MCP_SERVERS=false`를 사용했다. 복사본만 제품 `workspace-native-check-8c94`/서버 `oauth-check-8c94`의 고유 식별자와 기존 loopback MCP 주소로 바꾸고 Authorization header를 넣지 않았다. `/mcp`는 서버 1개와 처음 `needs authentication`/`not authenticated`를 보여 기존 인증을 재사용하지 않는 시험임을 관찰했다. 원래 prod Workspace 연결이나 다른 연결은 노출되지 않았다.

해당 서버의 정상 Authenticate 메뉴를 선택해 CLI가 만든 PKCE 요청을 실제 로컬 dev owner A 로그인·승인 버튼으로 승인했다. `authorize-native-web.mjs`는 요청 URL을 외부 임시 파일로 읽고 정상 CLI loopback callback까지 이동했다. callback을 가로채거나 token을 주입하지 않았다. CLI는 Authentication successful/Connected를 표시했고 `/mcp`에서 authenticated/connected31을 재확인했다. 이것은 새 home의 LLM 미로그인 제약을 정상 계정 경로로 해결한 실제 native 인증 성공이다.

이어 정상 CLI의 native 저장 인증을 그대로 읽는 별도 print 세션에서 Sonnet/medium assign PASS와 init Sonnet4.6·단일 시험 서버 connected31을 확인했다. `read-native-claude.mjs`는 정확한 시험 list_tags만 허용했고 실제 호출 1회·tool_result 오류 없음·permission_denials0·exit0을 관찰했다. 개인/native token 파일을 직접 읽거나 복사하지 않았다. 모델/medium 표시·옵션 수락과 backend 실제 effort를 구분한다.

원래 PTY에서 시험 서버의 정상 Clear authentication을 선택해 Authentication cleared for 해당 식별자를 확인했고 `/mcp`가 다시 needs authentication을 표시했다. 그 요청에서 생성된 exact 시험 DCR client_id만 local admin API로 삭제하고 getClient404를 확인했다. 기존 연결의 OAuth/keychain/global MCP 설정을 교체·삭제하지 않았다. 외부 authorization.json은 삭제했으며 비밀 없는 `native-claude-8c94/{preparation,web-consent-evidence,native-read-evidence,native-oauth-evidence}.json`만 남겼다. 이 인증/읽기 증거는 외부 Claude 웹/desktop/mobile나 prod endpoint의 업무 성공이 아니다.

### 서비스 반환과 최종 인계

자기 native PTY는 exit0, functions CLI 세션95086은 CtrlC로 종료했다. DB55421/primary55480 Listen을 확인하고 환경을 명시 반환했다. 다만 CLI 종료 뒤 Edge 런타임 컨테이너는 자기 source bind로 계속 실행 중인 것을 메인이 확인했다. CLI 프로세스 종료만으로 컨테이너까지 종료됐다고 보고한 부분을 정정했다. 메인이 정확한 `supabase_edge_runtime_agent-workspace-template` 1개를 stop/rm(volume 보존)하고 primary main `ff1863d20bd558774dba4312cf3d9cd3c7fd2924`의 기존 앱 API를 복구하기로 인계했다. 그 뒤 이 담당은 서비스 호출을 중단했다. fin/DB reset·다른 프로세스 종료·운영 쓰기는 없었다.

후속 helper의 고유 식별자 파생·외부 증거 위치·loopback/PKCE/외부 callback·주입 header 거부 보강은 실제 성공 실행 뒤 적용했다. `native-guards.test.mjs`는 서비스/LLM/브라우저 시작 전 거부 경로 2개(6개 입력 조합)를 오프라인 검증했다. 실제 입력 schema journal 회귀7, 문서·구문·diff 검사도 수행한다. 최신 main rebase/독립 리뷰/PR80 CI와 최종 ZIP/sidecar main revision 고정·운영 release 검증은 메인이 후속 조정한다. 로컬 양 CLI 행동·정리는 8c94에서 완료했다. native 인증/발견 증거의 source는 이전 Codex 72d4와 이번 Claude 8c94로 다르며 둘을 같은 revision에서 완료했다고 주장하지 않는다. 접근 불가 surface와 운영 행동은 미검증으로 유지한다.

최종 로컬 검사: `npm run check:docs` PASS(문서321개, 스크립트36 PASS/1 Windows file symlink privilege SKIP), journal 실제 schema/fault injection7 PASS, native guard2 PASS, 실험 `.mjs` 전체 `node --check` 및 `git diff --check` PASS. helper 보강 뒤에는 서비스·LLM 재호출 없이 이 오프라인 검사만 수행했다.

## 최종 현재 완료 연결

[PR #80 완료5974516525](https://github.com/kimyongin/agent-workspace-template/pull/80#issuecomment-5974516525)·[CI37160563892 SUCCESS](https://github.com/kimyongin/agent-workspace-template/actions/runs/37160563892), exact18b7eff 독립 머지 가능 후 main `1730dc983eb10e282e28f3a200ffbd265978480e`으로 완료됐다. 첫 통합 실패·활동 PR #81 보강·rebase/최종 재검증과 각 frozen 실제 실행 이력은 보존한다. 최종 cleanmain1730dc의0.1.1 ZIP SHA78974e53e41615a85943037a91db04c30c766a2b6e353e8d992ef71013fa60e3 및 서버·Pages 적용/제약은 [Template-10-06](template-10-06-existing-release.md)에 연결한다. 실제 local8c94 양CLI 업무/정리·Claude native 인증/읽기/해제, 이전72d4 Codex native 근거와 prod 실사용은 구분한다. 운영 세션 미접근·claude.ai 웹/mobile·backend effort/실청구액은 미확인이고 Cron은 소량 성공 미증명으로 보류다.
