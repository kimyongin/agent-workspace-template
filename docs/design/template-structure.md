# 도메인 앱 템플릿 폴더 구조

## 목적과 기준

이 문서는 파일의 위치, 모듈 이름과 새 도메인의 추가 위치를 정의한다. 제품 의미는 [제품 컨셉](../product/concept.md), 코드 판단 기준은 [설계 원칙](../architecture/principles.md), 실행 책임은 [아키텍처](../architecture/hexagonal-review.md)를 따른다.

트리는 배치 제안이며 빈 디렉토리를 모두 미리 만드는 지시가 아니다. 기능별 구현 범위와 검증 조건은 해당 GitHub issue/spec에서 관리한다.

단일 저장소와 단일 웹 앱, 하나의 서버 코드 기반으로 시작한다. api, mcp와 비동기 worker는 같은 서버 코드를 조립하는 배포 진입점이다. 아래 search-index는 첫 worker의 예시다. 공통 및 앱별 업무 기능은 실제 이름으로 같은 위치에 추가한다.

## 제안 구조

```text
agent-workspace-template/
├─ README.md
├─ AGENTS.md                       # 개발 에이전트 작업 규칙(공통 정본)
├─ CLAUDE.md                       # Claude Code 진입점, AGENTS.md를 가져옴
├─ .gitattributes · .editorconfig  # UTF-8·LF 강제
├─ GLOSSARY.md                     # 도메인 용어 정본
├─ .agents/skills/<skill>/          # Matt Pocock 공식 27개 공유 정본
│  ├─ SKILL.md                     # 원본 작업 방법과 호출 정책
│  ├─ agents/openai.yaml           # 원본 Codex 표시·호출 정보
│  └─ <참조 자료·보조 파일>        # 원본의 상대 경로 유지
├─ .claude/skills/<skill>/
│  └─ SKILL.md                     # 원본 frontmatter와 정본 연결
├─ .env.example                    # 새 프로젝트의 설정 예시
├─ .github/workflows/              # 자동 검증과 배포
├─ .github/pull_request_template.md # PR 설명 양식
├─ public/                         # 공개 정적 자산
├─ src/                            # 웹 클라이언트
│  ├─ app/                         # 진입, 메뉴, 화면 조립
│  ├─ features/
│  │  ├─ auth/                     # Google 로그인, 앱 세션, MCP OAuth 동의
│  │  ├─ activity/                 # 할 일·기록·활동 목록
│  │  ├─ principles/               # 사용자 원칙
│  │  ├─ entity/                   # 단일 예제 엔터티(도메인 교체 대상)
│  │  ├─ search/                   # 검색 화면과 API 호출
│  │  ├─ tags/                     # 태그 관리
│  │  └─ settings/                 # 앱 설정과 연결 안내
│  ├─ components/                  # 공통 UI
│  ├─ lib/                         # HTTP/Auth 클라이언트와 표시 유틸
│  └─ styles/                      # 공통 스타일
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/                  # 테이블·RLS·제약·pgmq·pgvector 설정
│  ├─ schema/OVERVIEW.md            # 스키마 색인
│  ├─ functions/
│  │  ├─ api/index.ts              # 웹 HTTP: 작업·기록·원칙·검색
│  │  ├─ mcp/index.ts              # 외부 에이전트 MCP
│  │  ├─ search-index/index.ts     # 비동기 worker의 첫 사례: 검색 색인
│  │  └─ _shared/
│  │     ├─ core/                  # 업무 모델·유스케이스·포트
│  │     │  ├─ activity/
│  │     │  │  ├─ domain.ts        # Task, ActivityRecord, 업무 규칙
│  │     │  │  ├─ ports.ts         # 조회·저장·트랜잭션 계약
│  │     │  │  └─ application/     # 작성·조회·완료·기록 편집
│  │     │  ├─ principles/        # 사용자 원칙 모델·유스케이스·포트
│  │     │  ├─ entity/            # 단일 예제 엔터티 모델·유스케이스·포트
│  │     │  ├─ search/            # 검색·색인 유스케이스와 포트
│  │     │  └─ shared/            # 실제 공통 Actor·업무 오류만
│  │     ├─ adapters/
│  │     │  ├─ http/              # 목적별 경로와 입출력 변환
│  │     │  ├─ mcp/               # 프로토콜과 기능별 도구
│  │     │  ├─ auth/              # 세션·OAuth 검증 연결
│  │     │  ├─ supabase/          # 저장·트랜잭션·pgmq·pgvector 연결
│  │     │  └─ embedding/         # Pinecone Inference 연결
│  │     └─ bootstrap.ts          # 요청별 문맥과 구현 조립
│  └─ tests/database/             # 소유권·경쟁·원자 저장 검증
├─ plugins/workspace/             # 에이전트용 통합 플러그인 원본
│  ├─ <Claude manifest·연결 설정>  # Claude 플러그인의 실제 형식으로 구현
│  ├─ <Codex manifest·연결 설정>   # Codex 플러그인의 실제 형식으로 구현
│  └─ skills/workspace/           # 두 클라이언트가 공유하는 제품 스킬
│     ├─ SKILL.md                 # 제품 사용 에이전트 지침
│     └─ references/              # 작업·기록 작성·검색 활용
├─ e2e/                           # 웹↔MCP 실제 사용자 흐름
├─ scripts/                       # 개발·검증·설정·배포 보조
├─ experiments/                   # 기술 가정의 격리 실험(주제별 독립 폴더). 앱 코드가 아니며 앱이 가져오지 않음
└─ docs/
   ├─ START-HERE.md
   ├─ agents/                     # issue tracker·triage labels·domain 설정
   ├─ overview.html               # 목적·사용법·개발 방법·코드 구조의 그림 안내(정본 아님)
   ├─ product/                    # 목적과 사용자 시나리오
   ├─ architecture/               # 책임·호출·의존성·계약
   ├─ design/                     # 코드 배치·디자인 원칙·시각 규격·UI 패턴
   ├─ adr/                        # 승인된 주요 결정
   ├─ development/                # 환경과 검증
   ├─ deployment/                 # 서비스 설정과 배포
   ├─ operations/                 # 점검·장애·백업·데이터 복구
   ├─ security/                   # 신뢰 경계·보호 규칙·보안 검증
   └─ tickets/                    # 이전 계약·실험·검증 이력; 현재 작업은 GitHub Issues
```

트리는 배치 기준이며 실제 파일은 소비하는 기능을 구현할 때 만든다. 작은 기능은 domain.ts, ports.ts 같은 파일로 시작하고 필요할 때 분리한다. 단위 테스트는 코드 옆에 둔다. activity의 태그 모델은 독립 책임이 필요해질 때 core/tags로 추출한다. 빈 폴더를 일괄 생성하지 않는다.

웹의 공통 시각 토큰·타이포그래피·필드 스타일은 src/styles, 표현과 접근성 컴포넌트는 src/components, 기능별 데이터·초안·필터 상태는 src/features에 둔다. 실제 규격은 [디자인 가이드](guide.md)를 따른다. AGENTS.md는 프로젝트 문맥을 연결하고 단계별 작업 방법은 [공유 스킬](../development/matt-skills.md)이 담당한다. CLAUDE.md와 .claude/skills는 Claude Code용 연결 파일이며 정본의 작업 방법을 복제하지 않는다.

## 이름과 확장

- domain은 공통/앱별 구분이 아니라 업무 모델의 역할이다. Task와 ActivityRecord도 도메인 모델이다. UI를 포함하는 별도 src/domain은 두지 않는다.
- 예제 엔터티 `Entity`는 [PRD](../product/concept.md)의 기본 예제다. 명시적인 컬럼을 가진 단일 테이블과 그 모델·유스케이스·화면이며 이름 그대로 `entity` 위치에 둔다. 새 앱은 이 위치를 도메인 이름으로 바꾼다. 예를 들어 고객 앱은 `entity`를 `customers`로 바꾸고 고객 DB migration·HTTP/MCP·저장 어댑터·제품 스킬·테스트를 함께 바꾼다.
- 금지하는 것은 동적 키–값 컬럼이나 범용 payload로 여러 도메인을 담는 Entity/Item 저장소다. 예제 `Entity`는 속성이 컬럼으로 고정된 도메인 테이블이므로 이 금지 대상이 아니다.
- 검색 이름은 search다. HTTP 검색은 api의 /search에 둔다. search-index는 권한과 실행 계기가 다른 내부 작업이므로 분리한다. knowledge 접두어는 사용하지 않는다.
- 웹은 업무 API 응답을 사용한다. DB 행 타입, 서버 bootstrap/adapters를 브라우저로 가져오지 않는다. API DTO·DB 행·도메인 모델을 구분하되 형식적인 변환 클래스를 의무화하지 않는다.
- plugins/workspace는 MCP 연결과 제품 스킬을 함께 배포하는 플러그인 원본이다. manifest·연결 설정·스킬·참고 문서를 포함한다. 트리의 꺾쇠 항목은 설명용 자리이며 실제 파일명이 아니다. 지원 클라이언트는 Claude와 Codex로 확정했다. 각 클라이언트의 공식 형식과 endpoint/등록 앱 참조 방식을 확인한 뒤 실제 파일명을 문서화한다. 클라이언트별 manifest는 같은 skills/workspace를 참조하고 제품 스킬을 클라이언트별로 복제하지 않는다. 하나의 manifest가 모든 에이전트에 설치된다고 가정하지 않는다.
- AGENTS는 프로젝트 개발 문맥, .agents/skills의 SKILL은 개발 방법, plugins/workspace의 SKILL은 제품 사용 규칙, principles는 사용자 원칙 데이터다. 개발용 [코드 설계 원칙](../architecture/principles.md)과 다르다. workspace라는 제품 이름이 다중 조직·멤버십 모델을 자동으로 요구하지 않는다.

## 다음 작업

새 작업과 실제 진행 작업은 [GitHub Issues](https://github.com/kimyongin/agent-workspace-template/issues)에서 확인하고 필요한 기능의 파일을 만든다. [Template-02](../tickets/template-02-implementation-base.md)와 [Template-01](../tickets/template-01-task-record-search.md)은 이전 구현 범위와 할 일·기록·검색 계약의 근거다. 제품의 범위는 [PRD](../product/concept.md), 문서와 이전 근거의 진입점은 [START-HERE](../START-HERE.md)에서 확인한다.
