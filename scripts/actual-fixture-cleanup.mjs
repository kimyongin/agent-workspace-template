import { randomUUID } from "node:crypto";
import { assertEnvironment, runCleanup } from "./demo-cleanup.mjs";
const roots = ["entities", "tasks", "records", "tags", "entity_types"];
const creations = {
  "entity.create": "entities",
  "task.create": "tasks",
  "record.create": "records",
  "tag.create": "tags",
  "entity-type.create": "entity_types",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const selected = (items, ids) => items?.some((id) => ids.has(id));
const contexts = (items, entities, types) =>
  items?.some((item) => entities.has(item.id) || types.has(item.type?.id));
/** Structured references only: a title/body merely containing an ID never widens the scope. */
function entityReferences(row, entities, types) {
  const metadata = row.change_metadata;
  return selected(row.entity_ids, entities) ||
    contexts(row.entity_context, entities, types) ||
    metadata?.target_kind === "entity" && entities.has(metadata.target_id) ||
    [metadata?.before, metadata?.after].some((facts) =>
      facts &&
      (types.has(facts.entity_type_id) || selected(facts.entity_ids, entities))
    );
}
export function fixtureManifest(owner, scope, inventory, environment) {
  const data = Object.fromEntries(
    roots.map((root) => [
      root,
      (inventory[root] ?? []).filter((row) => row.owner_id === owner),
    ]),
  );
  const ids = Object.fromEntries(
    roots.map((root) => [
      root,
      new Set(
        data[root].filter((row) => (scope.ids[root] ?? []).includes(row.id))
          .map((row) => row.id),
      ),
    ]),
  );
  const introducedTypes = new Set(scope.ids.entity_types);
  for (const row of data.entities) {
    if (introducedTypes.has(row.entity_type_id)) ids.entities.add(row.id);
  }
  for (const row of data.tasks) {
    if (entityReferences(row, ids.entities, introducedTypes)) {
      ids.tasks.add(row.id);
    }
  }
  let previous = -1;
  while (previous !== ids.records.size) {
    previous = ids.records.size;
    for (const row of data.records) {
      const metadata = row.change_metadata;
      if (
        entityReferences(row, ids.entities, introducedTypes) ||
        ids.tasks.has(row.task_id) ||
        metadata?.target_kind === "task" && ids.tasks.has(metadata.target_id) ||
        metadata?.target_kind === "record" &&
          ids.records.has(metadata.target_id)
      ) ids.records.add(row.id);
    }
  }
  const paths = [],
    settings = (inventory.settings ?? []).find((row) =>
      row.owner_id === owner && row.id === "record_templates"
    );
  for (const id of introducedTypes) {
    for (const action of ["create", "update", "delete", "restore"]) {
      if (settings?.settings?.entity_types?.[id]?.[action] !== undefined) {
        paths.push(["entity_types", id, action]);
      }
    }
  }
  return {
    approval_id: randomUUID(),
    environment,
    owner_id: owner,
    ids: Object.fromEntries(roots.map((root) => [root, [...ids[root]].sort()])),
    reset_template_paths: paths,
  };
}
function receiptRelated(result, ids) {
  if (!result || typeof result !== "object") return false;
  const all = new Set(roots.flatMap((root) => ids[root]));
  return all.has(result.id) || ids.entity_types.includes(result.type_id) ||
    ids.entity_types.includes(result.entity_type_id) ||
    ids.entity_types.includes(result.type?.id);
}
/** Only explicit IDs introduced by this test and their structured dependent facts are eligible. */
export async function cleanupOwnedFixture(databaseUrl, environment, scope) {
  if (
    !roots.some((root) => scope.ids[root]?.length) && !scope.requestKeys.length
  ) return [];
  const connection = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost"].includes(connection.hostname)) {
    throw new Error("actual fixture cleanup requires a loopback database");
  }
  assertEnvironment({ environment }, databaseUrl);
  if (
    roots.some((root) => !Array.isArray(scope.ids[root])) ||
    scope.requestKeys.some((key) => !uuid.test(key))
  ) throw new Error("explicit actual fixture scope required");
  const { default: postgres } = await import("postgres");
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice() {} });
  try {
    if (!uuid.test(scope.ownerId)) {
      throw new Error("explicit fixture owner required");
    }
    const ids = Object.fromEntries(
        roots.map((root) => [root, new Set(scope.ids[root])]),
      ),
      owners = new Set([scope.ownerId]);
    const receipts = scope.requestKeys.length
      ? await sql`select owner_id,operation,result from private.request_results where owner_id=${scope.ownerId} and request_key=any(${scope.requestKeys}::uuid[])`
      : [];
    for (const row of receipts) {
      const root = creations[row.operation];
      if (root && typeof row.result?.id === "string") {
        ids[root].add(row.result.id);
        owners.add(row.owner_id);
      }
    }
    for (const root of roots) {
      if (!ids[root].size) continue;
      const rows = await sql`select owner_id from ${
        sql(`app.${root}`)
      } where owner_id=${scope.ownerId} and id::text=any(${[
        ...ids[root],
      ]}::text[])`;
      for (const row of rows) owners.add(row.owner_id);
    }
    const introduced = {
      ids: Object.fromEntries(roots.map((root) => [root, [...ids[root]]])),
    };
    const reports = [];
    for (const owner of owners) {
      const inventory = {};
      for (const root of roots) {
        inventory[root] = await sql`select * from ${
          sql(`app.${root}`)
        } where owner_id=${owner}`;
      }
      inventory.settings =
        await sql`select * from app.user_business_settings where owner_id=${owner} and id='record_templates'`;
      const manifest = fixtureManifest(
        owner,
        introduced,
        inventory,
        environment,
      );
      if (
        !roots.some((root) => manifest.ids[root].length) &&
        !manifest.reset_template_paths.length
      ) {
        // A test may already have removed its rows manually; only its exact issued receipts remain.
        if (scope.requestKeys.length) {
          await sql`delete from private.request_results where owner_id=${owner} and request_key=any(${scope.requestKeys}::uuid[])`;
        }
        continue;
      }
      const dry = await runCleanup(sql, manifest);
      if (dry.blockers.length) {
        throw new Error(
          `owned fixture cleanup has ${dry.blockers.length} unapproved references; no cleanup applied`,
        );
      }
      const applied = await runCleanup(sql, manifest, dry.digest);
      // Include receipts for automatic typed/history writes as well as explicitly issued test requests.
      const candidates =
        await sql`select request_key,result from private.request_results where owner_id=${owner} and (request_key=any(${scope.requestKeys}::uuid[]) or result->>'id'=any(${
          roots.flatMap((root) => manifest.ids[root])
        }::text[]) or result->>'type_id'=any(${manifest.ids.entity_types}::text[]) or result->>'entity_type_id'=any(${manifest.ids.entity_types}::text[]) or result->'type'->>'id'=any(${manifest.ids.entity_types}::text[]))`;
      const keys = candidates.filter((row) =>
        scope.requestKeys.includes(row.request_key) ||
        receiptRelated(row.result, manifest.ids)
      ).map((row) => row.request_key);
      if (keys.length) {
        await sql`delete from private.request_results where owner_id=${owner} and request_key=any(${keys}::uuid[])`;
      }
      reports.push({
        environment,
        owner_id: owner,
        counts: applied.counts,
        request_receipts: keys.length,
        residual_rows: applied.residual_rows,
      });
    }
    return reports;
  } finally {
    await sql.end();
  }
}
