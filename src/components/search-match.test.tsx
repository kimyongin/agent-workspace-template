import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchMatch } from "./SearchMatch.tsx";

it("attention indexing is labeled separately from waiting and keeps the keyword match readable", () => {
  const html = renderToStaticMarkup(<SearchMatch item={{ match: "keyword", index_state: "failed" }} />);
  expect(html).toContain("확인 필요");
  expect(html).toContain("키워드");
  expect(html).not.toContain("색인 대기");
});
