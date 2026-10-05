# 프로젝트 검증과 실행 환경

이 문서는 현재 앱의 제품 계약·실행 명령·격리 환경을 제공한다. 개발 단계의 방법은 원본 Matt 스킬을 따른다. 테스트는 인터페이스의 행동을 검증하며 기존 내부 구조를 고정하지 않는다. 작업과 증거 정본은 [GitHub Issues](../agents/issue-tracker.md)다.

## 기술 실험

되돌리기 비싼 기술 가정(드라이버·인증 방식·외부 공급자 품질 등)은 앱 코드를 쓰기 전에 `experiments/`에서 작게 시험한다. 실험 코드는 근거로 보존하지만 앱의 일부가 아니다.

| 규칙 | 내용 |
| --- | --- |
| 위치 | 주제마다 `experiments/<주제>/` 하나(예: `t02-1`). 폴더마다 자체 `package.json`·Supabase 설정을 두고 다른 실험·사용자의 로컬 프로젝트와 겹치지 않는 포트를 쓴다 |
| README | 폴더마다 목적, 필요한 도구, 준비·실행·정리 명령, 결과를 기록한 티켓 링크를 둔다. 목록은 [`experiments/README.md`](../../experiments/README.md)에 추가한다 |
| 앱과 분리 | 앱 코드·테스트·배포는 `experiments/`를 가져오지 않는다. 채택한 방식은 앱 코드에 새로 구현하고 앱의 테스트로 다시 검증한다 |
| 환경 | 로컬 또는 사람이 승인한 격리 환경만 쓴다. 운영 프로젝트·운영 데이터와 기존 프로젝트를 쓰지 않는다. 호스팅에서만 드러나는 동작(Edge 배포, 실서버 풀러, 경로 삽입형 metadata 등)은 실험이 아니라, 사람이 지시한 운영 배포 뒤의 동작 확인으로 본다. 이 경우 그 동작이 첫 운영 배포에서 처음 확인된다는 위험을 해당 GitHub issue에 적는다. 확인 결과 설계를 바꿔야 하면 로컬이나 사람이 승인한 격리 환경에서 다시 실험한다 |
| 비밀값 | `.env*`·서명 키·생성된 설정은 각 폴더의 `.gitignore`로 제외한다. 시험 계정 값도 이 파일에만 둔다 |
| 결과 | 실행 환경·명령·결과·채택/기각 판단은 해당 GitHub issue에 남긴다. 실험 PR은 결과 기록과 함께 머지한다 |
| 수명 | 실험은 지우지 않고 계속 보존한다. 결과가 더 이상 맞지 않으면(예: 버전 변경으로 다른 방식 채택) [`experiments/README.md`](../../experiments/README.md) 목록의 상태를 `대체됨`으로 바꾸고 대체한 실험을 링크한다. 템플릿으로 만든 새 프로젝트도 실험 폴더를 유지한다 |

## 최소 기반과 완결된 기능

첫 기능이 사용하는 도메인·저장·HTTP/MCP·화면·테스트를 함께 연결한다. 공통 기반에는 즉시 사용할 기능과 종료 조건을 적는다. 실제 두 번째 사용처에서 공통성이 확인되면 확장한다. 모든 DB, 모든 API, 모든 화면을 각각 먼저 완성하는 방식은 기본으로 삼지 않는다.

공통 기반의 첫 소비자는 할 일·기록·검색 기능이다(이 템플릿에서는 [Template-01](../tickets/template-01-task-record-search.md)). 기반만 구현했거나 모의 화면만 연결한 상태를 사용자 기능 완료로 보고하지 않는다.

## 기능 계약과 교차 검증

인증·권한·입력·외부 통신·데이터 수명 변경에는 [보안 가이드](../security/guide.md)를 적용한다. 기능 issue에 보호 대상·신뢰 경계·거부 테스트와 미적용 항목의 이유를 기록한다. AGENTS.md와 domain 설정의 프로젝트 문서 연결을 사용한다.

각 기능 issue에서 아래 항목을 관리한다. 실제 경로·도구 이름·필드·오류는 해당 GitHub issue의 계약에 한 번 정의한다.

| 항목 | 확인할 내용 |
| --- | --- |
| 웹/MCP 동등성 | 지원 행위, 전체 편집 필드, 단건·페이지 탐색, 동일한 권한과 부수효과 |
| 데이터 수명 | 정본, 참조, 삭제·정정 영향, 파생 데이터 갱신 |
| 실패와 재시도 | 부분 실패, 응답 유실, 중복 요청, 충돌, 오래된 비동기 결과 |
| 에이전트 사용 | 도구 schema·설명·실제 호출 일치, 제품 스킬의 필요한 안내 |
| 플러그인 제공 | Claude·Codex 각 manifest·연결 설정과 공유 스킬의 통합 패키지, 클라이언트별 설치·업데이트·서버 호환성과 실제 행동 |

웹 생성→MCP 조회·변경→웹 재조회와 반대 방향을 해당 범위에서 검증한다. 미지원 기능은 표기하며 공통 유스케이스를 쓴다는 이유만으로 동등성을 통과 처리하지 않는다.

필드·필터를 바꾸면 영향받는 HTTP 입출력·MCP `tools/list` schema·웹 입력/표시·저장소 쿼리·제품 스킬을 티켓에서 대조한다. 반복 회차처럼 별도 계산·조회·완료 분기도 포함한다. 가능한 schema는 공유 계약 정본에서 파생하고 수동 동기화 대상은 비교 검사로 확인한다. schema가 같아도 실제 저장소 분기의 필터 전달이 보장되지는 않으므로 변경한 행위·분기를 실제 진입점과 DB에서 검증한다.

### 기능별 회귀 검증

화면의 복귀·초안 규칙은 [디자인 가이드](../design/guide.md#화면-완료-체크리스트)가 정본이다. 목록·상세·편집·필터를 변경하는 기능은 첫 페이지 동작에 더해 추가 페이지→상세→편집 저장/취소·삭제→목록 복귀를 완료 조건에 넣는다. 변경 위험에 따라 필터·펼친 범위·스크롤·초점, 저장 실패/충돌의 초안, 브라우저 뒤로 가기·새로고침, 상세에 머무는 동안의 동시 추가, 필터 전환/화면 이탈 뒤 늦은 응답을 검사한다. 대상이 삭제되거나 조건에서 빠지면 유효한 위치로 돌아가고 복원 조회가 끝나는지도 확인한다. 필요한 시나리오는 관련 모바일·데스크톱 E2E에 남긴다.

## 검증 환경과 증거

세션 시작과 환경 전환 시 checkout·commit·미커밋 변경과 필요한 런타임·연결 도구를 확인한다. 로컬 앱의 접속 대상이 로컬 DB라고 가정하지 않는다. 일반 개발 데이터, 초기화 가능한 격리 테스트, 운영 데이터를 구분한다. 운영 DB를 격리 테스트 대신 사용하지 않는다.

| 변경 대상 | 검증 위치 |
| --- | --- |
| 도메인 판단 | DB 없는 단위 테스트 |
| 저장·RLS·원자성·경쟁 | 실제 격리 DB 통합 테스트 |
| HTTP/MCP | 인증·입출력·오류 계약과 실제 호출 |
| 웹 흐름 | 관련 브라우저 E2E, 모바일·데스크톱 상태와 조작 |
| 검색 | 실제 모델의 관련/무관 질문 평가, 원문 접근, 색인 지연·실패 구분 |
| 제품 스킬 | 자동 계약 검사와 별도로 Claude·Codex 각 클라이언트에서 행동 확인 |
| 문서 | UTF-8 BOM 없음·LF, 링크, 공백, 문서 간 계약 일치, Claude 스킬 연결 파일과 정본 frontmatter 일치 |

### 공유 환경과 테스트 자료

실행 전에 테스트 자료의 실행별 식별자·생성 범위·정리 대상과 담당을 정한다. 목록 개수·검색 범위 등은 이전 실행의 자료와 다른 검사가 만든 자료가 섞이지 않도록 격리한다. 정리는 해당 실행이 만든 자료만 대상으로 하며, 실패 분석에 필요한 증거를 먼저 보존한다.

같은 로컬 환경의 DB·HTTP·MCP·E2E와 setup·migration·서버 시작/종료는 한 담당이 순차 관리한다. 검증 동안 코드·설정을 고정하고 hot reload, 다른 통합 테스트, 초기화나 서버 정리가 끼어들지 않게 한다. 변경이 필요하면 진행 검증을 끝내거나 중단하고 revision·환경을 다시 기록한 뒤 시작한다. 적용된 migration은 다시 쓰지 않고 후속 migration으로 변경한다.

공유 환경에서는 `test:all`을 동시에 실행하지 않는다. 별도 worktree만으로 프로젝트·포트·계정·DB·함수 서버와 정리 대상이 분리되지는 않는다. 각 환경의 설정·자료·실행 파일·서비스·정리 범위까지 서로 영향을 주지 않도록 격리한 경우에만 환경별 동시 실행을 허용한다. 격리 여부와 제약은 해당 GitHub issue에 남긴다.


### 반복 초기화 검증

초기화·설정 생성 절차를 바꾸면 같은 조건으로 두 번 실행한다. 두 번째 실행에서 생성 값·키·비밀번호와 사용자 설정·주석이 보존되는지, 내용이 같은 파일의 byte·수정 시각이 유지되는지 확인한다. 값 출력 대신 비교 결과를 남긴다. 실제 값 변경은 저장되어야 하며, 실행 중 서비스의 파일 감시 재시작·인증·요청 처리에 불필요한 영향이 없는지도 검증한다. 실행할 수 없는 항목은 환경 제약과 함께 인계한다.

### 실패 분석과 재실행

실패 직후 trace·테스트 결과·관련 서비스 로그를 덮어쓰지 않는 실행별 위치에 보존하고, 실패 시각·검증 revision·미커밋 변경·명령·비밀값을 제외한 환경/데이터 조건을 기록한다. Playwright의 다음 실행이나 서버 시작이 이전 결과·로그를 덮어쓰기 전에 복사하거나 별도 artifact로 남긴다.

그 증거로 구현 결함, fixture/기대값 오류, 환경 문제, 실행 방식의 간섭 중 원인을 분류한다. 원인을 확인할 좁은 검증을 수행하고 수정·환경 조정의 이유를 기록한 뒤 관련 검사를 재실행한다. timeout·재시도 횟수를 늘리거나 재실행이 통과한 것만으로 종결하지 않는다. 원인상 제한 시간·재시도 변경이 타당하면 근거와 실패를 감지할 조건을 함께 남긴다. 결론을 못 내리면 미확인 원인과 남은 검증을 표시한다.

### 문서 검사

문서·스킬·설정 파일을 바꾸면 저장소 루트에서 다음을 실행하고 결과를 PR과 티켓에 남긴다. Node 22 이상에서 `npm ci`로 lockfile의 검사 의존성을 준비한다. 기본 텍스트/링크 검사기는 단독 실행할 수 있지만 모델 설정 검사는 고정된 TOML parser·편집기를 사용한다.

| 명령 | 검사 |
| --- | --- |
| `node scripts/check-docs.mjs` | Git이 추적하거나 무시하지 않는 텍스트 파일의 UTF-8 유효성·BOM 없음·LF·줄 끝 공백·마지막 줄바꿈, 마크다운 내부 상대 링크(코드 블록·인라인 코드 제외)와 HTML의 href·src 상대 경로(script·style·주석 제외. 둘 다 앵커는 미검사), 공유 스킬 정본과 Claude 연결 파일의 frontmatter 일치, 일반 앱 티켓 상위/하위 ID 중복(템플릿 이력 제외) |
| `node scripts/agent-models.mjs check` | 모델 선택표 schema·지원 강도와 양쪽 native 설정 drift, 실제 TOML 문법·parsed defaults(날짜 최신성은 배정 시 검사) |
| `node --test "scripts/*.test.mjs"` | 검사기 자체의 시험. 정상 저장소 통과와 깨진 링크(마크다운·HTML)·CRLF·BOM·UTF-8이 아닌 바이트·줄 끝 공백·frontmatter 불일치 검출 |
| `git diff --check` | 변경분의 공백 오류 |

문서 변경의 검증 근거는 저장소 밖 검사기 대신 이 명령의 결과로 남긴다. 실패 메시지는 `파일:줄: 문제` 형식이다. 변경 문서의 내부 앵커는 대상 제목·HTML id를 직접 확인한다. 검사기는 앵커 존재를 확인하지 않는다.

### 실행 검증

필요한 도구는 Node 22 이상과 Docker다. Deno와 Supabase CLI는 `npm ci`가 `package.json`에 고정한 버전으로 설치하며 `npm run`이 그 버전을 쓴다. 명령의 정본은 `package.json`의 `scripts`와 [CI](../../.github/workflows/ci.yml)다.

| 명령 | 하는 일 |
| --- | --- |
| `npm ci` | 잠금 파일대로 의존성 설치 |
| `npm run setup:local` | 서명 키 생성(처음 한 번), 로컬 Supabase 시작, `.env.local`과 개발용 사용자 A·B 준비. 다시 실행해도 키와 비밀번호를 유지하고 `.env.local`·`supabase/functions/.env`의 사용자 추가 값·dotenv 구문·주석을 보존한다. 생성 스크립트가 소유한 키만 갱신한다. `supabase/.env`에 Google OAuth 클라이언트 값이 있으면 로컬 Google 로그인도 켠다(`.env.example` 참고, 바꾼 뒤에는 `npm run stop:local` 후 다시 실행) |
| `npm run dev` | 웹 개발 서버(`http://127.0.0.1:55480`) |
| `npm run check:boundaries` | 의존 경계: contracts는 zod만, core는 contracts·core·zod만(Deno API·네트워크·HTTP 타입 금지), 웹은 서버 코드를 `@contracts`로만 가져오고 제품 데이터에 supabase-js `.from`/`.rpc`를 쓰지 않음 |
| `npm run check:deno` | 서버 코드의 Deno 타입·lint·형식 검사 |
| `npm run test:core` | DB 없는 contracts·core 테스트 |
| `npm run test:web` | 웹 단위 테스트(Vitest) |
| `npm run test:adapters:fast` | 서비스 없이 실제 HTTP Request/Response·MCP ToolDef schema/handler의 할 일 생성·완료·직렬 재시도·입력/충돌 오류 검사. 테스트 조립의 저장 포트·Actor fixture 사용 |
| `npm run test:fast` | 기존 DB 없는 core·웹 검사와 빠른 어댑터 검사를 순서대로 실행. Docker·`.env.local`·서비스 자격 증명·공급자 키 없이 실행 |
| `npm run build` | 웹 타입 검사와 정적 빌드 |
| `npm run test:db` | 격리 로컬 DB 테스트: 사용자 격리, 직접 쓰기 차단, 연결 재사용 시 문맥 해제, 원본·큐 원자성, contracts와 DB 한도 parity, 유스케이스 부분 실패 롤백 |
| `npm run serve:functions` | 로컬 Edge Functions 실행(`/functions/v1/api`, `/functions/v1/mcp`). HTTP·MCP 테스트 전에 다른 터미널에서 띄운다 |
| `npm run test:http` | 실제 진입점과 로그인 토큰으로 HTTP 계약 테스트: 인증·입력 오류, 격리, 완료·동시 완료·재시도, 반복 회차, 커서 |
| `npm run test:mcp` | 실제 OAuth 흐름(동적 등록·PKCE·동의 API·코드 교환)으로 받은 MCP 토큰과 공식 MCP 클라이언트로 도구 계약 검사: 토큰 audience 구분, `tools/list` schema, 웹 작성→MCP 완료→웹 확인, HTTP와 같은 결과·오류, 제품 스킬의 도구 이름 |
| `npm run test:e2e` | Playwright(데스크톱·모바일 viewport): 웹 작성→브라우저 동의 화면 승인으로 MCP 연결→MCP 완료→웹 확인, MCP 작성→웹 편집→MCP 확인, 다른 사용자의 URL 접근 거부. 웹 개발 서버는 자동으로 띄운다. 처음 한 번 `npx playwright install chromium` |
| `npm run test:all` | 로컬 통합 테스트를 한 번에(정적 검사·웹 빌드 제외): 로컬 Supabase 준비, Edge Functions가 없으면 띄우고 끝나면 정리, core·DB·HTTP·MCP·E2E를 차례로 실행하고 결과 요약 |
| `npm run stop:local` | 로컬 Supabase 정지(데이터 유지) |

로컬 Supabase 포트는 55420~55429, 웹은 55480, Edge inspector는 8483이다. 다른 로컬 프로젝트·실험(55320~55329)과 겹치지 않는다. CI는 운영 secret 없이 아래 변경 영향에 따라 `check`와 `integration`을 실행한다. 새 검사는 추가되는 단계에서 이 표와 CI에 넣는다.

환경상 실행할 수 없는 검사는 대상 commit·명령·데이터 조건·실행 가능한 격리 환경을 기록해 인계한다. CI에서 수행하는 경우 해당 revision의 결과까지 확인한다.

업무·어댑터 변경은 `test:fast`로 업무·입출력 오류를 먼저 확인한다. 문서·단순 표시 변경의 로컬 검사도 아래 분류별 범위를 따른다. 설치 시 패키지 다운로드가 필요할 수 있지만 테스트 런타임은 외부 서비스를 호출하지 않는다. fake는 해당 흐름에 필요한 포트만 지원하며 미지원 메서드는 명확히 실패한다. 업무 규칙·SQL·OAuth를 fake에 복제하지 않는다. HTTP Actor 주입은 테스트 factory 조립에서만 하며 운영 기본값은 실제 토큰 검증이다. MCP handler 증거는 SDK 전송·OAuth 증거와 구분한다. 실제 DB 잠금·동시 요청·롤백·RLS와 인증·웹↔MCP 검사는 기존 `integration` CI에서 유지한다. 첫 범위와 결과는 [Template-08](../tickets/template-08-mock-first-testing.md)에 기록한다.

### 변경 영향별 CI

[분류기](../../scripts/ci-impact.mjs)는 파일 경로와 실제 diff를 함께 검사한다. PR은 base/head의 merge-base부터 실제 PR head까지, push는 event의 before부터 after까지 비교한다. 테스트 checkout은 GitHub의 PR merge commit이므로 분류 비교 대상과 구분한다. 이력 누락·분석 오류·알 수 없는 파일은 `full`로 처리한다. 문서 외 삭제·rename·신규 웹 파일도 `full`이다.

| 분류 | 허용 변경 | 로컬·CI 검사 |
| --- | --- | --- |
| `docs` | docs/의 Markdown·HTML·텍스트·그림/PDF 문서(추가·삭제·문서 간 rename 포함), 기존 개발 스킬 Markdown | `check:docs`(모델/native·스크립트 회귀 포함), diff 공백 |
| `presentation` | 기존 비인증 feature/component TSX의 허용 표시 HTML 요소 직접 JSXText와 정적 title/placeholder/aria-label만 변경, 제한 CSS 표시 속성값 변경 | docs 범위 + 웹 unit·타입 검사·build |
| `full` | 동작·DOM 구조·표현식·route/action·인증·계약·데이터·API/MCP·설정·의존성·CI/tooling 또는 판정 불명 | 기존 전체 check + 러너 격리 Supabase의 DB·HTTP·MCP·전체 E2E |

docs/의 문서 HTML은 tag·inline script/style가 바뀌어도 앱의 DB·HTTP/MCP·전체 E2E 대상이 아니다. 내용·링크·공백 검사와 영향받는 문서 화면의 시각 확인을 분리한다. 문서 확장자는 md/html/txt/svg/png/jpg/jpeg/webp/gif/pdf로 한정하며, 실행 코드·설정 파일을 docs/로 옮겨 자동 제외하지 않는다. 실제 실행 선택표 `docs/development/agent-models.json`과 독립 js/mjs/ts/sh·JSON/YAML 등은 full이다. 앱·CI·스크립트·의존성 변경이 섞이면 가장 높은 영향 분류를 적용한다. 제품 플러그인 README·실행 스킬까지 문서 경량 범위를 확대하지 않는다.

TSX는 TypeScript/JSX AST에서 허용 표시값 외 모든 노드와 주석이 같아야 한다. option/textarea 등 입력 요소·custom component·fragment·허용하지 않은 tag는 하위 트리 전체를 엄격하게 비교한다. 후손의 일반 DOM 요소에서도 텍스트·표시 attr 허용을 다시 켜지 않으며 입력 요소 자체의 attr도 완화하지 않는다. 이벤트·href/to/type/value/disabled/id/name/role 등은 완화하지 않는다. className 변경은 숨김·입력 제어·JS 동작에 영향을 줄 수 있어 모두 `full`이다. CSS는 selector·속성 구조·비허용 값이 같아야 하며 인증·상태 selector, 숨김/입력 제어, URL·escape·토큰·불명확 문법 변경을 완화하지 않는다. 문서와 표시 변경의 조합은 `presentation`, 그 외 런타임 혼합 변경은 `full`이다. 자동 분류는 의미·접근성 검수의 대체가 아니다. 표시 변경은 티켓에 대표 소비 화면·viewport·키보드·초점 확인 결과를 남기고 불확실하면 전체 검증한다.

필수 상태 이름 `check`·`integration`과 branch protection을 유지한다. workflow-level path skip·job-level 영향 skip은 쓰지 않는다. `integration`은 `always()`로 실행해 `check` 실패/분류 누락을 명시 실패시키고, 가벼운 분류에서 heavy steps만 생략해 근거 summary와 실제 성공 상태를 남긴다. 전체 검증을 강제하려면 Actions의 `ci` workflow를 `workflow_dispatch`로 실행한다(항상 `full`). 분류기·CI·의존성 변경은 `full`이며 독립 리뷰·필수 CI를 요구한다. 구현·회귀 근거는 [Template-13](../tickets/template-13-ci-change-impact.md)에 기록한다.
