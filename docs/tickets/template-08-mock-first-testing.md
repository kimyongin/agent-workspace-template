# Template-08 — 포트 교체로 빠른 업무·HTTP/MCP 검증

작성: 2026-10-04
상태: 진행 중 (첫 PR 구현·로컬 검증, 독립 리뷰·CI·머지 대기)
검토 기준: `29071c13337e44561dd6d6753707369325aebc62`
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
- [ ] 새 head의 실제 통합 CI·독립 리뷰·머지 확인. 최종 증거는 PR 완료 코멘트와 checks가 소유한다.

fixture는 이 직렬 흐름의 insert/get/update·요청 결과 저장·색인 등록만 지원하며 나머지 포트는 명확히 실패한다. 상태·완료·입력·요청 hash/재시도 판단은 실제 core/contracts가 수행한다. fake는 SQL·RLS·OAuth·잠금·rollback을 모사하지 않으며 실제 DB 동시성·트랜잭션·사용자 격리의 증거가 아니다.

## PR 분할 계획

| 순서 | 브랜치 | 내용과 직접 확인할 결과 | 남은 범위 |
| --- | --- | --- | --- |
| 1 | `codex/mock-fast-tests` | Supabase 없이 첫 할 일 업무와 HTTP/MCP handler 계약을 `npm run test:fast`로 확인. 승인된 세션 실행 담당·보고 지침 정리 | 실제 통합 CI·독립 리뷰 후 머지 |
| 2 | 미배정 | 필요한 업무·worker·화면의 fast 검사 확대와 중복 검증 정리 | 전 기능 fake·가짜 OAuth·환경 자동화는 선행 조건 아님 |

## 검증

명령과 검사 역할은 [개발 방법](../development/workflow.md#실행-검증)이 정본이다. 구현 세션이 이 worktree에서 설치·검사·실패 조사·수정·재검증을 직접 담당한다. 실제 통합 DB는 로컬 개발 DB로 대체하지 않고 새 PR의 격리 CI 러너에서 실행한다. 제출 snapshot 결과는 아래 기록에 남긴다.

## 구현 인계와 완료 기록

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
