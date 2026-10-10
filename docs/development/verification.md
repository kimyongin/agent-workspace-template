# 프로젝트 실행 환경

명령과 도구 버전의 정본은 [package.json](../../package.json)과 [CI](../../.github/workflows/ci.yml)다. 환경 설정은 [supabase/config.toml](../../supabase/config.toml), [Vite](../../vite.config.ts), [Playwright](../../playwright.config.ts), [.env.example](../../.env.example)에서 확인한다. 개발·테스트 방법은 Matt 원본 스킬이 정한다.

## 로컬 서비스와 데이터

Node·Deno·Supabase CLI 버전과 설치 명령은 package.json·lockfile을 따른다. 로컬 Supabase에는 Docker가 필요하다. 함수 서버와 웹 서버의 실행 대상은 환경 파일에서 확인한다. 웹을 로컬에서 열었다고 DB도 로컬인 것은 아니다.

`setup:local`은 키·개발 계정·환경 파일을 준비하며 기존 생성 값과 사용자 설정을 보존한다. `test:integration:local`은 설정된 함수 서버를 먼저 관찰한다. 준비된 기존 실행은 재사용하고, 준비 중이면 최대 2분 기다리며 준비 실패 시 중단한다. 기존 실행에서는 setup·migration·환경 파일 갱신을 하지 않으므로 검사에 필요한 로컬 환경은 먼저 준비되어 있어야 한다. 명령의 실제 동작은 [검사 실행](../../scripts/test-local-integration.mjs)과 [수명주기 module](../../scripts/local-runtime.mjs)이 소유한다.

함수 실행이 없을 때만 Edge runtime을 제외한 setup 후 다시 관찰하고 직접 함수를 실행한다. setup 중 독립적으로 나타난 실행은 빌려 쓰며 제거하지 않는다. 직접 실행할 때는 기본 환경 파일을 수정하지 않고 개인 임시 환경 파일에 실행별 nonce를 추가한다. 정확한 컨테이너 ID·실제 functions bind source·Docker 환경의 nonce가 모두 일치해야 정리를 허용한다. 생성 시각이나 동일 source만으로 소유권을 추정하지 않는다. 실행 직전에도 다시 관찰하며, nonce가 없거나 ID가 바뀌면 중단하고 컨테이너를 보존한다. 검사 종료·실패·SIGINT/SIGTERM에는 직접 만든 자식 프로세스 트리를 강제 종료하고 증명한 컨테이너 ID만 정리하며 DB·volume과 기존 실행을 정리하지 않는다. project 이름만으로 정리하지 않는다. 다른 터미널이 같은 project의 Supabase CLI를 직접 실행하는 경우 CLI 자체의 이름 기반 교체와 시작 시점 경쟁까지 원자적으로 막지는 못하므로 같은 project에서 동시에 시작하지 않는다.

단계별 원래 종료 코드와 정리 실패를 함께 표시하고, 중단 후 남은 단계를 실행하지 않는다. 준비·소유권 확인 실패에는 새 실행을 반복하지 않는다. 서비스 로그와 원래 검사 실패는 필요한 경우 실행별 외부 위치에 보존한다. 수명주기/외부 Docker adapter의 모의 검사는 실제 격리 CLI 실행과 구분한다.

## 공유 환경과 테스트 자료

별도 worktree만으로 DB·계정·포트·서비스가 분리되지 않는다. 같은 로컬 Supabase를 쓰는 setup·migration·DB/HTTP/MCP/E2E 검사는 직렬로 실행한다. 서버의 hot reload도 실행 중인 검사의 코드를 바꿀 수 있다. 병렬 실행에는 서비스·설정·자료·정리 대상까지 분리된 환경이 필요하다.

테스트 자료는 실행별로 식별하며 정리는 해당 실행이 생성한 자료에 한정한다. 다른 작업이 소유한 서버·컨테이너·자료를 정리하지 않는다. 운영 DB를 격리 테스트로 사용하지 않는다. 적용된 migration 변경은 후속 migration으로 전달한다.

`.env*`·서명 키·개인 설정·시험 계정 값은 Git에 포함하지 않는다. 생성 값이나 인증 정보를 증거에 출력하지 않는다. 초기화와 설정 생성의 보존 동작은 관련 스크립트의 테스트가 확인한다.

## 검사 도구의 한계

문서 검사기는 UTF-8·BOM·LF·공백·상대 파일 링크와 Claude 연결 파일의 원본 frontmatter를 확인한다. Markdown·HTML의 앵커 존재는 확인하지 않으므로 변경한 앵커는 대상 제목이나 HTML id와 대조한다.

[변경 영향 분류기](../../scripts/ci-impact.mjs)는 실제 diff로 CI 범위를 선택한다. 알 수 없는 변경은 전체 CI 검사이며, 필수 상태 `check`·`integration`은 모든 분류에서 남는다. `workflow_dispatch`도 전체 CI 검사를 실행한다. CI는 타입·빌드·단위 검사와 격리 DB·HTTP·MCP 통합 검사를 담당하며 브라우저 E2E는 포함하지 않는다. 상세 동작은 분류기 테스트와 CI가 정본이다.

Draft PR은 `check`·`integration`을 생략하고 관련 로컬 검사로 개발한다. 리뷰 준비 완료로 전환하면 CI가 실행되며, 이후 새 커밋에도 최신 변경을 검증한다. 같은 PR의 이전 실행은 자동 취소하고, Draft로 되돌릴 때도 진행 중 검사를 취소한다. main 푸시와 수동 실행은 유지한다. Draft의 skipped 결과와 취소된 실행은 머지 검증 증거가 아니며, 머지할 최신 변경의 실제 CI 성공을 확인한다.

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
| collection-fixture | 목록 화면 + pagination의 desktop/mobile 연결 검사; 실제 250페이지 복원 상한은 desktop에서 한 번 확인 |
| detail-workspace | 상세 작업 공간과 표시 배율 |
| entity-tags-fixtures | 엔터티·태그 desktop/mobile |
| principle-current | 현재 원칙 desktop/mobile |
| activity | 활동 desktop/mobile 서울 시간대 + desktop UTC 날짜 변이 |
| navigation-fixture | 탐색·프로필 desktop, OAuth 동의 desktop/mobile |
| workspace-screens | workspace-screens의 화면 검사만 실행 |

페이지 읽기의 상한·취소·실패 규칙은 `paged-list.test.ts`에서 검증한다. `pagination-fixture.spec.ts`는 실제 앱에서 URL 복원·누적 행·재시도 cursor·초점·읽던 위치·필터 초기화를 확인한다. 대량 모의 목록 때문에 실제 로그인 검사를 반복하지 않는다. 실제 API의 로그인·저장·웹/MCP 왕복 검사는 기본 설정에 남긴다.
