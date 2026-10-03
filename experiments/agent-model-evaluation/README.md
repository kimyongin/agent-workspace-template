# 개발 모델의 작은 실행 평가

[Template-10-05](../../docs/tickets/template-10-05-model-execution-evaluation.md)가 소유하는 일회성 offline 실험이다. 앱이 이 자료를 import하거나 배포하지 않는다. 고정 입력 revision은 `e3826297d6851f6334fecc368a3b5b692a270a0e`이며 [입력 SHA-256](results/inputs.sha256)으로 이후 보고·통합 변경과 분리한다.

## 과제와 판정

- 구현: 소유자별 최신 revision 선택, tombstone, 정렬, 입력 불변성을 고친다. [동일 prompt](implementation-prompt.txt)·[동일 oracle](oracle.test.mjs)을 사용한다. 깨진 입력은 4개 모두 실패하고 보관된 두 결과는 4개 모두 통과한다.
- 리뷰: [동일 prompt](review-prompt.txt)와 [심은 코드](review.mjs)의 소유자 권한 누락, 비원자적 revision 검사, status/activity 부분 저장, 이전 revision 반환을 찾는다. 발견 위치·영향·거부/경쟁/실패 검사 제안은 사람이 대조한다. 별도 native child 과제는 호출·재개 경로 확인용이며 독립 품질 점수에 합치지 않는다.

저장된 구현 결과의 재검증은 Node 22 이상에서 다음 한 명령으로 수행한다. LLM·네트워크·DB·서비스는 호출하지 않는다. 임시 oracle 작업 공간만 만들고 기존 디렉터리를 삭제하지 않는다.

```text
node experiments/agent-model-evaluation/verify-results.mjs
```

실호출 재현은 새 저장소 밖 임시 폴더에 `implementation.mjs`, `oracle.test.mjs`, `review.mjs`를 복사한 뒤, 당일 실제 모델 조회와 저장소의 `assign` preflight를 먼저 통과한다. 결과 구현 파일을 입력으로 쓰지 않는다. 설치 버전·계정·permission 정책에 따라 호출 경로가 달라질 수 있다. 다음은 이번에 실제 사용한 핵심 인자이며 prompt는 stdin으로 전달했다.

```text
codex exec --ignore-user-config --strict-config --json --skip-git-repo-check --model gpt-5.6-terra -c model_reasoning_effort="medium" -c agents.enabled=false -c mcp_servers={} -s workspace-write -
claude -p --model sonnet --effort medium --disable-slash-commands --setting-sources project --strict-mcp-config --mcp-config {"mcpServers":{}} --output-format stream-json --verbose --tools Read,Edit,Bash --permission-mode dontAsk --allowedTools Read Edit "Bash(node --test *)"
```

Codex 첫 구현은 `workspace-write` 요청에도 read-only로 차단됐다. 격리된 동일 입력에서 `--ignore-rules --dangerously-bypass-approvals-and-sandbox`를 명시한 단 한 번의 환경 재시도로 편집·oracle 실행이 가능했다. 전역 설정이나 CLI를 바꾸지 않았다. 이 인자는 실제 앱/DB/운영 작업의 기본값으로 제안하지 않는다.

## 2026-10-04 Asia/Seoul 결과

| 주 과제 | 요청 / 관찰 | elapsed | 품질·검증 | 수정/환경 재시도 |
| --- | --- | --- | --- | --- |
| Codex 구현 | `gpt-5.6-terra` / `medium`; 로컬 turn_context 동일 | 30.636초 | 동일 oracle 4/4, 입력·oracle 보존 | 코드 수정 재시도 0, read-only 환경 재시도 1(처음 24.963초 별도) |
| Claude 구현 | `sonnet` / `medium`; init·modelUsage `claude-sonnet-4-6` | 15.817초 | 동일 oracle 4/4, 입력·oracle 보존 | 코드 수정 재시도 0; preflight 기록 오류 후 동일 입력 새 세션 1 |
| Codex 리뷰 | `gpt-5.6-terra` / `medium`; 로컬 turn_context 동일 | 26.643초 | 심은 4/4, 위치·영향·검사 제안 적절 | 복합 read 명령 거부 후 단순 read로 회복 1 |
| Claude 리뷰 | `sonnet` / `medium`; init·modelUsage `claude-sonnet-4-6` | 20.718초 | 심은 4/4. 경쟁 검사 문장에 “Both should throw”와 “second must get conflict”가 공존하는 부정확성이 있음. 올바른 oracle은 한 요청 성공·다른 요청 conflict | 수정 재시도 0; preflight 기록 오류 후 새 세션 1 |

elapsed는 임시 Node wrapper가 subprocess 시작부터 종료까지 잰 wall time이다. 동시에 실행한 과제·warm cache·다른 client/tool/system prompt와 환경 재시도가 있으므로 우열이나 비용 효율성을 일반화하지 않는다. 호출·exit 0과 oracle 성공을 분리했으며 첫 Codex 구현 exit 0은 작업 성공이 아니다.

Claude 최초 구현/리뷰는 잘못된 snapshot context 및 7자리 fractional timestamp를 preflight가 거부한 상태에서 wrapper가 계속 실행한 절차 오류가 있었다. context를 기존 선택표와 대조하고 원 조회 시각을 밀리초 표현으로 정규화하여 preflight를 통과한 후 두 과제를 새 세션·같은 깨진 입력으로 재실행했다. 원 호출은 관찰 자료에 보존하되 위 주 비교에는 제외한다. 그 오류가 없었던 것으로 기록하지 않는다.

## 실제 사용량과 한계

전체 관찰값은 [observations.json](results/observations.json), 실제 응답과 수정 결과는 [results](results/)에 있다. Claude `modelUsage`의 helper Haiku를 주 Sonnet와 분리하며 `total_cost_usd`는 CLI 계산값이다. subscription 계정의 실제 추가 청구액을 확인한 자료가 아니다. Codex 사용량은 `turn.completed.usage` 관찰이며 resume 값은 앞선 turn까지 누적되는 형태라 증분 또는 별도 과금으로 합산하지 않는다.

| 주 과제 | 관찰 토큰 | CLI 비용 표시(USD) |
| --- | --- | --- |
| Codex 구현 | input 62089, cached input 54272, output 757, reasoning output 106 | 미노출 |
| Codex 리뷰 | input 37139, cached input 28928, output 814, reasoning output 199 | 미노출 |
| Claude 구현 Sonnet | input 7, cache create 1888, cache read 68299, output 949 | 0.0418257 |
| Claude 구현 helper Haiku | input 475, output 16 | 0.000555; total 0.0423807 |
| Claude 리뷰 Sonnet | input 3, cache create 0, cache read 21979, output 1053 | 0.0223977 |
| Claude 리뷰 helper Haiku | input 470, output 16 | 0.00055; total 0.0229477 |

`medium` 수락·로컬 설정/세션 metadata는 backend에서 해당 추론 강도를 실제 실행했음을 입증하지 않는다. Codex event에 별도 backend actual model ID는 없다. Claude init·assistant transcript의 모델 ID와 modelUsage는 실제 노출된 증거이며 backend effort metadata는 없다. 계정 사용률/API 가격표로 세션 청구액을 계산하지 않았다. 모델 선택표의 baseline/evaluation/native 상태를 바꾸지 않는다.

## Native child와 재개

[세션 metadata 요약](results/session-metadata.json)은 알려진 이번 세션의 로컬 로그에서 모델·강도·agentType만 추출했다. 전역 auth/config나 원본 system prompt는 저장하지 않았다.

| 경로 | 실제 관찰 | 종료 조건·미확인 |
| --- | --- | --- |
| Claude native child | `Agent` tool의 `subagent_type=task-balanced`, child meta `agentType=task-balanced`, child assistant `model=claude-sonnet-4-6`, task completed, CHILD-527. 부모/child 합계 modelUsage는 observations의 claude-native에 별도 기록 | CLI medium 명시·child 상속 경로의 backend effort는 미노출. child는 review 파일만 읽어 정의가 요구하는 guidance read 준수까지 통과했다고 하지 않음 |
| Claude 동일 설정 resume | `--resume 8c6e67dd-6368-4d66-ad68-2c6a051f11f3 --model sonnet --effort medium`; 동일 session_id·init 모델, ORCHID-527와 네 결함 복원, 7.109초 | 모델/강도 변경 resume·child 자체 resume는 미검증 |
| Codex 일반 child | rollout의 실제 `collaboration.spawn_agent`는 model/medium을 명시했으나 `agent_type` 없이 일반 child를 생성. wait 완료와 CHILD-527 보고 | custom 정의 적용 증거로 계산하지 않음. child actual backend metadata 미노출 |
| Codex custom child | 정확히 `agent_type=task-balanced`를 요구한 첫 호출은 model capacity 오류(exit 1, 3.561초). 같은 설정 1회 재시도에서 도구 schema에 `agent_type`이 없음을 명시(7.108초), generic 대체 없음 | 현 CLI surface의 환경 지원 제약으로 종료. 모델 품질 실패 또는 native 성공으로 계산하지 않음 |
| Codex 동일 설정 resume | `codex exec resume`에 동일 model/medium 명시. 동일 thread `01a10360-83b5-7d72-a343-ea6e52dbecbf`, 로컬 turn_context 동일, ORCHID-527와 네 결함 복원 | custom child 재개·설정 변경 재개는 미검증. 별도 elapsed 자체 측정값 없음 |

native 실험은 선택표와 agent 정의 파일을 그대로 복사하고 필요한 안내·review 입력만 둔 임시 workspace에서 수행했다. repository 파일·개인 전역 설정 변경, 앱·서비스·DB 접근은 없다. Codex cache schema warning(`supports_parallel_tool_calls` 누락)과 PowerShell shell snapshot warning도 관찰했으며 auth를 바꾸거나 cache를 삭제하지 않았다.

호출 입력은 [native-prompt](native-prompt.txt), 정확한 custom 지정을 확인한 [custom-prompt](custom-prompt.txt), [resume-prompt](resume-prompt.txt)에 보존했다. native 호출에는 Codex `agents.enabled=true`, Claude `--tools Read,Agent --allowedTools Read Agent`를 사용했고 `--agent`로 부모 역할만 바꾸는 실행을 child 검증으로 세지 않았다. 필요한 안내 복사본의 START-HERE/AGENTS는 offline 실험 경계 안내이며 제품 문서 자체 검증 과제가 아니다.

## 조회 근거와 후속

Codex CLI 0.147.0의 당일 `app-server initialize → model/list(limit=100, includeHidden=false)`는 nextCursor null, terra/sol/luna/5.5 및 지원 effort를 반환했다. [capabilities.json](results/capabilities.json)은 그 실제 조회 snapshot이다. Claude Code 2.1.140은 이 비대화형 surface에서 전체 계정 모델 목록을 조회한 것이 아니라 sonnet 별칭의 직접 probe·init·usage로 현재 계정의 좁은 지원만 확인했다. 다른 alias/후보 지원을 추정하지 않았다. 두 balanced/medium assign preflight는 정정 후 통과했고 목록·probe와 대표 과제 증거를 구별했다.

공식 문서는 [OpenAI subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [app-server model/list](https://learn.chatgpt.com/docs/app-server#list-models-modellist), [Claude subagents](https://code.claude.com/docs/en/sub-agents), [Claude model 설정](https://code.claude.com/docs/en/model-config)을 실제 열어 확인했다. 공식 최신 문서의 기능을 설치 버전의 실행 지원으로 간주하지 않는다.

이 고정 자료는 대표 과제 2개/각 baseline의 좁은 성공 근거다. 신규 후보 승격, 광범위 benchmark, 실제 과금 우수성, 모든 등급/계정/surface 검증을 완료하지 않았다. custom 인자 지원이 생긴 설치에서 Codex native child를 다시 확인하고, 설정 변경 resume가 필요하면 실제 적용 metadata까지 대조한다. 노출되지 않는 backend effort·청구액은 공급자 근거를 얻을 때만 확정한다.

## 2026-10-04 관측 가능한 재개 후속

[Template-10-08](../../docs/tickets/template-10-08-model-resume.md)의 구현 서브세션 `verify_resume`가 위 당시 보고를 보존하고 [별도 관찰값](results/resume-followup-20261004.json)을 추가했다. 같은 CLI 버전과 계정/client 문맥에서 당일 capabilities의 원 observedAt을 저장소 밖 파일로 추출해 Codex balanced/high와 Claude balanced/medium assign을 먼저 통과했다. 새 조회 시각을 만들지 않았고 원 fixture·oracle·hash는 보존했다.

| 경로 | 후속 결과 | 관찰의 한계 |
| --- | --- | --- |
| Codex 부모 설정 변경 resume | `codex exec resume --model gpt-5.6-terra -c model_reasoning_effort="high"`를 원 native cwd와 session `01a10360-83b5-7d72-a343-ea6e52dbecbf`에 명시. exit 0, 4.505초. 같은 ID, 사전에 값 없이 회상시킨 ORCHID-527 및 네 결함 복원. known rollout의 turn_context는 `medium, medium, high` | 로컬 모델/강도 변경 적용 확인이며 별도 backend actual model/effort는 미노출. usage는 누적 형태라 증분 비용으로 계산하지 않음 |
| Claude 원 child 재개 지원 확인 | 같은 부모 `8c6e67dd-6368-4d66-ad68-2c6a051f11f3`를 Sonnet/medium으로 재개. 첫 `Read,Agent` 호출 exit 0, 10.560초에서 Agent.resume 필드 없음 보고. 이어 같은 설정 preflight 후 `--tools Read,Agent,SendMessage`·대응 allowedTools를 명시한 정상 continuation도 exit 0, 7.315초. 실제 init.tools는 `Task,Read`만 있고 부모도 SendMessage 미등록 보고. 양쪽 init·assistant·modelUsage Sonnet 일치, Agent/SendMessage 호출0 | 첫 미노출은 우리가 제한한 surface이며 단독으로 설치 제약을 판정하지 않음. 추가 명시 허용에도 도구 미등록이 확인되어 이 설치/비대화형 경로의 제약으로 종료. 원 child `a2398b11f2ffc7080` 자체 재개·guidance read 준수는 미확인, 새 child 대체 없음 |

입력은 [Codex 후속 prompt](codex-resume-followup-prompt.txt)·[Claude 후속 prompt](claude-resume-followup-prompt.txt), 제한된 응답은 [Codex](results/codex-resume-followup-response.txt)·[Claude](results/claude-resume-followup-response.txt)에 있다. 시스템 prompt·thinking·서명·auth/config 원문은 저장하지 않았다. Claude 후속 usage는 input 3/cache create 12211/cache read 0/output 545, CLI costUSD 0.05397525이며 실제 추가 청구액을 뜻하지 않는다. CLI 업데이트·설정 우회·앱/DB/운영 접근·선택표 승격은 없다. 미지원 child 경로와 미노출 backend/청구액은 지원 또는 공급자 근거가 생길 때만 다시 확인한다.

[Claude 공식 재개 문서](https://code.claude.com/docs/en/sub-agents#resume-subagents)를 실제 열어 SendMessage의 기존 ID continuation 경로를 확인한 후 [추가 prompt](claude-sendmessage-resume-followup-prompt.txt)로 위 명시 허용을 실행했다. [추가 응답](results/claude-sendmessage-resume-followup-response.txt)의 도구 미등록 보고와 실제 init.tools 관찰은 위 별도 JSON에 함께 보존한다. 추가 usage는 input 3/cache create 768/cache read 12211/output 264, CLI costUSD 0.0105123이다. 현재 공식 기능을 설치 2.1.140의 지원으로 간주하거나 최신 CLI로 업데이트하지 않았다.
