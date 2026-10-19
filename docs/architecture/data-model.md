# 전체 자료 모델 교환

[ADR-0024](../adr/0024-entity-relations-and-data-model.md)의 전체 자료 모델 경계다. 설정 메뉴의 자료 모델에서 JSON 파일 또는 동일 원문으로 가져오기를 검토하고 변경 이력에서 전체 적용한다. 개별 종류의 입력 항목 편집·불변 게시·분석·값 변환·복구는 유지한다.

## 파일 계약

[검증 스키마](../examples/data-model/schema.json), [오픈마켓](../examples/data-model/openmarket.json), [요리](../examples/data-model/cooking.json) 예제를 제공한다. 형식은 `workspace-data-model`, `format_version: 1`이다. 자료 종류는 원래 JSON Schema 2020-12 문서와 종류별 식별 설정을 포함한다. 관계의 두 `ends`는 파일 내 `type_ref`를 참조하며 순서 0/1이 역할이다. 발급처·번호 정의는 `identity_definitions`에 담는다. 실제 업무 자료·개별 연결·기록·인증값은 포함하지 않는다.

모든 종류와 관계는 보관 상태까지 내보낸다. 종류를 보관해도 기존 관계가 자동 보관되지는 않으므로 이 조합도 복사·왕복한다. 시스템 앱 발급처·자동 번호 정의는 대상의 고정 정의를 재사용한다. 파일에는 원본 버전, 검토에는 대상 현재 버전이 별도로 있다. 원본 버전만으로 덮어쓰기 권한을 부여하지 않는다.

## 검토·준비·적용

`export_data_model` / `GET /data-model/export`는 한 PostgreSQL repeatable-read snapshot에서 전체 설정을 읽는다. `preview_data_model` / `POST /data-model/preview`는 인증된 읽기이며 요청 키·이력·정본을 만들지 않는다. 중복 JSON 키·종류별 미지원 정의·잘못된 참조는 위치와 함께 거절한다. 종류별 기존 256 KiB 한도와 전체 묶음 크기는 구분하며 전체 묶음에 기존 개별 원문 2 MiB 한도를 적용하지 않는다.

검토는 전체 차이·종류/속성/번호/관계 대응표와 필요한 값 변환을 반환한다. 신규 종류도 실제 입력 항목 정의와 번호 설정을 펼쳐 확인한다. 관계의 양끝 종류·단일 개수 변경이 현재 연결과 맞지 않으면 연결 개수·양끝 복수 여부와 충돌을 검토에 표시한다. `update`는 불변 ID로 기존 정의를 찾고 파일에서 빠진 정의를 삭제하지 않는다. 처음 가져온 미지 ID는 공간과 원본 불변 ID로 결정한 대상 ID를 사용하며, 같은 원본을 다시 가져와도 그 대상을 찾는다. 원본 prop_n은 예약·삭제 키 재사용 검사를 거쳐 유지한다. 이름이나 원본 별칭으로 동일 대상을 추정하지 않는다. `copy`는 새 종류·속성·관계·필요한 번호 정의를 함께 대응한다. 기존 이름과 충돌하면 검토에 `(복사)` 이름을 명시한다. 이름으로 기존 종류를 자동 병합하지 않는다.

`prepare_data_model` / `POST /data-model/changes`는 정확한 원문과 검토 fingerprint에 결속한 영속 변경안을 만든다. `list_data_model_changes`, `get_data_model_change`로 이력과 상세를 조회한다. `apply_data_model` / `POST /data-model/changes/:id/apply`는 변경안 기대 버전을 검사하고 모든 호환 변경·복사를 같은 transaction에서 확정한다. 자료/설정 기준이 바뀌면 재검토하고 어떤 종류도 부분 적용하지 않는다. 값 변환이 필요한 변경안은 `needs_conversion`으로 보관하며 아래 전체 준비·영속 worker 경계에서 처리한다.

설정 변경 쓰기는 기존 UUID 요청 키와 원장 재현을 사용한다. 준비·적용의 작은 응답 요약과 전체 상세 읽기를 분리해 여러 종류 원문이 기존 요청 결과 1 MiB 한도를 잠식하지 않게 한다. 이력 목록도 같은 요약을 사용하며 독립 상세 조회에서 전체 정의를 읽는다. 목록 cursor는 실행자·현재 공간·목록 범위와 실제 이력 anchor에 결속한다. 상세 조회 실패가 이미 확인한 저장 성공을 실패로 바꾸지 않는다. 같은 키·정확한 원문·기대 버전의 재시도만 당시 결과를 돌려준다.

## 구 계약 전환

개별 자료 설정의 정의 가져오기와 `preview_entity_schema_import`는 종료한다. 이전 `prepare_entity_schema_import`/HTTP prepare 경로는 보존 중인 완료 요청을 원래 operation과 정규화 입력 fingerprint로 조회하는 용도로만 남는다. 새 요청은 전체 모델 도구를 안내하며 거절한다. 종류별 `get_entity_schema`는 읽기와 현재 속성 편집·분석을 위해 계속 사용한다.

## 구현 확장 경계

core/data-model은 문서 해석·대응·검토와 공개 유스케이스를 담당한다. SQL DataModelStore는 일관된 snapshot, 영속 변경안, `publishPreparedModel`을 제공한다. 게시 메서드는 새 UoW나 하위 공개 쓰기를 호출하지 않으며 caller가 소유한 transaction에서 실행된다. 다중 종류 값 변환은 같은 변경안과 준비된 값들을 사용하고, 모든 준비 뒤 최종 모델 게시와 값·기록·검색 의도를 함께 확정해야 한다. 그룹 소속 작업을 단일 종류 worker가 먼저 확정해서는 안 된다.

## 명시한 자료 관계만 사용

자료 사이의 현재 연결은 관계 정의 ID와 양끝 역할을 가진 `entity_relation_links`만 사용한다. 일반 연결 UI·도구·HTTP 경로와 `list_entities.link_candidate_for` 입력은 제공하지 않는다. 관계 정의가 없는 종류 사이를 임의로 연결하거나 과거 연결의 의미를 추정해 정의를 만들지 않는다. 할 일의 선택적 `entity_ids` 참고 자료 지정은 자료 관계 설정과 별개다. 기록은 같은 워크스페이스의 자료 하나 또는 할 일 하나에 고정 소속되며 참고 자료 배열을 갖거나 상속하지 않는다. 소속 대상의 현재 읽기·쓰기 권한을 적용한다.

정의 없는 과거 연결 원본은 전진 migration으로 `private.retired_entity_pairs`에 이동하고 앱·worker·공개 API 역할의 접근을 철회한다. 현재 자료의 물리 정리로 원본이 함께 지워지지 않도록 자료 양끝 FK는 분리하며 계정 삭제 FK는 유지한다. 기존 기록·메모·자료 문맥과 요청 결과를 다시 쓰지 않는다. 현재 분석·변환·복구 참조 기준에서 일반 연결을 제외하므로 이전 기준으로 접수된 작업은 재검토가 필요할 수 있다. 보관 중인 기준 원문과 복구·요청 결과의 기한을 변경해 새 기준에 맞추지 않는다.

## 전체 모델 값 변환

`analyze_data_model` / `POST /data-model/changes/:id/analyze`는 `expected_version`과 각 `type_ref`의 제한된 `migration.rules`·실패 행 `overrides`를 접수한다. 종류별 삭제 키는 준비 단계에서 확인한 의도와 일치해야 한다. 영속 자식 분석은 기존 단일 종류 분석·행 수·준비 바이트·템플릿·원본 참조 검사를 재사용하며, 모든 자식 분석이 성공해야 부모가 `ready`가 된다. 조회는 worker를 실행하거나 상태를 전진시키지 않는다.

`apply_data_model`은 각 자식의 준비 작업을 만들고 부모 `queued`를 반환한다. 독립 worker가 `preparing`에서 값을 준비하고 모든 자식이 준비되면 `ready_to_commit`·`committing`으로 진행한다. 최종 한 transaction에서 모든 원본·템플릿·관계 기준을 재검사한 뒤 종류별 값과 schema, 나머지 모델 정의, 기록·검색 의도를 함께 게시한다. 하나의 자식 확정이 false를 반환하거나 후반 게시가 실패해도 앞선 자식 게시를 포함해 되돌린다. 그룹 소속 자식은 단독 종류 도구나 단독 worker 확정으로 처리할 수 없다.

`cancel_data_model` / `POST /data-model/changes/:id/cancel`은 확정 전 전체 작업을 취소하고 준비 값을 제거한다. `retry_data_model` / `POST /data-model/changes/:id/retry`는 retryable 실패에 한해 같은 자식 작업을 다시 접수한다. 두 명령 모두 기대 버전과 요청 키를 검사한다. 부모·자식 lease와 fence를 함께 검사해 취소·재시도·lease 재접수 전 worker가 늦게 보낸 결과를 거절한다. 원본 변경은 재시도 가능한 일시 오류로 분류하지 않는다. 실패·취소가 복구 원문의 접수 후 보존 기한을 연장하지 않으며 성공한 작업만 확정 시점부터 기존 복구 기한을 적용한다.

명령 응답은 작은 접수 결과이며 `group.children`을 비운다. 자식 분석·준비 상세는 독립 상세 조회로 받는다. 같은 요청 키·정확한 입력의 완료 재현은 나중 상태가 바뀌어도 당시 접수 결과를 반환한다. 웹은 종류별 변환 입력·전체 분석·전체 적용·취소·재시도를 제공하고 페이지 이탈 뒤에도 동일 변경 이력에서 상태를 읽는다.
