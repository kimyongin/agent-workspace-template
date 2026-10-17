import { assert, assertEquals } from "@std/assert";
import type { DataModelDocument, ModelChange, ModelReview } from "../../functions/_shared/contracts/data-model.ts";
import { definitionFingerprint } from "../../functions/_shared/core/entity-types/evolution.ts";
import { admin, call, httpTest, signIn, SUPABASE_URL } from "../http/_client.ts";
import { claimsOf, connectMcp, mcpGrant, tool } from "./_mcp.ts";

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

httpTest(
  "whole model over 2 MiB retains per-kind definitions through actual HTTP/OAuth MCP preview, compact prepare and detail",
  async () => {
    const token = await signIn("A"), foreign = await signIn("B"), owner = String(claimsOf(token).sub);
    const run = crypto.randomUUID(), requestKey = crypto.randomUUID();
    let grant: Awaited<ReturnType<typeof mcpGrant>> | undefined;
    let client: Awaited<ReturnType<typeof connectMcp>> | undefined;
    const changeIds: string[] = [], errors: unknown[] = [];
    const remember = (id: unknown) => {
      if (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) && !changeIds.includes(id)) changeIds.push(id);
    };
    try {
      grant = await mcpGrant(token);
      client = await connectMcp(grant.access_token);
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
      const httpPreview = await call<ModelReview>(token, "POST", "/data-model/preview", input, null);
      assertEquals(httpPreview.status, 200);
      const mcpPreview = await tool(client, "preview_data_model", input) as ModelReview;
      // Compare complete values by digest so a regression never prints the large model source.
      assertEquals(await definitionFingerprint(mcpPreview), await definitionFingerprint(httpPreview.body));
      assertEquals(httpPreview.body.can_apply, true);
      const prepareInput = { ...input, preview_fingerprint: httpPreview.body.fingerprint };
      const prepared = await tool(client, "prepare_data_model", {
        ...prepareInput,
        request_key: requestKey,
      }) as ModelChange;
      remember(prepared.id);
      assertEquals(prepared.status, "ready");
      assert(bytes(prepared) < 100000, "accepted receipt stays compact despite the complete stored review");
      assertEquals(
        prepared.review.items.every((item) => !item.schema && !item.current_schema && item.diff.length === 0),
        true,
      );
      const replay = await call<ModelChange>(token, "POST", "/data-model/changes", prepareInput, requestKey);
      remember(replay.body.id);
      assertEquals(replay.status, 201);
      assertEquals(await definitionFingerprint(replay.body), await definitionFingerprint(prepared));
      const detail = await call<ModelChange>(token, "GET", `/data-model/changes/${prepared.id}`);
      assertEquals(detail.status, 200);
      const mcpDetail = await tool(client, "get_data_model_change", { id: prepared.id }) as ModelChange;
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
      assertEquals((await call(foreign, "GET", `/data-model/changes/${prepared.id}`)).status, 404);
      const targetIds = Object.values(httpPreview.body.mapping.types);
      const [unpublished] =
        await admin`select count(*)::int as n from app.entity_types where owner_id=${owner}::uuid and id=any(${targetIds}::uuid[])`;
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
    } catch (error) {
      errors.push(error);
    } finally {
      // Recover an accepted-but-unobserved result by the exact run-owned owner+request key only.
      try {
        await admin.begin(async (tx) => {
          const retained =
            await tx`select result->>'id' as id from private.request_results where owner_id=${owner}::uuid and request_key=${requestKey}::uuid and operation='data-model.prepare'`;
          for (const row of retained) remember(row.id);
          await tx`delete from app.data_model_changes where owner_id=${owner}::uuid and id=any(${changeIds}::uuid[])`;
          await tx`delete from private.request_results where owner_id=${owner}::uuid and request_key=${requestKey}::uuid`;
          const [remaining] =
            await tx`select (select count(*)::int from app.data_model_changes where owner_id=${owner}::uuid and id=any(${changeIds}::uuid[])) as changes,(select count(*)::int from private.request_results where owner_id=${owner}::uuid and request_key=${requestKey}::uuid) as requests`;
          assertEquals(remaining, { changes: 0, requests: 0 });
        });
      } catch (error) {
        errors.push(error);
      }
      try {
        await client?.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        if (grant) {
          const secret = Deno.env.get("LOCAL_SUPABASE_SECRET_KEY");
          assert(secret, "local OAuth cleanup key is configured");
          const removed = await fetch(
            `${SUPABASE_URL}/auth/v1/admin/oauth/clients/${encodeURIComponent(grant.client_id)}`,
            {
              method: "DELETE",
              headers: { apikey: secret, authorization: `Bearer ${secret}` },
              signal: AbortSignal.timeout(15000),
            },
          );
          await removed.body?.cancel();
          assert(removed.ok || removed.status === 404, "run-owned OAuth client cleanup succeeds");
        }
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "large whole-model input contract or owned cleanup failed");
  },
);
