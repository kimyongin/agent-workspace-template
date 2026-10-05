# agent-workspace-template

사람과 외부 에이전트가 같은 업무를 수행하고, 쌓인 기록을 다음 판단에 활용하는 도메인 앱 템플릿입니다. 저장소를 복제하고 도메인 엔터티·화면·제품 스킬을 조정해 새 앱을 시작합니다.

기본 기술 구성은 **GitHub Pages 웹 · Supabase 서버/DB · Google OAuth · Pinecone 임베딩 · pgvector 검색**입니다. 웹은 HTTP API를, 에이전트는 MCP와 제품 스킬을 사용합니다. 업무 규칙은 core에 두고 외부 기술은 포트와 어댑터로 연결합니다.

처음이라면 [프로젝트 지도](docs/overview.html)에서 앱 구조와 개발 스킬의 입력·저장 위치·다음 단계의 관계를 살펴보세요. 제품·아키텍처·디자인·보안·배포 문서는 [START-HERE](docs/START-HERE.md), 용어는 [GLOSSARY.md](GLOSSARY.md)에서 찾습니다.

개발 방법은 저장소의 [Matt Pocock 원본 27개 스킬](docs/development/matt-skills.md)을 따릅니다. Codex와 Claude Code가 같은 정본을 사용합니다. 명세·티켓·진행 상태·검증 증거는 [GitHub Issues](https://github.com/kimyongin/agent-workspace-template/issues)와 PR에서 관리합니다.

로컬 명령은 [package.json](package.json), 환경 제약은 [실행 환경](docs/development/verification.md)에 있습니다. 앱 사용자용 [제품 플러그인](plugins/workspace/README.md)은 개발 스킬과 별도로 배포합니다.
