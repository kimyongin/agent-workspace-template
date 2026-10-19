import { assert, assertEquals } from "@std/assert";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";

activityWorkspaceSuite(
  "owned MCP task associations and immutable result parents",
  async (f, t) => {
    const { A: session, B: foreignSession, workspaceA, workspaceB, schema } = f;
    assert(f.clientA);
    const client = f.clientA;
    await t.step(
      "task result memo parity, permission denial and automatic event identity stay independent of task associations",
      async () => {
        const targets = [];
        for (const name of ["첫 대상", "둘째 대상"]) {
          targets.push(
            await scopedTool(client, workspaceA, "create_entity", {
              ...schema,
              properties: { prop_1: name + crypto.randomUUID().slice(0, 8) },
            }),
          );
        }
        const ids = targets.map((row) => row.id).sort(),
          marker = "연결" + crypto.randomUUID();
        const task = await scopedTool(client, workspaceA, "create_task", {
          kind: "once",
          title: "공동 수행",
          entity_ids: ids,
        });
        const completed = await scopedTool(
          client,
          workspaceA,
          "complete_task",
          { id: task.id, expected_version: task.version, body: marker },
        );
        const record = completed.record;
        const patch = {
          expected_version: record.version,
          body: `${marker}\n대상 근거 정정`,
        };
        const edited = await scopedHttp(
          session,
          workspaceA,
          "PATCH",
          `/records/${record.id}`,
          patch,
        );
        assertEquals(edited.status, 200);
        assertEquals(
          (await scopedTool(client, workspaceA, "update_record", {
            id: record.id,
            ...patch,
          })).error.code,
          "conflict",
        );
        assertEquals(
          await scopedTool(client, workspaceA, "update_record", {
            id: record.id,
            expected_version: edited.body.version,
            body: edited.body.body,
          }),
          edited.body,
        );
        const read = await scopedTool(client, workspaceA, "get_record", {
          id: record.id,
        });
        assertEquals([
          read.record_kind,
          read.entity_id,
          read.task_id,
          read.occurrence_on,
        ], ["result", null, task.id, null]);
        assertEquals("entity_ids" in read, false);
        assertEquals(
          (await scopedHttp(
            session,
            workspaceA,
            "GET",
            `/records/${record.id}`,
          )).body,
          read,
        );
        for (const id of ids) {
          const related = await scopedTool(client, workspaceA, "get_entity", {
            id,
          });
          assertEquals(
            related.records.items.some((row: { id: string }) => row.id === record.id),
            false,
          );
          const filtered = await scopedTool(
            client,
            workspaceA,
            "list_records",
            { entity_id: id, record_kind: "change", limit: 100 },
          );
          assert(
            filtered.items.every((row: { entity_id: string; task_id: null }) =>
              row.entity_id === id && row.task_id === null
            ),
          );
        }
        const search = {
          query: marker,
          kinds: ["record"],
          mode: "keyword",
          record_kind: "result",
          limit: 1,
        };
        assertEquals(
          (await scopedTool(client, workspaceA, "search", search)).items.map((
            row: { id: string },
          ) => row.id),
          [record.id],
        );
        assertEquals(
          (await scopedHttp(
            foreignSession,
            workspaceB,
            "PATCH",
            `/records/${record.id}`,
            { expected_version: read.version, body: "타 공간 수정" },
          )).status,
          404,
        );
        for (
          const parent of [{ entity_context: [] }, { entity_ids: [] }, {
            task_id: task.id,
          }, { entity_id: ids[0] }]
        ) {
          assertEquals(
            (await scopedTool(client, workspaceA, "update_record", {
              id: record.id,
              expected_version: read.version,
              body: "거부",
              ...parent,
            })).error.code,
            "invalid_input",
          );
        }
        const history = await scopedTool(client, workspaceA, "list_records", {
          record_kind: "change",
          entity_id: ids[0],
          limit: 100,
        });
        const event = history.items.find((
          row: { change?: { target_id: string } },
        ) => row.change?.target_id === ids[0]);
        assert(event);
        assertEquals(
          (await scopedTool(client, workspaceA, "update_record", {
            id: event.id,
            expected_version: event.version,
            entity_ids: [],
          })).error.code,
          "invalid_input",
        );
        const eventAfter = await scopedTool(client, workspaceA, "get_record", {
          id: event.id,
        });
        assertEquals([
          eventAfter.entity_id,
          eventAfter.task_id,
          eventAfter.change,
        ], [ids[0], null, event.change]);
        const unlinked = await scopedTool(client, workspaceA, "update_task", {
          id: task.id,
          expected_version: completed.task.version,
          entity_ids: [],
        });
        assertEquals(unlinked.entity_ids, []);
        assertEquals(
          (await scopedTool(client, workspaceA, "get_record", {
            id: record.id,
          })).task_id,
          task.id,
        );
      },
    );
    await t.step(
      "completion and occurrences belong only to their task; rejected selections and memo materials do not change the schedule",
      async () => {
        const targets = [];
        for (const title of ["완료 대상", "회차 대상"]) {
          targets.push(
            await scopedTool(client, workspaceA, "create_entity", {
              ...schema,
              properties: { prop_1: title + crypto.randomUUID().slice(0, 8) },
            }),
          );
        }
        const ids = targets.map((row) => row.id).sort();
        const once = await scopedTool(client, workspaceA, "create_task", {
          kind: "once",
          title: "공동 실행",
          entity_ids: ids,
        });
        const completion = await scopedHttp(
          session,
          workspaceA,
          "POST",
          `/tasks/${once.id}/complete`,
          { expected_version: once.version, body: "실행 결과" },
        );
        assertEquals(completion.status, 200);
        const completed = await scopedTool(client, workspaceA, "get_record", {
          id: completion.body.record.id,
        });
        assertEquals([
          completed.entity_id,
          completed.record_kind,
          completed.task_id,
          completed.occurrence_on,
        ], [null, "result", once.id, null]);
        assertEquals(
          (await scopedTool(client, workspaceA, "get_task", { id: once.id }))
            .result_record_id,
          completed.id,
        );
        const repeat = await scopedTool(client, workspaceA, "create_task", {
          kind: "recurring",
          title: "공동 반복",
          entity_ids: ids,
          recurrence: { freq: "daily", starts_on: "2020-01-01" },
          timezone: "Asia/Seoul",
        });
        const results: string[] = [];
        for (const entity_ids of [[], [ids[0]]]) {
          assertEquals(
            (await scopedTool(client, workspaceA, "record_occurrence", {
              task_id: repeat.id,
              date: "2020-01-01",
              body: "거부",
              entity_ids,
            })).error.code,
            "invalid_input",
          );
        }
        for (const date of ["2020-01-01", "2020-01-02", "2020-01-03"]) {
          const row = await scopedTool(
            client,
            workspaceA,
            "record_occurrence",
            { task_id: repeat.id, date, body: "회차 결과" },
          );
          results.push(row.id);
          assertEquals([
            row.entity_id,
            row.record_kind,
            row.task_id,
            row.occurrence_on,
          ], [null, "result", repeat.id, date]);
          assertEquals("entity_context" in row, false);
          assertEquals(
            (await scopedHttp(session, workspaceA, "GET", `/records/${row.id}`))
              .body,
            row,
          );
        }
        const reference = await scopedTool(
          client,
          workspaceA,
          "create_entity",
          { ...schema, properties: { prop_1: `/tasks/${repeat.id}` } },
        );
        assert(typeof reference.id === "string");
        const schedule = await scopedTool(
          client,
          workspaceA,
          "list_occurrences",
          { id: repeat.id, from: "2020-01-01", to: "2020-01-03" },
        );
        assertEquals(
          schedule.items.flatMap((row: { record_ids: string[] }) => row.record_ids).sort(),
          results.sort(),
        );
        assertEquals(
          (await scopedTool(client, workspaceA, "get_task", { id: repeat.id }))
            .entity_ids,
          ids,
        );
      },
    );
  },
  { mcp: true },
);
