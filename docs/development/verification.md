# 프로젝트 실행 환경

명령과 도구 버전의 정본은 [package.json](../../package.json)과 [CI](../../.github/workflows/ci.yml)다. 환경 설정은 [supabase/config.toml](../../supabase/config.toml), [Vite](../../vite.config.ts), [Playwright](../../playwright.config.ts), [.env.example](../../.env.example)에서 확인한다. 개발·테스트 방법은 Matt 원본 스킬이 정한다.

## 로컬 서비스와 데이터

Node·Deno·Supabase CLI 버전과 설치 명령은 package.json·lockfile을 따른다. 로컬 Supabase에는 Docker가 필요하다. 함수 서버와 웹 서버의 실행 대상은 환경 파일에서 확인한다. 웹을 로컬에서 열었다고 DB도 로컬인 것은 아니다.

`setup:local`은 키·개발 계정·환경 파일을 준비하며 기존 생성 값과 사용자 설정을 보존한다. `test:all`은 Supabase를 준비하고 필요한 함수 서버를 실행한다. 명령의 실제 동작과 옵션은 [scripts/](../../scripts/test-all.mjs)에서 확인한다.

## 공유 환경과 테스트 자료

별도 worktree만으로 DB·계정·포트·서비스가 분리되지 않는다. 같은 로컬 Supabase를 쓰는 setup·migration·DB/HTTP/MCP/E2E 검사는 직렬로 실행한다. 서버의 hot reload도 실행 중인 검사의 코드를 바꿀 수 있다. 병렬 실행에는 서비스·설정·자료·정리 대상까지 분리된 환경이 필요하다.

테스트 자료는 실행별로 식별하며 정리는 해당 실행이 생성한 자료에 한정한다. 다른 작업이 소유한 서버·컨테이너·자료를 정리하지 않는다. 운영 DB를 격리 테스트로 사용하지 않는다. 적용된 migration 변경은 후속 migration으로 전달한다.

`.env*`·서명 키·개인 설정·시험 계정 값은 Git에 포함하지 않는다. 생성 값이나 인증 정보를 증거에 출력하지 않는다. 초기화와 설정 생성의 보존 동작은 관련 스크립트의 테스트가 확인한다.

## 검사 도구의 한계

문서 검사기는 UTF-8·BOM·LF·공백·상대 파일 링크와 Claude 연결 파일의 원본 frontmatter를 확인한다. Markdown·HTML의 앵커 존재는 확인하지 않으므로 변경한 앵커는 대상 제목이나 HTML id와 대조한다.

[변경 영향 분류기](../../scripts/ci-impact.mjs)는 실제 diff로 CI 범위를 선택한다. 알 수 없는 변경은 전체 CI 검사이며, 필수 상태 `check`·`integration`은 모든 분류에서 남는다. `workflow_dispatch`도 전체 CI 검사를 실행한다. CI는 타입·빌드·단위 검사와 격리 DB·HTTP·MCP 통합 검사를 담당하며 브라우저 E2E는 포함하지 않는다. 상세 동작은 분류기 테스트와 CI가 정본이다.

Draft PR은 `check`·`integration`을 생략하고 관련 로컬 검사로 개발한다. 리뷰 준비 완료로 전환하면 CI가 실행되며, 이후 새 커밋에도 최신 변경을 검증한다. 같은 PR의 이전 실행은 자동 취소하고, Draft로 되돌릴 때도 진행 중 검사를 취소한다. main 푸시와 수동 실행은 유지한다. Draft의 skipped 결과와 취소된 실행은 머지 검증 증거가 아니며, 머지할 최신 변경의 실제 CI 성공을 확인한다.

브라우저 E2E는 로컬에서 필요할 때 실행한다. 화면·탐색·로그인·OAuth 동의·웹/MCP 왕복처럼 브라우저 동작을 확인할 변경에는 관련 파일과 프로젝트를 선택할 수 있다. 로컬 Supabase·함수 서버를 준비하고 Chromium을 설치한 뒤 `npm run test:e2e -- e2e/web-mcp.spec.ts --project=desktop`처럼 실행한다. 전체 로컬 통합 검사는 `npm run test:all`로 실행하며 E2E도 포함한다. CI 성공은 브라우저 검증을 뜻하지 않으며, 실제 실행한 revision·범위·결과는 이슈·PR에 남긴다.

빠른 core·웹·어댑터 검사는 실제 DB·OAuth·브라우저 연결의 증거를 대신하지 않는다. 제품의 권한·일관성·웹/MCP 행동은 관련 [계약](../../supabase/functions/_shared/contracts/search.ts)과 실제 진입점의 테스트에서 확인한다. 제품 플러그인의 정적 패키지 검사는 실제 Claude·Codex 사용과 구분한다([제품 행동 검증 도구](../../experiments/plugin-behavior/README.md)).

Playwright 결과·trace와 서비스 로그는 다음 실행으로 덮어써질 수 있다. 필요한 실패 증거는 저장소 밖의 실행별 위치에 보존한다. 검증 결과와 실행할 수 없었던 범위는 해당 GitHub 이슈·PR에서 확인한다.
