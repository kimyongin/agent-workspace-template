# Template-10 — 잔여 구현·검증·운영 반영

> 이전 기록이다. 현재 작업과 완료 근거는 [GitHub 이관 대응표](migration-to-github.md)에서 확인한다.

작성: 2026-10-04
상태: 승인 범위 구현·검증·운영 적용 완료(실제 사용자 업무/색인·일부 surface 미확인, Cron 보류; 기록 PR 대기)
검토 기준: `46f4cbef3c8098626647055ec741463eb1aa3066`
선행: Template-09 PR #73 완료

## 최종 현재 요약

PR #74·75·76·77·78·79·81·80은 독립 리뷰·필수 CI 후 머지 완료다. PR #80의 첫 integration 실패·활동 PR #81 deadline 보강과 최종 재검증은 아래 이력과 [자식04](template-10-04-activity-return.md)·[자식07](template-10-07-plugin-behavior.md)에 보존한다. 최종 main `1730dc983eb10e282e28f3a200ffbd265978480e`, [PR #80 완료](https://github.com/kimyongin/agent-workspace-template/pull/80#issuecomment-5974516525)·[CI37160563892 SUCCESS](https://github.com/kimyongin/agent-workspace-template/actions/runs/37160563892)를 메인이 인계했다.

[기존 운영 반영](template-10-06-existing-release.md)은 additive migration11/총13·worker fresh 자격/서버Secrets·API/MCPv6/workerv2·같은SHA [Pages37161621033](https://github.com/kimyongin/agent-workspace-template/actions/runs/37161621033)·제품0.1.1 ZIP 출처를 고정했다. source download49 TS byte동일·거부401/정확metadata200·빈 큐 limit1 한 회 모두0을 직접 확인했다. 정상 prod 본인 세션이 없어 최소 업무/색인 성공 미증명·Cron 보류를 유지한다. 실제 클라이언트 로컬 frozen8c94/72d4의 행동·native 인증/정리를 운영 성공으로 확대하지 않는다. T02-5/6·provider 전체백업/복구·claude.ai 웹/mobile·실기기/스크린리더·backend effort/실청구는 제외/미확인이다. 마지막 기록 PR 독립 리뷰·CI·머지는 메인 담당이다.

## 목표와 기준 문서

사용자는 남은 작업 가운데 T02-5 도메인 전환과 T02-6 초기화·출시 준비를 제외하고 모두 우선순위대로 진행하도록 지시했다. 이 요청으로 T02-4 보류를 해제한다. 기존 운영 프로젝트와 Pages의 검증한 변경 반영도 포함한다. 새 프로젝트·Book 전환·출시 자동화·백업 복원 연습은 수행하지 않는다. [PRD](../product/concept.md)·[ADR](../adr/README.md) 안의 확정 계약을 구현하며 이탈이 필요한 결정은 사람에게 변경안으로 인계한다.

## 작업과 완료 조건

- [x] 기록·원칙·태그의 실제 업무와 HTTP/MCP 오류에 빠른 검사를 확대한다(PR #75).
- [x] 확정 Entity 계약의 DB·HTTP·MCP·웹과 관련 항목 조회를 구현한다(PR #77).
- [x] 활동 목록 왕복 복원과 키보드·반응형·초점 검증 공백을 보강한다(PR #79, 실제 기기·스크린리더 미확인).
- [x] 같은 제품 스킬을 사용하는 Claude/Codex 플러그인을 패키징하고 가능한 실제 설치·행동을 검증한다(PR #74·80, 운영 실클라이언트 미확인).
- [x] 개발 세션 생성·재개 및 대표 품질/비용 평가의 확인 가능한 범위를 기록한다(PR #76·78, 미지원·미관측 범위 보존).
- [x] 검증한 main revision을 기존 운영 서비스에 호환 순서로 반영하고 읽기·최소 점검 결과를 기록한다(1730dc, 실제 사용자/색인 성공 미확인·Cron 보류).
- [ ] 작은 PR마다 독립 리뷰·필수 CI·최신 main·머지 조건을 확인한다.

## PR 분할 계획

| 순서 | 브랜치 | 결과 | 기준 |
| --- | --- | --- | --- |
| 1 | `codex/fast-knowledge` | 서비스 없는 기록·원칙·태그 연결/handler 검사 | [Template-10-01](template-10-01-fast-knowledge.md)·Template-08·보안·workflow |
| 2 | `codex/example-entity` | 단일 Entity CRUD·연결 조회·웹·샘플 | T02-1 Entity·T02-4 |
| 3 | 후속 배정 | 활동 목록 복원·접근성 검증 | 디자인 가이드 |
| 4 | 후속 배정 | 제품 패키지·실클라이언트와 모델 평가 | 배포·Template-05 |
| 5 | 후속 배정 | 기존 운영 반영 기록 | 배포 방법·운영 방법 |

## 검증

실제 package/CI의 `test:fast`·문서·Deno·경계·build와 격리 integration CI를 사용한다. 공유 로컬 Supabase는 한 세션만 담당하며 운영 DB를 테스트 대신 쓰지 않는다. 실제 기기·스크린리더·사람의 OAuth 조작·미노출 backend metadata는 수행 여부를 구분한다. 미실행을 성공으로 표시하지 않는다.

## 구현 인계와 완료 기록

| 작업 | 담당 | 작업 공간·소유 | 모델·강도 | 의존성 |
| --- | --- | --- | --- | --- |
| 빠른 검사 | `/root/implement_fast_knowledge` | fast-knowledge worktree; 새 fast 검사·자식 티켓·현재 요약 | desktop `gpt-6.1-sol`/medium; 확정 계약의 일반 검증 | 새 Entity 파일 편집 없음 |
| Entity | `/root/implement_entity` | example-entity worktree; Entity 수직 기능·자식 티켓 | desktop `gpt-6.1-sol`/medium; 확정 계약의 일반 구현 | 기존 fast 검사 편집 없음; 최신 main 통합은 제출 전 |
| 조정 | 메인 | Git/PR·계약·독립 리뷰·CI·머지·운영 범위 | 현재 세션 | 양쪽 공유 환경 순차 |

2026-10-04 메인이 현재 desktop 도구 카탈로그의 모델/강도를 조회해 저장소 밖 `overnight-desktop-snapshot.json`을 만들고 balanced/medium 배정 preflight 통과를 인계했다. backend 실제 모델/effort·개별 비용은 미노출이며 목록과 실제 실행을 구분한다. 새 checkout에서 의존성 미설치로 첫 preflight가 실패한 뒤 기존 설치 checkout에서 재실행해 통과했다.

첫 fast 업무 조각은 [Template-10-01](template-10-01-fast-knowledge.md)에서 구현·로컬 검증·확인한 제한을 추적한다. 전체 단계의 완료가 아니며 독립 리뷰·최종 CI·머지는 제출 후 확인한다.

Template-09는 [PR #73 완료 기록](https://github.com/kimyongin/agent-workspace-template/pull/73#issuecomment-5972743090)과 checks에 따라 완료다. 제출 당시 기록은 보존한다.

### 2026-10-04 최종 실행 전 snapshot(이력)

release 담당이 GitHub의 MERGED·merge SHA를 직접 조회했다. 독립 리뷰·CI·통합 결과는 메인 인계와 각 PR 증거를 따른다. 현재 준비 기준 main은 `2a55e1397a427388cb0d47671cf0236bb1ab36a6`이며 최종 운영 실행 revision은 아직 고정하지 않았다.

| 자식·범위 | 현재 결과 | 증거·남은 경계 |
| --- | --- | --- |
| [10-01 빠른 검사](template-10-01-fast-knowledge.md) | PR #75 독립 리뷰·CI·머지 완료, merge `db70cbf` | [checks](https://github.com/kimyongin/agent-workspace-template/pull/75/checks). fixture 결과와 실제 SQL·OAuth 보장 구분 |
| [10-02 Entity](template-10-02-example-entity.md) | PR #77 exact `03df8bc`, 독립 승인·standalone 4/통합 18 PASS·CI 성공 후 merge `24d1251` | [완료 기록](https://github.com/kimyongin/agent-workspace-template/pull/77#issuecomment-5973772100), [CI](https://github.com/kimyongin/agent-workspace-template/actions/runs/37155546745). 운영은 미배포 |
| [10-03 제품 패키지](template-10-03-product-plugin.md) | PR #74 패키징·격리 설치·독립 리뷰·CI·머지 완료, merge `a59d58c` | [checks](https://github.com/kimyongin/agent-workspace-template/pull/74/checks). Entity 통합·실제 LLM 행동/네이티브 인증은 후속 자식 07 증거 확인 대기 |
| [10-05 모델 과제](template-10-05-model-execution-evaluation.md) | PR #76 독립 리뷰·CI·머지 완료, merge `09851bb` | [checks](https://github.com/kimyongin/agent-workspace-template/pull/76/checks). baseline 두 과제; 신규 모델 승격·backend effort·실청구액 미확인 |
| [10-08 재개](template-10-08-model-resume.md) | PR #78 독립 리뷰·CI·머지 완료, merge `6b25935` | [완료 기록](https://github.com/kimyongin/agent-workspace-template/pull/78#issuecomment-5973691655), [CI](https://github.com/kimyongin/agent-workspace-template/actions/runs/37154969595). Codex 로컬 설정 변경 적용 확인; Claude 원 child·SendMessage 미지원은 종료 제약 |
| [10-04 활동](template-10-04-activity-return.md) | PR #79 최종 리뷰·CI·머지 완료, merge `ff1863d` | [완료 기록](https://github.com/kimyongin/agent-workspace-template/pull/79#issuecomment-5974064551)·[checks](https://github.com/kimyongin/agent-workspace-template/pull/79/checks). 실제 기기·스크린리더 접근 미확인 |
| 제품 행동 후속 자식 07 | PR #80 rebase exact `18b7eff` 독립 머지 가능, 최종 CI37160563892·머지 대기 | [PR #80](https://github.com/kimyongin/agent-workspace-template/pull/80)·[run](https://github.com/kimyongin/agent-workspace-template/actions/runs/37158709415). 실제 로컬 양 CLI 업무·정리 및 Claude native 인증/읽기/해제 성공; 운영 사용자·claude.ai 웹/mobile는 미확인 |
| [10-06 운영 반영](template-10-06-existing-release.md) | 읽기 전용 준비·최소 checkpoint 완료, 실행 인계 대기 | 최종 검증 SHA 후 migration→역할·Secrets→함수→점검→Pages/ZIP. 실제 본인 세션·소량 색인 성공 미확인이면 Cron 활성화 보류 |

T02-4 보류는 해제됐고 T02-5/6은 사용자 제외 범위다. 기존 PR #69 환경 격리 시도는 사용자 지시로 미머지 종료했으며 Template-08의 포트 교체 검사로 방향을 바꿨다. 환경 격리 구현을 새로운 잔여 조건으로 추가하지 않는다.

제품 PR #80의 [통합CI37158709415](https://github.com/kimyongin/agent-workspace-template/actions/runs/37158709415)는 최종 FAIL(메인 인계:65 PASS/9 SKIP/2 FAIL)이다. 기록250페이지 mock 복원의 desktop/mobile deadline 실패를 활동 안정성 후속 PR에서 조사하며 최종 CI 재통과·merged SHA 인계 전 운영 실행을 보류한다.

활동 deadline 후속 [PR #81](https://github.com/kimyongin/agent-workspace-template/pull/81)은 exact6b8d623의 [독립 머지 가능](https://github.com/kimyongin/agent-workspace-template/pull/81#issuecomment-5974325158)·로컬4/지연57.8초 PASS·stall/order/duplicate 의도한 거부를 메인이 인계했다. [CI37159805324](https://github.com/kimyongin/agent-workspace-template/actions/runs/37159805324)의 최종 결과·머지는 아직 대기이며 제품 PR #80 rebase·재검증 후 운영 실행 revision을 고정한다.

활동 deadline 보강 PR #81은 [완료5974412125](https://github.com/kimyongin/agent-workspace-template/pull/81#issuecomment-5974412125)·[CI37159805324 SUCCESS](https://github.com/kimyongin/agent-workspace-template/actions/runs/37159805324) 후 `2a55e13`으로 머지됐다. PR #80은 base2a55/exact18b7eff로 rebase한 [독립 머지 가능](https://github.com/kimyongin/agent-workspace-template/pull/80#issuecomment-5974421539)·patch 동일 확인 후 [최종 CI37160563892](https://github.com/kimyongin/agent-workspace-template/actions/runs/37160563892)를 기다린다. 이전 실패·제출 snapshot은 보존하며 운영 실행은 아직 시작하지 않았다.
