# Template-05 — 개발·리뷰 세션 모델 선택과 갱신

작성: 2026-10-03
상태: 완료(일부 미완료)
검토 기준: `c98d7e0`
선행: 없음

현재 요약: PR #65의 정책·도구·독립 리뷰·CI·머지는 완료했다. [Template-10-05](template-10-05-model-execution-evaluation.md)의 후속 실험은 CLI balanced 동일 구현·리뷰 두 과제, Claude native child 및 두 CLI의 동일 model/medium 부모 resume를 확인했다. Codex custom agent 지정은 현 도구 schema 미지원으로 종료했고 backend 실제 effort·child/설정 변경 resume·실제 청구비용·광범위/신규 후보 평가는 미확인이다. 선택표의 상태는 바꾸지 않았으며 아래 당시 실행 이력은 보존한다. 개발일 조회와 재개 절차의 정책 변경은 [Template-07](template-07-guidance-review-followup.md) PR 1이 소유한다.
이전 식별자: `002-agent-model-policy.md` / `002`. Template-07에서 템플릿 유지보수 영역으로 옮겼으며 아래 실패·조사·실행 이력은 당시 증거로 보존한다.

## 목표와 기준 문서

사용자는 서브 개발·리뷰 세션의 불필요한 고성능 상속을 줄이고 난이도·위험·반복 실패에 따라 모델을 선택하며 신규 모델을 놓치지 않도록 정책·선택표·프로젝트 실행 설정을 반영하도록 승인했다. [ADR-0007](../adr/0007-dual-development-agents.md)·[ADR-0008](../adr/0008-document-ownership.md)·[ADR-0010](../adr/0010-merge-authority.md) 안의 개발 방법 개선이다. PRD·ADR 변경, T02-4, 앱·DB·운영 배포·서비스 생성, 개인 전역 설정 변경·CLI 업데이트는 제외한다.

## 작업과 완료 조건

- [x] 공통 등급·상향/하향 정책과 갱신 절차, 단일 선택표를 연결한다.
- [x] Claude/Codex 연결 설정과 drift·배정 전 최신성/지원 검사를 구현한다.
- [x] 오류 경로 회귀 검사와 문서 검사를 통과하고 실제 확인·미검증을 구분한다.
- [x] 구현과 분리된 리뷰·CI를 통과하고 작은 PR을 머지한다.

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
| 결과와 다음 행동 | 정책·얇은 설정·배정 도구 및 실제 확인 범위는 아래 기록. PR #65 최종 head `7710753`의 독립 리뷰·필수 CI 통과 후 `f504c47`로 머지 완료. Codex custom spawn·Claude child/resume·backend effort·신규 후보 품질/비용 평가는 미검증 유지 |

| 단계 | 상태 | revision / 변경 | 검증 명령·결과 | 남은 작업 |
| --- | --- | --- | --- | --- |
| 정책·도구 | 완료 | merge `f504c47` | `npm run check:docs`: 텍스트 228개 및 실제 TOML 문법·parsed defaults 정합성, 회귀 26개 통과(두 번째 리뷰 수정 포함), 최종 독립 리뷰·CI 통과 | — |
| 직접 실행·설정 연결 | 미완료(사유) | Codex CLI 0.147.0 / Claude Code 2.1.140 / desktop 도구 | 아래 실제 smoke·목록 결과. 균형 direct, Codex defaults 파싱, Claude CLI agent 실행, 양쪽 assign medium 통과 | Codex custom spawn·Claude child/resume와 신규 후보 평가 |
| 신규 모델 평가 | 미완료(사유) | CLI/desktop 지원 목록이 다름 | 모델별 광범위 품질·비용 비교는 미실행. 현재 기본은 baseline이며 신규 평가 통과로 표기하지 않음 | 신규 발견 시 대표 구현·리뷰·사용량/요금 평가 |
| PR·리뷰·CI·머지 | 완료 | [PR #65](https://github.com/kimyongin/agent-workspace-template/pull/65), 최종 head `77107532eca2eac8880b1ca5ff4d06a6e6eaf8d4`, merge `f504c472d6551375ebaca8c4ed8ab5b46dcedc75` | [최종 독립 리뷰](https://github.com/kimyongin/agent-workspace-template/pull/65#issuecomment-5969278926) 발견 사항 없음·머지 가능, 같은 head의 [CI check·integration](https://github.com/kimyongin/agent-workspace-template/actions/runs/37123564974) 성공 | — |

### 이력

- 2026-10-03 21:45:42 KST: [최종 인계](https://github.com/kimyongin/agent-workspace-template/pull/65#issuecomment-5969302801)에 따라 PR #65 머지 완료. 003 작업 시작 때 GitHub의 MERGED·merge commit·최종 리뷰·필수 CI 증거를 실제 조회해 현재 요약을 맞췄다. 앞선 두 리뷰 head `9e054f7654cab7f24ac3b5425eb89ef9d59f4f50` / `ee070096c651ad072a9ff77633b969c0c3e10876`의 P2 multiline 문자열 오인 / quoted·공백 표와 키 중복 생성은 수정 이력이며 아래 당시 실행 증거와 미검증은 보존한다.

- 2026-10-03: 승인 범위·base·단독 편집 담당·작은 PR 계획 기록 후 시작.
- 2026-10-03: 본 세션이 Codex CLI app-server stdio에서 `initialize`→`model/list(limit=100, includeHidden=false)`를 LLM turn 없이 조회. gpt-5.6-sol/terra/luna, gpt-5.5와 지원 강도를 확인(nextCursor/upgrade=null). desktop spawn_agent의 gpt-6 목록과 구분했다.
- 2026-10-03: 본 세션의 Codex CLI `--ignore-user-config --strict-config --ephemeral --json --skip-git-repo-check -m gpt-6.1-sol -c model_reasoning_effort='medium' -c agents.enabled=false`는 HTTP 400 unsupported ChatGPT account로 거부됐다. 환경 지원 오류이며 추론/모델 능력 실패로 세지 않는다. CLI native 설정에는 계정 목록의 모델을 사용했다.
- 2026-10-03: 본 세션의 같은 CLI 경로 `-m gpt-5.6-terra` / `medium` 작은 구현 원칙·권한 리뷰 smoke가 exit0/turn.completed. 상대링크 기준·타인 ID 조회 영향·거부 테스트 답변 적절. input 11500/output 68/reasoning_output 0. 요청 모델의 무경고 성공이며 별도 actual 모델 metadata나 backend 실제 추론 강도·정확한 과금 비교까지 입증하지 않는다.
- 2026-10-03: 본 세션의 임시 격리 위치에서 `claude -p --model sonnet --effort medium --tools '' --disable-slash-commands --setting-sources project --output-format json --no-session-persistence` 작은 구현 원칙·권한 리뷰 smoke exit0. modelUsage 주 작업 claude-sonnet-4-6(input 3/cacheCreate 9056/output 242), 내부 보조 haiku(input 545/output 14)는 별도로 구분. 올바른 영향·거부 테스트 답변을 확인했으나 앱의 구체 오류 계약·native subagent/resume·backend 실제 effort·광범위 품질/과금 비교는 미검증.
- 2026-10-03: 실제 CLI help로 `codex exec --model`/`-c`/`--strict-config`, Claude `--agent`/`--model`/`--effort` 옵션을 확인. 새 문서의 Claude effort frontmatter 지원을 설치 버전 확인으로 간주하지 않았다. native agent는 선택 기본 강도와 같은 배정에만 쓰며 다른 강도는 명시 direct 경로로 출력한다.
- 2026-10-03: 자동 회귀는 mapping 변경→양쪽 drift 거부→재생성 통과, 동일 모델 강도 override, stale와 문맥 변경, 미지원/누락/차단/부모 fallback, alias actual 불일치, Claude 환경 override, 비소유 config 보존, 역할/선택 근거 누락을 확인했다. 앱/DB·공유 서비스 검사는 변경 범위에 없어 실행하지 않았다.
- 2026-10-03: 본 세션이 `claude agents --setting-sources project`로 세 등급 model frontmatter 로딩을 확인했다. 프로젝트 cwd의 `claude -p --agent task-balanced --effort medium --tools '' --disable-slash-commands --setting-sources project --output-format json --no-session-persistence` 권한 리뷰 smoke exit0, 주 modelUsage claude-sonnet-4-6(input 3/cacheCreate 5262/output 188), 내부 haiku는 별도 사용. 소유자 노출 영향과 타인 ID 거부 테스트 답변 적절. 선택표의 balanced를 native-confirmed로 표시하되 CLI 역할 세션 경로만 확인했으며 일반 Agent tool child/resume·backend 실제 effort·광범위 품질/청구 비용 비교는 미검증이다.
- 2026-10-03: 본 세션이 `codex --strict-config app-server --stdio`의 initialize→config/read(`cwd`=프로젝트 절대 경로, `includeLayers=false`)로 실제 parser가 `[agents]` defaults gpt-5.6-terra/medium을 읽고 exit0임을 확인했다. cwd 없는 첫 조회의 agents=null을 schema 확인 후 올바른 cwd 재조회로 해결했다. 이는 defaults 정적 로딩의 증거이며 custom agent 실제 spawn까지 검증한 것은 아니라 balanced는 direct-confirmed를 유지한다. 실제 목록 snapshot으로 Codex CLI·Claude CLI 균형/medium `assign` 명령도 통과했다.
- 2026-10-03: PR #65의 정확한 최초 head 독립 리뷰가 유효한 multiline developer_instructions 안의 `[agents]`를 테이블로 오인해 사용자 문자열을 수정하고 정합성 검사가 통과하는 P2를 재현했다. 원 구현 세션에서 문자열·escape·주석 문맥을 검사하고 현재 안전 편집 지원 범위 밖인 multiline basic/literal 문자열은 `check`와 `sync` 모두 거부하도록 수정했다. sync는 모든 변경을 계획한 뒤 쓰므로 거부 전에 다른 생성 파일도 바꾸지 않는다. 실제 agents 테이블 공존/미존재 네 조합에서 거부·원문/native 파일 byte 보존, 주석과 다른 단일행 문자열의 delimiter 오탐 방지를 확인했다. 이 편집기는 완전한 TOML parser가 아니며 여러 줄 문자열을 사용하는 새 설정은 문맥을 지원하는 도구 보강 전 자동 동기화하지 않는다.
- 2026-10-03: 리뷰 수정 재개 시 본 세션의 desktop balanced/medium preflight 통과를 전달받았고 기존 `gpt-6.1-sol` / `medium`을 유지했다. 수정 범위가 원인으로 좁혀진 설정 보존 결함이므로 모델/추론 강도 상향·하향은 없다. `npm run check:docs`의 선택표/native 정합성·회귀 23개 및 `git diff --check` 통과. 앱/DB·운영·개인 설정 변경 없음.
- 2026-10-03: 정확한 head `ee070096c651ad072a9ff77633b969c0c3e10876` 재리뷰에서 quoted/literal/공백 agents 표와 quoted default 키를 줄 기반 regex가 인식하지 못해 sync 결과가 중복 표/키로 무효인데 check는 통과하는 P2가 재현됐다. 첫 수정의 multiline 거부만으로 전체 문법 문제를 해결하지 못한 것이 원인이다. 사례별 regex를 추가하지 않고 Node 22에서 지원되는 실제 TOML parser/서식 보존 편집으로 대체했다.
- 2026-10-03: 공급자 [toml-patch 3.3.0 API](https://github.com/DecimalTurn/toml-patch/blob/v3.3.0/docs/API.md)·[smol-toml README](https://github.com/squirrelchat/smol-toml)와 npm metadata로 parse/patch API·버전·Node engines를 확인하고 두 devDependency를 exact pin/lock했다. 원문과 후보를 두 parser로 검증하고, check는 parsed defaults, sync는 두 defaults와 나머지 parsed 설정 의미를 비교한다. 안전성 검사가 끝난 모든 후보만 쓴다. CI check job의 `npm ci`를 문서 검사 앞으로 옮겼고 새 checkout 배정 도구의 준비 전제를 문서화했다.
- 2026-10-03: 최종 지원 범위는 multiline basic/literal 본문, basic/literal/공백/escape 표·키, dotted/inline/nested 표다. 회귀는 12개 표/키 조합의 valid→sync→valid·실제 두 값·비소유 줄/주석 보존·재실행 불변, multiline 본문 4조합, 배열/날짜/큰 정수·다른 agents 설정 보존, 중복·잘못된 문법·agents scalar/array 구조의 전체 파일 byte 보존 거부를 확인했다. 편집기는 agents 외 표 header도 동등한 표기·공백으로 정규화할 수 있으며 전체 파일 byte 동일성은 보장하지 않는다. 첫 수정의 multiline 일괄 거부 제한은 현재 구현에서 제거했다. 라이브러리가 처리하지 못하거나 후보 문법/비소유 의미가 바뀌는 경우 자동 편집하지 않는다.
- 2026-10-03: 로컬 `npm ci`는 실행 중일 수 있는 Windows rolldown native binding unlink의 EPERM으로 실패했고 일부 node_modules 제거 뒤 docs 검사도 모듈 누락으로 실패했다. 사용자 프로세스·서비스는 종료하지 않았다. 같은 package/lock의 `npm install`로 의존성 복구(exit0, 잠긴 rolldown/Supabase 이전 디렉터리 cleanup 경고) 후 `npm ls @decimalturn/toml-patch smol-toml --depth=0`와 `npm run check:docs`를 확인했다. 동일 package/lock을 저장소 밖 새 임시 디렉터리에 복사한 `npm ci --prefix <임시 디렉터리>`는 cold 설치 exit0·audit 0 vulnerabilities다. 기존 잠긴 잔여 디렉터리는 삭제하지 않았으며 CI의 격리 설치 결과는 본 세션이 확인한다.
- 2026-10-03: 두 번째 수정 재개도 본 세션의 desktop balanced/medium preflight를 전달받아 `gpt-6.1-sol` / `medium`을 유지했다. 반복된 부분 TOML 설계 결함을 parser 경로로 바꾸어 해결했고 설치 EPERM은 환경 실패로 구분했다. 모델/추론 강도 변경 없음. 최종 `npm run check:docs` 회귀 26개·정합성 및 `git diff --check` 통과. 실제 클라이언트의 추가 custom spawn/resume·광범위 품질/과금 검증은 기존 미검증으로 남는다.
