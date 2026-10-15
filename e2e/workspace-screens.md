# 작업 공간 화면 검사 찾기

화면 변경의 관련 검사를 고를 때 아래 파일을 선택한다. [설정](workspace-screens.config.ts)은 `screens` 프로젝트와 기존 viewport 반복을 실행한다. 실제 DB·계정 대신 [기존 API 자료](support/workspace-api.ts)와 화면별 page/context를 사용하며, [준비 함수](support/workspace-screens.ts)는 자료·페이지 준비와 기존 조작만 공유한다.

| 사용자 행동 | 파일 |
| --- | --- |
| 빈 결과 복구·선택 후보·자료 식별·반복 일정의 업무 흐름 | [ux-clarity](workspace-screens.ux-clarity.fixture.ts) |
| 변경 확인·삭제 메모/태그·반복 업무 중단/재개 | [confirmation](workspace-screens.confirmation.fixture.ts) |
| 변경 대상의 당시 문맥·현재 조회·삭제와 실패 구분 | [change-targets](workspace-screens.change-targets.fixture.ts) |
| 초안·uncertain 재시도/폐기·busy·직접 링크 보호 | [draft-protection](workspace-screens.draft-protection.fixture.ts) |
| 상세 보기/편집·관련 탐색·닫기와 처음 목록 복귀 | [detail-navigation](workspace-screens.detail-navigation.fixture.ts) |
| 엔터티 관계·연결 검색·IME·추가/해제·늦은 응답 | [relations](workspace-screens.relations.fixture.ts) |
| 연결 기록/할 일의 회차·페이지·귀속 작성 | [related-records](workspace-screens.related-records.fixture.ts) |
| 문서 본문·markdown·표·스크롤·변경 정보 표시 | [content-display](workspace-screens.content-display.fixture.ts) |
| 폭별 시각 위계·shell/reflow·공통 카드·필터 정렬 | [responsive-layout](workspace-screens.responsive-layout.fixture.ts) |
| 목록 조건·검색·날짜/시간대·cursor·scroll/초점 복원 | [list-restoration](workspace-screens.list-restoration.fixture.ts) |
| 엔터티/기록/원칙/태그 작성·편집·삭제·snapshot 보존 | [record-lifecycle](workspace-screens.record-lifecycle.fixture.ts) |

예를 들어 관계를 바꾸면 해당 파일로 발견 목록과 실행 범위를 확인한다.

```sh
npm run test:e2e -- --config=e2e/workspace-screens.config.ts e2e/workspace-screens.relations.fixture.ts --list
npm run test:e2e -- --config=e2e/workspace-screens.config.ts e2e/workspace-screens.relations.fixture.ts
```

전체 작업 공간 화면 검사는 파일 인자를 빼고 같은 설정으로 실행한다. `test:e2e:all`에도 이 설정이 포함된다. 설정의 worker 3과 retries 0, 기본 실제 API 설정의 worker 1을 유지한다. 다른 fixture 설정은 공유 포트가 있어 순차 실행한다. 본문에 직접 설정하는 폭·계정 시간대·응답 실패 변이를 파일 선택 후 추가로 확인한다. 누적 변경의 E2E 판단과 실행 증거는 [실행 환경](../docs/development/verification.md#로컬-e2e-실행-기준) 및 해당 스펙 이슈에 남긴다.
