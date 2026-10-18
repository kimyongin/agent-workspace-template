import { assert, assertEquals } from "@std/assert";
import { requestIdentity } from "../../functions/_shared/core/shared/request.ts";
import { admin } from "../http/_client.ts";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";
import { claimsOf } from "./_mcp.ts";

activityWorkspaceSuite(
  "retired schema writes only replay exact retained success through HTTP and MCP",
  async ({ A: token, B: other, workspaceA: w, workspaceB: otherW, clientA: client }) => {
    assert(client);
    const owner = String(claimsOf(token).sub);
    const key = crypto.randomUUID();

    const created = (await scopedHttp(token, w, "POST", "/entity-types", { label: "retained " + key })).body;
    const id = created.id;
    const input = { expected_type_version: 1, label: "retained historic result" };
    const oldResult = { ...created, label: input.label, version: 2, schema_version: 1 };
    const identity = await requestIdentity(
      { userId: owner, workspaceId: w, request: { key } },
      "entity-type.update",
      id,
      input,
    );
    await admin`insert into private.workspace_request_results(executor_id,workspace_id,request_key,operation,fingerprint,footprint,result,completed_at)
      values(${owner},${w},${key},${identity.operation},${identity.fingerprint},'[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb,${
      admin.json(oldResult)
    },now()-interval '1 hour')`;
    const [before] =
      await admin`select completed_at,result from private.workspace_request_results where executor_id=${owner} and workspace_id=${w} and request_key=${key}`;
    const replay = await scopedHttp(token, w, "PATCH", `/entity-types/${id}`, input, key);
    assertEquals(replay.status, 200);
    assertEquals(replay.body, oldResult);
    assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
    assertEquals(
      await scopedTool(client, w, "update_entity_type", { type_id: id, ...input, request_key: key }),
      oldResult,
    );
    assertEquals((await scopedHttp(token, w, "GET", `/entity-types/${id}`)).body, created);
    assertEquals((await scopedHttp(token, w, "GET", `/entity-types/${id}/schemas`)).body.items.length, 1);
    assertEquals((await scopedHttp(token, w, "PATCH", `/entity-types/${id}`, input)).status, 400);
    assertEquals((await scopedHttp(other, otherW, "PATCH", `/entity-types/${id}`, input, key)).status, 400);
    const changed = await scopedHttp(token, w, "PATCH", `/entity-types/${id}`, {
      ...input,
      label: "different old intent",
    }, key);
    assertEquals(changed.status, 409);
    assertEquals(changed.body.code, "idempotency_key_reused");
    const [after] =
      await admin`select completed_at,result from private.workspace_request_results where executor_id=${owner} and workspace_id=${w} and request_key=${key}`;
    assertEquals(after, before);
    await admin`update private.workspace_request_results set completed_at=now()-interval '31 days' where executor_id=${owner} and workspace_id=${w} and request_key=${key}`;
    const expired = await scopedHttp(token, w, "PATCH", `/entity-types/${id}`, input, key);
    assertEquals(expired.status, 410);
    assertEquals(expired.body.code, "result_expired");
  },
  { mcp: true },
);
