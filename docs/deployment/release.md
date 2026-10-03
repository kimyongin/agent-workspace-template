# 배포 방법

## 목적과 현재 상태

새 프로젝트의 최초 설치, 이후 릴리스와 부분 실패 시 복구 절차를 정의한다. 배포 후 상시 점검과 장애 대응은 [운영 방법](../operations/runbook.md)이 담당한다.

이 문서는 배포 절차의 기준이다. 실제 명령·환경변수 이름·워크플로 파일은 구현하면서 빈 프로젝트에서 재현한 뒤 이 문서에 추가한다. 무엇이 구현·재현되었는지는 [시작 문서의 현재 상태](../START-HERE.md#현재-상태)와 티켓에서 확인한다.

## 배포 단위와 환경

| 단위 | 대상 | 별도로 확인할 것 |
| --- | --- | --- |
| DB | Supabase Postgres | 적용 migration, RLS·역할, 확장, 큐·스케줄 |
| 서버 | Supabase Edge Functions | HTTP·MCP·worker 버전, 인증 설정, Secrets |
| 웹 | GitHub Pages | 빌드 revision, 공개 설정, 기본 경로와 상세 URL |
| 로그인 공급자 | Google OAuth + Supabase Auth | Google OAuth client·callback, Supabase provider와 웹 복귀 URL |
| 임베딩 공급자 | Pinecone Inference | 서버 API 키·모델·차원·API 버전·호출 한도 |
| 에이전트 플러그인 | Claude·Codex | 클라이언트별 manifest·MCP 연결 설정/앱 참조와 공유 제품 스킬을 묶은 패키지 버전과 인증 상태 |

웹 배포가 DB·서버·제품 스킬을 자동으로 배포한다는 전제는 두지 않는다. DB와 서버를 한 workflow에서 배포하더라도 각 단계의 성공과 호환성을 따로 기록한다.

일반 로컬 개발, 초기화 가능한 격리 테스트, 운영 프로젝트를 구분한다. 필요하면 별도 스테이징을 추가한다. 프로젝트마다 Supabase project ref, 웹 URL, MCP URL, 대상 브랜치, 운영 담당자와 설정 위치를 배포 기록에 남기되 비밀값은 기록하지 않는다.

## 최초 설치

1. 템플릿으로 새 저장소를 만들고 앱 이름·웹 경로·서비스 식별자를 정한다. 템플릿의 서비스 연결이나 비밀값을 재사용하지 않는다.
2. 새 Supabase 프로젝트와 웹 호스팅을 준비한다. 실제 요금제의 한도·백업 기능과 리전을 확인한다. GitHub Pages는 정적 웹 호스팅으로 사용하며 서버 기능은 Edge Functions에서 실행한다.
3. 설정을 아래 표대로 분리한다. DB 접속 역할·권한과 요청별 사용자 문맥은 첫 기능의 검증된 계약을 적용한다.
4. 웹 로그인 redirect, 인증 공급자 callback, 에이전트 OAuth의 등록 URL·issuer·audience·scope를 실제 배포 주소와 맞춘다. 로컬 설정 파일이 원격 인증 설정까지 자동 반영된다고 가정하지 않는다.
5. 격리 환경에서 빈 DB부터 migration과 첫 사용자 흐름을 재현한다. 그 결과가 확인된 revision을 아래 릴리스 순서로 운영에 적용한다.
6. 웹 로그인과 상세 URL 직접 진입, 실제 MCP 인증·도구 호출, 큐 작업 완료를 확인한다. 지원 클라이언트와 미검증 항목을 기록한다.

외부 서비스 설정은 CLI·API로 할 수 있으면 에이전트가 직접 하고, 가능한 한 설정을 저장소에 코드로 남긴다(예: Supabase 인증 설정은 `supabase/config.toml`의 `[remotes.<환경>]`, 서버 비밀값은 `supabase secrets set`). 사람에게는 콘솔에서만 할 수 있는 단계(예: Google Cloud OAuth 클라이언트 만들기)와 비밀값 입력만 요청한다. 비밀값은 채팅으로 받지 않고 Git에서 제외되는 파일(`supabase/.env` 등)이나 콘솔에 직접 넣게 한다. 운영을 바꾸는 작업(운영 DB 적용·배포·설정 변경)은 CLI로 할 수 있어도 사람이 지시한 범위에서만 한다([ADR-0008](../adr/0008-document-ownership.md)의 실행 예외). 원격 설정을 바꾸기 전에는 바뀔 항목을 미리 보고(`supabase config diff`) 의도하지 않은 변경이 없을 때만 적용한다.

| 설정 종류 | 둘 위치 |
| --- | --- |
| 웹의 공개 URL·공개 인증 키 | 웹 빌드 설정. 공개 키가 데이터 접근 권한을 대신하지 않음 |
| DB 접속·외부 공급자·내부 worker 인증 비밀 | 서버 Secrets 및 필요한 DB Vault 설정 |
| 배포용 자격 증명 | CI의 보호된 secret 또는 배포 실행 환경 |
| 설정 항목 설명과 예시 | 향후 .env.example과 이 문서. 실제 비밀값은 제외 |

## 변경 릴리스

### 기본 서비스 초기 설정

- **GitHub Pages:** 저장소의 Pages 배포 소스를 GitHub Actions로 구성하고, 검증된 정적 빌드 artifact를 배포하는 workflow를 구현한다. 프로젝트 경로 또는 custom domain에 맞는 base URL과 라우팅 전략을 정한다. 상세 URL 직접 진입·새로고침·Google 로그인 복귀를 확인한다. Pages에 서버 코드나 비밀값을 배포하지 않는다. 구현: [`.github/workflows/pages.yml`](../../.github/workflows/pages.yml)은 사람이 지시할 때만 수동으로 실행한다(`gh workflow run pages -f ref=<검증된 revision>`). 빌드는 저장소 Actions 변수(`PROD_SUPABASE_URL`·`PROD_SUPABASE_PUBLISHABLE_KEY`·`PROD_API_URL`)의 공개 값만 쓰고, 웹 경로는 저장소 이름(`VITE_BASE`)이며, 상세 URL 직접 진입은 빌드가 만드는 `404.html`이 처리한다. 운영 Supabase의 Site URL·redirect는 Pages 주소로 두고(`[remotes.production]`), 함수 Secrets의 `WEB_ORIGINS`에 Pages origin을 넣는다.
- **Google OAuth:** Google Cloud의 OAuth 동의 화면과 웹 client를 준비하고 Supabase Google provider에 client ID/secret을 설정한다. Google의 승인된 redirect에는 해당 Supabase 프로젝트가 안내하는 Auth callback을 등록한다. Supabase의 Site URL/허용 redirect에는 실제 Pages 앱의 로그인 복귀 주소를 등록한다. 두 주소를 혼동하지 않으며 로컬·격리·운영 설정을 구분한다. Google client secret은 웹 빌드에 넣지 않는다. 기본 로그인에는 필요한 최소 프로필 범위만 사용하고, Google API 추가 권한은 별도 기능에서 결정한다.
- **Pinecone:** Inference를 사용할 프로젝트와 API 키를 준비하고 Edge Secrets에 설정한다. 모델·차원·입력 종류·API 버전·배치/호출 한도를 기록하고 문서와 질의 임베딩을 함께 확인한다. 결과 벡터는 Supabase pgvector에 저장한다. 설치 요구에 Pinecone 벡터 인덱스 생성을 추가하지 않는다.

- **MCP OAuth:** Supabase Auth의 OAuth 2.1 서버와 동적 클라이언트 등록을 켜고, 인가 경로를 웹 앱의 `/oauth/consent`로 지정한다. 비대칭 JWT 서명 키(ES256 권장)를 쓰고, MCP 토큰의 `aud`를 MCP 서버 URL로 바꾸는 Custom Access Token Hook을 등록한다. hook은 `private.auth_settings`의 `mcp_audience` 값을 쓰므로 migration 적용 뒤 그 환경의 MCP URL을 넣는다. 값이 없으면 OAuth 클라이언트 토큰 발급이 실패한다(웹 API를 여는 토큰을 만들지 않기 위한 의도된 동작). `api`·`mcp` 함수는 자체 토큰 검증을 하므로 게이트웨이 JWT 검사(`verify_jwt`)를 끈다. 함수 Secrets에는 `APP_DB_URL`(접속 역할 `app_server`의 트랜잭션 풀러 주소), `AUTH_ISSUER`, `MCP_URL`, `WEB_ORIGINS`를 둔다. `app_server`의 비밀번호는 migration에 없으므로 환경마다 따로 설정한다. 로컬 값은 `scripts/local-setup.mjs`가 같은 항목을 만든다. 구성 근거는 [아키텍처](../architecture/hexagonal-review.md#google-로그인과-mcp-인증)에 있다.

위 항목의 실제 변수명·명령은 구현 시 확정한다. Google 동의 화면의 게시 상태·대상 사용자 제한과 해당 사용 범위의 검증 필요성을 운영 전 확인한다. Google 로그인과 플러그인 MCP OAuth는 각각 실클라이언트에서 검사한다.

### 릴리스 실행

공개 전 [보안 검증](../security/guide.md)을 변경 범위에 적용한다. 인증·역할·RLS·worker 보호·웹 산출물의 비밀 노출·외부 전송 설정을 실제 배포 대상과 대조하고 실패한 필수 경로를 해결한다. 검증 결과와 제외 사유는 해당 릴리스 티켓에 남긴다.

기본 자동화 방향은 PR의 격리 검증과 운영 배포 단계를 분리하는 것이다. 운영 자격 증명을 PR 테스트에 제공하지 않는다. 운영 배포는 명시적인 대상 환경과 검증 revision으로 시작하고, 동일 환경의 배포가 겹치지 않게 한다. 자동 시작 조건·보호 규칙·승인 설정은 CI 구현 때 확정한다.

1. **릴리스 준비:** 대상 commit, 테스트 결과, 변경 migration·함수·웹·스킬, 기존 클라이언트와 큐 메시지의 호환성, 복구할 이전 artifact를 기록한다. DB 변경 전 복구 지점과 실제 백업 가능 여부를 확인한다.
2. **DB 확장:** 기존 서버가 계속 동작할 수 있는 추가 변경부터 적용한다. 운영 reset이나 과거 migration 재작성으로 변경하지 않는다. 실패하면 이후 배포를 중단하고 실제 적용 상태부터 확인한다.
3. **서버와 worker:** 필요한 Secrets와 HTTP/MCP/worker를 배포한다. 새 worker가 기존 대기 메시지를 처리할 수 있어야 한다. 호환되지 않으면 생산·소비 중지와 메시지 이관 방식을 먼저 정한다. 최초 Cron은 worker 준비·인증 확인 후 활성화한다.
4. **서버 확인:** 승인된 점검 계정으로 인증·읽기·최소 쓰기·재조회와 비동기 작업 완료를 확인한다. 점검 데이터의 표시와 정리 범위를 미리 정하고 실제 사용자 자료로 파괴적 시험을 하지 않는다.
5. **웹·플러그인 공개:** 검증한 서버 계약을 사용하는 웹과 MCP·스킬 통합 플러그인을 공개한다. Pages의 기본 경로, 새로고침·상세 URL, 로그인 복귀와 아래 플러그인 설치·행동 검증을 수행한다.
6. **관찰과 종료:** 오류·지연·큐 적체·검색 반영을 확인하고 단위별 배포 결과를 기록한다. 구 필드·구 도구 등 파괴적인 정리는 호환 기간과 소비자 확인 후 별도 릴리스로 진행한다.

이 순서는 후방 호환 변경의 기본 순서다. 호환되지 않는 변경은 작업 중지 범위와 데이터 이관을 포함한 별도 릴리스 계획이 필요하다. migration·서버·웹을 하나의 원자적 배포로 간주하지 않는다.

## 플러그인 패키징과 배포

플러그인은 서버 배포와 별도로 버전을 관리한다. 지원 클라이언트는 Claude와 Codex다. 두 패키지는 같은 skills/workspace와 MCP 서버 계약을 사용하고 manifest·연결 설정·설치 경로만 클라이언트별로 둔다. 각 클라이언트의 배포 형식을 확정한 뒤 다음 절차를 실제 명령·설치 경로로 구체화하고 클라이언트마다 수행한다. 한쪽의 설치·행동 검증으로 다른 쪽을 통과 처리하지 않는다.

1. manifest의 제품 식별자·버전, MCP endpoint 또는 등록 앱 참조, 스킬과 상대 참조 파일을 하나의 패키지로 준비한다. 서버 비밀과 다른 환경의 연결 정보를 포함하지 않는다.
2. 패키지 구조·참조 파일·스킬의 도구 이름과 실제 MCP schema의 일치를 검사한다. 지원 서버 계약/revision, 패키지 버전·해시, 직전 정상 artifact를 기록한다.
3. 신규 설치와 기존 플러그인 업데이트를 구분하고 대상 클라이언트의 절차로 배포한다. 같은 제품 업데이트는 해당 플랫폼의 식별자를 유지해 중복 설치를 피한다. 정확한 파일명·형식·업로드 방식은 클라이언트별 가이드에서 확정한다.
4. 새 설치와 업데이트 후 MCP 인증·도구 발견/호출, 스킬 포함·선택, 관련 자료 검색→원문 확인→요청된 결과 저장을 각각 검증한다. 설치/연결 성공만으로 스킬 동작을 통과 처리하지 않는다.
5. 문제가 있으면 지원되는 방식으로 이전 정상 내용의 복구 패키지를 배포하고 서버 계약과의 호환성을 다시 확인한다. 서버와 패키지는 동시에 갱신되지 않을 수 있으므로 설치된 이전 버전과의 호환 범위를 관리한다.

## 부분 실패와 복구

| 실패 | 대응 |
| --- | --- |
| 웹 공개 실패 | 기존 웹을 유지하거나 이전 빌드로 복귀. 새 서버와의 호환성을 확인 |
| 서버 배포·실행 실패 | 이후 공개를 중단. 현재 DB와 호환되는 이전 함수를 재배포하거나 수정 버전 적용 |
| migration 실패 | 적용 이력과 DDL·데이터 상태 확인 후 전진 수정. 재실행 안전성 확인 없이 반복하지 않음 |
| worker 실패 | 필요 시 소비를 중지하고 큐를 보존. 원인 수정 후 제한된 양부터 재처리 |
| 데이터 손상 | 쓰기와 worker를 통제하고 복구 범위 결정. 백업 복원 절차는 운영 문서를 따름 |

코드 복귀는 이미 변경된 데이터와 외부 서비스 부수효과를 되돌리지 않는다. 백업 복원은 정상적인 신규 데이터도 잃을 수 있으므로 일반적인 코드 롤백과 구분한다.

## 배포 기록 양식과 완료 기준

릴리스별로 일시·시간대, 담당자, 대상 환경, commit/CI 링크, DB migration 목록, Edge·웹·스킬 버전, 적용 순서와 결과, 실제 확인 흐름, 잔여 문제, 복구 지점을 기록한다. 비밀값과 사용자 본문은 남기지 않는다.

첫 운영 배포 전에는 실행 명령과 설정 항목, 비배포 PR 검증 workflow, 운영 배포 workflow, 신규 프로젝트 설치 재현, 이전 artifact 복귀, 백업 복원 연습, [운영 점검](../operations/runbook.md)의 담당·기준·알림 경로가 준비되어야 한다. 이 항목들은 첫 운영 배포를 다루는 티켓의 배포 준비 게이트다(이 템플릿에서는 [Template-01](../tickets/template-01-task-record-search.md)).

## 공식 참고

2026-10-01 확인. 실제 명령은 채택한 CLI 버전의 도움말과 함께 재확인한다.

- [Supabase 배포와 환경 구성](https://supabase.com/docs/guides/deployment)
- [Edge Functions 배포](https://supabase.com/docs/guides/functions/deploy)
- [GitHub Pages 사용자 정의 workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Supabase Google OAuth 설정](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Pinecone Inference 임베딩 생성](https://docs.pinecone.io/guides/inference/generate-embeddings)
