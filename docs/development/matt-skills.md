# Matt Pocock 개발 스킬

개발 방법은 [공식 스킬](https://github.com/mattpocock/skills)의 원문을 따른다. 프로젝트별 경로·도구·제품 계약은 연결 문서에서 제공한다. 기존 `develop-agent-app`은 이 묶음으로 대체했다([ADR-0011](../adr/0011-matt-skills-and-github-workflow.md), [전환 spec #96](https://github.com/kimyongin/agent-workspace-template/issues/96)).

## 설치와 정본

- 공식 플러그인 1.3.1의 전체 27개 스킬을 저장소에 포함했다. 정본은 `.agents/skills/<name>/`이며 참고 자료와 원본 `agents/openai.yaml`도 함께 보존한다.
- Claude Code는 `CLAUDE.md → AGENTS.md`와 `.claude/skills/<name>/SKILL.md`의 연결 파일로 같은 정본을 읽는다. 연결 파일은 원본 frontmatter와 호출 제한을 보존한다.
- 고정 revision은 `24fe0ef7737efae15c87225755e9f6f5965e4888`이다. [출처 기록](matt-skills-source.json)과 [MIT 라이선스](matt-skills-LICENSE)를 보관한다. 전역 플러그인 설치가 필요하지 않다.
- 스킬 원문은 수정하지 않았다. 설치 위치와 Claude 연결만 프로젝트에 맞췄다. 원본 절차를 바꾸기 전 실제 작업에서 발생한 문제를 issue에 기록한다.

## 호출과 사용

Codex는 `$스킬이름`, Claude Code는 `/스킬이름`으로 호출한다. 원문에 나오는 slash 표기는 사용하는 클라이언트의 호출 방식으로 읽는다. 명시 호출이 필요한 스킬의 호출 정책을 연결 파일에서 풀지 않는다. 새 checkout이나 설치·갱신 뒤에는 새 세션에서 발견과 연결을 확인한다.

무엇을 사용할지 모르겠으면 `ask-matt`으로 시작한다. 한 작업은 `implement`, 여러 issue를 조율하는 spec은 `implement-spec`을 사용할 수 있다. 모든 요청에 스킬 전체를 순서대로 실행할 필요는 없다.

| 공식 스킬 | 정본 |
| --- | --- |
| `ask-matt` | [SKILL.md](../../.agents/skills/ask-matt/SKILL.md) |
| `diagnosing-bugs` | [SKILL.md](../../.agents/skills/diagnosing-bugs/SKILL.md) |
| `grill-with-docs` | [SKILL.md](../../.agents/skills/grill-with-docs/SKILL.md) |
| `triage` | [SKILL.md](../../.agents/skills/triage/SKILL.md) |
| `improve-codebase-architecture` | [SKILL.md](../../.agents/skills/improve-codebase-architecture/SKILL.md) |
| `setup-matt-pocock-skills` | [SKILL.md](../../.agents/skills/setup-matt-pocock-skills/SKILL.md) |
| `tdd` | [SKILL.md](../../.agents/skills/tdd/SKILL.md) |
| `to-spec` | [SKILL.md](../../.agents/skills/to-spec/SKILL.md) |
| `to-tickets` | [SKILL.md](../../.agents/skills/to-tickets/SKILL.md) |
| `wayfinder` | [SKILL.md](../../.agents/skills/wayfinder/SKILL.md) |
| `implement` | [SKILL.md](../../.agents/skills/implement/SKILL.md) |
| `implement-spec` | [SKILL.md](../../.agents/skills/implement-spec/SKILL.md) |
| `prototype` | [SKILL.md](../../.agents/skills/prototype/SKILL.md) |
| `research` | [SKILL.md](../../.agents/skills/research/SKILL.md) |
| `domain-modeling` | [SKILL.md](../../.agents/skills/domain-modeling/SKILL.md) |
| `codebase-design` | [SKILL.md](../../.agents/skills/codebase-design/SKILL.md) |
| `code-review` | [SKILL.md](../../.agents/skills/code-review/SKILL.md) |
| `pr` | [SKILL.md](../../.agents/skills/pr/SKILL.md) |
| `retro` | [SKILL.md](../../.agents/skills/retro/SKILL.md) |
| `wizard` | [SKILL.md](../../.agents/skills/wizard/SKILL.md) |
| `grill-me` | [SKILL.md](../../.agents/skills/grill-me/SKILL.md) |
| `grilling` | [SKILL.md](../../.agents/skills/grilling/SKILL.md) |
| `handoff` | [SKILL.md](../../.agents/skills/handoff/SKILL.md) |
| `teach` | [SKILL.md](../../.agents/skills/teach/SKILL.md) |
| `to-questionnaire` | [SKILL.md](../../.agents/skills/to-questionnaire/SKILL.md) |
| `wait-what` | [SKILL.md](../../.agents/skills/wait-what/SKILL.md) |
| `writing-for-agents` | [SKILL.md](../../.agents/skills/writing-for-agents/SKILL.md) |

## 프로젝트 연결

`setup-matt-pocock-skills`가 요구하는 설정은 이미 다음 문서에 있다. 새 앱으로 복제한 경우 저장소 remote와 제품 계약에 맞춰 이 설정을 갱신한다.

- [작업 추적](../agents/issue-tracker.md): GitHub Issues, PR 요청 내용과 댓글, 부모·하위 issue와 의존 관계.
- [triage 라벨](../agents/triage-labels.md): 실행 가능한 작업과 추가 정보·사람 결정이 필요한 작업.
- [도메인 안내](../agents/domain.md): [루트 용어집](../../GLOSSARY.md), PRD·ADR·코드 기준.
- [프로젝트 개발 연결](workflow.md): 정본 경로, 리뷰·머지와 승인 범위.
- [검증과 환경](verification.md): 현재 코드의 명령, CI, 통합 환경과 실제 증거.
- [모델 실행](agent-model-execution.md): 고정 모델 정책과 선택적 실행 보조 도구.

스킬 설치는 도구 접근·외부 변경 권한을 부여하지 않는다. 대화에서 합의한 제품·아키텍처 결정은 문서로 반영하고, 합의 범위를 새로 벗어날 때 사람에게 변경안을 제시한다.

## 갱신

공식 manifest의 버전·revision·스킬 목록·추가 자료와 호출 정책을 확인하고 원본을 함께 갱신한다. 출처 JSON·라이선스·Claude 연결도 맞춘다. 프로젝트 연결 문서는 원문과 분리해 유지하고 `npm run check:docs`로 연결·설정·스크립트 검사를 수행한다. 원본 변경 때문에 실제 작업 방식이 달라지는 경우 관련 issue와 검증 근거를 남긴다. 별도의 자동 업데이트 서비스는 운영하지 않는다.
