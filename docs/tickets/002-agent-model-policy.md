# 002 — 개발·리뷰 세션 모델 선택과 갱신

작성: 2026-10-03
상태: 진행 중
검토 기준: `c98d7e0`
선행: 없음

## 목표와 기준 문서

사용자는 서브 개발·리뷰 세션의 불필요한 고성능 상속을 줄이고 난이도·위험·반복 실패에 따라 모델을 선택하며 신규 모델을 놓치지 않도록 정책·선택표·프로젝트 실행 설정을 반영하도록 승인했다. [ADR-0007](../adr/0007-dual-development-agents.md)·[ADR-0008](../adr/0008-document-ownership.md)·[ADR-0010](../adr/0010-merge-authority.md) 안의 개발 방법 개선이다. PRD·ADR 변경, T02-4, 앱·DB·운영 배포·서비스 생성, 개인 전역 설정 변경·CLI 업데이트는 제외한다.

## 작업과 완료 조건

- [x] 공통 등급·상향/하향 정책과 갱신 절차, 단일 선택표를 연결한다.
- [x] Claude/Codex 연결 설정과 drift·배정 전 최신성/지원 검사를 구현한다.
- [x] 오류 경로 회귀 검사와 문서 검사를 통과하고 실제 확인·미검증을 구분한다.
- [ ] 구현과 분리된 리뷰·CI를 통과하고 작은 PR을 머지한다.

## PR 분할 계획

| 순서 | 브랜치 | 내용 | 완료 기준 | 관련 결정 |
| --- | --- | --- | --- | --- |
| 1 | `codex/agent-model-policy` | 정책·선택표·얇은 실행 설정·검사 | 새 배정에서 명시 모델/effort를 확인하고 stale·drift·상속을 거부할 수 있음 | ADR-0007/0008/0010 |

정책과 이를 강제하는 작은 도구·회귀 검사는 함께 리뷰한다. 생성 설정을 제외한 규모가 400줄을 넘으면 연결 계약과 실패 경로를 한 번에 확인하기 위한 이유를 PR에 설명한다.

## 검증

`npm run check:docs`, `git diff --check`. 실제 클라이언트는 고정된 구현 과제(작은 오류 수정 및 회귀 검사)와 리뷰 과제(심은 권한/일관성 결함 탐지)를 같은 revision에서 실행하고 실제 모델·추론 강도·결과·사용량 근거를 기록한다. 모델 목록은 품질·비용·실행 검증을 대신하지 않는다.

## 구현 인계와 완료 기록

| 필드 | 내용 |
| --- | --- |
| 목표·승인 범위 | 위 목표 절의 직접 사용자 승인. 범위 밖 변경은 중단 |
| 기준과 작업 공간 | base `c98d7e0`, `codex/agent-model-policy`, 저장소 checkout, 시작 시 변경 없음 |
| 담당 변경 | 구현 서브세션이 tracked 파일 단독 편집. 본 세션은 조정·최종 검증·PR·독립 리뷰·머지 |
| 계약과 의존성 | [개발 방법](../development/workflow.md), [선택표](../development/agent-models.json), 앱/DB 의존성 없음 |
| 모델 배정 | 이번 구현: Codex desktop 명시 `gpt-6.1-sol` / `medium` / `fork_turns=none`, 일반 개발 절차·도구 구현이므로 균형 배정. 2026-10-03 도구 목록 확인. 모델/강도 상향 없음. CLI 지원과 별개 |
| 완료 조건과 검증 | 위 검증 절. 로컬 Node만 사용하며 공유 서비스 시작 없음 |
| 결과와 다음 행동 | 정책·얇은 설정·배정 도구 구현 및 로컬 검사 통과, 본 세션이 Codex defaults 정적 로딩·Claude native CLI·양쪽 균형 배정 명령 통과 확인. 독립 리뷰·CI·머지로 인계 |

| 단계 | 상태 | revision / 변경 | 검증 명령·결과 | 남은 작업 |
| --- | --- | --- | --- | --- |
| 정책·도구 | 구현(리뷰 대기) | base `c98d7e0` 위 작업 변경 | `npm run check:docs`: 텍스트 228개 및 선택표/native 정합성, 회귀 21개 통과 | 독립 리뷰·CI |
| 직접 실행·설정 연결 | 구현(리뷰 대기) | Codex CLI 0.147.0 / Claude Code 2.1.140 / desktop 도구 | 아래 실제 smoke·목록 결과. 균형 direct, Codex defaults 파싱, Claude CLI agent 실행, 양쪽 assign medium 통과 | Codex custom spawn·Claude child/resume와 신규 후보 평가 |
| 신규 모델 평가 | 미완료(사유) | CLI/desktop 지원 목록이 다름 | 모델별 광범위 품질·비용 비교는 미실행. 현재 기본은 baseline이며 신규 평가 통과로 표기하지 않음 | 신규 발견 시 대표 구현·리뷰·사용량/요금 평가 |
| PR·리뷰·CI·머지 | 미시작 | — | — | 본 세션 담당 |

### 이력

- 2026-10-03: 승인 범위·base·단독 편집 담당·작은 PR 계획 기록 후 시작.
- 2026-10-03: 본 세션이 Codex CLI app-server stdio에서 `initialize`→`model/list(limit=100, includeHidden=false)`를 LLM turn 없이 조회. gpt-5.6-sol/terra/luna, gpt-5.5와 지원 강도를 확인(nextCursor/upgrade=null). desktop spawn_agent의 gpt-6 목록과 구분했다.
- 2026-10-03: 본 세션의 Codex CLI `--ignore-user-config --strict-config --ephemeral --json --skip-git-repo-check -m gpt-6.1-sol -c model_reasoning_effort='medium' -c agents.enabled=false`는 HTTP 400 unsupported ChatGPT account로 거부됐다. 환경 지원 오류이며 추론/모델 능력 실패로 세지 않는다. CLI native 설정에는 계정 목록의 모델을 사용했다.
- 2026-10-03: 본 세션의 같은 CLI 경로 `-m gpt-5.6-terra` / `medium` 작은 구현 원칙·권한 리뷰 smoke가 exit0/turn.completed. 상대링크 기준·타인 ID 조회 영향·거부 테스트 답변 적절. input 11500/output 68/reasoning_output 0. 요청 모델의 무경고 성공이며 별도 actual 모델 metadata나 backend 실제 추론 강도·정확한 과금 비교까지 입증하지 않는다.
- 2026-10-03: 본 세션의 임시 격리 위치에서 `claude -p --model sonnet --effort medium --tools '' --disable-slash-commands --setting-sources project --output-format json --no-session-persistence` 작은 구현 원칙·권한 리뷰 smoke exit0. modelUsage 주 작업 claude-sonnet-4-6(input 3/cacheCreate 9056/output 242), 내부 보조 haiku(input 545/output 14)는 별도로 구분. 올바른 영향·거부 테스트 답변을 확인했으나 앱의 구체 오류 계약·native subagent/resume·backend 실제 effort·광범위 품질/과금 비교는 미검증.
- 2026-10-03: 실제 CLI help로 `codex exec --model`/`-c`/`--strict-config`, Claude `--agent`/`--model`/`--effort` 옵션을 확인. 새 문서의 Claude effort frontmatter 지원을 설치 버전 확인으로 간주하지 않았다. native agent는 선택 기본 강도와 같은 배정에만 쓰며 다른 강도는 명시 direct 경로로 출력한다.
- 2026-10-03: 자동 회귀는 mapping 변경→양쪽 drift 거부→재생성 통과, 동일 모델 강도 override, stale와 문맥 변경, 미지원/누락/차단/부모 fallback, alias actual 불일치, Claude 환경 override, 비소유 config 보존, 역할/선택 근거 누락을 확인했다. 앱/DB·공유 서비스 검사는 변경 범위에 없어 실행하지 않았다.
- 2026-10-03: 본 세션이 `claude agents --setting-sources project`로 세 등급 model frontmatter 로딩을 확인했다. 프로젝트 cwd의 `claude -p --agent task-balanced --effort medium --tools '' --disable-slash-commands --setting-sources project --output-format json --no-session-persistence` 권한 리뷰 smoke exit0, 주 modelUsage claude-sonnet-4-6(input 3/cacheCreate 5262/output 188), 내부 haiku는 별도 사용. 소유자 노출 영향과 타인 ID 거부 테스트 답변 적절. 선택표의 balanced를 native-confirmed로 표시하되 CLI 역할 세션 경로만 확인했으며 일반 Agent tool child/resume·backend 실제 effort·광범위 품질/청구 비용 비교는 미검증이다.
- 2026-10-03: 본 세션이 `codex --strict-config app-server --stdio`의 initialize→config/read(`cwd`=프로젝트 절대 경로, `includeLayers=false`)로 실제 parser가 `[agents]` defaults gpt-5.6-terra/medium을 읽고 exit0임을 확인했다. cwd 없는 첫 조회의 agents=null을 schema 확인 후 올바른 cwd 재조회로 해결했다. 이는 defaults 정적 로딩의 증거이며 custom agent 실제 spawn까지 검증한 것은 아니라 balanced는 direct-confirmed를 유지한다. 실제 목록 snapshot으로 Codex CLI·Claude CLI 균형/medium `assign` 명령도 통과했다.
