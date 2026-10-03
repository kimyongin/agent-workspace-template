# Template-08-01 — 색인 worker 실패 경계의 빠른 검사

작성: 2026-10-04
상태: 진행 중 (구현·로컬 검증 완료, 독립 리뷰·CI·머지 대기)
검토 기준: `3166941041f64d79237b9fa14e6bab69c3d866ef`
선행: [Template-08](template-08-mock-first-testing.md)의 빠른 검사 runner

## 목표와 기준 문서

사용자가 승인한 mock 우선 후속 작업 중 실제 `indexBatch`의 실패·재시도·오래된 결과 처리를 서비스 없이 확인한다. [PRD](../product/concept.md), [ADR-0003](../adr/0003-core-rules-and-local-transactions.md)·[0004](../adr/0004-summary-single-vector-search.md), [검색 가이드](../architecture/search.md), [빠른 검사 규칙](../development/workflow.md#실행-검증)을 따른다. PRD·ADR 이탈이 필요하면 변경안으로 사람의 승인을 받는다.

교체 대상은 outbound `IndexQueue`·`Embedder`뿐이다. 실제 worker가 업무 판단을 수행하며 작은 stub는 지정한 claim/source/응답과 호출 인자만 제공·기록한다. DB 잠금·visibility timeout·RLS·최신 해시 조건부 저장은 모사하지 않으며 기존 실제 DB worker 통합 검사가 그 보장을 확인한다. migration·인증·공급자 API·운영/공유 서비스·유료 호출·T02-4 재개는 범위 밖이다.

## 작업과 완료 조건

- [x] 실제 worker의 transient/invalid_response 재시도 지연과 read count 소진 경계, input_limit 제외와 configuration 실패를 검사한다.
- [x] 제목·요약의 누락/공백/Unicode 길이 경계, prepare null, 성공 payload/pipeline/scope/vector, finish false와 알 수 없는 오류 전파를 검사한다.
- [x] 기존 `test:core` → `test:fast`/CI에서 새 검사를 실행하고 정적 검사 증거를 남긴다. 실제 DB 통합 검사는 유지한다.
- [ ] 정확한 제출 head의 독립 리뷰·CI·머지 확인(최종 증거는 PR 완료 코멘트·checks).

## PR 분할 계획

단일 PR `codex/mock-worker-failures`: 두 신규 파일만으로 실제 worker 실패 경계를 `npm run test:core`에서 직접 확인한다. 병렬 할 일 mutation 작업과 source/fixture/공통 문서를 공유하지 않으며 main에서 독립 출발한다. 공통 문서·상위 티켓 갱신은 병렬 작업 A 담당이다.

## 검증

구현 세션이 이 worktree에서 `npm ci`, `npm run test:core`, `npm run test:fast`, `npm run check:docs`, `npm run check:deno`, `npm run check:boundaries`, `git diff --check`를 실행하고 실패 조사·수정·재검증까지 맡는다. runtime net/env/read 권한·`.env.local`·Docker·공급자 자격 증명은 추가하지 않는다. 의존성 다운로드는 초기 준비다. 순수 core test·티켓 변경이라 로컬 production build는 생략하고 기존 전체 CI를 유지한다.

## 구현 인계와 완료 기록

- 작업 공간: `C:/Users/yongin/.codex/worktrees/mock-worker-failures/agent-workspace-template`, branch `codex/mock-worker-failures`, 위 base, 시작 미커밋 변경 없음.
- 단독 작성·검증·수정 담당: `/root/implement_mock_worker`. 소유 파일은 `supabase/functions/_shared/core/search/index-worker.test.ts`와 이 티켓뿐이다. 메인은 범위·Git/PR·독립 리뷰·CI·머지를 조정한다.
- 명시 배정: Codex desktop 균형 `gpt-6.1-sol`/`medium`. 작은 core 포트 검사에는 균형 모델과 기본 강도가 적절하다. 같은 날 메인 preflight 통과를 전달받았으며 snapshot은 저장소 밖 `C:/Users/yongin/AppData/Local/Temp/agent-model-policy-72160416d73f40678174f92a0f6b8652/environment-desktop-20261004.json`. backend 실제 model/effort/token metadata는 미노출이다.

| 시점·사건 / 세션·역할 | 작업·목적 / 기준 head | 모델·강도 / 이유 | 실행 확인·근거 | 결과·다음 행동 |
| --- | --- | --- | --- | --- |
| 2026-10-04 배정 / `/root/implement_mock_worker` 구현 | worker 빠른 실패 검사 / `3166941` | 균형 `gpt-6.1-sol`/`medium`, 작은 core 포트 검증 | 메인의 같은 날 preflight 보고·명시 배정 전달, 실제 backend metadata 미노출 | 실제 계약 읽기·clean checkout 확인, 두 파일 작성 후 직접 검증 |
| 2026-10-04 인계 / 같은 세션·구현 | 두 신규 파일 / `3166941` 위 미커밋 patch | 배정 유지, 범위·강도 변경 없음 | 이 worktree에서 아래 검사 직접 실행, 메인의 실행과 구분 | 신규 35개·core 59개 통과, 실제 통합·독립 리뷰·CI·Git은 메인 인계 |

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
