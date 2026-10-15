import { assertEquals } from "@std/assert";
import { admin, call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

httpTest("issuer HTTP/MCP parity: policy impacts, owner isolation, unused deletion and logical replay", async () => {
  const a = await signIn("A"), b = await signIn("B"), client = await connectMcp(await mcpToken(a));
  const source = `cleanup_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  let typeId: string | undefined, ruleId: string | undefined;
  try {
    const created = await call(a, "POST", "/entity-types", { label: `발급처 정리 ${crypto.randomUUID()}` });
    assertEquals(created.status, 201);
    typeId = created.body.id;
    assertEquals((await call(a, "POST", "/entity-issuers", { code: source, label: "오등록 검사" })).status, 201);
    const rule = await tool(client, "create_entity_identifier_rule", {
      source,
      label: "상품 번호",
      meaning: "상품 한 등록 건",
    });
    ruleId = rule.id;
    const initial = (await call(a, "GET", `/entity-types/${typeId}/identity`)).body;
    const sources = [
      ...initial.sources.map((s: { code: string; rule_id: string; active: boolean }) => ({
        code: s.code,
        rule_id: s.rule_id,
        active: s.active,
      })),
      { code: source, rule_id: rule.id, active: true },
    ];
    const identity = await tool(client, "update_entity_type_identity", {
      type_id: typeId,
      label: "상품 번호",
      default_source: source,
      expected_version: initial.version,
      sources,
    });
    const stop = { active: false, expected_version: 1 };
    const refused = await call(a, "PATCH", `/entity-issuers/${source}`, stop);
    assertEquals(refused.status, 400);
    assertEquals(refused.body.code, "invalid_input");
    assertEquals(refused.body.fields, [{ path: `default_types.${typeId}`, message: created.body.label }]);
    assertEquals(await tool(client, "update_entity_issuer", { code: source, ...stop }), {
      ...refused.body,
      error: true,
    });
    assertEquals((await call(b, "DELETE", `/entity-identifier-rules/${rule.id}`, { expected_version: 1 })).status, 404);
    const linked = await call(a, "DELETE", `/entity-identifier-rules/${rule.id}`, { expected_version: 1 });
    assertEquals(linked.status, 400);
    assertEquals(linked.body.code, "invalid_input");
    await tool(client, "update_entity_type_identity", {
      type_id: typeId,
      label: identity.label,
      default_source: "app",
      expected_version: identity.version,
      sources: sources.filter((s) => s.code === "app"),
    });
    const ruleKey = crypto.randomUUID();
    const removed = await call(a, "DELETE", `/entity-identifier-rules/${rule.id}`, { expected_version: 1 }, ruleKey);
    assertEquals(removed.status, 200);
    assertEquals(removed.body, { deleted: true });
    assertEquals(
      await tool(client, "delete_entity_identifier_rule", {
        rule_id: rule.id,
        expected_version: 1,
        request_key: ruleKey,
      }),
      { deleted: true },
    );
    const issuerKey = crypto.randomUUID();
    assertEquals(
      await tool(client, "delete_entity_issuer", { code: source, expected_version: 1, request_key: issuerKey }),
      { deleted: true },
    );
    const replay = await call(a, "DELETE", `/entity-issuers/${source}`, { expected_version: 1 }, issuerKey);
    assertEquals(replay.status, 200);
    assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
    assertEquals((await call(null, "DELETE", "/entity-issuers/app", { expected_version: 1 })).status, 401);
    assertEquals((await call(a, "DELETE", "/entity-issuers/app", { expected_version: 1 })).body.code, "invalid_input");
  } finally {
    // Only this test's newly created objects. Existing definitions/data are untouched.
    const [owner] = typeId ? await admin`select owner_id from app.entity_types where id=${typeId}::uuid` : [];
    if (typeId) await admin`delete from app.entity_types where id=${typeId}::uuid`;
    if (owner) {
      if (ruleId) {
        await admin`delete from app.entity_identifier_rules where owner_id=${owner.owner_id}::uuid and id=${ruleId}::uuid`;
      }
      await admin`delete from app.entity_issuers where owner_id=${owner.owner_id}::uuid and code=${source}`;
    }
    await client.close();
  }
});
