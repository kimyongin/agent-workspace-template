import { assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken } from "./_mcp.ts";
httpTest("unconfigured relation tools, HTTP routes and candidate inputs are removed", async () => {
  const token = await signIn("A"), client = await connectMcp(await mcpToken(token));
  try {
    const names = (await client.listTools()).tools.map((v) => v.name);
    for (const name of ["list_entity_links", "link_entities", "unlink_entities"]) {
      assertEquals(names.includes(name), false);
      const result = await client.callTool({ name, arguments: { request_key: crypto.randomUUID() } });
      assertEquals(result.isError, true);
    }
    const id = encodeURIComponent("app:10000000-0000-4000-8000-000000000001:legacy");
    assertEquals((await call(token, "GET", `/entities/${id}/links`)).status, 404);
    assertEquals(
      (await call(token, "POST", `/entities/${id}/links`, { other_id: decodeURIComponent(id) }, crypto.randomUUID()))
        .status,
      404,
    );
    assertEquals(
      (await call(token, "POST", `/entities/${id}/links/${id}/delete`, {}, crypto.randomUUID())).status,
      404,
    );
    assertEquals((await call(token, "GET", `/entities?link_candidate_for=${id}`)).status, 400);
  } finally {
    await client.close();
  }
});
