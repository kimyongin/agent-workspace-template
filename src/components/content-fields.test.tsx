import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TextFields } from "./ContentForm.tsx";

// Static text rendering has no auth or data requests.
vi.mock("../lib/api.ts", () => ({ api: vi.fn(), ApiError: Error, query: vi.fn() }));

describe("업무 내용 입력", () => {
  it("할 일은 제목과 본문만 입력한다", () => {
    const html = renderToStaticMarkup(<TextFields draft={{title:"판단 기준",body:"확인한 근거"}} set={()=>{}} errors={{}}/>);
    expect(html).toContain("판단 기준");
    expect(html).toContain("확인한 근거");
    expect(html).not.toContain("요약");
  });
});
