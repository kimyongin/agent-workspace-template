import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TextFields } from "./ContentForm.tsx";

describe("업무 내용 입력", () => {
  it("할 일과 원칙은 제목과 본문만 입력한다", () => {
    const html = renderToStaticMarkup(<TextFields draft={{title:"판단 기준",body:"확인한 근거"}} set={()=>{}} errors={{}}/>);
    expect(html).toContain("판단 기준");
    expect(html).toContain("확인한 근거");
    expect(html).not.toContain("요약");
  });
});
