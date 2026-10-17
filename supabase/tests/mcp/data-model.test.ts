import { assertEquals } from "@std/assert";
import { admin, call, httpTest, signIn } from "../http/_client.ts";
import { claimsOf, connectMcp, mcpToken, tool } from "./_mcp.ts";
import type { DataModelDocument } from "../../functions/_shared/contracts/data-model.ts";
httpTest("whole model HTTP/OAuth MCP parity: reviewed copy, atomic apply, no-op and retired import", async () => {
  const token = await signIn("A"),
    client = await connectMcp(await mcpToken(token)),
    owner = String(claimsOf(token).sub);
  const changes: string[] = [], types: string[] = [], relations: string[] = [];
  try {
    const document = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
    for (const t of document.entity_types) t.schema.title += ` ${crypto.randomUUID().slice(0, 8)}`;
    const input = { mode: "copy", document: JSON.stringify(document) },
      preview = await call(token, "POST", "/data-model/preview", input, null);
    assertEquals(preview.status, 200);
    assertEquals(await tool(client, "preview_data_model", input), preview.body);
    const key = crypto.randomUUID(),
      preparedInput = { ...input, preview_fingerprint: preview.body.fingerprint },
      prepared = await tool(client, "prepare_data_model", { ...preparedInput, request_key: key });
    changes.push(prepared.id);
    assertEquals(prepared.status, "ready");
    assertEquals((await call(token, "POST", "/data-model/changes", preparedInput, key)).body, prepared);
    const before = await tool(client, "export_data_model", {});
    assertEquals(
      before.entity_types.some((t: DataModelDocument["entity_types"][number]) =>
        Object.values(preview.body.mapping.types).includes(t.schema["x-type-id"])
      ),
      false,
    );
    const applied = await tool(client, "apply_data_model", {
      id: prepared.id,
      expected_version: prepared.version,
      request_key: crypto.randomUUID(),
    });
    assertEquals(applied.status, "applied", JSON.stringify(applied));
    types.push(...applied.result.type_ids);
    relations.push(...applied.result.relation_ids);
    const exported = await tool(client, "export_data_model", {});
    assertEquals(exported, (await call(token, "GET", "/data-model/export")).body);
    assertEquals(
      types.every((id) =>
        exported.entity_types.some((t: DataModelDocument["entity_types"][number]) => t.schema["x-type-id"] === id)
      ),
      true,
    );
    const noop = await tool(client, "preview_data_model", { mode: "update", document: JSON.stringify(exported) });
    assertEquals(noop.items.every((i: { kind: string }) => i.kind === "unchanged"), true);
    assertEquals(
      (await call(token, "POST", "/entity-schema-import/preview", { mode: "copy", document: "{}" }, null)).status,
      404,
    );
    const retired = await call(token, "POST", "/entity-schema-import/prepare", {
      mode: "copy",
      document: "{}",
      preview_fingerprint: "b".repeat(64),
    });
    assertEquals(retired.status, 400);
  } finally {
    await client.close();
    await admin.begin(async (tx) => {
      await tx`delete from app.data_model_changes where owner_id=${owner}::uuid and id=any(${changes}::uuid[])`;
      await tx`delete from app.entity_relation_definitions where owner_id=${owner}::uuid and id=any(${relations}::uuid[])`;
      await tx`delete from app.entity_types where owner_id=${owner}::uuid and id=any(${types}::uuid[])`;
    });
  }
});
