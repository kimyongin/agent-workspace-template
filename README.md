# agent-workspace-template

사람과 외부 에이전트가 같은 업무를 수행하고, 쌓인 기록을 다음 판단에 활용하는 도메인 앱 템플릿입니다.

사람은 웹으로, 에이전트는 MCP로 연결합니다. 도메인과 유스케이스에 업무 로직을 두고, HTTP·MCP·Supabase·외부 서비스를 포트와 어댑터로 연결합니다.

현재는 설계 단계이며 실행 코드는 아직 없습니다. [문서 시작점](docs/START-HERE.md)에서 제품 컨셉·코드 설계·구현 인계를 읽고, [배포 방법](docs/deployment/release.md)과 [운영 방법](docs/operations/runbook.md)까지 확인할 수 있습니다. 실행 명령과 자동화는 구현·검증 후 추가합니다.

웹 화면은 [디자인 가이드](docs/design/guide.md)의 공통 시각 규격과 상호작용을 따릅니다. 초기 스타일 기본값은 브랜드에 맞게 공통 토큰에서 조정할 수 있습니다.

인증·사용자 격리·MCP/RAG·외부 통신은 [보안 가이드](docs/security/guide.md)의 경계와 검증 기준을 따릅니다.
