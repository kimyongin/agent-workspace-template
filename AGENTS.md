# 개발 에이전트 진입점

이 저장소의 설계·개발·리뷰·배포·운영 작업은 [develop-agent-app 스킬](.agents/skills/develop-agent-app/SKILL.md)의 요청별 절차를 따른다. 자동 스킬 검색을 지원하지 않는 에이전트도 이 파일에서 SKILL.md를 직접 읽을 수 있다. 스킬의 존재만으로 도구 접근이나 외부 변경 권한이 생기지는 않는다.

- 먼저 [START-HERE](docs/START-HERE.md)와 관련 기능 티켓을 읽고 실제 checkout·변경·환경을 확인한다. 문서의 제안과 구현 상태를 구분한다.
- PRD(`docs/product/`)와 ADR(`docs/adr/`)은 사람이 소유한다. 티켓·구현·리뷰·가이드·스킬은 에이전트가 소유한다. 작업이 PRD·ADR을 벗어나야 하면 멈추고 변경안으로 사람의 승인을 받는다([ADR-0008](docs/adr/0008-document-ownership.md)).
- 가이드·스킬은 PRD·ADR 안에서 도메인에 맞게 발전시킨다. 방법을 바꾸면 담당 가이드·스킬·관련 구현과 검증을 함께 갱신한다. 상세 절차는 [개발 방법](docs/development/workflow.md)을 따른다.
- `main`에 직접 푸시하지 않고 작은 PR로 올린다. 리뷰(구현한 세션과 분리된 새 세션 또는 다른 에이전트)와 자동 검사를 통과하고 PRD·ADR과 일치하면 에이전트가 머지한다([ADR-0009](docs/adr/0009-review-without-cross-agent.md)). 운영 배포·비용이 드는 작업은 사람이 지시한 범위에서만 한다.
- 설계 요청은 문서와 인계까지 수행한다. 앱 구현과 서비스 배포는 사용자가 요청한 범위에 맞춰 진행한다. 이미 승인한 행동을 반복 확인하지 않는다.
- UI 작업은 [디자인 가이드](docs/design/guide.md), 인증·데이터·외부 통신 변경은 [보안 가이드](docs/security/guide.md)를 먼저 읽는다.
- 실행 명령은 현재 코드·설정에서 확인한다. 필수 검증의 증거와 환경 제약은 해당 티켓에 남긴다. 운영 DB로 격리 테스트를 대신하지 않는다.
- 파일은 UTF-8 BOM 없음·LF를 유지하고, 사용하는 에이전트의 파일 편집 도구로 필요한 부분만 수정한다. 무관한 사용자 작업을 보존한다.

## 여러 개발 에이전트와 함께 쓰기

이 저장소는 Codex와 Claude Code를 함께 또는 하나만 사용할 수 있다. 이 파일과 `.agents/skills/develop-agent-app/`이 공통 정본이며, 특정 에이전트 전용 도구나 문법을 공통 규칙으로 쓰지 않는다.

| 에이전트 | 지침 진입 | 개발 스킬 발견 | 호출 |
| --- | --- | --- | --- |
| Codex | AGENTS.md | `.agents/skills/` 정본 (`agents/openai.yaml`은 Codex 표시 정보) | `$develop-agent-app` |
| Claude Code | CLAUDE.md → `@AGENTS.md` | `.claude/skills/develop-agent-app/`의 연결 파일 → 정본 | `/develop-agent-app` |

- 지침·스킬 변경은 정본에만 반영한다. 정본 스킬의 name·description을 바꾸면 Claude 연결 파일의 frontmatter도 함께 맞춘다.
- 두 에이전트가 같은 작업 트리를 동시에 수정하지 않는다. 동시 작업은 branch나 worktree를 나누고, 단계 인계는 해당 티켓의 상태·검증 기록으로 한다.
- 개인 권한·로컬 설정(`.claude/settings.local.json` 등)은 커밋하지 않는다.

개발 스킬은 `.agents/skills/`, 앱 사용자에게 배포하는 MCP·제품 스킬 통합 플러그인은 `plugins/`가 담당한다. 제품 플러그인은 Claude와 Codex를 모두 지원하며 클라이언트별 manifest가 같은 제품 스킬을 공유한다. 상세 기준은 스킬이 연결하는 정본 문서에서 관리하며 이 파일에 복제하지 않는다.
