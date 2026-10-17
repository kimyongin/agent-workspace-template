import { IndexingIssues } from "./IndexingIssues.tsx";
import { expect, it, vi } from "vitest";
vi.mock("../../lib/api.ts", () => ({
  api: () => {
    throw new Error("collapsed list must not fetch");
  },
}));
import { renderToStaticMarkup } from "react-dom/server";
import { StatusContent } from "./StatusContent.tsx";
import type { StatusOverview } from "@contracts/status.ts";

const data: StatusOverview = {
  timezone: "Asia/Seoul",
  queried_at: "2026-10-10T15:00:00.000Z",
  period: { from: "2026-09-12", to: "2026-10-11", days: 30 },
  entities: { total: 2, active: 1, deleted: 1 },
  tasks: { total: 3, open: 1, done: 1, active: 1, stopped: 0 },
  records: { total: 4, user: 2, result: 1, change: 1 },
  indexing: {
    total: 4,
    indexed: 1,
    preparing: 1,
    attention: 1,
    excluded: 1,
    waiting: { long_waiting: 1, oldest_waiting_since: "2026-10-10T14:00:00.000Z", threshold_minutes: 15 },
  },
  daily: [{
    date: "2026-10-11",
    entities_created: 2,
    tasks_created: 3,
    once_completed: 1,
    records_created: 4,
    indexing: { indexed: 1, preparing: 1, attention: 1, excluded: 1 },
  }],
};

it("상태 화면은 네 그래프에서 날짜와 실제 값을 제공하며 중복 날짜별 목록을 표시하지 않는다", () => {
  const html = renderToStaticMarkup(<StatusContent data={data} />);
  expect(html.match(/날짜별 수치"/g)).toHaveLength(4);
  expect(html).toContain("삭제 보관");
  expect(html).toContain("일회성 완료");
  expect(html).toContain("작성일별 현재 색인 상태");
  expect(html).toContain("과거 대기량");
  expect(html).toContain("<dt>갱신 지연 기준</dt><dd>15분</dd>");
  expect(html).toContain("<dt>오래 갱신되지 않은 기록</dt><dd>1개</dd>");
  expect(html).toContain("실패로 확정된 상태는 아닙니다");
  expect(html).toContain("관리자에게 색인 서비스 점검");
  expect(html).not.toContain("집계 기준과 날짜별 값");
  expect(html).not.toContain('type="range"');
  expect(html).toContain("2026-10-11");
  expect(html).toContain("2개");
  expect(html).toContain('<time dateTime="2026-10-11">2026-10-11</time>');
  expect(html).toMatch(/>등록<\/th>.*?>2건<\/td>/);
  expect(html).toMatch(/>일회성 완료<\/th>.*?>1건<\/td>/);
  expect(html).toMatch(/>대상 제외<\/th>.*?>1건<\/td>/);
});

it("색인 문제는 기본 접힘이며 펼치기 전에 문제 제목이나 페이지 조작을 렌더하지 않는다", () => {
  const html = renderToStaticMarkup(<IndexingIssues count={23} />);
  expect(html).toContain("색인 문제 23개");
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("본문 구간");
  expect(html).not.toContain("다음");
});

it("날짜 자료가 없으면 날짜나 수치를 만들어 내지 않고 빈 상태를 표시한다", () => {
  const html = renderToStaticMarkup(<StatusContent data={{ ...data, daily: [] }} />);
  expect(html.match(/표시할 날짜가 없습니다./g)).toHaveLength(4);
  expect(html).not.toContain("날짜별 수치");
  expect(html).not.toContain("NaN");
  expect(html).not.toContain("Invalid Date");
});

it("0건과 큰 수치를 정확히 읽을 수 있고 색인 상태를 서로 합치지 않는다", () => {
  const large = structuredClone(data);
  large.daily[0].entities_created = 1234567;
  large.daily[0].indexing = { indexed: 0, preparing: 3, attention: 12, excluded: 4 };
  const html = renderToStaticMarkup(<StatusContent data={large} />);
  expect(html).toMatch(/>등록<\/th>.*?>1,234,567건<\/td>/);
  expect(html).toMatch(/>완료<\/th>.*?>0건<\/td>/);
  expect(html).toMatch(/>준비 중<\/th>.*?>3건<\/td>/);
  expect(html).toMatch(/>확인 필요<\/th>.*?>12건<\/td>/);
  expect(html).toMatch(/>대상 제외<\/th>.*?>4건<\/td>/);
});
