vi.mock("react-dom", () => ({ createPortal: () => null }));
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModalSamples } from "./ModalSamples.tsx";

it("보기 샘플은 전체 입력 항목과 읽기 전용 번호·0·거짓·태그를 키와 함께 읽는다", () => {
  vi.stubGlobal("document", { body: {} });
  let html: string;
  try { html = renderToStaticMarkup(<ModalSamples />); } finally { vi.unstubAllGlobals(); }
  expect(html).toContain("<dt>상품명</dt><dd>유리컵</dd>");
  expect(html).toContain("<dt>자료 번호</dt><dd>SAMPLE-001</dd>");
  expect(html).toContain("<dt>수량</dt><dd>0</dd>");
  expect(html).toContain("<dt>판매 중</dt><dd>아니요</dd>");
  expect(html).toContain("<dt>메모</dt>");
  expect(html).toContain("<dt>태그</dt>");
  expect(html).toContain("태그 연결");
});
