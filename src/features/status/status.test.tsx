import { IndexingIssueRows, IndexingIssues } from "./IndexingIssues.tsx";
import { expect, it, vi } from "vitest";
vi.mock("../../lib/api.ts", () => ({
  createScopedApi: () => () => {
    throw new Error("collapsed list must not fetch");
  },
}));
import { MemoryRouter } from "react-router";
import { WorkspaceRouteContext } from "../../lib/workspace-route.tsx";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusContent } from "./StatusContent.tsx";
import type { StatusOverview } from "@contracts/status.ts";

const data: StatusOverview = {
  timezone: "Asia/Seoul",
  queried_at: "2026-10-10T15:00:00.000Z",
  period: { from: "2026-09-12", to: "2026-10-11", days: 30 },
  entities: { total: 2, active: 1, deleted: 1 },
  tasks: { total: 3, open: 1, done: 1, active: 1, stopped: 0 },
  records: { total: 4, result: 3, change: 1 },
  indexing: {
    total: 4,
    indexed: 1,
    preparing: 1,
    attention: 1,
    excluded: 1,
    waiting: { long_waiting: 1, oldest_waiting_since: "2026-10-10T14:00:00.000Z", threshold_minutes: 15 },
  },
  entity_indexing: {
    total: 9, indexed: 2, preparing: 3, attention: 4, excluded: 0,
    waiting: { long_waiting: 2, oldest_waiting_since: "2026-10-10T13:00:00.000Z", threshold_minutes: 15 },
  },
  daily: [{
    date: "2026-10-11",
    entities_created: 2,
    tasks_created: 3,
    once_completed: 1,
    records_created: 4,
    indexing: { indexed: 1, preparing: 1, attention: 1, excluded: 1 },
    entity_indexing: { indexed: 2, preparing: 3, attention: 4, excluded: 0 },
  }],
};

it("상태 화면은 다섯 그래프에서 날짜와 실제 값을 제공하며 중복 날짜별 목록을 표시하지 않는다", () => {
  const html = renderToStaticMarkup(<StatusContent data={data} />);
  expect(html.match(/날짜별 수치"/g)).toHaveLength(5);
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
  expect(html.match(/표시할 날짜가 없습니다./g)).toHaveLength(5);
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


it("기록과 자료 색인은 단위·일별 현재 상태·갱신 지연을 구분한다", () => {
  const html = renderToStaticMarkup(<StatusContent data={data} />);
  expect(html).toContain('aria-label="기록 색인 현황"');
  expect(html).toContain('aria-label="자료 색인 현황"');
  expect(html).toContain("전체 기록 4개");
  expect(html).toContain("전체 자료 9개");
  expect(html).toContain("등록일별 현재 자료 색인 상태");
  expect(html).toContain('<dt>오래 갱신되지 않은 자료</dt><dd>2개</dd>');
  expect(html).toMatch(/>수행 결과<\/dt><dd[^>]*>3<\/dd>/);
  expect(html).not.toContain(">일반<");
  const entities = html.split('aria-label="자료 색인 현황"')[1];
  expect(entities).toMatch(/>확인 필요<\/th>.*?>4건<\/td>/);
  expect(entities).toContain("Asia/Seoul");
});

it("안전하게 보존한 선택 날짜는 새로운 조회 자료에서 선택하고 기간 밖이면 보정한다", () => {
  const html = renderToStaticMarkup(<StatusContent data={{ ...data, daily: [
    { ...data.daily[0], date: "2026-10-10", entities_created: 7 }, data.daily[0],
  ] }} selectedDates={{ "일별 등록": "2026-10-10" }} />);
  const entities = html.split('aria-label="자료 현황"')[1].split('aria-label="할 일 현황"')[0];
  expect(entities).toContain('dateTime="2026-10-10"');
  expect(entities).toContain("7건");
});

it("혼합 색인 문제는 종류를 구분하고 현재 공간의 원문으로 이동한다", () => {
  const base = { id: "20261010-G123ABCD", created_at: "2026-10-10T00:00:00Z", title: "같은 제목", reason: "provider_unknown" as const,
    attempts: 1, chunks: { total: 1, succeeded: 0, preparing: 0, unknown: 1, failed: 0 } };
  const html = renderToStaticMarkup(<MemoryRouter><WorkspaceRouteContext.Provider value="current-workspace">
    <IndexingIssueRows items={[
      { ...base, kind: "record", path: "/records/20261010-G123ABCD" },
      { ...base, id: "app:00000000-0000-4000-8000-000000000001:20261010-G123ABCD", kind: "entity", path: "/entities/app%3A00000000-0000-4000-8000-000000000001%3A20261010-G123ABCD" },
    ]} expanded={["record:20261010-G123ABCD", "entity:app:00000000-0000-4000-8000-000000000001:20261010-G123ABCD"]} onToggle={() => {}} id="problems" />
  </WorkspaceRouteContext.Provider></MemoryRouter>);
  expect(html).toContain('href="/w/current-workspace/records/20261010-G123ABCD"');
  expect(html).toContain('href="/w/current-workspace/entities/app%3A00000000-0000-4000-8000-000000000001%3A20261010-G123ABCD"');
  expect(html).toContain("기록 원문");
  expect(html).toContain("자료 원문");
  expect(html).toContain('id="problems-record-20261010-G123ABCD"');
  expect(html).toContain('id="problems-entity-app:00000000-0000-4000-8000-000000000001:20261010-G123ABCD"');
});
