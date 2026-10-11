import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusContent } from "./StatusContent.tsx";
import type { StatusOverview } from "@contracts/status.ts";

it("상태 화면은 네 그래프, 실제 개수와 날짜별 값, 집계 한계를 제공한다", () => {
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
  expect(html.match(/role="img"/g)).toHaveLength(4);
  expect(html).toContain("삭제 보관");
  expect(html).toContain("일회성 완료");
  expect(html).toContain("작성일별 현재 색인 상태");
  expect(html).toContain("과거 대기량");
  expect(html).toContain("삭제된 할 일·기록");
  expect(html).toContain("날짜별 값");
  expect(html).toContain('type="range"');
  expect(html).toContain("2026-10-11");
});
