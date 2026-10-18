# 시각 규격

## 적용 방식

[ADR-0025](../adr/0025-shadcn-tailwind-ui.md)에 따라 Tailwind v4와 공식 shadcn/ui를 사용한다. `components.json`의 `radix-nova`·neutral 구성이 출발점이며, 생성된 `src/components/ui/` 소스가 공통 표현을 소유한다. 화면은 공식 부품과 Tailwind 배치 유틸리티로 조합한다. 이전 테마·의미별 CSS 클래스·자체 버튼과 모달 구현을 재현하지 않는다. 컴포넌트 추가·수정은 [공식 개발 스킬](../development/shadcn-skills.md)을 따른다.

## 테마와 색

`src/styles/app.css`의 shadcn 의미 토큰을 사용한다. 현재 진입점은 dark 테마이며 background/foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring, chart, sidebar 계열을 공유한다. 화면마다 원시 색상이나 별도 dark 색을 덮어쓰지 않는다. 상태는 Alert·Badge와 문구로, 선택과 초점은 공식 컨트롤의 상태로 표시한다. 밝은 테마 출하는 별도 검수 범위다.

차트는 공식 Chart와 Recharts를 조합하고 chart 토큰을 사용한다. 단위·기간·누락값·읽기 가능한 표와 요약은 데이터 계약으로 보존한다. 아이콘은 Lucide를 사용하고 저장된 도메인 아이콘 ID는 기존 계약을 유지한다.

## 타이포그래피

기본 글꼴은 패키지로 제공하는 Geist Variable과 한국어 시스템 fallback이다. 외부 폰트 서비스에 연결하지 않는다. 배포에는 [Geist의 SIL OFL 라이선스](../../public/fonts/Geist-LICENSE.txt)를 함께 포함한다. html은 사용자의 기본 글자 크기를 축소하지 않고 개인 배율을 곱한다. 글자·간격은 rem 기반 Tailwind 토큰으로 조절한다. 제목과 본문은 CardTitle·DialogTitle·FieldLabel 등 해당 부품의 역할을 사용하고 임의의 페이지별 덮어쓰기를 피한다. 일반 입력은 모바일에서 읽을 수 있는 크기를 유지한다.

긴 본문은 안전한 MarkdownContent로 표시한다. raw HTML과 위험 URL·외부 이미지 자동 로딩을 차단하고 원문의 줄바꿈을 유지한다. 제목·목록·표·코드는 `app.css`의 문서 의미 스타일로 표현하며 코드·표만 내부 가로 스크롤을 허용한다. 숫자 비교에는 tabular-nums를 사용한다.

## 키–값과 반응형 데이터 그리드

목록은 선택한 표시 속성을, 보기와 편집은 같은 전체 속성을 같은 순서로 제공한다. `DataGrid`·`DataField`의 의미와 label/dt/dd 관계를 유지한다. 키는 muted-foreground, 값은 foreground로 읽는다. 실제 패널의 가용 폭과 rem 기준으로 열을 바꾸고 좁은 폭에서는 세로로 쌓는다. 긴 값은 줄바꿈하며 글자를 줄이거나 전역 overflow 숨김으로 감추지 않는다.

태그는 데이터 영역 마지막에 둔다. 보기는 독립 연결·해제를, 편집은 읽기 전용 Badge를 제공한다. 보기 방식과 반응형 변화가 필드·태그·관계의 범위를 바꾸지 않는다. 테이블은 공식 Table과 머리글 관계를 사용하고 작은 화면의 값도 접근 가능하게 한다.

## 버튼의 문맥과 크기

공식 Button의 default·secondary·outline·ghost·destructive·link variant를 역할에 맞게 선택한다. 저장·실행은 주요 행동, 취소·상세·펼침·보조 작업은 낮은 위계로 표현한다. 이동은 Button asChild 안의 링크, 실행은 버튼으로 제공한다. 입력 안의 조작은 InputGroup으로 조합하고 2–7개 선택은 ToggleGroup을 사용한다. 아이콘 버튼은 접근성 이름을 제공한다.

조작 영역은 최소 44×44 CSS px을 확보하며, rem 배율이 커지면 함께 커진다. 공식 소스의 버튼·입력·선택기·메뉴 행에 이 기준을 적용한다. 작은 표시 면과 별도 투명 버튼을 겹치는 이전 방식은 사용하지 않는다. 처리 중은 Spinner와 disabled·텍스트를 함께 사용한다. 포털로 나간 조작에도 실제 disabled 상태를 전달한다.

## 간격·곡률·크기

공식 컴포넌트의 간격·곡률·타이포그래피를 기본으로 사용한다. 페이지 배치는 flex/grid와 gap, min-w-0, 유연한 열로 구성한다. 같은 역할의 수정은 공통 부품에서 처리한다. 카드에는 Header·Title·Description·Content·Footer를, 폼에는 FieldGroup·Field·FieldLabel·FieldError를 사용한다. 경계는 Separator와 공식 variant로 표현한다.

## 반응형과 레이아웃

탐색은 공식 Sidebar와 모바일 내비게이션, 상세 작업 영역은 Resizable·Tabs·ScrollArea를 조합한다. 좁은 화면의 읽기·편집은 Dialog, 실행 확인·폐기는 Dialog/AlertDialog로 구성한다. 제목·초점 유지·Escape·복귀·미저장 초안 보호는 공통 surface가 소유한다. viewport 변화 중 같은 초안과 읽기 위치를 유지하며 헤더·푸터와 본문 스크롤을 구분한다. Dialog·메뉴 포털의 소유권과 비활성 상태를 함께 검수한다.

개인 배율·사용자 기본 글자·브라우저 확대가 커질 때 필요한 공간을 확보할 수 없으면 같은 기능을 좁은 배치로 제공한다. 레이아웃 전환이 저장 배율의 모바일/데스크톱 선택 기준을 바꾸지 않는다. 가용 높이는 dynamic viewport·safe-area를 고려한다. 상세의 경계·조절 규칙과 초안 수명은 [상호작용 기준](ui-patterns.md#넓은-화면의-상세-작업-영역)을 따른다.

## 목록 보기별 정렬

리스트·카드·표·캘린더는 같은 업무 값과 상세 행동을 제공한다. Item·Card·Table·Calendar를 적극적으로 사용한다. 카드 수와 표 열은 가용 폭에 맞추고 읽기 순서를 유지한다. 선택기는 공식 ToggleGroup으로 제공하며 키보드·터치 상태를 함께 검수한다. Calendar는 loaded-subset·시간대·선택 날짜와 URL 계약을 보존한다.

## 개인 화면 배율

모바일·데스크톱 각각 100%·110%·125%·150%를 저장한다. 물리적인 CSS viewport 폭 1024px 미만은 모바일, 이상은 데스크톱 선택을 사용하며 적용된 배율과 독립적으로 판단한다. `workspace_display_scale`과 `workspace_mobile_display_scale` metadata 계약은 유지한다. 미리보기·저장·실패·취소·계정 변경·다른 탭 갱신의 동작은 [상호작용 기준](ui-patterns.md#페이지와-탐색)을 따른다. Tailwind/shadcn의 rem 기반 크기와 차트 컨테이너를 함께 검수하고 브라우저 확대나 사용자 글자 설정을 제한하지 않는다.
