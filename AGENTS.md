# 프로젝트 문맥

개발 방법은 `.agents/skills/`의 [Matt Pocock 원본 스킬](docs/development/matt-skills.md)을 따른다. Codex는 이 정본을, Claude Code는 `.claude/skills/` 연결 파일을 읽는다. 원문의 Skill tool·호출 표기는 사용하는 클라이언트의 호출 또는 정본 파일 읽기로 대응한다.

- 프로젝트 문서는 [START-HERE](docs/START-HERE.md), 작업은 [GitHub Issues](docs/agents/issue-tracker.md), 도메인은 [domain](docs/agents/domain.md), triage 설정은 [labels](docs/agents/triage-labels.md)에서 찾는다. 문서의 결정과 실제 checkout·변경 상태를 구분한다.
- 구현 요청은 [작업 규모 기준](docs/agents/issue-tracker.md#작업-규모와-계획-진입)에 따라 큰 작업의 스펙·티켓을 먼저 갖춘다. 국소 수정은 바로 진행하고, 범위가 커지면 확장 전에 기준을 다시 적용한다.
- UI 변경은 [디자인](docs/design/guide.md), 인증·데이터·외부 통신 변경은 [보안](docs/security/guide.md), 로컬 서비스·통합 검사는 [실행 환경](docs/development/verification.md)을 읽는다. 명령은 `package.json`과 CI에서 확인한다.
- 스펙 또는 단독 PR 완료 전에는 전체 통합 변경을 기준으로 [로컬 E2E 실행 기준](docs/development/verification.md#로컬-e2e-실행-기준)을 검토하고, 판단과 실행 증거를 해당 이슈에 남긴다.
- 제품 결정의 소유권·대화 합의·PR 머지 권한·운영 실행 범위는 [ADR-0008](docs/adr/0008-document-ownership.md)과 [ADR-0011](docs/adr/0011-matt-skills-and-github-workflow.md)이 정한다.
- API·MCP·저장 계약을 바꿀 때는 [구 계약 정리 기준](docs/architecture/principles.md#9-실제-사용처를-기준으로-구-계약을-정리한다)에 따라 앱의 호출자를 함께 전환하고 미사용 인터페이스를 제거한다.
- 사용자가 정한 모델은 [Codex 설정](.codex/config.toml)과 [Claude 설정](.claude/settings.json)에 있다. 실행 인자에도 같은 모델을 사용한다.
- UTF-8 BOM 없음·LF를 유지하며 사용자 변경·개인 설정·비밀값을 보존한다.

앱 사용자용 MCP·제품 스킬 패키지는 `plugins/`가 담당한다.
