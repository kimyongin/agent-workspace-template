import { assert, assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";
import { httpEntityFixture } from "../http/_entity.ts";
httpTest("entity pairs HTTP↔MCP: reverse replay, endpoint list/unlink and candidate scope", async () => {
  const token = await signIn("A"), foreign = await signIn("B"), client = await connectMcp(await mcpToken(token));
  try {
    const schema = await httpEntityFixture(token), suffix = crypto.randomUUID();
    const x = (await call(token, "POST", "/entities", {
      ...schema,
      source: "app",
      external_id: `pair-x-${suffix}`,
      properties: { prop_1: `연결 원점 ${suffix}` },
    })).body;
    const y = (await call(token, "POST", "/entities", {
      ...schema,
      source: "app",
      external_id: `pair-y-${suffix}`,
      properties: { prop_1: `연결 상대 ${suffix}` },
    })).body;
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of ["list_entity_links", "link_entities", "unlink_entities"]) assert(names.includes(name));
    const key = crypto.randomUUID();
    const created = await call(token, "POST", `/entities/${encodeURIComponent(x.id)}/links`, {
      other_id: y.id,
      expected_version: 1,
      expected_other_version: 1,
    }, key);
    assertEquals(created.status, 200);
    assert(created.body.changed);
    const replay = await tool(client, "link_entities", {
      id: y.id,
      other_id: x.id,
      expected_version: 1,
      expected_other_version: 1,
      request_key: key,
    });
    assertEquals(replay, created.body);
    assertEquals(
      (await tool(client, "list_entity_links", { id: y.id, limit: 20 })).items.map((e: { id: string }) => e.id),
      [x.id],
    );
    assertEquals((await call(foreign, "GET", `/entities/${encodeURIComponent(x.id)}/links`)).status, 404);
    assertEquals(
      (await tool(client, "list_entities", { link_candidate_for: x.id, keyword: suffix, limit: 20 })).items,
      [],
    );
    const unlinkKey = crypto.randomUUID();
    const removed = await tool(client, "unlink_entities", {
      id: y.id,
      other_id: x.id,
      expected_version: 2,
      expected_other_version: 2,
      request_key: unlinkKey,
    });
    assert(removed.changed);
    const reverse = await call(
      token,
      "POST",
      `/entities/${encodeURIComponent(x.id)}/links/${encodeURIComponent(y.id)}/delete`,
      { expected_version: 2, expected_other_version: 2 },
      unlinkKey,
    );
    assertEquals(reverse.body, removed);
    assertEquals(reverse.headers.get("Idempotency-Replayed"), "true");
    assertEquals((await tool(client, "list_entity_links", { id: x.id, limit: 20 })).items, []);
    const noop = await tool(client, "unlink_entities", {
      id: x.id,
      other_id: y.id,
      expected_version: 3,
      expected_other_version: 3,
      request_key: crypto.randomUUID(),
    });
    assertEquals(noop.changed, false);
    const candidate = await call(
      token,
      "GET",
      `/entities?link_candidate_for=${encodeURIComponent(x.id)}&keyword=${suffix}&limit=20`,
    );
    assertEquals(candidate.body.items.map((e: { id: string }) => e.id), [y.id]);
  } finally {
    await client.close();
  }
});
