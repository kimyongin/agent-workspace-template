# 프로젝트 실행 환경

명령과 도구 버전의 정본은 [package.json](../../package.json)과 [CI](../../.github/workflows/ci.yml)다. 환경 설정은 [supabase/config.toml](../../supabase/config.toml), [Vite](../../vite.config.ts), [Playwright](../../playwright.config.ts), [.env.example](../../.env.example)에서 확인한다. 개발·테스트 방법은 Matt 원본 스킬이 정한다.

## 로컬 서비스와 데이터

Node·Deno·Supabase CLI 버전과 설치 명령은 package.json·lockfile을 따른다. 로컬 Supabase에는 Docker가 필요하다. 함수 서버와 웹 서버의 실행 대상은 환경 파일에서 확인한다. 웹을 로컬에서 열었다고 DB도 로컬인 것은 아니다.



기존 로컬 stack을 다른 checkout/worktree에서 재사용할 때는 함수 실행 전에 `supabase/signing_keys.json`의 공개 `kid`가 해당 Auth의 `/auth/v1/.well-known/jwks.json`과 일치하는지 확인한다. 같은 project_id라도 checkout의 무시 파일은 서로 다를 수 있으며, CLI가 다른 JWKS를 함수에 주입하면 Auth 로그인은 성공하고 업무 API만 401을 반환한다. DB·사용자·서명키를 재생성하지 말고 실행 설정을 기존 stack에 맞춘다. 비밀키·토큰은 출력하지 않고 기존 파일은 비공개 백업으로 보존한다. 로컬 Google provider가 비활성화된 경우 `.env.local`의 준비된 개발 계정으로 로그인한다.

`setup:local`은 키·개발 계정·환경 파일을 준비하며 기존 생성 값과 사용자 설정을 보존한다. `test:integration:local`은 설정된 함수 서버를 먼저 관찰한다. 준비된 기존 실행은 재사용하고, 준비 중이면 최대 2분 기다리며 준비 실패 시 중단한다. 기존 실행에서는 setup·migration·환경 파일 갱신을 하지 않으므로 검사에 필요한 로컬 환경은 먼저 준비되어 있어야 한다. 명령의 실제 동작은 [검사 실행](../../scripts/test-local-integration.mjs)과 [수명주기 module](../../scripts/local-runtime.mjs)이 소유한다.

함수 실행이 없을 때만 Edge runtime을 제외한 setup 후 다시 관찰하고 직접 함수를 실행한다. setup 중 독립적으로 나타난 실행은 빌려 쓰며 제거하지 않는다. 직접 실행할 때는 기본 환경 파일을 수정하지 않고 개인 임시 환경 파일에 실행별 nonce를 추가한다. 정확한 컨테이너 ID·실제 functions bind source·Docker 환경의 nonce가 모두 일치해야 정리를 허용한다. 생성 시각이나 동일 source만으로 소유권을 추정하지 않는다. 실행 직전에도 다시 관찰하며, nonce가 없거나 ID가 바뀌면 중단하고 컨테이너를 보존한다. 검사 종료·실패·SIGINT/SIGTERM에는 직접 만든 자식 프로세스 트리를 강제 종료하고 증명한 컨테이너 ID만 정리하며 DB·volume과 기존 실행을 정리하지 않는다. project 이름만으로 정리하지 않는다. 다른 터미널이 같은 project의 Supabase CLI를 직접 실행하는 경우 CLI 자체의 이름 기반 교체와 시작 시점 경쟁까지 원자적으로 막지는 못하므로 같은 project에서 동시에 시작하지 않는다.

Docker의 `created`·`restarting`은 아직 실행 중이 아니어도 준비 중으로 관찰한다. `Running=false`만으로 시작 실패를 판단하지 않으며 `exited`·`dead`와 구분한다. 준비 대기는 기존 기한 안에서만 수행하고 실제 API 준비 응답과 소유권 증거가 모두 확인된 뒤 검사를 시작한다.

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

발급처 초기 migration의 업그레이드 경로는 `LOCAL_DB_URL`을 설정하고 `node --test scripts/entity-issuer-upgrade.integration.mjs`로 확인한다. 기존 로컬 PostgreSQL 서버에 새 임시 DB를 만들어 빈 저장소와 기존 자료 종류·발급처 설정이 있는 저장소에 실제 migration을 적용하고 RLS·소유자별 연결·기존 자료 보존·FK 거부를 확인한다. 기존 DB는 수정하지 않고 검사에서 만든 임시 DB만 종료 시 제거한다. 새 Supabase 스택은 필요하지 않다.

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
| `npm run test:full` | core·빠른 어댑터·웹·스크립트·서비스 없는 실험 단위·실제 DB/HTTP/MCP·실제 API E2E·등록 격리 화면을 각 한 번 순차 실행 | 스펙 통합 뒤 이 전체 범위가 필요할 때; 먼저 `-- --plan`으로 확인 |
| `npm run test:fast` | core·빠른 어댑터·웹 단위 검사 전체; 실제 서비스 없음 | 구현 종료 시 빠른 회귀 검사 |
| `npm run test:db` / `test:http` / `test:mcp` | 각각 실제 DB·HTTP·MCP 계약 | 관련 저장·권한·진입점 변경 |
| `npm run test:integration:local` | core·실제 DB·HTTP·MCP·기본 실제 API E2E; 웹 단위·격리 화면 설정 전체는 제외 | 준비된 로컬 환경에서 이 범위 전체가 필요할 때 |
| `npm run test:e2e -- <spec> --project=<project>` | 기본 Playwright 설정의 선택한 파일·프로젝트; fixture는 해당 `--config` 필요 | 관련 사용자 흐름의 개발·회귀 확인 |
| `npm run test:e2e:all` | 기본 실제 API와 각 격리 화면 설정; DB·HTTP·MCP·웹 단위 검사는 제외 | 스펙 통합 뒤 브라우저 영향이 넓거나 불확실할 때 |

개발 중에는 관련 단일 검사부터 실행한다. 개별 PR의 변경에 맞는 로컬 검사와 CI, 스펙 통합 후 브라우저 범위 판단은 서로 구분한다. `test:integration:local`에는 기본 E2E가 포함되므로 개별 PR마다 관행적으로 실행하는 명령으로 사용하지 않는다. E2E를 제외한 실제 계약 검사가 필요하면 DB·HTTP·MCP 명령을 선택한다. 검사 로그에는 실제 실행한 명령과 포함 범위를 기록한다.

### 중복 없는 전체 실행과 선택 실행

`npm run test:full -- --plan`은 실행할 단계·명령·실제 설정의 범위·별도 선택 대상을 JSON으로 출력한다. 계획에서는 setup·migration·서버 시작·런타임 lease·DB/네트워크 접속을 하지 않는다. `--actual-config /절대/격리/playwright.config.ts`는 기존 파일만 허용하며 잘못된 경로나 옵션은 서비스 관찰 전에 거절한다. 별도 이미 준비한 runtime은 `--runtime-config /절대/runtime/supabase/config.toml --env-file /절대/runtime/.env.local`을 함께 지정한다. 이때 API origin·경로, 직접 DB·풀러 포트와 guard 경로를 서비스 관찰 전에 대조하고 비밀값은 출력하지 않는다. DB/HTTP/MCP는 그 환경 파일 하나만 사용하며 checkout의 `.env.local`을 fallback으로 읽지 않는다. 선택한 runtime이 없으면 setup·서버 시작 없이 실패하며 기존 실행의 준비 대기·lease·비소유 정리 금지는 유지한다. 브라우저 actual도 선택하면 해당 runtime에 맞춘 `--actual-config`가 필수다. `WORKSPACE_E2E_OWNERSHIP`·source revision 등 기존 실제 fixture의 소유권 guard는 계속 별도로 준비한다.

`npm run test:full`은 core → 빠른 어댑터 → 웹 → 개발 스크립트 단위 → 임베딩 평가기 단위 → 제품 플러그인 실험 가드 단위 → 실제 DB·HTTP·MCP·API E2E → 등록된 격리 화면 순서로 실행한다. core를 포함한 `test:fast`와 core/실제 E2E를 포함한 `test:integration:local`, 실제 E2E를 포함한 `test:e2e:all`을 다시 중첩 호출하지 않는다. 기존 개별 명령의 포함 범위는 그대로다. 실제 구간은 기존 함수 수명주기의 관찰·재사용·소유권 증명·lease·정리를 한 번 사용하며 격리 화면과 순차 실행한다.

개발 중에는 `npm run test:full -- --only core,web,scripts`처럼 선택한다. 가능한 범위는 `core,adapters,web,scripts,embedding,guards,db,http,mcp,actual,fixtures`이며 `fixture:e2e/collection-fixture.config.ts`처럼 등록 설정 하나도 선택할 수 있다. `--only`는 실행 계획에서 범위를 고르는 옵션으로, 개별 검사 내부의 파일·프로젝트 선택은 기존 명령을 사용한다. 선택한 범위만 실행한 결과를 전체 green으로 기록하지 않는다.

| inventory | 포함·별도 선택과 실제 명령 |
| --- | --- |
| 개발 스크립트 | 기본 포함: `node --test "scripts/*.test.mjs"`; 문서 검사 자체는 별도 `check:docs` |
| 임베딩 평가기 | 기본 포함: `node --test experiments/t02-3-embedding/evaluate.test.mjs`; 공급자 호출 없이 저장된 평가 입력의 계산 경계 확인 |
| 제품 플러그인 실험 가드 | 기본 포함: `node --test "experiments/plugin-behavior/*.test.mjs"`; 실제 CLI나 업무 서비스 trial과 구분 |
| 실제 API 기본 | `playwright.config.ts`의 `*.spec.ts`; 추가 `*.actual.ts` 다섯 시나리오를 포함한다고 표시하지 않음 |
| 최종 통합 실제 API | 명시 선택: `--actual-config /절대/checkout/e2e/workspace-full-actual.config.ts`; 기본 실제 spec과 모델·태그·활동·할 일 조회 권한·검색/상태 actual 포함. 선택한 실행 환경의 guard 설정도 필요 |
| 격리 화면 | `scripts/e2e-run-plan.mjs`의 전체 fixture registry가 정본. 기준 revision은 24개이며 이름·순서는 계획에서 확인; 개수 고정만으로 누락을 판단하지 않음 |
| 별도 브라우저 설정 | 기능별 `workspace-*-actual`은 최종 실제 설정에 합쳐지고, `fin-integration`·`workspace-integration`은 실제 설정 교체용 wrapper. 과거 `workspace-navigation`의 탐색 fixture는 등록 `navigation-fixture`가 실행하므로 wrapper 자체를 추가 실행하지 않음 |
| 외부 trial | 기본 제외: [실험 inventory](../../experiments/README.md)의 실제 DB 실험 `npm --prefix experiments/t02-1 run exp1`, 임베딩 공급자 `npm --prefix experiments/t02-3-embedding run evaluate`, 실제 CLI `node experiments/plugin-behavior/run-client.mjs <client> <owned-fixture.json> <scenario>`. 각 실험의 준비·소유권·정리 절차를 별도로 따름 |
| Pinecone·정적 검사 | 유료 공급자 `RUN_PINECONE_E2E=1 npm run test:e2e`는 명시 opt-in. 문서·타입·lint·format·의존 경계·빌드는 별도이며 CI의 정적 검사 범위는 변경하지 않음 |

일반 검사 실패 뒤에는 독립 단계를 계속하고 원래 단계 종료 코드를 결과에 보존한다. 환경 준비·런타임 유실·자식 실행/정리·lease 정리 실패 뒤에는 남은 단계를 이유와 함께 미실행으로 남긴다. SIGINT/SIGTERM은 소유한 자식과 증명된 런타임만 정리한 뒤 각각 130/143으로 끝난다. 전체 합산 종료는 성공 0·실패 1·중단 130/143이며 하위 검사의 원래 종료 코드와 구분한다. 기본 실제 설정과 교체 경로는 실행 전 계획에 남고 결과는 같은 단계 ID로 연결된다.

### 시간·자원 보고서와 기준 실행

`test:full`, `test:integration:local`, `test:e2e:all`은 기존 콘솔 요약과 함께 실행별 임시 외부 디렉터리의 `report.json` 경로를 출력한다. 기존 보고서를 덮어쓰지 않는다. `test:full`은 `--report /절대/checkout밖/새보고서.json`, 브라우저 worker의 명시 override `--workers 1`, 캐시 조건 `--cache-state cold|warm|unspecified`를 받는다. 실제 API 브라우저(`actual`)를 포함한 계획은 worker 1개만 허용하며 그 이상의 override는 서비스 관찰 전에 거절한다. 격리 화면만 선택하면 각 설정의 격리·자원 기준 안에서 더 큰 worker 수를 명시할 수 있다. `--plan`은 보고서 파일·실행 시간·성공 수를 만들지 않는다. 발견 목록은 실제 실행 결과가 아니다.

보고서 schema 2는 실행 checkout의 `runnerRevision`·`runnerTrackedChanges`와 명령·선택 단계/설정·명시 worker 수·Node/OS·cold/warm 선언을 기록한다. 실제 서비스가 필요한 보고서는 별도 `serviceSource`에 revision 미확인(null)과 경고를 남긴다. 관찰된 functions bind의 runner 경로 일치 여부는 보존하지만 경로·컨테이너·소유권 nonce 일치나 호출자 환경 선언을 서비스 revision의 증명으로 승격하지 않는다. 같은 소스의 성능 비교에는 독립적으로 검증한 서비스 provenance가 추가로 필요하며, 준비된 다른 runtime의 유효한 재사용을 이 이유로 거절하지 않는다. 기존 schema 1 보고서의 `metadata.revision`은 runner checkout만 의미하며 서비스 소스를 증명하지 않는다.

worker override가 없으면 설정이 소유하는 수를 관찰하지 못했다고 표시한다. cold/warm은 호출자가 선언하며 runner는 의존성·브라우저·빌드 캐시나 DB를 초기화하지 않는다. warm 기준은 기존 캐시를 보존하되 명령 자식을 새로 시작하는 조건이다. 격리 브라우저는 Vite를 새로 시작하고 실제 API는 준비된 runtime을 빌려 쓸 수 있으므로 해당 runtime mode를 함께 읽는다. 보고서의 단계 성공은 명령 종료 0이며 개별 테스트 개수는 콘솔/Playwright 증거와 별도로 대조한다. 원문 stdout·환경 파일 내용·프로세스 명령줄은 수집하지 않는다.

전체 `elapsedMs`는 실행 루프를 직접 잰다. 전체 실행의 옵션/환경 사전 검증·metadata 생성·보고서 쓰기는 이 시간에서 제외한다. 실제 런타임의 준비(관찰·setup·서버 시작·ready 대기), 검사(명령과 후속 ready 관찰), 정리 시간을 나누며 lease 획득/해제는 별도다. 이 중첩 시간들을 전체 경과 시간으로 다시 합산하지 않는다. 브라우저 설정별 명령 시간은 Vite 준비·발견·검사·정리를 모두 포함하며 현재 경계에서 각 시간을 나누지 못한다. 준비 비용을 분리 관찰한 것으로 표시하지 않는다.

명령마다 즉시 및 1000ms 간격으로 PID/PPID/RSS만 읽어 당시 자식 프로세스 트리의 RSS 합계(KiB)와 호스트 free 메모리(bytes)를 표본으로 보존한다. 같은 시점의 합계 중 최대값이며 프로세스별 최대값을 합한 값이 아니다. 공유 페이지 중복·표본 사이 순간 peak·재부모화된 자식·Docker VM/컨테이너 메모리는 포함 범위의 한계다. 수집 실패/미지원은 실패 수와 null로 남으며 0 사용량으로 취급하지 않는다. 수집 호출 비용은 명령 시간에 포함된다. 호스트 free는 사용 가능 용량 보장이 아니므로 다른 실행의 영향을 함께 기록한다. 실제 서버는 관찰한 정확한 ID·running/status·OOMKilled·exit code를 기록하며 관찰 실패를 정상 서버 상태로 만들지 않는다.

보고서 저장 실패는 원래 결과를 stderr에 안전한 구조로 남긴다. 원래 실패·중단 종료 코드는 보존하며 검사가 성공했어도 보고서를 저장하지 못하면 최종 실패로 끝난다. 실제 API와 격리 브라우저의 기준 실행은 같은 revision·검사 범위·worker·캐시 조건·환경에서 순차 수행한다. 미준비 실제 API나 이미 알려진 MCP 503, 자원 중단과 모의 실행기 검사를 전체 실제 green 또는 성능 개선률로 합산하지 않는다. #546·#547·#548 최적화의 기준은 해당 시나리오를 실제로 실행한 보고서와 브라우저 증거다.

### 호환 모의 화면의 웹 서버 공유 (#547)

`test:full`과 `test:e2e:all`은 아래 대상 중 두 개 이상을 선택하면 `settings-model` 그룹으로 모아 웹 서버를 한 번 준비하고 설정별 Playwright 프로세스를 순차 실행한다. 전체 계획에서는 자료 모델 설정이 다른 두 대상 바로 뒤로 이동하며, 각 설정 ID·결과·산출물은 유지된다. 한 설정만 선택하거나 기존 `test:e2e -- --config ... [파일]` 명령을 쓰면 원래 설정의 독립 웹 서버 준비를 유지한다.

| 비교 항목 | 자료 기본 문구 (`material-templates`) | 발급처 설정 (`issuer-settings`) | 전체 자료 모델 (`data-model`) |
| --- | --- | --- | --- |
| 앱 / 모의 API·Auth | 모두 `127.0.0.1:56883` / `127.0.0.1:56884`, `/api` | 같음 | 같음 |
| 앱 환경 | 공개 `fixture-public-key`, `VITE_DEV_LOGIN=true` | 같음 | 같음 |
| 요청·저장 상태 | 매 테스트 `page.route`·`addInitScript`; Auth 토큰과 변경 응답은 해당 context에만 존재 | 테스트별 설정 함수의 발급처·번호·receipt Map·쓰기 목록 | 매 테스트 route/Auth; 각 테스트의 모델 변경 응답 |
| 브라우저 격리 | Playwright 기본 새 context/page·localStorage; 공유 storageState 없음 | 같음 | 같음 |
| 프로젝트 | Desktop Chrome / Pixel 7, mobile 320×568 | 같음 | desktop만 1440×1000, mobile은 같음 |
| 기존 실행 정책 | fullyParallel=true, workers=2 | fullyParallel=false, workers=1 | fullyParallel=true, workers=2 |
| 독립 서버 명령 | npm dev, 기존 cwd 유지 | npm dev, 기존 cwd 유지 | 명시 repo cwd + 직접 Vite 명령 유지 |
| 산출물 | `e2e/test-results/material-templates` | `e2e/test-results/issuer-settings` | `e2e/test-results/data-model` |

주소 일치 외에도 각 fixture의 모든 요청 route와 Auth 초기화, 테스트별 변경 상태를 대조했다. 같은 앱 origin만 실제 웹 서버로 보내며, 모의 API 경로는 route가 응답하고 그 밖의 외부 요청은 abort한다. 브라우저 context나 모의 저장 상태를 서버에 옮기지 않는다. 실제 API, 운영 build·하위 경로, 다른 포트/환경의 나머지 설정은 그룹 밖에 둔다. worker 수나 프로젝트를 통합 설정으로 덮어쓰지 않는다.

공유 실행기는 고정된 개발 서버를 정확한 자식 프로세스로 만들고, strict port listen 및 HTTP 준비 후 해당 자식의 IPC 응답으로 준비 완료를 확인한다. 모르는 서버를 채택하는 `reuseExistingServer`는 사용하지 않는다. 포트용 배타 lease를 얻은 실행만 시작하며, 실패·중단·정리에서도 그 실행의 프로세스 그룹과 lease만 다룬다. 살아 있는 소유 자식의 PID를 해당 세 설정의 검사 프로세스에만 전달하고 그 범위에서 Playwright의 별도 서버 시작을 생략한다. 이 내부 handoff 환경변수를 단독 명령에 직접 설정하지 않는다.

구조화 보고서의 `fixtureWebMetrics`는 그룹 준비(프로세스 생성부터 HTTP/IPC 준비까지), 검사, 정리, 전체 시간을 기록한다. 준비 종료 코드·신호·중단/timeout 여부는 `preparationFailure`로 보존하며, 준비 실패와 겹친 자식·표본·lease 정리 오류는 각각 별도 phase로 남긴다. 자식 stop이 실패해도 표본 정리와 정확한 lease 해제를 시도한다. `cleanup`의 실패 상태를 정리 완료로 바꾸거나 소유권이 바뀐 lease를 지우지 않는다. 설정별 시간은 공유 Vite 준비/정리를 제외한다. 그룹 RSS는 runner와 소유 Vite 및 현재 순차 Playwright 자손을 같은 시점에 합한 KiB 표본이며 설정별 자식 RSS와 범위가 다르므로 최대값을 합산하지 않는다. 공유 페이지 중복, 표본 사이 peak, Docker/VM·재부모화 한계는 위 기준과 같다.

2026-10-22 독점 브라우저 시간에 main `3e82f99f`와 서버 공유 적용 `1adeefb9`를 순차 비교했다. 앱 `src`·공유 contracts·세 fixture 시나리오의 Git object가 동일하며, 파일/검사 이름/프로젝트 목록 118건도 정확히 일치한다. 둘 다 같은 순서(기본 문구→발급처→모델)·workers=1·warm으로 117건 통과, 의도된 mobile 폭 전환 제외 1건, 실패/재시도 0건이었다.

| 같은 검사 범위의 관측값 | 변경 전 `3e82f99f` | 변경 후 `1adeefb9` |
| --- | --- | --- |
| 소유 웹 서버 준비 횟수 | 3 | 1 |
| 전체 runner 명령 경과 시간 | 257.527초 | 256.247초 |
| 같은 외부 관찰기의 runner+Vite+Playwright 자손 RSS 표본 최대 | 2,142,544 KiB | 2,117,440 KiB |
| RSS 표본 수 / 수집 실패 | 258 / 0 | 256 / 0 |
| 서버 준비 관측 | Playwright DEBUG의 spawn 시작→HTTP 준비 완료 수신 간격 합계 1,631.324ms | lease·표본 시작·spawn·HTTP/IPC 준비를 포함한 그룹 준비 148.476ms |

한 번의 전후 쌍이므로 작은 전체 시간·RSS 차이를 일반적인 개선률이나 메모리 감소 보장으로 해석하지 않는다. 준비 관측 경계도 전후가 조금 다르므로 준비 시간의 백분율을 계산하지 않는다. 전체 runner 시간은 각 실행의 실제 서버 준비·수집·검사·정리를 포함한다. 같은 설치본의 CoW 의존성 복사, 별도 목록 수집, 공통 Geist font HTTP 200 사전 확인은 시간 범위 밖이다. warm은 기존 파일/Vite 캐시를 지우지 않았다는 뜻이며, Vite 프로세스와 브라우저/context는 새로 만든다. 공유 서버 안에서만 모듈을 유지한다. 외부 관찰기는 양쪽에 동일한 구현·root PID 범위를 적용했고, Docker/VM 메모리는 측정하지 않았다. 실제 API·운영 build/하위 경로·다른 21개 설정·cold 조건의 성능은 이 쌍으로 판단하지 않는다.

같은 검증 시간에 실제 strict port 충돌은 기존 HTTP 서버를 보존한 채 거절했고, 두 번째 소유자 거절·정확한 자식 정리·포트 해제도 확인했다. 기존 단독 설정+파일+desktop 선택 1건은 별도 서버로 통과했다. 최초 측정 도구는 npm CLI 경로 누락으로 검사 전 실패했으며, 외부 도구만 수정하고 원시 실패 근거를 별도 보존했다. 이 환경 수정은 제품 성능 개선에 포함하지 않는다. 원시 계획/수집 목록/보고서/로그/RSS 표본/완료 화면 산출물과 상세 경계는 [#547 실행 근거](https://github.com/kimyongin/agent-workspace-template/issues/547)에 기록한다. 기존 #544의 `422bb0cd` 측정이나 다른 프로토콜로 전환한 #546 검사 목록과 합산하지 않는다.

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

빈 공간의 첫 사용은 `e2e/empty-workspace-ux.spec.ts`가 매번 명시적으로 생성한 새 독점 공간에서 검사한다. 일반 실제 브라우저 검사에 포함되며 별도 opt-in이나 계정 전체가 비어 있다는 전제는 없다. 기존 계정의 Auth·개인 설정·다른 공간 자료를 보존하고, 검사 후에는 같은 실행이 만든 정확한 공간을 명시 manifest와 승인 digest로 정리한다.

빠른 core·웹·어댑터 검사는 실제 DB·OAuth·브라우저 연결의 증거를 대신하지 않는다. 제품의 권한·일관성·웹/MCP 행동은 관련 [계약](../../supabase/functions/_shared/contracts/search.ts)과 실제 진입점의 테스트에서 확인한다. 제품 플러그인의 정적 패키지 검사는 실제 Claude·Codex 사용과 구분한다([과거 제품 행동 검증 도구와 현재 계약의 제한](../../experiments/plugin-behavior/README.md)).

Playwright 결과·trace와 서비스 로그는 다음 실행으로 덮어써질 수 있다. 필요한 실패 증거는 저장소 밖의 실행별 위치에 보존한다. 검증 결과와 실행할 수 없었던 범위는 해당 GitHub 이슈·PR에서 확인한다.


### 격리 브라우저 검사의 실행 범위

공통 모달·설정 화면을 독립 data-router에서 실행하는 fixture도 실제 앱과 같은 `NavigationProtection`을 라우트 안의 공통 부모에 둔다. 라우터 차단 지점은 하나이며 각 화면의 보호 요청을 등록한다.

실제 계정·DB를 쓰는 `playwright.config.ts`는 worker 1개로 실행한다. 페이지/브라우저 context별로 Auth·API 응답과 자료를 격리한 설정은 `fullyParallel`과 worker 3개를 사용한다. 설정 사이의 실행은 계속 순차적이다. activity와 screens처럼 Vite 포트를 공유하는 설정을 동시에 시작하지 않는다.

| 설정 | 소유하는 검사와 변이 |
| --- | --- |
| collection-fixture | 목록 화면 + pagination·긴 속성 조건 fragment의 HTML 직접 주소/새로고침/이력/타입 초기화/앵커 desktop/mobile 연결 검사; 실제 250페이지 복원 상한은 desktop에서 한 번 확인 |
| detail-workspace | 상세 작업 공간과 표시 배율 |
| entity-tags-fixtures | 자료·태그 desktop/mobile |
| activity | 활동 desktop/mobile 서울 시간대 + desktop UTC 날짜 변이 |
| navigation-fixture | 탐색·프로필 desktop, OAuth 동의 desktop/mobile |
| navigation-preferences | 개인 메뉴 Auth metadata·미리보기·취소·충돌·overflow desktop/mobile |
| type-navigation | 자료 종류별 탐색·작성·설정·기본 메뉴의 격리 desktop/mobile |
| typed-entity-consumers | 타입별 목록 열·AND 필터·템플릿 변수 삽입·첫 삭제 식별자 복원의 보관값/태그 보존 desktop/mobile |
| schema-editor-read | 속성 변경안 공개 화면의 지연 조회·조회 실패·초안·저장 결과·복구안 desktop/mobile |
| material-schema | 통합 자료 설정의 속성 행·검토·변환·작업·복구와 기존 직접 주소 desktop/mobile |
| material-templates | 자료 종류별 고정 기본 문구·독립 저장·충돌·재시도·일반 설정 태그 진입/복귀 desktop/mobile |
| create-and-link | 자료 상세에서 작성·취소·단일 교체·응답 불명 재확인·초점 복귀 desktop/mobile |
| typed-relations | 자료 상세의 단일 값·삭제 상대 교체·동일 요청 재확인·해제와 복수 101개 더 보기 desktop/mobile |
| relation-settings | 별도 자료 관계 설정의 행 안 생성·편집·버전 충돌 초안 보존·보관 desktop/mobile |
| data-model | 전체 모델 파일·원문 검토·복사/갱신·영구 제거 확인·이력 더 보기·저장 후 독립 상세 조회·전체 적용/응답 불명 desktop/mobile |
| model-group | 모의 API 응답을 사용하는 종류별 변환 편집·분석·오류 행 보완·전체 적용 접수·진행 복귀·취소/재시도·이탈 보호 desktop/mobile; 실제 영속 worker·원자적 DB 게시 검증은 포함하지 않음 |
| issuer-settings | 발급처 목록·첫 번호 종류 추가·종류별 연결과 기본 선택·등록·중첩 확인·초안 충돌·설정 메뉴 desktop/mobile |
| schema-job-history | 값 변환 작업 공개 목록의 20개 초과 이력·자동 갱신·겹친 응답·더 보기 재시도·종류 전환 desktop/mobile |
| design-samples | 인증·API 없이 공용 디자인 사례와 미리보기 폭 전환·입력/확인/실패 상태 desktop/mobile |
| query-layout.build | 운영과 같은 정적 빌드·하위 기본 경로에서 자료 종류/검색/필터의 행·겹침·가로 넘침을 320/390/640/1440px에서 검증; 격리 Auth/API 사용 |
| workspace-screens | [사용자 흐름별 작업 공간 화면 검사](../../e2e/workspace-screens.md)만 실행 |

페이지 읽기의 상한·취소·실패 규칙은 `paged-list.test.ts`에서 검증한다. `pagination-fixture.spec.ts`는 실제 앱에서 URL 복원·누적 행·재시도 cursor·초점·읽던 위치·필터 초기화를 확인한다. 대량 모의 목록 때문에 실제 로그인 검사를 반복하지 않는다. 실제 API의 로그인·저장·웹/MCP 왕복 검사는 기본 설정에 남긴다.

전체 실행의 실제 API 설정은 `node scripts/test-e2e-all.mjs --actual-config /절대/격리/playwright.config.mjs`로 교체할 수 있다. 첫 설정만 교체하며 나머지 스물네 개 fixture 설정은 등록 순서대로 실행한다. 별도 DB·worker 설정은 실행 환경의 명시 설정으로 유지하고 tracked 설정 파일이나 개인 환경 파일을 고치지 않는다. 상세 정리·운영 범위는 [데모 자료 정리](../operations/demo-cleanup.md)를 따른다.

자료 조회 영역의 배치는 `npm run test:e2e -- --config=e2e/query-layout.build.config.ts`로 정적 빌드에서도 확인한다. 개발 서버와 운영 빌드는 CSS chunk의 순서가 달라질 수 있으므로, 관련 조작끼리 같은 행에 있는지·서로 겹치지 않는지도 검사한다. 선택창 위/검색창 아래 같은 개별 위치와 전체 가로 넘침 검사만으로 완료하지 않는다. 검사는 `test-results/query-layout-dist`에 모의 공개 설정으로 빌드하며 운영 서비스에 접속하지 않는다.

구 고정 속성 표현의 보존·거부 분류와 현재 fixture 계약은 [전환 검사](typed-fixture-transition.md)에 있다.

실제 전체 모델 파일 검사는 파일 내보내기·편집·검토·일괄 적용 후 기본값/읽기 전용/선택값·보관 복귀를 확인하고, 새 두 자료 종류와 명시 관계를 같은 파일로 구성해 웹 등록·MCP 연결·원본 무변경 재적용까지 검사한다. 개별 가져오기 신규 mutation을 다시 허용하지 않으며 과거 완료 요청의 정확한 재확인은 별도 DB/HTTP/MCP 검사로 유지한다.

실제 전체 모델 변환은 `supabase/tests/database/data-model-groups.test.ts`에서 다중 종류의 비공개 준비·한 transaction 게시·후반 실패 rollback·취소·동일 작업 재시도·부모/자식 lease·템플릿 freshness·계정 cascade·분석 원문 만료를 검사한다. `supabase/tests/mcp/data-model-groups.test.ts`는 실제 HTTP/OAuth MCP 접수와 정확한 요청 재현·격리를 검사하고, `e2e/data-model-groups.spec.ts`는 두 종류의 웹 변환 입력·전체 분석/접수 후 페이지를 떠나 독립 local runner가 완료하는 경로와 재방문·새로고침을 desktop/mobile에서 검사한다. 모의 `model-group` 설정의 결과를 이 실제 저장·worker 검사의 증거로 대신하지 않는다.

실제 API 검사의 `e2e/support.ts` 자동 fixture는 각 test가 공개 생성한 독점 공간과 정확한 구성원·요청 키를 추적한다. 자료 생성과 조회는 공간 문맥을 명시하고 새 자료 종류의 권한을 호출자가 명시적으로 부여한다. 전체 모델 준비 결과의 new 항목만 신규 종류로 인식하며 기존 update 대상을 채택하지 않는다. MCP 연결을 먼저 닫아도 자료는 화면 검사와 `afterEach`가 끝날 때까지 유지한다. 마지막에는 브라우저 context와 MCP 연결을 닫고 공간 manifest의 읽기 전용 계획·승인 digest·transaction 적용·잔존 0을 기록한다. Auth 계정과 개인 설정, 다른 공간과 소속 없는 외부 효과 이력은 보존한다. 이 실행이 만든 세션/OAuth 클라이언트는 별도 정확한 ID로 정리한다.

이 정리는 worker 1개인 loopback 실제 설정에서만 허용한다. `ENTITY_SCHEMA_WORKER_CONFIG`, API·직접 DB 포트, 명시한 프로젝트/실행 소유권 파일과 source revision을 모두 대조한다. 서비스 없는 검사는 `node --test scripts/workspace-fixture-cleanup.test.mjs scripts/workspace-model-fixture.test.mjs`다. 실제 DB 검사는 `supabase/tests/database/workspace-fixture-cleanup.actual.test.ts`로, 실행 lease 안의 명시한 격리 DB와 프로젝트·source revision을 사용한다. 계정/개인 설정·다른 공간·분리된 효과 이력 보존, 승인 후 변경 거부, 정확한 시험 효과 정리와 재실행을 확인한다. 기존 저장소의 승인 업무 자료 초기화는 [별도 실행안](../operations/demo-cleanup.md)이며 fixture의 공간 전체 삭제와 혼동하지 않는다.

공유 HTTP/MCP 실제 fixture와 정리 DB 검사는 `WORKSPACE_CLEANUP_SOURCE_REVISION`(검사 source의 40자리 commit)과 `WORKSPACE_CLEANUP_PROJECT_ID`(실행 lease의 격리 프로젝트)를 명시한다. 공유 fixture의 생성 intent·계획/적용/완료 보고서는 실행 로그에 남기며 토큰·본문·DB 비밀값은 포함하지 않는다. 응답을 잃은 공간 생성은 정확한 실행자·계정 범위·요청 키·`workspace.create` 완료 receipt로만 회수한다. 같은 이름을 검색해 정리 대상으로 채택하지 않으며 완료 receipt가 없으면 미결 intent를 보존하고 정리 실패로 보고한다.

최종 통합 실제 브라우저 설정 `e2e/workspace-full-actual.config.ts`는 기본 실제 `*.spec.ts`와 모델·태그·활동·할 일 조회 권한·검색/상태의 다섯 `*.actual.ts`를 함께 수집한다. `scripts/test-e2e-all.mjs`의 실제 설정으로 이를 지정한 뒤 스물네 fixture 설정까지 실행한다. 모의 fixture 수집이나 기능별 일부 실행을 최종 전체 green으로 대신하지 않는다.
