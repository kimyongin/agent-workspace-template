import { assert, assertEquals, assertRejects } from "@std/assert";
import { activityWorkspaceSuite, scopedHttp } from "../http/_workspace-activity-fixture.ts";
activityWorkspaceSuite(
  "unconfigured relation tools, HTTP routes and candidate inputs are removed",
  async ({ A: token, workspaceA: w, clientA: client }) => {
    assert(client);
    const names = (await client.listTools()).tools.map((v) => v.name);
    for (const name of ["list_entity_links", "link_entities", "unlink_entities"]) {
      assertEquals(names.includes(name), false);
      await assertRejects(
        () => client.callTool({ name, arguments: { request_key: crypto.randomUUID() } }),
        Error,
        `Tool ${name} not found`,
      );
    }
    const id = encodeURIComponent("app:10000000-0000-4000-8000-000000000001:legacy");
    assertEquals((await scopedHttp(token, w, "GET", `/entities/${id}/links`)).status, 404);
    assertEquals(
      (await scopedHttp(
        token,
        w,
        "POST",
        `/entities/${id}/links`,
        { other_id: decodeURIComponent(id) },
        crypto.randomUUID(),
      ))
        .status,
      404,
    );
    assertEquals(
      (await scopedHttp(token, w, "POST", `/entities/${id}/links/${id}/delete`, {}, crypto.randomUUID())).status,
      404,
    );
    assertEquals((await scopedHttp(token, w, "GET", `/entities?link_candidate_for=${id}`)).status, 400);
  },
  { mcp: true },
);
