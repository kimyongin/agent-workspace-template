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

it("상태 화면은 네 그래프에서 날짜와 실제 값을 제공하며 중복 날짜별 목록을 표시하지 않는다", () => {
  const data: StatusOverview = {
    timezone: "Asia/Seoul",
    queried_at: "2026-10-10T15:00:00.000Z",
    period: { from: "2026-09-12", to: "2026-10-11", days: 30 },
    entities: { total: 2, active: 1, deleted: 1 },
    tasks: { total: 3, open: 1, done: 1, active: 1, stopped: 0 },
    records: { total: 4, user: 2, result: 1, change: 1 },
    indexing: { total: 4, indexed: 1, preparing: 1, attention: 1, excluded: 1 },
    daily: [{
      date: "2026-10-11",
      entities_created: 2,
      tasks_created: 3,
      once_completed: 1,
      records_created: 4,
      indexing: { indexed: 1, preparing: 1, attention: 1, excluded: 1 },
    }],
  };
  const html = renderToStaticMarkup(<StatusContent data={data} />);
  expect(html.match(/class="status-chart-button"/g)).toHaveLength(4);
  expect(html).toContain("삭제 보관");
  expect(html).toContain("일회성 완료");
  expect(html).toContain("작성일별 현재 색인 상태");
  expect(html).toContain("과거 대기량");
  expect(html).not.toContain("집계 기준과 날짜별 값");
  expect(html).not.toContain('type="range"');
  expect(html).toContain("2026-10-11");
  expect(html).toContain("등록 2건");
  expect(html).toContain("생성 3건 · 일회성 완료 1건");
  expect(html).toContain("작성 4건");
  expect(html).toContain("완료 1건 · 준비 중 1건 · 확인 필요 1건 · 대상 제외 1건");
});

it("색인 문제는 기본 접힘이며 펼치기 전에 문제 제목이나 페이지 조작을 렌더하지 않는다", () => {
  const html = renderToStaticMarkup(<IndexingIssues count={23} />);
  expect(html).toContain("색인 문제 23개");
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("본문 구간");
  expect(html).not.toContain("다음");
});
