import { assert, assertEquals } from "@std/assert";
import type { DataModelDocument, ModelChange, ModelReview } from "../../functions/_shared/contracts/data-model.ts";
import { definitionFingerprint } from "../../functions/_shared/core/entity-types/evolution.ts";
import { admin } from "../http/_client.ts";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

activityWorkspaceSuite(
  "whole model over 2 MiB retains per-kind definitions through actual HTTP/OAuth MCP preview, compact prepare and detail",
  async ({ A: token, B: foreign, workspaceA: w, workspaceB: otherW, clientA: client }) => {
    assert(client);
    const run = crypto.randomUUID(), requestKey = crypto.randomUUID();
    const document = JSON.parse(
      await Deno.readTextFile("docs/examples/data-model/cooking.json"),
    ) as DataModelDocument;
    const base = document.entity_types[0];
    document.relations = [];
    document.entity_types = Array.from({ length: 12 }, (_, index) => {
      const kind = structuredClone(base);
      kind.ref = `large_${index}`;
      kind.schema["x-type-id"] = `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      kind.schema.title = `큰 모델 ${run.slice(0, 8)} ${index}`;
      kind.schema.properties.prop_2 = {
        type: "string",
        title: "큰 예시",
        "x-order": 20,
        examples: Array.from({ length: 45 }, () => "x".repeat(4096)),
      };
      assert(bytes(kind.schema) < 256 * 1024, "every kind stays within its existing definition limit");
      return kind;
    });
    const raw = JSON.stringify(document), input = { mode: "copy", document: raw };
    assert(
      new TextEncoder().encode(raw).byteLength > 2 * 1024 * 1024,
      "whole model exceeds the retired single-document limit",
    );
    const httpPreview = await scopedHttp(token, w, "POST", "/data-model/preview", input, null) as {
      status: number;
      body: ModelReview;
    };
    assertEquals(httpPreview.status, 200);
    const mcpPreview = await scopedTool(client, w, "preview_data_model", input) as ModelReview;
    // Compare complete values by digest so a regression never prints the large model source.
    assertEquals(await definitionFingerprint(mcpPreview), await definitionFingerprint(httpPreview.body));
    assertEquals(httpPreview.body.can_apply, true);
    const prepareInput = { ...input, preview_fingerprint: httpPreview.body.fingerprint };
    const prepared = await scopedTool(client, w, "prepare_data_model", {
      ...prepareInput,
      request_key: requestKey,
    }) as ModelChange;
    assertEquals(prepared.status, "ready");
    assert(bytes(prepared) < 100000, "accepted receipt stays compact despite the complete stored review");
    assertEquals(
      prepared.review.items.every((item) => !item.schema && !item.current_schema && item.diff.length === 0),
      true,
    );
    const replay = await scopedHttp(token, w, "POST", "/data-model/changes", prepareInput, requestKey);
    assertEquals(replay.status, 201);
    assertEquals(await definitionFingerprint(replay.body), await definitionFingerprint(prepared));
    const detail = await scopedHttp(token, w, "GET", `/data-model/changes/${prepared.id}`) as {
      status: number;
      body: ModelChange;
    };
    assertEquals(detail.status, 200);
    const mcpDetail = await scopedTool(client, w, "get_data_model_change", { id: prepared.id }) as ModelChange;
    assertEquals(await definitionFingerprint(mcpDetail), await definitionFingerprint(detail.body));
    for (const kind of document.entity_types) {
      const reviewed = detail.body.review.items.find((item) => item.ref === kind.ref);
      assert(reviewed?.schema, "detail retains every complete definition");
      const expected = { ...kind.schema, "x-type-id": httpPreview.body.mapping.types[kind.ref], "x-version": 1 };
      assertEquals(await definitionFingerprint(reviewed.schema), await definitionFingerprint(expected));
      assertEquals(reviewed.schema.properties.prop_2.examples?.length, 45);
      const lastExample = reviewed.schema.properties.prop_2.examples?.[44];
      assert(typeof lastExample === "string", "the last example retains its scalar type");
      assertEquals(lastExample.length, 4096);
    }
    assertEquals((await scopedHttp(foreign, otherW, "GET", `/data-model/changes/${prepared.id}`)).status, 404);
    const targetIds = Object.values(httpPreview.body.mapping.types);
    const [unpublished] =
      await admin`select count(*)::int as n from app.entity_types where workspace_id=${w}::uuid and id=any(${targetIds}::uuid[])`;
    assertEquals(unpublished.n, 0, "preview and prepare do not publish any of the twelve kinds");
    console.log(
      JSON.stringify({
        model_bytes: new TextEncoder().encode(raw).byteLength,
        kind_count: 12,
        prepare_bytes: bytes(prepared),
        detail_bytes: bytes(detail.body),
        published_kinds: 0,
      }),
    );
  },
  { mcp: true },
);
