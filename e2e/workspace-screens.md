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
| 회차 오류·기간 재조회·기록 편집의 소속 조회 복구·초안/초점 유지 | [recovery-context](workspace-screens.recovery-context.fixture.ts) |
| 연결 기록/할 일의 회차·페이지·귀속 작성 | [related-records](workspace-screens.related-records.fixture.ts) |
| 문서 본문·markdown·표·스크롤·변경 정보 표시 | [content-display](workspace-screens.content-display.fixture.ts) |
| 폭별 시각 위계·shell/reflow·공통 카드·필터 정렬 | [responsive-layout](workspace-screens.responsive-layout.fixture.ts) |
| 목록 조건·검색·날짜/시간대·cursor·scroll/초점 복원 | [list-restoration](workspace-screens.list-restoration.fixture.ts) |
| 엔터티/기록/태그 작성·편집·삭제·사건 정보 보존 | [record-lifecycle](workspace-screens.record-lifecycle.fixture.ts) |

예를 들어 관계를 바꾸면 해당 파일로 발견 목록과 실행 범위를 확인한다.

```sh
npm run test:e2e -- --config=e2e/workspace-screens.config.ts e2e/workspace-screens.relations.fixture.ts --list
npm run test:e2e -- --config=e2e/workspace-screens.config.ts e2e/workspace-screens.relations.fixture.ts
```

전체 작업 공간 화면 검사는 파일 인자를 빼고 같은 설정으로 실행한다. `test:e2e:all`에도 이 설정이 포함된다. 설정의 worker 3과 retries 0, 기본 실제 API 설정의 worker 1을 유지한다. 다른 fixture 설정은 공유 포트가 있어 순차 실행한다. 본문에 직접 설정하는 폭·계정 시간대·응답 실패 변이를 파일 선택 후 추가로 확인한다. 누적 변경의 E2E 판단과 실행 증거는 [실행 환경](../docs/development/verification.md#로컬-e2e-실행-기준) 및 해당 스펙 이슈에 남긴다.

## 상세 창의 업무 흐름과 폭 검사

[responsive-layout](workspace-screens.responsive-layout.fixture.ts)의 `shell` 검사는 다음 책임을 나눈다. 다른 반응형 검사와 시각 조사, 나머지 기능 파일은 그대로 실행한다. 창 폭과 글자 확대·CSS zoom은 다른 축이므로 기존 확대 검사를 이 반복으로 대체하지 않는다.

| 기존 보호 | 현재 검사 |
| --- | --- |
| 8개 폭에서 긴 제목·150회 본문, 48rem/viewport 폭·높이·네 모서리, 본문 스크롤 뒤 닫기 노출 | `shell resize`에서 320/360/390/639/640/768/1024/1440px 읽기 창을 직접 검사한다. 본문이 실제로 스크롤되는지도 확인한다. |
| 편집 창 하나, Tab·확인창 닫기·미저장 폐기 확인 | `shell 390px`, `shell 1440px`에서 전체 흐름을 실행한다. `shell resize`는 모든 8개 폭의 편집 창 개수·입력 초안·초점을 확인한다. |
| 기록 메모와 폭별 확인창 캡처 | `shell resize`에서 같은 확인창의 메모를 8개 폭에서 유지한다. 390/1440px 캡처는 전체 흐름이, 나머지 6개 폭은 resize 검사가 생성한다. 기존 8개 폭을 항상 캡처하며 선택 해제 기본값은 없다. |
| 예상하지 않은 오류·쓰기를 만들지 않는 조회/취소 | 세 검사 모두 오류와 쓰기 0건을 확인한다. |

```sh
npm run test:e2e -- --config=e2e/workspace-screens.config.ts e2e/workspace-screens.responsive-layout.fixture.ts --workers=1 --grep 'shell ' --list
npm run test:e2e -- --config=e2e/workspace-screens.config.ts e2e/workspace-screens.responsive-layout.fixture.ts --workers=1 --grep 'shell '
```

이 분리는 8개 독립 준비를 대표 흐름 2개와 폭 전환 1개로 바꾼다. 발견 사례 수 감소 자체를 성능 개선이나 회귀 보호의 증명으로 보지 않는다. 캡처는 자동 이미지 비교가 아니며, 산출물을 직접 열어 시각 검수한다. 실제 API의 인증·권한·저장·웹/MCP 왕복과 운영 빌드 CSS·하위 경로 검사는 이 정리에서 제외한다.

## 2026-10-22 관측

제품 소스가 같은 `fa723db1` 전후를 worker 1개로 순차 실행했다. 변경 후 검증한 소스는 `abf9c6a0`이며 fixture와 이 문서만 바뀌었다. 두 명령 모두 새 Vite/browser를 시작하고, 설치된 같은 버전의 의존성과 기존 캐시를 보존했다. 두 실행에서 글꼴 HTTP 200을 확인했다.

| 관측 | 변경 전 | 변경 후 |
| --- | ---: | ---: |
| 전체 실제 결과 | 315건 통과 | 310건 통과 |
| 전체 명령 경과 | 641.891초 | 634.626초 |
| 자식 트리 최대 표본 RSS | 2612416KiB | 2636976KiB |
| 상세 창 검사 시간 합계 | 8.916초 | 5.325초 |
| 항상 생성하는 전체 캡처/API 시간 | 295회 / 11.624초 | 295회 / 11.435초 |
| 상세 창 캡처/API 시간 | 8회 / 0.436초 | 8회 / 0.374초 |

전체 실행은 각각 실패·재시도·제외가 0건이었다. 나머지 307건의 파일·제목·프로젝트 목록은 정확히 같고, 상세 창 8건을 위 책임의 3건으로 바꿨다. 캡처 수는 줄이지 않았다. 전체 경과는 준비·발견·검사·종료를 포함하며, 표의 검사/API 시간은 그 안의 구성 비용이므로 더하지 않는다. 변경 후에는 확인창 애니메이션이 끝난 뒤 캡처하므로 해당 대기는 전체·검사 시간에 포함되고 캡처 API 시간에는 포함되지 않는다. 이 차이를 캡처 처리 속도 개선으로 해석하지 않는다.

한 쌍의 warm 관측이며 캐시 내용이 동일하거나 전체 성능 향상이 반복된다는 증거가 아니다. 전체 시간 차이를 상세 창 변경만의 효과로 돌리지 않으며, 최대 RSS 표본은 오히려 조금 늘었다. RSS는 runner와 현재 자손의 합을 1초마다 읽은 KiB 값으로 Docker/VM·부모로부터 분리된 프로세스와 순간 peak를 포함하지 않고 공유 페이지를 중복 계산할 수 있다. 이전 부분 실행과 focused 검사가 캐시를 데울 수 있으며 캐시 초기화는 하지 않았다.

원본 로그·발견 목록·자원 표본·캡처 비용·제외한 부분 시도는 `/private/tmp/workspace-548-paired-20261022/`에 보존했다. 다른 짧은 DB 검사와 겹친 최초 before 및 캡처 내용 보완 전의 초기 after는 비교에서 제외했다. 임시 CSS로 창을 150vw로 만든 공개 기하 RED는 원래 폭 제한에서 320px 이하 예상/480px 관측으로 실패했고, fault 제거 후 세 검사가 통과했다. 임시 fault는 최종 소스에 없다.

320/639/640/1440px의 원본과 변경 후 확인창을 직접 열어 메모·버튼 노출과 639/640px 배치 전환을 검수했다. 변경 전 일부 캡처의 시작 애니메이션 겹침을 피하도록 안정화한 검사 변경이며 제품 화면 개선은 아니다. 이 관측 뒤에 합친 다른 통합 변경의 전체 E2E와 실제 API·운영 빌드 CSS 검증은 별도로 판단한다.
