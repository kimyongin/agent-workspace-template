# Template-08-01 — 색인 worker 실패 경계와 OAuth 동의 요청 생명주기 검사

작성: 2026-10-04
상태: 진행 중 (구현·로컬 검증 완료, 독립 리뷰·CI·머지 대기)
검토 기준: `3166941041f64d79237b9fa14e6bab69c3d866ef`
선행: [Template-08](template-08-mock-first-testing.md)의 빠른 검사 runner

## 목표와 기준 문서

사용자가 승인한 mock 우선 후속 작업 중 실제 `indexBatch`의 실패·재시도·오래된 결과 처리를 서비스 없이 확인한다. 제출 후 CI 조사에서 드러난 OAuth 동의 화면의 중복 조회 경합도 수정하고, id·사용자 변경과 늦은 응답을 포함한 요청 생명주기를 실제 React/SDK 회귀로 확인한다. [PRD](../product/concept.md), [ADR-0003](../adr/0003-core-rules-and-local-transactions.md)·[0004](../adr/0004-summary-single-vector-search.md), [검색 가이드](../architecture/search.md), [보안 가이드](../security/guide.md), [빠른 검사 규칙](../development/verification.md#실행-검증)을 따른다. PRD·ADR 이탈이 필요하면 변경안으로 사람의 승인을 받는다.

worker 검사에서 교체 대상은 outbound `IndexQueue`·`Embedder`뿐이다. 실제 worker가 업무 판단을 수행하며 작은 stub는 지정한 claim/source/응답과 호출 인자만 제공·기록한다. DB 잠금·visibility timeout·RLS·최신 해시 조건부 저장은 모사하지 않으며 기존 실제 DB worker 통합 검사가 그 보장을 확인한다. OAuth 회귀는 실제 App/StrictMode/SDK와 synthetic session을 실행하고 outbound Auth HTTP만 교체한다. migration·서버 인증 정책 변경·공급자 API 변경·운영/공유 서비스·유료 호출·T02-4 재개는 범위 밖이다.

## 작업과 완료 조건

- [x] 실제 worker의 transient/invalid_response 재시도 지연과 read count 소진 경계, input_limit 제외와 configuration 실패를 검사한다.
- [x] 제목·요약의 누락/공백/Unicode 길이 경계, prepare null, 성공 payload/pipeline/scope/vector, finish false와 알 수 없는 오류 전파를 검사한다.
- [x] 기존 `test:core` → `test:fast`/CI에서 새 검사를 실행하고 정적 검사 증거를 남긴다. 실제 DB 통합 검사는 유지한다.
- [x] 제출 후 CI에서 드러난 동의 조회 경쟁을 조사하고 컴포넌트별 요청 공유·오래된 응답 차단을 실제 React/SDK 브라우저 회귀로 검사한다(아래 소유권 확대 기록).
- [ ] 정확한 제출 head의 독립 리뷰·CI·머지 확인(최종 증거는 PR 완료 코멘트·checks).

## PR 분할 계획

단일 PR `codex/mock-worker-failures`: worker 실패 경계를 `npm run test:core`에서 직접 확인한다. 제출 후 integration 실패 조사에서 실제 동의 화면의 조회 경쟁이 확인돼 같은 승인 범위에서 좁은 화면 수정·회귀를 함께 완료한다. base 대비 최종 diff는 신규 E2E 111줄을 포함해 추가 389줄·삭제 5줄(변경 총 394줄)이며 약 400줄 기준 안에 있다. 필수 CI 실패의 근본 수정·증거가 연결된 범위이고 환경/runner 기반은 확장하지 않는다. 병렬 할 일 mutation 작업과 source/fixture/공통 문서를 공유하지 않으며 main에서 독립 출발한다. 공통 문서·상위 티켓 갱신은 병렬 작업 A 담당이다.

## 검증

구현 세션이 이 worktree에서 `npm ci`, `npm run test:core`, `npm run test:fast`, `npm run check:docs`, `npm run check:deno`, `npm run check:boundaries`, `git diff --check`를 실행하고 실패 조사·수정·재검증까지 맡는다. runtime net/env/read 권한·`.env.local`·Docker·공급자 자격 증명은 추가하지 않는다. 의존성 다운로드는 초기 준비다. 초기 worker 검사 제출에서는 production build를 생략했으며, 아래 실제 웹 source 수정 후에는 build와 좁은 브라우저 회귀를 실행한다. 기존 전체 CI를 유지한다.

## 구현 인계와 완료 기록

- 작업 공간: `C:/Users/yongin/.codex/worktrees/mock-worker-failures/agent-workspace-template`, branch `codex/mock-worker-failures`, 위 base, 시작 미커밋 변경 없음.
- 단독 작성·검증·수정 담당: `/root/implement_mock_worker`. 초기 소유 파일은 `supabase/functions/_shared/core/search/index-worker.test.ts`와 이 티켓이었다. 메인은 범위·Git/PR·독립 리뷰·CI·머지를 조정한다.
- 제출 후 CI 조사에서 메인은 `src/features/auth/ConsentPage.tsx`·신규 `e2e/consent.spec.ts`의 단독 작성·검증·수정 소유권도 같은 구현 세션에 이전했다. 기존 `e2e/support.ts`, A 소유 파일, SDK/API·인증 계약·공유 서비스는 변경하지 않는다.
- 명시 배정: Codex desktop 균형 `gpt-6.1-sol`/`medium`. 작은 core 포트 검사에는 균형 모델과 기본 강도가 적절하다. 같은 날 메인 preflight 통과를 전달받았으며 snapshot은 저장소 밖 `C:/Users/yongin/AppData/Local/Temp/agent-model-policy-72160416d73f40678174f92a0f6b8652/environment-desktop-20261004.json`. backend 실제 model/effort/token metadata는 미노출이다.

| 시점·사건 / 세션·역할 | 작업·목적 / 기준 head | 모델·강도 / 이유 | 실행 확인·근거 | 결과·다음 행동 |
| --- | --- | --- | --- | --- |
| 2026-10-04 배정 / `/root/implement_mock_worker` 구현 | worker 빠른 실패 검사 / `3166941` | 균형 `gpt-6.1-sol`/`medium`, 작은 core 포트 검증 | 메인의 같은 날 preflight 보고·명시 배정 전달, 실제 backend metadata 미노출 | 실제 계약 읽기·clean checkout 확인, 두 파일 작성 후 직접 검증 |
| 2026-10-04 인계 / 같은 세션·구현 | 두 신규 파일 / `3166941` 위 미커밋 patch | 배정 유지, 범위·강도 변경 없음 | 이 worktree에서 아래 검사 직접 실행, 메인의 실행과 구분 | 신규 35개·core 59개 통과, 실제 통합·독립 리뷰·CI·Git은 메인 인계 |
| 2026-10-04 CI 조사 재개 / 같은 세션·구현 | 동의 화면 실패 조사·수정 / PR #71 `26763a1` | 같은 `gpt-6.1-sol`/`medium`, 작은 요청 생명주기 경계; 메인 investigate preflight 전달 | CI log/trace 직접 읽기, 원인·수정안 보고 후 메인이 두 auth 파일 소유권 이전; backend metadata 미노출 | 실제 버전의 잠금 계약 확인, DB 없는 브라우저 재현·수정·회귀·build 직접 실행; 새 head CI·독립 리뷰는 메인 |

### 제출 snapshot

실행 환경은 Windows PowerShell, Node `v24.15.0`, lockfile의 Deno `2.9.6`이다. 검증 revision은 `3166941041f64d79237b9fa14e6bab69c3d866ef`와 이 PR의 두 신규 파일이다. 모든 명령은 위 담당자가 자신의 worktree에서 실행했다. 시간은 도구가 관찰한 wall time 또는 runner가 출력한 시간이며 모델 사용량·비용 비교 증거는 아니다.

| 명령 | 직접 관찰한 결과 |
| --- | --- |
| `npm ci` | exit 0, 168 packages, 5초, audit 0 vulnerabilities |
| `npm run test:core` | 첫 실행: 신규 테스트의 동적 queue method 할당 TS2322. 반환 타입 `Promise<never>` 명시 후 재실행 exit 0, 59 passed/0 failed(신규 worker 35개), runner 717ms / 명령 2.83초 |
| `npm run test:fast` | exit 0, core 59(694ms)·빠른 adapter 3(47ms)·웹 1(890ms), 명령 7.98초 |
| `npm run check:docs` | exit 0, 텍스트 234개·모델/native 정합성·script 32개, 명령 3.97초 |
| `npm run check:deno` | exit 0, 타입 검사·lint 77개·format 81개, 명령 4.83초 |
| `npm run check:boundaries`·`git diff --check` | exit 0. 신규 파일 인코딩·LF·링크는 문서 검사, TS 포맷은 Deno 검사로 확인 |

성공 벡터는 작은 포트 응답으로 전달만 검사한다. 1024차원 공급자 응답 검증은 기존 어댑터 검사가 소유한다. 900초 retry 상한은 현재 5회 소진 경계에서 도달하지 않으므로 유효 read count의 30/60/120/240초를 확인한다. 실제 SQL worker 검사는 `supabase/tests/database/index-worker.test.ts`에 그대로 유지했으며 DB 최신 결과 거부·재전달·역할/권한 보장은 integration CI에서 확인한다. 이 로컬 작업은 서비스·DB·HTTP/MCP 전송·실제 Pinecone 품질을 검증하지 않았다. PR 최종 head·독립 리뷰·CI·머지는 메인 조정 담당자가 PR 완료 코멘트와 checks로 기록한다.

### 제출 후 CI 동의 화면 경쟁 조사와 수정

[PR #71](https://github.com/kimyongin/agent-workspace-template/pull/71)의 `26763a195309a12a517123735f40706018a17c72`는 check·독립 리뷰를 통과했지만 [실패 CI run 37143086905](https://github.com/kimyongin/agent-workspace-template/actions/runs/37143086905)의 integration E2E에서 mobile 태그 시나리오의 `e2e/support.ts:62` callback code 대기가 5000ms에 실패했다(42 passed/9 skipped/1 failed). 원본 failed log와 artifact `playwright-results`(ID `11281750475`, 345378 bytes)를 재실행 전에 저장소 밖에 보존했다: `C:/Users/yongin/AppData/Local/Temp/template-worker-71-ci-failed.log`, `template-worker-71-ci-full.log`, `template-worker-71-artifacts/`, 압축 해제 `template-worker-71-trace/`. 비밀·인가 code 값은 티켓에 복사하지 않는다.

trace는 단순한 callback 지연과 다른 실패를 보였다. 동의 details GET 두 개가 같은 authorization에 시작됐고 첫 응답은 `18:14:33.191 UTC`, 승인 POST 시작은 `33.253`, 404 완료는 `33.319`, 두 번째 GET 완료는 `33.351`이었다. POST는 `oauth_authorization_not_found`/`authorization not found`를 반환했고 화면에 처리 실패 alert가 남았다. 최초 authorize는 한 번이며 두 GET의 id·응답이 같아 새 id 생성이나 token 소비 경로가 아니었다. source의 `StrictMode` effect replay가 중복 GET을 시작했다.

실제 CI log의 image는 `supabase/gotrue:v2.197.0`이다. 그 버전의 [GET/consent 구현](https://github.com/supabase/auth/blob/v2.197.0/internal/api/oauthserver/authorize.go#L183)과 [행 조회 구현](https://github.com/supabase/auth/blob/v2.197.0/internal/models/oauth_authorization.go#L235)을 확인했다. 두 경로 모두 `FOR UPDATE SKIP LOCKED` 조회를 쓰므로 다른 요청이 잠근 authorization은 not-found가 될 수 있다. trace의 POST와 두 번째 GET 겹침은 이 잠금 경쟁과 일치한다. trace만으로 DB 잠금 자체를 관찰한 것은 아니며 버전 구현·요청 순서·오류로 원인을 판단했다. 설치 SDK의 `getAuthorizationDetails`·`approveAuthorization`도 각각 GET·POST라는 것을 source에서 확인했다. Supabase 스킬과 디자인·보안 가이드를 적용했으며 changelog 조회는 수행했지만 SDK/API 계약 변경은 하지 않았다.

수정은 `ConsentPage` 인스턴스의 authorization id+현재 사용자 id로 요청 promise를 공유한다. effect cleanup 뒤 응답은 적용하지 않으며 새 id/사용자의 details가 오기 전 이전 내용은 표시하지 않는다. 캐시는 전역이 아니며 StrictMode·재시도·timeout·서버 권한은 바꾸지 않는다. 사용자 승인/거부와 실제 redirect는 기존 SDK가 담당한다.

| 직접 실행한 명령·검사 | 결과·한계 |
| --- | --- |
| 저장소 밖 `template-worker-71-repro.mjs` | 실제 App/StrictMode/SDK와 synthetic session, outbound HTTP fixture로 수정 전 GET 2개·consent 404·UI alert, 수정 후 GET 1개·consent 200 확인. fixture는 실제 DB 잠금 증거를 대신하지 않는다. 첫 임시 Vite alias 누락은 기존 `@contracts` alias를 맞춰 수정 |
| `npx playwright test --config C:/Users/yongin/AppData/Local/Temp/template-worker-71-playwright.config.mjs` | 신규 세 시나리오 desktop/mobile 6 passed, 8.8초. 실제 App/StrictMode/SDK; 단일 조회 후 승인, id 변경 후 늦은 redirect 차단, user 변경 후 재조회와 이전 응답 차단. 초기 synthetic JWT header 형태 오류로 setSession 실패해 올바른 명백한 fixture JWT 구조로 고친 뒤 통과 |
| 같은 임시 config의 HEAD 원본 load override, `--grep 'StrictMode shares' --project desktop` | 대표 회귀가 원본에서 GET 2개로 실패함을 확인(1 failed). 원본은 저장소 밖에 보존하고 tracked source를 되돌리지 않음 |
| `npm run test:fast` | 수정 후 exit 0, core 59(564ms)·adapter 3(48ms)·web 1(248ms), 명령 4.39초 |
| `npm run build` | exit 0, TypeScript·Vite 421 modules, 명령 2.49초. 기존 500KB 이상 chunk 경고(747.75KB) 유지 |
| `npm run check:deno`·`npm run check:boundaries`·`git diff --check` | 수정 후 모두 통과 |
| `npm run check:docs` | 최종 티켓 수정 후 exit 0, 텍스트 235개·모델/native 정합성·script 32개. 신규 E2E의 diff whitespace 오류 없음 |

임시 Vite config는 독립 ephemeral port·가짜 공개 Supabase URL/key·`envDir: false`만 쓰며 실제 Supabase·공유 서비스·개발 계정·공급자 호출 없이 실행했다. 신규 E2E는 실제 SDK에 synthetic session을 설정하고 Auth HTTP만 가로챈다. 실제 OAuth/사용자 권한·DB 보장은 새 제출 head의 full integration CI로 검증해야 한다. 새 head의 독립 리뷰·CI·머지 결과는 PR 완료 코멘트·checks가 소유한다.
