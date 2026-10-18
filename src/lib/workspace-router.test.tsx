import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, it } from "vitest";
import { Link } from "./workspace-router.tsx";
import {
  WorkspacePathPrefixContext,
  WorkspaceRouteContext,
} from "./workspace-route.tsx";

function links(
  workspace: string | null = "space",
  prefix = true,
  browserPath = "/w/space/tags/record?edit=tag#old",
  panePath = "/tags/record?edit=tag#old",
) {
  return renderToStaticMarkup(
    <WorkspaceRouteContext.Provider value={workspace}>
      <WorkspacePathPrefixContext.Provider value={prefix}>
        <MemoryRouter initialEntries={[browserPath]}>
          <Routes location={panePath}>
            <Route
              path={panePath.startsWith("/manage") ? "manage" : "tags/:scope"}
              element={
                <>
                  <Link to="?">clear</Link>
                  <Link to="">empty</Link>
                  <Link to={{ pathname: "" }}>empty pathname</Link>
                  <Link to="?edit=next#name">query</Link>
                  <Link to="#name">hash</Link>
                  <Link to={{ search: "?edit=next", hash: "#name" }}>
                    object query
                  </Link>
                  <Link to={{ hash: "#name" }}>object hash</Link>
                  <Link to="/workspaces">global</Link>
                  <Link to="/tasks">business</Link>
                  <Link to="/w/other/tasks">explicit other</Link>
                  <Link to="../task">relative</Link>
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </WorkspacePathPrefixContext.Provider>
    </WorkspaceRouteContext.Provider>,
  );
}
function href(html: string, label: string) {
  return html.match(new RegExp(`<a[^>]*href="([^"]*)"[^>]*>${label}</a>`))?.[1];
}
it("query/hash-only destinations retain the explicit workspace and virtual pane path", () => {
  const html = links();
  expect(href(html, "clear")).toBe("/w/space/tags/record");
  expect(href(html, "empty")).toBe("/w/space/tags/record");
  expect(href(html, "empty pathname")).toBe("/w/space/tags/record");
  expect(href(html, "query")).toBe("/w/space/tags/record?edit=next#name");
  expect(href(html, "hash")).toBe("/w/space/tags/record#name");
  expect(href(html, "object query")).toBe(
    "/w/space/tags/record?edit=next#name",
  );
  expect(href(html, "object hash")).toBe("/w/space/tags/record#name");
  expect(href(html, "global")).toBe("/workspaces");
  expect(href(html, "relative")).toBe("/task");
  expect(href(html, "business")).toBe("/w/space/tasks");
  expect(href(html, "explicit other")).toBe("/w/other/tasks");
});
it("account-global and isolated routes do not acquire a workspace prefix", () => {
  for (const html of [links(null), links("space", false)]) {
    expect(href(html, "query")).toBe("/tags/record?edit=next#name");
    expect(href(html, "global")).toBe("/workspaces");
    expect(href(html, "hash")).toBe("/tags/record#name");
    expect(href(html, "empty pathname")).toBe("/tags/record");
  }
});

it("retained virtual panes resolve against their own path rather than the browser foreground", () => {
  const html = links("space", true, "/w/space/entities/foreground?edit=1");
  expect(href(html, "query")).toBe("/w/space/tags/record?edit=next#name");
});

it("workspace management query changes retain the workspace outside the destination whitelist", () => {
  const html = links("space", true, "/w/space/manage", "/manage");
  expect(href(html, "query")).toBe("/w/space/manage?edit=next#name");
});
