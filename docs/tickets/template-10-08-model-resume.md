# Template-10-08 — 관측 가능한 설정 변경·child 재개 확인

작성: 2026-10-04
상태: 완료(PR #78 독립 리뷰·CI·머지, 미지원 child 재개 범위 보존)
선행: Template-10-05 PR #76

## 목표와 범위

사용자가 T02-5/6을 제외한 잔여 작업을 요청했다. 앞선 고정 평가의 아직 미확인인 재개 경로 가운데 현재 CLI가 지원하는 부분을 끝까지 확인한다. [모델 실행 정본](../development/agent-model-execution.md)과 [개발 정책](../development/workflow.md#모델과-추론-강도-선택갱신)을 따른다. 모델 선택표·정책·개인 설정은 바꾸지 않는다.

- Codex CLI의 기존 동일 모델 부모 세션을 현재 확인된 Terra/high로 명시 재개해 같은 session ID·marker·실제 노출 turn_context 모델/강도 적용을 대조한다. 당일 실제 모델 snapshot과 해당 새 설정 assign preflight를 먼저 통과한다. 로컬 metadata는 backend effort 증명으로 확대하지 않는다.
- Claude Code의 실제 task-balanced child 자체 재개를 설치 버전의 정상 Agent 도구가 지원하면 동일 Sonnet/medium에서 실행한다. 원 child ID·marker·actual child metadata와 정상 도구 호출을 대조한다. 정의가 요구하는 안내 읽기도 확인 가능하면 수행하고 이 증거의 범위를 구분한다.
- 원 CLI 도움말/정상 도구에 재개 경로가 없으면 임의 우회나 새 CLI/후보 모델로 대체하지 않고 정확한 지원 제약을 남긴다. Claude의 미확인 강도·다른 alias는 이 작업에서 임의 지원으로 주장하지 않는다.
- 원 고정 입력은 그대로 보존한다. known fixture 작업 공간 외 앱·DB·운영·개인 auth/config를 변경하지 않는다. 로그는 모델/강도/session/tool/marker·사용량/시간과 필요한 응답만 선별해 비밀·원 system prompt를 저장하지 않는다.

## 소유와 검증

담당은 이 자식 티켓, experiments/agent-model-evaluation의 후속 재개 증거·README 및 Template-05 현재 요약을 소유한다. 이전 당시 보고/fixture/hash는 유지하고 새 관찰을 별도 날짜/범위로 추가한다. 실제 지원 확인·preflight·명시 인자·검증 결과와 미관측 backend/청구액을 나누고 문서·diff·기존 verifier를 검사해 로컬 커밋/head를 인계한다. 메인은 독립 리뷰·PR/CI·머지를 조정한다.

## 실행 기록과 종료 조건

구현 서브세션 `verify_resume`는 base `09851bb1caa754a58f6542f24442735f90214d0d`, `codex/model-resume`, 별도 model-evaluation worktree에서 실행했다. 메인의 desktop 균형/medium preflight PASS와 명시 배정을 전달받았으며 이 구현 세션의 backend 모델/강도는 미노출이다. 개발 스킬·OpenAI Docs 스킬과 [Terra 공식 문서](https://developers.openai.com/api/docs/models/gpt-5.6-terra)·[Codex CLI 명령](https://learn.chatgpt.com/docs/developer-commands?surface=cli)을 실제 열어 확인하고 설치된 `codex exec resume --help`의 `--model`/`-c` 지원을 대조했다. CLI 0.147.0·Claude Code 2.1.140은 유지했다.

| 실행 | 배정·이유 | 확인 결과·종료 조건 |
| --- | --- | --- |
| Codex 기존 부모 resume | 같은 balanced Terra 모델 유지, medium→high는 설정 변경 적용을 관찰하려는 승인된 실험. 원 capabilities `2026-10-03T20:02:52.834Z`(Asia/Seoul 당일)를 그대로 추출해 balanced/high investigate assign PASS | 동일 `01a10360-83b5-7d72-a343-ea6e52dbecbf`, ORCHID-527와 네 결함 복원. known turn_context `medium, medium, high`, exit0·4.505초. 로컬 적용까지만 확인, backend effort/actual 모델·청구액은 미노출 |
| Claude 원 task-balanced child 재개 지원 | 원 Sonnet/medium 유지. 원 capabilities `2026-10-03T20:03:52.448Z` 추출 후 balanced/medium investigate assign PASS; SUBAGENT_MODEL 환경 override 없음 | 동일 부모 ID를 명시 재개, init·assistant·usage Sonnet 일치. 첫 `Read,Agent` surface는 Agent.resume 미노출 보고(exit0·10.560초). 공식 SendMessage continuation 확인 후 재배정 preflight PASS, `Read,Agent,SendMessage`/대응 allowedTools 명시 추가 호출(exit0·7.315초)에서도 실제 init.tools `Task,Read`와 부모 SendMessage 미등록 보고 확인. 첫 제한 surface와 설치 제약을 구분. 실제 Agent/SendMessage 호출0, 원 child 대체 없음; child 자체/정본 read 준수 미확인 |

[후속 증거](../../experiments/agent-model-evaluation/results/resume-followup-20261004.json)에는 명시 인자·원 snapshot·시간·usage·선별 metadata와 fixture hash를, [README 후속](../../experiments/agent-model-evaluation/README.md#2026-10-04-관측-가능한-재개-후속)에는 정확한 범위·응답 링크를 남겼다. CLI 부모의 schema 보고를 독립 schema dump로 표현하지 않는다. Claude CLI 계산비용은 실제 subscription 추가 청구액이 아니며 Codex resume 누적 usage를 증분으로 합산하지 않았다. 현재 선택표/native 정의·앱/DB/서비스·개인 auth/config·CLI 버전은 변경하지 않았다.

검증: 기존 `verify-results.mjs`는 hash 일치·깨진 baseline 의도한 4실패·보관된 양쪽 결과 4통과. `npm run check:docs`는 텍스트 288개·모델/native 정합성과 37검사 중 36통과/실패0/skip1(기존 Windows symlink privilege 제약), `git diff --check` 통과. 미지원 child와 미노출 backend/청구액의 추가 완료를 선점하지 않으며 독립 리뷰·최종 head CI·PR/머지는 메인 담당이다.

## 제출 후 현재 완료 기록

2026-10-04 release 담당이 GitHub MERGED·merge SHA를 직접 확인했다. [PR #78](https://github.com/kimyongin/agent-workspace-template/pull/78)·[checks](https://github.com/kimyongin/agent-workspace-template/pull/78/checks)의 독립 리뷰·CI·머지 완료, merge `6b259351879788b997bc1cb874b4152b1ba67a40`. 위 구현·제출 snapshot은 당시 이력으로 보존하며 운영 배포·미지원 도구·미노출 backend/실청구액·미접근 클라이언트의 추가 완료를 뜻하지 않는다.

[완료 코멘트](https://github.com/kimyongin/agent-workspace-template/pull/78#issuecomment-5973691655)와 [CI check/integration PASS](https://github.com/kimyongin/agent-workspace-template/actions/runs/37154969595)는 메인이 전달한 최종 증거다.
