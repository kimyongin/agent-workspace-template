# ADR-0011: Matt Pocock 공유 스킬과 GitHub 작업 정본

- 상태: 채택
- 날짜: 2026-10-05
- 승인 근거: [#96](https://github.com/kimyongin/agent-workspace-template/issues/96)의 원본 중심 전환 합의, [#136](https://github.com/kimyongin/agent-workspace-template/issues/136)의 2026-10-06 잔재 삭제 지시

## 배경

사용자는 Matt Pocock 공식 묶음 전체와 개발 방식을 채택했다. Codex와 Claude가 같은 원본을 사용하며, 기존 자체 절차와 섞인 작업 방식은 현재 파일 트리에서 삭제한다.

## 결정

- 개발 방법은 도입 revision에 고정한 Matt Pocock 공식 27개 스킬과 참고 자료가 소유한다. 출처·revision·라이선스는 [설치 정보](../development/matt-skills.md)에 있다. 원본의 적용 조건과 호출 정책을 유지하며 업데이트는 원본 차이를 검토해 PR로 반영한다.
- `.agents/skills/`가 정본이고 Claude의 발견 경로에는 정본을 읽는 최소 연결만 둔다. 프로젝트 문맥은 제품 의미·아키텍처·디자인·보안·실제 환경·사용자가 명시한 제약을 제공한다. 별도 작업 엔진이나 원본과 중복된 절차를 정의하지 않는다.
- 새 작업과 진행 중 작업은 [GitHub Issues](../agents/issue-tracker.md)가 소유한다. 옛 로컬 티켓·절차·역할 정의·전용 자동화는 삭제한다. 필요한 현행 제품 계약은 담당 정본에 남기고 과거 근거는 Git/GitHub 기록에서 확인한다.
- 제품과 중요한 구조의 결정권 및 대화 합의의 문서 반영은 [ADR-0008](0008-document-ownership.md)을 따른다.
- `main` 직접 푸시 없이 PR을 사용한다. 에이전트는 실제 변경의 독립 Standards/Spec 리뷰와 필수 CI를 확인한 뒤 합의한 변경을 머지할 수 있다. 작업 방법은 원본 implement·implement-spec·code-review·pr 스킬이 담당한다.
- 운영 배포·운영 DB 적용·비용이 드는 작업·비밀값 교체나 폐기·운영 데이터 복구는 사용자가 지시한 범위에서만 실행한다. 스킬 설치와 문서 소유권은 이 실행 권한을 부여하지 않는다.

## 결과

개발 방법의 변경은 원본 스킬에서 검토하며 프로젝트 문서가 같은 방법을 다시 정의하지 않는다. 삭제한 절차를 아카이브·대체 표시·redirect 파일로 존치하지 않는다. 제품 계약과 유효한 제품 검증은 유지한다.
