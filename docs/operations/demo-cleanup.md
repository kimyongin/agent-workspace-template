# 승인된 테스트 업무 자료 초기화

초기화 계획과 초기화 실행을 구분한다. 이 문서는 운영 자료 삭제·배포·외부 공급자 호출의 실행 지시가 아니다. 기존 테스트 저장소의 초기화는 실행 revision, 저장소 식별, 승인 대상과 보존 대상을 확정한 뒤 별도 실행 증거를 남긴다. 운영 적용은 [배포 가이드](../deployment/release.md)를 따른다.

2026-10-22 사용자는 기존 자료 전체의 삭제를 허용하고 티켓 작성을 지시했다. [#551](https://github.com/kimyongin/agent-workspace-template/issues/551)은 기존 엔터티 자료 및 관련 참조·파생/작업 데이터의 초기화와 공간 복합 PK를, [#543](https://github.com/kimyongin/agent-workspace-template/issues/543)은 식별자 계약 전환을 담당한다. 두 변경에 공통 초기화 계획을 사용해 기존 저장소를 두 번 정리하지 않는다. 계정·인증·개인 설정·공간·참여·권한과 관련 없는 업무 자료는 보존하며, 실제 대상·연관 데이터 범위는 아래 절차와 티켓에서 확인한다. 기존 자료의 보존 이관 엔진을 추가하지 않되 이 허용을 다른 저장소나 외부 공급자 전체 초기화로 확대하지 않는다.

## 기존 테스트 저장소의 실행안

1. 프로젝트 식별과 API·DB host/port/database를 대조하고 실행 revision과 백업 위치·접근 권한·만료 시각을 기록한다. 비밀값은 비공개 환경으로 전달하고 보고서에 쓰지 않는다.
2. 승인된 업무 자료의 공간 ID와 종류별 ID, 연결·수행 결과·자동 변경 기록·모델 정의/버전·분석/변환/복구 원본, 요청 결과와 검색 state/chunk/진행·보관 queue를 읽기 전용으로 조사한다. `owner_id`는 작성자이며 현재 소속이나 독점 소유의 증거가 아니다. 이름 접두사·작성자 전체·현재 계정의 모든 공간을 삭제 대상으로 추론하지 않는다.
3. Auth 사용자·세션·OAuth 연결, 계정과 개인 설정, 비밀값·환경 파일·서비스 설정, 다른 공간과 승인되지 않은 공동 자료를 보존 대상으로 명시한다. 전환 전 분리된 외부 효과 이력과 소속이 불명확한 자료도 자동 채택하거나 삭제하지 않는다. 보존 대상의 전후 비교 기준을 기록한다.
4. 실행 대상이 이미 공동 사용 중인 공간이면 그 안의 일부 ID 승인을 공간 전체 삭제 승인으로 확대하지 않는다. 해당 공간의 선택 삭제에는 참조·요청 재시도·복구·검색 재전달까지 포함하는 별도 검토된 계획이 필요하다. 아래 독점 fixture 정리 도구를 공동 공간에 사용하지 않는다.
5. 해당 저장소의 쓰기와 관련 worker를 멈춘 유지보수 구간에 최종 대상·차단 참조·미결 외부 효과·백업과 재실행 방식을 검토한다. 실제 초기화 지시가 확보되기 전에는 읽기 전용 조사와 계획에서 멈춘다. 실행 후 승인 범위의 잔존 0, 보존 대상 불변, API/웹/MCP의 빈 상태와 오래된 worker/요청의 재전달을 확인한다.

기존 owner 기준 정리 CLI와 fixture는 현재의 nullable 작성자·공간 계약에 맞지 않아 제거했다. 이 실행안 작성은 기존 저장소의 초기화를 수행했다는 뜻이 아니다.

## 실행이 독점 생성한 공간 fixture

[공간 fixture 정리 모듈](../../scripts/workspace-fixture-cleanup.mjs)은 해당 실행이 새로 만든 독점 공간만 처리한다. `run_id`, 40자리 `source_revision`, `project_id`, loopback DB host/port/database, 공간의 정확한 `id/name/created_by`, 명시한 구성원 ID와 시험용 외부 효과 ID를 manifest로 요구한다. 같은 이름이나 작성자만 일치하는 공간을 채택하지 않는다.

`runWorkspaceCleanup(sql, manifest)`는 읽기 전용 repeatable-read 사전 점검을 반환한다. 보고서에는 테이블별 건수·차단 사유·효과 ID·승인 digest가 있고 원문·키·개인 설정은 없다. `runWorkspaceCleanup(sql, manifest, approval)`는 같은 manifest와 승인 보고서를 받아 공간을 잠근 뒤 다시 점검한다. 변경된 digest, 새 구성원 또는 미해결 외부 효과가 있으면 모두 취소한다. 미해결 효과의 예외는 해당 실행의 인프로세스 가짜 공급자가 만든 정확한 ID에만 허용한다.

적용은 공간에 귀속된 원본·관계·설정·파생 자료·요청 결과·진행/보관 검색 메시지와 명시된 효과를 같은 transaction에서 정리한다. 효과가 공간 cascade 뒤 소속 없는 이력으로 남지 않도록 먼저 처리한다. 다른 공간·Auth·계정·개인 설정·기존 소속 없는 효과 이력은 건드리지 않는다. 잔존 0을 확인하고 커밋하며 재실행은 이미 정리된 상태를 확인한다. 잠금 대기는 5초, 문장 실행은 30초로 제한한다.

이는 물리 삭제이며 자동 undo를 제공하지 않는다. 외부 공급자가 처리 중인 요청을 취소하거나 공급자 쪽 자료를 삭제하지도 않는다. 일반 migration·앱 시작·GET에서는 실행하지 않는다.

## 검증 범위

`node --test scripts/workspace-fixture-cleanup.test.mjs scripts/workspace-model-fixture.test.mjs`는 다른 공간 보존·작성자 null·명시 실행/연결 식별·구성원/외부 효과 차단·승인 경계와 새 모델 매핑의 범위를 서비스 없이 검사한다. [실제 DB 검사](../../supabase/tests/database/workspace-fixture-cleanup.actual.test.ts)는 공개 업무 경계에서 만든 자료로 digest 변경 거부·시험 효과 정리·다른 공간과 Auth/개인 설정·분리된 이력 보존·잔존 0·재실행을 확인한다. 실행 lease를 가진 담당자만 명시한 격리 저장소에서 실행한다. 전체 브라우저·HTTP/MCP·복구/경쟁 검증은 [로컬 E2E 기준](../development/verification.md#로컬-e2e-실행-기준)을 따른다.

## 공간을 보존하는 자료 초기화 도구 (#551·#543 공통)

[자료 초기화 모듈](../../scripts/entity-reset.mjs)과 [명시 CLI](../../scripts/entity-reset-cli.mjs)는 공간 전체 fixture 정리와 다르다. 명시한 공간의 **현재 자료 ID 전체**를 대상으로 자료·그 자료 소속 기록·태그/자료 연결·검색 상태/본문 구간·진행/보관 큐를 정리한다. 연결한 할 일은 삭제하지 않고 대상 자료의 `entity_ids`·`entity_context`만 제거하며 버전을 올린다. 해당 종류에 대한 분석·변환·복구 원본과 이를 포함하는 전체 모델 준비 작업은 함께 제거하고 일시적인 `schema_write_locked`만 해제한다. 현재의 종류·게시 정의·발급처·식별자 설정·관계 정의는 보존한다. #543과 호환되지 않는 현재 정의의 전환은 두 변경의 최종 실행 계획에 추가하며, 이 도구가 아직 구현하지 않은 새 정의를 추측해 만들지 않는다.

계정·Auth·세션·개인 설정·공간·멤버십·권한·초대·태그 사전·무관한 할 일/기록을 삭제하지 않는다. 공간 미지정 외부 효과도 해당 원본의 정확한 owner/ID 대응이 확인된 경우에만 처리한다. 출처가 분리된 외부 효과 이력을 계정 기준으로 채택하지 않는다. `running`·`unknown` 등 미결 외부 효과나 완료되지 않은 관련 요청이 있으면 차단하며, 실제 공급자의 결과를 확인하기 전에는 강제로 성공/실패 처리하지 않는다. 도구에는 미결 효과 무시 옵션이 없다.

성공 요청은 **키·fingerprint·completed_at을 보존하고 result만 null로 만료**한다. 기존 `begin_request`의 `result_expired` 응답으로 같은 오래된 요청이 자료를 다시 생성하지 못하게 한다. 관련 자료를 담은 할 일/기록 응답도 만료시키되, 무관한 할 일·공간 요청의 결과는 보존한다. 일반 재시도의 30일 보관 계약은 유지되므로 만료 원장 정리가 끝난 뒤의 키 재사용까지 영구 차단한다고 보장하지 않는다. 적용 구간에 구 클라이언트와 worker를 중단하고 두 변경을 통합한 revision으로만 재개한다.

### 계획 입력과 실행 순서

1. DB·함수·검색/스키마 worker·외부 공급자 호출을 포함한 쓰기를 중단한 유지보수 구간과 접근 제한 백업을 확보한다. loopback도 공유 DB일 수 있으므로 정확한 프로젝트·컨테이너/실행 소유권·host/port/database를 대조한다. 이 CLI는 원격 저장소를 거부하며 운영 적용용 만능 삭제 도구가 아니다.
2. manifest에 `run_id`, 실제 40자리 `source_revision`, `project_id`, `environment: {host,port,database}`, `scopes: [{workspace_id,actor_id,entity_ids}]`를 명시한다. 각 `entity_ids`는 소프트 삭제를 포함해 해당 공간에 존재하는 ID 전체의 정확한 목록이다. 이름/작성자로 추정하지 않는다. `actor_id`는 할 일 연결 제거에 필요한 현행 공간 권한을 가진 실제 실행자다. 일반 DB 제약과 권한 검사를 끄지 않는다. 실제 접속 DB의 system identifier와 database OID도 검토 digest에 포함된다.
3. 비공개 0600 환경 파일에 `LOCAL_DB_URL`과 명시한 `ENTITY_RESET_PROJECT_ID`를 둔다. 기존 개인 환경 파일을 수정하지 않는다. CLI의 체크아웃 HEAD가 manifest revision과 같아야 하며, 출력 파일은 존재하지 않는 별도 경로를 지정한다.
4. `node scripts/entity-reset-cli.mjs --mode=plan --manifest=/absolute/manifest.json --env-file=/absolute/private.env --report=/absolute/plan.json`으로 읽기 전용 repeatable-read 계획을 만든다. 보고서는 테이블별 건수·차단 사유·과거 NULL 소속 전환 조건·보존/전체 digest만 담고 본문·비밀값을 출력하지 않는다. 차단 사유가 있으면 종료 코드 2로 끝낸다. 대상·보존 목록과 백업·재실행 방법을 검토한다.
5. 실제 삭제 지시가 확보된 경우에만 같은 manifest와 보고서로 `node scripts/entity-reset-cli.mjs --mode=apply --manifest=/absolute/manifest.json --env-file=/absolute/private.env --approval=/absolute/plan.json --report=/absolute/applied.json`을 실행한다. 앱·migration·GET은 이 도구를 호출하지 않는다. 적용은 고정 허용 목록의 테이블을 잠그고 READ COMMITTED에서 다시 조사해 승인 digest를 비교한 뒤 한 transaction으로 실행한다. 원본·참조·설정·권한이 바뀌었으면 모두 취소하고 새 계획부터 시작한다. 잠금 대기는 5초, 각 문장은 30초로 제한한다. 잠금은 격리 유지보수 중 다른 공간의 쓰기도 기다리게 할 수 있으므로 평상시 온라인 정리로 사용하지 않는다.
6. 잔존 0과 계정/공간/권한/설정의 보존 digest를 확인하고 커밋한다. 오류는 transaction 전체 rollback이며 자동 undo는 없다. 결과 응답을 잃었으면 **원래 manifest·원래 승인 보고서**로 다시 실행해 `already-clean`을 확인한다. 새 ID를 추가하거나 다른 저장소에 원래 승인을 재사용하지 않는다. 보고서 원문은 비공개 파일로 남기고 서비스 로그에는 mode·차단 건수·digest만 남긴다.
7. #551과 #543을 통합한 revision에서 빈 DB 전체 migration, 기존 구조의 명시 초기화 후 전환, API/웹/MCP 빈 상태, 구 요청/worker/검색 재전달 차단을 검증한다. 두 변경을 위해 기존 저장소를 두 번 초기화하지 않는다. 구현 완료·실제 초기화·운영 적용은 각각 별도 증거다.

### 공간 미지정 과거 행의 명시 처리

#551은 다음 16개 테이블에서 NULL 공간이 하나라도 남으면 자동 삭제 없이 `55000`으로 중단한다. 계획의 `legacy_preconditions`가 그 전환 조건을 따로 보여 준다. NULL 행을 작성자의 현재 공간에 자동 배정하지 않는다.

`legacy_rows: [{table, key}]`는 고정된 16개 테이블의 **정확한 과거 행**을 별도로 지정할 때만 허용한다. `key`에는 당시 owner ID와 아래의 해당 키 구성값을 모두 넣는다. 명시하지 않은 NULL 행이 남으면 계획을 차단한다. Auth·공간·태스크 같은 다른 테이블 이름이나 임의 SQL은 입력할 수 없다. 자료의 과거 연결과 캡처는 정확한 owner+자료 ID로 제거하고, 할 일 소속 과거 기록은 삭제하지 않고 그 캡처만 정리한다. 소속이나 작성자 식별이 불명확한 행은 자동 삭제하지 않고 별도 조사한다.

| 테이블 | owner_id 외에 명시할 과거 키 | #551의 현재 키 |
| --- | --- | --- |
| entities, entity_types, entity_identifier_rules, entity_relation_definitions | id | workspace_id, id |
| entity_schema_versions | type_id, schema_version | workspace_id, type_id, schema_version |
| entity_issuers | code | workspace_id, code |
| entity_type_identity | type_id | workspace_id, type_id |
| entity_type_identity_sources | type_id, code | workspace_id, type_id, code |
| entity_relation_links | definition_id, left_entity_id, right_entity_id | workspace_id와 같은 구성값 |
| data_model_changes, entity_schema_changes, entity_schema_analyses, entity_schema_migrations | id | workspace_id, id |
| data_model_children | model_id, type_ref | workspace_id, model_id, type_ref |
| private.entity_schema_analysis_rows | analysis_id, entity_id | workspace_id, analysis_id, entity_id |
| private.entity_schema_migration_rows | job_id, entity_id | workspace_id, job_id, entity_id |

자료 종류·식별자 종류의 source-qualified 대체 UNIQUE, 모델/작업 계보의 복합 UNIQUE·FK, created_by/initiated_by 계정 참조는 각각의 의미를 유지한다. owner_id는 감사 문맥으로 남을 수 있으며 이름만 보고 삭제하지 않는다. nullable 과거 정의를 지우는 승인과 현재 유효한 설정을 지우는 승인은 다르다. #543의 새 게시 정의 생성은 그 구현·교환 계약과 함께 최종 계획에서 확정한다.

### 이 도구의 검증

`node --test scripts/entity-reset.test.mjs`는 정확한 대상·보존 범위·NULL 행 명시 처리·미결 요청/효과 차단·계획 변경을 검사한다. [실제 DB 검사](../../supabase/tests/database/entity-reset.actual.test.ts)는 공개 유스케이스로 만든 자료·연결된 할 일·변환 작업을 이용해 읽기 전용 계획, stale 승인 거절, 진행/복구 원본 정리, 검색 보관 큐 정리, 미결 가짜 공급자 효과 차단, 공간·할 일·계정/설정 보존, 성공 결과 만료와 재실행을 확인한다. 실제 외부 공급자는 호출하지 않는다. NULL 과거 구조의 전환·DB 카탈로그 증거는 #551의 격리 업그레이드 검사와 함께 확인하며, 현재 PK가 적용된 DB의 검사만으로 과거 구조 전체 전환까지 검증했다고 기록하지 않는다.

2026-10-22의 추가 격리 검증은 새 DB-only 컨테이너의 실제 migration을 공간 도입 직전에서 멈추고 과거 owner 기반 자료·종류·게시 정의·발급처/종류/연결, 할 일과 수행 기록, 자료 변경 기록, 성공 요청을 생성했다. 나머지를 #551 직전까지 적용한 후 미지정 NULL 행의 차단과 key migration의 `55000` 실패를 확인했다. 정확한 7개 과거 행의 명시 계획으로 초기화한 뒤 할 일·수행 기록의 본문/계정 보존, 선택 캡처 제거, 자료 변경 기록 제거, 성공 요청의 키·fingerprint·완료 시각 보존과 결과 만료, `already-clean` 재실행을 확인했으며 이후 실제 `(workspace_id, id)` PK 전환도 성공했다. 커밋된 CLI의 읽기 전용 계획은 없는 공간을 차단했다. 이 검증은 새 시험 자료만 사용했고 전용 컨테이너와 임시 volume을 정확한 ID로 정리했다. 운영 저장소의 초기화 증거로 대신하지 않는다.
