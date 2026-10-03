// 실제 사용자 자료가 아닌 평가 전용 한국어 자료. 본문은 임베딩 요청에 넣지 않는다.
export const documents = [
  { id: "long-book", title: "긴 책 읽기 원칙", summary: "300쪽을 넘는 책은 평일에 시작하지 않고 휴가 때 읽는다. 집중할 시간이 확보된 경우에만 긴 책을 고른다.", body: "여름 휴가 목록의 관리 코드는 오로라-731이다." },
  { id: "ebook", title: "전자책 선택 원칙", summary: "이동 중 읽을 짧은 책은 전자책으로 구매한다. 종이책은 집에서 천천히 읽을 때 선택한다.", body: "독서기 모델은 가람-928이다." },
  { id: "study", title: "한국어 공부 계획", summary: "한국어 어휘를 매일 아침 20분 복습한다. 단어를 문장 속에서 사용하고 지난 오답을 먼저 확인한다.", body: "" },
  { id: "approval", title: "예산 승인 전 구매 보류", summary: "고가 장비는 예산 승인을 받은 뒤 구매한다. 승인이 아직 없으면 결제를 보류하며 가격 비교만 진행한다.", body: "보류한 장비의 주문 번호는 다온-642이다." },
  { id: "small-purchase", title: "소액 소모품 구매 기록", summary: "승인된 월 예산 안에서 프린터 종이와 펜을 구매했다. 배송 예정일을 확인하고 지출 내역을 기록했다.", body: "" },
  { id: "meeting", title: "고객 미팅 후 기록", summary: "고객과 납품 일정을 논의했다. 이번 주 금요일까지 시안을 보내고 고객 확인 뒤 제작을 시작하기로 했다.", body: "" },
  { id: "backup", title: "백업 복원 연습", summary: "백업이 생성됐다는 표시만 믿지 않고 격리 환경에서 복원해 확인한다. 복구한 데이터의 최신성과 누락 여부를 대조한다.", body: "" },
  { id: "privacy", title: "비밀값 보관 원칙", summary: "API 키와 데이터베이스 비밀번호는 로컬 비밀 설정에 보관한다. 채팅·Git·브라우저 번들에는 넣지 않는다.", body: "" },
  { id: "exercise", title: "운동 회차 기록", summary: "오늘 아침 30분 걷기를 마쳤다. 비가 오면 실내 운동으로 바꾸고 통증이 있으면 쉬기로 했다.", body: "" },
  { id: "garden", title: "화분 물주기 계획", summary: "흙이 말랐을 때만 화분에 물을 준다. 비 오는 날에는 습도를 확인하고 과도하게 물을 주지 않는다.", body: "" },
];

export const calibration = [
  { query: "두꺼운 책은 언제 읽기로 했지?", relevant: "long-book" },
  { query: "예산 허가가 안 난 비싼 장비를 바로 결제해도 될까?", relevant: "approval" },
  { query: "복구가 실제로 되는지 확인하는 절차", relevant: "backup" },
  { query: "고객 시안 전달 후 생산 시작 조건", relevant: "meeting" },
  { query: "어휘와 오답을 반복해서 학습하는 일정", relevant: "study" },
  { query: "토성의 고리에서 얼음 입자의 크기는 얼마인가?", relevant: null },
  { query: "프랑스 혁명의 발발 연도는 언제인가?", relevant: null },
  { query: "피타고라스 정리의 증명을 알려줘", relevant: null },
  { query: "스페인 수도의 인구 통계", relevant: null },
  { query: "고래가 초음파를 내는 원리", relevant: null },
];

// 이 질문들은 임계값 선택에 쓰지 않는다.
export const validation = [
  { query: "버스에서 읽을 짧은 책을 어떤 형식으로 사지?", relevant: "ebook" },
  { query: "인증 키를 어디에 두고 어떤 곳에는 올리지 말아야 할까?", relevant: "privacy" },
  { query: "오늘 수행한 산책의 결과를 확인해줘", relevant: "exercise" },
  { query: "흙이 젖어 있는 식물에 또 물을 줘도 될까?", relevant: "garden" },
  { query: "사무실 종이와 필기구에 지출한 내역", relevant: "small-purchase" },
  { query: "해왕성의 대기 성분과 공전 주기", relevant: null },
  { query: "삼각함수의 덧셈 공식 유도", relevant: null },
  { query: "고대 이집트 피라미드의 건축 연대", relevant: null },
  { query: "남극 펭귄의 번식 생태", relevant: null },
  { query: "인도네시아 화산의 지질학적 형성 원리", relevant: null },
];

export const bodyOnly = [
  { query: "오로라-731", relevant: "long-book" },
  { query: "가람-928", relevant: "ebook" },
  { query: "다온-642", relevant: "approval" },
];

const fill = (pattern, length) => [...pattern.repeat(length)].slice(0, length).join("");
export const boundaries = [
  { name: "korean", text: `${fill("가힣한글", 100)}\n${fill("한글검색품질", 300)}` },
  { name: "emoji", text: `${fill("😺🚀🌈", 100)}\n${fill("🧑‍💻👩‍👩‍👧‍👦", 300)}` },
  { name: "combining", text: `${fill("e\u0301각", 100)}\n${fill("e\u0301각", 300)}` },
  { name: "unspaced", text: `${fill("abcdefghijklmnopqrstuvwxyz", 100)}\n${fill("abcdefghijklmnopqrstuvwxyz", 300)}` },
  { name: "query-200", text: fill("한글😺e\u0301", 200), inputType: "query" },
];
