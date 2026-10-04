# Template-13 — 변경 영향에 따른 CI 검사 범위

작성: 2026-10-04
상태: 구현·서비스 없는 로컬 검사 완료(독립 리뷰·실제 full CI·머지는 메인 후속)
검토 기준: base `b7339796dff5fd1c8d4856b94b0054d3731fcb3e`, branch `codex/ci-by-change-impact`
선행: [Template-08](template-08-mock-first-testing.md)의 서비스 없는 빠른 검사

## 승인·소유와 목표

사용자는 웹 문구·버튼 위치 같은 작은 변경에도 전체 check/integration이 오래 걸리므로 변경 영향에 따라 검증을 나누도록 승인했다. 담당 구현 세션은 CI workflow·분류기/회귀·필요 의존성·가이드/개발 스킬·현재 요약·PR 검증 필드를 소유한다. 메인은 설계 조정·독립 리뷰·Git/PR·실제 CI·머지를 맡는다. 전달받은 당일 desktop balanced/medium implement preflight PASS와 고정 `gpt-6.1-sol`/medium 배정으로 작업한다. 이전 사용자·다른 개발자의 작업을 되돌리지 않는다.

PRD·ADR·GitHub branch protection·job 이름·운영/공유 Supabase·서비스·추가 LLM/유료 호출은 바꾸거나 실행하지 않는다. 앱의 실제 화면 변경은 이 PR에 없다. 과거 Template-08의 전체 CI 근거는 당시 기록으로 보존한다.

## 계약과 완료 조건

정본은 [개발 방법](../development/workflow.md#변경-영향별-ci)과 [디자인 가이드](../design/guide.md)다. [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)·[필수 검사 문제 해결](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)·[Babel parser](https://babeljs.io/docs/babel-parser)를 직접 조회했다. workflow paths skip으로 required 상태가 사라지거나 downstream skipped가 성공처럼 처리되는 경계를 피한다.

- [x] docs/presentation/full을 실제 파일 내용과 비교 범위로 판정하고 불명확·삭제·rename·누락 이력·tooling은 full로 처리한다.
- [x] 기존 비인증 TSX의 표준 HTML 직접 문구/한정 정적 표시 attr만 AST 비교로 완화한다. custom children/props·fragment·동작 attr·표현식·DOM 구조·주석·script/style·parse 실패는 full이다.
- [x] CSS의 제한 표시 속성값만 완화하고 selector/구조·auth/state·숨김·URL·escape·토큰 변경은 full로 처리한다. 문서 HTML은 동일 tag/script/style/comment의 prose만 허용하며 미닫힌 실행 markup은 거부한다.
- [x] PR merge-base→head와 push before→after를 구분하며 workflow_dispatch는 항상 full이다.
- [x] check/integration 필수 job은 항상 실행한다. integration은 check 실패/분류 누락을 명시 실패시키며 가벼운 변경에서 heavy step만 생략하고 근거 summary를 남긴다.
- [x] 가이드·스킬·START/overview·PR 검증 필드를 같은 기준으로 맞춘다.
- [x] 필요한 로컬 검사·실제 이전 문서 diff/현재 표시 fixture를 검증하고 증거를 인계한다.
- [ ] 메인 독립 리뷰·이번 변경 자체의 full CI check/integration·머지.

## 구현 판단과 실행 기록

TypeScript7.0.2의 실제 import에는 JS compiler `createSourceFile` API가 없다. regex로 TSX를 파악하는 대신 공식 `@babel/parser`7.29.9를 정확한 devDependency로 추가했다. `npm install --save-dev --save-exact @babel/parser@7.29.9`는 added4/audit173/취약점0으로 성공했다. CSS는 새 의존성 없이 좁은 lexical allowlist를 쓰며 일반 CSS 의미 분석을 주장하지 않는다. 불명확 CSS/HTML 변경이 full로 가는 것은 허용된 보수적 한계다.

분류기 약160줄과 회귀 검사는 순수 함수·Git 비교·실제 CLI output/summary·필수 job 조건을 확인한다. 첫 회귀 실행에서 fixture의 존재하지 않는 문자열 치환이 원문과 같아 negative test가 실패했다. fixture를 실제 선언 변경으로 고쳐 재실행했고 7/7 PASS였다. 이 실패는 분류 실행 지원 실패로 확대하지 않는다. 메인 검토에 따라 custom component/fragment 직접 text·custom web component·미닫힌 script/style/comment 회귀를 추가했다.

`90708ff`→`2188a42`(이전 문서 PR #85)의 실제 Git diff를 분류했다. START-HERE·overview·Template-10-06·Template-12 네 파일 모두 docs이고 최종 mode docs다. 따라서 이 경로는 문서 검사/공백만 수행하고 DB·HTTP·MCP·E2E heavy steps를 생략한다. 당시 PR의 실제 CI를 소급해 줄였다고 주장하지 않는다.

현재 `src/styles/app.css`에서 `.app-brand`의 `margin-right: auto`만 `1rem`으로 바꾼 메모리 fixture는 presentation이다. 실제 TSX 문구·정적 attr fixture도 presentation이며 onClick 변경은 full이다. 앱 파일에 fixture를 저장하지 않았고 실제 버튼 배치/화면 성공을 주장하지 않는다. 이후 표시 변경 PR은 대표 소비 화면의 viewport·키보드·초점을 티켓에 기록해야 한다.

## 검증과 인계

직접 실행한 현재 구현 검사: `npm run check:docs` 텍스트334개·모델/native 정합성 PASS·스크립트47개 중46 PASS/0 FAIL/기존 Windows file-symlink권한1 SKIP(새 분류7개 포함), `npm run check:boundaries` PASS, `npm run check:deno` 타입/lint/fmt PASS(89/93 files), `npm run test:fast` core60/fast handler13/web6 PASS, `npm run build` 타입·빌드 PASS, `npm run test --prefix experiments/t02-3-embedding` 오프라인4 PASS, `git diff --check` PASS. 빌드의 기존 500kB chunk 경고는 실패가 아니다. 화면·업무 코드는 바꾸지 않았으므로 앱 화면 성공 증거를 새로 만들지 않는다.

본 PR은 `.github/workflows/ci.yml`·`scripts/ci-impact*`·package/lock 변경이 있어 `full`이다. 메인은 같은 제출 head의 독립 리뷰와 실제 check/integration CI를 확인해 머지한다. required 상태와 생략 heavy steps는 GitHub summary에서 구분한다. 로컬 성공만으로 원격 CI 성공·머지를 완료 처리하지 않는다.

실제 full CI의 러너 격리 Supabase·HTTP/MCP·E2E는 메인 제출 후 실행한다. 이 구현 세션은 승인 범위대로 운영/공유 서비스 검증을 실행하지 않는다. 분류 시간·전체 CI 절약 시간은 아직 실측하지 않았고 추정 수치를 완료 근거로 쓰지 않는다. branch protection strict/context check/integration 유지 여부는 메인의 직접 조회 인계이며 이 담당이 원격 보호 설정을 수정하지 않는다.
