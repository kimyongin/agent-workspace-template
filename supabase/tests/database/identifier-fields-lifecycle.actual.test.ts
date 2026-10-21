import { assert, assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { SqlEntityIssuerUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-issuer-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import * as registry from "../../functions/_shared/core/entity-issuers/application.ts";
import * as entity from "../../functions/_shared/core/entity/application.ts";
import * as schema from "../../functions/_shared/core/entity-types/schema-changes.ts";
import { getEntitySchema } from "../../functions/_shared/core/entity-types/application.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import { APP_IDENTIFIER_RULE_ID } from "../../functions/_shared/contracts/entity-issuer.ts";
import { encodeIdentifierValue } from "../../functions/_shared/contracts/entity-identifiers.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { entityIssuerTools } from "../../functions/_shared/adapters/mcp/entity-issuer-tools.ts";
import { entityIssuerRoutes } from "../../functions/_shared/adapters/http/entity-issuer-routes.ts";
import { Hono } from "hono";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";

dbTest(
  "ordinary identifier lifecycle permits duplicate optional pairs and reports exact field defaults across HTTP/MCP",
  async () => {
    const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 3, prepare: false });
    const workerUrl = new URL(urls.admin);
    workerUrl.username = "app_worker";
    workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
    const worker = connect(workerUrl.href, { max: 1, prepare: false });
    const f = await businessWorkspaceFixture(admin, sql);
    const types = { uow: new SqlEntityTypeUnitOfWork(sql) },
      issuers = { uow: new SqlEntityIssuerUnitOfWork(sql) },
      entities = { uow: new SqlEntityUnitOfWork(sql) };
    const consume = async () => {
      for (let i = 0; i < 20; i++) {
        const batch = await worker.begin(async (tx) =>
          (await tx`select app.claim_entity_schema_analysis() as batch`)[0].batch
        );
        if (!batch) break;
        const convert = compileMigration(batch.target, batch.migration);
        const values = batch.rows.map((row: { entity_id: string; properties: Record<string, unknown> }) =>
          convert(row.entity_id, row.properties)
        );
        await worker.begin(async (tx) => {
          await tx`select app.complete_entity_schema_analysis_batch(${batch.id},${batch.fence},${tx.json(values)})`;
        });
      }
    };
    try {
      const type = await f.createKind("여러 식별자"), a = f.manager;
      await f.grantKind(a, type.id, "write");
      await f.grantKind(f.member, type.id, "write");
      const source = await registry.createEntityIssuer(issuers, businessRequest(a), {
        code: "crm",
        label: "고객 시스템",
      });
      const first = await registry.createIdentifierRule(issuers, businessRequest(a), source.code, {
        label: "고객 번호",
        meaning: "원본 고객 번호",
      });
      let second = await registry.createIdentifierRule(issuers, businessRequest(a), source.code, {
        label: "주문 번호",
        meaning: "원본 주문 번호",
      });
      const kinds = [APP_IDENTIFIER_RULE_ID, first.id, second.id];
      const change = await schema.createEntitySchemaChange(types, businessRequest(a), type.id, {
        expected_schema_version: 1,
        edits: [
          {
            op: "add_property",
            client_ref: "customer",
            required: false,
            field: {
              type: ["string", "null"],
              title: "고객 식별자",
              "x-order": 30,
              "x-identifier": { allowed_kind_ids: kinds, default_kind_id: first.id },
            },
          },
          {
            op: "add_property",
            client_ref: "order",
            required: false,
            field: {
              type: ["string", "null"],
              title: "주문 식별자",
              "x-order": 40,
              "x-identifier": { allowed_kind_ids: kinds, default_kind_id: first.id },
            },
          },
        ],
      });
      const analysis = await schema.analyzeEntitySchemaChange(types, businessRequest(a), type.id, change.id, {
        expected_change_version: change.version,
      });
      await consume();
      const reviewed = await schema.getEntitySchemaChange(types, a, type.id, change.id);
      await schema.applyEntitySchemaChange(types, businessRequest(a), type.id, change.id, {
        expected_change_version: reviewed.version,
        analysis_id: analysis.analysis_id,
      });
      const current = await getEntitySchema(types, f.member, { type_id: type.id });
      assertEquals(current.schema_version, 2);
      const customer = change.reservations.customer, order = change.reservations.order;
      let schemaVersion = 2;
      const error = await assertRejects(
        () =>
          registry.updateIdentifierRule(issuers, businessRequest(a), first.id, {
            active: false,
            expected_version: first.version,
          }),
        AppError,
      );
      const paths = [`default_fields.${type.id}.${customer}`, `default_fields.${type.id}.${order}`];
      assertEquals(error.fields?.map((field) => field.path), paths);
      const app = new Hono<HttpEnv>();
      app.use("*", async (c, next) => {
        c.set("actor", businessRequest(a));
        await next();
      });
      app.onError((error) => {
        const result = toErrorBody(error);
        return new Response(JSON.stringify(result.body), { status: result.status });
      });
      app.route("/", entityIssuerRoutes(issuers));
      const response = await app.request(`/entity-identifier-rules/${first.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: false, expected_version: first.version }),
      });
      assertEquals(response.status, 400);
      assertEquals((await response.json()).fields.map((field: { path: string }) => field.path), paths);
      const tool = entityIssuerTools(issuers).find((tool) => tool.name === "update_entity_identifier_rule")!;
      const toolError = await assertRejects(
        () =>
          tool.handler({
            rule_id: first.id,
            active: false,
            expected_version: first.version,
            request_key: crypto.randomUUID(),
          }, a),
        AppError,
      );
      assertEquals(toolError.fields?.map((field) => field.path), paths);
      const pair = encodeIdentifierValue(second.id, "001:A/%😀");
      const create = (raw: string, properties: Record<string, string | null>) =>
        entity.createEntity(entities, businessRequest(f.member), {
          entity_type_id: type.id,
          schema_version: schemaVersion,
          properties: { prop_1: "이름", prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, raw), ...properties },
        });
      const one = await create("one", { [customer]: pair, [order]: pair }),
        two = await create("two", { [customer]: pair, [order]: null });
      assertEquals([one.properties[customer], one.properties[order], two.properties[customer], two.properties[order]], [
        pair,
        pair,
        pair,
        null,
      ]);
      const absent = await create("absent", {});
      assertEquals(absent.properties[customer], undefined);
      const generated = await entity.updateEntity(entities, businessRequest(f.member), one.id, {
        schema_version: schemaVersion,
        expected_version: one.version,
        generate_identifiers: { [customer]: APP_IDENTIFIER_RULE_ID },
      });
      assert(String(generated.properties[customer]).startsWith(`${APP_IDENTIFIER_RULE_ID}:`));
      const publishDefault = async (value: string | undefined) => {
        const draft = await schema.createEntitySchemaChange(types, businessRequest(a), type.id, {
          expected_schema_version: schemaVersion,
          edits: [{
            op: "update_property",
            key: order,
            required: false,
            field: { ...current.schema.properties[order], default: value },
          }],
        });
        await schema.analyzeEntitySchemaChange(types, businessRequest(a), type.id, draft.id, {
          expected_change_version: draft.version,
        });
        await consume();
        const ready = await schema.getEntitySchemaChange(types, a, type.id, draft.id);
        await schema.applyEntitySchemaChange(types, businessRequest(a), type.id, draft.id, {
          expected_change_version: ready.version,
          analysis_id: ready.analysis!.id,
        });
        schemaVersion++;
      };
      await publishDefault(pair);
      const literalBlocked = await assertRejects(
        () =>
          registry.updateIdentifierRule(issuers, businessRequest(a), second.id, {
            active: false,
            expected_version: second.version,
          }),
        AppError,
      );
      assertEquals(literalBlocked.fields?.map((field) => field.path), [`default_fields.${type.id}.${order}`]);
      const race = await assertRejects(() =>
        admin.begin(async (tx) => {
          await tx`select set_config('request.workspace_id',${f.workspaceId},true),set_config('request.jwt.claims',${
            JSON.stringify({ sub: a.userId, role: "authenticated" })
          },true)`;
          await tx`update app.entity_identifier_rules set active=false where workspace_id=${f.workspaceId} and id=${second.id}`;
        })
      );
      assertEquals((race as { message: string }).message, "identity_default_inactive");
      assertEquals(JSON.parse((race as unknown as { detail: string }).detail), [{ type_id: type.id, property: order }]);
      await publishDefault(undefined);
      second = await registry.updateIdentifierRule(issuers, businessRequest(a), second.id, {
        active: false,
        expected_version: second.version,
      });
      const preserved = await entity.updateEntity(entities, businessRequest(f.member), generated.id, {
        schema_version: schemaVersion,
        expected_version: generated.version,
        properties: { prop_1: "수정" },
      });
      assertEquals(preserved.properties[order], pair);
      await assertRejects(() => create("stopped", { [customer]: pair }), AppError);
      await assertRejects(
        () =>
          registry.updateIdentifierRule(issuers, businessRequest(a), second.id, {
            meaning: "다른 의미",
            expected_version: second.version,
          }),
        AppError,
      );
      await assertRejects(
        () =>
          registry.deleteIdentifierRule(issuers, businessRequest(a), second.id, { expected_version: second.version }),
        AppError,
      );
      const invalidDefault = await schema.createEntitySchemaChange(types, businessRequest(a), type.id, {
        expected_schema_version: schemaVersion,
        edits: [{
          op: "update_property",
          key: customer,
          required: false,
          field: { ...current.schema.properties[customer], default: pair },
        }],
      });
      await schema.analyzeEntitySchemaChange(types, businessRequest(a), type.id, invalidDefault.id, {
        expected_change_version: invalidDefault.version,
      });
      await consume();
      const readyDefault = await schema.getEntitySchemaChange(types, a, type.id, invalidDefault.id);
      await assertRejects(
        () =>
          schema.applyEntitySchemaChange(types, businessRequest(a), type.id, invalidDefault.id, {
            expected_change_version: readyDefault.version,
            analysis_id: readyDefault.analysis!.id,
          }),
        AppError,
      );
      const renamed = await registry.updateIdentifierRule(issuers, businessRequest(a), second.id, {
        label: "보관 주문 번호",
        expected_version: second.version,
      });
      assertEquals(renamed.id, second.id);
    } finally {
      await f.cleanup();
      await worker.end();
      await sql.end();
      await admin.end();
    }
  },
);
