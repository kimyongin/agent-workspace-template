# 도메인 앱 템플릿 폴더 구조 제안

2026-10-01 · Supabase 기반 헥사고날 방향 반영 · 구조 제안, 구현 전

## 목적과 기준

이 문서는 파일의 위치, 모듈 이름과 새 도메인의 추가 위치를 정의한다. 제품 의미는 [제품 컨셉](../product/concept.md), 코드 판단 기준은 [설계 원칙](../architecture/principles.md), 실행 책임은 [아키텍처](../architecture/hexagonal-review.md)를 따른다.

트리는 배치 제안이며 빈 디렉토리를 모두 미리 만드는 지시가 아니다. 기능별 구현 범위와 검증 조건은 해당 티켓에서 관리한다.

단일 저장소와 단일 웹 앱, 하나의 서버 코드 기반으로 시작한다. api, mcp와 비동기 worker는 같은 서버 코드를 조립하는 배포 진입점이다. 아래 search-index는 첫 worker의 예시다. 공통 및 앱별 업무 기능은 실제 이름으로 같은 위치에 추가한다.

## 제안 구조

```text
agent-workspace-template/
├─ README.md
├─ AGENTS.md                       # 개발 에이전트 작업 규칙
├─ .env.example                    # 새 프로젝트의 설정 예시
├─ .github/workflows/              # 자동 검증과 배포
├─ public/                         # 공개 정적 자산
├─ src/                            # 웹 클라이언트
│  ├─ app/                         # 진입, 메뉴, 화면 조립
│  ├─ features/
│  │  ├─ auth/                     # 로그인, 세션, OAuth 동의
│  │  ├─ activity/                 # 할 일·기록·활동 목록
│  │  ├─ principles/               # 판단 기준
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
│  │     │  ├─ principles/        # 판단 기준 모델·유스케이스·포트
│  │     │  ├─ search/            # 검색·색인 유스케이스와 포트
│  │     │  └─ shared/            # 실제 공통 Actor·업무 오류만
│  │     ├─ adapters/
│  │     │  ├─ http/              # 목적별 경로와 입출력 변환
│  │     │  ├─ mcp/               # 프로토콜과 기능별 도구
│  │     │  ├─ auth/              # 세션·OAuth 검증 연결
│  │     │  ├─ supabase/          # 저장·트랜잭션·pgmq·pgvector 연결
│  │     │  └─ embedding/         # 채택한 임베딩 공급자 연결
│  │     └─ bootstrap.ts          # 요청별 문맥과 구현 조립
│  └─ tests/database/             # 소유권·경쟁·원자 저장 검증
├─ plugins/workspace/             # 에이전트용 통합 플러그인 원본
│  ├─ <manifest·연결 설정>         # 대상 클라이언트의 실제 형식으로 구현
│  └─ skills/workspace/
│     ├─ SKILL.md                 # 제품 사용 에이전트 지침
│     └─ references/              # 작업·기록 작성·검색 활용
├─ e2e/                           # 웹↔MCP 실제 사용자 흐름
├─ scripts/                       # 개발·검증·설정·배포 보조
└─ docs/
   ├─ START-HERE.md
   ├─ product/                    # 목적과 사용자 시나리오
   ├─ architecture/               # 책임·호출·의존성·계약
   ├─ design/                     # 코드 배치·디자인 원칙·시각 규격·UI 패턴
   ├─ adr/                        # 승인된 주요 결정
   ├─ development/                # 환경과 검증
   ├─ deployment/                 # 서비스 설정과 배포
   ├─ operations/                 # 점검·장애·백업·데이터 복구
   ├─ security/                   # 신뢰 경계·보호 규칙·보안 검증
   └─ tickets/                    # 구현 범위·게이트·결과
```

트리는 향후 배치 기준이며 실행 코드는 아직 만들지 않았다. 작은 기능은 domain.ts, ports.ts 같은 파일로 시작하고 필요할 때 분리한다. 단위 테스트는 코드 옆에 둔다. activity의 태그 모델은 독립 책임이 필요해질 때 core/tags로 추출한다. 빈 폴더를 일괄 생성하지 않는다.

웹의 공통 시각 토큰·타이포그래피·필드 스타일은 src/styles, 표현과 접근성 컴포넌트는 src/components, 기능별 데이터·초안·필터 상태는 src/features에 둔다. 실제 규격은 [디자인 가이드](guide.md)를 따른다. 첫 구현에서 만드는 AGENTS.md에도 화면 작업 전 이 가이드를 읽도록 연결한다.

## 이름과 확장

- domain은 공통/앱별 구분이 아니라 업무 모델의 역할이다. Task와 ActivityRecord도 도메인 모델이다. UI를 포함하는 별도 src/domain은 두지 않는다.
- 고객 앱은 src/features/customers와 core/customers를 추가하고, 고객 DB migration·HTTP/MCP·저장 어댑터·스킬·테스트를 함께 연결한다. 범용 Entity/Item 저장소를 만들지 않는다.
- 검색 이름은 search다. HTTP 검색은 api의 /search에 둔다. search-index는 권한과 실행 계기가 다른 내부 작업이므로 분리한다. knowledge 접두어는 사용하지 않는다.
- 웹은 업무 API 응답을 사용한다. DB 행 타입, 서버 bootstrap/adapters를 브라우저로 가져오지 않는다. API DTO·DB 행·도메인 모델을 구분하되 형식적인 변환 클래스를 의무화하지 않는다.
- plugins/workspace는 MCP 연결과 제품 스킬을 함께 배포하는 플러그인 원본이다. manifest·연결 설정·스킬·참고 문서를 포함한다. 트리의 꺾쇠 항목은 설명용 자리이며 실제 파일명이 아니다. 첫 대상 클라이언트의 형식과 endpoint/등록 앱 참조 방식을 확정한 뒤 실제 파일명을 문서화한다. 추가 클라이언트 패키지는 필요할 때 구분하며 공통 스킬 내용의 중복 관리를 줄인다. 하나의 manifest가 모든 에이전트에 설치된다고 가정하지 않는다.
- AGENTS는 개발 규칙, SKILL은 제품 사용 규칙, principles는 사용자 데이터다. workspace라는 제품 이름이 다중 조직·멤버십 모델을 자동으로 요구하지 않는다.

## 다음 작업

[첫 기능 인계](../tickets/template-01-task-record-search.md)의 소비 범위부터 파일을 만든다. 제품의 기본·후속 범위는 [제품 컨셉](../product/concept.md), 최신 구현 상태는 [시작 문서](../START-HERE.md)에서 확인한다.
