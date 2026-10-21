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
    const initial = (await scopedHttp(a, w, "GET", `/entity-types/${typeId}/schema`)).body;
    const property = initial.schema["x-identity-property"], appKind = "00000000-0000-4000-8000-000000000001";
    const publish = async (allowed: string[], defaultKind: string) => {
      const document = await scopedTool(client, w, "export_data_model", {});
      const target = document.entity_types.find((type: { schema: Record<string, unknown> }) =>
        type.schema["x-type-id"] === typeId
      );
      assert(target);
      target.schema.properties[property]["x-identifier"] = { allowed_kind_ids: allowed, default_kind_id: defaultKind };
      const input = { mode: "update", document: JSON.stringify(document) };
      const review = await scopedTool(client, w, "preview_data_model", input);
      const change = await scopedTool(client, w, "prepare_data_model", {
        ...input,
        preview_fingerprint: review.fingerprint,
      });
      const result = await scopedTool(client, w, "apply_data_model", {
        id: change.id,
        expected_version: change.version,
      });
      assertEquals(result.status, "applied");
      return (await scopedHttp(a, w, "GET", `/entity-types/${typeId}/schema`)).body;
    };
    const configured = await publish([appKind, rule.id], rule.id);
    assertEquals(configured.schema_version, initial.schema_version + 1);
    const stop = { active: false, expected_version: 1 };
    const refused = await scopedHttp(a, w, "PATCH", `/entity-issuers/${source}`, stop);
    assertEquals(refused.status, 400);
    assertEquals(refused.body.code, "invalid_input");
    assertEquals(refused.body.fields, [{
      path: `default_fields.${typeId}.${property}`,
      message: `${created.body.label} · ${initial.schema.properties[property].title}`,
    }]);
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
    const detached = await publish([appKind], appKind);
    assertEquals(detached.schema_version, configured.schema_version + 1);
    // Detaching the current field preserves its historical meaning; a referenced rule remains protected.
    assertEquals(
      (await scopedHttp(a, w, "DELETE", `/entity-identifier-rules/${rule.id}`, { expected_version: 1 })).body.code,
      "invalid_input",
    );
    assertEquals(
      (await scopedHttp(a, w, "DELETE", `/entity-issuers/${source}`, { expected_version: 1 })).body.code,
      "invalid_input",
    );
    const unusedSource = `unused_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    assertEquals(
      (await scopedHttp(a, w, "POST", "/entity-issuers", { code: unusedSource, label: "미사용 정리" })).status,
      201,
    );
    const unusedRule = await scopedTool(client, w, "create_entity_identifier_rule", {
      source: unusedSource,
      label: "미사용 번호",
      meaning: "정의에 연결하지 않은 원본 번호",
    });
    const ruleKey = crypto.randomUUID();
    const removed = await scopedHttp(
      a,
      w,
      "DELETE",
      `/entity-identifier-rules/${unusedRule.id}`,
      { expected_version: 1 },
      ruleKey,
    );
    assertEquals(removed.status, 200);
    assertEquals(removed.body, { deleted: true });
    assertEquals(
      await scopedTool(client, w, "delete_entity_identifier_rule", {
        rule_id: unusedRule.id,
        expected_version: 1,
        request_key: ruleKey,
      }),
      { deleted: true },
    );
    const issuerKey = crypto.randomUUID();
    assertEquals(
      await scopedTool(client, w, "delete_entity_issuer", {
        code: unusedSource,
        expected_version: 1,
        request_key: issuerKey,
      }),
      { deleted: true },
    );
    const replay = await scopedHttp(
      a,
      w,
      "DELETE",
      `/entity-issuers/${unusedSource}`,
      { expected_version: 1 },
      issuerKey,
    );
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
