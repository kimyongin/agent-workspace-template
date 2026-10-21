import { assert, assertEquals } from "@std/assert";
import { call } from "./_client.ts";
import {
  encodeIdentifierReference,
  encodeIdentifierValue,
} from "../../functions/_shared/contracts/entity-identifiers.ts";
import { activityWorkspaceSuite, scopedHttp } from "./_workspace-activity-fixture.ts";
activityWorkspaceSuite("owned typed entity HTTP lifecycle", async (f, t) => {
  const { A, B, workspaceA, workspaceB, schema } = f;
  await t.step(
    "Entity HTTP: CRUD·권한·입력·버전·참조·삭제 보존 실제 진입점",
    async () => {
      assertEquals((await call(null, "GET", "/entities")).status, 401);
      assertEquals(
        (await scopedHttp(A, workspaceA, "POST", "/entities/prepare", {
          source: "app",
        })).status,
        404,
      );
      assertEquals(
        (await scopedHttp(A, workspaceA, "GET", `/entity-types/${schema.entity_type_id}/identity`)).status,
        404,
      );
      const definition = await scopedHttp(
        A,
        workspaceA,
        "GET",
        `/entity-types/${schema.entity_type_id}/schema`,
      );
      assertEquals(definition.status, 200);
      const key = definition.body.schema["x-identity-property"], kind = "00000000-0000-4000-8000-000000000001";
      const input = {
        ...schema,
        properties: {
          prop_1: "실제 엔터티",
          prop_2: 0,
          prop_3: "2024-02-29",
          [key]: encodeIdentifierValue(kind, crypto.randomUUID()),
        },
      };
      assertEquals(
        (await scopedHttp(A, workspaceA, "POST", "/entities", {
          ...input,
          schema_version: schema.schema_version + 1,
        })).body.code,
        "schema_changed",
      );
      const created = await scopedHttp(
        A,
        workspaceA,
        "POST",
        "/entities",
        input,
      );
      assertEquals(created.status, 201);
      const e = created.body;
      assertEquals(e.properties.prop_1, "실제 엔터티");
      assertEquals(
        (await scopedHttp(A, workspaceA, "POST", "/entities", input)).status,
        409,
      );
      assertEquals(
        (await scopedHttp(
          B,
          workspaceB,
          "GET",
          `/entities/${encodeURIComponent(e.id)}`,
        )).status,
        404,
      );
      assertEquals(
        (await scopedHttp(A, workspaceA, "GET", "/entities/not-id")).status,
        404,
      );
      for (
        const [bad, field] of [
          [
            { ...input, properties: { ...input.properties, prop_2: -1 } },
            "properties.prop_2",
          ],
          [{
            ...input,
            properties: { ...input.properties, prop_3: "2023-02-29" },
          }, "properties.prop_3"],
          [{ ...input, version: 2 }, "version"],
        ] as const
      ) {
        const failure = await scopedHttp(A, workspaceA, "POST", "/entities", {
          ...bad,
          properties: { ...bad.properties, [key]: encodeIdentifierValue(kind, crypto.randomUUID()) },
        });
        assertEquals(failure.status, 400);
        assertEquals(failure.body.code, "invalid_input");
        assert(
          failure.body.fields.some((item: { path: string }) => item.path === field),
        );
      }
      const task = (await scopedHttp(A, workspaceA, "POST", "/tasks", {
        kind: "once",
        title: "HTTP 연결",
        entity_ids: [e.id],
      })).body;
      assertEquals(
        (await scopedHttp(B, workspaceB, "POST", "/tasks", {
          kind: "once",
          title: "외부 연결",
          entity_ids: [e.id],
        })).body.code,
        "invalid_reference",
      );
      const detail = (await scopedHttp(
        A,
        workspaceA,
        "GET",
        `/entities/${encodeURIComponent(e.id)}`,
      )).body;
      assertEquals(detail.tasks.count, 1);
      assertEquals(detail.tasks.items[0].id, task.id);
      assert(
        (await scopedHttp(A, workspaceA, "GET", `/tasks?entity_id=${e.id}`))
          .body.items.some((t: { id: string }) => t.id === task.id),
      );
      const search = {
        query: "HTTP 연결",
        entity_id: e.id,
        mode: "keyword",
        kinds: ["task"],
      };
      assertEquals(
        (await scopedHttp(A, workspaceA, "POST", "/search", search)).body.items
          .map((x: { id: string }) => x.id),
        [task.id],
      );
      assertEquals(
        (await scopedHttp(B, workspaceB, "POST", "/search", search)).body.items,
        [],
      );
      assertEquals(
        (await scopedHttp(A, workspaceA, "POST", "/search", {
          ...search,
          entity_id: encodeIdentifierReference("00000000-0000-4000-8000-000000000001", kind, crypto.randomUUID()),
        })).body.items,
        [],
      );
      assertEquals(
        (await scopedHttp(A, workspaceA, "POST", "/search", {
          ...search,
          entity_id: "bad",
        })).body.code,
        "invalid_input",
      );
      const updated = await scopedHttp(
        A,
        workspaceA,
        "PATCH",
        `/entities/${encodeURIComponent(e.id)}`,
        {
          change_note: "테스트 변경 이유",
          expected_version: 1,
          schema_version: schema.schema_version,
          properties: { prop_2: null, prop_4: "c" },
        },
      );
      assertEquals(updated.status, 200);
      assertEquals(updated.body.properties.prop_2, null);
      assertEquals(
        (await scopedHttp(
          A,
          workspaceA,
          "POST",
          `/entities/${encodeURIComponent(e.id)}/delete`,
          { expected_version: 1 },
        )).status,
        409,
      );
      assertEquals(
        (await scopedHttp(
          A,
          workspaceA,
          "POST",
          `/entities/${encodeURIComponent(e.id)}/delete`,
          { expected_version: 2 },
        )).status,
        204,
      );
      const current = (await scopedHttp(A, workspaceA, "GET", `/tasks/${task.id}`)).body;
      assertEquals(current.entity_ids, [e.id]);
      assertEquals(current.version, 1);
      assertEquals(
        (await scopedHttp(A, workspaceA, "POST", "/search", search)).body.items
          .map((t: { id: string }) => t.id),
        [task.id],
      );
      assertEquals(
        (await scopedHttp(A, workspaceA, "POST", "/search", {
          query: search.query,
          mode: "keyword",
          kinds: ["task"],
        })).body.items[0].id,
        task.id,
      );
      const retained = (await scopedHttp(
        A,
        workspaceA,
        "GET",
        `/entities/${encodeURIComponent(e.id)}`,
      )).body;
      assert(retained.deleted_at);
      assertEquals([
        retained.properties.prop_1,
        retained.properties.prop_2,
        retained.properties.prop_4,
        retained.version,
      ], [
        "실제 엔터티",
        null,
        "c",
        3,
      ]);
      assertEquals((await scopedHttp(A, workspaceA, "POST", "/entities", input)).body.code, "conflict");
      assertEquals(
        (await scopedHttp(A, workspaceA, "POST", "/entities", { ...input, expected_version: 3 })).body.code,
        "invalid_input",
      );
      assertEquals(
        (await scopedHttp(A, workspaceA, "POST", `/entities/${encodeURIComponent(e.id)}/restore`, {
          schema_version: schema.schema_version,
          expected_version: 2,
        })).body.code,
        "conflict",
      );
      const lookupQuery = new URLSearchParams({
        entity_type_id: schema.entity_type_id,
        identifier: String(input.properties[key]),
      });
      const found = await scopedHttp(A, workspaceA, "GET", `/entities/lookup?${lookupQuery}`);
      assertEquals(found.body.id, e.id);
      const restored = await scopedHttp(
        A,
        workspaceA,
        "POST",
        `/entities/${encodeURIComponent(found.body.id)}/restore`,
        {
          schema_version: schema.schema_version,
          properties: {},
          expected_version: found.body.version,
        },
      );
      assertEquals(restored.status, 200);
      assertEquals([
        restored.body.id,
        restored.body.properties.prop_1,
        restored.body.properties.prop_2,
        restored.body.properties.prop_4,
        restored.body.version,
        restored.body.deleted_at,
      ], [e.id, "실제 엔터티", null, "c", 4, null]);
      await scopedHttp(
        A,
        workspaceA,
        "POST",
        `/entities/${encodeURIComponent(e.id)}/delete`,
        { expected_version: 4 },
      );
      await scopedHttp(A, workspaceA, "POST", `/tasks/${task.id}/delete`, {
        expected_version: 1,
      });
    },
  );
}, { typed: true });
