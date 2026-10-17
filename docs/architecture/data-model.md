# 전체 자료 모델 교환

[ADR-0024](../adr/0024-entity-relations-and-data-model.md)의 전체 자료 모델 경계다. 설정 메뉴의 자료 모델에서 JSON 파일 또는 동일 원문으로 가져오기를 검토하고 변경 이력에서 전체 적용한다. 개별 종류의 입력 항목 편집·불변 게시·분석·값 변환·복구는 유지한다.

## 파일 계약

[검증 스키마](../examples/data-model/schema.json), [오픈마켓](../examples/data-model/openmarket.json), [요리](../examples/data-model/cooking.json) 예제를 제공한다. 형식은 `workspace-data-model`, `format_version: 1`이다. 자료 종류는 원래 JSON Schema 2020-12 문서와 종류별 식별 설정을 포함한다. 관계의 두 `ends`는 파일 내 `type_ref`를 참조하며 순서 0/1이 역할이다. 발급처·번호 정의는 `identity_definitions`에 담는다. 실제 업무 자료·개별 연결·기록·인증값은 포함하지 않는다.

모든 종류와 관계는 보관 상태까지 내보낸다. 종류를 보관해도 기존 관계가 자동 보관되지는 않으므로 이 조합도 복사·왕복한다. 시스템 앱 발급처·자동 번호 정의는 대상의 고정 정의를 재사용한다. 파일에는 원본 버전, 검토에는 대상 현재 버전이 별도로 있다. 원본 버전만으로 덮어쓰기 권한을 부여하지 않는다.

## 검토·준비·적용

`export_data_model` / `GET /data-model/export`는 한 PostgreSQL repeatable-read snapshot에서 전체 설정을 읽는다. `preview_data_model` / `POST /data-model/preview`는 인증된 읽기이며 요청 키·이력·정본을 만들지 않는다. 중복 JSON 키·종류별 미지원 정의·잘못된 참조는 위치와 함께 거절한다. 종류별 기존 256 KiB 한도와 전체 묶음 크기는 구분하며 전체 묶음에 기존 개별 원문 2 MiB 한도를 적용하지 않는다.

검토는 전체 차이·종류/속성/번호/관계 대응표와 필요한 값 변환을 반환한다. 신규 종류도 실제 입력 항목 정의와 번호 설정을 펼쳐 확인한다. 관계의 양끝 종류·단일 개수 변경이 현재 연결과 맞지 않으면 연결 개수·양끝 복수 여부와 충돌을 검토에 표시한다. `update`는 불변 ID로 기존 정의를 찾고 파일에서 빠진 정의를 삭제하지 않는다. 처음 가져온 미지 ID는 소유자와 원본 불변 ID로 결정한 대상 ID를 사용하며, 같은 원본을 다시 가져와도 그 대상을 찾는다. 원본 prop_n은 예약·삭제 키 재사용 검사를 거쳐 유지한다. 이름이나 원본 별칭으로 동일 대상을 추정하지 않는다. `copy`는 새 종류·속성·관계·필요한 번호 정의를 함께 대응한다. 기존 이름과 충돌하면 검토에 `(복사)` 이름을 명시한다. 이름으로 기존 종류를 자동 병합하지 않는다.

`prepare_data_model` / `POST /data-model/changes`는 정확한 원문과 검토 fingerprint에 결속한 영속 변경안을 만든다. `list_data_model_changes`, `get_data_model_change`로 이력과 상세를 조회한다. `apply_data_model` / `POST /data-model/changes/:id/apply`는 변경안 기대 버전을 검사하고 모든 호환 변경·복사를 같은 transaction에서 확정한다. 자료/설정 기준이 바뀌면 재검토하고 어떤 종류도 부분 적용하지 않는다. 값 변환이 필요한 변경안은 `needs_conversion`으로 보관하며 #487의 전체 준비·영속 worker 경계에서 처리한다. 이 단계만으로 전체 스펙을 완료한 것은 아니다.

설정 변경 쓰기는 기존 UUID 요청 키와 원장 재현을 사용한다. 준비·적용의 작은 응답 요약과 전체 상세 읽기를 분리해 여러 종류 원문이 기존 요청 결과 1 MiB 한도를 잠식하지 않게 한다. 이력 목록도 같은 요약을 사용하며 독립 상세 조회에서 전체 정의를 읽는다. 목록 cursor는 소유자·목록 범위와 실제 이력 anchor에 결속한다. 상세 조회 실패가 이미 확인한 저장 성공을 실패로 바꾸지 않는다. 같은 키·정확한 원문·기대 버전의 재시도만 당시 결과를 돌려준다.

## 구 계약 전환

개별 자료 설정의 정의 가져오기와 `preview_entity_schema_import`는 종료한다. 이전 `prepare_entity_schema_import`/HTTP prepare 경로는 보존 중인 완료 요청을 원래 operation과 정규화 입력 fingerprint로 조회하는 용도로만 남는다. 새 요청은 전체 모델 도구를 안내하며 거절한다. 종류별 `get_entity_schema`는 읽기와 현재 속성 편집·분석을 위해 계속 사용한다.

## 구현 확장 경계

core/data-model은 문서 해석·대응·검토와 공개 유스케이스를 담당한다. SQL DataModelStore는 일관된 snapshot, 영속 변경안, `publishPreparedModel`을 제공한다. 게시 메서드는 새 UoW나 하위 공개 쓰기를 호출하지 않으며 caller가 소유한 transaction에서 실행된다. 다중 종류 값 변환은 같은 변경안과 준비된 값들을 사용하고, 모든 준비 뒤 최종 모델 게시와 값·기록·검색 의도를 함께 확정해야 한다. 그룹 소속 작업을 단일 종류 worker가 먼저 확정해서는 안 된다.
