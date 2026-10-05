# 프로젝트 개발 문맥

개발 방법의 정본은 레포에 포함한 [Matt Pocock 스킬](docs/development/matt-skills.md)이다. 공식 원본의 적용 조건·호출 정책·작업 방법을 따른다. [ADR-0011](docs/adr/0011-matt-skills-and-github-workflow.md)에 따라 기존 develop-agent-app 절차를 대체했다.

- 먼저 [START-HERE](docs/START-HERE.md), 해당 GitHub issue/spec와 실제 checkout·branch·변경을 확인한다.
- 작업 정본·도메인 문맥·triage 설정은 [issue tracker](docs/agents/issue-tracker.md), [domain](docs/agents/domain.md), [labels](docs/agents/triage-labels.md)에 있다. 사용 가능한 도구를 확인하고 원본의 Skill tool·호출 표기는 실제 클라이언트 호출이나 정본 파일 읽기로 대응한다.
- [PRD](docs/product/concept.md)·[ADR](docs/adr/README.md)의 결정은 사람이 소유한다. 구체적으로 합의한 결정은 문서에 반영하고, 미정 결정과 승인 범위 밖 실행은 확인한다. 합의한 승인을 반복 요청하지 않는다.
- UI는 [디자인](docs/design/guide.md), 인증·데이터·외부 통신은 [보안](docs/security/guide.md)을 읽는다. 나머지 필요한 프로젝트 문서는 [개발 문맥](docs/development/workflow.md)에서 찾는다.
- 실행 명령은 코드·설정·CI에서 확인한다. 사용자 모델 선택은 [선택표](docs/development/agent-models.json)를 따른다. 스킬 설치는 도구 접근·운영 실행 권한을 부여하지 않는다.
- 원본 implement/implement-spec/code-review/pr 방법으로 작업한다. `main` 직접 푸시 없이 PR을 사용하며 실제 변경의 분리된 리뷰와 필수 CI를 확인한다. 운영 배포·비용이 드는 작업은 사용자 지시 범위에서 수행한다.
- 동시 구현은 별도 worktree/branch와 소유 범위를 사용한다. 작업 공간과 DB·포트·테스트 자료의 격리는 따로 확인한다([검증 환경](docs/development/verification.md#공유-환경과-테스트-자료)).
- UTF-8 BOM 없음·LF를 유지하고 필요한 부분만 편집하며 사용자 변경·개인 설정·비밀값을 보존한다.

## 공유 스킬

Codex는 `.agents/skills/` 정본, Claude Code는 `.claude/skills/` 연결 파일을 사용한다. 공통 스킬은 정본에서 수정한다. 제품 사용자용 MCP·제품 스킬 통합 플러그인은 `plugins/`에 있으며 개발 스킬을 제품 패키지에 넣지 않는다.
