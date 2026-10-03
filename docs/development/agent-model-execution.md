# 모델 선택표와 클라이언트 실행

정책은 [개발 방법](workflow.md#모델과-추론-강도-선택갱신), 값은 [선택표](agent-models.json)가 소유한다. 이 문서는 클라이언트별 연결만 설명한다. 선택표의 context는 비밀을 담지 않는 현재 계정·공급자·surface 식별자다. 다른 계정이나 설치에서는 복사해서 지원된 것으로 간주하지 않고 다시 확인한다.

## 배정 전 확인

새 checkout에서는 Node 22 이상으로 `npm ci`를 먼저 실행해 lockfile에 고정한 TOML 편집·검증 의존성을 준비한다. 이후 아래 검사·배정 명령을 실행한다. 개인 전역 설정이나 추가 런타임 설치는 필요하지 않다.

개발일 첫 작업에서 계정·공급자·클라이언트별 실제 목록/도구 노출과 CLI 버전, 별칭의 actual 모델 및 새 후보를 한 번 읽고 아래 형식의 JSON을 저장소 밖 임시 파일에 만든다. 이 파일이 그날 재사용하는 조회 결과다. timeZone은 사용자가 명시한 IANA 시간대이며 observedAt은 시간대가 포함된 **실제 조회 시각**이다. 호스트 시간대로 추정하거나 복사한 자료에 현재 시각만 넣지 않는다. 배열의 effort도 실제 지원 확인 결과다. API 키·메일·토큰을 넣지 않는다. 스크립트는 snapshot과 선택표의 일치만 검사하므로 사람이 만든 허위 snapshot을 실제 공급자 증거로 보증하지 않는다.

```json
{
  "client": "codex-cli",
  "version": "0.147.0",
  "context": "owner-desktop-codex-cli",
  "observedAt": "2026-10-03T12:00:00Z",
  "timeZone": "Asia/Seoul",
  "models": [{ "model": "gpt-5.6-terra", "actualModel": "gpt-5.6-terra", "efforts": ["low", "medium", "high", "xhigh", "max", "ultra"], "blocked": false }]
}
```

client는 `codex-cli`, `codex-desktop`, `claude-cli` 중 실제 실행할 surface다. CLI의 `model/list`와 desktop의 도구 목록을 바꿔 쓰지 않는다. Codex는 app-server `initialize` 뒤 `model/list`를 페이지 끝까지 읽는다. Claude는 현재 공급자·별칭 해석·모델별 지원을 확인한다. CLI help에 effort 옵션이 있다는 사실만으로 모든 모델의 강도 지원을 입증하지 않는다.

```text
node scripts/agent-models.mjs assign --client codex-cli --tier balanced --effort medium --role implement --reason "일반 구현" --snapshot <저장소 밖 현재 증거.json>
node scripts/agent-models.mjs assign --client codex-desktop --tier balanced --effort high --role investigate --reason "복잡한 경계 조사" --snapshot <현재 증거.json>
node scripts/agent-models.mjs assign --client claude-cli --tier balanced --effort medium --role review --reason "일반 리뷰" --snapshot <현재 증거.json>
```

출력은 실행 명령이 아니라 검토할 **인자**다. 이를 실제 도구/CLI로 전달하고 역할·티켓·승인 범위를 prompt에 포함한다. 선택 근거와 역할은 필수이며 고성능/높은 강도에서도 생략하지 않는다. 현재 평가 미완료 경로는 `--evaluate`로 작은 대표 과제만 수행하고 결과에 미검증 항목을 남긴다. snapshot은 미래가 아닌 사용자 현지 오늘의 조회여야 하며 자정이 지나면 첫 작업에서 다시 조회한다. 선택표 checkedAt은 기존 검증의 실제 시각으로 보존하며 쉬었던 기간만으로 만료되지 않는다. 계정·공급자·클라이언트가 달라지면 목록·버전·능력·근거를 재확인한다. 목록 조회와 후보 평가·실행 smoke의 근거는 구분한다. 이 명령은 LLM을 호출하거나 버전/설정/계정을 자동 변경하지 않는다.

## Codex

[공식 설정](https://learn.chatgpt.com/docs/agent-configuration/subagents)은 `.codex/agents/*.toml`의 명시 모델/강도와 `.codex/config.toml`의 `[agents]` 균형 defaults를 지원한다. 설치 CLI에서 schema 지원과 actual 실행은 별도로 확인한다. custom 정의의 모델/강도는 explicit spawn보다 우선하므로 정의의 기본 강도와 다른 배정에 custom agent를 그대로 지정하지 않는다.

- **desktop 직접 도구:** custom agent_type 없이도 명시 `model`, `reasoning_effort`, `fork_turns="none"`를 출력대로 전달하고 좁은 인계를 준다. 대화 전체를 상속하면 model override가 허용되지 않는 현재 도구에서는 이 경로가 필요하다.
- **desktop 재개:** 현재 `collaboration.followup_task`는 target/message만 받고 모델·강도 변경 인자가 없다. 같은 결합 설정이면 followup으로 이어가고, 변경이 필요하면 preflight 후 `spawn_agent`에 새 모델·강도와 `fork_turns="none"`를 명시해 좁은 티켓 인계로 새 세션을 만든다. 기존 child에 preflight 출력이나 변경 요청을 보내는 것만으로 설정이 적용됐다고 하지 않는다.
- **CLI 직접 새 세션:** 출력된 `argv`의 `codex exec --model … -c model_reasoning_effort=…`와 공통 정본 읽기 지시를 전달한다. 모델/강도가 다른 custom 정의는 선택하지 않는다. `codex exec --strict-config`로 설치 버전의 설정 오류를 드러낼 수 있다. parent session의 강도에 의존하지 않는다.
- **native custom agent:** 배정이 정의의 모델·기본 강도와 정확히 같을 때만 사용한다. 다른 강도는 위 직접 경로를 쓰거나 해당 배정용 정의를 별도 작업 공간에 생성·검증한다. 기본 세 등급 파일을 매 배정마다 덮어쓰지 않는다.

[model/list](https://learn.chatgpt.com/docs/app-server#list-models-modellist)는 계정/버전에 의존한다. 현재 CLI 목록에는 desktop의 새 세대 모델이 없으며 실제 호출이 지원 오류로 거부될 수 있다. 이를 모델 능력 실패로 세지 않는다.

## Claude Code

[공식 subagent 정의](https://code.claude.com/docs/en/sub-agents)의 model frontmatter를 `.claude/agents/*.md`에 명시한다. 현재 2.1.140은 `--model`, `--agent`, `--effort`를 help에 표시하지만 새 문서의 effort frontmatter 지원을 현재 버전에 입증한 것은 아니므로 생성하지 않는다. 검증된 출력 model/effort는 `claude --model … --effort …`로 전달한다. native 경로까지 확인한 경우에만 출력 agent를 `--agent …`로 함께 전달한다. `none`은 해당 모델이 조절 기능을 지원하지 않음을 확인했을 때만 사용한다. 선택표의 `direct-confirmed`는 직접 명시 CLI/도구 경로, `native-confirmed`는 agent 정의 경로까지 증거가 있는 상태이며 각각 executionEvidence가 필요하다.

`CLAUDE_CODE_SUBAGENT_MODEL`은 이 설치 버전에서 정의보다 우선할 수 있으므로 설정되어 있으면 preflight가 거부한다. 부모의 호출에서도 이 환경이 비어 있는지 확인한다. 모델/추론 강도 변경 및 resume 직후 actual 모델을 다시 확인하고 불일치하면 중단한다. 2.1.140의 resume에서 invocation model 유지와 변경 적용은 미검증이다. 같은 설정의 재개도 실제 출력/세션 metadata를 대조하고 관찰되지 않은 값은 미확인으로 남긴다. 모델·강도를 바꿀 때는 명시 변경을 지원하고 적용을 확인할 수 있는 경로만 사용하며, 그렇지 않으면 검증된 직접 호출 인자로 새 세션에 좁은 티켓 인계를 준다. native 정의와 다른 모델을 지정해 검증된 native 경로라고 하지 않는다. 해석된 모델과 내부 보조 모델의 사용량은 구분한다. CLI가 effort를 수락한 사실과 backend의 실제 추론 토큰 검증도 구분한다.

[별칭](https://code.claude.com/docs/en/model-config)은 영구 ID보다 갱신에 유리하지만 공급자·버전과 alias 이동에 따라 actual 모델이 바뀔 수 있다. 확인한 resolvedModel과 다른 actual 모델은 같은 family의 새 버전이어도 재평가 전 거부한다. 초기 pending 후보의 평가에는 family 일치만 확인하며 일반 배정으로 승격하지 않는다. 누락·차단 때 `--fallback-model` 또는 부모 모델 상속으로 대체하지 않고 선택표를 갱신한다.

`sync`는 생성된 agent 파일들을 소유하지만 `.codex/config.toml`에서는 agents의 두 default 키만 소유한다. [toml-patch 3.3.0 parse/patch](https://github.com/DecimalTurn/toml-patch/blob/v3.3.0/docs/API.md)의 실제 문법·서식 보존 편집과 [smol-toml 1.9.0 parse](https://github.com/squirrelchat/smol-toml)의 독립 검증을 사용한다. 원문과 변경 후보를 모두 parse하며 `check`는 agents의 parsed 두 값으로 판단한다. 공백·basic/literal quoted 표/키, dotted/inline 표, multiline 본문을 처리하고 다른 설정·지침의 의미와 주석 내용은 보존한다. 편집기는 표 header의 동등한 표기·공백을 다른 표에서도 정규화할 수 있으며 전체 파일의 동일 byte를 보장하지 않는다. 두 키 외 parsed 의미가 변한 후보, 중복·잘못된 문법, agents가 표가 아닌 구조, parser/patch가 안전하게 처리하지 못한 입력은 거부한다. `sync`는 모든 후보를 검증한 뒤 쓰므로 이 거부 시 원본과 다른 native 파일 모두 보존한다. 선택표 외 모델/추론 설정을 직접 고쳐 drift 검사를 우회하지 않는다.

신규 후보를 `evaluation=passed`로 승격하려면 `evaluationEvidence`의 implementation/review/quality/cost에 각각 동일 revision의 과제·결과·비교·사용량/요금 근거 위치를 기록한다. 실행 성공만 확인한 현재 baseline에 이 상태를 붙이지 않는다.
