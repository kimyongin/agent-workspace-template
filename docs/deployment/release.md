# 배포 방법

## 목적과 현재 상태

새 프로젝트의 최초 설치, 이후 릴리스와 부분 실패 시 복구 절차를 정의한다. 배포 후 상시 점검과 장애 대응은 [운영 방법](../operations/runbook.md)이 담당한다.

이 문서는 배포 환경과 복구의 기준이다. 실제 명령·환경변수·workflow는 코드와 설정에서 확인하고, 실행한 revision·환경·결과는 해당 GitHub issue·PR의 배포 증거로 확인한다.

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

## 통합 기록 계약과 혼합 버전

업무 설정의 섹션별 ID·버전 전환은 [ADR-0015](../adr/0015-change-record-templates.md)를 따른다. 기존 JSON·버전을 보존하는 migration 뒤 같은 revision의 서버와 웹을 적용한다. GET은 `versions[id]`, PATCH/MCP는 `id`·`expected_version`·`value`를 사용한다. 이전 단일 version·sections 입력은 제거하며 소스 후보 플러그인 0.5.0의 안내를 함께 검증한다. 운영 배포와 설치된 플러그인 갱신은 별도 실행 범위를 따른다.

새 변경 기록은 최종 메모·사건 식별정보·선택한 대상 문맥을 저장한다. 옛 행의 전체 캡처와 적용 원칙 snapshot·보존 chunk는 보존하며 새 계약으로 조회한다. 인터페이스 정리로 과거 업무 자료를 삭제하거나 당시 내용을 만들어내지 않는다.

구 계약의 유지 여부는 [실제 사용처 기준](../architecture/principles.md#9-실제-사용처를-기준으로-구-계약을-정리한다)으로 판단한다. 별도 외부 사용처가 없으면 앱의 웹·HTTP/MCP·제품 스킬·검사 도구를 새 계약으로 함께 전환하고 구 경로·도구·입력 alias와 임시 writer trigger를 제거한다. 제거 범위·지원하는 새 계약·자료 보존 검사와 제출 revision은 해당 issue·PR에서 확인한다.

실제 외부 사용처가 있으면 지원 대상별 전환·검증·종료 조건을 먼저 기록하고 필요한 기간에만 호환 계약을 유지한다. 배포 대상에 동시에 실행되는 이전 웹·서버·worker가 있으면 쓰기 중지 범위·적용 순서·복구 revision을 정한다. DB·API·웹·패키지를 하나의 원자적 배포라고 주장하지 않는다.

엔터티의 발급처별 식별·소프트 삭제 전환은 [ADR-0016](../adr/0016-entity-source-identity-and-restoration.md)을 따른다. 이전 UUID를 앱 발급처의 외부 식별자로 보존하고 태그·할 일·기록 문맥·사건 참조를 함께 전환한다. 적용 전 자료가 있는 격리 DB에서 이관을 검증하며, 전환한 저장 계약에는 새 서버·웹·제품 스킬을 함께 사용한다. 이미 물리 삭제된 자료를 이관으로 복구할 수 있다고 주장하지 않는다. 사용자 업무 설정은 [ADR-0015](../adr/0015-change-record-templates.md)의 소유자별 설정 묶음으로 저장하며 기존 프로필·표시 설정을 보존한다.

제품 manifest의 대응하는 버전, 패키지 SHA-256·파일 해시·서버 계약 해시, 실제 backend/web revision과 지원 클라이언트·혼합 버전 범위를 함께 기록한다([패키지 검사](../../plugins/workspace/README.md)). 같은 버전의 기존 배포가 최신 계약을 지원한다고 추정하지 않는다. 실제 소비자의 전환·CI와 `main` 반영·운영 DB/서비스 배포는 각각 증거와 실행 조건이 필요하다. 실제 제품 왕복과 별도 고객 관리 서비스의 실행 범위는 해당 GitHub issue에서 확인한다.

## 요청 키 계약 릴리스

[ADR-0018](../adr/0018-server-ids-and-request-idempotency.md)의 구현은 서버 생성 트랜잭션에서 내부 ID를 발급하며 HTTP `Idempotency-Key`와 MCP `request_key`를 모든 업무 쓰기에 요구한다. 공개 ID 예약 경로/도구와 준비 단계 ID 발급은 제거됐다. 이전 키 없는 웹·플러그인은 새 서버에서 쓰기가 거절되므로 같은 릴리스의 서버·웹·제품 플러그인을 함께 전환한다. 0.6.0 플러그인은 이 계약의 소스 후보이며 운영 서버나 기존 설치의 적용 완료를 뜻하지 않는다.

1. 쓰기·worker 중지 범위, 적용 revision·패키지 해시와 복구 revision을 기록한다. 기존 UUID·업무·참조를 가진 격리 DB의 전진 이관과 빈 DB의 전체 migration을 검증한다.
2. 요청 결과·외부 effect·worker 복구와 1 MiB 응답 보관 한도의 전진 migration을 먼저 적용한다. 응답 한도 확대는 기존 결과를 보존하며 업무 설정 입력의 128 KiB 한도를 바꾸지 않는다. private ACL, owner 격리, 30일 요청 행 정리 Cron과 계정 cascade를 확인한다. 평생 요청 counter 제거와 만료 요청 행 전체 삭제는 스펙 #300의 전진 migration으로 적용하며 기존 업무 자료·참조·설정을 보존한다. 과거 migration은 보존한다. [ADR-0019](../adr/0019-pk-based-data-id-generation.md)의 PK 기반 생성으로 전환할 때는 쓰기를 중지하고 새 writer와 순방향 migration을 함께 적용한다. migration은 ID 기본값을 순수 후보 함수로 바꾸고 미사용 예약 allocator·발급 원장을 제거한다. 기존 업무·참조·요청 결과는 수정하지 않는다.
3. 함수 환경에 안정적인 `PINECONE_ACCOUNT_SCOPE`를 설정한다. 값은 공급자 account/project를 식별하며 API 키 회전에도 유지한다. 누락 상태의 새 worker는 claim 전에 실패한다. 값이나 비밀은 배포 기록에 출력하지 않는다.
   `worker_not_configured`이면 함수 관리 로그의 같은 이름 이벤트에서 `invalid_settings`에 나온 설정 이름을 확인한다. 공개 응답은 상세 설정을 포함하지 않는다. 이름만으로 충분하지 않으면 Dashboard에서 설정 유무와 길이 조건을 확인하고, 비밀값을 진단 로그에 출력하지 않는다.
   배포할 설정 파일은 `deno run --config supabase/functions/deno.json --allow-env --env-file=<커밋하지 않는 설정 파일> scripts/verify-worker.ts`로 먼저 검사한다. 실제 대상의 `INDEX_WORKER_URL`을 같은 비밀 파일에 넣고 `--allow-net`과 마지막 `--probe` 인자를 더하면 인증된 설정 전용 호출의 HTTP 200/configuration_checked을 확인한다. 로컬 파일 통과는 원격 전달을 보증하지 않으며 설정 전용 호출은 DB 연결·큐 claim·외부 호출을 하지 않으며 실제 임베딩 성공이 아니다. 실제 소량 성공·현재 색인·검색 검증은 별도로 수행한다.
4. 같은 계약의 HTTP·MCP·worker와 웹을 적용하고 제품 플러그인 후보를 검증·갱신한다. 오래 열린 웹과 이전 플러그인에는 갱신을 안내한다. 준비는 읽기이며 생성 결과로 정본 ID를 받는지 확인한다.
   색인 장기 대기 안내가 포함된 서버를 적용하기 전에 `workspace_indexing_wait` 전진 migration을 적용한다. 이 조회는 15분 이상 준비 상태 갱신이 없는 기록을 점검 대상으로 안내하며 실패 원인을 확정하지 않는다. 이전 서버·웹은 추가 조회/필드를 사용하지 않아 호환된다.
5. 실제 HTTP↔OAuth MCP의 명시 키 재현·충돌·204, 웹 응답 유실 재시도와 scoped worker를 확인한 뒤 쓰기·소비를 단계적으로 재개한다. 지원 호스트의 키 유지와 유료 공급자 결과는 별도 증거로 남긴다.

부분 실패에서는 해당 쓰기/소비를 멈추고 호환 revision으로 복구한다. 30일 내 요청 ledger·effect 횟수·fence를 지우거나 구 writer를 되살리는 롤백은 하지 않는다. 복구된 큐가 이미 보낸 외부 작업을 다시 보내지 않도록 현재 원본과 성공 cache·unknown·전송 상한을 대조한다. 이 절차는 운영 적용 지시를 대신하지 않는다.

## 최초 설치

별도 복사본의 식별·포트·로컬 확인은 [새 프로젝트 시작](../development/new-project.md)을 먼저 따른다. 로컬 준비와 실제 새 앱의 도메인 교체·OAuth·배포 검증을 구분한다.

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

웹 사용 가이드는 공개 `VITE_API_URL`의 마지막 `/api` 경로를 `/mcp`로 바꿔 같은 서버의 연결 주소를 안내한다. 선택 공개 설정 `VITE_REPOSITORY_URL`에는 해당 앱의 GitHub 저장소 URL을 넣으면 `plugins/workspace/README.md`와 `docs/deployment/release.md`의 설치·검증 안내를 연결한다. Pages 빌드는 선택 Actions 변수 `PROD_REPOSITORY_URL`을 이 값으로 전달한다. 공개해도 되는 앱 저장소 주소를 관리자가 명시하며 저장소 주소를 자동 노출하지 않는다. 다른 문서 구조를 쓰는 앱은 가이드 연결도 함께 조정한다. 미설정 시 주소나 문서 링크를 추측하지 않고 관리자에게 요청할 항목을 표시한다. 이 설정은 연결·설치를 실행하거나 검증 완료로 표시하지 않는다.

## 변경 릴리스

### 기본 서비스 초기 설정

- **GitHub Pages:** 저장소의 Pages 배포 소스를 GitHub Actions로 구성하고, 검증된 정적 빌드 artifact를 배포하는 workflow를 구현한다. 프로젝트 경로 또는 custom domain에 맞는 base URL과 라우팅 전략을 정한다. 상세 URL 직접 진입·새로고침·Google 로그인 복귀를 확인한다. Pages에 서버 코드나 비밀값을 배포하지 않는다. 구현: [`.github/workflows/pages.yml`](../../.github/workflows/pages.yml)은 사람이 지시할 때만 수동으로 실행한다(`gh workflow run pages -f ref=<검증된 revision>`, main에 머지된 revision만 받음). 빌드는 저장소 Actions 변수(`PROD_SUPABASE_URL`·`PROD_SUPABASE_PUBLISHABLE_KEY`·`PROD_API_URL`)의 공개 값만 쓰고, 웹 경로는 저장소 이름(`VITE_BASE`)이며, 상세 URL 직접 진입은 빌드가 만드는 `404.html`이 처리한다. 운영 Supabase의 Site URL·redirect는 Pages 주소로 두고(`[remotes.production]`), 함수 Secrets의 `WEB_ORIGINS`에 Pages origin을 넣는다.
- **Google OAuth:** Google Cloud의 OAuth 동의 화면과 웹 client를 준비하고 Supabase Google provider에 client ID/secret을 설정한다. Google의 승인된 redirect에는 해당 Supabase 프로젝트가 안내하는 Auth callback을 등록한다. Supabase의 Site URL/허용 redirect에는 실제 Pages 앱의 로그인 복귀 주소를 등록한다. 두 주소를 혼동하지 않으며 로컬·격리·운영 설정을 구분한다. Google client secret은 웹 빌드에 넣지 않는다. 기본 로그인에는 필요한 최소 프로필 범위만 사용하고, Google API 추가 권한은 별도 기능에서 결정한다.
- **Pinecone:** Inference를 사용할 프로젝트와 API 키를 준비하고 Edge Secrets에 설정한다. 모델·차원·입력 종류·API 버전·배치/호출 한도를 기록하고 문서와 질의 임베딩을 함께 확인한다. 결과 벡터는 Supabase pgvector에 저장한다. 설치 요구에 Pinecone 벡터 인덱스 생성을 추가하지 않는다.

- **MCP OAuth:** Supabase Auth의 OAuth 2.1 서버와 동적 클라이언트 등록을 켜고, 인가 경로를 웹 앱의 `/oauth/consent`로 지정한다. 비대칭 JWT 서명 키(ES256 권장)를 쓰고, MCP 토큰의 `aud`를 MCP 서버 URL로 바꾸는 Custom Access Token Hook을 등록한다. hook은 Auth가 생성한 `iss`의 `/auth/v1`을 `/functions/v1/mcp`로 바꿔 audience를 계산한다. 서버도 신뢰하는 `AUTH_ISSUER`에서 같은 주소를 계산한다. 주소 설정 테이블과 별도 `MCP_URL` Secret은 사용하지 않는다. `AUTH_ISSUER`는 같은 프로젝트의 공개 Auth 주소여야 하며, 다른 호스트의 MCP나 임의 경로는 지원하지 않는다. 잘못된 issuer이면 발급·서버 시작이 실패한다. `api`·`mcp` 함수는 자체 토큰 검증을 하므로 게이트웨이 JWT 검사(`verify_jwt`)를 끈다. 함수 Secrets에는 `APP_DB_URL`(접속 역할 `app_server`의 트랜잭션 풀러 주소), `AUTH_ISSUER`, `WEB_ORIGINS`를 둔다. `app_server`의 비밀번호는 migration에 없으므로 환경마다 따로 설정한다. 로컬 값은 `scripts/local-setup.mjs`가 같은 항목을 만든다. 구성 근거는 [아키텍처](../architecture/hexagonal-review.md#google-로그인과-mcp-인증)에 있다.

위 항목의 실제 변수명·명령은 구현 시 확정한다. Google 동의 화면의 게시 상태·대상 사용자 제한과 해당 사용 범위의 검증 필요성을 운영 전 확인한다. Google 로그인과 플러그인 MCP OAuth는 각각 실클라이언트에서 검사한다.

### 릴리스 실행

공개 전 [보안 검증](../security/guide.md)을 변경 범위에 적용한다. 인증·역할·RLS·worker 보호·웹 산출물의 비밀 노출·외부 전송 설정을 실제 배포 대상과 대조하고 실패한 필수 경로를 해결한다. 검증 결과와 제외 사유는 해당 릴리스 티켓에 남긴다.

기본 자동화 방향은 PR의 격리 검증과 운영 배포 단계를 분리하는 것이다. 운영 자격 증명을 PR 테스트에 제공하지 않는다. 운영 배포는 명시적인 대상 환경과 검증 revision으로 시작하고, 동일 환경의 배포가 겹치지 않게 한다. 자동 시작 조건·보호 규칙·승인 설정은 CI 구현 때 확정한다.

1. **릴리스 준비:** 대상 commit, 테스트 결과, 변경 migration·함수·웹·스킬, 기존 클라이언트와 큐 메시지의 호환성, 복구할 이전 artifact를 기록한다. DB 변경 전 복구 지점과 실제 백업 가능 여부를 확인한다.
2. **DB 확장:** 기존 서버가 계속 동작할 수 있는 추가 변경부터 적용한다. 운영 reset이나 과거 migration 재작성으로 변경하지 않는다. 실패하면 이후 배포를 중단하고 실제 적용 상태부터 확인한다.
3. **서버와 worker:** 필요한 Secrets와 HTTP/MCP/worker를 배포한다. 새 worker가 기존 대기 메시지를 처리할 수 있어야 한다. 호환되지 않으면 생산·소비 중지와 메시지 이관 방식을 먼저 정한다. 최초 Cron은 worker 준비·인증과 해당 환경의 소량 성공·비용 확인 후 활성화한다.
4. **서버 확인:** 승인된 점검 계정으로 인증·읽기·최소 쓰기·재조회와 비동기 작업 완료를 확인한다. 점검 데이터의 표시와 정리 범위를 미리 정하고 실제 사용자 자료로 파괴적 시험을 하지 않는다.
5. **웹·플러그인 공개:** 검증한 서버 계약을 사용하는 웹과 MCP·스킬 통합 플러그인을 공개한다. Pages의 기본 경로, 새로고침·상세 URL, 로그인 복귀와 아래 플러그인 설치·행동 검증을 수행한다.
6. **관찰과 종료:** 오류·지연·큐 적체·검색 반영을 확인하고 단위별 배포 결과를 기록한다. 실제 이전 버전 사용처를 지원한 경우에는 전환과 종료 조건을 확인하고 구 필드·구 도구를 제거한다.

이 순서는 후방 호환 변경의 기본 순서다. 호환되지 않는 변경은 작업 중지 범위와 데이터 이관을 포함한 별도 릴리스 계획이 필요하다. migration·서버·웹을 하나의 원자적 배포로 간주하지 않는다.

### CLI 서버 bundler의 공통 import map

Supabase CLI 2.119.0의 실제 `functions deploy --help`와 [PR #82 배포 기록](https://github.com/kimyongin/agent-workspace-template/pull/82)에서 `--use-api --import-map` 조합을 확인했다. 이 저장소는 `supabase/functions/deno.json`에 공통 imports를 두고 각 함수의 deno.json은 빈 workspace member다. 원격 bundler에 함수만 보내면 공통 alias를 찾지 못해 400이 날 수 있으므로 검증 revision의 imports를 명시한다.

검증한 source/config를 저장소 밖 임시 workspace로 복사하고, 공통 deno.json의 `imports` 객체만 담은 UTF-8/LF JSON을 그 workspace의 `supabase/functions/release-import-map.json`에 만든다. 비밀·env·개인 설정을 map/source에 넣지 않는다. locked CLI에 `--workdir <임시 workspace> --project-ref <승인한 ref>`를 명시하고 `functions deploy api mcp index-worker --use-api --no-verify-jwt --import-map <임시 workspace>/supabase/functions/release-import-map.json`으로 대상 함수만 배포한다. gateway 검사를 끈 함수의 서버 자체 인증은 유지한다.

map을 functions 밖 임시 root에 두면 배포가 성공해도 정상 `functions download --use-api`가 추출 경계 밖 경로를 거부할 수 있다. 경로 검사를 우회하지 않고 처음부터 functions 안에 둔다. 배포 후 ACTIVE/version/runtime bundle hash를 기록하고 새 외부 workspace에 정상 다운로드해 실행 source와 map imports를 검증 revision과 대조한다. 다운로드된 artifact와 generated deploy map을 구분하고 작업이 끝나면 generated map만 정확한 경로를 검증해 제거한다. map 경로 차이는 bundle hash에 영향을 주므로 코드 revision과 runtime hash를 각각 기록한다. 비밀 없는 source artifact는 복구 기준이며 DB 복원 검증을 뜻하지 않는다.

## 플러그인 패키징과 배포

플러그인 갱신은 `plugin-creator:update-plugin` 스킬로 대상의 소유 원본과 지원 경로를 먼저 구분한다. 스킬은 라우팅 절차이며 모든 설치 플러그인을 계정 업로드로 갱신하는 도구가 아니다. 이 저장소의 Workspace는 `plugins/workspace/`와 로컬/Git marketplace가 원본이며 현재 패키지 버전은 [제품 README](../../plugins/workspace/README.md)가 안내한다.

- 로컬/Git 플러그인은 원본을 수정·검사하고 대상 CLI가 지원하는 marketplace 갱신·업데이트/재설치·새 세션 반영을 사용한다. 설치 cache는 직접 편집하지 않는다.
- 계정에 저장한 플러그인은 정확한 backend `plugin_id`, 읽어 확인한 `current_release_id`, 편집 가능 여부와 저장된 scope를 확인한 경우에만 `update_plugin`을 사용한다. Git 관리 플러그인·canonical App/Sites 플러그인은 소유 원본의 릴리스 경로를 사용한다. 표시 이름만으로 ID를 추정하지 않는다.
- 앞으로 플러그인 설치·갱신·게시는 웹/앱 UI 조작으로 수행하지 않는다. 지원 도구·CLI가 없으면 그 경로와 미검증 한계를 기록해 인계하며 UI를 대체 경로로 사용하지 않는다. OAuth나 사용 행동의 확인은 배포 성공과 구분한다. 과거 웹 검증 기록은 당시 증거로 보존한다.

사용자가 요청한 범위가 원본·문서 수정이면 계정 게시·설치·버전 변경·서비스 배포까지 실행하지 않는다. 실제 공개 요청에서는 기존 식별자·공유 범위·권한을 유지하고 아래 호환 검증을 수행한다.

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

첫 운영 배포 전에는 실행 명령과 설정 항목, 비배포 PR 검증 workflow, 운영 배포 workflow, 신규 프로젝트 설치 재현, 이전 artifact 복귀, 백업 복원 연습, [운영 점검](../operations/runbook.md)의 담당·기준·알림 경로가 준비되어야 한다. 준비 상태와 실제 실행 증거는 해당 배포 GitHub issue와 PR에서 확인한다.

기존 환경을 업그레이드할 때 새 migration과 함수 변경을 함께 적용한다. 새 서버가 기존 `MCP_URL`을 읽지 않는 것을 확인한 뒤 해당 Secret을 삭제한다. 플러그인 메타 정보의 접속 URL은 같은 프로젝트의 `/functions/v1/mcp`로 유지한다. 이 절차는 운영 적용 지시를 대신하지 않는다.

## 공식 참고

2026-10-01 확인. 실제 명령은 채택한 CLI 버전의 도움말과 함께 재확인한다.

- [Supabase 배포와 환경 구성](https://supabase.com/docs/guides/deployment)
- [Edge Functions 배포](https://supabase.com/docs/guides/functions/deploy)
- [GitHub Pages 사용자 정의 workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Supabase Google OAuth 설정](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Pinecone Inference 임베딩 생성](https://docs.pinecone.io/guides/inference/generate-embeddings)

검색 구간 원장 축소의 전진 migration은 기존 passage effect에 원본 식별정보를 직접 이관하고 별도 의도 테이블·미사용 공급자 컬럼/함수를 제거한다. 성공 벡터·불명/실행 중 상태·횟수·lease·fence·backoff를 보존하며 큐를 재등록하거나 전송 예산을 초기화하지 않는다. claim/complete 인자는 실제 동기 Pinecone 계약으로 줄었으므로 같은 릴리스의 서버와 worker 호출자를 함께 전환한다. 운영 적용 전 해당 revision의 원장 이관·worker 재전달·현재 원본·owner 격리 검사 증거를 확인한다. 과거 migration 파일은 수정하지 않는다.
