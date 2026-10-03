# Template-10-05 — 개발 세션 실행과 대표 과제 평가

작성: 2026-10-04
상태: 완료(PR #76 독립 리뷰·CI·머지, 미관측 범위 보존)
검토 기준: `46f4cbef3c8098626647055ec741463eb1aa3066`
선행: Template-05·07의 모델 선택 정책 유지

## 목표와 기준 문서

사용자가 T02-5/6을 제외한 잔여 작업을 진행하도록 지시해 [Template-05](template-05-agent-model-policy.md)의 미확인 native child/resume·대표 구현/리뷰·관찰 가능한 품질/사용량을 좁은 동일 과제로 검증한다. [개발 정책](../development/workflow.md#모델과-추론-강도-선택갱신)과 [실행 경로](../development/agent-model-execution.md)를 따른다. 신규 후보를 실행 smoke만으로 승격하거나 모델 정책을 바꾸지 않는다. 개인 전역 설정·CLI 업데이트·새 유료 서비스·T02-5/6은 수행하지 않는다.

## 작업과 완료 조건

- [x] actual CLI 버전·현재 계정의 모델 목록/해석과 지원 강도를 확인하고 개발일 snapshot으로 preflight를 통과한다(Claude 전체 목록이 아닌 sonnet 직접 해석 범위).
- [x] 같은 revision의 고정 구현 과제와 심은 권한/일관성 결함 리뷰를 지원 모델에서 수행한다.
- [x] native child 실행과 같은 설정 resume의 실제 관찰을 구분하고 명시 값·actual metadata·내부 helper를 기록한다(Codex custom 미지원, backend effort 미노출 유지).
- [x] elapsed·재시도·검증 결과·실제 노출 token/cost를 구분한다. ChatGPT 계정 사용량을 세션 비용으로 배분하지 않는다.
- [x] 관찰되지 않은 backend effort/청구비용은 미확인으로 남기며 완료한 범위만 현재 요약에 반영한다.
- [x] 독립 리뷰·필수 CI·머지 조건을 확인한다(PR #76).

## PR 분할 계획

| 순서 | 브랜치 | 결과 | 기준 |
| --- | --- | --- | --- |
| 1 | `codex/model-evaluation` | 재현 가능한 작은 평가 과제와 실제 실행 증거·한계 | Template-05·개발 정책 |

## 검증

실제 지원 목록과 help로 확인한 CLI만 사용한다. 과제는 저장소 밖 격리 workspace 또는 experiments의 명시된 고정 자료로 실행하고 앱/DB/운영에 접근하지 않는다. prompt/로그의 토큰·개인정보·비밀은 외부에 남기지 않으며 보고에는 제한된 과제와 관찰값만 기록한다. 재개 동작과 모델 변경 재개는 별개로 검증하고 미지원 도구에서 기존 설정이 바뀌었다고 주장하지 않는다.

## 구현 인계와 완료 기록

별도 model-evaluation worktree, `codex/model-evaluation`, base 위 revision. 메인은 현재 Codex CLI 0.147.0·Claude Code 2.1.140 실제 help를 조회했으며 이는 모델 능력/새 실행 증거가 아니다. desktop 모델 목록은 현재 collaboration tool catalog에서 확인했다. 실제 CLI 모델 목록은 구현 담당이 조회한다. 공식 문서는 [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)·[모델](https://learn.chatgpt.com/docs/models)을 메인이 열어 확인했고 CLI/desktop 지원 및 request와 backend actual 관찰을 구분한다. 구현·평가 담당은 다음 배정에 명시하며 개인 설정과 기존 앱 작업을 보존한다.

### 실행 결과와 좁은 종료 조건

담당 `evaluate_models` 구현·평가 서브세션은 develop-agent-app과 OpenAI Docs 스킬·공식 문서를 읽고 고정 [실험](../../experiments/agent-model-evaluation/README.md)을 수행했다. fixture revision `e3826297d6851f6334fecc368a3b5b692a270a0e`, Node `v24.15.0`, Windows PowerShell, 위 CLI 버전을 사용했다. 메인이 당일 desktop 균형 `gpt-6.1-sol`/`medium` 명시 배정을 인계했다. 일반 fixture·증거 작업에 균형/medium을 유지했고 모델/강도 상향·하향은 없다. 이 서브세션의 backend model/effort·사용량은 미노출이며 별도 CLI 관찰값으로 대신하지 않는다.

| 범위 | 실제 결과 | 한계·다음 행동 |
| --- | --- | --- |
| 계정/client 조회·배정 | Codex `model/list` 전체 visible 4개·nextCursor null, terra medium 지원. Claude sonnet 직접 probe의 init/usage `claude-sonnet-4-6`, medium 옵션 수락. 원 조회 snapshot·정정 후 각 구현/리뷰 assign 통과 | Claude 전체 alias 목록/다른 등급 미확인. 최초 잘못된 context/7자리 timestamp로 거부 후 wrapper가 계속한 절차 오류·원 실행은 보존; 주 과제는 통과 후 같은 깨진 자료로 새 세션 재실행 |
| 대표 구현·리뷰 | 두 baseline 구현의 동일 oracle 4/4. 리뷰 각각 심은 4/4와 근거·검사 제안. Claude 경쟁 테스트 제안의 “Both should throw” 문장은 부정확성으로 기록 | 작고 명시적인 2과제/모델. 신규 후보 승격·광범위 품질/비용 우수성 판단 없음 |
| native/재개 | Claude 실제 Agent task-balanced child·meta agentType·child Sonnet 모델·completed 확인. 양쪽 동일 model/medium 부모 세션 재개는 동일 ID·marker·이전 결함 복원 | Codex generic child를 custom으로 세지 않음. 정확한 custom 재시도는 도구에 agent_type 미노출로 종료. child 자체/설정 변경 resume·backend effort 미확인. Claude child의 정본 guidance read 준수 미확인 |
| 시간·토큰·비용 | wrapper elapsed·CLI usage와 Claude 주 모델/helper 별도 기록. Codex 최초 read-only 차단은 환경 실패, 격리 retry로 성공. custom 첫 capacity 오류도 환경 실패 | CLI costUSD는 실제 subscription 청구액이 아님. Codex 세션 cost 미노출·resume usage 누적. 계정 사용률·API 단가 추정 없음 |

native custom 지원이 생긴 CLI에서 해당 경로를 재확인하고 backend effort/실제 청구액은 공급자 근거가 노출될 때만 확정한다. 현재 미지원 경로는 추가 우회·CLI 업데이트·전역 설정 변경 없이 종료한다. [선택표](../development/agent-models.json)와 native 설정은 변경하지 않았다. 앱·DB·공유 서비스·운영 배포·T02-5/6 작업은 없다.

### 검증과 인계

| 명령·범위 | 결과 |
| --- | --- |
| `npm ci` | exit 0, lockfile 168개 설치·audit 취약점 0 |
| `node experiments/agent-model-evaluation/verify-results.mjs` | 입력 hash 일치. 격리 복사한 깨진 baseline은 의도한 4실패, 두 저장된 구현은 각각 4통과 |
| `node --test oracle.test.mjs`(각 CLI 임시 결과 폴더, 담당자 직접 재실행) | 양쪽 4통과; 모델의 성공 보고만으로 판정하지 않음 |
| `npm run check:docs`, `git diff --check` | 최신 main `a59d58cc8ca5e65f24c3d31c7504367db79d0a01` merge 후 검증 head `2db674525cd3a3802c45c1a27dde66a1bec57e25`: docs 텍스트 274개·모델/native 정합성·script 36통과/실패0/skip1(기존 플러그인 Windows symlink privilege 제약), diff 통과. 이후 결과 기록·입력 prompt 추가 후 최종 재검사 |

로컬 구현·평가 결과와 정확한 commit head를 메인에 인계한다. 독립 리뷰·최종 head 필수 CI·PR·머지는 메인이 수행하며 이 티켓의 체크박스로 완료를 선점하지 않는다. 원 임시 로그에는 fixture·안내만 있고 보고에는 선택된 metadata·응답·코드·hash만 보존했다.

변경량은 400줄을 넘지만 대부분 동일 고정 자료·실제 응답·JSON 관찰값이다. 성공 결과만 선택하지 않고 초기 절차/환경 실패·retry·helper 사용량을 함께 리뷰할 수 있도록 한 티켓에 묶었다. 실행 framework·앱 구현·모델 정책 확장은 없다. fixture commit을 보존하기 위해 최신 main은 rebase 대신 merge했으며 고정 입력 hash는 그대로다.

## 제출 후 현재 완료 기록

2026-10-04 release 담당이 GitHub MERGED·merge SHA를 직접 확인했다. [PR #76](https://github.com/kimyongin/agent-workspace-template/pull/76)·[checks](https://github.com/kimyongin/agent-workspace-template/pull/76/checks)의 독립 리뷰·CI·머지 완료, merge `09851bb1caa754a58f6542f24442735f90214d0d`. 위 구현·제출 snapshot은 당시 이력으로 보존하며 운영 배포·미지원 도구·미노출 backend/실청구액·미접근 클라이언트의 추가 완료를 뜻하지 않는다.
