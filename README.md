# agent-workspace-template

기본 기술 구성은 **GitHub Pages 웹 배포 · Supabase 서버/DB · Google OAuth 로그인 · Pinecone 임베딩 생성 · pgvector 벡터 저장/검색**입니다.

사람과 외부 에이전트가 같은 업무를 수행하고, 쌓인 기록을 다음 판단에 활용하는 도메인 앱 템플릿입니다.

이 템플릿은 저장소를 복제하고 도메인 엔터티·화면·제품 스킬을 조정해 새 앱을 시작하는 구현형 템플릿입니다. 도메인의 요구와 구현 경험에 따라 코드뿐 아니라 원칙·가이드·에이전트 스킬도 함께 발전시킵니다. 변경이 기존 기준과 충돌하면 제한된 예외인지 기준 자체를 바꿀 사안인지 판단하고, 해당 문서와 관련 구현을 함께 갱신합니다.

사람에게는 HTTP API를 사용하는 웹 앱을, 에이전트에게는 MCP 연결과 제품 스킬을 함께 패키징한 플러그인을 제공합니다. MCP는 업무 기능을 실행하고 스킬은 관련 자료를 찾고 작업하는 방법을 안내합니다. 도메인과 유스케이스에 업무 로직을 두고, HTTP·MCP·Supabase·외부 서비스를 포트와 어댑터로 연결합니다.

로컬 실행 명령은 [개발과 검증 방법의 실행 검증](docs/development/workflow.md#실행-검증)에 있습니다. 구현 진행 상태는 [문서 시작점의 현재 상태](docs/START-HERE.md#현재-상태)에서 확인합니다. 문서 시작점에서 제품 컨셉·코드 설계·구현 인계를 읽고, [배포 방법](docs/deployment/release.md)과 [운영 방법](docs/operations/runbook.md)까지 확인할 수 있습니다.

웹 화면은 [디자인 가이드](docs/design/guide.md)의 공통 시각 규격과 상호작용을 따릅니다. 초기 스타일 기본값은 브랜드에 맞게 공통 토큰에서 조정할 수 있습니다.

인증·사용자 격리·MCP/RAG·외부 통신은 [보안 가이드](docs/security/guide.md)의 경계와 검증 기준을 따릅니다.

**처음이라면 [프로젝트 지도](docs/overview.html)로 전체 그림을 본 뒤 [에이전트와 일하는 방법](docs/development/working-with-agents.md)을 읽으세요.** 모르는 용어는 [용어집](docs/glossary.md)에 있습니다. 사람은 PRD(제품 요구사항)와 ADR(아키텍처 결정)을 정하고, 티켓·구현·리뷰는 에이전트가 맡습니다.

개발 에이전트에게는 [develop-agent-app](.agents/skills/develop-agent-app/SKILL.md) 스킬로 설계·개발·리뷰·배포·운영을 위임할 수 있습니다. Codex(AGENTS.md, `$develop-agent-app`)와 Claude Code(CLAUDE.md, `/develop-agent-app`)가 같은 지침과 스킬을 사용하며, 둘 중 하나만 써도 됩니다. [사용 방법](docs/development/workflow.md)을 참고하세요. 이 스킬과 AGENTS.md는 저장소와 함께 전달됩니다.

제품 플러그인은 Claude와 Codex를 모두 지원하며, 클라이언트별 manifest가 같은 제품 스킬과 MCP 서버를 사용합니다.
