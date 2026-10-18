import { assert, assertEquals } from "@std/assert";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";
activityWorkspaceSuite("owned typed entity MCP HTTP parity", async (f, t) => {
  const { A: token, B: foreignToken, workspaceA, workspaceB, schema } = f;
  assert(f.clientA);
  const client = f.clientA;
  await t.step(
    "entity CRUD, independent tags, fixed result parent, source metadata and retained history use current contracts",
    async () => {
      const listed = await client.listTools();
      for (
        const name of [
          "list_entities",
          "get_entity",
          "create_entity",
          "update_entity",
          "delete_entity",
        ]
      ) assert(listed.tools.some((tool) => tool.name === name));
      const tag = await scopedTool(client, workspaceA, "create_tag", {
        name: "entity" + crypto.randomUUID().slice(0, 20),
        scope: "entity",
      });
      const activityTag = await scopedTool(client, workspaceA, "create_tag", {
        name: "record" + crypto.randomUUID().slice(0, 20),
        scope: "record",
      });
      const created = await scopedTool(client, workspaceA, "create_entity", {
        ...schema,
        properties: { prop_1: "MCP 엔터티", prop_2: 1, prop_4: "b" },
      });
      assertEquals(created.tag_ids, []);
      const connected = await scopedTool(
        client,
        workspaceA,
        "set_tag_connections",
        {
          target_kind: "entity",
          target_id: created.id,
          expected_version: created.version,
          tag_ids: [tag.id],
        },
      );
      assertEquals(connected.tag_ids, [tag.id]);
      const e = await scopedTool(client, workspaceA, "get_entity", {
        id: created.id,
      });
      assertEquals(e.version, 2);
      assertEquals(
        (await scopedHttp(
          token,
          workspaceA,
          "GET",
          `/entities/${encodeURIComponent(e.id)}`,
        )).body,
        e,
      );
      const before = await scopedTool(client, workspaceA, "list_records", {
        entity_id: e.id,
        record_kind: "change",
        limit: 100,
      });
      const createdHistory = before.items.find((
        row: { change?: { action: string } },
      ) => row.change?.action === "create");
      assert(createdHistory);
      assertEquals(
        [createdHistory.change.source, createdHistory.change.action],
        ["mcp", "create"],
      );
      const edit = await scopedHttp(
        token,
        workspaceA,
        "PATCH",
        `/records/${createdHistory.id}`,
        {
          expected_version: createdHistory.version,
          body: "自動記録の説明を補う",
        },
      );
      assertEquals(edit.status, 200);
      const readEdited = await scopedTool(client, workspaceA, "get_record", {
        id: createdHistory.id,
      });
      assertEquals([readEdited.change, readEdited.body], [
        createdHistory.change,
        "自動記録の説明を補う",
      ]);
      const after = await scopedTool(client, workspaceA, "list_records", {
        entity_id: e.id,
        record_kind: "change",
        limit: 100,
      });
      assertEquals(
        after.items.map((row: { id: string }) => row.id),
        before.items.map((row: { id: string }) => row.id),
      );
      assertEquals(
        (await scopedTool(client, workspaceA, "create_entity", {
          ...schema,
          properties: { prop_1: "거부" },
          tag_ids: [activityTag.id],
        })).error.code,
        "invalid_input",
      );
      assertEquals(
        (await scopedTool(client, workspaceA, "set_tag_connections", {
          target_kind: "entity",
          target_id: e.id,
          expected_version: e.version,
          tag_ids: [activityTag.id],
        })).error.code,
        "invalid_reference",
      );
      assertEquals(
        (await scopedTool(client, workspaceA, "get_entity", { id: "bad-id" }))
          .error.code,
        "not_found",
      );
      const marker = crypto.randomUUID();
      const task = await scopedTool(client, workspaceA, "create_task", {
        kind: "once",
        title: "엔터티 삭제 관계 검증",
        entity_ids: [e.id],
      });
      const completion = await scopedTool(client, workspaceA, "complete_task", {
        id: task.id,
        expected_version: task.version,
        body: marker,
      });
      const r = completion.record;
      const detail = await scopedTool(client, workspaceA, "get_entity", {
        id: e.id,
      });
      assertEquals("principles" in detail, false);
      assertEquals(
        detail.records.items.some((row: { id: string }) => row.id === r.id),
        false,
      );
      assert(
        detail.records.items.every((
          row: { entity_id: string; task_id: null; record_kind: string },
        ) =>
          row.entity_id === e.id && row.task_id === null &&
          row.record_kind === "change"
        ),
      );
      assertEquals(
        detail,
        (await scopedHttp(
          token,
          workspaceA,
          "GET",
          `/entities/${encodeURIComponent(e.id)}`,
        )).body,
      );
      const search = {
        query: marker,
        mode: "keyword",
        kinds: ["record"],
        record_kind: "result",
      };
      const found = await scopedTool(client, workspaceA, "search", search);
      assertEquals(found.items.map((row: { id: string }) => row.id), [r.id]);
      assertEquals(
        found,
        (await scopedHttp(token, workspaceA, "POST", "/search", search)).body,
      );
      assertEquals(
        (await scopedTool(client, workspaceA, "search", {
          ...search,
          entity_id: e.id,
        })).items,
        [],
      );
      assertEquals(
        (await scopedTool(client, workspaceA, "search", {
          ...search,
          entity_id: "bad",
        })).error.code,
        "invalid_input",
      );
      assertEquals(
        (await scopedTool(client, workspaceA, "update_entity", {
          id: e.id,
          schema_version: schema.schema_version,
          expected_version: e.version + 1,
          properties: { prop_1: "경쟁" },
        })).error.code,
        "conflict",
      );
      const withoutReason = await scopedTool(
        client,
        workspaceA,
        "update_entity",
        {
          id: e.id,
          expected_version: e.version,
          schema_version: schema.schema_version,
          properties: { prop_1: "이유 없이 수정" },
        },
      );
      assertEquals(withoutReason.version, 3);
      const changed = await scopedTool(client, workspaceA, "update_entity", {
        id: e.id,
        expected_version: withoutReason.version,
        schema_version: schema.schema_version,
        properties: { prop_3: "2026-10-04" },
        change_note: "일자 정정",
      });
      assertEquals(changed.version, 4);
      const unlinkMemo = "HTTP 태그 삭제 확인";
      assertEquals(
        (await scopedHttp(
          token,
          workspaceA,
          "DELETE",
          `/tags/${tag.id}?expected_version=${tag.version}&change_note=${encodeURIComponent(unlinkMemo)}`,
        )).status,
        204,
      );
      assertEquals(
        (await scopedTool(client, workspaceA, "delete_tag", {
          id: tag.id,
          expected_version: tag.version,
        })).error.code,
        "not_found",
      );
      const unlinked = await scopedTool(client, workspaceA, "get_entity", {
        id: e.id,
      });
      assertEquals([unlinked.version, unlinked.tag_ids], [5, []]);
      const updates = await scopedTool(client, workspaceA, "list_records", {
        entity_id: e.id,
        record_kind: "change",
        limit: 100,
      });
      assertEquals(
        updates.items.filter((row: { change?: { action: string } }) => row.change?.action === "update").length,
        4,
      );
      const unlink = updates.items.find((row: { body: string }) => row.body === unlinkMemo);
      assert(unlink);
      assertEquals([unlink.change.before, unlink.change.after], [null, null]);
      assertEquals([
        unlink.change.source,
        unlink.change.target_kind,
        unlink.change.target_id,
        unlink.change.target_title,
        unlink.change.action,
        unlink.change.path,
      ], [
        "http",
        "entity",
        e.id,
        "이유 없이 수정",
        "update",
        `/entities/${encodeURIComponent(e.id)}`,
      ]);
      assertEquals(
        (await scopedHttp(token, workspaceA, "GET", `/records/${unlink.id}`))
          .body,
        unlink,
      );
      assertEquals(
        (await scopedTool(client, workspaceA, "list_tags", { scope: "entity" }))
          .items.some((row: { id: string }) => row.id === tag.id),
        false,
      );
      await scopedTool(client, workspaceA, "delete_entity", {
        id: e.id,
        expected_version: unlinked.version,
      });
      const liveTask = await scopedTool(client, workspaceA, "get_task", {
        id: task.id,
      });
      assertEquals(liveTask.entity_ids, [e.id]);
      assertEquals(
        (await scopedTool(client, workspaceA, "list_tasks", {
          entity_id: e.id,
        })).items.map((row: { id: string }) => row.id),
        [task.id],
      );
      const retained = await scopedTool(client, workspaceA, "get_record", {
        id: r.id,
      });
      assertEquals([retained.entity_id, retained.task_id, retained.body], [
        null,
        task.id,
        marker,
      ]);
      assertEquals("entity_context" in retained, false);
      const preserved = await scopedTool(client, workspaceA, "search", search);
      assertEquals(preserved.items.map((row: { id: string }) => row.id), [
        r.id,
      ]);
      assertEquals(
        preserved,
        (await scopedHttp(token, workspaceA, "POST", "/search", search)).body,
      );
      assertEquals(
        (await scopedHttp(foreignToken, workspaceB, "GET", `/records/${r.id}`))
          .status,
        404,
      );
      assertEquals(
        (await scopedHttp(foreignToken, workspaceB, "POST", "/search", search))
          .body.items,
        [],
      );
      await scopedTool(client, workspaceA, "delete_task", {
        id: task.id,
        expected_version: liveTask.version,
      });
      assertEquals(
        (await scopedTool(client, workspaceA, "get_record", { id: r.id }))
          .task_id,
        task.id,
      );
    },
  );
  await t.step(
    "Entity typed list MCP/HTTP: AND numeric/date filters, unset, property cursor parity and strict errors",
    async () => {
      const marker = crypto.randomUUID(),
        ids: string[] = [];
      try {
        for (
          const [n, value, date] of [["空", null, null], [
            "零",
            0,
            "2024-02-29",
          ], ["二", 2, "2025-01-01"]] as const
        ) {
          const row = await scopedTool(client, workspaceA, "create_entity", {
            ...schema,
            properties: {
              prop_1: marker + n,
              prop_2: value,
              prop_3: date,
              prop_4: "b",
            },
          });
          ids.push(row.id);
        }
        const query = {
          entity_type_id: schema.entity_type_id,
          keyword: marker,
          filters: [{ key: "prop_2", operator: "gte", value: 0 }, {
            key: "prop_3",
            operator: "lte",
            value: "2024-02-29",
          }],
          sort: { key: "prop_2", direction: "asc" },
        };
        const listed = await scopedTool(
          client,
          workspaceA,
          "list_entities",
          query,
        );
        assertEquals(listed.items.map((row: { id: string }) => row.id), [
          ids[1],
        ]);
        const url = new URLSearchParams({
          entity_type_id: query.entity_type_id,
          keyword: marker,
          filters: JSON.stringify(query.filters),
          sort: JSON.stringify(query.sort),
        });
        assertEquals(
          (await scopedHttp(token, workspaceA, "GET", `/entities?${url}`)).body,
          listed,
        );
        const first = await scopedTool(client, workspaceA, "list_entities", {
          entity_type_id: schema.entity_type_id,
          keyword: marker,
          sort: query.sort,
          limit: 1,
        });
        assertEquals(first.items[0].id, ids[0]);
        assert(first.next_cursor);
        const second = await scopedTool(client, workspaceA, "list_entities", {
          entity_type_id: schema.entity_type_id,
          keyword: marker,
          sort: query.sort,
          limit: 1,
          cursor: first.next_cursor,
        });
        assertEquals(second.items[0].id, ids[1]);
        const unset = await scopedTool(client, workspaceA, "list_entities", {
          entity_type_id: schema.entity_type_id,
          keyword: marker,
          filters: [{ key: "prop_2", operator: "unset" }],
        });
        assertEquals(unset.items.map((row: { id: string }) => row.id), [
          ids[0],
        ]);
        for (
          const filters of [[{ key: "prop_2", operator: "gte", value: "0" }], [{
            key: "prop_2",
            operator: "gt",
            value: 5,
          }, { key: "prop_2", operator: "lte", value: 5 }], [{
            key: "prop_2",
            operator: "eq",
            value: null,
          }]]
        ) {
          assertEquals(
            (await scopedTool(client, workspaceA, "list_entities", {
              entity_type_id: schema.entity_type_id,
              filters,
            })).error.code,
            "invalid_input",
          );
          const invalid = new URLSearchParams({
            entity_type_id: schema.entity_type_id,
            filters: JSON.stringify(filters),
          });
          assertEquals(
            (await scopedHttp(token, workspaceA, "GET", `/entities?${invalid}`))
              .body.code,
            "invalid_input",
          );
        }
      } finally {
        for (const id of ids) {
          const current = await scopedTool(client, workspaceA, "get_entity", {
            id,
          });
          await scopedTool(client, workspaceA, "delete_entity", {
            id,
            expected_version: current.version,
          });
        }
      }
    },
  );
}, { mcp: true, typed: true });
