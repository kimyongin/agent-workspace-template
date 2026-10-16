import { expect, test } from "vitest";
import { guideConfig } from "./guide-config.ts";
import { navigationSection } from "../../app/navigation-section.ts";

test("업무 목록과 상세 URL은 각자의 탐색에 속한다", () => {
  for (const path of ["/tasks", "/tasks/abc"]) expect(navigationSection(path)).toBe("tasks");
  for (const path of ["/records", "/records/abc"]) expect(navigationSection(path)).toBe("records");
  expect(navigationSection("/entities/abc")).toBe("entities");
  expect(navigationSection("/principles/abc")).toBe(null);
  expect(navigationSection("/search")).toBe("more");
  expect(navigationSection("/settings")).toBe("more");
  expect(navigationSection("/tags/entity")).toBe("more");
  expect(navigationSection("/guide")).toBe("more");
  expect(navigationSection("/tags")).toBe("more");
  expect(navigationSection("/tasks-other")).toBeNull();
});

test("새 앱의 공개 주소에서 같은 서버의 MCP와 설치 문서를 만든다", () => {
  expect(guideConfig("https://example.supabase.co/functions/v1/api/", "https://github.com/owner/app/")).toEqual({
    mcp: "https://example.supabase.co/functions/v1/mcp",
    pluginApp: null,
    pluginDocs: "https://github.com/owner/app/blob/HEAD/plugins/workspace/README.md",
    releaseDocs: "https://github.com/owner/app/blob/HEAD/docs/deployment/release.md#플러그인-패키징과-배포",
  });
  expect(guideConfig("http://127.0.0.1:55421/functions/v1/api").mcp).toBe("http://127.0.0.1:55421/functions/v1/mcp");
});

test("비공개 저장소를 노출하지 않고 명시한 제품 플러그인으로 안내한다", () => {
  const config = guideConfig("https://example.supabase.co/functions/v1/api", undefined, "https://chatgpt.com/plugins/plugin_example");
  expect(config.pluginApp).toBe("https://chatgpt.com/plugins/plugin_example");
  expect(config.pluginDocs).toBeNull();
  for (const value of [undefined, "", "http://example.org/install", "javascript:alert(1)", "https://user:pass@example.org/install", "https://example.org/install?token=x", "https://example.org/install#token"]) {
    expect(guideConfig(undefined, undefined, value).pluginApp).toBeNull();
  }
});

test("미설정·자격 증명·스크립트·잘못된 API 경로를 연결 주소로 제공하지 않는다", () => {
  for (const value of [undefined, "", "javascript:alert(1)", "https://user:pass@example.org/api", "https://example.org/api?token=x", "https://example.org/api#x", "https://example.org/not-api"]) {
    expect(guideConfig(value).mcp).toBeNull();
  }
  expect(guideConfig(undefined, "javascript:alert(1)").pluginDocs).toBeNull();
});
