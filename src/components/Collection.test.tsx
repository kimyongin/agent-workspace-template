import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CollectionList } from "./Collection.tsx";
import { RelatedItem } from "./RelatedItems.tsx";

describe("collection data across views", () => {
  it("keeps selected values with their keys in list and cards, including zero", () => {
    for (const view of ["list", "cards"] as const) {
      const html = renderToStaticMarkup(
        <CollectionList view={view} columns={["품명", "수량", "검사"]}>
          <li>
            <RelatedItem title="긴 자료 이름" cells={[0, "아니오"]} />
          </li>
        </CollectionList>,
      );
      expect(html).toContain("<dt>품명</dt>");
      expect(html).toContain("<dt>수량</dt>");
      expect(html).toContain("<dd>0</dd>");
      expect(html).toContain("<dt>검사</dt>");
      expect(html).toContain("<dd>아니오</dd>");
      expect(html.match(/긴 자료 이름/g)).toHaveLength(1);
    }
  });
});

it("table headers remain keys for the same ordered values", () => {
  const html = renderToStaticMarkup(
    <CollectionList view="table" columns={["품명", "수량", "검사"]}>
      <li>
        <RelatedItem title="자료 A" cells={[0, "거짓"]} />
      </li>
    </CollectionList>,
  );
  expect(html).toContain('role="columnheader">품명');
  expect(html).toContain('role="columnheader">수량');
  expect(html).toContain('role="columnheader">검사');
  expect(html.indexOf("자료 A")).toBeLessThan(html.indexOf(">0</span>"));
  expect(html.indexOf(">0</span>")).toBeLessThan(html.indexOf(">거짓</span>"));
});
