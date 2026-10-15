import { assertEquals } from "@std/assert";
import { requestIdentity } from "../../functions/_shared/core/shared/request.ts";
import { admin, call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

httpTest("retired schema writes only replay exact retained success through HTTP and MCP", async () => {
  const token = await signIn("A"), other = await signIn("B"), client = await connectMcp(await mcpToken(token));
  const owner = JSON.parse(atob(token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/"))).sub;
  const key = crypto.randomUUID();
  let id: string | undefined;
  try {
    const created = (await call(token, "POST", "/entity-types", { label: "retained " + key })).body;
    id = created.id;
    const input = { expected_type_version: 1, label: "retained historic result" };
    const oldResult = { ...created, label: input.label, version: 2, schema_version: 1 };
    const identity = await requestIdentity({ userId: owner, request: { key } }, "entity-type.update", id, input);
    await admin`insert into private.request_results(owner_id,request_key,operation,fingerprint,result,completed_at)
      values(${owner},${key},${identity.operation},${identity.fingerprint},${
      admin.json(oldResult)
    },now()-interval '1 hour')`;
    const [before] =
      await admin`select completed_at,result from private.request_results where owner_id=${owner} and request_key=${key}`;
    const replay = await call(token, "PATCH", `/entity-types/${id}`, input, key);
    assertEquals(replay.status, 200);
    assertEquals(replay.body, oldResult);
    assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
    assertEquals(await tool(client, "update_entity_type", { type_id: id, ...input, request_key: key }), oldResult);
    assertEquals((await call(token, "GET", `/entity-types/${id}`)).body, created);
    assertEquals((await call(token, "GET", `/entity-types/${id}/schemas`)).body.items.length, 1);
    assertEquals((await call(token, "PATCH", `/entity-types/${id}`, input)).status, 400);
    assertEquals((await call(other, "PATCH", `/entity-types/${id}`, input, key)).status, 400);
    const changed = await call(token, "PATCH", `/entity-types/${id}`, { ...input, label: "different old intent" }, key);
    assertEquals(changed.status, 409);
    assertEquals(changed.body.code, "idempotency_key_reused");
    const [after] =
      await admin`select completed_at,result from private.request_results where owner_id=${owner} and request_key=${key}`;
    assertEquals(after, before);
    await admin`update private.request_results set completed_at=now()-interval '31 days' where owner_id=${owner} and request_key=${key}`;
    const expired = await call(token, "PATCH", `/entity-types/${id}`, input, key);
    assertEquals(expired.status, 410);
    assertEquals(expired.body.code, "result_expired");
  } finally {
    await client.close();
    await admin`delete from private.request_results where owner_id=${owner} and request_key=${key}`;
    if (id) await admin`delete from app.entity_types where id=${id}`;
  }
});
