import { assert, assertEquals } from "@std/assert";
import { call } from "../http/_client.ts";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";
import { claimsOf } from "./_mcp.ts";

activityWorkspaceSuite(
  "issuer HTTP/MCP parity: policy impacts, workspace isolation, unused deletion and logical replay",
  async ({ A: a, B: b, workspaceA: w, workspaceB: otherW, clientA: client }) => {
    assert(client);
    const source = `cleanup_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;

    const created = await scopedHttp(a, w, "POST", "/entity-types", { label: `발급처 정리 ${crypto.randomUUID()}` });
    assertEquals(created.status, 201);
    const typeId = created.body.id;
    // Removing a source assignment is a definition change affecting this kind;
    // settings authority alone never grants its business WRITE permission.
    const current = await call(a, "GET", `/workspaces/${w}`);
    assertEquals(current.status, 200);
    assertEquals(
      (await call(a, "PATCH", `/workspaces/${w}/members/${claimsOf(a).sub}`, {
        expected_version: current.body.membership_version,
        grants: [...current.body.grants, { target_kind: "entity_type", target_id: typeId, access: "write" }],
      })).status,
      200,
    );
    assertEquals(
      (await scopedHttp(a, w, "POST", "/entity-issuers", { code: source, label: "오등록 검사" })).status,
      201,
    );
    const rule = await scopedTool(client, w, "create_entity_identifier_rule", {
      source,
      label: "상품 번호",
      meaning: "상품 한 등록 건",
    });
    const initial = (await scopedHttp(a, w, "GET", `/entity-types/${typeId}/identity`)).body;
    const sources = [
      ...initial.sources.map((s: { code: string; rule_id: string; active: boolean }) => ({
        code: s.code,
        rule_id: s.rule_id,
        active: s.active,
      })),
      { code: source, rule_id: rule.id, active: true },
    ];
    const identity = await scopedTool(client, w, "update_entity_type_identity", {
      type_id: typeId,
      label: "상품 번호",
      default_source: source,
      expected_version: initial.version,
      sources,
    });
    const stop = { active: false, expected_version: 1 };
    const refused = await scopedHttp(a, w, "PATCH", `/entity-issuers/${source}`, stop);
    assertEquals(refused.status, 400);
    assertEquals(refused.body.code, "invalid_input");
    assertEquals(refused.body.fields, [{ path: `default_types.${typeId}`, message: created.body.label }]);
    assertEquals(await scopedTool(client, w, "update_entity_issuer", { code: source, ...stop }), {
      error: refused.body,
    });
    assertEquals(
      (await scopedHttp(b, otherW, "DELETE", `/entity-identifier-rules/${rule.id}`, { expected_version: 1 })).status,
      404,
    );
    const linked = await scopedHttp(a, w, "DELETE", `/entity-identifier-rules/${rule.id}`, { expected_version: 1 });
    assertEquals(linked.status, 400);
    assertEquals(linked.body.code, "invalid_input");
    const detached = await scopedTool(client, w, "update_entity_type_identity", {
      type_id: typeId,
      label: identity.label,
      default_source: "app",
      expected_version: identity.version,
      sources: sources.filter((s) => s.code === "app"),
    });
    assertEquals(detached.version, identity.version + 1);
    const ruleKey = crypto.randomUUID();
    const removed = await scopedHttp(
      a,
      w,
      "DELETE",
      `/entity-identifier-rules/${rule.id}`,
      { expected_version: 1 },
      ruleKey,
    );
    assertEquals(removed.status, 200);
    assertEquals(removed.body, { deleted: true });
    assertEquals(
      await scopedTool(client, w, "delete_entity_identifier_rule", {
        rule_id: rule.id,
        expected_version: 1,
        request_key: ruleKey,
      }),
      { deleted: true },
    );
    const issuerKey = crypto.randomUUID();
    assertEquals(
      await scopedTool(client, w, "delete_entity_issuer", {
        code: source,
        expected_version: 1,
        request_key: issuerKey,
      }),
      { deleted: true },
    );
    const replay = await scopedHttp(a, w, "DELETE", `/entity-issuers/${source}`, { expected_version: 1 }, issuerKey);
    assertEquals(replay.status, 200);
    assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
    assertEquals((await call(null, "DELETE", "/entity-issuers/app", { expected_version: 1 })).status, 401);
    const registry = (await scopedHttp(a, w, "GET", "/entity-issuers")).body;
    const app = registry.items.find((issuer: { code: string; version: number }) => issuer.code === "app");
    assertEquals(
      (await scopedHttp(a, w, "DELETE", "/entity-issuers/app", { expected_version: app.version })).body.code,
      "invalid_input",
    );
  },
  { mcp: true },
);
