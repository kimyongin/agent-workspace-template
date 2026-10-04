# Template-11 — 개발 모델 허용 정책

작성: 2026-10-04
상태: 구현·로컬 검증 완료, 독립 리뷰·CI·머지 대기
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
- 지원 누락·차단이면 중단한다. 현재 CLI 미지원은 pending으로 남기며 다른 모델 성공이나 Desktop 근거를 CLI 성공으로 재사용하지 않는다.
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

## 실행·검증 증거

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

선택표의 Codex CLI/Claude CLI 세 등급 capability/nativeExecution은 pending이다. CLI 지원 실패를 모델 능력 실패로 세지 않는다. 신규 대표 품질·비용 비교, 실제 모델별 low/high 실행·backend effort, CLI native child/resume은 미검증이다. 과거 Template-05·10-05·10-08 성공은 당시 모델/설정의 동결 이력으로 유지한다.

## 완료 조건과 이력

- [x] 허용 정책·정본/native·개발 지침을 함께 갱신
- [x] 금지 모델·actual drift·평가 우회 거부와 비소유 TOML/Claude JSON 보존 회귀
- [x] 현재 CLI 제약을 직접 확인하고 pending/거부 근거 기록
- [ ] 독립 리뷰·같은 head 필수 CI·머지

최종 로컬 검증·커밋 인계는 제출 전 이 절에 함께 기록하며 제출 후 최종 head·리뷰·CI·머지는 PR 완료 코멘트/checks가 소유한다.

2026-10-04 제출 전 로컬 snapshot: `npm run check:docs` 텍스트329개·정합성·총40검사/39 PASS/1 skip(Windows 파일 symlink 생성 권한 미지원), 모델 회귀19개 PASS. `git diff --check` PASS. 오늘 보존 Desktop snapshot으로 balanced/medium 일반 assign PASS(`gpt-6.1-sol`, actual 동일, fork_turns=none). main 기본값 pin 이후 TOML main effort·다른 agents/MCP 설정과 Claude JSON 비소유 설정·동일 원문·잘못된 객체 거부를 함께 검증했다. 앱/DB/공유 서비스는 변경하지 않아 해당 실행 검사는 범위 밖이며 필수 CI는 본 세션에 인계한다.
