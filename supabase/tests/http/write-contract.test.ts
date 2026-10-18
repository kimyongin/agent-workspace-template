import { assertEquals } from "@std/assert";
import { activityWorkspaceSuite, completeHttpTask, scopedHttp } from "./_workspace-activity-fixture.ts";

activityWorkspaceSuite(
  "owned HTTP write and retired-route contracts",
  async (f, t) => {
    const { A: token, workspaceA, schema } = f;
    await t.step(
      "writes require request keys and reject client IDs and retired metadata/current upsert",
      async () => {
        for (
          const [path, content] of [
            ["/entities", { ...schema, properties: { prop_1: "입력 거부" } }],
            ["/tasks", { kind: "once", title: "입력 거부" }],
            ["/tags", { name: "입력 거부" }],
          ] as const
        ) {
          assertEquals(
            (await scopedHttp(token, workspaceA, "POST", path, content, null))
              .status,
            400,
          );
          assertEquals(
            (await scopedHttp(token, workspaceA, "POST", path, {
              id: crypto.randomUUID(),
              ...content,
              request_id: crypto.randomUUID(),
            })).status,
            400,
          );
        }
        assertEquals(
          (await scopedHttp(token, workspaceA, "POST", "/principles/current", {
            title: "과거 경로",
          })).status,
          404,
        );
        assertEquals(
          (await scopedHttp(token, workspaceA, "POST", "/records", {
            body: "퇴역 일반 기록",
          })).status,
          404,
        );
      },
    );

    await t.step(
      "retired HTTP paths return 404 and preserve their target values",
      async () => {
        const task = (await scopedHttp(token, workspaceA, "POST", "/tasks", {
          kind: "once",
          title: "retired-route-proof",
        })).body;
        const record = await completeHttpTask(
          token,
          workspaceA,
          "retired-route-proof",
        );
        const entity = (await scopedHttp(token, workspaceA, "POST", "/entities", {
          ...schema,
          source: "app",
          external_id: crypto.randomUUID(),
          properties: { prop_1: "retired-route-proof" },
        })).body;
        const taskBefore = (await scopedHttp(token, workspaceA, "GET", `/tasks/${task.id}`))
          .body;
        const recordBefore = (await scopedHttp(token, workspaceA, "GET", `/records/${record.id}`))
          .body;
        try {
          for (
            const [method, path] of [
              ["DELETE", `/tasks/${task.id}?expected_version=${task.version}`],
              [
                "DELETE",
                `/entities/${encodeURIComponent(entity.id)}?expected_version=${entity.version}`,
              ],
              ["POST", `/entities/${encodeURIComponent(entity.id)}/identity`],
              ["GET", `/records/${record.id}/index-effects`],
            ]
          ) {
            const response = await scopedHttp(
              token,
              workspaceA,
              method,
              path,
              method === "POST"
                ? {
                  source: "app",
                  external_id: "unexpected-rekey",
                  expected_version: entity.version,
                }
                : undefined,
            );
            assertEquals(response.status, 404);
          }
          assertEquals(
            (await scopedHttp(token, workspaceA, "GET", `/tasks/${task.id}`))
              .body,
            taskBefore,
          );
          assertEquals(
            (await scopedHttp(
              token,
              workspaceA,
              "GET",
              `/records/${record.id}`,
            )).body,
            recordBefore,
          );
          const retained = (await scopedHttp(
            token,
            workspaceA,
            "GET",
            `/entities/${encodeURIComponent(entity.id)}`,
          )).body;
          assertEquals([retained.id, retained.version, retained.deleted_at], [
            entity.id,
            entity.version,
            null,
          ]);
        } finally {
          await scopedHttp(
            token,
            workspaceA,
            "POST",
            `/tasks/${task.id}/delete`,
            { expected_version: task.version },
          );
          await scopedHttp(
            token,
            workspaceA,
            "DELETE",
            `/records/${record.id}?expected_version=${record.version}`,
          );
          await scopedHttp(
            token,
            workspaceA,
            "POST",
            `/entities/${encodeURIComponent(entity.id)}/delete`,
            {
              expected_version: entity.version,
            },
          );
        }
      },
    );
  },
);
