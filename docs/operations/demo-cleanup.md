# 승인된 데모 자료 초기화

이 절차는 지정한 데모 환경의 승인된 테스트 업무 자료를 한 번 정리하는 관리자 도구다. 일반 배포 migration·앱 시작·GET은 실행하지 않는다. 코드 통합 완료, 초기화 실행, 서버·웹·제품 플러그인 배포 완료를 구분해 해당 스펙 이슈에 증거를 남긴다. 운영 적용은 [배포 가이드](../deployment/release.md)와 사용자의 별도 실행 지시 범위를 따른다.

## 범위와 보존

[정리 도구](../../scripts/demo-cleanup.mjs)는 환경의 이름·DB host/port/database, owner UUID와 삭제할 엔터티·할 일·기록·태그·타입 ID 배열을 모두 요구한다. 빈 배열은 해당 종류를 보존한다. 이름 접두사나 owner 전체를 삭제하는 선택자는 없다. 타입 삭제에는 그 타입의 엔터티 ID도 하나씩 승인해야 한다.

선택한 자료에 속한 양방향 관계, 태그 연결, 타입별 불변 스키마·변경·분석·migration 및 복구 원본, 기록의 검색 구간·색인 상태·외부 효과 원장과 진행/보관 큐를 사전 점검에 표시하고 함께 정리한다. 다른 자료의 참조가 발견되면 범위를 자동 확대하지 않고 차단한다. 참조하는 다른 타입의 스키마, 업무 자료, 관계의 다른 끝점, 태그를 사용하는 다른 자료와 복구 원본도 확인한다.

Auth 사용자·세션·OAuth 연결/클라이언트, 비밀값·환경 파일, 사용자 탐색 설정, 발급처 설정과 무관한 기록 템플릿은 정리 대상이 아니다. 요청 키 tombstone/성공 결과도 보존하여 과거 저장 재시도가 새 생성으로 실행되지 않게 한다. 구 엔터티 변수를 쓰는 테스트 템플릿은 `reset_template_paths`에 `["entity", "create"]` 또는 `["entity_types", "타입 UUID", "update"]`처럼 정확한 행동 경로를 지정해야 제거된다. `record_templates` section의 다른 행동·모델은 유지하며 해당 section 버전만 한 번 증가한다.

## 사전 점검과 실행

다음 manifest는 형식 예시이며 실제 승인 자료가 아니다. 저장소 밖의 비공개 파일에 실행 대상과 승인 ID를 작성한다.

```json
{
  "environment": { "name": "approved-demo", "host": "127.0.0.1", "port": 57922, "database": "postgres" },
  "owner_id": "00000000-0000-4000-8000-000000000001",
  "ids": { "entities": [], "tasks": [], "records": ["승인된 기록 ID"], "tags": [], "entity_types": [] },
  "reset_template_paths": []
}
```

1. 실행 revision과 환경 프로젝트 식별, owner, 실제 승인 ID, 백업 위치·접근 권한·보존/만료 시각을 스펙 이슈에 확정한다. DB 연결 비밀은 shell 기록이나 이슈에 쓰지 않고 관리 환경의 `DEMO_CLEANUP_DATABASE_URL`로 전달한다. 연결 URL은 manifest의 host/port/database와 일치해야 한다.
2. `node scripts/demo-cleanup.mjs /private/path/manifest.json`을 실행한다. 기본값은 읽기 전용 트랜잭션이다. 환경·owner·테이블별 건수·템플릿 경로·차단 참조·승인 digest가 출력되며 본문·키·설정 내용은 출력하지 않는다. 차단 참조가 있으면 승인 범위를 다시 검토한다.
3. 해당 환경의 웹/MCP 쓰기와 검색·스키마 worker를 멈춘 유지보수 구간에 사용자 실행 지시와 사전 점검 digest를 확인한다. `node scripts/demo-cleanup.mjs /private/path/manifest.json --apply APPROVED_DIGEST`를 실행한다. 트랜잭션 안에서 대상 테이블 잠금 후 다시 점검한다. 자료·설정·큐가 달라지면 digest 불일치로 전부 취소된다. 잠금 대기 5초·문장 실행 30초 제한을 넘겨도 전체 취소된다. 성공 시 삭제 대상 잔존 0을 확인한 뒤 커밋한다. 삭제에 쓰는 키는 실제 테이블의 기본 키와 owner 조건을 함께 사용한다.
4. 실제 API 목록·기록 검색, 스키마 migration/recovery 조회, 오래된 검색 메시지 재전달, 오래된 migration fence 재전달과 웹/MCP 새로고침에서 삭제 자료가 재등장하지 않는지 확인한다. 보존한 다른 owner·다른 타입·개인 기록/설정과 Auth/OAuth 연결도 비교한다. 이후 worker·서버를 재개하고 관찰한다.

## 복구와 보존 한계

이 도구는 물리 삭제이며 자동 undo를 제공하지 않는다. 삭제된 migration 원본에는 기존 30일 복구 기능도 적용할 수 없다. 원본·색인·큐의 격리 백업을 사전에 준비하고, 복구할 때 과거 삭제·권한 회수·큐 재전달을 대조한다. 외부 공급자가 이미 처리 중인 요청을 취소하거나 공급자 측 자료를 삭제하지 않는다. worker 중지와 공급자 보존 정책 확인을 실행 범위에 포함한다.

백업 보존 기간은 운영 환경별 승인 manifest/실행 증거에 실제 만료 날짜로 확정한다. 임의의 영구 보존이나 로컬 테스트 산출물을 운영 백업으로 간주하지 않는다. 이 문서의 절차 등록은 운영 삭제 또는 배포 완료 증거가 아니다.

## 검증 범위

`node --test scripts/demo-cleanup.test.mjs`는 공개 계획 경계에서 owner 격리·종속 자료 건수·범위 밖 참조·템플릿 부분 보존·환경 대조·승인 digest 변경을 서비스 없이 검증한다. `node --test scripts/demo-cleanup.integration.mjs`는 격리 환경의 `LOCAL_DB_URL`로 실제 트랜잭션, digest 거부, 다른 owner/계정/개인 자료·설정 보존과 stale 검색 메시지 재전달을 검증한다. 격리 fixture가 만든 계정만 finally에서 정리하며 운영 계정을 시험에 쓰지 않는다. 전체 스펙의 브라우저·HTTP/MCP·복구/경쟁 검증은 [로컬 E2E 기준](../development/verification.md#로컬-e2e-실행-기준)을 따른다.
