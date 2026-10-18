import { assert, assertEquals } from "@std/assert";
import { activityWorkspaceSuite, scopedHttp } from "./_workspace-activity-fixture.ts";
activityWorkspaceSuite(
  "owned HTTP task associations and result parents",
  async (f, t) => {
    const { A, B, workspaceA, workspaceB, schema } = f;
    await t.step(
      "completion retains one task parent after task associations change",
      async () => {
        const entity = (await scopedHttp(A, workspaceA, "POST", "/entities", {
          ...schema,
          properties: { prop_1: crypto.randomUUID() },
        })).body;
        const task = (await scopedHttp(A, workspaceA, "POST", "/tasks", {
          kind: "once",
          title: "관계 업무",
          entity_ids: [entity.id],
        })).body;
        const completed = await scopedHttp(
          A,
          workspaceA,
          "POST",
          `/tasks/${task.id}/complete`,
          { expected_version: task.version, body: "실제 상담 수행" },
        );
        assertEquals(completed.status, 200);
        const record = completed.body.record;
        assertEquals([
          record.record_kind,
          record.entity_id,
          record.task_id,
          record.occurrence_on,
        ], ["result", null, task.id, null]);
        assertEquals("entity_ids" in record, false);
        const detached = await scopedHttp(
          A,
          workspaceA,
          "PATCH",
          `/tasks/${task.id}`,
          {
            expected_version: completed.body.task.version,
            entity_ids: [],
            change_note: "상담 대상 연결 해제",
          },
        );
        assertEquals(detached.status, 200);
        assertEquals(detached.body.entity_ids, []);
        assertEquals(
          (await scopedHttp(A, workspaceA, "GET", `/records/${record.id}`))
            .body,
          record,
        );
        assert(
          (await scopedHttp(
            A,
            workspaceA,
            "GET",
            `/records?task_id=${task.id}`,
          )).body.items.some((row: { id: string }) => row.id === record.id),
        );
        assertEquals(
          (await scopedHttp(B, workspaceB, "GET", `/records/${record.id}`))
            .status,
          404,
        );
        assertEquals(
          (await scopedHttp(A, workspaceA, "POST", "/records", {
            body: "퇴역 일반 기록",
            task_id: task.id,
          })).status,
          404,
        );
        assertEquals(
          (await scopedHttp(A, workspaceA, "PATCH", `/tasks/${task.id}`, {
            expected_version: task.version,
            entity_ids: [entity.id],
          })).status,
          409,
        );
      },
    );
    await t.step(
      "할 일 제목 검색은 부분 일치와 문자 그대로의 %/_ 및 소유자·cursor 범위를 지킨다",
      async () => {
        const keyword = `${crypto.randomUUID()}%_`;
        const ids: string[] = [];
        for (
          const title of [
            `첫 ${keyword} 고객`,
            `둘 ${keyword.toUpperCase()} 상담`,
          ]
        ) {
          ids.push(
            (await scopedHttp(A, workspaceA, "POST", "/tasks", {
              kind: "once",
              title,
            })).body.id,
          );
        }
        await scopedHttp(A, workspaceA, "POST", "/tasks", {
          kind: "once",
          title: keyword.replace("%_", "ANY"),
        });
        await scopedHttp(B, workspaceB, "POST", "/tasks", {
          kind: "once",
          title: keyword,
        });
        const path = `/tasks?keyword=${encodeURIComponent(keyword)}&limit=1`;
        const first = (await scopedHttp(A, workspaceA, "GET", path)).body;
        assertEquals(first.items.length, 1);
        assert(first.next_cursor);
        const second = (await scopedHttp(
          A,
          workspaceA,
          "GET",
          `${path}&cursor=${encodeURIComponent(first.next_cursor)}`,
        )).body;
        assertEquals(
          [...first.items, ...second.items].map((item) => item.id).sort(),
          ids.sort(),
        );
        assertEquals(second.next_cursor, null);
        assertEquals(
          (await scopedHttp(
            A,
            workspaceA,
            "GET",
            `/tasks?keyword=다른검색&limit=1&cursor=${encodeURIComponent(first.next_cursor)}`,
          )).status,
          400,
        );
        const date = "2026-10-07";
        const recurring = (await scopedHttp(A, workspaceA, "POST", "/tasks", {
          kind: "recurring",
          title: keyword,
          timezone: "Asia/Seoul",
          recurrence: { freq: "daily", starts_on: date },
        })).body;
        await scopedHttp(A, workspaceA, "POST", "/tasks", {
          kind: "recurring",
          title: "검색과 무관한 반복 할 일",
          timezone: "Asia/Seoul",
          recurrence: { freq: "daily", starts_on: date },
        });
        assertEquals(
          (await scopedHttp(
            A,
            workspaceA,
            "GET",
            `/tasks?keyword=${encodeURIComponent(keyword)}&occurrence_on=${date}`,
          )).body.items.map((
            item: { id: string },
          ) => item.id),
          [recurring.id],
        );
      },
    );
  },
);
