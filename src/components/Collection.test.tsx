import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CollectionItem, CollectionList  } from "./Collection.tsx";
import { RelatedItem } from "./RelatedItems.tsx";

describe("collection data across views", () => {
  it("keeps selected values with their keys in list and cards, including zero", () => {
    for (const view of ["list", "cards"] as const) {
      const html = renderToStaticMarkup(
        <CollectionList view={view} columns={["품명", "수량", "검사"]}>
          <CollectionItem>
            <RelatedItem title="긴 자료 이름" cells={[0, "아니오"]} />
          </CollectionItem>
        </CollectionList>,
      );
      expect(html).toMatch(/<dt[^>]*>품명<\/dt>/);
      expect(html).toMatch(/<dt[^>]*>수량<\/dt>/);
      expect(html).toMatch(/<dd[^>]*>0<\/dd>/);
      expect(html).toMatch(/<dt[^>]*>검사<\/dt>/);
      expect(html).toMatch(/<dd[^>]*>아니오<\/dd>/);
      expect(html.match(/긴 자료 이름/g)).toHaveLength(1);
    }
  });
});

it("table headers remain keys for the same ordered values", () => {
  const html = renderToStaticMarkup(
    <CollectionList view="table" columns={["품명", "수량", "검사"]}>
      <CollectionItem>
        <RelatedItem title="자료 A" cells={[0, "거짓"]} />
      </CollectionItem>
    </CollectionList>,
  );
  expect(html).toContain('<th');
  expect(html).toMatch(/<th[^>]*>수량<\/th>/);
  expect(html).toMatch(/<th[^>]*>검사<\/th>/);
  expect(html.indexOf("자료 A")).toBeLessThan(html.indexOf(">0</td>"));
  expect(html.indexOf(">0</td>")).toBeLessThan(html.indexOf(">거짓</td>"));
});
