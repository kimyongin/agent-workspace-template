# 템플릿 문서 시작점

사람은 웹 앱으로, 에이전트는 MCP·제품 스킬 플러그인으로 같은 업무 기능과 데이터를 사용한다. 전체 그림과 스킬 결과의 흐름은 [프로젝트 지도](overview.html), 용어는 [GLOSSARY.md](../GLOSSARY.md)에서 확인한다.

개발 방법의 정본은 [.agents/skills/](development/matt-skills.md)다. 작업 명세·티켓·진행 상태·실행 증거는 [GitHub Issues](agents/issue-tracker.md)와 연결된 PR·checks에서 관리한다. 문서에 실행 로그나 완료 목록을 누적하지 않는다.

| 문맥 | 정본 |
| --- | --- |
| 제품 목표와 요구 | [PRD](product/concept.md) |
| 구조·기술·권한 결정 | [ADR](adr/README.md) |
| 도메인 용어와 탐색 | [용어집](../GLOSSARY.md) · [domain](agents/domain.md) |
| 코드의 판단 기준 | [설계 원칙](architecture/principles.md) · [헥사고날 구조](architecture/hexagonal-review.md) |
| 책임과 파일 배치 | [폴더 구조](design/template-structure.md) |
| 화면 규격과 상호작용 | [디자인](design/guide.md) |
| 인증·데이터·외부 통신 | [보안](security/guide.md) |
| 검색·색인 계약 | [검색](architecture/search.md) |
| 로컬 실행·환경 제약 | [실행 환경](development/verification.md) · [package.json](../package.json) · [CI](../.github/workflows/ci.yml) |
| 제품 플러그인 | [패키징과 클라이언트 연결](../plugins/workspace/README.md) |
| 설치·배포·복구 | [배포](deployment/release.md) |
| 점검·장애·데이터 복원 | [운영](operations/runbook.md) |
| 개발 스킬 설치 정보 | [27개 원본 스킬](development/matt-skills.md) |

PRD·ADR의 결정은 사람이 소유한다. 구체적인 대화 합의는 해당 문서에 반영한다([ADR-0008](adr/0008-document-ownership.md)). 가이드는 제품·환경의 기준을, 원본 스킬은 작업 방법을 소유한다. 실제 구현은 현재 checkout과 소스에서 확인한다.

현재 진행 작업은 GitHub에서 확인한다. [제품 목표·도메인 전환 #120](https://github.com/kimyongin/agent-workspace-template/issues/120)의 합의와 구현·머지 상태를 구분하며, 보류한 결정은 해당 이슈에서 유지한다. 과거 실행 근거는 Git 이력과 GitHub의 이슈·PR에서 확인한다.
