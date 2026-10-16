# 과거 스키마에서의 업그레이드 검증

이 디렉터리는 특정 predecessor 스키마에서 실행하는 검사다. 현재 스키마의 `test:db`와 분리한다. 적용된 과거 migration을
바꾸거나 사용 중인 로컬·운영 DB를 reset하지 않는다.

사용자 원칙 기능 제거의 빈 DB·기존 자료 업그레이드는 `scripts/remove-principles-upgrade.integration.mjs`가 검사한다.
`LOCAL_DB_URL`에 loopback 로컬 DB를 지정하면 별도 임시 DB에서 원칙 데이터 삭제·다른 자료 보존·최종 계약을 검증하고
자신의 임시 DB만 제거한다.
