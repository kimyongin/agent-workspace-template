# Template-08 — 포트 교체로 빠른 업무·HTTP/MCP 검증

작성: 2026-10-04
상태: 진행 중 (첫 PR #70 리뷰·CI·머지 완료, 할 일 수정·삭제와 worker 빠른 검사 병렬 후속)
검토 기준: 후속 base `3166941041f64d79237b9fa14e6bab69c3d866ef`; 첫 제출 base는 아래 snapshot 기록에 보존
선행: Template-07 PR #68, 기존 환경 격리 시도의 [PR #69](https://github.com/kimyongin/agent-workspace-template/pull/69)는 미머지 종료

## 목표와 기준 문서

사용자는 기존 환경 격리 PR을 종료하고 mock 우선 방향으로 새 구현을 진행하도록 승인했다. 일상 업무 검증에서 공유 서비스 의존성을 줄이고 실제 인증·저장 보장은 기존 통합 CI에서 유지한다. 기존 PR #69의 commit·미커밋 변경·실행 증거는 원본 checkout에 보존하며 새 PR에 이전 lifecycle 구현을 옮기지 않는다.

[PRD](../product/concept.md), [ADR-0001](../adr/0001-hexagonal-shared-usecases.md)·[0003](../adr/0003-core-rules-and-local-transactions.md)·[0006](../adr/0006-owner-only-access-and-separate-auth.md), [개발 방법](../development/workflow.md#실행-검증), [보안](../security/guide.md)을 따른다. PRD·ADR 이탈은 사람에게 변경안을 제시한다. migration·운영 DB/서비스·공급자 호출·실제 Google/OAuth·개발 환경 lifecycle·T02-4 재개는 범위 밖이다.

## 작업과 완료 조건

- [x] 실제 application의 할 일 생성→완료→동일 요청 직렬 재시도, 기본 버전 충돌·내용 변경 재시도 거부를 작은 stateful 저장 fixture로 검사한다.
- [x] 실제 HTTP factory/route Request·Response와 MCP ToolDef의 실제 schema·handler로 입력 거부·완료 결과·오류 동등성을 검사한다. MCP SDK 등록/전송 증거는 아니다.
- [x] HTTP 인증은 함수 인자 주입만 추가하고 기본값 `verifyActor`·운영 bootstrap을 유지한다. 기본 경로의 미인증 401·WWW-Authenticate를 검사한다.
- [x] `test:fast`는 기존 core·웹과 새 빠른 어댑터 검사를 실행한다. runtime net/env/read 권한·`.env.local`·Docker·서비스/공급자 자격 증명은 필요 없다. 초기 패키지 다운로드는 가능하다.
- [x] CI `check`에 새 어댑터 검사를 추가하고 기존 `check`·`integration` 이름과 DB·HTTP·MCP·E2E 검사를 유지한다.
- [x] 첫 PR #70의 실제 통합 CI·독립 리뷰·머지 확인. 검토 head `a05a91c8014c643625af08a1b1238bde0884aff8`, 머지 `3166941041f64d79237b9fa14e6bab69c3d866ef`. [독립 리뷰](https://github.com/kimyongin/agent-workspace-template/pull/70#issuecomment-5971838110)·[완료 기록](https://github.com/kimyongin/agent-workspace-template/pull/70#issuecomment-5971872108)·[CI check/integration SUCCESS](https://github.com/kimyongin/agent-workspace-template/actions/runs/37141785739)가 최종 증거다.
- [x] 후속 A: 실제 application 수정→삭제, 제목·요약 재색인과 본문·기한 수정의 구분, 버전 충돌 무쓰기, 결과·회차 기록 보존, HTTP PATCH/DELETE·MCP schema/handler 입력·오류 검사 구현.
- [ ] 후속 A의 최신 main 통합·최종 head CI·독립 리뷰·머지 확인.
- [ ] 후속 B: worker의 서비스 없는 빠른 검사·최종 CI·독립 리뷰·머지 확인. 별도 `docs/tickets/template-08-01-worker-fast-tests.md`에서 추적한다.

fixture는 이 직렬 흐름의 insert/get/update/delete·기록 연결 해제·요청 결과 저장·색인 등록만 지원하며 나머지 포트는 명확히 실패한다. 상태·완료·입력·요청 hash/재시도 판단은 실제 core/contracts가 수행한다. fake는 SQL·RLS·OAuth·잠금·rollback을 모사하지 않으며 실제 DB 동시성·트랜잭션·사용자 격리의 증거가 아니다. 기록 연결 해제는 기존 저장 포트의 필드 변경만 수행하고 삭제 판단은 실제 application에 둔다.

## PR 분할 계획

| 순서 | 브랜치 | 내용과 직접 확인할 결과 | 남은 범위 |
| --- | --- | --- | --- |
| 1 | `codex/mock-fast-tests` | Supabase 없이 첫 할 일 업무와 HTTP/MCP handler 계약 확인. 승인된 세션 실행 담당·보고 지침 정리 | PR #70 머지 완료, 외부 최종 증거 위 연결 |
| 2A | `codex/mock-task-mutations` | 서비스 없이 실제 할 일 수정→삭제와 HTTP/MCP 오류·결과를 확인 | 최신 main 반영 후 최종 CI·독립 리뷰·머지 |
| 2B | `codex/mock-worker-failures` | worker의 원본·최신성·공급자 경계를 서비스 없이 확인 | 독립 브랜치의 별도 티켓·검증; 코드 의존 없음 |
| 후속 | 미배정 | 필요한 업무·화면의 fast 검사 확대와 중복 검증 정리 | 전 기능 fake·가짜 OAuth·환경 자동화는 선행 조건 아님; T02-4 사용자 보류 유지 |

## 검증

명령과 검사 역할은 [개발 방법](../development/workflow.md#실행-검증)이 정본이다. 구현 세션이 이 worktree에서 설치·검사·실패 조사·수정·재검증을 직접 담당한다. 실제 통합 DB는 로컬 개발 DB로 대체하지 않고 새 PR의 격리 CI 러너에서 실행한다. 제출 snapshot 결과는 아래 기록에 남긴다.

## 첫 PR 구현 인계와 완료 기록 (제출 snapshot)

아래는 첫 제출 당시 기록이며 base는 `29071c13337e44561dd6d6753707369325aebc62`다. 제출 후 결과로 당시 실행·인계 내용을 다시 쓰지 않는다.

- 작업 공간: `C:/Users/yongin/.codex/worktrees/mock-fast-tests/agent-workspace-template`, branch `codex/mock-fast-tests`, base 위 revision. 시작 시 승인된 skill/workflow/working-with-agents/tickets README/Template-06 지침 변경 5개가 있었다.
- 작성·테스트·실패 수정 담당: `/root/implement_mock_fast`, tracked 파일 단독 작성. 메인은 범위 판단·Git/PR·CI 증거·독립 리뷰·머지를 조정한다. 이번 로컬 검사는 메인의 직접 실행이 아니다.
- 모델 배정: Codex desktop 균형 `gpt-6.1-sol`/`medium`. 일반 포트·어댑터와 문서 연결 범위라 기본 균형 모델·강도 유지. 메인이 2026-10-04 지원 snapshot/preflight 통과를 인계했다. 명시 배정과 실제 관찰을 구분하며 backend 모델/effort metadata는 미노출이다.
- 승인된 역할/보고 지침을 유지하고 미머지 PR #69의 존재하지 않는 local-environments 안내 링크를 제거했다. Template-06의 당시 메인 직접 문서 검사 증거는 과거 snapshot으로 보존한다.
- 공식 자료 확인: 2026-10-04 [Supabase JWT 안내](https://supabase.com/docs/guides/auth/jwts)·[changelog](https://supabase.com/changelog). 기존 검증 어댑터·SDK API·token policy는 변경하지 않았다. 공식 markdown endpoint의 도구 content-type 오류 뒤 HTML 정본을 확인했다.

| 시점·사건 / 담당 | 직접 실행 결과 | 미확인·다음 행동 |
| --- | --- | --- |
| 첫 구현 / 구현 세션 | `npm ci` 통과(168 packages, audit 0 vulnerabilities). `test:fast` 첫 실패: 동기 MCP schema 예외를 `assertRejects`에 직접 전달. async wrapper로 수정 | 실제 서비스 실행 없음 |
| 수정 후 재검증 / 구현 세션 | `npm run test:fast` 통과(core 24·fast 3·web 1), 도구 wall time 6.94초. fast Deno suite 44ms. 임의 속도 개선율은 산출하지 않음 | 정적 검사·빌드 결과 아래 추가 |
| 정적 검사 수정·재검증 / 구현 세션 | `check:deno` 첫 실패는 fixture의 불필요한 async 8곳(require-await). Promise 반환으로 수정 후 타입·lint·fmt 통과(76/80 files). `check:boundaries` 통과. `build` 통과, 기존 큰 chunk 경고 유지. 수정 후 `test:fast` 재통과(24+3+1), wall time 5.27초·fast suite 43ms | 실제 통합·SDK 전송은 PR CI에서 확인 |
| 문서 최종 재검사 / 구현 세션 | `npm run check:docs` 재통과(텍스트 232개·검사기 32 tests·모델 정합성). `check:deno`·`git diff --check`도 재통과. overview의 직접 작업 예외·START-HERE의 PR #68 머지 기록과 새 mock 티켓 연결을 정본에 맞춤 | 제출 후 최종 head·독립 리뷰·필수 CI·머지는 메인이 확인 |

제거한 fast runtime 의존성은 Docker/Supabase 프로세스·인증 서버·DB 연결·공급자 키·dotenv이다. 실제 SDK 전송·OAuth·RLS·grant·원자성·연결 문맥 재사용·동시 완료는 기존 `integration` CI에서 확인한다. 로그인·웹↔MCP 실제 회귀도 유지한다.

## 후속 병렬 배정과 제출 snapshot

사용자가 후속 작업과 병렬 진행을 승인했다. 사람과 메인이 범위·계약을 정하고 구현 세션은 각자의 파일 작성·테스트·실패 조사·수정·재검증을 단독 담당한다. 공유 서비스는 실행하지 않으며 독립 worktree의 설치·서비스 없는 검사는 병렬로 수행한다. 메인은 Git/PR·최신 main 반영·최종 증거·독립 리뷰·CI·머지를 조정한다.

| 배정 | 단독 작성·테스트/수정/재검증 담당 | 브랜치·worktree | 소유 파일·의존성 |
| --- | --- | --- | --- |
| A 할 일 수정·삭제 | `/root/implement_mock_mutations` | `codex/mock-task-mutations`, `C:/Users/yongin/.codex/worktrees/mock-task-mutations/agent-workspace-template` | `supabase/tests/fast/task-flow.test.ts`, 이 부모 티켓·START-HERE·overview. B 코드 의존 없음 |
| B worker | `/root/implement_mock_worker` | `codex/mock-worker-failures`, `C:/Users/yongin/.codex/worktrees/mock-worker-failures/agent-workspace-template` | `supabase/functions/_shared/core/search/index-worker.test.ts`·`docs/tickets/template-08-01-worker-fast-tests.md`. A 파일 편집 없음 |

- A 시작 base `3166941041f64d79237b9fa14e6bab69c3d866ef`, clean checkout. `.agents/skills/develop-agent-app/` 정본·START-HERE·이 티켓·ADR-0001/0003/0006·보안·workflow와 실제 contracts/application/routes/tools를 확인했다.
- A 모델·강도: 메인이 same-day desktop snapshot 재사용 preflight 통과 후 `gpt-6.1-sol`/`medium`을 명시 배정했다. 기존 계약 안의 테스트 확장이라 균형 모델과 medium을 유지한다. backend 모델/effort·세션 토큰·비용 metadata는 미노출이며 추정하지 않는다.
- A는 기존 fixture에 삭제·연결 해제 저장 메서드만 더했다. 제목/요약의 각 변경은 현재 hash 색인 작업을 등록하고 동일 값·본문/기한 수정은 등록하지 않는다. stale update/delete·missing/deleted ID는 저장·색인·detach 호출까지 snapshot 무변경을 검사한다.
- 일회성 완료 결과와 반복 회차 기록은 실제 application으로 생성한다. 삭제 뒤 task만 없어지고 연결 필드 `task_id`·`occurrence_on`만 비워지며 본문·요약·버전과 관계없는 기록은 보존되는지 검사한다. 실제 DB rollback·경쟁·RLS·OAuth·MCP SDK 전송의 증거는 아니다.
- HTTP 성공은 PATCH 200의 실제 task 계약·DELETE 204 빈 본문, MCP 성공은 실제 handler의 task 계약·`{deleted:id}`다. 숫자 버전·서버 상태 필드·종류 부적합 필드·stale/missing/deleted 오류를 실제 handler와 HTTP 오류 본문으로 교차 검사한다. 운영 인증·core·schema·CI·package·PRD/ADR은 변경하지 않았다.

| 시점·사건 / 담당 | 직접 실행 결과 | 미확인·다음 행동 |
| --- | --- | --- |
| 후속 A 설치·첫 검사 / A 구현 세션 | `npm ci` 통과(168 packages, audit 0 vulnerabilities), wall 5.60초. `npm run test:fast` 통과(core 24·fast 6·web 1), wall 9.69초·fast suite 72ms | 서비스·환경변수·net/env/read 권한 없이 실행 |
| 후속 A 정적 검사 / A 구현 세션 | `check:boundaries` 통과. `check:deno` 타입·lint 통과 뒤 fmt가 긴 호출·loop의 줄바꿈을 거부. 포맷 진단대로 `apply_patch`로 수정 | 수정 후 재검증 결과 아래 기록 |
| 후속 A 수정 후 재검증 / A 구현 세션 | `npm run check:deno` 타입·lint·fmt 통과(76/80 files), wall 2.30초. `npm run check:docs` 통과(텍스트 232개·검사기 32 tests·모델 정합성), wall 3.35초. `git diff --check` 통과. `npm run test:fast` 재통과(core 24·fast 6·web 1), wall 5.14초·fast suite 69ms | 테스트·문서만 변경해 웹 build 재실행 불필요; 기존 CI build 유지. 최신 main 통합 후 필요한 검증과 최종 CI·독립 리뷰·머지는 별도 확인 |
| 후속 A 최종 인계 / A 구현 세션 | HTTP 제목·MCP 요약의 명시 기대값 추가 후 `npm run test:adapters:fast` 재통과(6 tests), wall 2.50초·suite 70ms. 증거 기입 후 `npm run check:docs` 재통과(232개·32 tests), wall 3.25초. `git diff --check` 통과 | 메인이 먼저 준비된 PR부터 순차 머지하고 나중 PR에 최신 main을 반영한다. 작성·검증 주체는 A이며 메인의 직접 실행이 아님 |
