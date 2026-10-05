# 모델 선택과 클라이언트 실행

[프로젝트 모델 정책](workflow.md#모델과-추론-강도-선택갱신)은 Codex `gpt-6.1-sol`, Claude Code `claude-opus-5-5`를 사용한다. 일반 작업은 medium으로 시작하고 난이도·실패 근거에 따라 같은 모델의 강도를 조절한다. 값과 지원 확인 근거는 [선택표](agent-models.json)에 있다.

이 문서는 실행 환경 연결을 설명한다. Matt 스킬을 실행하기 위한 별도의 일일 점검·배정표·사전 승인 절차를 추가하지 않는다. 스킬의 작업 방법은 원문을 따른다.

## 직접 실행

설치된 클라이언트의 실제 도움말·지원 목록에서 고정 ID와 강도를 확인한다. Desktop의 도구 목록은 CLI 지원 증거가 아니며, 설정 파일 생성만으로 이미 실행 중인 세션의 모델이 바뀌지 않는다.

- Codex CLI: `codex exec --model gpt-6.1-sol -c model_reasoning_effort=medium`. 설정 지원은 `--strict-config`로 검사할 수 있다.
- Claude Code: `claude --model claude-opus-5-5 --effort medium`. 별칭·fallback 모델로 대체하지 않는다.
- Desktop 서브 에이전트: 현재 도구가 지원하는 명시 모델·강도로 생성한다. 모델을 바꿀 수 없는 고정 profile이 정책 밖이면 다른 지원 경로를 사용한다. 전체 대화 상속이 override를 막는 환경에서는 좁은 인계와 `fork_turns="none"`을 사용한다.
- 재개: 현재 도구가 동일 설정의 재개만 지원한다면 설정을 바꾸는 요청으로 실행값이 바뀌었다고 주장하지 않는다. 변경이 필요하면 지원되는 경로의 새 세션에 issue·현재 branch·남은 작업을 인계한다.

Native 역할 파일은 `.codex/agents/`, `.claude/agents/`에 있다. 역할 파일 존재와 실제 selector 지원은 별도로 확인한다. 실제 실행값이 노출되지 않으면 명시 배정값과 미확인을 구분한다. backend의 실제 추론 토큰·청구액도 별도 증거 없이 확인됐다고 쓰지 않는다.

## 선택적 보조 도구

새 checkout에서 `npm ci` 후 사용할 수 있다. 일반적인 스킬 호출에 이 도구 실행을 의무화하지 않는다.

```text
node scripts/agent-models.mjs check
node scripts/agent-models.mjs sync
node scripts/agent-models.mjs assign --client codex-desktop --tier balanced --effort medium --role implement --reason "일반 구현" --snapshot <저장소 밖 실제 조회.json>
```

`check`는 선택표와 생성 설정의 일치를 검사한다. `sync`는 선택표에서 native 설정을 생성하며 소유하지 않는 설정 의미를 보존한다. 개인 global/local 설정은 고치지 않는다. `assign`은 LLM을 실행하지 않고 검토할 인자를 출력한다.

`assign`을 사용하는 경우에는 그 도구가 요구하는 실제 조회 snapshot을 제공한다. client·version·context·observedAt·사용자 timeZone과 고정 모델 actualModel·지원 efforts를 넣는다. 당일 조회·계정/공급자/surface 일치 검사를 우회하기 위해 증거의 시각이나 지원 목록을 만들어 쓰지 않는다. 이 요건은 보조 도구의 입력 검증이며 프로젝트 전체에 새로운 의식을 강제하는 규칙이 아니다.

모델 선택표를 바꾸는 경우 관련 지원·실행 증거와 설정을 함께 갱신한다. 지원되지 않는 고정 모델을 다른 모델로 몰래 대체하지 않는다. 실행 smoke를 품질·비용 평가 완료로 승격하지 않는다.

## 기존 증거

[Template-11](../tickets/template-11-model-allowlist.md)과 [PR #84 완료 기록](https://github.com/kimyongin/agent-workspace-template/pull/84#issuecomment-5975318940)은 승인된 CLI 업데이트와 실제 실행·재개 결과를 보존한다. Codex 0.160.0의 명시 부모·child·동일 ID 재개와 Claude 2.1.289의 native 역할·child·동일 설정 재개를 확인한 기록이다. Codex custom selector, 다른 강도의 실행, backend effort·실청구액 등 미확인 항목을 설치 완료와 혼동하지 않는다. 과거 미지원 기록을 현재 모든 버전의 제한이라고 단정하지 않는다.

현재 installation smoke는 [#97](https://github.com/kimyongin/agent-workspace-template/issues/97)에 실제 버전·호출·정본 발견·제약을 기록한다.
