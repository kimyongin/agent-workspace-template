# 자료 종류 속성 변경 계약

속성 변경은 종류별 초안 저장 → 비동기 영향 분석 → 호환 가능한 새 버전 게시 또는 값 변환 작업으로 진행한다. HTTP와 MCP는 같은 유스케이스·Actor 트랜잭션·요청 원장을 사용한다. 조회와 버전 미리보기는 쓰기나 분석 실행을 하지 않는다.

## 제한된 편집

`POST /entity-types/:type_id/schema-changes`는 `expected_type_version`, `expected_schema_version`, `edits`를 받는다. `PATCH .../:change_id`는 추가로 `expected_change_version`을 받는다. 편집은 `add_property(client_ref, field, required)`, `update_property(key, field, required)`, `archive_property(key)`, `restore_property(key)`, `remove_property(key)`, `set_display(display)`만 받는다. 필드 정의는 지원하는 평평한 JSON Schema 집합이며 전체 정의 업로드·키 변경·다른 종류로 이동·코드·URL 실행은 허용하지 않는다.

추가 속성의 키는 종류 행을 잠근 트랜잭션에서 서버가 영구 예약한다. 다른 종류는 같은 prop_n을 사용할 수 있다. 초안에서 추가를 빼도 예약 번호를 회수하지 않는다. 같은 요청 키와 같은 입력은 원래 예약을 반환하며 다른 입력은 충돌한다. 같은 내용의 PATCH는 변경 버전을 올리지 않는다. 실제 변경은 분석 참조를 무효화한다.

보관은 정의와 저장값을 유지한다. 필수 속성을 보관하려면 같은 최종 정의에서 필수를 직접 해제해야 한다. 대표 이름은 항상 활성·필수·nullable이 아닌 일반 텍스트이며 공백만인 이름을 허용하지 않는다. 임시 편집 순서가 아니라 최종 정의를 검사한다. 선택 코드의 null은 nullable 타입과 enum 양쪽에서 허용해야 입력할 수 있다. 날짜는 0001~9999년의 실제 Gregorian 날짜다.

## 정확한 정책과 분석

초안은 해석된 target, 예약, fingerprint와 필드별 before/after·분류·이유·다음 행동을 반환한다. 라벨·설명·표시 순서·선택 속성 추가·필수 해제·제약 확대·선택 코드 추가는 호환 가능하다. 필수화·타입 변환·제약 축소·코드 제거·영구 삭제는 자료 수가 0이어도 값 변환이 필요하다. 정수→숫자는 이전 정수 범위가 제품 숫자 범위 ±10억 안에 있을 때만 호환 가능하다. 대표 이름 불변 조건이 일반 정책보다 우선한다.

`POST .../:change_id/analyze`는 `expected_change_version`과 요청 키를 받아 202로 `type_id/change_id/change_version/analysis_id/status: queued`를 반환한다. 정의·초안·기록 템플릿 버전과 삭제 상태를 포함한 전체 자료 집합·버전·값을 고정하여 durable 분석을 접수한다. 최대 2000개·8 MiB다. 내부 작업자는 50개씩 정의/값 validator를 한 번 컴파일하여 모든 결과를 검증한다. 분석은 제한된 변환 규칙을 적용한 별도 결과를 저장하며 활성 자료 값·정의를 바꾸지 않는다. 생성 기본값은 기존 자료에 채우지 않는다. 분석 상태는 queued/running/succeeded/failed, 변경 상태와 분석 상태는 별개다. succeeded의 failed 수가 양수면 실행할 수 없다.

작업자 claim/결과는 fence와 90초 lease로 결속한다. 오래된 작업자가 새 초안/분석에 결과를 저장할 수 없다. 분석 완료와 GET은 현재 종류·스키마·자료 membership를 대조하여 stale을 반환한다. 분석/GET 응답은 원본 전체 자료를 노출하지 않고 최대 20개 실패 요약만 반환한다. before/after 페이지와 실제 적용 작업은 아래 별도 경계를 사용한다.

## 게시와 표시

`POST .../:change_id/apply`는 `expected_change_version`, `analysis_id`, 요청 키를 받는다. 최신 성공 분석·실패 0·동일 소스와 membership·compatible 여부를 같은 종류 잠금 아래 검사한다. 새 불변 정의를 삽입하고 종류의 현재 스키마 포인터와 metadata 버전을 원자적으로 올린다. 기존 자료의 저장값·저장 schema_version·데이터 version·과거 기록은 바꾸지 않는다. 이전 입력 폼은 schema_changed로 초안을 유지한다.

목록/상세/새 연결 capture의 현재 라벨·대표 이름·표시 순서·목록 컬럼·보관 표시는 현재 정의를 사용한다. 저장 schema_version은 마지막 저장 정의의 이력으로 유지한다. 과거 기록의 당시 제목/본문은 다시 쓰지 않는다.

MCP는 `create/get/list/update/analyze/apply_entity_schema_change`를 제공한다. create/update/analyze/apply는 모두 request_key가 필요한 명시 쓰기다. 웹은 발급 전 추가 속성을 저장하여 키를 확인한 뒤 그 키의 대표/목록/선택 라벨 표시를 편집한다. 전송 결과가 불명확하면 동일 요청을 재확인하고, 완료 후 조회 실패는 게시 실패와 구분한다.

자료 종류별 effective 기록 템플릿의 속성 참조가 target에서 존재하고 활성인지 검사한다. create/update/analyze/apply는 설정 잠금 아래 해당 타입의 effective 템플릿 SHA256을 비교한다. 다른 타입·할 일 템플릿 변경만으로 무관한 변경안을 stale로 만들지 않는다.

## 제한된 변환과 명시 보완

create/PATCH는 `migration: {rules, overrides}`를 받는다. fingerprint에는 이 입력도 포함한다. 규칙·보완 변경은 change version을 올리고 이전 analysis_id를 무효화한다. 규칙 또는 보완을 지정하면 호환 정의라도 값 변환 경로다. 분석은 값을 적용하지 않는다. 값 적용은 최신 성공 분석에 결속한 별도 작업이며 완료 후 복구안은 후속 기능이다.

같은 key당 convert/map 하나, fill 하나, replace_failure 하나만 지원한다. remove는 제거 편집과 결속하고 다른 변환과 함께 쓰지 않는다. `convert(key,to)`는 string/integer/number/date, `map(key,mapping,identity)`는 선택 코드 매핑, `fill(key,value,include_null)`은 누락 또는 명시적으로 null까지 채우기, `remove(key)`는 target에서 제거한 속성의 영구 값 제거, `replace_failure(key,value)`는 해당 속성 실패만 대체한다. `overrides(entity_id,key,value)`는 해당 owner/type 자료만 직접 보완한다. 보완 리터럴·코드 매핑 대상값은 저장 시 target field로 검증한다. 순서는 속성 변환 → 누락 채우기 → 행 보완 → 실패 대체 → 최종 전체 객체 검증이다. 임의 코드·URL·표현식·타입 간 이동은 받지 않는다.

누락은 누락, null은 null로 유지하며 target이 허용하지 않으면 실패한다. false/0/빈 문자열은 누락과 구분한다. 문자열 숫자는 전체 ASCII 십진수만 허용한다. 공백·지수·그룹/locale·hex·앞자리 0·소수 잘림·반올림을 허용하지 않는다. 정수는 안전 정수, 숫자는 절댓값 10억·소수 6자리 및 손실 없는 십진수 표현을 검사한다. 숫자→텍스트는 locale 없이 십진수로 표시한다. 날짜는 실제 Gregorian YYYY-MM-DD만 받는다. boolean 암묵 변환은 없다. mapping에 없는 코드는 실패하며 identity=true를 직접 지정하면 이미 허용된 코드를 유지한다.

`GET .../:change_id/rows?analysis_id=...&limit=20&after=...&failures_only=true`와 MCP `list_entity_schema_analysis_rows`는 동일한 `analysis_id/items/next_after`를 반환한다. 항목은 entity_id, before, after, after_bytes, changed, removed, replacements, errors다. entity_id 정렬과 after cursor, 최대 100개·512 KiB 페이지를 사용한다. 변환 객체가 속성 값 64 KiB를 넘으면 after=null과 after_bytes 및 명시 크기 오류를 반환하며 큰 결과를 잘라 성공으로 저장하지 않는다. snapshot+결과 저장은 전체 8 MiB를 넘으면 analysis_result_limit 실패로 중단한다. queued/running/failed는 빈 성공 페이지로 보이지 않는다. 분석 DTO는 total/processed/failed/changed/unchanged/removed/replacements와 definition_fingerprint/snapshot_fingerprint를 포함한다. ready는 분석 완료이며 failed>0이면 executable=false다. worker 기반 실패는 별도 analysis.status=failed, retryable/failure_reason으로 노출하고 change는 draft로 돌아온다. 새 분석 접수가 재시도다.

보관·삭제 자료까지 전체 snapshot을 종류 잠금 아래 단일 materialized SQL statement로 membership/count/bytes/원본 행을 함께 저장한다. worker는 최대 50개·512 KiB 원본을 claim하며 90초 fence/lease를 사용한다. 공통 validator를 배치당 한 번 컴파일한다. 오래된 worker는 결과를 저장할 수 없다. 소유자 밖의 계획/샘플/보완은 not_found다.

웹 `/settings/entity-types/:type_id/migrations`에서 속성 편집기로 초안을 만들고 변환·채우기·매핑·제거·실패 대체·행 보완을 명시한다. 저장된 변경안 직접 링크와 목록으로 새로고침 후 다시 읽는다. 분석은 페이지 수명과 별개로 durable worker가 처리한다. 저장 전 수정은 이동 확인/새로고침 확인으로 보호하며 polling은 입력 초안을 덮어쓰지 않는다. 이전 분석은 수정/새 분석 뒤 재사용할 수 없다.


| HTTP | MCP | 동작 |
| --- | --- | --- |
| POST /entity-types/:type_id/schema-changes | create_entity_schema_change | 정의·제한 변환 초안 저장 |
| PATCH /entity-types/:type_id/schema-changes/:change_id | update_entity_schema_change | 정의·규칙·행 보완 변경 및 이전 분석 무효화 |
| POST .../:change_id/analyze | analyze_entity_schema_change | 202 durable snapshot 분석 접수 |
| GET .../:change_id | get_entity_schema_change | 상태·freshness·counts·fingerprint |
| GET .../:change_id/rows | list_entity_schema_analysis_rows | bounded before/after·실패 페이지 |
| POST /entity-schema-migrations/:job_id/recovery-changes | create_entity_schema_recovery | 원본·현재 버전 확인 후 새 복구 draft만 생성 |
| POST .../:change_id/migrations | start_entity_schema_migration | 최신 분석·fingerprint로 정상 값 변환 접수 |
| GET /entity-schema-migrations/:job_id | get_entity_schema_migration | 결과·보존 기한·복구 가능 여부 조회 |

## 타입별 목록과 기록 소비자

`GET /entities`, 읽기 전용 `POST /entities/query`, `list_entities`는 같은 목록 유스케이스와 AND 배열 `filters`·`sort` 계약을 사용한다. GET은 URL 인코딩 JSON, POST와 MCP는 배열·객체를 직접 전달한다. 웹 공통 API는 인코딩된 전체 요청 URL이 2,048바이트를 넘으면 전송 전에 POST 본문으로 전환하며, 짧은 GET은 유지한다. 이 POST는 요청 키·성공 원장·변경 기록 없이 조회하고 GET 414 후 자동 재시도하지 않는다. 속성 조건 또는 속성 정렬에는 `entity_type_id`가 필요하며 잘못된 키·보관 속성·연산자·스칼라 타입·중복 비교·모순 범위는 입력 오류다. 텍스트는 `eq/contains`, 숫자·날짜는 `eq/gt/gte/lt/lte`, 불리언·선택 코드는 `eq`를 지원한다. 값 없는 `unset`은 null 또는 키 누락을 함께 찾는다. 한 조회에 조건은 최대 32개다. 필터는 값을 변환하거나 반올림하지 않는다.

정렬은 `updated_at` 내림차순, `title` 오름차순 또는 `{key,direction}`이다. 속성 오름차순은 누락 → 명시 null → 값, 내림차순은 반대이며 각 그룹과 같은 값은 자료 ID로 결속한다. 커서는 owner·조건·대상 타입 집합의 metadata/schema revision을 포함한다. 긴 Unicode 텍스트와 식별자를 지원하도록 인코딩 커서는 24 KiB로 제한한다. 종류별 공유 잠금 아래 정의와 목록을 읽고 최초 타입 집합에 조회를 결속하여 게시·atomic migration 중 다른 정의의 값/정렬이 섞이지 않는다. 숫자 SQL 캐스트는 JSONB kind를 검사한 CASE 안에서만 수행한다. 값·현재 표시·종류·발급처 표시는 한 joined statement로 읽으며 자료마다 설정을 다시 조회하지 않는다.

웹의 `property_filters`와 JSON `sort`는 목록 URL의 타입 전용 조건이다. 필터 펼침의 `filters=1`과 구분하며 타입 전환 때 공통 keyword/tag/view는 보존하고 타입 전용 조건·페이지·커서는 초기화한다. 조건 초기화는 현재 타입을 보존한다. 목록·상세가 받은 현재 정의 버전의 불변 표시를 읽어 라벨과 값의 시점을 맞춘다.

`record_templates.entity_types[type_id][action]`은 해당 종류의 메모·기본 기록 태그를 저장한다. 종류에 설정하지 않은 행동은 공통 entity 템플릿/기본값을 사용한다. 새 속성 변수 `$엔터티.이후.prop_n$`는 선택한 종류의 활성 키에 결속하며 공통 entity 설정에서는 속성 변수를 저장할 수 없다. 설정 UI는 종류 이름·아이콘·정의 버전·속성 라벨을 보여주고 고정 키를 삽입한다. 명시 메모가 템플릿보다 우선하며 0/false/빈 문자열/null을 누락으로 자동 변환하지 않는다. 설정 섹션 version은 기존 독립 저장 계약을 유지한다.

새 할 일·기록 선택 문맥에는 당시 대표 제목·종류 ID/이름/아이콘·현재 schema_version을 함께 보존한다. trusted 이전 문맥과 과거 본문은 이후 이름/속성 변경에도 다시 쓰지 않는다. 보관 타입에는 새 선택을 추가하지 않으며 기존 선택은 유지한다. 삭제 식별자를 처음 확인하여 복원할 때는 기존 활성 속성·태그를 준비 요청에 담고 보관 속성은 생략하여 서버가 원래 값을 보존하게 한다. 생성 후 자료 종류는 변경하지 않는다.


## durable 값 변환 작업

`POST /entity-types/:type_id/schema-changes/:change_id/migrations`와 `start_entity_schema_migration`은 `expected_type_version`, `expected_schema_version`, `expected_change_version`, `analysis_id`, `fingerprint` 및 요청 키를 받아 202 접수로 `job_id/type_id/change_id/analysis_id/job_version/status: queued`를 반환한다. migration_required·최신 ready 분석·실패 0·정확한 source membership와 해당 종류 effective 템플릿만 같은 타입 잠금 아래 대조한다. 같은 키 성공 재현은 완료 후에도 원래 접수 응답을 반환한다. 새 실행 여부를 timeout만으로 추측하지 않는다.

`GET /entity-schema-migrations?type_id=...&limit=20&before=...`와 `list_entity_schema_migrations`는 소유자의 종류별 작업을 최근 생성 순서로 기본 20/최대 100개 조회한다. before는 같은 소유자와 종류 범위의 마지막 job UUID다. `GET /entity-schema-migrations/:job_id` / `get_entity_schema_migration`은 종류 이름·아이콘, 계획/분석 참조, version, 상태, total/processed, retryable/failure_reason, 확정 result, source_expires_at을 반환한다. 과대 원본과 준비값은 상태 응답에 포함하지 않는다.

상태는 queued → preparing → ready_to_commit → committing → succeeded다. DB의 owner/type 활성 작업 유일 제약과 접수부터 terminal까지의 종류 쓰기 gate가 CRUD·속성 게시·보관 및 두 끝점 중 하나가 해당 종류인 연결 쓰기를 막는다. 할 일/기록의 선택 변경·삭제·새 상속은 기존/새/상속 선택의 타입 합집합을 task/record 잠금 전에 정렬하여 검사한다. 선택을 유지하는 메모/본문 수정·다른 종류/소유자 업무와 읽기는 계속된다. 엔터티 값을 바꾸는 태그 삭제는 태그 잠금 전에 관련 타입을 검사하고, 이후 새 타입 사용이 발견되면 충돌로 롤백한다. 기존 선택 문맥과 과거 자동 기록은 다시 캡처하지 않는다.

`POST .../:job_id/cancel` / `cancel_entity_schema_migration`은 `expected_job_version`·요청 키를 확인하여 committing 전에 취소한다. committing 또는 terminal 상태가 먼저 확정되면 그 결과가 우선한다. 취소는 준비 행을 제거하고 원본/정의를 유지하며 변경안을 draft로 돌려 현재 분석 참조를 해제한다. 새 실행은 새 분석이 필요하다. `POST .../:job_id/retry` / `retry_entity_schema_migration`은 같은 입력을 받고 retryable failed인 같은 작업을 최신 source/plan/템플릿/관계 baseline으로 재검사하여 202로 재개한다. 새 의도 키를 사용한다. cancelled/stale/값·크기 오류는 새 변경안 또는 재분석을 요구한다.

전용 토큰이 없거나 틀리면 worker는 DB 연결 전에 거부한다. app_worker는 테이블 권한 없이 claim/stage/fail/commit RPC만 실행한다. claim은 최대 50행·원본+대상 512 KiB, preparation은 최대 50행·직렬화 결과 512 KiB·2초로 제한한다. lease는 90초이며 각 claim은 fence를 올린다. stage/fail/finalize 모두 살아 있는 같은 fence/lease만 받아 이전 worker를 막는다. lease 만료나 DB timeout은 failed 확정이 아니며 다음 worker가 같은 작업을 조정한다. statement timeout 15초와 lock timeout 5초를 유지한다.

원본/대상·정의·effective 템플릿·관계/선택 baseline·기록 준비 자료 합계는 8 MiB, 전체 대상은 삭제 상태 포함 최대 2000개다. 값과 대표 이름은 공통 변환 validator로 다시 확인하고 변경 행의 메모/기록 태그·입력 해시는 일반 쓰기와 같은 공통 규칙으로 준비한다. 최종 단일 RPC 트랜잭션이 현재 pointer·모든 대상 properties/schema/data version·불변 정의·필요한 새 변경 기록과 색인 의도·성공 result·복구 baseline을 bulk SQL로 함께 확정한다. 엔터티 ID/종류와 pair 매핑, 과거 본문/캡처는 유지한다. 중간 rollback은 어느 적용 효과도 남기지 않는다. joined GET과 type FOR SHARE 목록은 전체 이전 또는 전체 새 epoch를 읽는다.

성공 원본·원본 정의·source/committed membership와 pair/현재 task/user·result record 선택 구조는 성공 시점부터 30일간 소유자 범위에 보존한다. 실패 작업의 재시도 원본은 접수 시점부터 30일간 보존하며 만료 뒤 새 분석이 필요하다. task/record 본문 version이나 다른 종류 peer 속성 version을 복구 충돌로 저장하지 않는다. worker는 만료된 terminal 자료를 제한된 묶음으로 제거하며 만료된 원본 분석 페이지는 migration_source_expired/410이다. 성공 결과와 계획/작업 참조는 남는다. `POST /entity-schema-migrations/:job_id/recovery-changes` / `create_entity_schema_recovery`는 `expected_job_version`, 현재 `expected_type_version`·`expected_schema_version`, 요청 키로 **새 draft만** 생성한다(HTTP 201). 서버가 보관한 같은 의미의 원래 prop_n과 원본 값만 사용하며 키 예약 번호를 회수하지 않는다. 현재 label/icon/menu ref와 기존 관계, 과거 본문/context는 유지한다. 현재 schema에서 나중에 추가한 속성은 유지하고 현재 템플릿 참조를 검사한다. recovery 출처·기한은 변경안에 표시한다. 원본 자료는 분석 행에 복사하여 정상 analyze/rows/start/jobs/cancel/retry 흐름으로 검증·미리보기·실행한다. 복구 초안의 임의 schema/값 편집은 지원하지 않으며 수동 보완은 현재 자료의 새 변경과 분석으로 준비한다.

job 상태/목록의 `recovery.status`는 available/expired/unavailable/conflict와 safe reason, 현재 type/schema version을 반환한다. GET은 정리를 실행하지 않는다. 기간이 지난 원본은 물리 자료가 남아 있어도 `migration_source_expired`/410이다. 원본이나 확정 baseline이 없는 경우 unavailable이다. 완료 시점의 committed membership·pair/할 일·기록 선택 baseline을 생성→분석→start에서 다시 검사하고 최종 commit은 정상 source membership·references gate를 다시 검사한다. 값/tag/생성/삭제/복원/식별/연결/선택 변경은 최대 20개 자료 이유와 연결 이유를 반환해 자동 덮어쓰기를 거부한다. 본문만 수정하거나 다른 종류 peer의 속성/schema를 바꾸는 경우는 원본 복구 대상에 넣지 않는다. 현재 schema가 달라진 경우 현재 버전으로 **새 복구안과 새 분석**을 요청해야 한다.

복구 draft/분석은 원본의 30일 기한을 연장하지 않는다. 기한 안에 start로 접수한 활성 복구 job은 8 MiB 안에서 복사한 자기 원본·복구 값을 소유하므로 원본 cleanup 이후에도 정상 준비/commit을 마칠 수 있다. 활성 job 분석은 정리에서 제외한다. worker가 type→job/analysis 순서 잠금과 skip locked로 terminal 원본 최대 20개 및 30일 된 orphan/완료 분석 최대 20개를 정리한다. 새 요청에는 만료된 원본을 공개하지 않으며 account/type 삭제는 관련 자료를 함께 제거한다.

웹 `/settings/entity-types/:type_id/migrations/:job_id`는 접수 후 페이지 이탈·직접 링크·새로고침·상태 조회·취소·재시도를 지원한다. GET/polling은 작업을 실행하지 않는다. 실행 인프라는 기존 opt-in 로컬 runner 또는 운영자가 별도로 설정하는 전용 worker 스케줄이다. 운영 Cron 활성화·배포는 이 구현의 실행 범위가 아니다.


### 긴 속성 조건의 웹 주소

웹의 `property_filters` 주소 상태는 하나의 URL 모듈에서 읽고 생성한다. `/entities?`와 인코딩 query가 2,048바이트를 넘으면 조건 JSON은 `#property_filters=...&entity_type_id=...` fragment로 옮기며 짧은 조건은 기존 query 형식을 유지한다. fragment는 HTML/API HTTP 요청에 전송되지 않고 복사·직접 링크·새로고침·Back/Forward에서 브라우저가 복원한다. 자료 종류 ref는 query와 fragment에서 같아야 한다. query와 fragment 양쪽 조건, 중복 조건/타입/앵커, 잘못된 JSON·인코딩·알 수 없는 fragment 필드는 오류로 표시하며 전체 자료로 넓히지 않는다. 공통 검색 변경은 오류 입력을 보존하고 명시 조건 적용/초기화에서만 교정한다.

긴 조건과 기존 자료 위치를 함께 보존할 때는 fragment의 `anchor=entity-...`를 사용하며 기존 `#entity-...` 주소도 읽는다. 상세의 `list` query에는 짧은 목록 주소만 넣고 긴 조건·앵커는 상세 fragment에 유지하여 상세 직접 링크에서도 다시 긴 request line을 만들지 않는다. 타입 전환·필터 초기화는 조건 fragment와 이전 위치를 제거하며 선택 타입·공통 검색의 기존 보존 규칙을 따른다. 서버 저장·Auth metadata·세션 전용 토큰을 사용하지 않는다. 소유자는 URL에서 지정하지 않으며 현재 인증과 타입 접근 검사가 기존 소유자 경계를 강제한다.

이미 저장된 과도한 query 주소가 HTML 서버에서 거절되면 JavaScript가 시작되지 않아 브라우저에서 자동 전환할 수 없다. 앱이 읽을 수 있는 기존 긴 query 주소는 같은 조건의 fragment 주소로 replace 정규화한다. 새 주소 생성과 정상화된 링크의 새로고침을 검증하며 운영 서버의 한도 변경은 별도 범위다.

게시·값 변환 시작의 실행 순서는 코어 application이 소유한다. 저장 어댑터가 잠긴 타입·변경안·분석·현재 membership을 읽으면 코어의 공통 정책이 경로 호환성, 버전·fingerprint·분석 결속, 실패 없는 성공 분석을 판단한다. 코어가 잠긴 복구·템플릿 기준도 검증한 다음 어댑터에 게시/작업 저장을 지시한다. 작업자의 기록 생성 시각은 어댑터에서 코어로 명시 전달한다.
