# Template-10-06 — 기존 운영 서비스 변경 반영

작성: 2026-10-04
상태: 승인된 기존 운영 변경 적용 완료(실제 사용자 업무·소량 색인 미확인, Cron 보류; 기록 PR 검증 대기)
검토 기준: 배포할 최종 main revision은 선행 PR 머지 후 고정
선행: Entity·활동 복원·제품 패키지의 독립 리뷰와 필수 CI

## 최종 운영 결과 — 2026-10-04 KST

메인이 기존 운영 반영의 실행을 명시 인계했다. source는 merged main `1730dc983eb10e282e28f3a200ffbd265978480e`, PR #80 exact `18b7eff0f8199996767585a04109216eb3208738`, [완료5974516525](https://github.com/kimyongin/agent-workspace-template/pull/80#issuecomment-5974516525)·[CI37160563892](https://github.com/kimyongin/agent-workspace-template/actions/runs/37160563892) check36초/integration11분37초 SUCCESS/CLEAN·독립 머지 가능이다. release 담당은 해당 main으로 FF하고 정상 signed-in CLI/connector로 아래 운영 변경·재조회를 직접 수행했다. 같은 balanced/medium 배정 유지·당일 preflight PASS는 메인 인계이며 backend model/effort/실청구액은 미노출이다.

| 단위 | 실제 적용·검증 | 한계 |
| --- | --- | --- |
| 대상·변경 전 | workspace-template/ayzcluvdppsppwszzaqx, PostgreSQL17.11, 기존 migration2·tasks/records/queue/archive0. dry-run 신규11 정확히 일치·checkpoint hash 재확인·기존 source18파일 | provider daily/PITR 목록 미확인, 아래 app/private checkpoint는 전체 백업/복구 증명 아님 |
| DB | 2026-10-03T23:19:49Z additive migration11 exit0, 총13. tasks/records/principles/entities/queue/archive 모두0, 해당 원본·search state RLS true | reset/seed/repair/과거 migration 수정·auth testuser/token 발급·운영 자동 CRUD 시험 없음 |
| 역할·Secrets | app_worker LOGIN true/NOINHERIT/NOBYPASSRLS/nosuperuser, 원문 SELECT false/app_user MEMBER false/claim EXECUTE true. 새32byte password·token, SCRAM verifier로 role 설정·서버 Secrets WORKER_DB_URL/INDEX_WORKER_TOKEN/PINECONE_API_KEY 3개 적용 | 기존 APP_DB_URL/Auth/MCP/origin 유지. local worker 암호/token 미사용. credential630byte DPAPI CurrentUser 보관·일시 env 정확한 경로 삭제/부재 확인, 값·URLcredential 미출력 |
| 함수 | 최종 api/mcp ACTIVE v6, index-worker ACTIVE v2, verify_jwt=false·명시 공통 map. 정상 download50파일 중 TS49개 main source byte동일·map imports동일 | 아래 최초400/추출경계 실패 보존. bundle hash는 source revision과 별도 |
| 거부/공개 metadata | 최종 API missing·invalid401, MCP missing401+challenge, worker missing401. challenge의 `/functions/v1/mcp/oauth-protected-resource`200/resource·issuer·header 일치 | 일반 well-known 경로로 잘못 probe한404는 절차 이력. 인증된 사용자 읽기/쓰기·OAuth 성공 아님 |
| 빈 큐 점검 | 직전 queue/archive0 재확인 후 2026-10-03T23:23:06Z `{limit:1}` 한 회만:200, claimed/indexed/excluded/failed/retry/stale 모두0 | v1에서 수행한 동일 worker source; map위치 재배포 후 반복 안 함. Pinecone 실제 호출·색인 소량 성공 미증명, Cron/Vault 일정 미활성·cron.job 없음 |
| Pages | 수동 ref=1730dc, [run37161621033](https://github.com/kimyongin/agent-workspace-template/actions/runs/37161621033) SUCCESS, deployment6834375397 sha동일. [공개 URL](https://kimyongin.github.io/agent-workspace-template/) HTTP200/root·asset 경로 확인 | artifact11287568491/github-pages/220444bytes/미만료, expires2026-10-04T23:23:46Z. Google 로그인·실제 사용자 UI·실기기/스크린리더는 미검증 |
| 제품 ZIP | `C:/Users/yongin/.codex/artifacts/workspace-release-20261004/workspace-0.1.1.zip`·`.json`·`.source.json`, SHA78974e53e41615a85943037a91db04c30c766a2b6e353e8d992ef71013fa60e3 직접 대조. root가 cleanmain1730dc 출처/31tools/6files/server source hash859d8df7ffbf2ce5c022bcc7ad04559e0b5d6f740187b4e2f71d750c0f54bddc 확인 | [자식07](template-10-07-plugin-behavior.md)의 frozen actual8c94/72d4와 최종 packaging 출처 구분. prod 실클라이언트 업무 성공으로 확대 안 함 |

최종 runtime bundle SHA-256: api `d5e42df61f7c86373567abeb209afed1a5813b381caa20b43e236b2333c1702b`, mcp `2073dfffe41fe9625b089e500450d909ed979445990bd9a3f98635eaace6ae93`, index-worker `bc0c9b1a8c0d78acdf00b69bfb6d84f3bd71014fc488c8a15e277516567f07c8`. download map SHA `a886b85f244a1096139bd35e8b653ef28a94c865dd8f6f98ccfc8c7ae7422d9d`.

배포/다운로드 오류를 숨기지 않는다. 첫 locked CLI2.119.0 `--use-api` 배포는 workspace member의 빈 deno.json만 보고 `hono/cors`·`@supabase/server`·`zod`를 해결하지 못해400였다. 기존 API/MCP는 ACTIVE의 원본 hash를 유지하며 version4로 표시됐다. 동일1730dc imports만 외부 map으로 명시한 재시도는 API/MCPv5·workerv1 배포/거부/metadata/빈 큐 점검에 성공했다. 그러나 map이 functions 밖 root에 있어 정상 download가 UnsafeFunctionDownloadPathError로 거부했다. 안전경로 검사를 우회하지 않고 map을 외부 임시 workspace의 `supabase/functions/release-import-map.json`으로 옮겨 같은 source를 재배포해 v6/v2가 됐고 정상 download/source 대조를 완료했다. 앱 소스·개인 설정·인증 보호는 바꾸지 않았다. [배포 가이드](../deployment/release.md#cli-서버-bundler의-공통-import-map)에 실제 검증한 방법을 좁게 반영했다. generated map 두 경로는 경계 확인 후 LiteralPath로 삭제했으며 downloaded source artifact map은 보존했다.

운영 자료를 만들고 지우는 자동 검사는 실행하지 않았다. 정상 prod 본인 세션이 없어 Google/OAuth·인증된 discovery/업무·최소 쓰기/색인 성공을 확인하지 못했고 임의 user/token으로 대체하지 않았다. Cron 활성화·provider 백업 가능성·복구 실증·claude.ai 웹/mobile·실기기/스크린리더·backend effort/실청구액은 미완료/미확인이다. T02-5/6 제외와 shared local 환경 접근 금지는 유지했다. 실제 변경 단위의 적용 완료와 이 미확인을 구분하며 최종 기록 PR 독립 리뷰·CI·머지는 메인이 조정한다.

실행별 sanitized evidence는 저장소 밖 `C:/Users/yongin/AppData/Local/Temp/workspace-release-preflight-20261004/`, 최종 source50파일·대조목록은 `C:/Users/yongin/AppData/Local/Temp/workspace-release-runtime-1730dc9/`에 있다. credential·checkpoint 암호문은 Git에 넣지 않으며 위 공개 성공/실패·hash·count만 기록했다. 아래 준비·실패·수정 snapshot은 당시 이력이다.

## 목표와 기준 문서

사용자는 T02-5/6을 제외한 모든 잔여 작업을 진행하도록 지시했고 앞서 제시한 T02-3 운영 반영도 포함한다. 기존 Supabase `workspace-template`(`ayzcluvdppsppwszzaqx`)와 GitHub Pages `https://kimyongin.github.io/agent-workspace-template/`의 검증한 기능을 갱신한다. 새 서비스 생성, Book 전환, 초기화·출시 자동화와 백업 복원 연습은 하지 않는다. [배포 방법](../deployment/release.md)·[운영 방법](../operations/runbook.md)·[보안](../security/guide.md)의 호환 순서와 보호 경계를 유지한다.

## 작업과 완료 조건

- [x] exact merged revision·독립 리뷰·필수 CI 성공과 배포 대상 일치를 확인한다.
- [x] 원격 migration dry-run으로 추가 목록과 호환성을 확인한 뒤 적용한다. seed/reset 없이 기존 데이터를 보존한다.
- [x] 신규 worker의 역할·Secrets를 서버에만 설정하고 API/MCP/worker를 배포한다.
- [x] 미인증 거부·metadata·worker 인증 거부와 승인된 최소 점검을 수행한다. 실제 사용자 Google/OAuth 검증 접근이 없으면 그 범위를 남긴다.
- [ ] worker 준비·소량 성공·호출 범위를 확인한 뒤 기존 검색 소비의 운영 설정을 적용한다. 실제 소량 성공을 확인하지 못해 Cron/Vault 일정은 보류한다. 빈 큐 0건은 색인 성공이 아니다.
- [x] 같은 서버 계약의 Pages revision과 제품 ZIP/hash를 고정하고 원격 동작을 확인한다.
- [x] 실제 단위별 배포 revision·적용 결과·미확인·복구 기준을 남긴다.

## PR 분할 계획

| 순서 | 브랜치 | 결과 | 기준 |
| --- | --- | --- | --- |
| 1 | `codex/release-existing` | 기존 환경의 실행 기록과 실제 소비에 필요한 설정·가이드만 반영 | ADR-0008·배포/운영 가이드 |

## 검증

개발 테스트는 격리 integration CI에서 수행한다. [T02-2의 운영 경계](template-02-implementation-base.md#외부-자원-준비-전의-로컬-대체)에 따라 운영에는 자료를 만들고 지우는 자동 테스트를 실행하지 않는다. 로그인·조회·MCP 연결을 확인하며 쓰기가 필요하면 접근 가능한 사람 본인 계정의 명시적 점검 한 건만 확인 후 정리한다. 실제 계정 세션에 접근할 수 없다면 토큰 발급이나 새 시험 계정으로 대체하지 않는다. worker는 인증 거부·빈 큐 호출까지 안전하게 확인할 수 있으나 실제 한 건의 소량 성공을 확인하지 못하면 Cron 소비 활성화를 완료 처리하지 않는다. 원본·OAuth 비밀을 출력하지 않고 운영 데이터로 RLS·경쟁·파괴적 실험을 대신하지 않는다. 사람의 계정 로그인·실기기 검증을 하지 못하면 자동 테스트와 구분한다.

## 구현 인계와 완료 기록

메인이 읽기 전용으로 2026-10-04 KST에 확인: migration `20261003000000`·`20261003000100` 두 개, api/mcp ACTIVE v3, tasks/records 각 0건. 원칙·태그·색인·worker는 미배포다. Supabase CLI 2.119.0의 실제 help/list를 확인했고 신규 worker Secrets는 아직 없다. project/list_migrations connector는 internal error라 execute_sql·functions list로 대체 조회했다.

기존 api/mcp 소스는 CLI `functions download --use-api`로 저장소 밖 `C:/Users/yongin/AppData/Local/Temp/workspace-release-20261004/supabase/functions/`에 보존했다(18파일). 처음 복사 config의 로컬 signing_keys 참조가 없어 실패했고 그 임시 config의 참조만 제거한 뒤 성공했다. 운영 설정은 바꾸지 않았다. 이는 코드 artifact 보존이며 백업 복원 성공 증거가 아니다.

보안 advisor에는 기존 `auth_leaked_password_protection` 경고 하나가 있다. 이메일 가입이 꺼진 Google 로그인 구성이고 이번 범위에서 기존 인증 보호를 낮추지 않는다. 설정 변경 여부는 기능 경계에 맞춰 판단하며 [공식 조치](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)를 근거로 남긴다.

실제 클라이언트 접근: 현재 채팅의 빈 IAB·MCP Apps만 노출되고 native apps는 disabled다. 기존 로그인 Chrome/Claude 웹·desktop·mobile 접근은 없다. 이 조건을 정상 로그인·실클라이언트 업무 검증 완료로 해석하지 않는다.

### 담당·읽기 전용 준비 결과

`evaluate_models` 서브세션이 별도 worktree `codex/release-existing`에서 준비했다. 시작 `db70cbf22b39732e24aaad57000268f7a281128d`를 최신 main `09851bb`까지 FF했고, 부모가 전달한 당일 desktop 균형 `gpt-6.1-sol`/`medium` 동일 설정 preflight 통과를 유지했다. 배포 계약·환경 확인과 제한된 기록 작업이므로 모델/강도 상향·하향은 없다. backend metadata·세션 사용량은 미노출이다. 사용자 승인 범위는 기존 운영 반영이며 지금은 부모의 최종 검증 revision 실행 인계 전이라 remote mutation·Secrets 변경·함수 배포·Pages dispatch는 하지 않았다.

| 확인 | 실제 결과 | 제약 |
| --- | --- | --- |
| 실행 파일 | `npm ci` 168개·audit 취약점 0. lockfile CLI `2.119.0`의 실제 help를 사용 | PATH의 전역 CLI는 `2.98.2`; 업데이트하지 않고 프로젝트 `node_modules/.bin/supabase.cmd`만 사용 |
| 원격 대상 | connector get_project: workspace-template, ap-northeast-2, ACTIVE_HEALTHY, PostgreSQL 17.11.0.002 | 새 프로젝트·요금제 변경 없음 |
| migration dry-run | `db push --dry-run --skip-vault --project-ref ayzcluvdppsppwszzaqx`: exit 0, 신규 10개·seeds/roles 파일 목록 비어 있음 | 아래 목록은 준비 시점이며 Entity 등 선행 PR의 최종 migration을 실행 인계 후 다시 확인. roles 목록이 비었다고 migration SQL의 app_worker 생성까지 없다는 뜻은 아님 |
| 현재 DB/큐 | 두 기존 migration 재조회. app_server LOGIN/nobypassrls, app_worker 없음. tasks/records/queue/archive 각각 0. 원칙·색인 테이블·cron.job 없음 | 사용자 ID·본문은 조회하지 않음. 자료 생성/삭제·auth token 발급·시험 계정 생성 없음 |
| 호환성 | 현재 pgmq 1.5.1의 `read(text,integer,integer,jsonb)` 및 send/set_vt/delete/archive signature를 catalog에서 확인. 신규 worker의 filtered claim에 필요한 인자 존재 | 실행 성공은 최종 적용 후 안전 점검에서 확인 |
| Secrets | custom `APP_DB_URL`, `AUTH_ISSUER`, `MCP_URL`, `WEB_ORIGINS` 존재. `WORKER_DB_URL`, `INDEX_WORKER_TOKEN`, `PINECONE_API_KEY`는 원격에 없음 | 이름·갱신 시각만 기록. 기존 값은 보존하고 local worker 암호/token을 운영에 복사하지 않음 |
| API/MCP artifact | ACTIVE v3, verify_jwt=false 재확인. 기존 다운로드 18파일 존재 | source artifact이며 DB 백업·복원 증거가 아님 |
| 기존 Pages | deployment `6824042223`, SHA `97085ccf1754253b2a173671fd7b750f78c9d765`, [run 37101766617](https://github.com/kimyongin/agent-workspace-template/actions/runs/37101766617) success. `github-pages` artifact `11265802953` 미만료, 만료 2026-10-04T06:03:08Z | 최종 실행 전 상태 재조회·필요하면 기존 artifact 보존. Pages source=workflow·공개 PROD URL/API 변수의 대상 일치 확인 |
| 백업 경로 | 실제 CLI `db dump --dry-run`의 원격 session pooler 경로·pg_dump 계획 확인 후 아래 승인된 app/private 단일 snapshot checkpoint 생성·DPAPI 보호 완료 | 기존 프로젝트의 실제 daily/PITR 목록은 connector 도구·환경 관리 token·인증 dashboard 접근이 없어 미확인. 최소 checkpoint의 메모리 무결성과 복원/복구 가능성은 구별 |
| 보안 advisor | 기존 leaked-password protection 경고 1개 재확인 | [공식 조치](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Google-only 기존 보호를 낮추는 설정 변경 없음 |

원격 dry-run은 저장소 밖 임시 config/migration 복사본에서 실행했고 그 복사본의 로컬 `signing_keys_path` 참조만 제거했다. 원본·원격 auth 설정은 변경하지 않았다. 비밀은 primary `supabase/.env`에서 subprocess 환경으로만 전달했고 값·원본 env·raw config/auth 로그는 보고·커밋하지 않는다. 공유 local Supabase/worker에는 접속하거나 서비스를 바꾸지 않았다.

현재 추가 목록:

```text
20261003065427_principles.sql
20261003073442_principle_record_links.sql
20261003074639_record_principles.sql
20261003080756_tags.sql
20261003081643_task_tags.sql
20261003083425_knowledge_tags.sql
20261003090825_search_index_state.sql
20261003093231_search_hash_permissions.sql
20261003094918_search_index_worker.sql
20261003100850_search_query_budget.sql
```

기존 source와 migration을 대조했다. 원칙·태그·연결·색인 상태/벡터·예산을 추가하며 기존 tasks/records 원문을 바꾸거나 기존 API 계약을 제거하지 않는다. `20261003073442`는 보존된 no-op 이력이다. 색인 migration은 원문을 유지하면서 현재 입력의 파생 상태·큐를 backfill/집약하며 준비 시점 원본·큐는 0건이다. 구 서버의 pipeline 없는 큐 메시지도 새 worker가 현재 원본/hash와 일치할 때만 처리한다. 실제 적용 직전 backlog를 다시 읽고 성공을 큐 삭제로 대신하지 않는다.

Supabase changelog markdown을 직접 읽고 관련 PostgreSQL 17.11 breaking-change 문서를 확인했다. 원격에는 ltree/btree_gist extension·app/private의 legacy PGP 함수·영향받는 custom selectivity operator가 없음을 읽기 전용 catalog로 확인했다. 앱은 pgcrypto digest를 사용하며 legacy encryption을 쓰지 않는다. 새 확장/version·CLI 기능은 실제 help/catalog를 기준으로 한다. [공식 changelog](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes), [Secrets](https://supabase.com/docs/guides/functions/secrets), [백업 범위](https://supabase.com/docs/guides/platform/backups)를 실제 조회했다. 프로젝트 요금제의 actual daily/PITR 제공 범위를 조회하지 못했으므로 문서의 일반 제공 범위를 이 프로젝트의 가용 백업으로 확정하지 않는다.

### 최종 revision 인계 후 실행할 순서

| 단계 | 실제 인자/변경 계획 | 성공·중단 기준 |
| --- | --- | --- |
| 0 고정/복구 지점 | 최종 merged SHA·독립 리뷰·필수 CI·프로젝트 ref·공개 URL·직전 artifact와 백업 가능 여부 대조. 최신 migrations/list·counts·dry-run 재조회 | 복구 지점·대상·필수 CI 근거 미확인 또는 예상 밖 목록이면 DB mutation 전에 멈춤 |
| 1 migration | locked CLI `db push --skip-vault --project-ref ayzcluvdppsppwszzaqx`(확인한 migration만, include-seed/include-roles/include-all/reset 없음) | migration 적용 이력·신규 객체/역할·RLS/grants 재조회. 오류 시 이후 배포 중단하고 실제 적용 상태 확인. 과거 파일 수정·seed·repair 없음 |
| 2 역할·Secrets | app_worker에 운영 전용 무작위 암호 설정, 트랜잭션 pooler WORKER_DB_URL 구성. 운영 전용 32byte 이상 INDEX_WORKER_TOKEN 생성. 기존 Pinecone 키를 서버 전용 env에만 사용하고 `secrets set --env-file <저장소 밖 운영 전용 파일> --project-ref ...` | APP_DB_URL·Auth/MCP/origin 기존 값 보존. local app_worker 암호/token·개발 계정·service_role을 복사하지 않음. 값·SQL 암호·URL credential을 출력하지 않음 |
| 3 함수 | `functions deploy api mcp index-worker --use-api --no-verify-jwt --project-ref ...`; 이름을 명시하고 prune 없음 | api/mcp 자체 서명·issuer/audience 검증, worker 내부 token 검증 유지. deployed version/hash·verify_jwt·revision 기록 |
| 4 안전 점검 | 미인증 API/MCP·worker 인증 거부, 공개 metadata, DB 준비 후 실제 큐가 빈 것을 확인한 경우에만 explicit `limit: 1` 한 회 호출. backlog가 있으면 소비하지 않고 중단. 운영 test:db/http/mcp/e2e·index-worker-smoke 없음 | 기존 실제 본인 Google/OAuth 세션이 없으면 로그인/조회/최소 쓰기·한 건 색인 성공은 미검증. 임의 token/new user로 대체하지 않음. 소량 성공이 없으면 Cron/Vault 소비 일정 활성화 보류 |
| 5 Pages/ZIP | 서버 계약 확인 후 `gh workflow run pages.yml -f ref=<같은 검증 SHA>`; Pages workflow 결과/배포 SHA·URL 확인. 같은 코드의 제품 ZIP/hash·설치 대상과 호환 기록 | main 포함 SHA만. actual 로그인/실기기·클라이언트 행동과 정적 URL/패키지 검사를 구분. ZIP 설치 성공을 OAuth 업무 성공으로 바꾸지 않음 |
| 6 현재 요약 | START-HERE·overview·Template-02·Template-10의 현재 상태/다음 작업을 실제 결과와 자식 최종 증거에 맞춤 | 당시 실행 이력 보존. T02-5/6·미접근 surfaces·backend effort/실청구액·Cron 소량 성공은 완료 표시하지 않음 |

실제 실행·최종 현재 요약은 선행 Entity/활동/제품 PR의 최종 증거와 부모 실행 인계를 받은 뒤 한 릴리스 PR에 묶는다. 이 준비 기록만 별도 중간 commit/PR로 제출하지 않는다. 지금 체크박스는 실제 배포가 필요한 항목을 완료로 바꾸지 않았다.

### 재개한 준비·현재 요약 draft(운영 실행 전)

2026-10-04 같은 desktop balanced/medium preflight PASS를 메인으로부터 인계받고 release worktree를 main `6b25935`, 이후 Entity merge `24d125180d2af4d57c005c5c129acff33585d031`까지 FF했다. PR #74·75·76·78·77의 GitHub MERGED·merge SHA를 직접 조회했다. 독립 리뷰·CI·통합 성공은 각 PR 링크와 메인 전달 증거를 연결하고 START-HERE·overview·Template-02·Template-10 및 해당 자식의 현재 요약을 draft로 맞췄다. 기존 제출 snapshot·실패·미지원·미접근 범위는 보존했다. 활동·제품 행동 후속 최종 검증과 최종 운영 실행 SHA는 아직 대기다. 기록-only 중간 commit/PR은 만들지 않는다.

현재 코드와 기존 운영 절차를 다시 대조했다. Entity의 `20261003194119_example_entity.sql`은 app.entities·RLS/owner policy·app_user 권한·인덱스와 tasks/records/principles의 nullable entity_id·owner 복합 FK를 추가한다. PostgreSQL 17에서 지원하는 부분 컬럼 `ON DELETE SET NULL(entity_id)`로 원본 owner_id를 유지한다. 초기 원문 backfill·삭제·seed나 기존 migration 수정은 없다. 직전 원격 dry-run 10개 이후 이 1개가 추가돼 최종 실행 시 예상 목록은 11개지만 아직 최신 원격 dry-run을 수행한 것으로 세지 않는다. 최종 인계 후 실제 목록/role/grant/원문·큐 수와 호환성을 다시 조회한다.

Pages는 workflow_dispatch의 명시 ref·main ancestor 검사·공개 PROD 변수만 사용하고 merge 시 자동 배포하지 않는다. worker의 환경 전용 암호/token·서버 Secrets, 승인된 거부/빈 큐 점검, 실제 본인 세션 부재와 Cron 소량 성공 보류 경계는 그대로다. 최소 checkpoint도 app/private만 포함하며 managed backup/복구 가능성 확인으로 확대하지 않는다. remote mutation·Secrets·함수 배포·Pages dispatch·Cron·공유 local 서비스 접근은 이번 재개 준비에서 수행하지 않았다.

### 변경 전 일회성 최소 checkpoint

부모의 직접 승인에 따라 2026-10-04 KST에 변경 전 원본 보존만 수행했다. T02-6 백업 자동화·복원 연습·롤백 재현은 수행하지 않았다. CLI가 출력한 dump 계획을 확인하고 이미 존재하던 `public.ecr.aws/supabase/postgres:17.11.0.002` 이미지의 실제 `pg_dump --version/--help`로 PostgreSQL 17.11의 custom archive·schema 선택을 확인했다. CLI의 분리된 schema-only/data-only 호출 대신 아래 단일 pg_dump로 app/private의 schema와 data를 동일한 일관된 snapshot에 수집했다([PostgreSQL 설명](https://www.postgresql.org/docs/17/app-pgdump.html)).

```text
pg_dump --format=custom --schema=app --schema=private --no-password
```

기존 원격 session pooler 5432·postgres 접속이고 credential은 subprocess 환경으로만 전달했다. `PGSSLMODE=require`, `PGOPTIONS=-c default_transaction_read_only=on`을 설정했다. exporter는 기존 이미지에서 `--pull never --rm --read-only --cap-drop ALL --security-opt no-new-privileges --entrypoint pg_dump`로 실행한 독립 일회성 프로세스이며 포트·볼륨·서비스를 만들거나 공유 local Supabase에 접속하지 않았다. pg_dump exit 0, custom archive header 확인. 원문과 dump 내용은 출력하지 않았다.

저장소 밖 고정 경로 `C:/Users/yongin/AppData/Local/Temp/workspace-release-preflight-20261004/pre-release-app-private.dump.dpapi`를 [Windows DPAPI CurrentUser](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata.protect?view=windowsdesktop-9.0)로 보호했다. 보호 완료 시각 `2026-10-03T20:47:39.2099277Z`(KST 2026-10-04 05:47:39), 원 archive 16,810 bytes·암호화 17,030 bytes. 원 archive SHA-256 `285c92bda13f95f420ef75f875d787544813c4056f6283aa5fd5e6d74d2fa016`, 암호화 SHA-256 `754d760044c2e7e89cc82436c42fc461eecda0f725b0bcb12020c7db51d9e109`. 저장한 ciphertext를 메모리에서만 Unprotect한 결과 byte 수·SHA-256 일치를 확인했다. 원 평문 `pre-release-app-private.dump`는 resolved absolute path가 위 정확한 임시 root 안임을 검사한 뒤 `Remove-Item -LiteralPath`로 제거하고 부재를 확인했다. 평문 memory buffer도 clear했다. 메타데이터는 같은 경로의 `checkpoint-metadata.json`에 있으며 암호화 파일·평문·운영 env는 Git에 넣지 않는다.

포함 범위는 app/private 안의 애플리케이션 schema·테이블 data·함수·제약·RLS/policy·ACL 등 pg_dump가 선택한 객체다. 관리형 `auth`/`storage`, pgmq의 queue/archive, extension 의존 객체, 전역 역할 정의/암호, 플랫폼 Auth/provider 설정·Edge Secrets·함수 source·Pages artifact는 이 dump에 포함하지 않는다. 기존 큐/보관은 직전 읽기 전용 관찰에서 0건이었지만 이 제외를 전체 백업이라고 부르지 않는다. schema 선택 dump는 외부 의존성까지 자동 보존하지 않으며 현재 Windows 사용자 프로필/DPAPI 환경에 결합된다. 암호화 roundtrip은 내용 무결성 근거일 뿐 복원 실행·환경 이전·운영 복구 가능성·managed backup 제공 범위를 입증하지 않는다. 운영 적용 전 최종 revision/대상/상태 재대조는 여전히 필요하다.

읽기 전용 준비 기록의 `npm run check:docs`는 텍스트 281개·모델/native 정합성·script 36통과/실패0/기존 Windows symlink privilege skip1, `git diff --check` 통과. 운영 적용 및 최종 현재 요약 이후 필요한 최종 검사·독립 리뷰·CI·머지는 부모가 조정한다.

재개 draft 검사: `npm run check:docs` 텍스트 307개·모델/native 정합성·script 36통과/실패0/기존 Windows symlink skip1, `git diff --check` 통과. 이 검사로 운영 실행을 완료 처리하지 않는다.

### PR #79·#80 최종 실행 인계 전 준비

main `ff1863d20bd558774dba4312cf3d9cd3c7fd2924`로 FF하고 PR #79 MERGED·SHA를 직접 조회했다. [완료 코멘트](https://github.com/kimyongin/agent-workspace-template/pull/79#issuecomment-5974064551)에 따라 활동 복원·읽기 위치·초점 보강을 완료 요약에 연결했다. 제품 [PR #80](https://github.com/kimyongin/agent-workspace-template/pull/80)은 exact `f70c3e729d31353a40de5e00b1f5b7ab833ae83f` 독립 머지 가능·check SUCCESS를 메인이 인계했고 [integration run](https://github.com/kimyongin/agent-workspace-template/actions/runs/37158709415)은 아직 진행 중으로 직접 조회했다. 최종 MERGED·SHA와 실행 인계 전에는 운영 변경을 시작하지 않는다.

제품 자식 07의 최종 실행 기록을 읽었다. local source `8c94b4b`에서 두 CLI가 시험 MCP Bearer로 실제 업무·단일 결과 저장·독립 재조회와 자기 자료/OAuth/token 정리를 수행했다. Codex native 인증/발견은 앞선 `72d4` source의 별도 성공이고 같은 최신 source의 native LLM 저장로 확대하지 않는다. Claude 정상 계정은 인증 파일 복사 없이 고유 시험 서버로 새 native OAuth/PKCE callback·connected 31·실제 list_tags 1회/오류0/denial0·정상 Clear authentication·exact 시험 DCR 삭제404를 확인했다. 운영 연결 인증·웹/desktop/mobile 업무 또는 prod owner 세션 성공은 아니다. 실제 성공 뒤 helper guard 보강은 오프라인 2검사(6입력)와 journal7만 재검증했으며 서비스/LLM 재실행으로 표시하지 않는다.

메인이 primary API 복구 완료(세션81367/primary bind)를 인계했다. 이 release 담당은 로컬 공유 환경·서비스·개인 인증을 수정하거나 접근하지 않았다. 최종 main ZIP/hash는 운영 서버의 같은 검증 revision 고정 후 생성하고 후보 ZIP을 최종 배포 artifact로 선점하지 않는다. 운영 본인 세션은 여전히 접근 불가이며 새 user/token으로 대체하지 않는다. 소량 색인 성공 없이는 Cron 활성화를 완료하지 않는다.

### PR #80 통합 CI 실패·실행 보류

메인이 [integration run37158709415](https://github.com/kimyongin/agent-workspace-template/actions/runs/37158709415)의 최종 FAIL을 인계했다: 65 PASS·9 SKIP·2 FAIL. 기록의 자동250페이지 복원 mock 경로는 20초 assertion deadline 안에 219행까지 진행했고 desktop/mobile 두 검사가 실패했다. 원인 분석을 완료한 것으로 단정하지 않는다. 활동 담당이 별도 안정성 PR로 조사·수정·필수 검증을 수행하고 제품 PR #80은 이후 rebase·최종 CI 재통과를 확인한다. 기존 PR #79의 당시 성공·머지는 보존하되 현재 최종 배포 후보의 CI 실패를 숨기지 않는다. 최종 검증 merged revision 인계는 아직 없으며 운영 mutation·Secrets·deploy·Pages·Cron을 시작하지 않는다.

### 활동 안정성 PR #81 검증 인계

메인이 exact `6b8d6234b10e620b3d233140fae83a90bdfeb7dd`의 독립 리뷰 머지 가능과 [PR #81](https://github.com/kimyongin/agent-workspace-template/pull/81)·[최종 리뷰](https://github.com/kimyongin/agent-workspace-template/pull/81#issuecomment-5974325158)·[CI run37159805324](https://github.com/kimyongin/agent-workspace-template/actions/runs/37159805324) 시작을 인계했다. 실패 trace는 20초 동안 desktop0..212/mobile0..220의 순차 HTTP200 응답 뒤 teardown abort로 검사 deadline에 도달함을 확인했다. 서비스 응답 실패나 복원 기능 성공으로 각각 오인하지 않는다. 수정은 tests60초 전체 budget과 25페이지마다10초 bounded progress/정확한 순서 검사이며 최종250개/count/cursors·수동251·위치/초점 계약을 유지한다. 로컬4 PASS·100ms delay57.8초 PASS와 stall/order/duplicate 각각 의도한 거부를 인계받았다. 이 기록은 전달된 trace/검증 근거이며 release 담당의 직접 재실행이 아니다. PR #81 최종 CI·머지와 제품 PR #80 rebase·최종 CI 성공·merged SHA 인계는 아직 대기다. 운영 변경은 시작하지 않는다.

### PR #81 머지·제품 최종 CI 대기

release 담당이 GitHub MERGED·SHA를 직접 확인하고 main `2a55e1397a427388cb0d47671cf0236bb1ab36a6`으로 FF했다. 활동 child04의 release draft가 선행 PR과 겹쳐 FF가 막혔고 해당 자기 draft만 정확한 외부 파일에 보존한 뒤 main 변경·기존 release 완료 문구를 함께 유지했다. PR #81은 2026-10-03T23:02:58Z 머지, [완료5974412125](https://github.com/kimyongin/agent-workspace-template/pull/81#issuecomment-5974412125), [CI37159805324](https://github.com/kimyongin/agent-workspace-template/actions/runs/37159805324) check30초/integration11분44초 SUCCESS/CLEAN·exact6b8 리뷰를 메인이 인계했다. PR #80 rebase exact `18b7eff0f8199996767585a04109216eb3208738`/base2a55는 [리뷰5974421539](https://github.com/kimyongin/agent-workspace-template/pull/80#issuecomment-5974421539) 머지 가능·전체 patch SHA 동일(5범위)을 메인이 직접 확인했고 [new CI37160563892](https://github.com/kimyongin/agent-workspace-template/actions/runs/37160563892)는 진행 중으로 조회했다. 최종 머지 SHA·실행 인계 대기다.

실행 전 pending migration11·원문/큐 수·role/grant·export/checkpoint 대조를 재확인한다. 빈 큐 점검은 explicit limit1 한 번만 실행하며 backlog가 있으면 소비하지 않는다. 정상 prod 본인 세션이 없으면 최소 업무/색인 성공 미증명·Cron 보류를 유지한다. 사전 독립 계획 리뷰에서 차단 결함 없음은 실행 성공이나 최종 운영 준비 완료를 의미하지 않는다.

메인은 최종 Pages run37161621033 completed/success·headSHA1730dc와 deployment6834375397 sha일치를 직접 재조회했다. 별도 public GET4(루트200/API tasks401/MCP401/정확metadata200)도 직접 확인했으며 운영 쓰기·인증token·worker 호출은 없었다. release 담당의 직접 실행과 별도 메인 재확인을 구분한다.

최종 기록 검사: `npm run check:docs`는 텍스트327개·모델/native 정합성·script36 PASS/0 FAIL/기존 Windows symlink권한1 SKIP, `git diff --check` 통과. 운영 실행은 검증 source1730dc이며 이 문서-only 기록 commit의 독립 리뷰·CI·머지는 메인에게 인계한다. 새 자동검사·앱 구현·모델 선택표 변경은 없다.
