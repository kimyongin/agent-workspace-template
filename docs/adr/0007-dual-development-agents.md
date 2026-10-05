# ADR-0007: 개발 에이전트 Codex·Claude Code 공용 정본

- 상태: 대체됨([ADR-0011](0011-matt-skills-and-github-workflow.md)) (소급 기록)
- 날짜: 2026-10-01

## 배경

개발에 Codex와 Claude Code를 함께 사용한다. 두 에이전트는 지침 파일과 스킬을 찾는 위치가 다르다. 지침을 에이전트별로 복제하면 내용이 어긋난다.

## 결정

- 공통 지침의 정본은 `AGENTS.md`, 개발 스킬의 정본은 `.agents/skills/develop-agent-app/`이다.
- Claude Code에는 정본을 가리키는 연결 파일만 둔다. `CLAUDE.md`는 `@AGENTS.md`를 가져오고, `.claude/skills/develop-agent-app/SKILL.md`는 정본 스킬을 읽게 한다. 규칙을 복제하지 않는다.
- 공통 규칙에는 특정 에이전트 전용 도구나 문법을 쓰지 않는다. 텍스트 파일은 UTF-8(BOM 없음)·LF로 강제한다.

## 결과

- 한 곳만 고치면 두 에이전트에 반영된다. 정본 스킬의 name·description이 바뀌면 Claude 연결 파일도 함께 맞춰야 한다.
- Claude Code가 공용 경로를 직접 읽게 되면 연결 파일을 제거할 수 있다.

## 관련 문서

- [AGENTS.md](../../AGENTS.md), [개발과 검증 방법](../development/workflow.md)
