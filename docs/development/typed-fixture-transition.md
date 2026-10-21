# 자료 종류 전환의 현재 호출자 검사

#343 전체 통합의 완료 판단은 #351과 부모 이슈의 최종 revision·실행 증거를 따른다. 아래는 호출 계약의 분류이며 운영 배포·초기화 또는 전체 브라우저 성공 선언이 아니다.

## 현재 계약

자료는 `entity_type_id`·현재 `schema_version`·`properties.prop_n`을 제출한다. 속성 키는 서버가 발급하며 종류별 정의를 읽어 의미·라벨·값·제약을 해석한다. `get_entity`는 전체 properties를, 목록·연결 후보는 title/type summary를 반환한다. 편집은 현재 schema_version과 expected_version을 함께 제출하며 생략한 속성은 보존한다. 현재 공간·자료 종류·정의 버전·실행자의 현재 권한 문맥을 다른 공간이나 자료에 재사용하지 않는다. 작성자는 접근 권한의 대체 기준이 아니다.

목록 URL은 `entity_type_id`와 JSON `property_filters`·`sort`를 쓰며 HTTP/MCP 입력은 `filters` 배열을 사용한다. 필터 초기화는 선택한 종류와 검색어를 보존한다. 종류를 바꾸면 속성 조건·정렬·페이지·cursor를 초기화한다. 정렬·조건 요약은 현재 정의의 라벨과 표시값을 사용한다.

실제 E2E의 scalar fixture는 먼저 명시 종류를 만들고 호환 속성 변경안을 분석·게시한 뒤 자료를 저장한다. 브라우저 모의 adapter는 목록 summary와 단건 detail을 구분하고 properties 패치를 병합한 뒤 제목 템플릿으로 title을 갱신한다. 할 일의 자료 연결 문맥은 type·schema_version을 함께 캡처하며, 기록은 자료 또는 할 일 하나의 불변 부모를 유지한다. fixture의 이름 변경은 전체 값·템플릿 제목을 함께 변경한다.

## 보존한 과거 표현

| 위치 | 보존 이유 |
| --- | --- |
| 과거 적용 migration | 적용 이력을 유지하고 후속 migration으로 계약을 바꾼다. |
| entity contract의 `prop1` 거부 검사 | 구 공개 입력이 수락되지 않음을 확인한다. |
| activity change-context의 flat snapshot | 과거 기록의 캡처값을 읽을 수 있음을 확인한다. |
| workspace-screens.detail-navigation의 before/after.prop2 | 당시 저장된 변경 기록의 표시·이전 이동 검사다. |
| workspace-screens.change-targets의 after.prop1 | 당시 대상 이름과 현재 원문을 구별하는 검사다. |
| workspace-screens.record-lifecycle의 before.prop2 | 삭제 대상의 당시 값과 현재 자료의 무변경을 구별한다. |
| EntitiesPage의 prop3_from/prop3_to/prop4 검사 | 구 URL을 지원하는 adapter가 아니라 명시 거부·조건 초기화 처리다. |
| `$엔터티.이후.prop_n$` 템플릿 변수 namespace | 저장된 정본 namespace다. UI는 자료라고 표시하고 표시 라벨을 변수 키로 바꾸지 않는다. |

현재 producer에 prop1~4 평면 입력이나 DTO alias를 제공하지 않는다. 테스트가 오래된 캡처를 만들 때는 캡처의 의미를 유지하며 현재 target DTO와 신규 쓰기는 typed 계약을 쓴다. 개인 자료·문서·환경·설정과 비밀값은 이 전환으로 일괄 수정하지 않는다.

## 통합 검증과 운영 범위

브라우저 설정 목록은 `scripts/e2e-run-plan.mjs`를 정본으로 삼는다. [실행 기준](verification.md)에 등록된 순서로 직렬 실행하며 root가 할당한 실제 설정은 실행 인자의 `--actual-config`로 교체한다. 실제 DB·HTTP·OAuth MCP·브라우저 성공과 메모리 adapter·정적 패키지·문법·단위 검사 성공을 구별한다.

[명시 데모 정리](../operations/demo-cleanup.md)는 환경·공간·승인 ID와 dryrun digest를 기준으로 수행한다. 복구 원본·색인·큐·관계의 의존성을 함께 검사하고 다른 자료로 범위를 확대하지 않는다. Auth/OAuth·개인 설정·무관 템플릿을 보존한다. 이 개발 티켓은 운영 배포·운영 자료 삭제·정기 worker 활성화의 실행 증거가 아니다.
