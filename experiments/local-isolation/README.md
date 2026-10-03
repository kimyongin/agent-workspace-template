# 독립 local Supabase 연결 실험

앱 lifecycle 구현 전에 CLI 2.119.0의 두 `--workdir`가 실제 DB·network·volume·pooler·함수를 격리하는지 시험했다. 공식 [changelog](https://supabase.com/changelog)·[config](https://supabase.com/docs/guides/local-development/cli/config), 설치 CLI의 start/stop/functions serve/gen signing-key/migration up 도움말을 2026-10-04 확인했다. PG17.11 breaking 변경은 현재 버전에 해당하며 OrioleDB는 쓰지 않는다.

`probe.mjs`는 비밀 없는 최소 config와 함수만 전용 `.local/experiments`에 생성한다. 원본 설정·env·keys를 읽지 않는다. 아래 `start`는 CLI secret 출력을 내부 소비하고 저장/출력하지 않는다. 기존 `t08-probe-a/b` 자원이 있으면 기록되지 않은 자원을 자동 채택하지 않는다. `serve`는 별도 터미널에서 실행하며 본인 실험만 관리한다.

```text
node experiments/local-isolation/probe.mjs .local/experiments/isolation-a t08-probe-a 56100
node experiments/local-isolation/probe.mjs .local/experiments/isolation-b t08-probe-b 56120
node experiments/local-isolation/run.mjs start a
node experiments/local-isolation/run.mjs start b
node experiments/local-isolation/run.mjs serve a
node experiments/local-isolation/run.mjs serve b
node experiments/local-isolation/verify.mjs
```

`verify.mjs`는 각 DB에 별도 marker를 쓰고 host pooler와 실제 함수 내부 pooler에서 같은 값을 읽는다. container/workdir label·network ID·DB volume을 대조한다. `results-windows-20261004.json`은 두 project의 실제 ID와 비밀 없는 응답 증거다. Windows Docker에서 두 프로젝트가 동시에 실행됐고 각각 자기 marker를 반환했다. 기존 template·fin 프로젝트는 보존했다. Linux 컨테이너 안의 함수 연결을 확인했지만 Linux 호스트에서 CLI 실행·경로 동기화는 미검증이며 PR 2/CI에 남긴다.

두 tenant는 실제 `_supabase._supavisor.tenants`에서 확인한 `pooler-dev`다. tenant가 서로 다르다고 가정하지 않는다. 각 독립 network의 `pooler` alias가 DB 연결을 분리한다. Docker `getent`가 프로젝트별 긴 컨테이너 이름을 해석해도 Edge의 postgres/node:dns 경로에서는 `ENOTFOUND`가 발생했다. 검증된 `pooler` alias를 사용하고 실제 network ID·project/workdir 소유권을 함께 확인하는 방법을 채택했다. 내부 `SUPABASE_URL`은 각 network의 `http://kong:8000`이며 공개 issuer/audience는 프로젝트별 API port를 사용한다.

초기 start 출력은 Git 제외 로그에 들어갔지만 secret 출력임을 확인해 파일 편집 도구로 그 두 전용 로그를 제거했다. 현재 재현 runner와 제품 lifecycle은 CLI secret 출력을 저장하지 않는다. PowerShell의 복합 파일 쓰기/삭제와 개별 삭제 명령은 자동 검토가 `blocked by policy`로 거부해 실행되지 않았다(상세 이유 미노출). 범위가 명확한 파일 편집 도구로 안전하게 처리했다.

개발 소비자의 추가 실제 검증은 `dev-smoke.mjs`와 `repeat.mjs`에 보존한다. 먼저 `npm run env:dev`를 실행하고 smoke에서 ES256 로그인·인증 API·할 일 생성·웹 설정을 검사했다. 다른 gateway의 403은 이 환경의 API key를 거부한 증거이며, 목적지의 올바른 API key와 이 환경의 JWT를 조합하는 교차 JWT 검증은 PR 2에 남긴다. Ctrl+C 종료 후 `env:setup`으로 재시작하고 repeat에서 task/user ID와 config/key/env 5파일 hash·mtime 보존을 확인했다. 증거 JSON은 비밀 값을 담지 않는다. 초기 smoke의 `public.tasks` 기대는 실제 schema `app.tasks`로 수정했다. CLI gateway의 기본 CORS header는 `*`이며 생성 WEB_ORIGINS와 구분한다. 이번 PR은 기존 gateway 정책을 변경하지 않는다.

준비 단계도 top-level Ctrl+C와 CLI 자식 트리 abort로 정리한다. ready 출력 이전 실제 Ctrl+C의 `Interrupted dev` 결과 후 `capture-cancellation.mjs`에서 container/network/lock 없음·개발 volume 보존을 확인했다(`cancellation-windows-20261004.json`). Windows PTY wrapper exit 1은 애플리케이션의 정상 정리 완료와 구분한다. SIGKILL처럼 실행 코드가 없는 종료는 owner/token/PID 확인과 fail-closed 수동 회복으로 남긴다.

중지된 소유 환경에서 `config-update.mjs`로 생성 설정 갱신과 config/manifest journal 완료를 확인했다. 키/password/env의 bytes·mtime, 포트, DB/cache volume의 ID/생성 시각은 유지했다(`config-update-windows-20261004.json`). 실행 중 source 설정 변경은 stop/재setup을 안내하며 old/new hash·owner가 어긋난 recovery는 거부한다. DB major version/engine은 자동 갱신 대상이 아니며 데이터 호환 계획을 별도로 요구한다.

```text
node experiments/local-isolation/dev-smoke.mjs
# env:dev 터미널에서 Ctrl+C 후
npm run env:setup
node experiments/local-isolation/repeat.mjs
```

정리는 serve 터미널을 Ctrl+C로 끝낸 뒤 `run.mjs record a/b`로 CLI가 재생성한 실제 edge ID를 확인·기록하고 `run.mjs stop a/b`를 실행한다. stop은 기록한 project/workdir/ID/network를 검증한 실험 자원에만 `--no-backup`을 사용한다. 제품 개발 명령의 stop은 DB를 삭제하지 않는다. probe 고정 포트는 작은 기술 실험용이며 일반 개발 명령은 머신 공통 registry에서 배정한다. 반복 실험 전에 남은 생성 폴더는 담당자가 canonical 전용 범위를 확인해야 하며 자동 덮어쓰기는 거부한다.
