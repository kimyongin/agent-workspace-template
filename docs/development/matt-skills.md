# Matt Pocock 개발 스킬

[공식 저장소](https://github.com/mattpocock/skills)의 플러그인 1.3.1 전체 27개 스킬을 포함한다. 개발 방법과 스킬 사이의 호출 관계는 각 원문이 소유한다. 사람이 요청하는 예시와 결과의 저장 흐름은 [프로젝트 지도 02](../overview.html#skill-invocation)에서 볼 수 있다.

## 설치 정보

정본은 `.agents/skills/<name>/`이며 원문·참고 자료·`agents/openai.yaml`을 함께 보존한다. Claude Code의 `.claude/skills/<name>/SKILL.md` 연결 파일은 같은 정본을 읽으며 원본 frontmatter를 유지한다. `CLAUDE.md`는 `AGENTS.md`를 가져온다.

고정 revision은 `24fe0ef7737efae15c87225755e9f6f5965e4888`이다. 경로 이동을 제외한 내용은 원본과 같다. [출처 기록](matt-skills-source.json)과 [MIT 라이선스](matt-skills-LICENSE)를 보관한다.

## 호출 목록

Codex는 `$이름`, Claude Code는 `/이름`으로 요청한다. 아래 구분은 원본 frontmatter의 `disable-model-invocation`을 나타낸다. 자동 선택 가능은 항상 실행된다는 뜻이 아니다. 특정 작업의 내부 호출과 실행 조건은 해당 스킬 원문에서 확인한다.

| 스킬 원문 | 호출 정책 |
| --- | --- |
| [ask-matt](../../.agents/skills/ask-matt/SKILL.md) | 명시 호출 |
| [grill-me](../../.agents/skills/grill-me/SKILL.md) | 명시 호출 |
| [grill-with-docs](../../.agents/skills/grill-with-docs/SKILL.md) | 명시 호출 |
| [handoff](../../.agents/skills/handoff/SKILL.md) | 명시 호출 |
| [implement](../../.agents/skills/implement/SKILL.md) | 명시 호출 |
| [implement-spec](../../.agents/skills/implement-spec/SKILL.md) | 명시 호출 |
| [improve-codebase-architecture](../../.agents/skills/improve-codebase-architecture/SKILL.md) | 명시 호출 |
| [retro](../../.agents/skills/retro/SKILL.md) | 명시 호출 |
| [setup-matt-pocock-skills](../../.agents/skills/setup-matt-pocock-skills/SKILL.md) | 명시 호출 |
| [teach](../../.agents/skills/teach/SKILL.md) | 명시 호출 |
| [to-questionnaire](../../.agents/skills/to-questionnaire/SKILL.md) | 명시 호출 |
| [to-spec](../../.agents/skills/to-spec/SKILL.md) | 명시 호출 |
| [to-tickets](../../.agents/skills/to-tickets/SKILL.md) | 명시 호출 |
| [triage](../../.agents/skills/triage/SKILL.md) | 명시 호출 |
| [wait-what](../../.agents/skills/wait-what/SKILL.md) | 명시 호출 |
| [wayfinder](../../.agents/skills/wayfinder/SKILL.md) | 명시 호출 |
| [code-review](../../.agents/skills/code-review/SKILL.md) | 자동 선택 가능 |
| [codebase-design](../../.agents/skills/codebase-design/SKILL.md) | 자동 선택 가능 |
| [diagnosing-bugs](../../.agents/skills/diagnosing-bugs/SKILL.md) | 자동 선택 가능 |
| [domain-modeling](../../.agents/skills/domain-modeling/SKILL.md) | 자동 선택 가능 |
| [grilling](../../.agents/skills/grilling/SKILL.md) | 자동 선택 가능 |
| [pr](../../.agents/skills/pr/SKILL.md) | 자동 선택 가능 |
| [prototype](../../.agents/skills/prototype/SKILL.md) | 자동 선택 가능 |
| [research](../../.agents/skills/research/SKILL.md) | 자동 선택 가능 |
| [tdd](../../.agents/skills/tdd/SKILL.md) | 자동 선택 가능 |
| [wizard](../../.agents/skills/wizard/SKILL.md) | 자동 선택 가능 |
| [writing-for-agents](../../.agents/skills/writing-for-agents/SKILL.md) | 자동 선택 가능 |

## 프로젝트 설정

원본 setup 스킬의 프로젝트 설정은 [GitHub 작업 위치](../agents/issue-tracker.md), [triage 라벨](../agents/triage-labels.md), [도메인 문서](../agents/domain.md)에 있다. 새 도메인 앱에서는 실제 remote와 제품 문맥에 맞춰 갱신한다.

원본을 갱신할 때 출처 revision·라이선스·참고 자료·호출 정책과 Claude 연결도 함께 맞춘다. 연결과 텍스트 검사는 `package.json`의 `check:docs`로 확인한다.
