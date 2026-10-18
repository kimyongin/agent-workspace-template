// Internal actual-E2E step runner, invoked explicitly by the owning test only.
// Credentials stay in the root-owned environment file, never arguments/output.
import postgres from "postgres";
import { parseEnv } from "node:util";
import { compileMigration } from "../supabase/functions/_shared/core/entity-types/conversions.ts";
import { prepareMigrationBatch } from "../supabase/functions/_shared/core/entity-types/migration-preparation.ts";
import { SEARCH_PIPELINE } from "../supabase/functions/_shared/core/search/config.ts";
import { assert, assertEquals } from "@std/assert";
import { runInWorkspace } from "../supabase/functions/_shared/adapters/supabase/workspace-context.ts";

const packet = JSON.parse(await Deno.readTextFile(Deno.args[0])) as {
  operation: "seed" | "analysis" | "fail" | "publish";
  kindId?: string;
  entityId?: string;
  external?: string;
  workspace: string;
  actor: string;
  model: string;
  analysisIds: string[];
  jobIds: string[];
};
const file = Deno.env.get("WORKSPACE_E2E_ENV_FILE");
assert(file);
const env = parseEnv(await Deno.readTextFile(file));
const url = new URL(env.LOCAL_DB_URL ?? "");
assert(["127.0.0.1", "localhost"].includes(url.hostname));
if (packet.operation === "seed") {
  assert(
    env.APP_SERVER_PASSWORD && packet.kindId && packet.entityId &&
      packet.external,
  );
  url.username = "app_server";
  url.password = env.APP_SERVER_PASSWORD;
  const direct = postgres(url.href, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });
  try {
    await runInWorkspace(
      direct,
      { userId: packet.actor, workspaceId: packet.workspace },
      {
        mode: "business",
        requirements: [{
          target_kind: "entity_type",
          target_id: packet.kindId,
          access: "write",
        }],
      },
      (tx) =>
        tx`insert into app.entities(workspace_id,id,source,external_id,entity_type_id,schema_version,properties)
      values(${packet.workspace},${packet.entityId!},'app',${packet
          .external!},${packet.kindId!},1,'{"prop_1":"12"}')`,
    );
  } finally {
    await direct.end();
  }
  Deno.exit(0);
}
assert(env.APP_WORKER_PASSWORD);
url.username = "app_worker";
url.password = env.APP_WORKER_PASSWORD;
const worker = postgres(url.href, {
  max: 1,
  prepare: false,
  onnotice: () => {},
});
try {
  if (packet.operation === "analysis") {
    for (let n = 0; n < packet.analysisIds.length; n++) {
      const [claim] =
        await worker`select app.claim_entity_schema_analysis() as batch`;
      const batch = claim.batch;
      assert(batch && packet.analysisIds.includes(batch.id));
      assertEquals(batch.workspace_id, packet.workspace);
      assertEquals(batch.initiated_by, packet.actor);
      assertEquals(Number(batch.workspace_generation), 1);
      const convert = compileMigration(
        batch.target,
        batch.migration,
        batch.recovery_keys,
      );
      const rows = batch.rows.map((
        row: { entity_id: string; properties: Record<string, unknown> },
      ) => convert(row.entity_id, row.properties));
      assertEquals(
        (await worker`select app.complete_entity_schema_analysis_batch(${batch.id},${batch.fence},${
          worker.json(rows)
        }) as ok`)[0].ok,
        true,
      );
    }
  } else {
    let finished = false;
    for (let n = 0; n <= packet.jobIds.length; n++) {
      const [claim] =
        await worker`select app.claim_data_model_conversion() as batch`;
      const batch = claim.batch;
      assert(batch);
      assertEquals(batch.id, packet.model);
      if (packet.operation === "fail") {
        assert(packet.jobIds.includes(batch.child.id));
        assertEquals(batch.child.workspace_id, packet.workspace);
        assertEquals(batch.child.initiated_by, packet.actor);
        assertEquals(
          (await worker`select app.fail_data_model_conversion(${batch.id},${batch.fence},${batch.child.id},${batch.child.fence},'migration_worker_failed',true) as ok`)[
            0
          ].ok,
          true,
        );
        finished = true;
        break;
      }
      if (batch.status === "committing") {
        assertEquals(
          (await worker`select app.commit_data_model_conversion(${batch.id},${batch.fence},${SEARCH_PIPELINE}) as ok`)[
            0
          ].ok,
          true,
        );
        finished = true;
        break;
      }
      assert(packet.jobIds.includes(batch.child.id));
      assertEquals(batch.child.workspace_id, packet.workspace);
      assertEquals(batch.child.initiated_by, packet.actor);
      assertEquals(Number(batch.child.workspace_generation), 1);
      const values = await prepareMigrationBatch(batch.child, new Date());
      assertEquals(values.stale, false);
      assertEquals(
        (await worker`select app.stage_data_model_conversion(${batch.id},${batch.fence},${batch.child.id},${batch.child.fence},${
          worker.json(values.results)
        }) as ok`)[0].ok,
        true,
      );
    }
    assert(finished);
  }
} finally {
  await worker.end();
}
