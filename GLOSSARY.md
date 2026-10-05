# 용어집

이 저장소의 문서에 나오는 용어를 개발 지식 없이 이해할 수 있게 풀어 쓴다. 정확한 규칙은 각 용어의 "정본" 문서가 소유하며 이 문서는 뜻만 설명한다. 문서에 새 용어를 쓰면 여기에도 추가한다.

## 일하는 방식

| 용어 | 쉬운 설명 | 정본 |
| --- | --- | --- |
| PRD (제품 요구사항 문서) | 무엇을, 누구를 위해, 왜 만드는지 적은 기획서. 꼭 있어야 하는 기능도 여기서 정한다. 사람이 정하고 승인한다. 비유하면 집을 짓기 전 "방 3개, 남향"이라고 적은 요청서다. | [PRD](docs/product/concept.md) |
| ADR (아키텍처 결정 기록) | 나중에 바꾸기 어렵고 비용이 큰 결정(어떤 서비스를 쓸지, 데이터를 어떻게 보호할지 등)과 그 이유를 남긴 메모. 사람이 승인한다. | [ADR 목록](docs/adr/README.md) |
| 가이드 | PRD·ADR 안에서 일하는 구체적인 방법을 정리한 문서(디자인·보안·개발·배포·운영 등). 에이전트가 일하면서 고쳐 나간다. | [ADR-0008](docs/adr/0008-document-ownership.md) |
| 티켓 | 해야 할 작업 하나를 적은 작업 지시서. GitHub issue에 목표, 다 됐는지 확인하는 방법과 진행 기록을 남긴다. | [작업 추적](docs/agents/issue-tracker.md) |
| 정본 | 같은 내용이 여러 문서에 있을 때 기준이 되는 원래 문서. 다른 문서는 정본을 링크한다. | [START-HERE](docs/START-HERE.md#읽는-순서와-문서의-책임) |
| 개발 에이전트 | 코드와 문서를 작성하는 AI(Codex, Claude Code). 사람이 말로 지시하면 계획·구현·검증까지 한다. | [에이전트와 일하는 방법](docs/development/working-with-agents.md) |
| 세션 | 에이전트와 나누는 대화 한 묶음. "새 세션"은 앞의 대화 내용을 모르는 새 대화를 뜻한다. | [에이전트와 일하는 방법](docs/development/working-with-agents.md) |

## 코드를 바꾸고 내보내는 과정

| 용어 | 쉬운 설명 | 정본 |
| --- | --- | --- |
| 브랜치 | 원본(`main`)을 건드리지 않고 따로 작업하는 사본. 작업이 끝나면 PR로 원본에 합칠지 검토받는다. | [개발과 검증 방법](docs/development/workflow.md#브랜치와-pr) |
| 커밋 | 바뀐 내용을 저장한 한 번의 기록. 무엇을 왜 바꿨는지 메시지를 함께 남긴다. | [개발과 검증 방법](docs/development/workflow.md#브랜치와-pr) |
| 푸시 | 내 컴퓨터의 커밋을 GitHub 저장소에 올리는 것. 에이전트가 PR을 만들 때 함께 한다. | [에이전트와 일하는 방법](docs/development/working-with-agents.md) |
| PR (Pull Request) | "이렇게 고쳤으니 검토하고 반영해 주세요"라는 변경 요청. 무엇을 어떻게 바꿨는지 한 묶음으로 보여 준다. 검토하기 쉽도록 작게 나눠 올린다. | [개발과 검증 방법](docs/development/workflow.md#브랜치와-pr) |
| 리뷰 | 구현 대화의 맥락이 없는 새 서브 에이전트(또는 새 세션)가 정확한 base/head의 변경을 검토하는 것. 보통 로컬 커밋을 먼저 검토하고 같은 head를 PR로 제출한다. 결론과 교차 리뷰 기준은 정본을 따른다. | [개발과 검증 방법](docs/development/workflow.md#리뷰) |
| 머지 | 리뷰와 자동 검사를 통과한 PR을 원본(`main`)에 합치는 것. 머지했다고 실제 서비스에 바로 반영되지는 않는다. | [개발과 검증 방법](docs/development/workflow.md#머지) |
| 자동 검사 (CI) | 변경을 올릴 때마다 정해진 검사를 자동으로 실행하는 장치. `main`은 CI 통과를 머지 필수 조건(필수 상태 검사)으로 걸어 두어, 검사가 실패하거나 실행되지 않은 PR은 머지할 수 없다. | [개발과 검증 방법](docs/development/verification.md) |
| revision | 저장소의 특정 시점 상태. 커밋 하나를 가리키는 짧은 식별자(예: `a5b8214`)로 쓴다. "검증한 revision"은 검사를 통과한 그 시점의 버전이다. | [배포 방법](docs/deployment/release.md) |
| 배포 | 머지된 변경을 실제 사용자가 쓰는 서비스에 올리는 것. 사람이 "배포해"라고 지시할 때만 한다. | [배포 방법](docs/deployment/release.md) |
| 운영 | 실제 사용자가 쓰고 있는 서비스와 그 데이터. 시험용 환경과 구분하며, 운영 데이터로 시험하지 않는다. | [운영 방법](docs/operations/runbook.md) |

## 앱의 구성

| 용어 | 쉬운 설명 | 정본 |
| --- | --- | --- |
| 업무 대상 (`Entity`) | 앱마다 바꾸는 "다루는 대상"의 자리. 템플릿에는 이름만 정해 둔 예제(`Entity`)가 있고, 고객 관리 앱이면 "고객", 독서 기록 앱이면 "책"으로 바꾼다. | [PRD](docs/product/concept.md#기본-예제-엔터티) |
| 사용자 원칙 | 앱 사용자가 저장해 두는 판단 기준 데이터. 에이전트가 판단하기 전에 먼저 확인한다. 개발용 코드 설계 원칙과는 다르다. | [PRD](docs/product/concept.md#필수-기본-기능) |
| 기록 | 업무 자료·수행 결과와 모든 도메인의 변경 메모를 통합한 지식 자료. 일반 내용과 로그 메모는 편집 가능하며 기록 자체의 편집 로그는 남기지 않는다. | [PRD](docs/product/concept.md#최신-상태와-통합-기록) |
| 참고 기록 | 할 일을 준비하거나 판단할 때 인용·링크로 참고하는 기록. 참고만으로 수행이나 완료를 뜻하지 않는다. | [PRD](docs/product/concept.md#최신-상태와-통합-기록) |
| 결과 기록 | 할 일을 실제로 수행한 내용과 결과를 남긴 기록. 반복 할 일에서는 수행한 회차와 구분해서 연결한다. | [PRD](docs/product/concept.md#일회성-할-일과-반복-할-일) |
| 활동 | 앱의 업무 사건을 통합 기록에서 보는 관점. 화면 이름은 기록으로 통일하고 별도 활동 객체·탭을 두지 않는다. | [PRD](docs/product/concept.md#네-탭과-기록-화면) |
| MCP | AI 에이전트가 외부 앱의 기능(조회·저장)을 도구처럼 쓰게 해 주는 연결 방식. | [아키텍처](docs/architecture/hexagonal-review.md#에이전트-연결-계약) |
| 플러그인 | AI 에이전트(Claude·Codex)에 설치하는 확장 기능. 앱을 다루는 MCP 연결과 제품 스킬이 함께 들어 있다. | [ADR-0005](docs/adr/0005-plugin-delivery-claude-codex.md) |
| 제품 스킬 | 앱을 쓰는 AI 에이전트에게 "자료를 어떻게 찾고 결과를 어떻게 기록할지" 알려 주는 사용 요령. 플러그인에 포함된다. | [제품 스킬](plugins/workspace/skills/workspace/SKILL.md) |
| 개발 스킬 | 개발 에이전트에게 설계·구현·리뷰 등의 작업 방법을 알려 주는 Matt Pocock 스킬 묶음. | [개발 스킬](docs/development/matt-skills.md) |
| 헥사고날 구조 | 업무 규칙을 가운데(core)에 모아 두고, 웹·에이전트·데이터베이스 같은 바깥 부품을 그 주위에 연결하는 설계 방식. 입구가 여러 개여도 규칙은 한 곳에만 있다. | [ADR-0001](docs/adr/0001-hexagonal-shared-usecases.md) |
| 도메인 | 업무의 규칙과 의미. 예: "이 할 일을 지금 완료할 수 있는가?"를 판단하는 부분. | [코드 설계 원칙](docs/architecture/principles.md) |
| 유스케이스 | 업무 하나를 처리하는 순서. 필요한 데이터를 읽고, 도메인 규칙으로 판단하고, 결과를 저장한다. 웹과 MCP가 같은 유스케이스를 쓴다. | [코드 설계 원칙](docs/architecture/principles.md) |
| 포트와 어댑터 | 포트는 핵심 코드가 바깥에 요구하는 연결 규격, 어댑터는 그 규격에 맞춰 실제 서비스(데이터베이스, 외부 API)를 잇는 부품이다. 부품을 바꿔도 핵심 규칙은 그대로다. | [아키텍처](docs/architecture/hexagonal-review.md#호출과-의존성) |
| 트랜잭션 | 함께 성공해야 하는 저장을 한 번에 처리하는 것. 하나라도 실패하면 전부 취소되어 반쪽만 저장되는 일을 막는다. | [ADR-0003](docs/adr/0003-core-rules-and-local-transactions.md) |
| 큐 | 오래 걸리는 일을 줄 세워 두고 따로 처리하는 대기열. 예: 새 기록을 검색용으로 정리하는 일. 저장은 바로 끝나고 검색 반영은 조금 늦을 수 있다. | [아키텍처](docs/architecture/hexagonal-review.md#큐-기반-비동기-작업) |
| 임베딩 | 글의 의미를 숫자 목록(벡터)으로 바꾸는 것. 뜻이 비슷한 글을 찾는 의미 검색에 쓴다. 이 앱은 기록의 제목과 요약만 임베딩한다. | [요약 기반 검색](docs/architecture/search.md) |
| RAG | 일할 때 쌓인 자료를 검색해서 읽고 그 내용을 근거로 판단하는 방식. AI 모델을 다시 학습시키지 않는다. | [아키텍처](docs/architecture/hexagonal-review.md#rag) |
| RLS | 데이터베이스가 행마다 "누가 볼 수 있는지"를 직접 검사하는 기능. 내 데이터는 나만 보게 하는 장치 중 하나다. | [보안 가이드](docs/security/guide.md#권한db-접근) |
| OAuth | 비밀번호를 넘기지 않고 다른 서비스에 권한을 맡기는 로그인 방식. 웹은 Google 계정으로 로그인하고, 에이전트는 별도의 OAuth로 앱에 연결한다. | [ADR-0006](docs/adr/0006-owner-only-access-and-separate-auth.md) |
| Supabase | 이 템플릿이 쓰는 서버·데이터베이스·로그인 서비스. | [ADR-0002](docs/adr/0002-default-tech-stack.md) |
| Pinecone | 이 템플릿이 임베딩을 만드는 데 쓰는 외부 서비스. 만든 숫자는 Supabase에 저장한다. | [ADR-0002](docs/adr/0002-default-tech-stack.md) |
