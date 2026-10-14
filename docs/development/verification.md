# 프로젝트 실행 환경

명령과 도구 버전의 정본은 [package.json](../../package.json)과 [CI](../../.github/workflows/ci.yml)다. 환경 설정은 [supabase/config.toml](../../supabase/config.toml), [Vite](../../vite.config.ts), [Playwright](../../playwright.config.ts), [.env.example](../../.env.example)에서 확인한다. 개발·테스트 방법은 Matt 원본 스킬이 정한다.

## 로컬 서비스와 데이터

Node·Deno·Supabase CLI 버전과 설치 명령은 package.json·lockfile을 따른다. 로컬 Supabase에는 Docker가 필요하다. 함수 서버와 웹 서버의 실행 대상은 환경 파일에서 확인한다. 웹을 로컬에서 열었다고 DB도 로컬인 것은 아니다.



기존 로컬 stack을 다른 checkout/worktree에서 재사용할 때는 함수 실행 전에 `supabase/signing_keys.json`의 공개 `kid`가 해당 Auth의 `/auth/v1/.well-known/jwks.json`과 일치하는지 확인한다. 같은 project_id라도 checkout의 무시 파일은 서로 다를 수 있으며, CLI가 다른 JWKS를 함수에 주입하면 Auth 로그인은 성공하고 업무 API만 401을 반환한다. DB·사용자·서명키를 재생성하지 말고 실행 설정을 기존 stack에 맞춘다. 비밀키·토큰은 출력하지 않고 기존 파일은 비공개 백업으로 보존한다. 로컬 Google provider가 비활성화된 경우 `.env.local`의 준비된 개발 계정으로 로그인한다.

`setup:local`은 키·개발 계정·환경 파일을 준비하며 기존 생성 값과 사용자 설정을 보존한다. `test:integration:local`은 설정된 함수 서버를 먼저 관찰한다. 준비된 기존 실행은 재사용하고, 준비 중이면 최대 2분 기다리며 준비 실패 시 중단한다. 기존 실행에서는 setup·migration·환경 파일 갱신을 하지 않으므로 검사에 필요한 로컬 환경은 먼저 준비되어 있어야 한다. 명령의 실제 동작은 [검사 실행](../../scripts/test-local-integration.mjs)과 [수명주기 module](../../scripts/local-runtime.mjs)이 소유한다.

함수 실행이 없을 때만 Edge runtime을 제외한 setup 후 다시 관찰하고 직접 함수를 실행한다. setup 중 독립적으로 나타난 실행은 빌려 쓰며 제거하지 않는다. 직접 실행할 때는 기본 환경 파일을 수정하지 않고 개인 임시 환경 파일에 실행별 nonce를 추가한다. 정확한 컨테이너 ID·실제 functions bind source·Docker 환경의 nonce가 모두 일치해야 정리를 허용한다. 생성 시각이나 동일 source만으로 소유권을 추정하지 않는다. 실행 직전에도 다시 관찰하며, nonce가 없거나 ID가 바뀌면 중단하고 컨테이너를 보존한다. 검사 종료·실패·SIGINT/SIGTERM에는 직접 만든 자식 프로세스 트리를 강제 종료하고 증명한 컨테이너 ID만 정리하며 DB·volume과 기존 실행을 정리하지 않는다. project 이름만으로 정리하지 않는다. 다른 터미널이 같은 project의 Supabase CLI를 직접 실행하는 경우 CLI 자체의 이름 기반 교체와 시작 시점 경쟁까지 원자적으로 막지는 못하므로 같은 project에서 동시에 시작하지 않는다.

단계별 원래 종료 코드와 정리 실패를 함께 표시하고, 중단 후 남은 단계를 실행하지 않는다. 준비·소유권 확인 실패에는 새 실행을 반복하지 않는다. 서비스 로그와 원래 검사 실패는 필요한 경우 실행별 외부 위치에 보존한다. 수명주기/외부 Docker adapter의 모의 검사는 실제 격리 CLI 실행과 구분한다.

## 엔터티 스키마의 로컬 소비 실행

영속 분석/마이그레이션은 페이지의 요청이나 진행 조회가 소비하지 않는다. 로컬 환경 소유자가 `setup:local`로 생성한 `PROCESSING_TOKEN`을 함수 환경과 `.env.local`에 동일하게 준비하고 함수 서버를 실행한 뒤, 별도 터미널에서 아래 명령으로 소비를 명시적으로 켠다. 환경 파일을 갱신했다면 함수 서버를 다시 시작한다. `setup:local`·migration·일반 GET은 폴링이나 Cron을 등록하지 않는다.

```sh
npm run worker:entity-schema:local -- --check-configuration
npm run worker:entity-schema:local
```

첫 명령은 인증된 `{ "check_configuration": true }` 구성 확인만 수행하고 종료하며 작업을 claim하지 않는다. 두 번째 명령은 설정된 로컬 origin의 `/functions/v1/entity-schema-worker`에 `{ "limit": 1 }`을 보낸다. `supabase/config.toml`의 API 주소를 읽고 `.env.local`의 `VITE_SUPABASE_URL`·`VITE_API_URL`이 정확히 같은 origin/경로인지 확인한다. 기본 포트를 따로 가정하지 않는다. 원격 주소·자격증명이 붙은 주소·redirect를 거부하고 서버 전용 토큰만 사용한다.

`--config=/absolute/path/config.toml`은 별도 격리 로컬 설정을 명시할 때 사용한다. 생략하면 추적된 supabase/config.toml을 읽는다. 어느 설정에서도 loopback HTTP와 .env.local의 정확한 API origin 일치를 검사한다. 실제 브라우저 값 변환 검사는 `ENTITY_SCHEMA_WORKER_CONFIG`에 격리 설정 경로를 지정하면 opt-in child runner에 같은 인자를 전달한다. 추적된 설정을 테스트용 포트로 수정하지 않는다.

응답 완료 후 기본 2000ms를 기다려 다음 호출을 하므로 요청이 겹치지 않는다. `--interval-ms=1000`·`--timeout-ms=30000`은 각각 100~60000ms 정수만 허용한다. `--once`는 한 번만 소비한다. HTTP 비성공·연결 실패·요청 시간 초과에는 실행기를 종료하고 작업 상태를 다시 확인한다. 네트워크 관찰 실패만으로 작업을 failed/cancelled로 만들지 않는다. Ctrl+C/SIGINT는 130, SIGTERM은 143으로 요청·대기를 취소해 끝낸다. 소비 중단은 접수된 작업 삭제가 아니며 재실행 시 영속 상태/lease에 따라 이어간다. 로그에는 HTTP 상태만 출력하고 응답 본문·토큰·변환 원문·stage는 출력하지 않는다.

실제 API E2E fixture는 함수 준비 후 이 실행기를 자식 프로세스로 시작하고 종료·실패 시 해당 자식만 중단한다. 분석 접수 뒤 페이지 이동/닫기→재접속→완료 조회를 실행해 브라우저 수명과 독립적인 소비를 확인한다. runner의 격리 HTTP/CLI 테스트는 실제 app_worker 권한·lease/fence·DB 처리·브라우저 완료 증거를 대신하지 않는다. #343 통합 E2E 판단·실행 증거는 #351에서 전체 통합 revision을 기준으로 남긴다. 운영 일정 활성화는 [별도 운영 인계](../operations/runbook.md#엔터티-스키마-worker-호출과-운영-인계)를 따른다.

## 로컬 자원 절약과 메모리 부족 복구

로컬 개발·기능 검증은 `[edge_runtime] policy = "oneshot"`을 사용한다. 실제 실행 대상의 `supabase/config.toml`을 확인하며 별도 worktree·복사한 설정에도 같은 정책을 적용한다. `per_worker`는 의도적인 부하 검사에만 선택한다. [Supabase 공식 설정 문서](https://supabase.com/docs/guides/local-development/cli/config#edge_runtime.policy)는 `oneshot`을 개발용, `per_worker`를 부하 검사용으로 권장한다. CLI 생성 주석과 문서가 다르면 고정된 CLI 버전의 실제 동작도 확인한다. 설정 수정만으로 실행 중인 서버가 바뀌었다고 판단하지 않으며, 재시작은 소유권을 확인한 뒤 기존 수명주기 규칙을 따른다.

개발 스택은 [로컬 준비 스크립트](../../scripts/local-setup.mjs)의 최소 서비스 구성으로 시작한다. 사용하지 않는 관리·메일·실시간·파일 서비스는 제외하고, DB·로그인·실제 API·연결 풀·함수 실행 등 검증 경로에 필요한 서비스는 유지한다. 제외는 다음 시작에 적용되며 기존 이미지·DB volume 삭제를 뜻하지 않는다. 이미 실행 중인 공유 환경을 설정 적용 목적으로 임의로 중단하지 않는다.

디스크가 부족하면 `docker system df`로 이미지·컨테이너·volume 사용량을 먼저 확인한다. 사용 중인 이미지는 프로젝트 사이에 공유되므로 정리 대상에서 제외한다. 정리는 소유권과 보존 필요성을 확인한 자신의 시험 산출물·캐시에 한정하며 실패 증거는 먼저 보존한다. DB volume과 다른 작업의 자료는 유지한다. Native 실행이나 다른 컨테이너 엔진으로의 전환은 고정 CLI·실행 수명주기·데이터 경로 호환성을 별도 검증한 뒤 도입한다.

- 시작 전 Docker 메모리 할당·현재 사용량과 실행 중인 프로젝트를 확인한다. worktree별 서비스 격리는 메모리 격리를 뜻하지 않는다. 자원이 부족하면 자신이 소유한 불필요한 실행만 정리하거나 검사 범위를 나눈다.
- 실제 API E2E와 격리 화면 E2E 등 무거운 검사 묶음은 같은 컴퓨터에서도 순차 실행한다. 자원 부족을 경험한 환경에서는 격리 화면 검사도 `--workers=1`로 실행한다. 별도 포트·DB만으로 병렬 실행을 허용하지 않으며, 병렬화가 필요하면 메모리 여유와 각 실행의 최대 사용량을 먼저 확인한다.
- OOM·CPU 제한 종료 또는 함수 서버 중단이 나타나면 해당 검사 실행을 중단한다. 정확한 컨테이너 ID의 `State.OOMKilled`·종료 코드, 함수 로그와 당시 자원 사용량을 재시도 전에 보존한다. 종료 코드 137만으로 OOM을 확정하지 않으며 CPU 제한 종료와 컨테이너 OOM을 구분한다. 인증·통신 실패가 서버 중단의 후속 증상인지 확인한다.
- 정책·동시 실행·자원을 조정한 뒤 자신이 소유한 함수 실행만 재시작한다. DB·volume·다른 작업의 컨테이너는 보존한다. 준비 상태와 관련 단일 시나리오를 확인한 뒤 중단되거나 실패한 범위부터 이어간다. 환경 중단 이후의 실패는 제품 버그로 확정하거나 전체 테스트 통과로 기록하지 않는다.

2026-10-14 기존 함수 컨테이너에서 `OOMKilled=true`, 종료 코드 137을 확인했다. 후속 검증은 독립 프로젝트의 `oneshot` 정책에서 무거운 검사 묶음을 순차 실행했다. 이는 재발 위험을 줄이는 기준이며, 정책만이 OOM의 원인이었다거나 메모리 부족을 완전히 방지한다는 증거는 아니다.

## 공유 환경과 테스트 자료

별도 worktree만으로 DB·계정·포트·서비스가 분리되지 않는다. 같은 로컬 Supabase를 쓰는 setup·migration·DB/HTTP/MCP/E2E 검사는 직렬로 실행한다. 서버의 hot reload도 실행 중인 검사의 코드를 바꿀 수 있다. 병렬 실행에는 서비스·설정·자료·정리 대상까지 분리된 환경이 필요하다.

테스트 자료는 실행별로 식별하며 정리는 해당 실행이 생성한 자료에 한정한다. 다른 작업이 소유한 서버·컨테이너·자료를 정리하지 않는다. 운영 DB를 격리 테스트로 사용하지 않는다. 적용된 migration 변경은 후속 migration으로 전달한다.

`.env*`·서명 키·개인 설정·시험 계정 값은 Git에 포함하지 않는다. 생성 값이나 인증 정보를 증거에 출력하지 않는다. 초기화와 설정 생성의 보존 동작은 관련 스크립트의 테스트가 확인한다.

## 검사 도구의 한계

문서 검사기는 UTF-8·BOM·LF·공백·상대 파일 링크와 Claude 연결 파일의 원본 frontmatter를 확인한다. Markdown·HTML의 앵커 존재는 확인하지 않으므로 변경한 앵커는 대상 제목이나 HTML id와 대조한다.

[변경 영향 분류기](../../scripts/ci-impact.mjs)는 실제 diff로 정적 검사·빌드 범위를 선택한다. 알 수 없는 변경과 `workflow_dispatch`는 전체 정적 검사·빌드를 실행하며, 필수 상태는 `check` 하나다. 문서 변경은 문서·공백 검사, 웹 변경은 문서·공백·의존 경계·타입 검사·빌드, 서버·공유 계약·설정·알 수 없는 변경은 여기에 Deno 타입·lint·format 검사를 포함한다.

2026-10-14 사용자 지시로 Actions 잔량이 부족한 동안 서버 CI의 테스트 실행을 모두 중단한다. 웹·core·스크립트·임베딩 평가기 단위 테스트와 DB·HTTP·MCP 통합 테스트를 workflow에서 제거하며, Supabase·함수 서버도 CI에서 준비하지 않는다. `check:docs`에는 스크립트 테스트가 포함되어 있으므로 CI는 `node scripts/check-docs.mjs`로 문서 검사만 실행한다. 로컬 테스트 명령과 아래의 E2E 판단·증거 기준은 유지한다. CI 성공은 테스트 통과를 뜻하지 않으며, 머지 전에 변경에 맞는 로컬 테스트 결과를 이슈 또는 PR에 기록한다. 테스트 재개는 사용자 합의 후 별도 변경으로 진행한다.

Draft PR은 `check`를 생략하고 관련 로컬 검사로 개발한다. 리뷰 준비 완료로 전환하면 정적 검사·빌드 CI가 실행되며, 이후 새 커밋에도 최신 변경을 검증한다. 같은 PR의 이전 실행은 자동 취소하고, Draft로 되돌릴 때도 진행 중 검사를 취소한다. main 푸시와 수동 실행은 유지한다. 개발 중 관련 로컬 검사와 독립 리뷰를 끝낸 후 리뷰 준비 완료로 전환해 불필요한 CI 재실행을 줄인다. 검사 실패가 없고 코드가 바뀌지 않았다면 관행적으로 수동 재실행하지 않는다. Draft의 skipped 결과와 취소된 실행은 머지 검증 증거가 아니며, 머지할 최신 변경의 실제 CI 성공을 확인한다.

## 검사 명령의 범위와 선택

명령은 검사 종류별로 선택한다. 원본 스킬의 구현 종료 시 전체 테스트는 프로젝트의 검사 범위를 확인한 뒤 적용하며, 이름에 `all`이 있다고 모든 종류의 검사를 포함하는 것으로 해석하지 않는다.

| 명령 | 실제 포함 범위 | 선택 시점 |
| --- | --- | --- |
| `npm run check:docs` | 문서·링크·텍스트 형식과 스크립트 단위 검사 | 문서·개발 도구 변경 |
| `npm run check:boundaries` | contracts·core·웹의 의존 경계 | 코드 의존성 변경 |
| `npm run check:deno` | 서버 타입·lint·format | 서버 코드 변경 |
| `npm run build` | 웹 타입 검사와 빌드 | 웹·공유 계약 변경 |
| `npm run test:fast` | core·빠른 어댑터·웹 단위 검사 전체; 실제 서비스 없음 | 구현 종료 시 빠른 회귀 검사 |
| `npm run test:db` / `test:http` / `test:mcp` | 각각 실제 DB·HTTP·MCP 계약 | 관련 저장·권한·진입점 변경 |
| `npm run test:integration:local` | core·실제 DB·HTTP·MCP·기본 실제 API E2E; 웹 단위·격리 화면 설정 전체는 제외 | 준비된 로컬 환경에서 이 범위 전체가 필요할 때 |
| `npm run test:e2e -- <spec> --project=<project>` | 기본 Playwright 설정의 선택한 파일·프로젝트; fixture는 해당 `--config` 필요 | 관련 사용자 흐름의 개발·회귀 확인 |
| `npm run test:e2e:all` | 기본 실제 API와 각 격리 화면 설정; DB·HTTP·MCP·웹 단위 검사는 제외 | 스펙 통합 뒤 브라우저 영향이 넓거나 불확실할 때 |

개발 중에는 관련 단일 검사부터 실행한다. 개별 PR의 변경에 맞는 로컬 검사와 CI, 스펙 통합 후 브라우저 범위 판단은 서로 구분한다. `test:integration:local`에는 기본 E2E가 포함되므로 개별 PR마다 관행적으로 실행하는 명령으로 사용하지 않는다. E2E를 제외한 실제 계약 검사가 필요하면 DB·HTTP·MCP 명령을 선택한다. 검사 로그에는 실제 실행한 명령과 포함 범위를 기록한다.

## 웹·E2E 코드의 국소 포맷팅

웹 TS/TSX와 브라우저 검사는 package.json·lockfile에 고정된 Deno formatter를 사용한다. `--no-config --line-width 120`으로 서버 설정·사용자 설정의 자동 탐색과 구분하고, 기본 2칸 들여쓰기·큰따옴표·세미콜론 스타일을 따른다. formatter는 한 import 안의 이름 순서를 정렬하고 필요한 제어문 중괄호도 배치한다. 별도 formatter 의존성이나 저장소 전체 재포맷을 추가할 필요는 없다.

바꾸는 파일을 명시해 실행하고 같은 인자에 `--check`를 더해 재검사한다. 예를 들어 목록 표현과 관련 화면 검사만 고르면 다음과 같다.

```sh
npm exec -- deno fmt --no-config --line-width 120 src/components/Collection.tsx e2e/workspace-screens.responsive-layout.fixture.ts
npm exec -- deno fmt --no-config --line-width 120 --check src/components/Collection.tsx e2e/workspace-screens.responsive-layout.fixture.ts
```

포맷팅은 필요한 구역으로 제한하고 동작 수정과 다른 변경으로 검토한다. 문자열·JSX 표시 내용·테스트 의미를 보존하며, 대상 코드의 타입·빌드·관련 단위 검사와 E2E 발견 목록을 확인한다. 브라우저 실행은 아래의 스펙 통합 기준을 따른다. 검색 결과와 변경 hunk에서 필요한 조작을 찾아 읽기 쉬워졌는지 확인하며, 줄 수나 텍스트 크기의 변화는 실제 토큰 절감 측정과 구분한다.

## 로컬 E2E 실행 기준

브라우저 E2E의 기본 판단 단위는 스펙이다. 개별 PR에서는 변경에 맞는 로컬 검사와 CI를 수행하며, E2E는 스펙의 전체 변경이 통합된 상태에서 검토한다. 통합은 모든 구현 변경이 한 checkout에 합쳐진 상태를 뜻하며 개별 PR의 머지 여부만으로 판단하지 않는다. 스펙 없이 진행하는 단독 PR은 하나의 완료 단위로 취급한다.

스펙 완료를 선언하거나 이슈를 닫기 전에 E2E 필요 여부와 범위를 반드시 검토한다. 범위는 마지막 PR만이 아니라 해당 스펙의 모든 PR 변경을 합산해 결정한다.

- 브라우저 동작에 영향이 없으면 E2E를 생략하고 근거를 기록한다.
- 영향이 명확하면 변경된 사용자 흐름을 검증하는 관련 파일·프로젝트를 실행한다. 화면·탐색·로그인·OAuth 동의·웹/MCP 왕복 등 테스트 내용과 실제 호출 경로를 대조해 선택한다. 실제 인증·저장·API 연결에 영향을 주면 해당 실제 API E2E도 포함한다.
- 공통 변경으로 영향이 넓거나 범위가 불확실하면 전체 브라우저 검사를 실행한다.

검토 근거·실행 revision·명령·범위·결과·미검증 범위는 스펙 이슈에 기록한다. 단독 PR은 연결된 이슈에 기록하며 이슈가 없으면 PR에 남긴다. 검증 이후 관련 변경이 추가되면 기존 검증에 미치는 영향을 검토해 재실행 여부와 범위를 결정한다. CI 성공은 브라우저 검증을 뜻하지 않는다.

로컬 Supabase·함수 서버를 준비하고 Chromium을 설치한 뒤 `npm run test:e2e -- e2e/web-mcp.spec.ts --project=desktop`처럼 실행한다. 전체 브라우저 검사는 `npm run test:e2e:all`로 실제 API와 각 격리 화면 설정을 순서대로 실행한다. 설정별 소요 시간도 마지막 표에 표시한다. 로컬 통합 묶음 `npm run test:integration:local`은 실제 API E2E도 포함하며, 웹 단위·격리 화면 전체 검사를 대신하지 않는다. 실제 Pinecone 검사는 API 키가 있는 환경에서 `RUN_PINECONE_E2E=1`로 별도 실행한다.

빠른 core·웹·어댑터 검사는 실제 DB·OAuth·브라우저 연결의 증거를 대신하지 않는다. 제품의 권한·일관성·웹/MCP 행동은 관련 [계약](../../supabase/functions/_shared/contracts/search.ts)과 실제 진입점의 테스트에서 확인한다. 제품 플러그인의 정적 패키지 검사는 실제 Claude·Codex 사용과 구분한다([제품 행동 검증 도구](../../experiments/plugin-behavior/README.md)).

Playwright 결과·trace와 서비스 로그는 다음 실행으로 덮어써질 수 있다. 필요한 실패 증거는 저장소 밖의 실행별 위치에 보존한다. 검증 결과와 실행할 수 없었던 범위는 해당 GitHub 이슈·PR에서 확인한다.


### 격리 브라우저 검사의 실행 범위

실제 계정·DB를 쓰는 `playwright.config.ts`는 worker 1개로 실행한다. 페이지/브라우저 context별로 Auth·API 응답과 자료를 격리한 설정은 `fullyParallel`과 worker 3개를 사용한다. 설정 사이의 실행은 계속 순차적이다. collection과 principle, activity와 screens처럼 Vite 포트를 공유하는 설정을 동시에 시작하지 않는다.

| 설정 | 소유하는 검사와 변이 |
| --- | --- |
| collection-fixture | 목록 화면 + pagination·긴 속성 조건 fragment의 HTML 직접 주소/새로고침/이력/타입 초기화/앵커 desktop/mobile 연결 검사; 실제 250페이지 복원 상한은 desktop에서 한 번 확인 |
| detail-workspace | 상세 작업 공간과 표시 배율 |
| entity-tags-fixtures | 자료·태그 desktop/mobile |
| principle-current | 현재 원칙 desktop/mobile |
| activity | 활동 desktop/mobile 서울 시간대 + desktop UTC 날짜 변이 |
| navigation-fixture | 탐색·프로필 desktop, OAuth 동의 desktop/mobile |
| navigation-preferences | 개인 메뉴 Auth metadata·미리보기·취소·충돌·overflow desktop/mobile |
| type-navigation | 자료 종류별 탐색·작성·설정·기본 메뉴의 격리 desktop/mobile |
| typed-entity-consumers | 타입별 목록 열·AND 필터·템플릿 변수 삽입·첫 삭제 식별자 복원의 보관값/태그 보존 desktop/mobile |
| schema-editor-read | 속성 변경안 공개 화면의 지연 조회·조회 실패·초안·저장 결과·복구안 desktop/mobile |
| material-schema | 통합 자료 설정의 속성 행·검토·변환·작업·복구와 기존 직접 주소 desktop/mobile |
| material-templates | 자료 종류별 고정 기본 문구·독립 저장·충돌·재시도·일반 설정 태그 진입/복귀 desktop/mobile |
| schema-job-history | 값 변환 작업 공개 목록의 20개 초과 이력·자동 갱신·겹친 응답·더 보기 재시도·종류 전환 desktop/mobile |
| design-samples | 인증·API 없이 공용 디자인 사례와 미리보기 폭 전환·입력/확인/실패 상태 desktop/mobile |
| workspace-screens | [사용자 흐름별 작업 공간 화면 검사](../../e2e/workspace-screens.md)만 실행 |

페이지 읽기의 상한·취소·실패 규칙은 `paged-list.test.ts`에서 검증한다. `pagination-fixture.spec.ts`는 실제 앱에서 URL 복원·누적 행·재시도 cursor·초점·읽던 위치·필터 초기화를 확인한다. 대량 모의 목록 때문에 실제 로그인 검사를 반복하지 않는다. 실제 API의 로그인·저장·웹/MCP 왕복 검사는 기본 설정에 남긴다.

전체 실행의 실제 API 설정은 `node scripts/test-e2e-all.mjs --actual-config /절대/격리/playwright.config.mjs`로 교체할 수 있다. 첫 설정만 교체하며 나머지 열다섯 개 fixture 설정은 등록 순서대로 실행한다. 별도 DB·worker 설정은 실행 환경의 명시 설정으로 유지하고 tracked 설정 파일이나 개인 환경 파일을 고치지 않는다. 상세 정리·운영 범위는 [데모 자료 정리](../operations/demo-cleanup.md)를 따른다.

구 고정 속성 표현의 보존·거부 분류와 현재 fixture 계약은 [전환 검사](typed-fixture-transition.md)에 있다.

실제 API 검사의 `e2e/support.ts` 자동 fixture는 각 test의 새 자료 종류·업무 자료 ID와 요청 키를 소유자별로 추적한다. MCP 연결을 먼저 닫아도 자료는 화면 검사와 `afterEach`가 끝날 때까지 유지한다. 마지막에는 브라우저 context와 MCP 연결을 닫고, 도입한 종류의 현재·역사 참조와 검색 queue/state를 명시 manifest의 dry-run digest로 정리한다. Auth 사용자·OAuth 연결·다른 소유자·기존 종류·무관한 설정은 보존한다. 종류별 템플릿은 해당 종류의 명시 action 경로만 제거한다. 설정 도중 실패해도 성공한 요청 receipt로 도입 ID를 회수하며, 실패한 설정을 정리하는 동안 원래 테스트의 종류 ID를 가정하지 않는다.

이 정리는 worker 1개인 loopback 실제 설정에서만 허용한다. `ENTITY_SCHEMA_WORKER_CONFIG`가 가리키는 Supabase 설정의 API·직접 DB 포트가 환경 파일과 일치해야 하며, fixture는 그 환경/소유자/개수/잔여 행만 결과에 첨부한다. 정리 정책의 서비스 없는 검사는 `node --test scripts/actual-fixture-cleanup.test.mjs scripts/demo-cleanup.test.mjs`다. 실제 격리 DB의 소유자·같은 ID·검색 재큐잉 회귀는 실행 lease 안에서 `LOCAL_DB_URL`을 그 DB로 지정하고 `node --test scripts/actual-fixture-cleanup.integration.mjs`로 별도 실행한다. 테스트가 만든 두 임시 Auth 사용자는 해당 통합 검사 자체의 finally에서만 제거한다.
