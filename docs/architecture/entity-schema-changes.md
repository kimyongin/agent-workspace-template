# 자료 종류 속성 변경 계약

속성 변경은 종류별 초안 저장 → 비동기 영향 분석 → 호환 가능한 새 버전 게시로 진행한다. HTTP와 MCP는 같은 유스케이스·Actor 트랜잭션·요청 원장을 사용한다. 조회와 버전 미리보기는 쓰기나 분석 실행을 하지 않는다.

## 제한된 편집

`POST /entity-types/:type_id/schema-changes`는 `expected_type_version`, `expected_schema_version`, `edits`를 받는다. `PATCH .../:change_id`는 추가로 `expected_change_version`을 받는다. 편집은 `add_property(client_ref, field, required)`, `update_property(key, field, required)`, `archive_property(key)`, `restore_property(key)`, `remove_property(key)`, `set_display(display)`만 받는다. 필드 정의는 지원하는 평평한 JSON Schema 집합이며 전체 정의 업로드·키 변경·다른 종류로 이동·코드·URL 실행은 허용하지 않는다.

추가 속성의 키는 종류 행을 잠근 트랜잭션에서 서버가 영구 예약한다. 다른 종류는 같은 prop_n을 사용할 수 있다. 초안에서 추가를 빼도 예약 번호를 회수하지 않는다. 같은 요청 키와 같은 입력은 원래 예약을 반환하며 다른 입력은 충돌한다. 같은 내용의 PATCH는 변경 버전을 올리지 않는다. 실제 변경은 분석 참조를 무효화한다.

보관은 정의와 저장값을 유지한다. 필수 속성을 보관하려면 같은 최종 정의에서 필수를 직접 해제해야 한다. 대표 이름은 항상 활성·필수·nullable이 아닌 일반 텍스트이며 공백만인 이름을 허용하지 않는다. 임시 편집 순서가 아니라 최종 정의를 검사한다. 선택 코드의 null은 nullable 타입과 enum 양쪽에서 허용해야 입력할 수 있다. 날짜는 0001~9999년의 실제 Gregorian 날짜다.

## 정확한 정책과 분석

초안은 해석된 target, 예약, fingerprint와 필드별 before/after·분류·이유·다음 행동을 반환한다. 라벨·설명·표시 순서·선택 속성 추가·필수 해제·제약 확대·선택 코드 추가는 호환 가능하다. 필수화·타입 변환·제약 축소·코드 제거·영구 삭제는 자료 수가 0이어도 값 변환이 필요하다. 정수→숫자는 이전 정수 범위가 제품 숫자 범위 ±10억 안에 있을 때만 호환 가능하다. 대표 이름 불변 조건이 일반 정책보다 우선한다.

`POST .../:change_id/analyze`는 `expected_change_version`과 요청 키를 받아 202로 `type_id/change_id/change_version/analysis_id/status: queued`를 반환한다. 정의·초안·기록 템플릿 버전과 삭제 상태를 포함한 전체 자료 집합·버전·값을 고정하여 durable 분석을 접수한다. 최대 2000개·8 MiB다. 내부 작업자는 50개씩 정의/값 validator를 한 번 컴파일하여 모든 결과를 검증한다. 현재 단계는 값을 변환하지 않으며 생성 기본값을 기존 자료에 채우지 않는다. 분석 상태는 queued/running/succeeded/failed, 변경 상태와 분석 상태는 별개다. succeeded의 failed 수가 양수면 실행할 수 없다.

작업자 claim/결과는 fence와 90초 lease로 결속한다. 오래된 작업자가 새 초안/분석에 결과를 저장할 수 없다. 분석 완료와 GET은 현재 종류·스키마·자료 membership를 대조하여 stale을 반환한다. 분석/GET 응답은 원본 전체 자료를 노출하지 않고 최대 20개 실패 항목만 반환한다. 후속 변환·실패 페이지·실행 작업은 이 변경/분석 식별자를 확장한다.

## 게시와 표시

`POST .../:change_id/apply`는 `expected_change_version`, `analysis_id`, 요청 키를 받는다. 최신 성공 분석·실패 0·동일 소스와 membership·compatible 여부를 같은 종류 잠금 아래 검사한다. 새 불변 정의를 삽입하고 종류의 현재 스키마 포인터와 metadata 버전을 원자적으로 올린다. 기존 자료의 저장값·저장 schema_version·데이터 version·과거 기록은 바꾸지 않는다. 이전 입력 폼은 schema_changed로 초안을 유지한다.

목록/상세/새 연결 capture의 현재 라벨·대표 이름·표시 순서·목록 컬럼·보관 표시는 현재 정의를 사용한다. 저장 schema_version은 마지막 저장 정의의 이력으로 유지한다. 과거 기록의 당시 제목/본문은 다시 쓰지 않는다.

MCP는 `create/get/list/update/analyze/apply_entity_schema_change`를 제공한다. create/update/analyze/apply는 모두 request_key가 필요한 명시 쓰기다. 웹은 발급 전 추가 속성을 저장하여 키를 확인한 뒤 그 키의 대표/목록/선택 라벨 표시를 편집한다. 전송 결과가 불명확하면 동일 요청을 재확인하고, 완료 후 조회 실패는 게시 실패와 구분한다.

현재 전역 자료 기록 템플릿의 유효 속성 참조도 선택한 종류의 target에서 존재하고 활성인지 검사한다. create/update/analyze/apply는 템플릿 설정 잠금과 버전을 확인하며 템플릿 변경은 기존 분석을 stale로 만든다. 종류별 템플릿을 도입할 때 같은 참조 검사에 해당 종류의 effective 템플릿을 공급한다.
