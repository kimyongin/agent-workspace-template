# Template-11 — 개발 모델 허용 정책

> 이전 기록이다. 현재 작업과 완료 근거는 [GitHub 이관 대응표](migration-to-github.md)에서 확인한다.

작성: 2026-10-04
상태: 허용 정책 PR #83 머지 완료; 업데이트 후 CLI 실행·로컬 검증 완료, 후속 독립 리뷰·CI·머지 대기
검토 기준: base `64a61ef4f5d25cbaeed34013d6833d0d6597fc95`
선행: [Template-05](template-05-agent-model-policy.md), [Template-10-08](template-10-08-model-resume.md)

## 목표와 승인 범위

사용자는 Codex GPT-6.1 Sol과 Claude Opus 5.5만 개발 모델로 사용하도록 지시했다. 본 대화·구현·리뷰·조사·문서·child·평가·재개의 선택 모델과 fallback에 적용한다. Astra/Fable와 다른 낮은 모델도 사용하지 않는다. 공급자 내부 분류/보조 모델을 통제하는 기능으로 확대하지 않는다.

사용자 첨부 Terminal Bench 4.0 그래프의 대략적인 6.1 Sol 62%/$1.5 대 Astra 57%/$9, Opus 5.5 59%/$13 대 Fable 57%/$18은 사용자의 선택 이유다. 전체 프로젝트 품질·개별 청구 비용이나 모든 과제의 효율을 검증한 결과로 재사용하지 않는다. [GPT-6.1 Sol 공식 ID·API 강도](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [Opus 5.5 공식 ID](https://platform.claude.com/docs/en/models/opus-5-5/overview), [Claude 고정 ID 설정](https://code.claude.com/docs/en/model-config)은 본 세션이 확인한 출처다. API 지원과 실제 CLI/계정 지원은 별도다.

ADR-0007/0008 안의 개발 방법·선택표·도구 변경이다. PRD·ADR, 앱·DB·서비스·운영 배포·개인 전역 모델/권한·CLI 업데이트는 제외한다. 과거 다른 모델의 실행 기록은 그대로 보존한다.

## 계약과 PR 계획

- 선택표 schema3의 `modelPolicy.allowedModels`가 공급자별 단일 허용 고정 ID의 정본이다. 코드에는 공급자 모델명을 복제하지 않는다. 정책 변경 권한은 `explicit-human-policy-change`이며 사람의 명시 변경·리뷰 없이 허용 목록을 넓히지 않는다.
- 세 등급은 같은 모델의 기본 강도 low/medium/high다. 난이도와 실패 근거에 따라 지원되는 강도만 조정한다.
- check/sync/assign 및 `--evaluate`는 선택 model/Claude resolvedModel의 허용 ID 일치를 요구한다. assign의 snapshot actualModel도 고정 선택 ID와 정확히 같아야 한다. alias 이동·family 일치·부모 상속·fallback으로 통과시키지 않는다.
- 지원 누락·차단이면 중단한다. CLI 미지원은 pending으로 남기며 다른 모델 성공이나 Desktop 근거를 CLI 성공으로 재사용하지 않는다.
- sync는 생성 agent 파일과 `.codex/config.toml`의 top-level model/두 agents defaults와 `.claude/settings.json`의 model만 소유한다. main 기본 ID를 pin하되 나머지 사용자 설정과 main effort는 보존한다. 파일 변경은 기존 메인 세션이나 Desktop 고정 profile metadata의 적용 증거가 아니다.

| PR | 브랜치 | 완료 시 확인할 동작 |
| --- | --- | --- |
| 1 | `codex/model-allowlist` | 두 공급자 고정 ID 정책·생성 정의·배정/평가 거부·현재 지원 제약을 같은 단위로 확인 |

## 배정과 인계

| 필드 | 기록 |
| --- | --- |
| 작업 공간 | `C:/Users/yongin/.codex/worktrees/model-evaluation/agent-workspace-template`, branch `codex/model-allowlist`, 위 base에서 clean 시작 |
| 구현 담당 | 구현 서브세션이 scripts/회귀·선택표·native 생성 정의·개발 문서·현재 요약·이 티켓 담당. 본 세션은 독립 리뷰·PR·CI·머지 담당 |
| 명시 배정 | 본 세션의 worker 직접 호출 `model=gpt-6.1-sol`, `reasoning_effort=medium`, `fork_turns=none`; 일반 정책/도구 수정이므로 medium. 고정 5.6 profile은 사용하지 않음 |
| 개발일 조회 | 본 세션이 직접 읽은 Desktop snapshot observedAt `2026-10-03T19:38:53.586Z`, Asia/Seoul 10-04. version `session-tool-catalog-2026-10-03`, actual 6.1 동일, low/medium/high/xhigh/max/ultra, blocked=false |
| 실제 확인 | 이 worker 명시 배정의 도구 성공은 본 세션이 확인. backend 실제 effort·실청구액은 미관측. low/high 새 실행을 이 medium 실행으로 완료 처리하지 않음 |
| 다음 단계 | 본 세션이 로컬 exact head를 독립 리뷰하고 같은 head 제출·필수 CI·머지. 새 CLI 지원은 각 설치/계정에서 다시 확인 |

## 최초 실행·검증 증거(당시 이력)

2026-10-04 구현 서브세션 직접 실행. 공유 서비스·운영 DB를 시작하거나 변경하지 않았다.

| 검사 | 결과와 한계 |
| --- | --- |
| `node scripts/agent-models.mjs sync` / `check` | 양쪽 고정 ID와 등급별 기본 강도 정합성. 비소유 main config 보존 |
| `node --test scripts/agent-models.test.mjs` | 19개 PASS: 금지 선택의 모든 등급/클라이언트 check·sync·assign·평가 거부, native 전체 byte 보존, resolved/actual 이동 거부, 기존 시각/환경/강도 및 TOML 보존 회귀 |
| `npm run check:docs` | 텍스트329개·정합성·회귀40개 중39 PASS/1 skip(Windows 파일 symlink 권한 제약). PASS |
| `git diff --check` | 최종 로컬 실행 결과는 아래 이력에 기록 |
| Codex CLI `--version`·app-server initialize→model/list | 0.147.0. observedAt `2026-10-04T00:01:09.921Z`, limit100/includeHidden=false, 끝 페이지까지 읽음. 5.6-sol/terra/luna·5.5만 있고 6.1 없음. LLM turn 없음 |
| 오늘 Codex snapshot의 `assign --client codex-cli --tier balanced --effort medium --role implement --reason '허용 고정 ID 현재 지원 확인' --snapshot <TEMP/model-allowlist-codex-snapshot.json> --evaluate` | exit1 `모델 누락/차단/실제 모델 불일치; 부모 fallback 금지`. 실제 누락은 평가에서도 거부. 다른 모델 실행 없음 |
| Claude CLI 고정 ID 단일 smoke | 아래 명령 exit1. API400 `Claude Code 2.1.140 does not support this model; version 2.1.280 or newer is required.` input/output0, modelUsage={}, total_cost_usd0. actual Opus 실행·backend effort 성공 근거 아님 |

```text
claude -p --model claude-opus-5-5 --effort medium --tools '' --disable-slash-commands --setting-sources project --strict-mcp-config --system-prompt 'Reply with exactly READY.' --output-format json --no-session-persistence 'READY'
```

Claude smoke는 저장소 밖 OS TEMP에서 정상 기존 계정으로 수행했다. 자격 증명을 복사하지 않았으며 tools·MCP·fallback·세션 저장 없이 한 번만 요청했다. CLI help에서 `--fallback-model`은 지정할 때 fallback을 활성화하는 옵션임을 확인했고 사용하지 않았다. 거부 후 다른 모델·alias로 재시도하거나 CLI를 업데이트하지 않았다. 내부 보조 사용도 modelUsage가 비어 있어 관측되지 않았다. 이 실패의 `subtype=success` 문자열보다 exit1/is_error=true/API400이 결과를 결정한다.

최초 제출 시 선택표의 Codex CLI/Claude CLI 세 등급 capability/nativeExecution은 pending이었다. CLI 지원 실패를 모델 능력 실패로 세지 않는다. 신규 대표 품질·비용 비교, 실제 모델별 low/high 실행·backend effort, CLI native child/resume은 미검증이다. 과거 Template-05·10-05·10-08 성공은 당시 모델/설정의 동결 이력으로 유지한다.

## 완료 조건과 이력

- [x] 허용 정책·정본/native·개발 지침을 함께 갱신
- [x] 금지 모델·actual drift·평가 우회 거부와 비소유 TOML/Claude JSON 보존 회귀
- [x] 현재 CLI 제약을 직접 확인하고 pending/거부 근거 기록
- [x] 허용 정책의 독립 리뷰·같은 head 필수 CI·머지(PR #83)
- [x] 사용자 작업 4의 최소 허용 CLI 부모·실제 child·같은 ID 지원 재개 확인
- [ ] 업데이트 후 CLI 후속의 독립 리뷰·같은 head 필수 CI·머지

최종 로컬 검증·커밋 인계는 제출 전 이 절에 함께 기록하며 제출 후 최종 head·리뷰·CI·머지는 PR 완료 코멘트/checks가 소유한다.

2026-10-04 제출 전 로컬 snapshot: `npm run check:docs` 텍스트329개·정합성·총40검사/39 PASS/1 skip(Windows 파일 symlink 생성 권한 미지원), 모델 회귀19개 PASS. `git diff --check` PASS. 오늘 보존 Desktop snapshot으로 balanced/medium 일반 assign PASS(`gpt-6.1-sol`, actual 동일, fork_turns=none). main 기본값 pin 이후 TOML main effort·다른 agents/MCP 설정과 Claude JSON 비소유 설정·동일 원문·잘못된 객체 거부를 함께 검증했다. 앱/DB/공유 서비스는 변경하지 않아 해당 실행 검사는 범위 밖이며 필수 CI는 본 세션에 인계한다.

## 업데이트 후 CLI 실행 확인

사용자가 남은 작업 1~4를 모두 진행하도록 승인했고 이 서브세션은 4의 최소 CLI 실행 확인을 담당했다. 본 세션이 공식 Codex CLI npm 0.160.0과 Claude native 2.1.289 설치·사용자 PATH 갱신을 수행했다. 이 worker는 기존 모델 허용 정책을 유지하며 아래 두 절대 실행 경로만 사용했다. 기존 로그인·세션·개인 권한/모델 설정을 바꾸지 않았으며 기존 Winget 2.1.140의 잠금/업데이트 실패를 종료·삭제로 해결하지 않았다. 대표 품질·비용 평가는 사용자 제외 범위다.

허용 정책은 [PR #83](https://github.com/kimyongin/agent-workspace-template/pull/83), exact head `c7a1f0d173a233e105ca2f276feceaa664c78601`의 [독립 리뷰](https://github.com/kimyongin/agent-workspace-template/pull/83#issuecomment-5974884713)·[CI 성공](https://github.com/kimyongin/agent-workspace-template/actions/runs/37164186506) 후 `fa8b706fbc461117e9c42a0ced35c5c274a53b12`로 머지됐다는 본 세션 인계를 받았다([완료 기록](https://github.com/kimyongin/agent-workspace-template/pull/83#issuecomment-5974965903)). 후속은 같은 clean base에서 `codex/cli-fixed-model-smoke`로 분기했고 동일 model-evaluation checkout에서 네 개발 문서와 [선별 실행 증거](../../experiments/agent-model-evaluation/results/fixed-model-cli-20261004.json)를 소유한다. 다른 작업자의 변경은 편집하지 않는다.

| 실행 | 직접 확인한 근거 | 한계 |
| --- | --- | --- |
| Codex 목록·strict parser | `C:/Users/yongin/AppData/Roaming/npm/codex.cmd` 0.160.0. strict-config app-server initialize/model-list limit100/includeHidden=false, 마지막 페이지까지 8개. observedAt `2026-10-04T00:40:07.248Z`, 6.1 Sol과 low/medium/high/xhigh/max/ultra 노출 | 다른 모델은 조회만 수행. 목록은 실제 실행 증거와 구분 |
| Claude 현재 지원 발견 | `C:/Users/yongin/.local/bin/claude.exe` 2.1.289. exact Opus 5.5/medium·tools없음·MCP없음 1 READY, observedAt `2026-10-04T00:40:10.378Z`, init/assistant/modelUsage 모두 exact ID | 이 발견 smoke의 현재 모델/medium snapshot을 이후 preflight에 사용. low/high의 현재 지원을 이 실행으로 확정하지 않음 |
| 사전/사후 assign | 양 CLI balanced/medium의 오늘 실제 snapshot으로 먼저 `--evaluate` PASS, 실행 상태 갱신 뒤 일반 assign PASS | 실행 smoke 목적이며 evaluation=baseline 유지; 품질·비용 통과 아님 |
| Codex 부모·resume | 명시 `--ignore-user-config --strict-config --model gpt-6.1-sol -c model_reasoning_effort="medium"`, read-only. ID `01a1045b-e5eb-7bf3-a8c0-f635c63e05c1` 동일, READY MAPLE-604→재개 MAPLE-604. 두 로컬 turn_context model/effort 일치, exit0 | 별도 backend actual inference 모델/effort 검증은 아님 |
| Codex 직접 native child·resume | 부모 `01a10460-be56-7f63-94e6-4d3d4e6ab455`가 actual spawn_agent로 model6.1/medium/forknone 지정. child `01a10460-db45-75d3-9429-96f62ab17728`, source의 parent/depth1/path `/root/marker_smoke` 일치. 초기 CHILD MAPLE-DIRECT-604→같은 child followup MAPLE-DIRECT-604, 두 turn_context 동일 | child tool0·추가 child0. normal close tool은 없었으며 생성한 CLI 부모는 child 두 turn 완료 뒤 종료. 기존 sessions 유지. custom 정의 실행으로 표시하지 않음 |
| Codex custom 정의 선택 | 기본 surface와 invocation-local `--enable multi_agent_v2` 모두 custom selector 미지원 보고, child0. 후속 일반 직접 native 경로는 별도 승인해 위 행에서 확인 | 모델의 schema 보고는 독립 function-schema dump가 아님. 첫 read-only 파일 읽기는 실행 정책 거부. 지원 없는 selector나 다른 모델로 우회하지 않음 |
| Claude 부모·resume | ID `e299e696-2930-4ee7-8a41-23c0bf071986` 동일, READY LILAC-604→재개 LILAC-604. 명시 고정 Opus/medium, init/assistant/modelUsage 일치, exit0 | backend actual effort·추가 실청구액 증명은 아님 |
| Claude native 정의·child·resume | `--agent task-balanced` ROLE-READY exit0와 별도로 실제 Agent(Task) subagent_type task-balanced 1회. 부모 `3d5b0571-0f23-48a2-9eb1-a81379826a10`, child `ab13f5ad4219ac251`. .meta agentType 정확·child transcript 모든 assistant Opus5.5. CHILD LILAC-CHILD-604→SendMessage 같은 ID 재개 LILAC-CHILD-604, 두 결과까지 exit0 | child는 명시 부모 medium을 상속; 실제 child/backend effort metadata 미관측. child skill·START·ticket·선택표 Read4, 별도 AGENTS Read는 없어 전체 안내 준수로 과장하지 않음 |

공식 [Codex subagent 설정](https://learn.chatgpt.com/docs/agent-configuration/subagents)·[app-server 재개](https://learn.chatgpt.com/docs/app-server)·[Claude subagent/SendMessage](https://code.claude.com/docs/en/sub-agents)·[CLI 인자](https://code.claude.com/docs/en/cli-reference)를 실제 열고 설치 도움말과 대조했다. `codex --strict-config app-server generate-json-schema`는 그 subcommand에서 strict-config 미지원으로 즉시 거부됐고 flag 없이 schema 생성은 성공했다. strict parser 성공은 실제 app-server 목록·exec·resume에서 별도로 확인했다. schema dump를 함수 custom selector의 독립 증거로 사용하지 않는다.

모든 요청은 고정 허용 ID와 명시 medium으로 실행했다. Claude `--fallback-model`은 사용하지 않았고 init/assistant/usage에 다른 주 모델이 없다. 내부 보조 모델을 정책으로 통제한다고 주장하지 않는다. Codex native child의 실제 입력 메시지는 로컬 rollout에 암호화돼 있으므로 선별 증거에서 해당 payload를 생략하고 원 요청·실제 응답·source·turn_context를 대조한다. Claude SendMessage에는 marker를 넣지 않은 평문 인자와 같은 ID의 실제 재개 응답이 있다.

원 stdout/stderr·정확 argv·시간/exit 메타는 저장소 밖 `C:/Users/yongin/AppData/Local/Temp/cli-fixed-model-smoke/`의 각 실행명 `.stdout/.stderr/.meta.json`에 즉시 저장했다. 알려진 Codex rollout과 Claude child transcript 경로는 선별 JSON에 기록했다. 커밋에는 선택 모델·명시 인자·도구·ID·marker·필요한 사용량 범위만 포함하며 원 system prompt·thinking·자격 증명·rate-limit·소켓 metadata를 넣지 않는다. CLI list 요금/usage는 실제 구독 청구액이나 모델 비교로 평가하지 않는다.

선택표는 Codex CLI capability(목록 강도)만 세 등급 confirmed, balanced nativeExecution은 direct-confirmed로 갱신했다. Claude는 실제 medium을 확인한 balanced capability/nativeExecution만 confirmed/native-confirmed이고 light/advanced는 pending이다. Codex custom 정의와 다른 강도의 새 실행, backend effort·청구·대표 품질/비용 평가는 완료로 표시하지 않는다. 이 worker는 서비스/운영 DB/글로벌 설정/CLI를 변경하지 않았다.

후속 로컬 필수 검증은 `npm run check:docs`와 `git diff --check`이며 앱/DB 변경이 없어 해당 추가 실행은 범위 밖이다. 같은 head의 독립 리뷰·필수 CI·PR·머지는 본 세션에 인계한다.

후속 제출 전 snapshot: `npm run check:docs` 텍스트330개·선택표/native 정합성·총40검사 중39 PASS/1 기존 Windows symlink 권한 skip, 모델 회귀19개 PASS. `git diff --check` PASS. 원 선별 JSON에 대한 직접 Node assert로 같은 부모 ID, source가 연결된 단일 Codex child/두 turn model·effort/두 marker/child tool0, Claude child meta·전 assistant/modelUsage ID·두 marker·부모 같은 ID를 대조해 PASS했다. 사용자 작업 4의 최소 실행 확인은 완료했으며 custom selector 미지원은 별도 한계다. 제외한 대표 품질·비용 평가를 필수 잔여로 다시 배정하지 않는다. 본 세션의 다른 1~3 작업 기록과 통합한 후 정확한 최종 head 독립 리뷰·CI·머지는 본 세션이 담당한다.
