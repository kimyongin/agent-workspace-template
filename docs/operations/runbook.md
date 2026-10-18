# 운영 방법

## 목적과 운영 준비

배포한 앱의 상태를 확인하고 장애·데이터 복구·반복 작업을 처리하는 기준이다. 최초 설치와 버전 변경은 [배포 방법](../deployment/release.md)을 따른다.

운영 환경과 모니터링의 적용 상태는 해당 GitHub issue·PR의 환경별 증거에서 확인한다. 실제 조회 위치·담당자·점검 주기·알림 경로는 운영 환경에 맞춰 정한다. 초기에는 플랫폼 로그와 제한된 관리 절차로 시작한다.

## 상태 확인

| 영역 | 관찰할 신호 | 이상 시 먼저 확인할 것 |
| --- | --- | --- |
| HTTP/MCP | 실패율, 응답 지연, 최근 성공 요청 | 배포 revision, 함수 로그, DB 연결 |
| GitHub Pages | workflow 실패, 자산/상세 URL 오류, 오래된 화면 | 배포 artifact와 revision, base 경로·라우팅·캐시 |
| Google 로그인 | 동의 화면·callback 오류, 웹 복귀 실패 | Google client/provider 설정, 게시 상태와 허용 redirect |
| Pinecone Inference | 인증 실패·429·timeout·사용량 | API 키·모델·API 버전·한도, 제한 재시도와 키워드 fallback |
| 인증·권한 | 로그인/OAuth 실패 증가, 예상 밖 접근 거부·허용 | URL·토큰 검증 설정, 역할/RLS 변경 |
| DB | 연결·저장 공간·느린 쿼리·잠금·저장 실패 | 최근 migration, 연결 사용량과 긴 트랜잭션 |
| 비동기 작업 | 대기량, 가장 오래된 작업의 나이, 재시도·영구 실패, 마지막 성공 | Cron 실행, worker 인증·로그, 외부 공급자 상태 |
| 검색 | 색인 지연·실패, 검색 오류, 관련/무관 질문 품질 | 원본과 색인 버전, 모델·공급자 설정, fallback |
| 비용·한도 | 함수·DB·전송량·외부 API 사용량 | 재시도 폭증, 중복 호출, 배치 크기 |
| 백업 | 마지막 성공 시각, 보존 범위, 복원 연습 결과 | 실제 요금제 기능, 백업 누락과 만료 |

각 서비스의 허용 지연·오류율·큐 최대 대기시간·비용 한도는 실제 사용량과 사용자 기대에 맞춰 정한다. 값이 미정인 동안 운영 준비가 끝났다고 표시하지 않는다. 초기 일일 수동 점검과 배포 직후 점검을 시작점으로 삼고, 대응이 필요한 지연·실패·비용에는 알림을 연결한다.

요청/작업 ID, 유스케이스, 실행 시간, 결과 코드, 재시도 횟수, 배포 revision으로 HTTP/MCP와 worker의 실패를 추적할 수 있게 한다. 로그에 토큰·비밀값·기록 본문을 남기지 않는다. 로그 보존 기간과 접근 권한도 운영 설정으로 정한다.

## 요청 성공 재현과 원장 보존

HTTP 업무 쓰기는 UUID `Idempotency-Key`, MCP는 필수 UUID `request_key`를 사용한다. 같은 실행자·공간 범위·키·정확한 입력에는 당시 성공 결과·버전을 재현하며 현재 인증·공간 소속·현재 권한을 매번 확인한다. 공간 생성·초대 수락은 별도 계정 범위에서 정확한 결과 공간을 결속한다. 재현 횟수, `idempotency_key_reused`·`request_in_progress`·`result_expired` 수와 잠금 대기를 revision별로 관찰한다. 키와 작업 종류·결과 코드만으로 조사하고 본문·메모·토큰은 로그에 추가하지 않는다.

응답 유실·5xx·커밋 불명에는 같은 키·대상·입력·expected_version을 유지한다. `request_in_progress`는 1초 뒤 같은 요청만 재시도한다. 키 또는 메모리의 정확한 입력을 잃었으면 현재 자료를 조회해 다음 의도를 확인한다. 다른 입력의 키 재사용과 만료 오류는 새 키 자동 반복으로 해결하지 않는다. 오래된 성공 재현으로 삭제된 자료를 복원하지 않는다.

성공 결과는 최대 1 MiB(1,048,576 bytes)의 JSON으로 완료 시점부터 30일간 보관한다. 이 한도는 업무 설정 입력의 별도 128 KiB 한도와 다르다. 최대 길이 본문과 할 일의 자료 연결 등 현재 생성/완료 응답을 수용한다. 크기가 무제한인 과거 중단 이력까지 모두 들어간다고 보장하지 않는다. 한도를 넘으면 안전한 `invalid_input`과 변경 미저장 안내로 업무·기록·큐·요청 원장을 전부 롤백한다. 원문/이력을 절단하거나 일부만 저장하지 않으며 원인과 영향 대상을 확인해 별도 보존 가능한 계약 전환을 검토한다. 완료 30일 이후에도 정리 지연으로 만료 행이 남아 있으면 같은 입력의 재시도는 410 `result_expired`를 반환한다. 행이 삭제된 뒤에는 같은 키가 신규 요청으로 실행될 수 있으므로 현재 업무 상태를 확인하고 자동 재전송하지 않는다. migration이 등록하는 `expire-request-results` Cron은 매일 03:17 DB 시간에 private cleanup을 실행해 만료된 행 전체를 삭제한다. 관리 권한으로 job 성공·미정리 만료 행 수·저장량을 확인하되 본문을 출력하지 않는다. 지연 복구에는 기존 `private.expire_request_results()`만 사용하며 공개 RPC나 사용자 원장 CRUD를 추가하지 않는다.

요청 키·operation·revision·fingerprint·성공 결과는 완료 시점부터 30일간 함께 보관한다. 계정당 평생 요청 횟수 제한은 없다. 30일 후에는 중복 방지가 보장되지 않으며 정리 후 동일 키가 신규 요청으로 실행될 수 있다. 만료·응답 불명에는 현재 업무 상태를 확인하고 새 키로 자동 재전송하지 않는다. 계정 삭제는 해당 실행자의 세션·권한을 회수하고 잔여 토큰을 거절한다. 실행자에 귀속된 요청 결과는 계정 FK에 따라 제거되지만, 공동 공간의 업무 자료·작성자 표시·검색 벡터·외부 효과와 작업 이력은 계정 삭제만으로 제거하지 않는다. 공간 범위의 요청 결과와 계정 범위의 공간 생성/초대 수락 결과를 구분해 보존·만료를 판단한다. 기존 업무 자료·참조·설정·과거 migration은 요청 정리 대상이 아니다. 서버 ID는 받는 테이블의 PK로 보호하며 별도 발급 원장은 보관하지 않는다([ADR-0019](../adr/0019-pk-based-data-id-generation.md)). 자동 ID 충돌이 64회 소진되면 업무 전체가 롤백되고 `unavailable`을 반환한다. 같은 요청 키로 재시도하며 명시 외부 식별자나 업무 unique 충돌을 ID 재발급으로 숨기지 않는다.

## 비동기 작업 장애

1. 큐 지연이 등록량 증가인지 소비 중단인지 구분한다. 가장 오래된 메시지와 마지막 성공 처리 시각을 확인한다.
2. Cron→worker 호출, 인증, DB 연결, 외부 공급자의 실패·할당량 순서로 원인을 좁힌다. 적체만 보고 worker 수를 무작정 늘리지 않는다.
3. 일시 실패는 정해진 횟수와 간격으로 재시도한다. 반복 실패는 원인과 작업 식별자를 보존하고 확인 가능한 보류/실패 경로로 보낸다. 구체적 저장·조회 방식은 해당 작업에서 구현한다.
4. 원인을 수정한 뒤 원본 존재·권한·버전과 외부 부수효과를 확인하고 소량부터 재처리한다. 재처리에도 기존 멱등성 계약을 적용한다.
5. 적체가 줄고 실제 결과가 반영되는지 확인한다. 메시지 삭제나 큐 비우기를 업무 성공으로 처리하지 않는다.

worker 소비를 멈춰도 생산이 계속되면 대기량이 늘어난다. 장애 시 생산도 제한할지, 업무 접수는 유지할지 사용자 영향과 저장 여유에 따라 결정한다. 실행 중인 작업의 종료·재전달까지 확인해야 중지 완료다.

## 검색 운영과 재색인

[기록 본문 검색](../architecture/search.md)의 계약을 따른다. 진행률은 구간 수와 기록 수를 구분해 관리하고 대기·성공·실패·제외를 구분한다. 긴 기록은 손실 없이 구간별로 처리하며 본문 변경 시 새 해시·색인 세대로 재색인한다. 최신 할 일은 임베딩 작업 대상이 아니다.

원본 저장 성공과 검색 반영 성공을 따로 점검한다. 의미 검색 장애 시 계약된 키워드 대체 경로와 상태 표시를 확인한다. 검색 품질은 대표 관련 질문과 무관 질문의 작은 평가 세트를 유지해 모델·입력 변경 시 비교한다.

재색인은 대상 범위·원본 수·모델/입력 버전·예상 비용을 확인한 뒤 제한된 배치로 시작한다. 오래된 작업이 최신 결과를 덮거나 삭제된 원본을 복구하지 않아야 한다. 진행·실패 수와 완료 후 검색 품질을 확인한다. 모델이나 차원이 바뀌면 구 색인 유지·새 색인 전환·복귀 방식을 해당 변경 티켓에서 정하며, 사용 중인 색인을 무조건 먼저 지우지 않는다.

## 공통 처리 함수 호출 토큰

검색·스키마 처리 함수는 공통 호출 토큰 하나만 사용한다. 서버 설정 키 `PROCESSING_TOKEN`과 Vault 항목 `processing_token`은 두 처리 함수의 공통 설정이다. 종류별 전용 토큰·우선순위·fallback은 지원하지 않는다. 토큰은 최소 32byte 무작위 base64url 값이며 사용자 JWT·DB 접속 자격 증명과 구분한다. 공통 토큰 교체 시 두 함수와 두 Cron 호출을 함께 전환·검증한다. `setup:local`은 같은 값을 로컬 호출자와 함수 환경에 저장하고, 기존 토큰 값을 유지해 `PROCESSING_TOKEN`으로 전환하고 구 선언을 제거하며 다른 사용자 설정은 보존한다.

### 공통 처리 토큰 설정 이름 전환

#375의 이름 전환은 토큰 교체가 아니다. `INDEX_WORKER_TOKEN` → `PROCESSING_TOKEN`, Vault의 `search_worker_token` → `processing_token`으로 같은 값을 옮긴다. 함수에는 구 이름 alias나 fallback을 두지 않는다. 적용된 migration은 재작성하지 않으며 Cron과 Vault는 해당 운영 환경의 설정으로 전환한다.

1. 두 Cron의 ID·일정·활성 상태와 함수 버전, 기존 Secrets의 digest를 기록한다. 값과 Cron command 전문은 출력하지 않는다. 같은 이름의 신규 설정이 있다면 동일 값인지 확인하고 서로 다르면 중단한다.
2. 기존 Vault 값을 관리 도구 프로세스 안에서 읽고 digest가 기존 Edge Secret과 같은지 확인한다. 모드 0600의 개인 임시 env 파일로 `PROCESSING_TOKEN`만 `supabase secrets set --env-file`에 전달하고 즉시 파일을 삭제한다. 기존 Secret은 복구용으로 유지한다. 값이 CLI 인자·로그·이슈에 나오지 않게 한다.
3. 검증한 revision의 두 처리 함수를 배포한다. 같은 토큰으로 두 함수의 `check_configuration`이 200인지, 무인증·잘못된 토큰·사용자 JWT가 401인지 확인한다. 실패하면 기존 Secret을 유지한 채 이전 함수 revision으로 복구한다.
4. DB 트랜잭션 안에서 기존 Vault 값과 같은 `processing_token`을 만들고, 확인한 두 Cron command에서 Vault 항목 이름만 바꾼다. job ID·URL·body·일정·활성 상태는 유지한다. 전환 전 기존 항목이 정확히 하나인지 확인하고 새 항목이 있으면 값 일치를 검사한다.
5. 두 Cron의 실제 pg_net HTTP 응답과 정상 실행을 확인한다. 실패하면 command의 Vault 이름을 되돌리고 이전 함수 revision으로 복구한다. 기존 Vault/Secret이 남아 있어 토큰을 재발급할 필요가 없다.
6. 확인 뒤 구 Edge Secret과 구 Vault 항목을 제거한다. 복구가 필요하면 `processing_token` 값으로 구 Secret/Vault 이름을 재구성한 뒤 이전 함수·Cron으로 되돌린다. 원본 토큰은 출력하거나 새 값으로 교체하지 않는다.

로컬 `setup:local`은 구 이름을 신규 이름으로 한 번 전환하고 기존 값을 보존한다. 두 파일의 신규/구 토큰 값이 서로 다르면 파일 저장과 서비스 시작 전에 중단한다. 전환한 함수 환경은 해당 실행 소유자가 재시작해야 반영되며 이전 revision의 실행이 공유하는 파일을 임의로 변경하지 않는다.

## 엔터티 스키마 worker 호출과 운영 인계

`POST /functions/v1/entity-schema-worker`는 내부 `Authorization: Bearer <token>`을 요구하며 사용자 JWT는 받지 않는다. 공통 `PROCESSING_TOKEN`만 사용하며 누락·빈 값·짧은 설정은 503으로 거부한다. 토큰은 최소 32byte 무작위 base64url 값이며 서버 Secrets/Vault와 개인 로컬 환경에만 둔다. 함수 gateway의 `verify_jwt=false`는 이 내부 인증을 함수 안에서 반드시 검사하는 계약과 함께 사용한다. 누락/잘못된 토큰은 DB 접근 전에 401로 거부한다. `WORKER_DB_URL`은 제한된 app_worker 트랜잭션 풀러 역할이며 일반 사용자/서버 DB 역할로 대체하지 않는다. 검색/Pinecone 설정과 독립적이다.

인증된 `{ "check_configuration": true }`는 구성만 확인하며 작업을 claim하지 않는다. 정상 소비 본문은 `{ "limit": 1 }`이다. 반환/관찰은 bounded 개수·상태로 제한하고 분석 source·stage·복구 원문·토큰을 로그에 남기지 않는다. 로컬 소비 명령과 취소·시간 제한은 [실행 환경](../development/verification.md#엔터티-스키마의-로컬-소비-실행)을 따른다. 브라우저가 닫혀도 DB에 접수된 작업은 실행 중인 consumer가 처리한다. 실행기를 끄면 작업은 영속 상태로 남으며 HTTP timeout만으로 실패·취소를 단정하지 않는다. lease/fence에 따른 재개 후 소유자 API의 분석/작업 상태를 확인한다.

운영 적용은 코드 머지와 구분되는 별도 배포 지시에서 수행한다. 아래 SQL은 인계 예시이며 저장소 migration·로컬 setup에서 실행하지 않는다. 해당 환경의 schema worker RPC/권한 migration과 함수를 배포하고, 공통 호출 토큰과 WORKER_DB_URL을 준비한 뒤 다음 순서로 확인한다.

1. 토큰 없음·잘못된 토큰·사용자 JWT의 401과 올바른 내부 토큰의 구성 확인 응답을 검증한다. 확인 응답은 claim 성공 증거가 아니다.
2. 본인 시험 타입의 제한 분석을 접수하고 단일 consumer 호출 뒤 소유자 API에서 실제 분석 완료와 결과를 확인한다. 마이그레이션 기능을 배포한 revision에서는 제한 실행·원자적 완료·복구 preview도 확인한다. HTTP 200/빈 큐만으로 처리 성공을 주장하지 않는다.
3. pg_cron·pg_net을 활성화하고 Vault에 `entity_schema_worker_url`(해당 환경의 **고정 HTTPS 함수 전체 주소**)을 준비하고 두 함수의 호출에는 공통 `processing_token`을 참조한다. 종류별 토큰 항목을 만들거나 비밀값을 출력·복사하지 않는다. 같은 이름의 job/Vault 항목이 있으면 값을 출력하거나 덮어쓰지 않고 기존 소유·설정을 먼저 확인한다. URL을 사용자 입력/작업 자료에서 만들지 않는다. 기존 토큰은 교체 적용/검증이 끝나기 전 폐기하지 않는다.
4. 위 확인 뒤 승인된 환경에서만 매분 limit1 호출을 등록한다. [Supabase 공식 일정 방식](https://supabase.com/docs/guides/functions/schedule-functions)을 따르되 이 함수에는 위에서 선택한 내부 Bearer를 사용한다.

두 처리 함수의 Cron은 같은 Vault 토큰을 참조한다.

```sql
select cron.schedule('entity-schema-worker', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='entity_schema_worker_url'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='processing_token')),
    body := '{"limit":1}'::jsonb,
    timeout_milliseconds := 30000
  );
$job$);
```

`cron.job_run_details`의 succeeded는 HTTP 등록이 성공했다는 뜻이다. 같은 호출의 request ID와 `net._http_response`를 대조해 status_code·timed_out·error_msg 존재 여부를 확인하고, 실제 소유자 API의 분석/작업 terminal 상태와 함께 판단한다. 응답 content 전체나 Vault decrypted_secret은 출력하지 않는다. 실패 진단은 인증→설정/DB 권한→claim/lease→해당 작업 결과 순서로 진행한다. 운영 적용 티켓에 배포 revision·인증/구성 확인·단일 실제 완료·등록/HTTP 응답·재개 결과를 별도로 남긴다.

```sql
-- 소비를 중지한다. 이미 접수된 영속 작업은 보존된다.
select cron.unschedule('entity-schema-worker');
```

중지 후 이미 발송된 pg_net 요청과 실행 중 lease의 종료/재개 가능성까지 확인한다. 복구 자료 만료 정리는 별도 DB 유지보수이며 이 consumer 일정과 합치지 않는다. 운영에서 Cron·Vault·Secrets를 실제 변경했다는 증거는 해당 환경 배포 티켓이 소유한다.

## 검색 worker 호출과 복구

`POST /functions/v1/index-worker`는 사용자 HTTP/MCP 토큰 대신 `Authorization: Bearer <PROCESSING_TOKEN>`을 요구한다. 본문은 `{ "limit": 5 }`이며 최대 5개를 병렬 처리한다. 제한된 확인에는 `workspace_id`·`kind`·`id`를 추가해 범위를 좁힌다. 범위를 생략하면 현재 보이는 전체 큐에서 읽으므로 비용 검증에는 반드시 시험 항목을 지정한다. 키/DB 미설정은 claim 전 503, 인증 실패는 401, 잘못된 입력은 400이다. 반환은 claimed·indexed·excluded·failed·retry·held·stale 개수이며 원문/비밀은 포함하지 않는다.

서버 Secrets는 `WORKER_DB_URL`(app_worker의 트랜잭션 풀러), `PROCESSING_TOKEN`(32 byte 이상 무작위 값의 base64url), `PINECONE_API_KEY`, `PINECONE_ACCOUNT_SCOPE`다. account scope는 비밀이 아닌 안정적인 공급자 account/project 식별값으로, API key 교체 시에도 유지한다. 누락·공백·120자 초과면 worker는 claim 전에 설정 오류로 중단한다. 로컬 `setup:local`은 역할 비밀번호·내부 토큰을 생성/보존하고 풀러 준비 실패를 숨기지 않는다. 함수 env의 기존 Pinecone 키를 우선하며 기존 `.env.local` 실험 키가 있을 때만 초기 설정으로 복사한다. 함수 설정을 바꾸면 실행 중인 함수 서버를 다시 시작한다.

공급자 호출 제한은 30초·응답 128000 bytes, batch 최대 5, 큐 visibility 90초다. 정확한 passage effect별 첫 호출을 포함한 최대 실제 전송은 5회이며 큐 read_ct나 새 message ID로 초기화하지 않는다. 실제 전송 전에 횟수를 저장하고 30·60·120·240초 backoff를 적용한다. 429/5xx의 확인된 거절은 transient 재시도이며 마지막은 failed/retry_exhausted다. timeout·응답 유실·invalid response·결과 저장 불명은 unknown으로 남기며 다섯 번째는 unknown/retry_exhausted로 보류한다. worker의 held는 큐를 archive하고 현재 색인은 pending으로 유지한다. MCP `get_status`·`list_indexing_issues` 조회에서 현재 색인 현황과 문제 기록의 이유·시도·구간 진행을 확인한다. 공급자 멱등/조회 지원이 없어 제한 재계산은 중복 과금 가능성이 있다. 실제 send 수·unknown/held·retry_exhausted·cache 재사용과 input_limit 분할 부모/자식 수를 함께 관찰한다. 총 비용은 각 입력 구간의 최대 5회 전송과 구간 수에 영향을 받으며 고정 화폐 상한을 보장하지 않는다.

인증/구성 오류는 즉시 failed/configuration, 빈 본문은 excluded/invalid_input이며 input_limit 구간은 별도 자식으로 분할한다. 성공 형제 구간과 final apply 전 성공 결과는 재사용한다. 장애를 해결한 뒤 현재 소유자 문맥에서 app.enqueue_search_index(kind,id,current_hash,current_pipeline)을 호출해 재등록할 수 있지만 같은 원본 revision·본문 hash·pipeline·account scope의 성공 cache와 전송 상한은 유지한다. 소진된 작업은 실제 원본 수정 또는 검토한 pipeline 변경이라는 새 의도로 해결한다. 비용 상한을 우회하려고 임의 account scope를 변경하지 않는다. 큐를 비우거나 보관 메시지만 되돌리지 않는다.

effect lease는 90초이며 만료만으로 외부 실패를 확정하지 않는다. 새 claim은 fence를 증가시키고 이전 fence 또는 만료 lease의 완료 저장을 거절한다. 원본 공간·실행자·권한 footprint·공간 generation·revision·본문 hash·pipeline이 현재와 다르면 결과를 적용하지 않는다. 현재 Pinecone adapter는 동기 embed 호출만 사용한다. 공급자 작업 ID·비동기 접수·결과 조회·멱등 키 유효기간 계약은 두지 않으며 가상의 공급자 멱등 헤더를 보내지 않는다. unknown 재계산도 같은 구간의 기존 최대 5회 전송 안에서만 수행한다.

`private.passage_effects` 하나에 원본 식별정보와 구간 결과·상태·전송 횟수·lease·fence·backoff를 보관한다. 기존 큐는 업무 트랜잭션의 작업 의도를 유지한다. 전진 migration은 기존 원장의 성공 벡터·불명/실행 중 상태와 횟수·시계를 그대로 이관하며 전송 예산을 초기화하지 않는다. pending/running/unknown effect는 TTL이나 원본 삭제 FK로 삭제하지 않는다. 현재 원본의 성공 구간 벡터는 재사용하며 수정·삭제·pipeline 교체는 최종 succeeded/failed 결과만 정리한다. 불명 작업의 증거는 남긴다. 안전한 사용자 조회는 HTTP `/status`·`/status/indexing/issues`와 대응 MCP `get_status`·`list_indexing_issues`다. 문제 목록은 최대 5개 기록의 제목·이유·시도 수·구간 진행 요약만 반환하며 private effect ID·벡터·공급자 응답·다른 owner·옛 revision을 노출하지 않는다. private 원장을 임의 수정해 lease·fence·횟수를 초기화하는 복구는 하지 않는다.

배포 전 외부 작업 원장과 worker 복구 전진 migration을 먼저 적용하고, 안정적인 PINECONE_ACCOUNT_SCOPE를 함수 환경에 설정한 뒤 새 worker를 배포한다. API key 교체에서는 scope를 보존한다. 이것은 배포 절차이며 저장소 변경만으로 운영 적용됐다는 뜻은 아니다.

Cron 활성화는 해당 환경의 배포 지시 범위에서만 한다. [Supabase 공식 방식](https://supabase.com/docs/guides/functions/schedule-functions)에 따라 pg_cron·pg_net을 켜고 Vault에 `search_worker_url`(함수의 고정 HTTPS 주소)·`processing_token`을 저장한다. worker의 인증·소량 성공·비용 확인 뒤 아래 작업을 등록한다. 로컬 초기화나 migration은 자동 소비 일정을 만들지 않는다.

```sql
select cron.schedule('search-index-worker', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='search_worker_url'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='processing_token')),
    body := '{"limit":5}'::jsonb, timeout_milliseconds := 45000
  );
$job$);
-- 인증 실패·반복 장애·비용 이상 시 소비를 중지한다(큐는 보존).
select cron.unschedule('search-index-worker');
```

Cron 설정 전 같은 이름의 job·Vault 항목이 있으면 값을 출력하거나 덮어쓰지 않고 기존 소유·설정부터 확인한다. 활성화 후 `cron.job_run_details`의 succeeded는 비동기 HTTP 등록 성공이므로 `net._http_response`의 상태·timeout/error·worker count도 별도로 확인한다. 빈 큐의 HTTP200/0건을 실제 임베딩 성공으로 세지 않으며 본인 계정의 scoped 소량 성공과 현재 hash/vector를 앞서 대조한다. 공급자 usage/청구액이 응답에 없으면 batch/처리 수의 한정 관찰과 실제 금액을 구분한다. 2026-10-04 본인 기록 생성·수정의 제한 색인 성공과 매분 limit5 Cron 활성화는 [PR #84 완료 기록](https://github.com/kimyongin/agent-workspace-template/pull/84#issuecomment-5975318940)에서 확인한다. 당시 운영 함수 source는 `1730dc983eb10e282e28f3a200ffbd265978480e`였다. 이는 당시의 적용 증거이며 현재 운영 상태나 이후 main의 배포 완료를 보증하지 않는다.

pg_net 기본 queue ACL과 공개 접근 경계를 설치 환경에서 확인한다. 요청 큐의 header/token 값은 조회하지 않는다. 공개 Data API 노출 여부는 `Accept-Profile: net`·`select=id`/count처럼 비밀 없는 요청과 schema 거부로 확인한다. net이 공개로 노출되면 해당 소비 job을 중지하고 권한/노출 원인을 해결한 뒤 재개한다. 플랫폼 소유 테이블의 ACL을 바꿀 권한이 없다면 ownership 변경·권한 우회를 하지 않고 실제 경계와 관리 권한 한계를 기록한다. 서버 role/고정 SQL 또는 Data API 노출 설정이 바뀌면 다시 확인한다.

Cron 실행 결과와 pg_net 응답, `app.search_index_state`의 상태/이유별 수·최종 갱신 시각, `pgmq.metrics('search_index')`의 대기량/나이를 함께 확인한다. 토큰을 출력하지 않는다. 실제 호출/알림·복구 기준은 환경별 배포 티켓에서 검증한다. 유료 로컬 검증은 명시적으로 승인된 경우에만 `npx --no-install deno run --config supabase/functions/deno.json --allow-env --allow-net --allow-read --env-file=.env.local supabase/tests/real-model/hybrid-smoke.ts`로 실행한다. 현재 공간의 공개 업무 흐름으로 만든 세 기록 원본을 처리하고 HTTP·MCP 의미 검색과 원문을 대조한 뒤 해당 시험 공간을 정리한다. 이 검사는 기록 공급자 품질·과금 경로이며 자료 선택 텍스트의 품질 검증이나 빠른 모의 공급자 성공을 대신하지 않는다. CI에서는 실행하지 않는다.

## 백업과 데이터 복구

운영 전에 허용 데이터 손실 범위(RPO)와 복구 시간 목표(RTO)를 정한다. Supabase 프로젝트의 실제 백업/PITR 제공 범위·보존 기간·복원 권한을 확인한다. Git 저장소나 migration 이력은 사용자 데이터 백업을 대신하지 않는다. 제공 범위가 부족하면 별도 암호화 백업과 접근·보존 정책을 구성한다.

DB 외에 함수 코드, 서비스 설정, 비밀값을 재설정할 경로를 관리한다. Storage를 추가하면 파일 객체도 별도 복구 대상으로 관리한다. DB 백업에 Storage의 실제 파일이 포함된다고 가정하지 않는다. 제공 범위는 [Supabase 백업 문서](https://supabase.com/docs/guides/platform/backups)를 따른다.

복구 절차:

1. 영향 범위와 복구 목표 시점을 정하고 증거를 보존한다. 필요한 쓰기·worker·Cron을 중지하거나 제한한다.
2. 가능한 격리 환경에 먼저 복원해 데이터·소유권·참조와 첫 사용자 흐름을 확인한다. 프로젝트 기능에 맞는 복원 경로는 첫 배포 전에 연습한다.
3. 복원 시점 이후 잃는 데이터와 외부 서비스 변경을 대조하고 운영 복원/전환을 실행한다. 접속 설정과 필요한 역할 비밀값도 확인한다.
4. 복원된 큐·완료 정보가 이미 실행한 외부 작업을 다시 실행할 수 있음을 고려해 재처리 범위를 확인한다. worker를 즉시 일괄 재개하지 않는다.
5. 사용자 데이터·권한·HTTP/MCP·검색 상태를 확인하고 단계적으로 재개한다. 복원 시간·유실 범위·남은 보정 작업을 기록한다.

백업 생성 성공과 복원 성공은 별개의 증거다. 첫 배포 전과 주요 저장 구조 변경 후 복원 연습을 수행하고, 이후 주기는 운영자가 확정한다.

## 인증과 비밀값 관리

보호 기준은 [보안 가이드](../security/guide.md)를 따른다. 의심스러운 접근·자료 노출이 확인되면 영향 경로를 제한하고 자격 증명·세션을 계약에 따라 회수한다. 민감한 본문을 추가로 수집하지 않으면서 요청/작업 ID와 시간·revision을 보존해 범위를 조사한다. 원인 제거와 데이터·권한 검증 후 단계적으로 재개하고, 영향받은 사용자 통지와 필요한 후속 조치는 실제 사고 범위에 맞춰 정한다.

연결 장애에서는 만료·redirect·issuer/audience·클라이언트 등록·배포 버전을 확인한다. 오류 해결을 위해 권한 검사나 RLS를 해제하지 않는다. 비밀값 교체 시 서버·내부 worker 호출·CI·외부 공급자의 사용처를 확인하고 새 값 적용과 동작 확인 후 기존 값을 폐기한다. 노출 사고는 해당 자격 증명을 우선 폐기하고 영향 범위를 조사한다.

웹 로그인과 에이전트 OAuth, 제품 스킬 설치는 별도 연결이다. 하나의 성공을 다른 클라이언트의 정상 동작 증거로 쓰지 않는다.

에이전트의 기본 제공 단위는 MCP 연결과 제품 스킬이 포함된 플러그인이다. 장애 조사 시 설치된 패키지 식별자·버전·참조 앱/endpoint·인증 상태·스킬 포함/선택 여부를 함께 확인한다. 서버 도구는 정상이어도 이전 스킬이나 다른 환경의 연결 설정 때문에 행동이 달라질 수 있다. 서버와 패키지의 호환 조합을 기록하고 [플러그인 배포 절차](../deployment/release.md)에 따라 갱신·복구한다.

## 장애 기록과 정기 점검

장애 기록에는 발견 시각·시간대, 사용자 영향, 대상 환경/revision, 관련 요청·작업 ID, 원인, 중지·복구 조치, 데이터/외부 부수효과 확인, 재발 방지와 담당자를 남긴다. 기술 오류 해소와 사용자 데이터 복구 완료를 구분한다.

정기 점검에서는 큐 보류 작업, 백업·복원 증거, 공급자 비용·한도, 접근 권한·비밀값, 의존성과 플랫폼 변경을 확인한다. 요금제·플랫폼 업데이트로 운영 조건이 달라지면 배포·운영 문서와 해당 기능 계약을 함께 갱신한다.

## 워크스페이스 초대 메일

초대 저장과 메일 전송은 별도로 확인한다. 내부 worker의 설정 확인·명시 실행, 현재 권한 재검사, 전달 상태와 결과 불명 재시도 기준은 [초대 메일 전달](../development/invitation-mail.md)을 따른다. `sent`는 공급자 접수이며 수신 확인이 아니다. 로컬 Mailpit 검증을 외부 발송 증거로 기록하지 않고, 설정이 없으면 `unconfigured`로 남긴다.
