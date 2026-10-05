# Template-12 — 본인 운영 기록 색인과 Cron 소비 확인

> 이전 기록이다. 현재 작업과 완료 근거는 [GitHub 이관 대응표](migration-to-github.md)에서 확인한다.

작성: 2026-10-04
상태: 본인 기록 생성·수정 scoped 색인과 매분 Cron 소비 확인 완료(기록 PR 리뷰·CI·머지 전)
검토 기준: main `fa8b706fbc461117e9c42a0ced35c5c274a53b12`; 운영 함수 source는 `1730dc983eb10e282e28f3a200ffbd265978480e`
선행: [Template-10-06](template-10-06-existing-release.md)의 기존 운영 배포·fresh worker 자격

## 승인과 소유

사용자가 남은 1~4번을 모두 진행하도록 승인했다는 메인 배정을 받았다. 담당 `evaluate_models`는 release-existing worktree의 `codex/production-search-check`에서 운영 worker의 제한 호출·Cron/Vault 설정·검증과 이 티켓·Template-10-06·필요 운영 가이드만 소유한다. START-HERE·Template-11·모델 선택표는 다른 담당이며 편집하지 않는다. balanced `gpt-6.1-sol`/medium 동일 배정과 당일 preflight PASS는 메인 인계다. backend effort·실제 세션 청구액은 미노출이며 모델 평가를 수행하지 않는다.

기존 Supabase `ayzcluvdppsppwszzaqx`와 Pages만 대상이다. 메인이 실제 본인 Google OAuth/UI로 운영 점검 기록 한 건을 저장하고 version1·owner를 DB로 대조했다. 전달받은 exact owner/record ID로 `kind=record, limit=1` 한 번만 호출하며 실패하면 외부 호출을 자동 반복하지 않는다. 원문/벡터 값·키/token을 출력하지 않고 자료를 삭제하지 않는다. 새 user/admin JWT·운영 자동 CRUD 시험·reset/seed·로컬 서비스 변경·T02-5/6은 수행하지 않는다.

## 작업과 완료 조건

- [x] 공식 Supabase changelog·Cron 설치·pg_net·Vault 문서와 실제 CLI help를 확인한다.
- [x] 본인 UI가 저장한 기록의 pending/hash 일치·원본 version을 읽고 한정 worker 성공·현재 벡터를 대조한다.
- [x] 본인 웹 수정 뒤 전달받은 상태·정상 원문 해시와 재색인을 확인한다.
- [x] 소량 성공/호출 경계 확인 후 이름을 고정한 Vault 두 항목·중복 없는 매분 limit5 Cron을 설정한다.
- [x] 실제 한 주기의 cron 결과와 pg_net HTTP200/worker 결과·큐/current state를 각각 확인한다.
- [x] 비용 관측 한계·남은 사용자/클라이언트 검증과 실제 적용 증거를 기록해 메인에게 인계한다(독립 리뷰·CI·머지는 후속).

## 실행 기록

시작 checkout은 clean이었다. 이전 release commit과 squash-merge main이 달라 FF가 거부됐으며 이전 branch/commit을 보존하고 새 요청 branch를 origin/main `fa8b706`에서 시작했다. 서비스나 tracked 사용자 변경은 없었다. develop-agent-app·Supabase 전문 스킬·보안·운영 가이드와 기존 릴리스 기록을 읽었다. CLI2.119.0 `db query --help`의 명시 project ref·file 경로를 확인했고 버전/전역 설정을 바꾸지 않았다.

[changelog](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)·[Cron 설치](https://supabase.com/docs/guides/cron/install)·[함수 일정](https://supabase.com/docs/guides/functions/schedule-functions)·[pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)·[Vault](https://supabase.com/docs/guides/database/vault)를 직접 조회했다. 현재 Vault0.3.1/vector0.8.2 존재, pg_cron1.6.4/pg_net0.20.4 available지만 미설치·두 search_worker Vault 이름 없음으로 확인했다. 복수 SQL 결과 중 마지막만 반환되는 connector 제약 때문에 관측을 단일 jsonb 결과로 묶는다.

초기 읽기 SQL이 `status/source_id/pipeline_version`을 가정해 column error가 났다. 정본 migration의 실제 `state/id/pipeline`으로 정정했으며 변경/worker 호출은 없었다. 처음부터 worker 실행 성공으로 간주하지 않는다.

### 최초 본인 기록의 한정 색인

실제 저장/계정 UI는 메인 실행이고 아래 worker·DB 관찰은 이 담당 직접 실행이다. 본인 기록 version1, owner 일치·state pending·현재 title+summary hash 일치·embedding 없음·queue1/archive0을 확인했다. `2026-10-04T00:41:39.444Z` scoped `owner_id/kind=record/id/limit1` 한 회는 HTTP200·1026ms·claimed1/indexed1·excluded/failed/retry/stale0이다. DPAPI의 기존 prod token은 메모리에서만 해독했고 값·원본 내용은 증거에 넣지 않았다.

독립 재조회에서 state indexed·reason null·1024차원 embedding 존재·현재 원본 해시 일치·message_id 해제·queue/archive0을 확인했다. 해시 `26e0ddc35740b22e8c56ee02b375a4aaea7b866599c494f4b46674ef78e71d98`, pipeline `llama-v2-1024-title-summary-v1`이다. 제목/요약 한 개만 passage로 보내는 배포 adapter는 숨은 재시도 없이 Pinecone `llama-text-embed-v2`/1024/`truncate=NONE`를 사용한다. worker 결과는 공급자 usage/달러를 반환하지 않고 adapter도 vector만 노출하므로 실제 token/usage/청구액은 확인할 수 없다. 성공 한 건·1024 벡터·bounded 대상 확인을 비용 비교나 실제 과금 증명으로 확대하지 않는다.

비밀 없는 시각/limit/result는 저장소 밖 `TEMP/workspace-release-preflight-20261004/production-record-worker-round1-result.json`에 있다. exact scope/한 회 guard는 동일 경로에 보존하며 자동 재실행하지 않는다. 정상 운영 점검 기록은 그대로 보존한다.

### 같은 본인 기록 수정·재색인

메인은 첫 검색에서 substring이 아닌 의미 질의로 해당 기록의 ‘의미·색인 완료’와 원문 연결 성공을 직접 관측했다. 이후 같은 기록을 본인 UI로 수정했다. 이 담당은 version2·hash 변경/현재 원본 일치·state pending·scoped queue1을 읽었다. 이전 embedding은 남아 있었지만 pending 상태를 최신 완료로 세지 않았다. 같은 owner/record scope의 두 번째 한 회 호출 `2026-10-04T00:44:32.352Z`는 HTTP200·1119ms·claimed1/indexed1·나머지0이다. 사후 state indexed·reason null·hash `975cea60c4ae05c4de9f8be5af2bf339416333a8abf97c2bdfbc32e7a64c554a` 현재 일치·1024차원·message 해제·queue/archive0을 대조했다. 원본·본문은 출력하거나 삭제하지 않았다. 최초 저장·수정은 메인 정상 계정 UI, worker/DB 확인은 이 담당 직접 실행으로 구분한다. 두 scoped 성공 외 외부 임베딩/가격 조회 호출은 하지 않았다. 각 round guard/result는 위 외부 경로에 별도로 남긴다.

활성화 전 계획 당시에는 기존 Vault 두 이름·job 이름이 있으면 덮어쓰지 않고 먼저 확인하며 최초 설정을 transaction으로 묶도록 했다. `pg_cron`/`pg_net`의 실제 지원 버전·signature를 설치 후 다시 확인하고 job은 token literal 없이 Vault 참조·매분 `limit5`·timeout45초만 저장하도록 했다. 정상 주기는 cron SQL 성공과 pg_net HTTP/worker 성공을 각각 관찰하며 HTTP 요청이 transaction commit 뒤 시작되고 응답 보관은 기본6시간/unlogged임을 공식 문서와 구분했다. 당시 메인의 두 번째 의미 검색 확인·Cron 실행 인계를 기다렸으며 실제 활성화 결과는 다음 절에 기록한다.

### 매분 소비 활성화와 실제 주기

메인은 version2 이후 두 번째 의미 질의에서도 해당 기록의 최신 요약·‘의미/색인 완료’를 확인하고 Cron 실행을 명시 인계했다. 이 담당은 `2026-10-04T00:46:59.996Z`에 원격 transaction으로 pg_cron/pg_net 설치·Vault 이름 guard·두 secret 생성·job을 설정했다. 이전 named secret/job이 있으면 덮어쓰지 않고 중단하도록 검사했고 실제로 각각 없었다. 원본 자료와 기존 역할/password는 변경하지 않았다. 기존 prod worker token만 DPAPI에서 메모리 해독해 Vault로 전달했고 키/token·URLcredential·큐 Authorization header는 출력/조회하지 않았다.

설치 실제 버전은 pg_cron1.6.4/pg_net0.20.4, 함수 signature는 `net.http_post(text,jsonb,jsonb,jsonb,integer)`와 named `cron.schedule(text,text,text)`다. job1 `search-index-worker` 한 개·active true·schedule `* * * * *`·postgres 실행·Vault URL/token 참조·body limit5/timeout45000을 boolean·count로 대조했다. Vault search_worker_url/search_worker_token 각각 한 개다. 새 서비스/계정·provider 유료 플랜·Auth 설정·migration/앱 코드는 바꾸지 않았다.

첫 실제 cron run1은 `2026-10-04T00:47:00.072351Z`~`.082775Z`/status succeeded/return_message ‘1 row’다. 이는 SQL의 비동기 전송 등록 성공이다. 별도 pg_net response1은 HTTP200/timed_out false/error null, claimed/indexed/excluded/failed/retry/stale 모두0이며 queue/archive0을 확인했다. 이어00:48·00:49 실제 주기도 cron succeeded/HTTP200·0결과였다. 직접 worker를 추가 호출하지 않았다. Cron 활성화/인증/전송 성공과 빈 큐 결과를 실제 추가 색인 성공으로 바꾸지 않는다. scoped 두 번의 indexed1과 current version2/hash/vector1024가 그 소량 성공 근거다. 활성 schedule은 그대로 유지하며 기록 한 건도 보존한다.

### pg_net 기본 ACL·브라우저 경계

신규 pg_net의 net.http_request_queue owner는 supabase_admin, PUBLIC ALL·net USAGE 때문에 anon/authenticated/app_user/app_server/app_worker의 queue SELECT가 true다. Vault decrypted view는 이 다섯 역할 모두 SELECT false다. 큐에는 요청 header가 일시 저장될 수 있으므로 ACL 결과만으로 공개 노출을 확정하거나 정상 동작을 안전하다고 추정하지 않았다. 실제 header/token은 조회하지 않았다.

이 담당은 공개 publishable key를 메모리에서 읽고 `Accept-Profile: net`의 `/rest/v1/http_request_queue?select=id&limit=1`만 호출했다. `2026-10-04T00:50:08.685Z` HTTP406/PGRST106 ‘Invalid schema: net’으로 공개 Data API 경계가 거부했다. PostgREST exposed-schema role setting은 DB 조회에서 null이므로 전체 목록을 추정하지 않는다. anon/authenticated/app_user는 DB LOGIN false이고 앱 HTTP/MCP·worker는 검증 source의 고정 SQL만 사용한다. 이 검사 범위는 공개 schema 거부이며 모든 플랫폼/SQL 접근 경로를 감사했다는 뜻은 아니다.

postgres는 이 큐 SELECT GRANT OPTION false·supabase_admin MEMBER false이고 실제 http_post도 SECURITY DEFINER false다. 지원되지 않는 owner 변경·ACL revoke/grant·권한 우회를 수행하지 않았다. 메인이 공개 노출이 있으면 job을 즉시 중지하되 현재 거부 경계와 고정 SQL만 확인되면 플랫폼 기본 ACL 한계를 기록하도록 인계했다. 현재 net 공개 경계가 거부해 job을 유지한다. 원격 Data API schema/함수·서버 역할/배포가 바뀔 때 이 경계를 다시 확인하며 net을 공개로 노출하지 않는다.

### 사용자 접점 보고와 남은 확인

메인은 실제 IAB Google OAuth 로그인·본인 기록 생성/수정·두 번의 의미 검색 최신성·원문 왕복을 직접 확인했다. 별도 Codex CLI native OAuth/새 credential·OAuth status와 공식 SDK 31tools discovery/get_record ID일치·structured 성공(`00:45:48Z`, 외부 `TEMP/workspace-prod-oauth-20261004/read-evidence.json`)도 메인 직접 결과로 인계했다. 첫 no-browser/noTTY stdinclosed 실패 후 TTY 성공, stale 승인 UI의 reload 뒤 expired 표시와 별도 CLI/authenticated read 성공을 구분하며 불필요 재로그인 한 번은 취소하고 이전 credential을 보존했다. 이 담당이 클라이언트 인증을 직접 수행한 것으로 기록하지 않는다.

메인은 Claude 웹에서 제품0.1.1 ZIP(SHA `78974e53e41615a85943037a91db04c30c766a2b6e353e8d992ef71013fa60e3`) 업로드·1skill/1connector 활성화·실사용자 OAuth 승인 후 실제 읽기 성공을 인계했다. 캡차는 사용자가 직접 해결했고 UI 모델은 Opus5.5/중간이었다. [실제 chat](https://claude.ai/chat/0bdc3661-9eaf-494b-988d-a028f27a3867)에서 `workspace: Search`와 `workspace: Get record` 사용, 키워드 검색 일치1건·같은 기록 원문 읽기·현재 version2/indexed/최신 요약 일치를 확인했다. 메인은 승인된 조회 범위에서 keyword/statusall 검색과 exact ID 읽기 도구를 각각 한 번 허용했으며 저장은 수행하지 않았다. 외부 `TEMP/workspace-claude-read-success.png`에 증거를 보존했다. 연결 권한 유지도 사용자가 명시 허용했다. skill 연결 표시는 관측했지만 SKILL.md 실제 읽기는 노출되지 않아 전체 제품 스킬 준수 평가로 확대하지 않는다.

메인은 `00:54:10Z` Codex CLI native appserver `mcpServerStatus/list`에서 workspace authStatus oAuth·toolCount31을 추가 확인했다. 외부 `TEMP/workspace-prod-oauth-20261004/native-inventory-evidence.json`과 앞선 독립 SDK 읽기 증거를 구분한다. 검증 전용 isolated home credential은 CurrentUser DPAPI 메모리 roundtrip PASS 후 `.credentials.json.dpapi`2134bytes로 보존하고 해당 평문 파일만 제거했다고 인계했다. token값을 증거/출력에 포함하지 않았고 전역 Codex 설정 변경 없음이며 사용자 정상 로그인과 Claude 연결은 보존했다. 이는 Codex desktop UI 검증이 아니다.

CSS viewport319/scrollWidth304의 모바일 크기 검색·원문 접근 관찰과 screenshot은 메인 보고이며 실제 휴대폰·스크린리더·Codex desktop 제품 UI 검증은 아니다. 최초에는 휴대폰·스크린리더를 남은 수동 검증으로 기록했다. 이후 2026-10-04 사용자 지시에 따라 실제 휴대폰 확인은 사용자에게 이관하고 에이전트 작업 목록에서 제거했으며, 스크린리더 검증은 이번 요청 범위에서 제외했다. 두 항목을 검증 성공으로 처리하지 않는다. 남은 클라이언트 검증은 Codex desktop 제품 UI다. START-HERE·Template-11·모델 선택표는 이 담당이 편집하지 않는다.

호출/usage 제한: 수동 scoped worker는 같은 본인 기록 생성/수정 각각 한 번, 총 두 번이다. 숨은 재시도 없이 title+summary 한 passage/vector1024 처리 성공을 관찰했다. 실제 공급자 token usage·달러 청구액은 배포 응답에 미노출이고 콘솔/청구 내역을 조회하지 않아 미확인이다. 매분 limit5는 최대batch 경계이며 자동 실패 재시도/외부 호출·실제 소비량은 운영 가이드로 관찰한다. 최초 운영의 빈 큐 점검·보류를 보존하면서 현재 Cron 활성화 근거로 연결한다. 백업/복구·T02-5/6 제외 범위는 변하지 않는다.

메인은 별도 SQL로 active 매분 job·최근3개 Cron SQL succeeded·원본 version2·state indexed·1024벡터를 직접 재확인해 PASS를 인계했다. current hash 일치는 이 담당의 scoped 사후 대조 근거이며 메인 추가 재조회와 구분한다. 최종 Claude 웹 읽기 결과까지 인계받았다. Codex desktop UI와 실제 공급자 청구액은 미확인이며 휴대폰·스크린리더는 위 사용자 지시에 따라 에이전트의 남은 작업에서 제외한다. 이 기록은 [PR #84](https://github.com/kimyongin/agent-workspace-template/pull/84)에서 독립 리뷰·필수 CI를 통과해 `90708ff287a82d46cdf1bfe3f6c9289f49733863`으로 머지됐다.

검사: `npm run check:docs` 텍스트330개·모델/native 정합성·script39 PASS/0 FAIL/기존 Windows file-symlink권한1 SKIP, `git diff --check` 통과. 앱·migration·모델 선택표·START-HERE·Template-11·로컬 서비스는 편집/변경하지 않았다. 기록 commit을 메인 독립 리뷰·PR/CI·머지로 넘기며 이 티켓 작성 시 그 후속 절차는 완료 전이다.
