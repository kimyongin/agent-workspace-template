# 상세 작업 공간 상태 전이 검토

검토 범위는 [#285](https://github.com/kimyongin/agent-workspace-template/issues/285)다. `b9ccaa56a36add3882cd6c86bd16f90442dd64e6`의 코드와 기존 검사에서 확인했다. 제품 동작과 검사 interface를 변경하는 설계 승인이 아니라, 후속 판단에 쓰는 근거다.

## 결론

현재 구조를 유지한다. 탭 전이를 여러 hook으로 나누는 변경은 읽기 경로와 실행 순서를 더 늘릴 수 있다. [DetailWorkspace](../../src/features/details/DetailWorkspace.tsx)는 탭·활성 대상·목록 문맥을 한 곳에서 소유하고, 읽기 수명·편집·식별자 교체·패널 크기는 이미 분리되어 있다. 이번 검토에서는 prototype이나 제품 refactor가 필요하지 않았다.

후속으로 반복적인 탭 규칙 변경이 생기면, 탭 열기·선택·닫기·재정렬·식별자 교체와 `returnTo` 정리를 하나의 module 안에서 처리하는 대안을 검토할 수 있다. 승인 조건은 대표 변경의 읽기 범위 감소와 기존 행동 검사의 유지다. 파일 길이나 hook 수는 채택 근거가 아니다. 실제 토큰·수정 시간 절감은 측정하지 않았으므로 개선 수치로 주장하지 않는다.

## 현재 소유권과 관찰 가능한 동작

| 상태·책임 | 현재 소유자와 근거 | 사용자에게 보이는 의미 |
| --- | --- | --- |
| 탭·활성 대상·패널 표시 | DetailWorkspace의 `tabs`, `active`, `visible`, `open`, `select`, `closeTab`, `reorder` | 같은 대상은 기존 탭·편집을 재사용한다. 패널 숨김은 탭 닫기와 다르다. 닫힌 활성 탭은 인접 탭 또는 목록으로 복귀한다. |
| URL·목록 문맥 | DetailWorkspace의 `base`, `ownerList`, location layout effect, `navigateTab` | URL은 활성 상세와 일치한다. 목록의 필터·query·hash는 상세 위치와 별도로 유지한다. 같은 상세의 보기/편집 전환은 새 visit key를 만들고 history entry를 교체한다. |
| 연결 상세의 돌아갈 위치 | DetailWorkspace의 `returnTarget`, `rememberReturn`, `Tab.returnTo`; 모바일 직접 진입은 [detail-exploration](../../src/lib/detail-exploration.tsx)의 trail | 연결 탐색은 최초 상세 하나를 기억한다. 출발 탭을 닫으면 무효 return pointer를 제거한다. 모바일 history trail과 desktop retained tab은 서로 다른 실행 경로다. |
| 초안·guard·busy | 각 폼과 [Modal](../../src/components/Modal.tsx)의 `SurfaceEditor`, `readGuard`; TabContent와 WorkspaceRouteProtection | 숨기거나 다른 탭을 선택해도 폼은 mounted 상태로 남는다. dirty 닫기는 확인하며, 확인 취소는 유지한다. busy일 때 선택·닫기·재정렬·숨김·경로 이동이 차단된다. |
| 상세 읽기·늦은 응답·확정값 | [useDetailResource](../../src/features/details/useDetailResource.ts), [detail-resource](../../src/features/details/detail-resource.ts) | identity별 resource와 취소·generation이 오래된 GET을 버린다. 확정 저장값을 이전 GET이 덮지 않고, 충돌 후 초안 version은 편집 종료 전 갱신하지 않는다. |
| 편집 종료·식별자 교체 | [useDetailEditor](../../src/features/details/useDetailEditor.ts), [useEntityIdentityChange](../../src/features/details/useEntityIdentityChange.ts), [identity-change](../../src/features/details/identity-change.ts), [useDeferredNavigation](../../src/lib/useDeferredNavigation.ts) | 폼과 guard를 제거한 뒤 이동한다. 저장된 새 식별자는 탭과 return pointer를 교체하고 목록 펼침·초점 hash를 옮긴다. |
| 화면 전환·scroll·focus | DetailWorkspace의 `started`, media query, `useWorkspaceScroll`, focus effect; [useWorkspaceResize](../../src/features/details/useWorkspaceResize.ts); ModalShell | 이미 시작한 workspace는 mobile modal 전환에서도 탭 폼을 유지한다. 모바일에서 시작한 열린 native dialog는 넓어진 화면에서도 재부모화하지 않는다. 목록 scroll 소유자가 바뀌면 위치를 옮긴다. |
| 계정 수명 | [App Layout](../../src/app/App.tsx)의 account/logout key와 DetailNavigationProvider의 scope | 로그아웃·사용자 ID 변경은 retained workspace를 다시 mount하고 탐색 snapshot을 분리한다. 계정 간 초안·탭·복귀 정보가 공유되어서는 안 된다. |

`revision`은 저장·편집 종료·닫기 후 목록을 다시 읽게 하는 신호다. 도메인 저장값이나 초안의 정본이 아니다. `current` ref는 콜백이 최신 탭 상태를 읽는 역할이며, 별도 상태 소유자로 취급하면 안 된다. 모드 종료와 식별 교체의 deferred navigation은 단순한 URL 계산 이상의 실행 순서 계약이다.

## 대안과 대표 변경의 읽기 범위

| 대안 | 예상 이득 | 비용·판단 |
| --- | --- | --- |
| 현재 유지 | 탭 규칙의 변경 위치가 하나이며 현재 context interface와 DOM 수명을 보존한다. | URL·guard·focus를 함께 이해해야 한다. 작은 수정은 관련 함수와 검사만 골라 읽는 편이 유리하다. 현재 채택한다. |
| 전이 규칙을 하나의 module로 분리 | 탭 identity·순서·active·return pointer의 일관된 규칙을 같은 곳에서 읽을 수 있다. shell에는 Router/guard/DOM 실행만 남길 여지가 있다. | effect 결과와 실행 순서를 포함한 interface가 필요하다. setter/ref/Router를 그대로 전달하는 wrapper라면 depth가 늘지 않는다. 새 interface와 검사는 별도 합의 후 검토한다. |
| tabs/URL/guard별 hook 분산 | 개별 파일은 짧아진다. | 같은 전이를 여러 hook이 소유하고 의존 순서가 caller로 돌아온다. 읽는 파일 수 증가와 cleanup 경쟁 위험 때문에 권장하지 않는다. |

아래는 실제 코드의 소유권에 따른 읽기 범위 비교다. 분리 대안의 범위는 추정이며 구현·효율 계측 결과가 아니다. 보존 조건을 확인하는 파일은 대안에서도 없어지지 않는다.

| 대표 변경 | 현재 필요한 문맥 | 응집된 분리 시 예상 문맥 | 기존 회귀 위치 |
| --- | --- | --- | --- |
| 탭 선택·재정렬 규칙 | DetailWorkspace의 `open/select/reorder`, DetailTabs, workspace-context; URL/history 영향을 확인할 때 detail-exploration | 전이 module + DetailTabs + shell의 navigation adapter. 규칙을 정리하는 이득은 있으나 UI·busy 검토는 남는다. | detail-workspace의 drag/keyboard reorder, browser history, dirty target 재사용 |
| 활성·비활성 탭 닫기 | `requestClose/closeTab`, TabContent, WorkspaceRouteProtection, Modal의 guard와 focus cleanup | 전이 module + shell의 guard/focus/route 실행 + Modal. 인접 탭 계산만 국소화되고 확인 dialog의 순서까지 읽어야 한다. | inactive dirty tab cancel/discard, hidden draft route protection, last close scroll |
| 식별자 변경 | `navigateTab` rekey와 identityDestination effect, identity-change, useEntityIdentityChange, useDeferredNavigation, 폼의 종료 호출 | 전이 module + shell의 commit 후 이동 + 기존 identity helper. URL·목록 hash·guard 정리를 검증하는 범위는 유지된다. | identity-change 단위 검사와 desktop rekey 행동 검사 |

규칙 변경이 DOM·Router의 순서까지 매번 확장되는 현상이 반복될 때 분리 이득이 생길 가능성이 있다. 현재 자료는 가능성을 보여주며, 작은 interface로 숨길 수 있는 실행 순서와 줄어드는 읽기 문맥을 입증하지는 않는다.

## 후속 변경의 보존 조건과 기존 검사 interface

새 seam을 이번 검토에서 승인하거나 테스트하지 않는다. 브라우저 행동은 [detail-workspace 검사](../../e2e/detail-workspace.spec.ts)의 UI·URL·scroll·focus 관찰이 interface다. 읽기와 식별자 변환은 이미 호출자가 사용하는 `createDetailResource`와 `replaceEntityDetailVisit` interface에서 검증한다.

| 보존 조건 | 기존 근거·검사 | 남는 확인 범위 |
| --- | --- | --- |
| 탭별 draft·edit visit·scroll 유지, hidden dirty tab도 이탈 보호 | drafts survive tab switch/hiding/responsive modal; inactive dirty tab; body scroll; browser history 검사 | 내부 state snapshot 테스트만으로 DOM mount 수명과 guard 등록을 대체할 수 없다. |
| busy 시 이동 금지와 한 번만 discard 확인 | pending writes 검사, Modal guard, identityDestination effect | guard cleanup 뒤 이동하는 순서를 유지한다. 저장의 성공·실패·재시도 의미를 바꾸지 않는다. |
| 늦은 GET·취소 identity가 확정 저장값과 새 identity를 덮지 않음 | [detail-resource.test](../../src/features/details/detail-resource.test.ts)의 5개 검사 | 이 단위 검사는 비동기 resource interface를 검증한다. 계정 변경 시 진행 중 mutation의 결과까지 입증하는 검사는 아니다. |
| 계정 변경·로그아웃에서 탭·초안·snapshot 폐기 | App key/scope; record tabs/logout 검사 | 기존 브라우저 검사는 로그아웃을 다룬다. 다른 계정으로 교체되는 경로와 늦은 mutation의 조합은 후속 refactor에서 기존 UI interface로 확인할 필요가 있다. 현재 성공했다고 주장하지 않는다. |
| desktop/mobile·표시 배율 전환에서 폼 재부모화·초안 손실 없음 | mobile unfinished native editor, resized split draft retention, 150% divider 검사; [display-scale](../../e2e/display-scale.spec.ts) | dialog mode와 focus·scroll ownership을 reducer 값만으로 증명할 수 없다. |
| rekey는 중복 identity를 정리하고 active·return pointer·목록 펼침·Unicode hash를 함께 이전 | [identity-change.test](../../src/features/details/identity-change.test.ts), desktop rekey, related previous 검사 | 현재 rekey 브라우저 검사는 기본 탭 교체를 확인한다. 모든 중복 탭·return pointer 조합을 이미 실행 검증한 것으로 확대하지 않는다. |

후속 구현을 제안하려면 위 행동을 보존한 채 대표 변경 전후의 실제 읽기 경로를 비교하고, 새 interface가 필요할 경우 별도 합의를 받아야 한다. 여러 hook으로 이동한 파일 수 감소나 내부 reducer 테스트 통과만으로 채택하지 않는다. [#270](https://github.com/kimyongin/agent-workspace-template/issues/270)의 검색·설정 초안 소유권은 이번 검토의 재구현 대상이 아니다.

## 검증 범위

검토 revision에서 `vitest run src/features/details/detail-resource.test.ts src/features/details/identity-change.test.ts`의 기존 6개 검사가 통과했다. 브라우저 검사의 정의와 assertion을 대조했으며 이번 문서 변경으로 브라우저 E2E를 다시 실행하지 않았다. 제품 코드 변경이 없어 이 티켓 자체의 E2E는 생략하되, 전체 스펙의 통합 E2E 판단은 [실행 기준](../development/verification.md#로컬-e2e-실행-기준)에 남는다. 이 문서는 실행하지 않은 브라우저·실기기·계정 교체 검증의 성공 증거가 아니다.
