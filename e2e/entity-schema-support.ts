import { expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { env, ownedFixtureSeed, workspacePath } from "./support.ts";
import { APP_IDENTIFIER_RULE_ID } from "../supabase/functions/_shared/contracts/entity-issuer.ts";
import { encodeIdentifierReference, encodeIdentifierValue } from "../supabase/functions/_shared/contracts/entity-identifiers.ts";
type FixtureClient = { workspaceId?: string; call(name: string, input: Record<string, unknown>): Promise<any> };
type FixtureWorkspace = { id: string; grantKind(typeId: string): Promise<void> };
/** Explicit actual internal worker consumption; callers own serial local API tests. */
export async function schemaAnalysisTick() {
  const token = parseEnv(readFileSync(new URL("../supabase/functions/.env", import.meta.url), "utf8")).PROCESSING_TOKEN;
  if (!token) throw new Error("local schema worker token missing");
  const response = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/entity-schema-worker`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ limit: 1 }),
  });
  expect(response.status).toBe(200);
  await response.json();
}
export async function analyzeAndApply(
  mcp: { call(name: string, input: Record<string, unknown>): Promise<any> },
  typeId: string,
  changeId: string,
  version: number,
) {
  const accepted = await mcp.call("analyze_entity_schema_change", {
    type_id: typeId,
    change_id: changeId,
    expected_change_version: version,
  });
  expect(accepted.status).toBe("queued");
  await expect.poll(async () => {
    await schemaAnalysisTick();
    return (await mcp.call("get_entity_schema_change", { type_id: typeId, change_id: changeId })).status;
  }, { timeout: 30000 }).toBe("ready");
  return mcp.call("apply_entity_schema_change", {
    type_id: typeId,
    change_id: changeId,
    expected_change_version: version,
    analysis_id: accepted.analysis_id,
  });
}

/** Current typed scalar fixture. Every actual caller creates an explicit kind before writing data. */
const fixtureTypes = new WeakMap<object, Promise<{ id: string; label: string; schema_version: number }>>();
export function scalarFixtureType(mcp: FixtureClient, workspace: FixtureWorkspace) {
  if (!mcp.workspaceId || mcp.workspaceId !== workspace.id) throw new Error("explicit matching fixture workspace required");
  let result = fixtureTypes.get(mcp);
  if (!result) {
    result = (async () => {
      const type = await mcp.call("create_entity_type", {
        label: "검사 자료 " + crypto.randomUUID().slice(0, 8),
        icon_id: "box",
        initial_property_label: "제목",
      });
      await workspace.grantKind(type.id);
      const change = await mcp.call("create_entity_schema_change", {
        type_id: type.id,
        expected_schema_version: type.schema_version,
        edits: [
          {
            op: "update_property",
            key: "prop_2",
            field: { "x-order": 20, type: ["integer", "null"], title: "수량", default: 0 },
            required: false,
          },
          {
            op: "add_property",
            client_ref: "date",
            field: { "x-order": 30, type: ["string", "null"], title: "날짜", format: "date", default: null },
            required: false,
          },
          {
            op: "add_property",
            client_ref: "category",
            field: {
              "x-order": 40,
              type: "string",
              title: "분류",
              oneOf: [{ const: "a" }, { const: "b" }, { const: "c" }],
              default: "a",
            },
            required: false,
          },
          {
            op: "add_property",
            client_ref: "identifier",
            field: {
              "x-order": 50,
              type: "string",
              title: "자료 번호",
              "x-identifier": { allowed_kind_ids: [APP_IDENTIFIER_RULE_ID], default_kind_id: APP_IDENTIFIER_RULE_ID },
            },
            required: true,
          },
          { op: "set_metadata", "x-identity-property": "new_identifier" },
        ],
      });
      await analyzeAndApply(mcp, type.id, change.id, change.version);
      return await mcp.call("get_entity_type", { type_id: type.id });
    })();
    fixtureTypes.set(mcp, result);
  }
  return result;
}
export async function createFixtureEntity(
  mcp: FixtureClient,
  workspace: FixtureWorkspace,
  properties: Record<string, unknown>,
) {
  const type = await scalarFixtureType(mcp, workspace);
  return mcp.call("create_entity", {
    entity_type_id: type.id,
    schema_version: type.schema_version,
    properties,
  });
}
/** Publish the selected field's allowed kinds through the public definition workflow. */
export async function configureFixtureIdentifier(mcp: FixtureClient, typeId: string, kindId: string) {
  const current = await mcp.call("get_entity_schema", { type_id: typeId });
  const key = current.schema["x-identity-property"];
  const change = await mcp.call("create_entity_schema_change", {
    type_id: typeId,
    expected_schema_version: current.schema_version,
    edits: [{ op: "update_property", key, required: true, field: {
      ...current.schema.properties[key],
      "x-identifier": { allowed_kind_ids: [kindId], default_kind_id: kindId },
    } }],
  });
  await analyzeAndApply(mcp, typeId, change.id, change.version);
  return mcp.call("get_entity_schema", { type_id: typeId });
}
export function fixtureEntityList(workspaceId: string, typeId: string, keyword = "", category?: string, sort = false) {
  const params = new URLSearchParams({ entity_type_id: typeId });
  if (keyword) params.set("keyword", keyword);
  if (category) params.set("property_filters", JSON.stringify([{ key: "prop_4", operator: "eq", value: category }]));
  if (sort) params.set("sort", JSON.stringify({ key: "prop_2", direction: "asc" }));
  return workspacePath(workspaceId, "/entities?" + params);
}

/** Seed only list fixtures in one local transaction; public CRUD is exercised by separate scenarios. */
export async function seedFixtureEntities(
  mcp: Parameters<typeof scalarFixtureType>[0],
  workspace: FixtureWorkspace,
  values: Record<string, unknown>[],
) {
  const type = await scalarFixtureType(mcp, workspace);
  const prefix = "fixture_" + crypto.randomUUID();
  const rows = values.map((properties, index) => ({
    workspace_id: workspace.id,
    id: encodeIdentifierReference(type.id, APP_IDENTIFIER_RULE_ID, `${prefix}_${index}`),
    entity_type_id: type.id,
    schema_version: type.schema_version,
    properties: { prop_2: 0, prop_3: null, prop_4: "a", prop_5: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, `${prefix}_${index}`), ...properties },
  }));
  await ownedFixtureSeed(workspace.id, [{target_kind:"entity_type",target_id:type.id,access:"write"}], async (tx) => {
      const owned = await tx`select id from app.entity_types where id=${type.id} and workspace_id=${workspace.id}`;
      expect(owned).toHaveLength(1);
      if (rows.length) {
        const inserted =
          await tx`insert into app.entities (workspace_id,id,entity_type_id,schema_version,properties)
          select workspace_id,id,entity_type_id,schema_version,properties
          from jsonb_to_recordset(${
            tx.json(rows)
          }) as fixture(workspace_id uuid,id text,entity_type_id uuid,schema_version integer,properties jsonb)
          returning id`;
        expect(inserted).toHaveLength(rows.length);
      }
  });
  return rows.map((row) => row.id);
}
