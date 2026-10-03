# Template-08 — 개발·통합 테스트 실행 환경 격리

작성: 2026-10-04
상태: 진행 중
검토 기준: `29071c13337e44561dd6d6753707369325aebc62`
선행: [Template-04](template-04-development-workflow-hardening.md)의 공유 환경 후속, [Template-07](template-07-guidance-review-followup.md) PR #68 완료

## 목표와 기준 문서

사용자는 worktree별 개발 환경과 실행별 통합 테스트 환경, 독립 로컬 Supabase·포트·설정·계정·정리 범위와 코드 snapshot을 설명한 뒤 “그래 진행해보자”로 구현·검증을 승인했다. 기존 개발 환경과 다른 로컬 프로젝트를 보존하며 두 환경의 동시 실행과 중단·재실행을 실제로 확인한다.

제품 기능·기술 선택 변경이 아닌 개발 방법 개선이다. [PRD](../product/concept.md), ADR-0002/0007/0008/0010, [개발 방법](../development/workflow.md), [보안](../security/guide.md)을 따른다. PRD·ADR 변경·이탈은 사람에게 변경안을 제시하며, 운영 서비스·DB·비밀 교체·Pinecone 실호출·T02-4 재개는 포함하지 않는다.

## 설계와 실행 계약

- 식별 단위는 canonical checkout 경로 + 환경 종류다. 개발 환경은 안정적인 ID로 보존하고 테스트 환경은 실행별 ID로 생성한다. 이름·DB·Docker network/volume·키·사용자·API·웹·pooler·inspector·로그·결과 경로가 다른 환경과 겹치지 않아야 한다.
- Git 제외 `.local/` 아래 환경 폴더에 기본 설정에서 생성한 local-only Supabase 설정·키·env·소유권 manifest를 둔다. 원본 config·기존 `.env.local`·함수 `.env`·서명 키를 수정하거나 덮어쓰지 않는다. 운영 remotes·연결 상태와 원본 비밀은 snapshot에 복제하지 않는다.
- 설치 Supabase CLI 2.119.0의 `--workdir`로 환경별 실행 폴더를 지정한다. 프로젝트 ID만 바꿔 끝내지 않고 pooler identity, 컨테이너 내부 URL, JWKS issuer, MCP audience, Auth Site URL/redirect, CORS, E2E callback와 웹 설정까지 실제 연결을 검증한다. dev 코드 연결 방법과 test 코드 snapshot 방법은 Windows·Linux에서 실제 시험하고 확정한다.
- 포트는 컴퓨터의 공통 registry에서 묶음으로 예약한다. registry 위치·형식은 개인 로컬 실행 상태이며 Git 제외다. 원자 배정·잠금으로 다른 checkout/새 프로젝트와도 충돌을 피하고, 실제 사용 중인 포트를 검사한다. 외부 프로세스가 선점하면 기존 프로세스를 종료하지 않고 명확히 실패하거나 안전하게 새 묶음을 배정한다.
- 환경 생성과 사용에도 소유권·작업 잠금을 적용한다. 서로 다른 환경의 병렬 실행은 허용하되 같은 환경의 setup·migration·정리와 검증이 중첩되지 않도록 한다. 잠금 소유권·프로세스 종료/재사용·비정상 중단을 확인할 수 없으면 임의 회수하지 않는다.
- 모든 lifecycle 명령은 owner manifest·canonical path·환경 ID·생성 config를 대조한다. 환경 범위 밖 경로·symlink/junction 탈출·다른 프로젝트 자원에는 쓰기·정리를 하지 않는다. Docker 자원은 실제 ID/label과 생성 시 소유 환경을 확인하며, 일반 프로젝트명 검색으로 사용자 서버를 종료하지 않는다.
- dev 환경은 사람이 만든 자료를 보존한다. stop은 서비스만 종료하고 DB를 삭제하지 않는다. 통합 테스트는 반드시 실행별 test 환경으로 시작하며 dev에서 reset/test 실행을 거부한다. 생성했던 test 자원만 finally/Ctrl+C 정리하고 실패 증거는 보존한다. SIGKILL 등 정리가 불가능한 종료는 식별 가능한 잔여 상태와 안전한 회복 명령을 제공한다.
- dev은 해당 worktree 코드의 변경을 반영한다. test는 실행 시 Git tracked + nonignored 작업 파일의 코드·migration을 고정하고 commit·dirty 파일 hash·설정·명령·시각을 기록한다. `.git`·node_modules·기존 비밀·환경 상태·이전 artifact는 snapshot에 넣지 않는다. 의존성은 lockfile 기준으로 실행 환경에서 준비하며 테스트 중 공유 설치의 변경에 영향을 받지 않도록 한다. snapshot 복사 중 파일 변화는 감지·거부/재시도하고 실행 폴더의 경로 경계를 확인한다.
- 웹·DB·HTTP·MCP·worker·E2E는 같은 환경 정보에서 주소·계정·출력 경로를 읽는다. 401 응답이나 포트가 열렸다는 사실만으로 다른 환경의 서버를 재사용하지 않는다. 실행별 로그·trace·report는 재실행으로 덮어쓰지 않는다.
- test에는 공급자·운영 비밀을 자동 복사하지 않는다. dev의 외부 연동은 명시한 비밀 입력만 허용하며 기존 사용자 파일을 보존한다. registry/manifest/status/log에는 비밀값을 출력하지 않는다. 기존 CI는 운영 secret 없이 같은 격리 명령을 사용한다.

## PR 분할 계획

| 순서 | 브랜치 | 내용 | 직접 확인할 완료 결과 |
| --- | --- | --- | --- |
| 1 | `codex/local-environment-isolation` | 환경 생성·소유권·포트 배정과 개발 lifecycle, Supabase 실행 기술 실험·회귀 | 별도 ID의 로컬 개발 환경을 준비·실행·중지할 수 있고 기존 프로젝트·파일을 보존함 |
| 2 | `codex/isolated-integration-tests` | 코드 snapshot·독립 test runner·동적 접점·실행별 증거·CI와 정본 연결 | 두 checkout에서 격리 검증이 실행되고 한쪽 중단/정리가 다른 쪽에 영향 없음 |

PR 1의 개발 명령이 첫 소비자다. PR 2 전 기존 명령·CI의 공유 환경 경로는 변경하지 않으며, 임시 공존과 전환 대상·종료 조건을 명시한다. 기존 공유 환경에서 테스트 실행은 계속 순차 관리한다. 안전한 lifecycle/설정/검증을 함께 읽어야 해 400줄을 초과하면 파일·계약 관계를 PR에 설명하고 기능별로 추가 분할한다.

## 작업과 완료 조건

- [x] 두 local Supabase 프로젝트의 독립 network·DB·pooler·함수 연결을 작은 실험에서 확인하고 `experiments/`에 재현·결과를 보존한다(Windows host/실제 Linux 컨테이너 내부, Linux host CLI 미검증).
- [x] 고유 ID·포트 묶음 원자 배정·환경 manifest·lock·start/status/stop·dev 실행을 구현한다. 동일 setup 두 번의 키·계정·생성 파일 보존을 검증한다.
- [ ] snapshot·실행별 test 환경에서 DB·HTTP·MCP·E2E를 실행하고 실패·중단 때 본인 자원만 정리한다.
- [ ] 두 checkout 동시 실행, 데이터 독립, A 초기화/중단/정리 중 B와 기존 dev 유지, 실패 후 재실행을 실제 Docker 환경에서 검증한다. 컴퓨터 자원 제약은 동시 서비스와 실행별 회귀 범위를 구분해 기록한다.
- [ ] owner mismatch·경로 탈출·외부 포트 점유·잠금 충돌·부분 준비 실패·재실행·artifact 보존의 회귀를 위험 경계에 추가한다.
- [ ] package/CI·workflow·관련 안내·현재 상태를 실제 명령과 맞추고 양쪽 개발 에이전트 공통 진입점을 유지한다.
- [ ] 각 PR 최종 head의 새 독립 리뷰·check/integration CI·머지 증거를 PR 완료 코멘트에 기록한다.

## 검증

Node 22+·Supabase CLI 2.119.0·Docker·Windows와 CI Linux를 사용한다. 현재 Docker는 16 CPU/약 15.3 GiB RAM이며 `agent-workspace-template`과 `fin` 프로젝트가 실행 중이다. 이 기존 컨테이너를 종료·초기화하지 않는다. 실제 런타임 담당은 해당 구현 세션 한 명으로 하고, parent는 읽기·통합·CI·리뷰·머지에 집중한다.

`npm run check:docs`, `git diff --check`, 변경 스크립트의 의미 있는 회귀, 기존 check·integration을 실행한다. 동시 환경 증거는 실제 DB/HTTP 응답·컨테이너 ID·설정 fingerprint를 기록하며 fixture 검사만으로 완료 처리하지 않는다. 세부 명령은 구현된 package/config에서 확인해 아래 기록한다.

## 구현 인계와 완료 기록

| 필드 | 내용 |
| --- | --- |
| 목표·승인 | 위 설계·검증 구현을 사용자 승인, 개발 PC의 새 local-only 환경 생성/정리 허용 |
| 기준·공간 | PR 1 base `29071c13337e44561dd6d6753707369325aebc62`, `codex/local-environment-isolation`, `C:/Users/yongin/projects/agent-workspace-template`, 시작 clean main |
| 담당 | 메인: 사람과 합의한 설계·배정·Git/PR·통합·최종 증거. 구현 세션: 단계별 tracked 파일과 본인 생성 환경 단독 관리. 새 리뷰: 읽기 전용 |
| 모델·강도 | desktop balanced `gpt-6.1-sol` / high. 일반 개발 도구 구현으로 균형 유지, lifecycle·소유권·동시 배정 경계의 추론을 강화. 2026-10-04 현지 첫 작업에서 실제 active spawn 도구 목록 확인; 같은 날 snapshot 재사용. backend metadata 미노출 |
| 의존성 | PR 1 머지 후 최신 main에서 PR 2. 공통 파일 동시 수정 없음. 기존 프로젝트는 보존, 본인 환경만 실행 |
| 결과·인계 | 해당 단계의 명령·결과·미검증·다음 단계 기록. 외부 최종 증거는 PR 최종 완료 코멘트 |

| 단계 | 상태 | revision·결과 | 검증·남은 작업 |
| --- | --- | --- | --- |
| 1 개발 환경 | 구현(리뷰 대기) | 위 base·branch 작업 트리, 아래 PR 1 snapshot | 실제 로컬 실험·검사 완료, 정확한 head 독립 리뷰·CI·머지 미완료 |
| 2 통합 검증 | 미시작 | — | 1번 결과에 의존 |

### PR 1 구현과 검증 snapshot

`29071c1` 위 작업 트리에 `scripts/environment-state.mjs`(머신 registry·소유권·잠금·포트), `environment-runtime.mjs`(생성 config·코드 동기화·실제 Supabase/DB/계정), `environment.mjs`(첫 소비자인 개발 lifecycle)를 구현했다. [실제 명령·복구](../development/local-environments.md)와 [작은 기술 실험](../../experiments/local-isolation/README.md)에 연결한다. 네 추가 package 명령과 Vite의 생성 envDir 소비만 추가했으며 기존 공유 명령·CI·test runner는 바꾸지 않았다. PR 1은 400줄을 넘지만 안전한 생성·사용·stop과 즉시 사용하는 개발 명령을 함께 리뷰해야 하므로 세 구현 파일·경계 회귀·작은 실험으로 책임을 나눴다. snapshot runner를 포함하지 않으며 PR 2 분리는 유지한다.

실제 검증 환경: Windows·Node 24.15.0·Supabase CLI 2.119.0·Docker. 아래 JSON은 비밀 값·토큰·DB URL 원문을 담지 않는다.

| 검사 | 결과·증거 |
| --- | --- |
| `probe.mjs`·`run.mjs`·`verify.mjs` | `t08-probe-a/b` 동시 실행에서 서로 다른 DB marker를 host pooler와 실제 함수 내부 pooler로 읽음. [실제 network/container/volume 증거](../../experiments/local-isolation/results-windows-20261004.json) |
| `npm run env:setup`·`npm run env:dev`·`dev-smoke.mjs` | 새 `aw-dev-6739d1b500bb6eb3`, API 57000/DB 57001/pooler 57003/web 57008. ES256 로그인·API 목록 200·생성 201·웹의 생성 API 주소 확인, 다른 gateway가 이 환경의 API key를 거부(403). 올바른 목적지 key를 쓴 교차 JWT 검증은 미확인. [실제 endpoint 증거](../../experiments/local-isolation/dev-smoke-windows-20261004.json) |
| 동일 setup 재실행·Ctrl+C·재시작·`repeat.mjs` | config/key/env 5파일 bytes·mtime 동일, 개발 task와 user ID 유지. [비교 증거](../../experiments/local-isolation/repeat-windows-20261004.json). Windows PTY는 Ctrl+C 때 wrapper exit 1을 반환했지만 lifecycle은 `dev completed`·events와 본인 자원 중지로 확인 |
| `node --test scripts/environment-state.test.mjs` | 10개 통과: checkout별 배정·실제 외부 listener·owner mismatch·경로/junction 탈출·lock 충돌·살아 있는/PID 재사용 잠금 거부·죽은 프로세스 회복·코드 변경/삭제·원본 env 제외·caller env 제거·미등록/교체 Docker ID·volume 생성 시각·실패 artifact 보존·준비 취소의 실제 CLI 자식 트리 종료와 secret 출력 억제·설정 갱신의 active 거부/old-new 회복/major 변경 거부 |
| ready 이전 `env:dev` Ctrl+C·`capture-cancellation.mjs` | 정상 준비 중단 후 container/network/lock 없음, 기존 개발 DB/cache volume 2개 유지. [취소 후 실제 상태](../../experiments/local-isolation/cancellation-windows-20261004.json). SIGKILL과 구분하며 최초 준비 이전부터 top-level signal/abort/finally를 적용 |
| 중지 상태 `config-update.mjs` | API max_rows의 생성 설정 반영에서 기존 키/password/env bytes·mtime·포트·DB/cache volume의 ID/생성 시각 유지, journal 완료. [실제 설정 갱신 증거](../../experiments/local-isolation/config-update-windows-20261004.json) |
| `npm run check:docs`·`git diff --check` | 텍스트 249개·모델/native 정합성·회귀 42개 통과, diff 공백 검사 통과(최종 갱신 뒤 재검사) |
| `npm run build`·`npm run test:web`·`npm run check:boundaries` | 통과, 웹 1개 테스트. 기존 build의 500kB chunk 안내 유지 |
| `npm run check:deno`·`npm run test:core` | 통과: Deno 타입·lint·fmt, core/contracts·공급자 모의 경계 24개. 실제 공급자 호출 없음 |

중간 실패는 원인을 고친 뒤 좁게 재검사했다. Windows wildcard bind만으로 loopback listener를 놓쳐 IPv4/IPv6 loopback+wildcard 검사로 보강했다. 프로젝트별 긴 pooler Docker 이름은 getent가 해석해도 Edge postgres/node:dns에서 ENOTFOUND가 났으므로 검증된 독립 network의 `pooler` alias와 실제 tenant `pooler-dev`를 사용했다. 동기화 주기보다 Docker inspect가 느리면 작업이 쌓이던 경로는 동시 한 작업만 허용하도록 수정했다. 최초 API smoke는 functions serve 준비 이전 APP_DB_URL 부재를 보았으므로 dev ready를 실제 본인 로그인·인증 API·웹 설정 성공까지 기다리도록 강화했다. 반복검사 fixture의 schema를 public.tasks에서 실제 app.tasks로 수정했다. 초기 CLI 로그의 secret 출력은 전용 두 파일을 파일 편집 도구로 제거했고 새 runner는 stdout/stderr를 일반 로그에 저장하지 않는다. 복합/개별 PowerShell 삭제는 자동 검토 `blocked by policy`로 거부되어 실행되지 않았으며 상세 이유는 미노출이었다.

기존 template·fin 컨테이너와 원본 env/key는 변경하지 않았다. 부모가 저장한 원본 4파일 hash·mtime는 같았고, 기존 17개 컨테이너 중 처음부터 재시작 중이던 fin vector 외 16개 ID/status/StartedAt가 같았다. 본인 probe A/B는 실제 ID·label·workdir 확인 뒤 실험 runner의 제한된 stop으로 정리했다. 개발 DB와 `.local` 자료·registry 예약은 보존하고 서비스만 stop한다.

남은 검사·전환: Linux host CLI lifecycle·두 checkout의 snapshot 통합 검증·DB/HTTP/MCP/worker/E2E의 동적 접점·실행별 로그/trace/report·실패/Ctrl+C/SIGKILL 복구·CI가 PR 2 범위다. snapshot에는 독립 lockfile 의존성을 설치하고 원본 node_modules junction을 사용하지 않는다. caller의 RUN_PINECONE_E2E 같은 외부 실호출 opt-in도 test에 상속하지 않는다. 기존 `test:all`과 integration을 본인 개발 DB에 주입하거나 기존 사용자 DB로 대체해 실행하지 않았다. 필수 전체 integration CI와 정확한 head의 독립 리뷰·머지는 부모 담당으로 미완료다. CLI Kong 기본 CORS header가 `*`인 현재 baseline과 생성 WEB_ORIGINS를 구분하며 실제 gateway 경계는 PR 2에서 추가 검증한다. PRD·ADR 변경·이탈과 운영/공급자 호출은 없다.

IPv6 주소 비활성화의 `EAFNOSUPPORT`·`EADDRNOTAVAIL`은 포트 점유 `EADDRINUSE`와 구분한다([Node 기반 libuv 오류 정의](https://docs.libuv.org/en/v1.x/errors.html)). 현재 PC에서 IPv6를 끄지는 않았으므로 비활성 호스트 실제 실행 증거가 아니라 해당 오류 분기의 회귀다. IPv4 listener 검사는 그대로 유지한다.

### 세션 실행 기록

| 시점·세션 | 작업·이유 | 모델·강도·확인 범위 | 결과·다음 행동 |
| --- | --- | --- | --- |
| 2026-10-04 배정 / PR 1 구현 | 환경 생성·개발 lifecycle와 기술 실험 | 명시 gpt-6.1-sol/high, fork_turns=none; 현지 당일 실제 도구 목록 snapshot preflight 통과. native custom/실제 backend 실행 증거로 확대하지 않음 | 위 설계 안에서 상세 구조·검증 후 메인 인계 |
| 2026-10-04 결과 인계 / PR 1 구현 | 소유권·동시 배정·설정 갱신·준비 취소와 실제 개발 소비자 | 명시 균형 gpt-6.1-sol/high 유지, 환경 경계 때문에 high 유지. backend 모델·effort와 세션별 토큰/비용 미노출 | 실제 probe·개발 lifecycle·보존·중단·config 갱신 완료, 로컬 정본/42회귀/check/build 통과. 본인 서비스 중지·개발 volume/registry 유지. 독립 리뷰·CI·머지는 메인, snapshot runner는 PR 2 |

### 이력

- 2026-10-04: 사용자의 격리 구현 지시를 확인하고 clean main `29071c1`에서 시작했다. Supabase CLI help와 공식 config/changelog를 확인했다. 기존 고정 project/port·pooler·env·서버 재사용·프로젝트명 종료와 출력 경로 공유가 변경 대상이다.
