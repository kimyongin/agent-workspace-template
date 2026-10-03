# checkout별 로컬 개발 환경

[Template-08](../tickets/template-08-local-environment-isolation.md) PR 1의 추가 개발 명령이다. Node 22 이상에서 `npm ci`로 고정 CLI·의존성을 준비하고 Docker를 실행한다. 운영 프로젝트·기존 로컬 프로젝트에 연결하지 않는다.

| 명령 | 결과 |
| --- | --- |
| `npm run env:setup` | checkout의 독립 Supabase·서명 키·개발 계정과 설정을 준비하고 migration을 적용한다. 재실행하면 같은 DB·키·비밀번호를 사용한다 |
| `npm run env:dev` | 같은 준비 후 함수·웹을 실행한다. 본인 계정 로그인·인증 API·웹 주소 주입을 확인한 뒤 ready를 출력한다. Ctrl+C는 본인 함수·웹·Supabase만 중지하며 DB volume을 보존한다 |
| `npm run env:status` | 설정 fingerprint·포트·작업 잠금과 실제 Docker ID/label을 조회한다. 키·비밀번호를 출력하지 않는다 |
| `npm run env:stop` | 저장한 실제 Docker ID, project/workdir label, 독립 network를 대조하고 해당 Supabase를 중지한다. DB volume을 보존한다. `env:dev` 실행 중에는 그 터미널에서 Ctrl+C를 사용한다 |

canonical checkout 경로가 개발 환경의 안정적인 ID를 정한다. `.local/environments/<id>/`가 설정·비밀값·함수 코드 사본·소유권 manifest와 자원 ID를 가진다. 원본 `.env.local`·`supabase/.env`·함수 `.env`·서명 키·config·운영 remote는 복제하거나 수정하지 않는다. 생성 config의 수동 변경은 fingerprint로 거부한다. 원본 config에서 가져오는 API schema/한도·DB major version·Auth hook/OAuth server·함수 설정이 바뀌면 실행 중에는 stop/재setup을 안내한다. 중지 상태에서는 journal의 old/new hash와 owner를 검증해 config·manifest만 갱신하고 키·비밀번호·포트·DB volume을 보존한다. 중간 종료의 `config-update.json`은 같은 checkout에서 `env:setup`을 다시 실행해 제한된 old/new 상태만 회복한다. DB major version·engine 변경은 데이터 호환 계획 없이 자동 적용하지 않는다. 로컬 포트·issuer·redirect·이메일 개발 로그인·외부 공급자 비활성화는 안전한 환경별 값으로 덮어쓴다.

포트 registry는 Windows의 `%PUBLIC%/agent-workspace-environments`, Linux의 `/var/tmp/agent-workspace-environments`에 둔다. 같은 컴퓨터의 checkout과 프로젝트가 공유하는 로컬 실행 상태이며 비밀은 없다. API·DB·shadow·pooler·studio·SMTP·analytics·inspector·웹·callback의 포트 묶음을 원자 예약하고 IPv4/IPv6 wildcard·loopback의 실제 점유도 검사한다. 예약 이후 외부 프로세스가 선점하면 실패하며 그 프로세스를 종료하지 않는다. 안정적인 개발 환경의 예약은 stop 후에도 유지한다.

setup·migration·개발 실행·stop은 환경별 디렉터리 잠금을 사용한다. 포트 배정은 registry의 별도 공통 잠금으로 보호한다. 같은 환경에 겹치는 변경은 실패하고 status 읽기는 허용한다. `.local`·환경 경로의 symlink/junction, manifest owner/path/project mismatch, 생성 config의 변경, 미등록 Docker ID·다른 workdir/network는 fail closed로 거부한다. Supabase CLI에는 `--workdir`와 정확한 project ID만 전달하며 `stop --all`·개발 DB 삭제·reset·개발 환경에서의 test 명령은 제공하지 않는다.

정상 Ctrl+C/SIGTERM은 준비 이전부터 처리한다. 시작·migration 중에는 해당 CLI 자식 프로세스 트리를 중지하고 기록/확인한 본인 Supabase만 stop하며 잠금을 해제한다. 함수·웹 실행 이후에도 같은 정리 경계를 적용한다. 강제 종료와 살아 있는/PID 재사용 잠금은 아래 수동 회복 경로를 사용한다.

잠금은 PID·host·owner·token·시각을 기록한다. 프로세스가 살아 있거나 PID가 재사용됐을 수 있으면 회수하지 않는다. 비정상 종료 후 `env:status`와 `operation.lock/owner.json`을 확인하고, 같은 host·owner의 해당 PID가 존재하지 않는 경우에만 `node scripts/environment.mjs unlock <기록된 token>`으로 환경 잠금을 회수한다. registry 잠금은 `unlock-registry <token>`을 쓴다. 이 명령은 자원을 삭제하지 않는다. 이후 `env:stop` 또는 `env:setup`으로 기록한 자원을 다룬다. 시작 도중 SIGKILL처럼 자원 기록까지 못 끝난 상태는 임의 채택하지 않는다. 미등록 자원은 Docker ID·label·workdir를 읽기 확인하고 담당자에게 인계한다.

함수 코드는 `.ts`·`.json`·`.lock`, migration은 `.sql`만 복사한다. 개발 실행 중 함수 코드 변경·삭제를 동기화하며, 한 번의 동기화가 끝나기 전에 다음 작업을 쌓지 않는다. migration 적용은 setup 시점에만 한다. 함수 소스의 symlink는 거부하고 `.env`·비밀·다른 artifact는 제외한다. 웹은 worktree 소스와 해당 환경의 `web/.env.local`을 사용한다. caller의 기존 `VITE_*`·`SUPABASE_*`·DB·worker·공급자 환경 변수는 자식 프로세스에 상속하지 않는다.

서버 설정에는 실제 설치 CLI의 tenant를 확인해 넣는다. CLI 2.119.0은 프로젝트별 network 안에서 `pooler-dev` tenant와 `pooler` alias를 사용한다. name만으로 공유 서버를 재사용하지 않으며 컨테이너의 network ID와 project/workdir label까지 대조한다. ES256 키·개발 계정·역할 비밀번호·issuer·MCP audience·Auth redirect·WEB_ORIGINS는 환경별로 생성한다. 로컬 CLI의 Kong 기본 CORS 응답은 `*`일 수 있으므로 생성 WEB_ORIGINS와 gateway의 실제 header를 구분한다([실험 결과](../../experiments/local-isolation/README.md)).

외부 연동을 원하면 그 개발 환경의 `functions.env`에 필요한 공급자 키를 사람이 명시 입력한다. 자동 복사·출력하지 않으며 재setup은 사용자 추가 선언·주석을 보존한다. CLI start/status의 secret 출력과 자식 프로세스 stdout/stderr는 일반 로그에 저장하지 않는다. `events.log`는 명령·시각·성공 여부만 누적한다. 실패 원인은 비밀 없는 경계 검사와 본인 컨테이너의 필요한 로그를 선별하여 확인한다.

PR 2 전에는 `setup:local`·`dev`·`serve:functions`·`test:all`·기존 DB/HTTP/MCP/E2E·CI가 여전히 공유 설정을 쓴다. 이 명령은 [공유 환경 규칙](workflow.md#공유-환경과-테스트-자료)에 따라 순차 실행한다. `runtime.env`를 기존 test 명령에 주입해 개발 DB를 초기화하지 않는다. PR 2에서 코드 snapshot·독립 의존성·실행별 test 환경·동적 접점과 artifact/CI를 연결하고, 두 checkout의 동시 검증과 중단/정리를 확인하면 공존을 끝낸다. Windows 실제 lifecycle과 Linux 컨테이너 내부 연결은 PR 1에서 확인했으며 Linux 호스트 CLI lifecycle·전체 통합 runner는 아직 미검증이다.
