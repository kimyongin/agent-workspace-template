# Template-10-01 — 기록·원칙·연결의 빠른 업무 검사

작성: 2026-10-04
상태: 진행 중
검토 기준: `46f4cbef3c8098626647055ec741463eb1aa3066`
선행: Template-08 PR #70/71/72·Template-09 PR #73 완료

## 목표와 기준 문서

2026-10-04 사용자가 T02-5/6을 제외한 잔여 작업을 우선순위대로 진행하도록 승인했다. [Template-10](template-10-priority-completion.md)의 첫 조각으로 서비스 없이 실제 기록 CRUD·원칙 상태 전환·적용 원칙·태그 연결 및 목록 입력을 검사한다. [T02-1 계약](template-02-t02-1-contracts.md)·[Template-08](template-08-mock-first-testing.md)·[개발 방법](../development/workflow.md#실행-검증)·[보안](../security/guide.md)을 따른다. PRD·ADR 이탈이 필요하면 사람에게 변경안을 인계한다.

## 작업과 완료 조건

- [x] 실제 기록 생성·조회·수정·삭제와 stale 쓰기 거부, 제목/요약 변경만 색인하는 규칙을 검사한다.
- [x] 실제 원칙 비활성·대체 참조·재활성 규칙과 적용 원칙의 현재 응답을 검사한다.
- [x] 태그/원칙 연결의 생략 유지·빈 배열 제거와 목록 필터 전달·커서 범위 검사를 추가한다.
- [x] 실제 HTTP route·MCP ToolDef schema/handler의 정상 결과 및 입력·업무 오류 본문을 교차 검사하고 발견한 원칙 도구의 오류 fields 차이를 수정한다.
- [ ] 최종 로컬 commit의 독립 리뷰·격리 integration CI·최신 main·머지를 확인한다.

## PR 분할 계획

| 순서 | 브랜치 | 결과 | 남은 범위 |
| --- | --- | --- | --- |
| 1 | `codex/fast-knowledge` | 새 fast 검사 한 파일과 현재 문서 요약 | 실제 DB·SDK 전송·OAuth·RLS·rollback·경쟁은 기존 통합 검사 |

## 검증

실제 package 명령 `npm ci`, `test:fast`, `check:deno`, `check:docs`, `check:boundaries`, `build`, `git diff --check`를 구현 세션이 실행한다. Deno fast 명령에는 net/env/read 권한·dotenv·서비스 키가 없다. 목록 포트는 테스트가 지정한 응답을 그대로 반환하며 실제 SQL 필터 결과를 모의 구현하지 않는다. 적용 원칙의 현재 요약도 outbound read fixture다. application의 전달·응답 변환만 검사하고 현재 DB join·소유자 참조 검증의 성공 증거로 쓰지 않는다. 실제 인증·저장·SDK 전송·브라우저는 메인이 최종 revision의 기존 integration CI로 확인한다.

## 구현 인계와 완료 기록

- 담당: `/root/implement_fast_knowledge` 구현 서브세션. 소유는 `supabase/tests/fast/knowledge-flow.test.ts`, 이 자식·Template-10 부모 티켓·START-HERE·overview·Template-09 현재 요약이다. 메인이 발견한 작은 확정 계약 결함의 수정을 추가 배정해 `adapters/mcp/principle-tools.ts`도 수정했다. Entity 구현은 별도 worktree이며 `task-flow.test.ts`·Entity 파일은 편집하지 않는다.
- 작업 공간: `C:/Users/yongin/.codex/worktrees/fast-knowledge/agent-workspace-template`, branch `codex/fast-knowledge`, 위 base. 시작 변경은 메인이 작성한 미커밋 Template-10 부모 티켓 하나다.
- 배정: desktop balanced `gpt-6.1-sol`/`medium`. 확정 계약의 일반 테스트 확대라 균형 모델과 medium을 유지한다. 메인이 오늘의 실제 도구 카탈로그로 만든 저장소 밖 TEMP `overnight-desktop-snapshot.json`과 preflight 통과를 인계했다. 명시 배정 수락과 backend 실제 모델/effort는 구분하며 실제 metadata·세션 비용은 미노출이다.
- 계약·의존성: 업무 application·contracts·HTTP/MCP를 그대로 실행한다. outbound 저장·Actor verifier만 fixture다. fixture에 인증·잠금·rollback·RLS를 모의 구현하지 않는다. Entity schema 변경에 의존하지 않으며 최신 main 통합 시 영향받는 목록 계약을 다시 검사한다.
- 정상 결과: 기록의 태그 생략 유지/비우기, 원칙 적용 연결 제거, inactive 원칙의 기록 응답 유지·현재 title/status/version, replacement 자기 참조/없는 항목 거부·활성화 시 연결 해제, body/applies_when/status/links의 임베딩 무호출을 검사한다. 필터 테스트는 tag/task/date·active 기본·inactive 명시·limit+1·커서 위치 전달과 필터 바꾼 커서의 포트 무호출을 확인한다.
- 로컬 인계 이후 정확한 base/head의 독립 리뷰·최종 CI·머지는 메인이 담당하며 외부 최종 증거는 PR 완료 코멘트·checks에 둔다.

| 시점·사건 / 세션·역할 | 직접 실행·확인 | 결과·미확인 / 다음 행동 |
| --- | --- | --- |
| 배정·설치 / 구현 세션 | checkout·기준 문서·실제 application/ports/routes/tools·SQL 저장 계약 확인, `npm ci` | 168 packages·audit 0 vulnerabilities. 로컬 Supabase는 공유 환경 예약으로 실행하지 않음 |
| 첫 fast 검사 / 구현 세션 | `test:adapters:fast` | 새 4개 중 3 통과, 기존 6 통과. 수정 schema의 중복 validation으로 아래 기존 fields 차이를 발견; 정상 editable field와 금지 status를 함께 넣어 범위 내 exact-body 검사를 유지 |
| 전체 fast·정적 검사 / 구현 세션 | `test:fast` | core 59·fast 10·web 1 통과(총 70), wall 7.58초. `check:deno` 타입·lint 통과 뒤 새 파일 fmt 실패. 새 파일만 Deno formatter 적용; 재검증 결과 아래 추가 |
| 계약 결함 회귀·수정 / 구현 세션 | 기존 실패 입력을 회귀에 추가하고 `principle-tools.ts`를 수정 | 첫 safeExtend 시도는 id가 수정 필드 판단에 포함돼 여전히 실패. id를 분리한 원본 계약 검증으로 바꿨다. 파생 ToolDef schema도 id 제외 후 원본 refinement를 재사용한다. Zod issue 직접 전달의 타입 오류는 spread로 해결. actual handler와 schema의 정상 수정·빈 수정·금지 status·활성+대체 연결을 검사; 다른 task/record handler는 이미 id 분리 후 원본 계약 검사였음 |
| 수정 후 최종 로컬 검증 / 구현 세션 | `test:fast`, `check:deno`, `check:docs`, `check:boundaries`, `build` | 59+10+1=70 tests 통과(마지막 fast wall 6.19초·suite 314ms). Deno 타입·lint·fmt 78/82 files 통과(wall 2.48초). 문서 239개·32 tests·모델 정합성 통과(wall 3.29초). 경계 통과(wall 1.09초). build 통과(wall 2.72초), 기존 500kB chunk 경고 유지. 실제 서비스·DB·SDK wire·브라우저 실행 없음 |
| 문서 증거 기입 후 / 구현 세션 | `check:docs`, `git diff --check` | 문서 239개·32 tests 재통과(wall 3.07초), diff 공백 검사 통과. 제출 snapshot과 기존 역사적 완료 기록은 보존하며 현재 T02-4 재개·PR #73 완료를 요약에 반영 |

### 발견과 수정

기존 `update_principle`에서 `{expected_version:2,status:"active"}`만 보내면 HTTP는 금지 `status`의 fields 하나, MCP handler는 거기에 `(입력)`의 "바꿀 필드가 없습니다"를 추가했다. 두 접점 모두 `invalid_input`이고 저장하지 않았지만 T02-1의 같은 오류 본문 계약과 달랐다. 원인은 `withId(principleUpdate)` 검사 뒤 contracts를 다시 검사하는 순서다. 메인의 추가 배정에 따라 handler를 원본 계약 직접 검사로 맞추고 ToolDef schema의 원본 refinement도 유지했다. 정확한 실패 입력·빈 수정·정상 수정과 active/replacement 거부 회귀가 통과했다. HTTP/MCP 업무 의미·DB·인증 정책은 바꾸지 않았다.

Supabase 스킬의 외부 자료 확인은 2026-10-04 [JWT 정본](https://supabase.com/docs/guides/auth/jwts)·[changelog](https://supabase.com/changelog)으로 수행했다. markdown changelog endpoint는 web 도구의 unsupported content-type으로 읽지 못해 HTML 정본을 사용했다. Supabase SDK·JWT 검증·migration·RLS는 변경하지 않았으며 이 outbound fixture의 성공을 실제 인증/DB 증거로 확대하지 않는다.
