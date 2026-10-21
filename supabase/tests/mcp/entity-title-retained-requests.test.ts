import { assert, assertEquals } from "@std/assert";
import { requestIdentity } from "../../functions/_shared/core/shared/request.ts";
import { admin } from "../http/_client.ts";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";
import { claimsOf } from "./_mcp.ts";

activityWorkspaceSuite("title contract retains exact pre-cutover receipts without fresh old writes", async ({ A: token, B: other, workspaceA: w, clientA: client }) => {
  assert(client);
  const owner = String(claimsOf(token).sub);
  const type = (await scopedHttp(token, w, "POST", "/entity-types", { label: "receipt fixture" })).body;
  const change = crypto.randomUUID();
  const oldField = { type: "string", "x-order": 20, "x-show-in-list": true, "x-list-order": 1, "x-representative": false };
  const edits = [{ op: "add_property", client_ref: "historic", field: oldField }];
  const exported = (await scopedHttp(token, w, "GET", "/data-model/export")).body;
  for (const kind of exported.entity_types) {
    delete kind.schema["x-title-template"];
    kind.schema.properties.prop_1["x-representative"] = true;
    kind.schema.properties.prop_1["x-show-in-list"] = true;
  }
  const document = JSON.stringify(exported);
  const modelInput = { document, mode: "update", preview_fingerprint: "a".repeat(64) };
  const cases = [
    { operation: "entity-type.create", target: null, method: "POST", path: "/entity-types", tool: "create_entity_type", toolExtra: {}, raw: { label: "retained explicit", representative_label: "명칭" }, normalized: { label: "retained explicit", icon_id: "box", representative_label: "명칭" }, freshReject: true },
    // The old default differs from the current initial_property_label default even when both outer grammars accept this raw object.
    { operation: "entity-type.create", target: null, method: "POST", path: "/entity-types", tool: "create_entity_type", toolExtra: {}, raw: { label: "retained label only" }, normalized: { label: "retained label only", icon_id: "box", representative_label: "이름" }, freshReject: false },
    { operation: "entity-schema-change.create", target: type.id, method: "POST", path: `/entity-types/${type.id}/schema-changes`, tool: "create_entity_schema_change", toolExtra: { type_id: type.id }, raw: { expected_schema_version: 1, edits }, normalized: { expected_schema_version: 1, edits: [{ ...edits[0], required: false }], migration: { rules: [], overrides: [] } }, freshReject: true },
    { operation: "entity-schema-change.update", target: [type.id, change], method: "PATCH", path: `/entity-types/${type.id}/schema-changes/${change}`, tool: "update_entity_schema_change", toolExtra: { type_id: type.id, change_id: change }, raw: { expected_schema_version: 1, expected_change_version: 1, edits }, normalized: { expected_schema_version: 1, expected_change_version: 1, edits: [{ ...edits[0], required: false }], migration: { rules: [], overrides: [] } }, freshReject: true },
    { operation: "data-model.prepare", target: null, method: "POST", path: "/data-model/changes", tool: "prepare_data_model", toolExtra: {}, raw: modelInput, normalized: { ...modelInput, remove_keys: {} }, freshReject: true },
  ];
  const counts = async () => (await admin`select
    (select count(*) from app.entity_types where workspace_id=${w})::int as types,
    (select count(*) from app.entity_schema_changes where workspace_id=${w})::int as changes,
    (select count(*) from app.data_model_changes where workspace_id=${w})::int as models,
    (select sum(next_property_number) from app.entity_types where workspace_id=${w})::int as properties`)[0];
  const originalCounts = await counts();
  for (const test of cases) {
    const key = crypto.randomUUID();
    const identity = await requestIdentity({ userId: owner, workspaceId: w, request: { key } }, test.operation, test.target, test.normalized);
    const exactResult = { id: crypto.randomUUID(), historical: test.operation, display_properties: [{ key: "prop_1", value: "old result" }] };
    await admin`insert into private.workspace_request_results(executor_id,workspace_id,request_key,operation,fingerprint,footprint,result,completed_at)
      values(${owner},${w},${key},${identity.operation},${identity.fingerprint},'[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb,${admin.json(exactResult)},now()-interval '1 hour')`;
    const [before] = await admin`select * from private.workspace_request_results where executor_id=${owner} and workspace_id=${w} and request_key=${key}`;
    const replay = await scopedHttp(token, w, test.method, test.path, test.raw, key);
    assertEquals(replay.status, test.method === "POST" ? 201 : 200);
    assertEquals(replay.body, exactResult);
    assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
    assertEquals(await scopedTool(client, w, test.tool, { ...test.raw, ...test.toolExtra, request_key: key }), exactResult);
    const changedRaw = test.operation === "entity-type.create" ? { ...test.raw, label: "different" } : test.operation === "data-model.prepare" ? { ...test.raw, document: document + " " } : { ...test.raw, expected_schema_version: 2 };
    const changed = await scopedHttp(token, w, test.method, test.path, changedRaw, key);
    assertEquals(changed.status, 409);
    assertEquals(changed.body.code, "idempotency_key_reused");
    assertEquals((await scopedHttp(other, w, test.method, test.path, test.raw, key)).status, 403);
    if (test.freshReject) assertEquals((await scopedHttp(token, w, test.method, test.path, test.raw)).status, 400);
    const [after] = await admin`select * from private.workspace_request_results where executor_id=${owner} and workspace_id=${w} and request_key=${key}`;
    assertEquals(after, before);
    await admin`update private.workspace_request_results set completed_at=now()-interval '31 days' where executor_id=${owner} and workspace_id=${w} and request_key=${key}`;
    const expired = await scopedHttp(token, w, test.method, test.path, test.raw, key);
    assertEquals(expired.status, 410);
    assertEquals(expired.body.code, "result_expired");
    assertEquals(await counts(), originalCounts);
  }
}, { mcp: true });
