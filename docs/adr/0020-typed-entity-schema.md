# ADR-0020: 자료 종류별 JSON Schema와 불변 게시 버전

- 상태: 설계 채택, 구현·검증은 [스펙 #343](https://github.com/kimyongin/agent-workspace-template/issues/343)과 하위 티켓
- 날짜: 2026-10-12
- 승인 근거: #343의 다중 타입·JSONB·schema evolution·아이콘·메뉴 대화 합의

## 배경

고정 prop1~4 컬럼과 화면은 업무 속성을 바꿀 때 코드 수정이 필요했다. 단일 현재 설정 JSON만 덮어쓰면 과거 데이터의 정의와 변경 경쟁을 구분할 수 없다.

## 결정

단일 entities에 entity_type_id와 properties JSONB, 마지막 저장에 적용한 schema_version을 둔다. 사용자별 자료 종류는 label/icon_id/보관 상태와 metadata version을 가진다. 타입별 current schema 포인터와 immutable schema/display 게시 버전을 별도로 보존한다. 생성 이후 자료 종류 변경은 제공하지 않는다. source+external_id는 owner 전체에서 유일하며 자료 종류는 식별자 범위를 나누지 않는다.

정의는 Draft 2020-12 평평한 객체의 제한 집합이다. 텍스트·정수·숫자·날짜·불리언·단일 선택 및 nullable/required/default/길이/범위를 지원한다. Ajv 2020 표준 검증과 실제 calendar date format 검증 위에 제품의 지원 키워드·표시 참조·정밀도를 검사한다. required는 키 존재, null은 별도 허용 규칙이다. 기본값은 생성에서만 명시 적용한다. 서버가 타입별 prop_n을 발급하며 예약된 키는 취소해도 재사용하지 않는다. 순서는 별도 설정이다.

이름·아이콘·보관 상태와 current 포인터는 type version 경쟁을 검사한다. schema_version은 schema와 해당 표시 설정을 식별한다. 데이터 version·entity_identity settings_version·변경안 version·job version·request_key는 서로 대체하지 않는다. HTTP/MCP는 같은 유스케이스와 owner 트랜잭션·요청 원장을 사용한다. 과거 schema는 app_user에게 UPDATE/DELETE 권한을 주지 않는다. 계정 삭제의 소유 자료 정리는 FK cascade로 가능하다.

자료 종류 없음 GET은 읽기만 한다. 명시 create가 최초 필수 대표 텍스트 prop_1과 자료 종류를 원자적으로 만든다. 재료/상품은 격리 검증 예시이며 기본 제품 타입이 아니다. 보관은 기존 자료·관계를 보존하고 신규 등록/복원 등록/연결은 타입 복원 뒤 가능하다. 양방향 관계는 owner와 정규화된 무순서 두 ID의 단일 매핑이며 타입 조합을 제한하지 않는다.

## 최초 자원·복구 한도

공통 정본은 `contracts/entity-type.ts`의 entitySchemaLimits다. 일반 소규모 업무의 수십 속성·수천 자료를 처리하면서 원자적 전환 비용을 한정한다. 최대 타입 64/owner, 속성 64/type, schema+display 합계 64 KiB, properties 64 KiB, 텍스트 4096 Unicode codepoints, 선택 코드 128개다. 정수는 JavaScript safe integer 범위, 숫자는 절댓값 10억 이하·소수점 6자리 이하며 초과값을 반올림하지 않는다. 정수→숫자 확대도 제품 숫자 한도를 벗어나면 호환 변경이 아니다.

변환 대상은 삭제/보관 포함 최대 2000개, 준비 자료의 원본+대상 JSON UTF-8 합계 8 MiB, preview page 최대 100개·실패 sample 최대 20개, 타입별 활성 적용 job 1개다. 원자적 전환 전 한도를 확인하며 준비 동안 긴 DB transaction을 유지하지 않는다. 원본 복구 자료는 성공 시점부터 30일 보존하며 만료 후 복구는 migration_source_expired/410이다. cleanup 지연으로 남은 원본도 만료 이후 반환하지 않는다. 요청 원장 30일과 복구 30일은 목적·저장 자료가 별개다.

변경안 상태 draft/analyzing/ready/stale/invalid/applied/cancelled와 적용 작업 queued/preparing/ready_to_commit/committing/succeeded/failed/cancelled는 별개다. preview는 owner/type/source type·schema version/target definition·plan fingerprint/대상 version 집합에 결속한다. 실제 commit 여부가 불명확하면 조회·조정하며 lease 만료로 실패를 확정하지 않는다. 복구는 새 forward 변경안으로 만들고 현재 수정/관계/식별 변화를 재분석한다.

## 결과

고정 업무 컬럼 배제 결정은 JSON Schema 기반 업무 속성으로 대체한다. 중첩 자유 JSON·타입별 전용 테이블·범용 payload/workflow engine은 만들지 않는다. 타입 설정/버전 첫 경로는 #344, 자료 저장·진화·마이그레이션·동적 화면·관계·초기화는 후속 티켓으로 구현하며 이 문서의 채택은 배포·운영 DB 적용 완료를 뜻하지 않는다. 상위 고정 네 탭 결정은 #343의 프로필+사용자 바로가기 계약으로 대체한다.
