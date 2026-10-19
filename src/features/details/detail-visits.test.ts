import { expect, it } from "vitest";
import type { Location } from "../../lib/workspace-router.tsx";
import { createDetailVisits } from "./detail-visits.ts";

const at = (path: string, key: string, state: unknown = null): Location => {
  const url = new URL(path, "https://workspace.invalid");
  return { pathname: url.pathname, search: url.search, hash: url.hash, key, state };
};

it("reselects a retained detail without restarting its editor, but an explicit same-address mode change starts a new visit", () => {
  const list = at("/entities?type=material", "list");
  const route = at("/entities/material~flour?edit=1", "edit");
  const destinations: string[] = [];
  const visits = createDetailVisits(list, path => { destinations.push(path); });
  visits.acceptRoute(route, "PUSH", true);
  const retained = visits.snapshot().tabs[0].location;

  visits.open(route.pathname, list);
  expect(visits.snapshot().tabs[0].location).toBe(retained);
  expect(destinations).toEqual([]);

  visits.navigateTab(route.pathname, "?edit=1");
  expect(visits.snapshot().tabs[0].location.key).not.toBe(retained.key);
  expect(visits.snapshot().tabs[0].location.search).toBe("?edit=1");
  expect(destinations).toEqual(["/entities/material~flour?edit=1"]);
});

it("closing a selected related detail retains the other visit and transfers its URL only after its guard can unmount", () => {
  const list = at("/entities?type=material", "list");
  const root = at("/entities/material~flour", "root");
  const related = at("/tasks/mix", "related", { workspaceReturnTo: root.pathname });
  const destinations: string[] = [];
  const visits = createDetailVisits(list, path => { destinations.push(path); });
  visits.acceptRoute(root, "PUSH", true);
  visits.acceptRoute(related, "PUSH", true);
  visits.close(related.pathname);
  expect(visits.snapshot().tabs.map(tab => tab.id)).toEqual([root.pathname]);
  expect(visits.snapshot().active).toBe(root.pathname);
  expect(destinations).toEqual([]);
  visits.transferRoute();
  expect(destinations).toEqual([root.pathname]);
  visits.transferRoute();
  expect(destinations).toEqual([root.pathname]);
});

it("related visits keep only their starting detail, and closing that detail removes its return links without moving the selected visit", () => {
  const list = at("/entities", "list"), root = at("/entities/material~flour", "root");
  const destinations: { path: string; state: unknown }[] = [];
  const visits = createDetailVisits(list, (path, options) => { destinations.push({ path, state: options?.state }); });
  visits.acceptRoute(root, "PUSH", true);
  visits.navigateTab(root.pathname, "/tasks/mix");
  const task = at("/tasks/mix", "task", destinations[0].state);
  visits.acceptRoute(task, "PUSH", true);
  visits.navigateTab(task.pathname, "/records/result");
  visits.acceptRoute(at("/records/result", "record", destinations[1].state), "PUSH", true);
  expect(visits.snapshot().tabs.map(tab => tab.returnTo)).toEqual([undefined, root.pathname, root.pathname]);

  destinations.length = 0;
  visits.close(root.pathname);
  visits.transferRoute();
  expect(visits.snapshot().active).toBe("/records/result");
  expect(visits.snapshot().tabs.map(tab => tab.returnTo)).toEqual([undefined, undefined]);
  expect(destinations).toEqual([]);
});

it("closing a detail's edit mode refreshes the retained list once and history selection preserves the existing visit", () => {
  const list = at("/entities?type=material#row-flour", "list");
  const route = at("/entities/material~flour?edit=1", "edit");
  const destinations: string[] = [];
  const visits = createDetailVisits(list, path => { destinations.push(path); });
  visits.acceptRoute(route, "PUSH", true);
  visits.navigateTab(route.pathname, route.pathname);
  const viewer = visits.snapshot().tabs[0].location;
  expect(visits.snapshot().revision).toBe(1);
  visits.acceptRoute(at(route.pathname, "router-viewer"), "REPLACE", true);
  expect(visits.snapshot().tabs[0].location).toBe(viewer);
  visits.acceptRoute(list, "POP", true);
  visits.acceptRoute(at(route.pathname, "history-viewer"), "POP", true);
  expect(visits.snapshot().tabs[0].location).toBe(viewer);
  expect(visits.snapshot().base).toBe(list);
  expect(destinations).toEqual([route.pathname]);
});

it("a completed creation drops only its creation intent and last close returns to the retained list context", () => {
  const list = at("/entities?type=material&create=1&filters=1#row-flour", "list");
  const destinations: string[] = [];
  const visits = createDetailVisits(list, path => { destinations.push(path); });
  visits.acceptRoute(at("/entities/material~flour", "created"), "PUSH", true);
  expect(visits.snapshot().base.search).toBe("?type=material&filters=1");
  expect(visits.snapshot().base.hash).toBe("#row-flour");
  visits.close("/entities/material~flour");
  visits.transferRoute();
  expect(visits.snapshot().active).toBeNull();
  expect(destinations).toEqual(["/entities?type=material&filters=1#row-flour"]);
});

it("replacing the owner context cancels a queued departure from the old detail", () => {
  const visits = createDetailVisits(at("/entities", "list"), path => { destinations.push(path); });
  const destinations: string[] = [];
  visits.acceptRoute(at("/entities/material~flour", "detail"), "PUSH", true);
  visits.close("/entities/material~flour");
  visits.reset(at("/workspaces", "outside"));
  visits.transferRoute();
  expect(visits.snapshot().tabs).toEqual([]);
  expect(destinations).toEqual([]);
});

it("selecting the current retained visit cancels a different pending visit instead of treating it as a redundant selection", () => {
  const list = at("/entities", "list"), root = at("/entities/material~flour", "root");
  const destinations: string[] = [];
  const visits = createDetailVisits(list, path => { destinations.push(path); });
  visits.acceptRoute(root, "PUSH", true);
  visits.open("/tasks/mix", root);
  visits.open(root.pathname, list);
  expect(destinations).toEqual(["/tasks/mix", root.pathname]);
  expect(visits.snapshot().tabs[0].location).toBe(root);
});
