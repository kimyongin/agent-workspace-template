# Template-07 — 지침 재검토 후속 개선

작성: 2026-10-03
상태: 진행 중
검토 기준: `10140767a9e88021abba7b439427c3e643481ff2`
선행: [Template-06 세션 운영 브리핑](template-06-agent-session-briefings.md), PR #66 머지

현재 요약(제출 시점): PR 1은 PR #67로 완료했다. PR 2는 [PR #68](https://github.com/kimyongin/agent-workspace-template/pull/68)의 구현·로컬 검증 snapshot이며 독립 리뷰·필수 CI·머지는 대기 중이다. 제출 후 실제 최종 상태는 그 PR 완료 코멘트와 [checks](https://github.com/kimyongin/agent-workspace-template/pull/68/checks)에서 확인한다. 다음 실제 작업에서 이 요약을 맞춘다.

## 목표와 기준 문서

사용자는 지침 전반의 재검토에서 발견한 여섯 개선 사항과 모델 탐색 정책을 모두 반영하도록 승인했다. 모델 확인일의 시간대 오류, 새 앱 티켓 번호 충돌, 현재 상태와 제출 당시 기록의 혼동, 사람과 메인의 설계 역할, 모델/강도 변경 시 세션 재개 방법, 기술 리뷰 이견의 처리 방법을 개선한다.

모델 탐색은 개발하는 날 첫 작업에서 한 번 하고 같은 계정·클라이언트에서 그날 결과를 재사용한다. 변경이 없으면 기존 모델을 유지하고 유망한 후보에만 필요한 평가를 수행한다. 계정·공급자·클라이언트 변경은 즉시 재확인한다. 별도 스케줄러·휴일 탐색·매일 성능 평가·자동 모델 승격은 만들지 않는다.

[개발 방법](../development/workflow.md), [모델 실행](../development/agent-model-execution.md), [티켓 작성 규칙](README.md), ADR-0007/0008/0010 안의 가이드·검증 변경이다. PRD·ADR 변경, 앱·DB·서비스 배포, T02-4 재개는 제외한다.

## 작업과 완료 조건

- [x] 모델 날짜를 시간대가 포함된 시각으로 바꾸고 개발일 최초 조회 결과를 재사용하는 배정 검사를 적용한다. 시간대 경계·개발하지 않은 기간·미지원/변경 거부를 검증한다.
- [x] 모델/강도가 바뀌는 재개는 지원되는 명시 변경 경로 또는 새 세션 인계로 처리하도록 안내한다.
- [x] 템플릿 개선 이력과 새 앱 `001` 번호 영역을 분리하고 내부 링크·초기화 안내를 맞춘다.
- [x] 현재 상태와 제출 당시 기록·외부 PR 완료 증거의 소유 위치를 정하고 기존 완료 기록을 정리한다.
- [x] 사람과 메인의 설계·결정, 서브세션의 구현·독립 리뷰, 기술 이견 해결 절차를 공통 정본과 얇은 연결에 반영한다.
- [ ] 각각의 PR에서 독립 리뷰와 필수 CI를 통과하고 머지 결과를 PR의 최종 완료 코멘트로 기록한다.

## PR 분할 계획

| 순서 | 브랜치 | 내용 | 완료 기준 | 관련 결정 |
| --- | --- | --- | --- | --- |
| 1 | `codex/guidance-review-followup` | 개발일 모델 탐색·시각 검사·재개 실행 절차 | 휴일 뒤 첫 개발과 자정 경계에서 올바른 배정, 미지원/변경 거부와 검증 근거 구분 | ADR-0007/0008/0010 |
| 2 | `codex/guidance-operating-rules` | 템플릿 티켓 영역·완료 기록·설계와 리뷰 역할 | 새 앱 `001` 생성이 템플릿 기록과 충돌하지 않고, 새 세션이 현재 상태와 담당 결정을 해석 가능 | ADR-0007/0008/0010 |

## 검증

`npm run check:docs`(모델 배정과 일반 티켓 번호 중복 회귀 포함), `git diff --check`. 문서·개발 스크립트 변경의 필수 `check`·`integration` CI는 정확한 PR head에서 확인한다. 로컬 앱·DB 공유 서비스를 조작하지 않는다.

## 구현 인계와 완료 기록

| 필드 | 내용 |
| --- | --- |
| 목표·승인 범위 | 이 대화의 “검토한 모든 내용을 반영하자”, 위 범위와 제외 항목 |
| 기준과 작업 공간 | PR 1 base `1014076`; PR 2 base `b9c02aeb504a9a5faee4337ecb9f5e7cafe668ed`, `codex/guidance-operating-rules`, `C:/Users/yongin/projects/agent-workspace-template`, 각 구현 시작 시 변경 없음 |
| 담당 변경 | 본 세션은 설계·승인 범위·배정·통합·PR·최종 확인·머지. 새 구현 세션이 단계별 tracked 파일을 단독 편집. 리뷰는 새 읽기 전용 세션 |
| 모델과 추론 강도 | Codex desktop 균형 `gpt-6.1-sol` / `medium`: 일반 개발 절차와 작은 검사 변경. 배정 전 현재 선택표와 실제 도구 목록 snapshot preflight 확인. backend metadata는 노출된 범위만 기록 |
| 계약과 의존성 | 위 정본과 ADR, 1번 머지 뒤 최신 main에서 2번 시작. 공유 tracked 파일 동시 편집 없음 |
| 완료 조건과 검증 | 위 체크리스트·검증 절, 사용자 시간대 Asia/Seoul |
| 결과와 다음 행동 | 구현·독립 리뷰·CI·머지 단계별 확인. 이 PR의 제출 시점 이후 결과는 최종 PR 코멘트가 소유하며 상태 전용 PR을 반복하지 않음 |

| 단계 | 상태 | revision / 변경 | 검증 명령·결과 | 남은 작업 |
| --- | --- | --- | --- | --- |
| 1 모델 배정·재개 | 완료 | [PR #67](https://github.com/kimyongin/agent-workspace-template/pull/67), head `20bc7a48e3eba490b83238391ea0cacb717d77e7`, merge `b9c02aeb504a9a5faee4337ecb9f5e7cafe668ed` | [최종 독립 리뷰](https://github.com/kimyongin/agent-workspace-template/pull/67#issuecomment-5970013229)·[필수 CI](https://github.com/kimyongin/agent-workspace-template/actions/runs/37128917674) 통과, 2026-10-03 23:22:01 KST 머지·[최종 완료 코멘트](https://github.com/kimyongin/agent-workspace-template/pull/67#issuecomment-5970048585) | — |
| 2 지침·티켓 기록 | 구현(리뷰 대기) | [PR #68](https://github.com/kimyongin/agent-workspace-template/pull/68)의 제출 시점 snapshot, 위 branch·base 위 변경 | 아래 PR 2 증거 | 독립 리뷰·정확한 head CI·머지, 본 세션이 PR 최종 완료 코멘트에 기록 |

### 세션 실행 기록

배정·중요 변화·결과 인계의 사실과 확인 범위를 여기에 남긴다. 최종 head·리뷰·CI·머지 결과는 각 PR 코멘트를 연결한다.

| 세션·역할 | 작업·선택 이유 | 명시 모델 / 강도 | 확인 범위·결과 | 다음 행동 |
| --- | --- | --- | --- | --- |
| implement_guidance_models / 구현 | PR 1의 작은 배정 검사와 공통 안내, 일반 구현이므로 균형/medium | gpt-6.1-sol / medium, fork_turns=none | 본 세션이 도구에 명시 배정. 아래 로컬 검증 완료. 실제 backend 모델/effort metadata는 미노출 | 본 세션에 결과 인계, 새 독립 리뷰·CI·머지 |
| 2026-10-03 배정 / implement_guidance_rules 구현 | PR 2의 일반 절차·문서 연결과 작은 번호 검사: 균형 모델, medium은 이 범위의 시작값 | gpt-6.1-sol / medium, fork_turns=none | 본 세션의 도구 명시 배정과 같은 개발일 실제 desktop snapshot preflight 통과 보고를 수신. clean base `b9c02ae` 확인. backend 모델/effort metadata는 미노출 | tracked 파일 단독 편집, 모델 호출·앱/DB 공유 서비스 조작 없음 |
| 결과 인계 / 같은 PR 2 구현 세션 | 문서·번호 검사 구현과 아래 로컬 검증 완료 / `codex/guidance-operating-rules` | 모델 gpt-6.1-sol → 동일, 일반 절차 범위 유지. 강도 medium → 동일, 검사 통과·정체 없음. 상향/하향 없음 | 명시 배정 유지, backend metadata 미노출. 로컬 검사와 본 세션이 제공한 실제 GitHub 최종 근거 대조. 비용·토큰 추정 없음 | 본 세션이 실제 PR 링크·독립 리뷰·정확한 head CI·머지 최종 증거를 연결. 추가 사람 결정 없음 |

### PR 1 제출 대상과 검증 증거

아래는 PR #67 제출 당시의 변경하지 않는 실행 기록이다. 본 PR 2의 현재 요약은 위 최종 외부 증거를 반영하며, 여기의 당시 후속 계획을 다시 쓰지 않는다. 당시 `002`는 현재 [Template-05](template-05-agent-model-policy.md)다.

선택표 schemaVersion 2는 refreshDays를 제거하고 checkedAt에 실제 기록된 시각을 보존한다. Codex CLI `2026-10-03T11:52:04.221Z`, Claude CLI `2026-10-03T11:49:56.802Z`는 저장소 밖 기존 snapshot의 좁은 balanced/sonnet 확인 시각이다. 전체 등급에 새 실행 증거를 만들지 않았다. Desktop은 본 세션의 실제 도구 목록 조회 `2026-10-03T13:59:42Z`를 사용한다. 기존 002의 baseline·native pending·실행 smoke 범위는 보존하며 오늘 목록을 품질·비용 평가로 승격하지 않는다.

배정은 명시 IANA timeZone에서 observedAt과 현재 시각의 달력 날짜가 같고 미래가 아닌지 검사한다. 기존 저장소 밖 snapshot이 개발일 조회 결과이며 새 cache 서비스·스케줄러는 없다. 날짜만 지난 선택표는 오늘 실제 모델·강도가 호환되면 유지한다. context/version·미지원/차단/actualModel·effort·pending·native drift 거부는 유지한다.

현재 desktop followup_task schema는 target/message만 지원한다. 같은 결합 설정은 이어가고 모델·강도 변경은 명시 새 spawn과 좁은 티켓 인계를 쓴다. Claude 2.1.140 resume 유지/변경 적용 및 backend 강도는 여전히 미검증이다. 이번 변경은 유료 모델 실행이나 앱/DB/운영 서비스 실행을 포함하지 않는다.

| 명령 | 결과·범위 |
| --- | --- |
| `node scripts/agent-models.mjs sync` | 양쪽 native agent 6개를 실행/재개 정본 링크와 동기화; 기본 모델/강도 유지 |
| `node --test scripts/agent-models.test.mjs` | 16개 통과. KST 자정·다음 날, UTC와 다른 사용자 날짜, offset/날짜 overflow, 미래 시각, 시간대 누락/오류, 휴일 뒤 기존 검증과 오늘 조회, 기존 거부/TOML 보존 경로 |
| `npm run check:docs` | 통과: 텍스트 230개, native 정합성, 회귀 29개(모델 16개 포함). 테스트 시각은 합성 fixture로 실제 선택표의 향후 확인 시각과 독립 |
| `git diff --check` | 통과: 공백·diff 오류 없음 |

이 기록은 제출 단계의 구현·로컬 검증 상태다. 제출 후 head·독립 리뷰·필수 check/integration CI·머지 완료는 본 세션이 해당 PR 최종 코멘트에 기록한다. 여기에서 외부 검토나 CI·머지를 완료로 간주하지 않는다. PR 2의 티켓 번호·설계 역할·상태 기록·기술 이견 정리는 남아 있다.

### PR 2 제출 시점 변경과 검증 증거

이 절은 `codex/guidance-operating-rules`에서 PR 생성 전에 작성한 제출 시점 snapshot이다. 실제 PR 링크·정확한 head의 독립 리뷰·필수 CI·머지와 최종 완료 코멘트는 본 세션이 이후 연결한다. 그 단계를 완료로 간주하지 않는다.

- 유지보수 `001`/`002`/`003`을 Template-04/05/06으로 옮겨 이전 식별자·실패/조사/실행 이력을 보존하고 현재 링크·선택표의 증거 라벨을 맞췄다. 새 앱 `001`과 보존 템플릿 이력이 공존하는 fixture는 통과하고 동일 상위 번호·동일 하위 ID 중복은 문서 검사에서 거부한다. 기존 Template-01/02/03과 schemaVersion 2 개발일 정책은 유지한다.
- 현재 요약과 제출 당시 실행 기록·최종 외부 PR 증거를 분리했다. Template-04/05/06과 PR 1의 현재 요약은 본 세션이 조회한 최종 GitHub 근거에 맞췄다. Template-04 실제 환경 격리는 범위 밖 후속, Template-05 custom/resume/backend·대표 품질/비용은 미완료이며 Template-06은 완료다.
- 사람과 본 세션의 설계·결정, 구현 세션의 합의 안 상세 구조, 조사/실험 결과 환류를 workflow 정본과 얇은 연결에 반영했다. 기술 이견은 재현·근거·계약 대조와 독립 해소를 요구하며, 알려진 차단 사항을 추가 리뷰의 일반 결론으로 덮지 않는다. 사람 승인은 실제 결정·승인 경계·PRD/ADR 변경·이탈일 때 적용한다.
- START-HERE의 구현 전 미래형을 확정 계약·실제 임베딩 평가 링크와 현재 구현 상태로 맞췄다. T02-4 보류와 배포 범위는 그대로이며 초기화 구현·서비스·운영 DB 작업은 수행하지 않았다.

| 명령·대조 | 결과·범위 |
| --- | --- |
| `npm run check:docs` | 통과: 텍스트 230개·모델/native 정합성·회귀 32개. 신규 3개는 템플릿 이력+새 앱 001 공존, 상위 번호 중복, 하위 ID 중복 검출 |
| `git diff --check` | 통과: 공백·diff 오류 없음 |
| 링크·계약 수동 대조 | 이전 파일명은 식별자 이력에만 보존. 링크의 대상 제목과 T02-6·티켓 README·workflow 역할/기록 절, START-HERE 실제 평가 이력 위치를 대조 |

제출 후 PR 2 독립 리뷰·필수 CI·머지는 미완료이며 본 세션에 인계한다. 로컬 검사로 외부 완료 또는 실제 환경 격리·모델 품질/비용을 증명하지 않는다.

### 본 세션의 제출 연결과 기록 보충

- 2026-10-03: 실제 생성된 PR #68을 위 현재 요약에 연결했다. 독립 리뷰·CI·머지 전 제출 단계이며 최종 사실은 해당 PR 완료 코멘트·checks가 소유한다.
- PR 1 snapshot의 “유료 모델 실행” 문장은 성능 평가를 위한 별도 공급자 실호출을 수행하지 않았다는 범위다. 구현·리뷰 서브세션은 실제 배정했고 위 실행 기록에 남겼다. 세션별 토큰·비용은 미노출이며 비용이 없었다고 주장하지 않는다. 원래 제출 기록은 보존하고 이 보충으로 확인 범위를 명확히 한다.

### 이력

- 2026-10-03: 사용자 승인을 확인하고 깨끗한 main `1014076`에서 두 PR의 범위와 순서를 정했다.
