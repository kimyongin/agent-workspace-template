import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  dataModelAction,
  dataModelInput,
  dataModelPrepare,
  modelGroupAnalyze,
} from "../../functions/_shared/contracts/data-model.ts";
import { entitySchemaImportPrepare } from "../../functions/_shared/contracts/entity-schema-import.ts";
import {
  identifierRuleCreate,
  identifierRuleUpdate,
  issuerCode,
  issuerCreate,
  issuerUpdate,
  registryDelete,
} from "../../functions/_shared/contracts/entity-issuer.ts";
import {
  schemaMigrationAction,
  schemaMigrationList,
  schemaMigrationStart,
  schemaRecoveryCreate,
} from "../../functions/_shared/contracts/entity-schema-migration.ts";
import {
  schemaAnalysisRows,
  schemaChangeAction,
  schemaChangeApply,
  schemaChangeCreate,
  schemaChangeList,
  schemaChangeUpdate,
} from "../../functions/_shared/contracts/entity-schema-change.ts";
import { requestKey } from "../../functions/_shared/contracts/request.ts";
import { entityLookup, entityRestore } from "../../functions/_shared/contracts/entity.ts";
import { entityReferenceId } from "../../functions/_shared/contracts/entity-identity.ts";
// MCP 계약 테스트: 실제 OAuth 토큰과 공식 MCP 클라이언트로 도구를 호출하고, HTTP와 결과·오류 의미가 같은지 본다.
import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { businessMeta, mutationMeta } from "../../functions/_shared/contracts/change.ts";
import { id, isoDate } from "../../functions/_shared/contracts/common.ts";
import { occurrenceRecordCreate, recordListQuery, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { tagCreate, tagListQuery, tagRename } from "../../functions/_shared/contracts/tag.ts";
import { searchInput, searchResult } from "../../functions/_shared/contracts/search.ts";
import {
  occurrenceRange,
  taskComplete,
  taskCreate,
  taskListQuery,
  taskUpdate,
} from "../../functions/_shared/contracts/task.ts";
import { admin, API, call, seoulDate, signIn, SUPABASE_URL } from "../http/_client.ts";
import { claimsOf, MCP_URL, refreshMcp, registerClient, tool } from "./_mcp.ts";
import { workspaceId } from "../../functions/_shared/contracts/workspace.ts";
import { tagConnectionInput } from "../../functions/_shared/contracts/tag-connection.ts";
import {
  entitySchemaHistory,
  entitySchemaRead,
  entityTypeCreate,
  entityTypeList,
  entityTypeUpdate,
} from "../../functions/_shared/contracts/entity-type.ts";

type McpClient = Client;
const owned: {
  workspaces: { id: string; name: string; creator: string }[];
  clients: Set<string>;
  tokens: string[];
  connections: Set<McpClient>;
} = { workspaces: [], clients: new Set(), tokens: [], connections: new Set() };

// Positive calls always supply an explicit workspace. Missing-scope tests below use raw call/tool.
async function businessCall(
  token: string,
  workspace: string,
  method: string,
  path: string,
  body?: unknown,
  requestKey = crypto.randomUUID(),
) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "X-Workspace-Id": workspace,
      "content-type": "application/json",
      "Idempotency-Key": requestKey,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    headers: response.headers,
  };
}
function businessTool(
  client: McpClient,
  workspace: string,
  name: string,
  input: Record<string, unknown>,
) {
  return tool(client, name, { workspace_id: workspace, ...input });
}
async function trackedConnection(token: string) {
  const client = new Client({
    name: "workspace-activity-mcp-test",
    version: "0.0.0",
  });
  owned.connections.add(client);
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}
async function closeConnection(client: McpClient) {
  await client.close();
  owned.connections.delete(client);
}
async function cleanupOwned() {
  const failures: unknown[] = [];
  for (const client of owned.connections) {
    try {
      await closeConnection(client);
    } catch (error) {
      failures.push(error);
    }
  }
  for (const workspace of owned.workspaces) {
    try {
      await admin.begin(async (tx) => {
        const [root] = await tx`select name,created_by from app.workspaces where id=${workspace.id} for update`;
        assertEquals(root, {
          name: workspace.name,
          created_by: workspace.creator,
        });
        const members = await tx`select user_id from private.workspace_members where workspace_id=${workspace.id}`;
        assert(members.every((row) => row.user_id === workspace.creator));
        await tx`delete from pgmq.q_search_index where message->>'workspace_id'=${workspace.id}`;
        await tx`delete from pgmq.a_search_index where message->>'workspace_id'=${workspace.id}`;
        await tx`delete from app.workspaces where id=${workspace.id}`;
        assertEquals(
          (await tx`select id from app.workspaces where id=${workspace.id}`)
            .length,
          0,
        );
      });
    } catch (error) {
      failures.push(error);
    }
  }
  for (const clientId of owned.clients) {
    try {
      const secret = Deno.env.get("LOCAL_SUPABASE_SECRET_KEY");
      assert(secret);
      const response = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/oauth/clients/${encodeURIComponent(clientId)}`,
        {
          method: "DELETE",
          headers: { apikey: secret, authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      await response.body?.cancel();
      assert(response.ok || response.status === 404);
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    const sessions = [
      ...new Set(
        owned.tokens.map((token) => claimsOf(token).session_id).filter((
          id,
        ): id is string => typeof id === "string"),
      ),
    ];
    if (sessions.length) {
      await admin`delete from auth.sessions where id=any(${sessions}::uuid[])`;
    }
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) {
    throw new AggregateError(
      failures,
      "activity MCP exact owned cleanup failed",
    );
  }
}
async function setup() {
  try {
    const sessionA = await signIn("A");
    owned.tokens.push(sessionA);
    const sessionB = await signIn("B");
    owned.tokens.push(sessionB);
    const workspaces: string[] = [];
    for (const [label, session] of [["A", sessionA], ["B", sessionB]]) {
      const creator = String(claimsOf(session).sub),
        name = `activity515-mcp-${label}-${crypto.randomUUID()}`;
      const created = await call(session, "POST", "/workspaces", { name });
      if (typeof created.body?.workspace?.id === "string") {
        owned.workspaces.push({ id: created.body.workspace.id, name, creator });
      }
      assertEquals(created.status, 201);
      const workspace = created.body.workspace.id as string;
      workspaces.push(workspace);
      assertEquals(
        (await call(
          session,
          "PATCH",
          `/workspaces/${workspace}/members/${creator}`,
          {
            expected_version: 1,
            grants: [
              { target_kind: "settings", target_id: "*", access: "write" },
              { target_kind: "tasks", target_id: "*", access: "write" },
            ],
          },
        )).status,
        200,
      );
    }
    const [workspaceA, workspaceB] = workspaces;
    const kind = await businessCall(
      sessionA,
      workspaceA,
      "POST",
      "/entity-types",
      { label: "MCP 편집 자료" },
    );
    assertEquals(kind.status, 201);
    assertEquals(
      (await call(
        sessionA,
        "PATCH",
        `/workspaces/${workspaceA}/members/${claimsOf(sessionA).sub}`,
        {
          expected_version: 2,
          grants: [
            { target_kind: "settings", target_id: "*", access: "write" },
            { target_kind: "tasks", target_id: "*", access: "write" },
            {
              target_kind: "entity_type",
              target_id: kind.body.id,
              access: "write",
            },
          ],
        },
      )).status,
      200,
    );
    const tokenA = (await trackedMcpGrant(sessionA)).access_token;
    const tokenB = (await trackedMcpGrant(sessionB)).access_token;
    const mcpA = await trackedConnection(tokenA),
      mcpB = await trackedConnection(tokenB);
    return {
      sessionA,
      sessionB,
      workspaceA,
      workspaceB,
      tokenA,
      tokenB,
      mcpA,
      mcpB,
      entitySchema: { entity_type_id: kind.body.id, schema_version: 1 },
    };
  } catch (error) {
    try {
      await cleanupOwned();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "activity MCP setup and cleanup failed",
      );
    }
    throw error;
  }
}
Deno.test({
  name: "workspace activity MCP catalog and authenticated HTTP parity",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const {
      sessionA,
      sessionB,
      workspaceA,
      workspaceB,
      tokenA,
      mcpA,
      mcpB,
      entitySchema,
    } = await setup();
    // deno-lint-ignore no-explicit-any
    type JsonSchema = Record<string, any>;
    const json = (schema: z.ZodType) =>
      z.toJSONSchema(schema, {
        target: "draft-2020-12",
        io: "input",
      }) as JsonSchema;
    try {
      const completeFixtureTask = async (body: string) => {
        const task = await businessTool(mcpA, workspaceA, "create_task", {
          kind: "once",
          title: "수행 결과 원문",
        });
        assert(typeof task.id === "string");
        const completed = await businessTool(
          mcpA,
          workspaceA,
          "complete_task",
          {
            id: task.id,
            expected_version: task.version,
            body,
          },
        );
        assert(typeof completed.record?.id === "string");
        return completed.record;
      };

      await t.step(
        "할 일 수행 결과와 제목 검색은 HTTP/MCP에서 같고 다른 사용자의 연결은 거부한다",
        async () => {
          const title = `상담 ${crypto.randomUUID()}%_`;
          const task = await businessTool(mcpA, workspaceA, "create_task", {
            kind: "once",
            title,
          });
          const { record } = await businessTool(
            mcpA,
            workspaceA,
            "complete_task",
            {
              id: task.id,
              expected_version: task.version,
              body: "실제 상담 결과",
            },
          );
          assertEquals(record.record_kind, "result");
          assertEquals(record.entity_id, null);
          assertEquals(record.task_id, task.id);
          assertEquals(
            await businessTool(mcpA, workspaceA, "get_record", {
              id: record.id,
            }),
            (await businessCall(
              sessionA,
              workspaceA,
              "GET",
              `/records/${record.id}`,
            )).body,
          );
          assertEquals(
            (await businessTool(mcpA, workspaceA, "get_task", { id: task.id }))
              .status,
            "done",
          );
          const query = { keyword: title, limit: 20 };
          assertEquals(
            await businessTool(mcpA, workspaceA, "list_tasks", query),
            (await businessCall(
              sessionA,
              workspaceA,
              "GET",
              `/tasks?keyword=${encodeURIComponent(title)}&limit=20`,
            ))
              .body,
          );
          assertEquals(
            (await businessTool(mcpB, workspaceB, "complete_task", {
              id: task.id,
              expected_version: task.version,
              body: "금지",
            })).error.code,
            "not_found",
          );
          const date = seoulDate();
          const recurring = await businessTool(
            mcpA,
            workspaceA,
            "create_task",
            {
              kind: "recurring",
              title,
              timezone: "Asia/Seoul",
              recurrence: { freq: "daily", starts_on: date },
            },
          );
          await businessTool(mcpA, workspaceA, "create_task", {
            kind: "recurring",
            title: "다른 반복 업무",
            timezone: "Asia/Seoul",
            recurrence: { freq: "daily", starts_on: date },
          });
          const occurrences = await businessTool(
            mcpA,
            workspaceA,
            "list_tasks",
            { keyword: title, occurrence_on: date },
          );
          assertEquals(
            occurrences.items.map((item: { id: string }) => item.id),
            [recurring.id],
          );
          assertEquals(
            occurrences,
            (await businessCall(
              sessionA,
              workspaceA,
              "GET",
              `/tasks?keyword=${encodeURIComponent(title)}&occurrence_on=${date}`,
            )).body,
          );
        },
      );

      await t.step(
        "기록 HTTP 편집·MCP 재시도는 추가 로그 없이 최신 메모·사건을 보존한다",
        async () => {
          const record = await completeFixtureTask(crypto.randomUUID());
          const entity = await businessTool(mcpA, workspaceA, "create_entity", {
            ...entitySchema,
            properties: { prop_1: "메모 편집 근거" },
          });
          const historyBefore = await businessTool(
            mcpA,
            workspaceA,
            "list_records",
            {
              record_kind: "change",
              limit: 100,
            },
          );
          const event = historyBefore.items.find((
            r: { change?: { target_id: string } },
          ) => r.change?.target_id === entity.id);
          assert(event);
          for (const row of [record, event]) {
            const patch = {
              expected_version: row.version,
              body: `${row.body}\n정정 설명`,
            };
            const web = await businessCall(
              sessionA,
              workspaceA,
              "PATCH",
              `/records/${row.id}`,
              patch,
            );
            assertEquals(web.status, 200);
            assertEquals(
              (await businessTool(mcpA, workspaceA, "update_record", {
                id: row.id,
                ...patch,
              })).error.code,
              "conflict",
            );
            assertEquals(
              await businessTool(mcpA, workspaceA, "update_record", {
                id: row.id,
                expected_version: web.body.version,
                body: web.body.body,
              }),
              web.body,
            );
            assertEquals(
              (await businessCall(
                sessionA,
                workspaceA,
                "GET",
                `/records/${row.id}`,
              )).body,
              await businessTool(mcpA, workspaceA, "get_record", {
                id: row.id,
              }),
            );
            assertEquals(web.body.change, row.change);
            assertEquals(web.body.occurred_at, row.occurred_at);
            assertEquals(
              (await businessCall(
                sessionB,
                workspaceB,
                "PATCH",
                `/records/${row.id}`,
                {
                  expected_version: 2,
                  body: "타인 수정",
                },
              )).status,
              404,
            );
            assertEquals(
              (await businessTool(mcpB, workspaceB, "update_record", {
                id: row.id,
                expected_version: 2,
                body: "타인 수정",
              })).error.code,
              "not_found",
            );
          }
          const historyAfter = await businessTool(
            mcpA,
            workspaceA,
            "list_records",
            {
              record_kind: "change",
              limit: 100,
            },
          );
          assertEquals(
            historyAfter.items.map((r: { id: string }) => r.id),
            historyBefore.items.map((r: { id: string }) => r.id),
          );
          assertEquals(
            (await businessCall(
              sessionA,
              workspaceA,
              "PATCH",
              `/records/${event.id}`,
              {
                expected_version: 2,
                occurred_at: "2020-01-01T00:00:00Z",
              },
            )).status,
            400,
          );
          assertEquals(
            (await businessTool(mcpA, workspaceA, "update_record", {
              id: event.id,
              expected_version: 2,
              occurred_at: "2020-01-01T00:00:00Z",
            }))
              .error.code,
            "invalid_input",
          );
        },
      );

      await t.step(
        "검색: HTTP/MCP 본문 키워드·원문 최소 응답·잘못된 입력 동등성",
        async () => {
          const marker = crypto.randomUUID(),
            r = await completeFixtureTask(marker + " 근거");
          const q = { query: marker, mode: "keyword" };
          const history = await businessTool(mcpA, workspaceA, "list_records", {
            record_kind: "change",
            limit: 100,
          });
          const createdEvent = history.items.find((
            item: { change?: { target_id: string; action: string } },
          ) => item.change?.target_id === r.id && item.change?.action === "create");
          assertEquals(createdEvent, undefined);
          const found = searchResult.parse(
            await businessTool(mcpA, workspaceA, "search", q),
          );
          assertEquals(
            found,
            (await businessCall(sessionA, workspaceA, "POST", "/search", q))
              .body,
          );
          assertEquals(found.items.map((x) => x.id).sort(), [r.id]);
          assertEquals("body" in found.items[0], false);
          assertEquals(
            (await businessTool(mcpB, workspaceB, "search", q)).items,
            [],
          );
          // Semantic auto/fallback belongs to the dedicated #516 provider fixture;
          // this activity transport case stays on explicit keyword reads.
          for (
            const bad of [{ query: " " }, { query: "가".repeat(201) }, {
              query: marker,
              kinds: ["record", "record"],
            }, {
              query: marker,
              from: "2026-10-04T00:00:00Z",
              to: "2026-10-03T00:00:00Z",
            }, { query: marker, owner_id: crypto.randomUUID() }]
          ) {
            const web = await businessCall(
                sessionA,
                workspaceA,
                "POST",
                "/search",
                bad,
              ),
              mcp = await businessTool(mcpA, workspaceA, "search", bad);
            assertEquals(web.status, 400);
            assertEquals(mcp.error, web.body);
          }
        },
      );

      const CONTROL_TOOLS = [
        "get_workspace_membership",
        "list_deleted_workspaces",
        "get_workspace_lifecycle",
        "delete_workspace",
        "restore_workspace",
        "list_workspaces",
        "create_workspace",
        "get_workspace",
        "list_workspace_grant_targets",
        "list_workspace_members",
        "update_workspace_member",
        "remove_workspace_member",
        "leave_workspace",
        "list_workspace_invitations",
        "invite_workspace_member",
        "cancel_workspace_invitation",
        "accept_workspace_invitation",
        "retry_workspace_invitation_delivery",
      ];
      const EXPECTED_TOOLS = [
        ...CONTROL_TOOLS,
        "get_status",
        "list_indexing_issues",
        "get_business_settings",
        "update_business_settings",
        "prepare_record_memo",
        "create_entity",
        "delete_entity_issuer",
        "delete_entity_identifier_rule",
        "list_entity_issuers",
        "create_entity_issuer",
        "update_entity_issuer",
        "list_entity_identifier_rules",
        "create_entity_identifier_rule",
        "update_entity_identifier_rule",
        "lookup_entity_identifier",
        "restore_entity",
        "delete_entity",
        "get_entity",
        "list_entities",
        "update_entity",
        "list_entity_type_icons",
        "list_entity_types",
        "get_entity_type",
        "create_entity_type",
        "update_entity_type",
        "get_entity_schema",
        "export_data_model",
        "preview_data_model",
        "prepare_data_model",
        "list_data_model_changes",
        "get_data_model_change",
        "apply_data_model",
        "analyze_data_model",
        "cancel_data_model",
        "retry_data_model",
        "prepare_entity_schema_import",
        "list_entity_relation_definitions",
        "get_entity_relation_definition",
        "create_entity_relation_definition",
        "update_entity_relation_definition",
        "delete_entity_relation_definition",
        "list_entity_relation_links",
        "list_entity_relation_candidates",
        "connect_entity_relation",
        "unlink_entity_relation",
        "replace_entity_relation",
        "create_and_link_entity",
        "list_entity_schema_versions",
        "create_entity_schema_change",
        "get_entity_schema_change",
        "list_entity_schema_changes",
        "update_entity_schema_change",
        "analyze_entity_schema_change",
        "apply_entity_schema_change",
        "discard_entity_schema_change",
        "list_entity_schema_analysis_rows",
        "start_entity_schema_migration",
        "get_entity_schema_migration",
        "list_entity_schema_migrations",
        "cancel_entity_schema_migration",
        "retry_entity_schema_migration",
        "create_entity_schema_recovery",
        "complete_task",
        "restore_task",
        "set_tag_connections",
        "create_tag",
        "create_task",
        "delete_record",
        "delete_tag",
        "delete_task",
        "get_record",
        "get_task",
        "list_occurrences",
        "list_records",
        "list_tags",
        "list_tasks",
        "record_occurrence",
        "rename_tag",
        "resume_task",
        "search",
        "stop_task",
        "update_record",
        "update_task",
      ].sort();

      await t.step(
        "퇴역 적용 키: HTTP/MCP 엄격 거부 후 정상 완료·회차·기록 입력은 메모를 보존한다",
        async () => {
          const once = await businessTool(mcpA, workspaceA, "create_task", {
            kind: "once",
            title: "한 번",
          });
          const result = {
            expected_version: 1,
            body: "원칙 참고는 필요한 설명만 본문으로",
          };
          const bad = {
            ...result,
            applied_principle_ids: [crypto.randomUUID()],
          };
          assertEquals(
            (await businessCall(
              sessionA,
              workspaceA,
              "POST",
              `/tasks/${once.id}/complete`,
              bad,
            )).status,
            400,
          );
          assertEquals(
            (await businessTool(mcpA, workspaceA, "complete_task", {
              id: once.id,
              ...bad,
            })).error.code,
            "invalid_input",
          );
          assertEquals(
            (await businessTool(mcpA, workspaceA, "get_task", { id: once.id }))
              .status,
            "open",
          );
          const done = await businessTool(mcpA, workspaceA, "complete_task", {
            id: once.id,
            ...result,
          });
          assertEquals(done.record.body, result.body);
          const recurring = await businessTool(
            mcpA,
            workspaceA,
            "create_task",
            {
              kind: "recurring",

              title: "매일",
              recurrence: { freq: "daily", starts_on: "2020-01-01" },
              timezone: "Asia/Seoul",
            },
          );
          const content = { body: "참고 메모" };
          assertEquals(
            (await businessCall(
              sessionA,
              workspaceA,
              "POST",
              `/tasks/${recurring.id}/occurrences/2020-01-01/records`,
              {
                ...content,
                applied_principle_ids: [],
              },
            )).status,
            400,
          );
          const occurrence = await businessCall(
            sessionA,
            workspaceA,
            "POST",
            `/tasks/${recurring.id}/occurrences/2020-01-01/records`,
            content,
          );
          assertEquals(occurrence.status, 201);
          assertEquals(
            (await businessTool(mcpA, workspaceA, "get_record", {
              id: occurrence.body.id,
            })).body,
            content.body,
          );
          assertEquals(
            (await businessCall(
              sessionA,
              workspaceA,
              "POST",
              "/records",
              content,
            )).status,
            404,
          );
          const direct = await completeFixtureTask(content.body);
          assertEquals(
            (await businessTool(mcpA, workspaceA, "update_record", {
              id: direct.id,
              expected_version: direct.version,
              applied_principle_ids: [],
            }))
              .error.code,
            "invalid_input",
          );
          assertEquals(
            (await businessTool(mcpA, workspaceA, "get_record", {
              id: direct.id,
            })).body,
            content.body,
          );
        },
      );

      await t.step("MCP 토큰: aud가 MCP URL이고 client_id가 있다", () => {
        const c = claimsOf(tokenA);
        assertEquals(c.aud, MCP_URL);
        assert(typeof c.client_id === "string" && c.client_id.length > 0);
        return Promise.resolve();
      });

      await t.step(
        "태그: HTTP/MCP 왕복·중복 이름·버전 충돌·워크스페이스 격리",
        async () => {
          const name = "Tag" + crypto.randomUUID().slice(0, 20);
          const p = await businessCall(sessionA, workspaceA, "POST", "/tags", {
            name,
          });
          assertEquals(p.status, 201);
          const duplicate = await businessTool(mcpA, workspaceA, "create_tag", {
            name: name.toLowerCase(),
          });
          assertEquals(duplicate.error.code, "conflict");
          const renamed = await businessTool(mcpA, workspaceA, "rename_tag", {
            id: p.body.id,
            name: "정정" + crypto.randomUUID().slice(0, 20),
            expected_version: 1,
          });
          assertEquals(renamed.version, 2);
          assertEquals(
            (await businessTool(mcpB, workspaceB, "rename_tag", {
              id: p.body.id,
              name: "다른 사용자",
              expected_version: 2,
            })).error.code,
            "not_found",
          );
          const httpConflict = await businessCall(
            sessionA,
            workspaceA,
            "PATCH",
            `/tags/${p.body.id}`,
            {
              name,
              expected_version: 1,
            },
          );
          assertEquals(httpConflict.status, 409);
          assertEquals(
            (await businessTool(mcpA, workspaceA, "delete_tag", {
              id: p.body.id,
              expected_version: 2,
            })).deleted,
            p.body.id,
          );
        },
      );

      await t.step(
        "활동 다중 태그 OR는 독립 연결 뒤 HTTP/MCP에서 페이지 전에 적용된다",
        async () => {
          for (
            const [kind, listTool, targetKind] of [[
              "tasks",
              "list_tasks",
              "task",
            ], [
              "records",
              "list_records",
              "record",
            ]] as const
          ) {
            const tags = await Promise.all(
              [0, 1].map(() =>
                businessTool(mcpA, workspaceA, "create_tag", {
                  scope: targetKind,
                  name: crypto.randomUUID().slice(0, 30),
                })
              ),
            );
            const rows = [];
            for (const tag of tags) {
              const row = kind === "tasks"
                ? await businessTool(mcpA, workspaceA, "create_task", {
                  kind: "once",
                  title: "다중 분류",
                })
                : await completeFixtureTask("다중 분류");
              const connected = await businessTool(
                mcpA,
                workspaceA,
                "set_tag_connections",
                {
                  request_key: crypto.randomUUID(),
                  target_kind: targetKind,
                  target_id: row.id,
                  expected_version: row.version,
                  tag_ids: [tag.id],
                },
              );
              assertEquals(connected.tag_ids, [tag.id]);
              rows.push(row);
            }
            const filter = { tag_ids: tags.map((tag) => tag.id), limit: 1 };
            const http = await businessCall(
              sessionA,
              workspaceA,
              "GET",
              `/${kind}?tag_ids=${filter.tag_ids.join(",")}&limit=1`,
            );
            const mcp = await businessTool(mcpA, workspaceA, listTool, filter);
            assertEquals(http.body, mcp);
            const second = await businessTool(mcpA, workspaceA, listTool, {
              ...filter,
              cursor: mcp.next_cursor,
            });
            assertEquals(
              new Set(
                [...mcp.items, ...second.items].map((row: { id: string }) => row.id),
              ),
              new Set(rows.map((row) => row.id)),
            );
            assertEquals(
              (await businessTool(mcpB, workspaceB, listTool, filter)).items,
              [],
            );
            assertEquals(
              (await businessTool(mcpA, workspaceA, listTool, {
                tag_id: tags[0].id,
              })).items.length,
              1,
            );
          }
        },
      );

      await t.step(
        "완료·회차는 초기 태그를 거부하고 저장된 결과의 분류는 HTTP/MCP가 같다",
        async () => {
          const tag = await businessTool(mcpA, workspaceA, "create_tag", {
            scope: "record",
            name: crypto.randomUUID().slice(0, 30),
          });
          const once = await businessTool(mcpA, workspaceA, "create_task", {
            kind: "once",
            title: "실행",
          });
          for (const tag_ids of [[], [tag.id]]) {
            assertEquals(
              (await businessCall(
                sessionA,
                workspaceA,
                "POST",
                `/tasks/${once.id}/complete`,
                {
                  body: "분류",
                  expected_version: once.version,
                  tag_ids,
                },
              )).status,
              400,
            );
            assertEquals(
              (await businessTool(mcpA, workspaceA, "complete_task", {
                id: once.id,
                expected_version: once.version,
                body: "분류",
                tag_ids,
              })).error.code,
              "invalid_input",
            );
          }
          const done = await businessCall(
            sessionA,
            workspaceA,
            "POST",
            `/tasks/${once.id}/complete`,
            {
              body: "분류",
              expected_version: once.version,
            },
          );
          assertEquals(done.status, 200);
          assertEquals(done.body.record.tag_ids, []);
          const connected = await businessTool(
            mcpA,
            workspaceA,
            "set_tag_connections",
            {
              request_key: crypto.randomUUID(),
              target_kind: "record",
              target_id: done.body.record.id,
              expected_version: done.body.record.version,
              tag_ids: [tag.id],
            },
          );
          assertEquals(connected.tag_ids, [tag.id]);
          assertEquals(
            (await businessCall(
              sessionA,
              workspaceA,
              "GET",
              `/records/${done.body.record.id}`,
            )).body.tag_ids,
            [tag.id],
          );
          const repeat = await businessTool(mcpA, workspaceA, "create_task", {
            kind: "recurring",
            title: "반복",
            recurrence: { freq: "daily", starts_on: "2020-01-01" },
            timezone: "Asia/Seoul",
          });
          assertEquals(
            (await businessTool(mcpA, workspaceA, "record_occurrence", {
              task_id: repeat.id,
              date: "2020-01-01",
              body: "회차",
              tag_ids: [],
            })).error.code,
            "invalid_input",
          );
          const occurrence = await businessTool(
            mcpA,
            workspaceA,
            "record_occurrence",
            {
              task_id: repeat.id,
              date: "2020-01-01",
              body: "회차",
            },
          );
          const web = await businessCall(
            sessionA,
            workspaceA,
            "POST",
            "/tag-connections",
            {
              target_kind: "record",
              target_id: occurrence.id,
              expected_version: occurrence.version,
              tag_ids: [tag.id],
            },
          );
          assertEquals(web.status, 200);
          assertEquals(
            (await businessTool(mcpA, workspaceA, "get_record", {
              id: occurrence.id,
            })).tag_ids,
            [tag.id],
          );
          const foreign = await businessTool(mcpB, workspaceB, "create_tag", {
            scope: "record",
            name: crypto.randomUUID().slice(0, 30),
          });
          assertEquals(
            (await businessTool(mcpA, workspaceA, "set_tag_connections", {
              request_key: crypto.randomUUID(),
              target_kind: "record",
              target_id: occurrence.id,
              expected_version: web.body.version,
              tag_ids: [foreign.id],
            })).error.code,
            "invalid_reference",
          );
          assertEquals(
            (await businessTool(mcpA, workspaceA, "update_record", {
              id: occurrence.id,
              expected_version: web.body.version,
              body: "본문",
              tag_ids: [],
            })).error.code,
            "invalid_input",
          );
        },
      );

      await t.step(
        "토큰 교차 사용: 웹 세션 토큰은 MCP에서, MCP 토큰은 HTTP API에서 401",
        async () => {
          const web = await fetch(MCP_URL, {
            method: "POST",
            headers: {
              authorization: `Bearer ${sessionA}`,
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/list",
            }),
          });
          assertEquals(web.status, 401);
          assertEquals((await web.json()).code, "unauthenticated");
          assertEquals((await call(tokenA, "GET", "/tasks")).status, 401);
          assertEquals(API.endsWith("/api"), true);
        },
      );

      await t.step(
        "동적 등록: loopback이 아닌 HTTP redirect는 거부",
        async () => {
          const bad = await registerClient("http://attacker.example/callback");
          if (typeof bad.body.client_id === "string") {
            owned.clients.add(bad.body.client_id);
          }
          assert(bad.status >= 400, String(bad.status));
        },
      );

      await t.step(
        "tools/list: 계약의 도구 이름과 contracts JSON Schema",
        async () => {
          const { tools } = await mcpA.listTools();
          assertEquals(tools.some((t) => t.name.includes("principle")), false);
          assertEquals(tools.map((t) => t.name).sort(), EXPECTED_TOOLS);
          const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
          const foundationContracts = {
            delete_entity_issuer: registryDelete.extend({
              code: issuerCode,
              request_key: requestKey,
            }),
            delete_entity_identifier_rule: registryDelete.extend({
              rule_id: z.string().uuid(),
              request_key: requestKey,
            }),
            list_entity_issuers: z.strictObject({}),
            create_entity_issuer: issuerCreate.extend({
              request_key: requestKey,
            }),
            update_entity_issuer: issuerUpdate.extend({
              code: issuerCode,
              request_key: requestKey,
            }),
            list_entity_identifier_rules: z.strictObject({
              source: issuerCode,
            }),
            create_entity_identifier_rule: identifierRuleCreate.extend({
              source: issuerCode,
              request_key: requestKey,
            }),
            update_entity_identifier_rule: identifierRuleUpdate.extend({
              rule_id: z.string().uuid(),
              request_key: requestKey,
            }),
            lookup_entity_identifier: entityLookup,
            restore_entity: entityRestore.extend({
              id: entityReferenceId,
              request_key: requestKey,
            }),
            list_entity_type_icons: z.strictObject({}),
            list_entity_types: entityTypeList,
            get_entity_type: z.strictObject({ type_id: z.string().uuid() }),
            create_entity_type: entityTypeCreate.extend({
              request_key: requestKey,
            }),
            update_entity_type: entityTypeUpdate.safeExtend({
              type_id: z.string().uuid(),
              request_key: requestKey,
            }),
            get_entity_schema: entitySchemaRead,
            export_data_model: z.strictObject({}),
            preview_data_model: dataModelInput,
            prepare_data_model: dataModelPrepare.extend({
              request_key: requestKey,
            }),
            list_data_model_changes: z.strictObject({
              limit: z.number().int().min(1).max(100).default(20),
              cursor: z.string().optional(),
            }),
            get_data_model_change: z.strictObject({ id: z.string().uuid() }),
            apply_data_model: dataModelAction.extend({
              id: z.string().uuid(),
              request_key: requestKey,
            }),
            analyze_data_model: modelGroupAnalyze.extend({
              id: z.string().uuid(),
              request_key: requestKey,
            }),
            cancel_data_model: dataModelAction.extend({
              id: z.string().uuid(),
              request_key: requestKey,
            }),
            retry_data_model: dataModelAction.extend({
              id: z.string().uuid(),
              request_key: requestKey,
            }),
            prepare_entity_schema_import: entitySchemaImportPrepare.safeExtend({
              request_key: requestKey,
            }),
            list_entity_schema_versions: entitySchemaHistory,
            create_entity_schema_change: schemaChangeCreate.extend({
              type_id: z.string().uuid(),
              request_key: requestKey,
            }),
            update_entity_schema_change: schemaChangeUpdate.extend({
              type_id: z.string().uuid(),
              change_id: z.string().uuid(),
              request_key: requestKey,
            }),
            get_entity_schema_change: z.strictObject({
              type_id: z.string().uuid(),
              change_id: z.string().uuid(),
            }),
            list_entity_schema_analysis_rows: schemaAnalysisRows.extend({
              type_id: z.string().uuid(),
              change_id: z.string().uuid(),
            }),
            start_entity_schema_migration: schemaMigrationStart.extend({
              type_id: z.string().uuid(),
              change_id: z.string().uuid(),
              request_key: requestKey,
            }),
            create_entity_schema_recovery: schemaRecoveryCreate.extend({
              job_id: z.string().uuid(),
              request_key: requestKey,
            }),
            get_entity_schema_migration: z.strictObject({
              job_id: z.string().uuid(),
            }),
            list_entity_schema_migrations: schemaMigrationList,
            cancel_entity_schema_migration: schemaMigrationAction.extend({
              job_id: z.string().uuid(),
              request_key: requestKey,
            }),
            retry_entity_schema_migration: schemaMigrationAction.extend({
              job_id: z.string().uuid(),
              request_key: requestKey,
            }),
            list_entity_schema_changes: schemaChangeList.extend({
              type_id: z.string().uuid(),
            }),
            analyze_entity_schema_change: schemaChangeAction.extend({
              type_id: z.string().uuid(),
              change_id: z.string().uuid(),
              request_key: requestKey,
            }),
            discard_entity_schema_change: schemaChangeAction.extend({
              type_id: z.string().uuid(),
              change_id: z.string().uuid(),
              request_key: requestKey,
            }),
            apply_entity_schema_change: schemaChangeApply.extend({
              type_id: z.string().uuid(),
              change_id: z.string().uuid(),
              request_key: requestKey,
            }),
          };
          for (const [name, schema] of Object.entries(foundationContracts)) {
            assertEquals(
              byName[name].inputSchema as unknown,
              z.toJSONSchema(
                z.strictObject({
                  ...(schema as z.ZodObject).shape,
                  workspace_id: workspaceId,
                }),
                {
                  target: "draft-2020-12",
                  io: "input",
                },
              ),
            );
          }
          // 목록·기록 입력은 contracts schema를 그대로 노출한다.
          assertEquals(
            byName.list_tasks.inputSchema as unknown,
            z.toJSONSchema(
              taskListQuery.safeExtend({ workspace_id: workspaceId }),
              {
                target: "draft-2020-12",
                io: "input",
              },
            ),
          );
          assertEquals(byName.create_record, undefined);
          assertEquals(
            byName.set_tag_connections.inputSchema.oneOf,
            tagConnectionInput.options.map((branch) =>
              json(
                branch.extend({
                  request_key: requestKey,
                  workspace_id: workspaceId,
                }),
              )
            ),
          );
          for (const tool of tools) {
            assertEquals(tool.inputSchema.type, "object", tool.name);
            if (!CONTROL_TOOLS.includes(tool.name)) {
              assert(
                tool.inputSchema.required?.includes("workspace_id"),
                `${tool.name} requires explicit workspace`,
              );
            }
          }
          assertEquals(
            byName.preview_data_model.annotations?.readOnlyHint,
            true,
          );
          assertEquals(
            byName.prepare_entity_schema_import.annotations?.readOnlyHint,
            true,
          );
          assertEquals(byName.get_task.annotations?.readOnlyHint, true);
          assertEquals(byName.delete_task.annotations?.destructiveHint, true);
        },
      );

      await t.step(
        "tools/list: 업무 쓰기는 contracts 속성에 대상과 필수 요청 키를 더하고, 할 일 생성은 두 종류 입력의 합집합",
        async () => {
          const { tools } = await mcpA.listTools();
          const byName = Object.fromEntries(
            tools.map((t) => [t.name, t.inputSchema as JsonSchema]),
          );
          const idOnly = { id: json(id) };
          const mutationVersion = json(
            z.strictObject({
              expected_version: z.number().int().min(1),
              ...mutationMeta,
            }),
          ).properties;
          const businessVersion = json(
            z.strictObject({
              expected_version: z.number().int().min(1),
              ...businessMeta,
            }),
          ).properties;
          const expected: Record<string, Record<string, unknown>> = {
            list_tasks: json(taskListQuery).properties,
            list_records: json(recordListQuery).properties,
            create_tag: json(tagCreate).properties,
            list_tags: json(tagListQuery).properties,
            search: json(searchInput).properties,
            rename_tag: { ...idOnly, ...json(tagRename).properties },
            delete_tag: { ...idOnly, ...mutationVersion },
            get_task: idOnly,
            get_record: idOnly,
            update_task: { ...idOnly, ...json(taskUpdate).properties },
            update_record: { ...idOnly, ...json(recordUpdate).properties },
            complete_task: { ...idOnly, ...json(taskComplete).properties },
            list_occurrences: {
              ...idOnly,
              ...json(occurrenceRange).properties,
            },
            stop_task: { ...idOnly, ...businessVersion },
            resume_task: { ...idOnly, ...businessVersion },
            delete_task: { ...idOnly, ...businessVersion },
            restore_task: { ...idOnly, ...businessVersion },
            delete_record: {
              ...idOnly,
              ...json(
                z.strictObject({ expected_version: z.number().int().min(1) }),
              ).properties,
            },
            // 회차 기록: 기록 생성 입력 + id + date
            record_occurrence: {
              task_id: json(z.object({ task_id: id })).properties.task_id,
              date: json(z.object({
                date: isoDate.describe(
                  "실제로 수행한 회차 날짜. 할 일의 시간대 기준 오늘까지 가능하며 미래 날짜는 불가.",
                ),
              })).properties.date,
              ...json(occurrenceRecordCreate).properties,
            },
          };
          for (const [name, properties] of Object.entries(expected)) {
            const keyedProps = /^(create_|update_|delete_|rename_|complete_|stop_|resume_|restore_|record_occurrence$)/
                .test(name)
              ? {
                ...properties,
                request_key: json(z.strictObject({ request_key: requestKey })).properties
                  .request_key,
              }
              : properties;
            const props = {
              ...keyedProps,
              workspace_id: json(z.strictObject({ workspace_id: workspaceId })).properties.workspace_id,
            };
            assert(
              byName[name].required.includes("workspace_id"),
              `${name} requires explicit workspace`,
            );
            assertEquals(
              Object.keys(byName[name].properties).sort(),
              Object.keys(props).sort(),
              `${name} 속성 이름`,
            );
            for (const [key, schema] of Object.entries(props)) {
              if (key === "id") continue; // id는 어댑터가 더한 데이터 ID(date는 contracts의 isoDate와 비교)
              assertEquals(
                byName[name].properties[key],
                schema,
                `${name}.${key}`,
              );
            }
            assertEquals(
              byName[name].additionalProperties,
              false,
              `${name}는 허용 필드만`,
            );
          }
          // 할 일 생성: MCP는 최상위 object로 펼쳐 알리므로 두 종류(once·recurring) 입력 필드의 합집합과 같아야 한다.
          const branches = (json(taskCreate).oneOf ?? json(taskCreate).anyOf) as JsonSchema[];
          assertEquals(
            byName.create_task.oneOf,
            taskCreate.options.map((branch) =>
              json(
                branch.extend({
                  request_key: requestKey,
                  workspace_id: workspaceId,
                }),
              )
            ),
          );
          const union = new Set([
            ...branches.flatMap((b) => Object.keys(b.properties)),
            "request_key",
            "workspace_id",
          ]);
          assertEquals(
            Object.keys(byName.create_task.properties).sort(),
            [...union].sort(),
          );
          const requiredEverywhere = branches.map((b) => new Set(b.required as string[]))
            .reduce((a, b) => new Set([...a].filter((k) => b.has(k))));
          requiredEverywhere.add("request_key");
          requiredEverywhere.add("workspace_id");
          assertEquals(
            [...(byName.create_task.required as string[])].sort(),
            [...requiredEverywhere].sort(),
          );
        },
      );

      await t.step(
        "웹(HTTP)에서 만든 할 일을 MCP로 조회·완료하고 웹에서 결과를 확인한다",
        async () => {
          const created = await businessCall(
            sessionA,
            workspaceA,
            "POST",
            "/tasks",
            {
              kind: "once",
              title: "웹에서 만든 할 일",
            },
          );
          assertEquals(created.status, 201);
          const viaMcp = await businessTool(mcpA, workspaceA, "get_task", {
            id: created.body.id,
          });
          assertEquals(viaMcp.title, "웹에서 만든 할 일");
          const listed = await businessTool(mcpA, workspaceA, "list_tasks", {
            status: "open",
            limit: 100,
          });
          assert(
            listed.items.some((t: { id: string }) => t.id === created.body.id),
          );

          const done = await businessTool(mcpA, workspaceA, "complete_task", {
            id: created.body.id,
            expected_version: 1,
            body: "에이전트가 완료",
          });
          assertEquals(done.task.status, "done");
          const web = await businessCall(
            sessionA,
            workspaceA,
            "GET",
            `/tasks/${created.body.id}`,
          );
          assertEquals(web.body.status, "done");
          assertEquals(web.body.result_record.body, "에이전트가 완료");
        },
      );

      await t.step(
        "MCP에서 만든 기록과 반복 회차를 HTTP가 같게 본다",
        async () => {
          const rec = await completeFixtureTask("MCP 기록");
          assertEquals(
            (await businessCall(
              sessionA,
              workspaceA,
              "GET",
              `/records/${rec.id}`,
            )).body,
            rec,
          );

          const t = await businessTool(mcpA, workspaceA, "create_task", {
            kind: "recurring",
            title: "스트레칭",
            recurrence: { freq: "daily", starts_on: seoulDate(-2) },
            timezone: "Asia/Seoul",
          });
          assertEquals(t.status, "active");
          await businessTool(mcpA, workspaceA, "record_occurrence", {
            task_id: t.id,
            date: seoulDate(-1),
            body: "함",
          });
          const range = { from: seoulDate(-2), to: seoulDate(1) };
          const viaMcp = await businessTool(
            mcpA,
            workspaceA,
            "list_occurrences",
            { id: t.id, ...range },
          );
          const viaHttp = await businessCall(
            sessionA,
            workspaceA,
            "GET",
            `/tasks/${t.id}/occurrences?from=${range.from}&to=${range.to}`,
          );
          assertEquals(viaMcp, viaHttp.body);
          assertEquals(viaMcp.items.map((o: { status: string }) => o.status), [
            "missed",
            "done",
            "due",
            "upcoming",
          ]);
        },
      );

      await t.step(
        "오류 의미가 HTTP와 같다(code·retryable·fields)",
        async () => {
          const t = await businessTool(mcpA, workspaceA, "create_task", {
            kind: "once",
            title: "오류 시험",
          });

          const bad = await businessTool(mcpA, workspaceA, "create_task", {
            kind: "once",
            title: "가".repeat(101),
          });
          const badHttp = await businessCall(
            sessionA,
            workspaceA,
            "POST",
            "/tasks",
            {
              kind: "once",
              title: "가".repeat(101),
            },
          );
          assertEquals(bad.error.code, "invalid_input");
          assertEquals(bad.error, badHttp.body);

          const extra = await businessTool(mcpA, workspaceA, "update_task", {
            change_note: "테스트 변경 이유",
            id: t.id,
            expected_version: 1,
            status: "done",
          });
          assertEquals(extra.error.code, "invalid_input");
          assert(
            extra.error.fields.some((f: { path: string }) => f.path === "status"),
          );
          assertEquals(
            extra.error,
            (await businessCall(
              sessionA,
              workspaceA,
              "PATCH",
              `/tasks/${t.id}`,
              {
                change_note: "테스트 변경 이유",
                expected_version: 1,
                status: "done",
              },
            )).body,
          );

          const stale = await businessTool(mcpA, workspaceA, "update_task", {
            change_note: "테스트 변경 이유",
            id: t.id,
            expected_version: 9,
            title: "x",
          });
          assertEquals(
            stale.error,
            (await businessCall(
              sessionA,
              workspaceA,
              "PATCH",
              `/tasks/${t.id}`,
              {
                change_note: "테스트 변경 이유",
                expected_version: 9,
                title: "x",
              },
            )).body,
          );
          assertEquals(stale.error.code, "conflict");

          const future = await businessTool(
            mcpA,
            workspaceA,
            "record_occurrence",
            {
              task_id: t.id,
              date: seoulDate(),
              body: "a",
            },
          );
          assertEquals(future.error.code, "conflict"); // 일회성 할 일에는 회차가 없다

          // 다른 사용자의 항목은 존재 여부를 드러내지 않는다.
          const other = await businessTool(mcpB, workspaceB, "get_task", {
            id: t.id,
          });
          assertEquals(other.error.code, "not_found");
          assertEquals(
            other.error,
            (await businessCall(sessionB, workspaceB, "GET", `/tasks/${t.id}`))
              .body,
          );
          const notUuid = await businessTool(mcpA, workspaceA, "get_task", {
            id: "nope",
          });
          assertEquals(
            notUuid.error,
            (await businessCall(sessionA, workspaceA, "GET", "/tasks/nope"))
              .body,
          );
          assertEquals(notUuid.error.code, "not_found");
        },
      );

      await t.step("같은 버전의 완료 요청은 한 번만 실행된다", async () => {
        const t = await businessTool(mcpA, workspaceA, "create_task", {
          kind: "once",
          title: "재시도",
        });
        const args = {
          id: t.id,
          expected_version: 1,
          body: "완료",
        };
        const [x, y] = await Promise.all([
          businessTool(mcpA, workspaceA, "complete_task", args),
          businessTool(mcpA, workspaceA, "complete_task", args),
        ]);
        assertEquals([x, y].filter((r) => !r.error).length, 1);
        assertEquals([x, y].find((r) => r.error).error.code, "conflict");
      });

      await t.step(
        "제품 스킬이 안내하는 도구 이름이 모두 tools/list에 있다",
        async () => {
          const skill = await Deno.readTextFile(
            new URL(
              "../../../plugins/workspace/skills/workspace/SKILL.md",
              import.meta.url,
            ),
          );
          const table = skill.split("| 하려는 일 | 도구 |\n")[1]?.split(
            "\n\n",
          )[0];
          assert(table, "스킬의 도구 안내 표가 없음");
          const toolColumns = table.split("\n").map((line) => line.split("|")[2] ?? "").join("\n");
          const mentioned = [...toolColumns.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
          const { tools } = await mcpA.listTools();
          const names = new Set(tools.map((t) => t.name));
          for (const n of new Set(mentioned)) {
            assert(names.has(n), `스킬의 ${n}이 서버에 없음`);
          }
          for (const n of EXPECTED_TOOLS) {
            assert(
              mentioned.includes(n),
              `서버 도구 ${n}을 스킬이 안내하지 않음`,
            );
          }
        },
      );

      await t.step(
        "OAuth 갱신 토큰도 MCP audience를 유지하고 웹 API에서 거부된다",
        async () => {
          const grant = await trackedMcpGrant(sessionA);
          const refreshed = await refreshMcp(grant);
          owned.tokens.push(refreshed);
          assertEquals(claimsOf(refreshed).aud, MCP_URL);
          assertEquals(
            claimsOf(refreshed).iss,
            claimsOf(grant.access_token).iss,
          );
          const client = await trackedConnection(refreshed);
          try {
            assert(
              !((await businessTool(client, workspaceA, "list_tasks", {
                limit: 1,
              })).error),
            );
          } finally {
            await closeConnection(client);
          }
          assertEquals((await call(refreshed, "GET", "/tasks")).status, 401);
        },
      );

      await t.step(
        "missing workspace is rejected on raw HTTP/MCP while explicit scope remains readable",
        async () => {
          assertEquals((await call(sessionA, "GET", "/tasks")).status, 400);
          assertEquals(
            (await tool(mcpA, "list_tasks", { limit: 1 })).error.code,
            "invalid_input",
          );
          assertEquals(
            (await tool(mcpA, "list_tasks", {
              workspace_id: "invalid",
              limit: 1,
            })).error.code,
            "invalid_input",
          );
          assert(
            !((await businessTool(mcpA, workspaceA, "list_tasks", { limit: 1 }))
              .error),
          );
        },
      );
    } finally {
      await cleanupOwned();
    }
  },
});

async function trackedMcpGrant(
  session: string,
): Promise<{ access_token: string; refresh_token: string; client_id: string }> {
  let clientId: string | undefined;
  const registered = await registerClient();
  if (typeof registered.body.client_id === "string") {
    clientId = registered.body.client_id;
    owned.clients.add(clientId);
  }
  assertEquals(registered.status, 201);
  assert(clientId);
  const encode = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = encode(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const state = encode(crypto.getRandomValues(new Uint8Array(16)));
  const redirect = "http://127.0.0.1:55390/callback";
  const authUrl = `${SUPABASE_URL}/auth/v1`;
  const authorize = new URL(`${authUrl}/oauth/authorize`);
  for (
    const [key, value] of Object.entries({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: MCP_URL,
      scope: "openid email",
    })
  ) authorize.searchParams.set(key, value);
  const step = await fetch(authorize, {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  await step.body?.cancel();
  const authorization = new URL(
    step.headers.get("location") ?? "",
    SUPABASE_URL,
  ).searchParams.get("authorization_id");
  assert(authorization, "local OAuth consent authorization is present");
  const publishable = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");
  assert(publishable);
  const headers = {
    apikey: publishable,
    authorization: `Bearer ${session}`,
    "content-type": "application/json",
  };
  const details = await fetch(
    `${authUrl}/oauth/authorizations/${authorization}`,
    { headers, signal: AbortSignal.timeout(15000) },
  );
  const detail = await details.json();
  assert(details.ok, "local OAuth authorization details succeed");
  let callback = detail.redirect_url;
  if (!callback) {
    const consent = await fetch(
      `${authUrl}/oauth/authorizations/${authorization}/consent`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "approve" }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const approved = await consent.json();
    assert(consent.ok, "local OAuth consent succeeds");
    callback = approved.redirect_url;
  }
  const result = new URL(callback);
  assertEquals(result.searchParams.get("state"), state);
  const exchange = await fetch(`${authUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: result.searchParams.get("code") ?? "",
      redirect_uri: redirect,
      client_id: clientId,
      code_verifier: verifier,
      resource: MCP_URL,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const token = await exchange.json();
  // Track any minted session before assertions or SDK connection can fail.
  if (typeof token.access_token === "string") {
    owned.tokens.push(token.access_token);
  }
  assert(exchange.ok, "local OAuth code exchange succeeds");
  assert(typeof token.access_token === "string");
  assert(typeof token.refresh_token === "string");
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    client_id: clientId,
  };
}
