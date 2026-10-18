import { assert, assertEquals } from "@std/assert";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";
import type { DataModelDocument } from "../../functions/_shared/contracts/data-model.ts";
activityWorkspaceSuite(
  "whole model HTTP/OAuth MCP parity: reviewed copy, atomic apply, no-op and retired import",
  async ({ A: token, workspaceA: w, clientA: client }) => {
    assert(client);
    const document = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
    for (const t of document.entity_types) t.schema.title += ` ${crypto.randomUUID().slice(0, 8)}`;
    const input = { mode: "copy", document: JSON.stringify(document) },
      preview = await scopedHttp(token, w, "POST", "/data-model/preview", input, null);
    assertEquals(preview.status, 200);
    assertEquals(await scopedTool(client, w, "preview_data_model", input), preview.body);
    const key = crypto.randomUUID(),
      preparedInput = { ...input, preview_fingerprint: preview.body.fingerprint },
      prepared = await scopedTool(client, w, "prepare_data_model", { ...preparedInput, request_key: key });
    assertEquals(prepared.status, "ready");
    assertEquals((await scopedHttp(token, w, "POST", "/data-model/changes", preparedInput, key)).body, prepared);
    const before = await scopedTool(client, w, "export_data_model", {});
    assertEquals(
      before.entity_types.some((t: DataModelDocument["entity_types"][number]) =>
        Object.values(preview.body.mapping.types).includes(t.schema["x-type-id"])
      ),
      false,
    );
    const applied = await scopedTool(client, w, "apply_data_model", {
      id: prepared.id,
      expected_version: prepared.version,
      request_key: crypto.randomUUID(),
    });
    assertEquals(applied.status, "applied", JSON.stringify(applied));
    const types = applied.result.type_ids as string[];
    const exported = await scopedTool(client, w, "export_data_model", {});
    assertEquals(exported, (await scopedHttp(token, w, "GET", "/data-model/export")).body);
    assertEquals(
      types.every((id) =>
        exported.entity_types.some((t: DataModelDocument["entity_types"][number]) => t.schema["x-type-id"] === id)
      ),
      true,
    );
    const noop = await scopedTool(client, w, "preview_data_model", {
      mode: "update",
      document: JSON.stringify(exported),
    });
    assertEquals(noop.items.every((i: { kind: string }) => i.kind === "unchanged"), true);
    assertEquals(
      (await scopedHttp(token, w, "POST", "/entity-schema-import/preview", { mode: "copy", document: "{}" }, null))
        .status,
      404,
    );
    const retired = await scopedHttp(token, w, "POST", "/entity-schema-import/prepare", {
      mode: "copy",
      document: "{}",
      preview_fingerprint: "b".repeat(64),
    });
    assertEquals(retired.status, 400);
  },
  { mcp: true },
);
