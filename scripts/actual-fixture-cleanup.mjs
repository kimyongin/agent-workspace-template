import { randomUUID } from "node:crypto";
import { assertEnvironment, runCleanup } from "./demo-cleanup.mjs";
const roots = ["entities", "tasks", "records", "tags", "entity_types"];
const registryRoots = ["entity_issuers", "entity_identifier_rules"];
const allRoots = [...roots, ...registryRoots];
const creations = {
  "entity.create": "entities",
  "task.create": "tasks",
  "record.create": "records",
  "tag.create": "tags",
  "entity-type.create": "entity_types",
  "issuer.create": "entity_issuers",
  "identifier-rule.create": "entity_identifier_rules",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const selected = (items, ids) => items?.some((id) => ids.has(id));
const contexts = (items, entities, types) => items?.some((item) => entities.has(item.id) || types.has(item.type?.id));
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
    settings = (inventory.settings ?? []).find((row) => row.owner_id === owner && row.id === "record_templates");
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
/** Exact created issuer/rule roots never expand to unrelated mappings or untracked rules. */
export function registryFixturePlan(owner, scope, inventory) {
  const sources = new Set(scope.ids.entity_issuers ?? []),
    rules = new Set(scope.ids.entity_identifier_rules ?? []),
    types = new Set(scope.ids.entity_types ?? []);
  const own = (table) => (inventory[table] ?? []).filter((row) => row.owner_id === owner);
  const issuers = own("entity_issuers").filter((row) => sources.has(row.code));
  const selectedRules = own("entity_identifier_rules").filter((row) => rules.has(row.id));
  const blockers = [];
  for (const row of issuers) if (row.system || row.code === "app") blockers.push("system_issuer");
  for (const row of own("entity_identifier_rules")) {
    if (sources.has(row.source) && !rules.has(row.id)) blockers.push("untracked_issuer_rule");
  }
  for (const row of own("entity_type_identity_sources")) {
    if ((sources.has(row.code) || rules.has(row.rule_id)) && !types.has(row.type_id)) {
      blockers.push("unapproved_type_identity_reference");
    }
  }
  for (const row of own("entities")) {
    if (sources.has(row.source) && !types.has(row.entity_type_id)) {
      blockers.push("unapproved_issuer_entity_reference");
    }
  }
  return { issuers: issuers.map((row) => row.code), rules: selectedRules.map((row) => row.id), blockers };
}
function receiptRelated(result, ids) {
  if (!result || typeof result !== "object") return false;
  const all = new Set(allRoots.flatMap((root) => ids[root] ?? []));
  return all.has(result.id) || (ids.entity_issuers ?? []).includes(result.code) ||
    ids.entity_types.includes(result.type_id) ||
    ids.entity_types.includes(result.entity_type_id) ||
    ids.entity_types.includes(result.type?.id);
}
/** Only explicit IDs introduced by this test and their structured dependent facts are eligible. */
export async function cleanupOwnedFixture(databaseUrl, environment, scope) {
  if (
    !allRoots.some((root) => scope.ids[root]?.length) && !scope.requestKeys.length
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
    if (
      registryRoots.some((root) => scope.ids[root] !== undefined && !Array.isArray(scope.ids[root])) ||
      (scope.ids.entity_issuers ?? []).some((code) => !/^[a-z][a-z0-9_-]{0,31}$/.test(code)) ||
      (scope.ids.entity_identifier_rules ?? []).some((id) => !uuid.test(id))
    ) throw new Error("explicit registry fixture scope required");
    const [lock] = await sql`select pg_try_advisory_lock(hashtextextended(${
      scope.ownerId + ":entity-identity-registry"
    },0)) as acquired`;
    if (!lock.acquired) throw new Error("registry cleanup is busy; no cleanup applied");
    const ids = Object.fromEntries(
        allRoots.map((root) => [root, new Set(scope.ids[root] ?? [])]),
      ),
      owners = new Set([scope.ownerId]);
    const receipts = scope.requestKeys.length
      ? await sql`select owner_id,operation,result from private.request_results where owner_id=${scope.ownerId} and request_key=any(${scope.requestKeys}::uuid[])`
      : [];
    for (const row of receipts) {
      const root = creations[row.operation];
      if (root && typeof (root === "entity_issuers" ? row.result?.code : row.result?.id) === "string") {
        ids[root].add(root === "entity_issuers" ? row.result.code : row.result.id);
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
      ids: Object.fromEntries(allRoots.map((root) => [root, [...ids[root]]])),
    };
    const reports = [];
    for (const owner of owners) {
      const inventory = {};
      for (const root of roots) {
        inventory[root] = await sql`select * from ${sql(`app.${root}`)} where owner_id=${owner}`;
      }
      for (const table of [...registryRoots, "entity_type_identity_sources"]) {
        inventory[table] = await sql`select * from ${sql(`app.${table}`)} where owner_id=${owner}`;
      }
      const registry = registryFixturePlan(owner, introduced, inventory);
      if (registry.blockers.length) {
        throw new Error(
          `owned registry cleanup has ${registry.blockers.length} unapproved references; no cleanup applied`,
        );
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
        !manifest.reset_template_paths.length && !registry.issuers.length && !registry.rules.length
      ) {
        // A test may already have removed its rows manually; only its exact issued receipts remain.
        if (scope.requestKeys.length) {
          await sql`delete from private.request_results where owner_id=${owner} and request_key=any(${scope.requestKeys}::uuid[])`;
        }
        continue;
      }
      const business = roots.some((root) => manifest.ids[root].length) || manifest.reset_template_paths.length;
      const dry = business ? await runCleanup(sql, manifest) : { blockers: [] };
      if (dry.blockers.length) {
        throw new Error(
          `owned fixture cleanup has ${dry.blockers.length} unapproved references; no cleanup applied`,
        );
      }
      const applied = business ? await runCleanup(sql, manifest, dry.digest) : { counts: {}, residual_rows: 0 };
      await sql.begin(async (tx) => {
        await tx`delete from app.entity_identifier_rules where owner_id=${owner} and id=any(${registry.rules}::uuid[])`;
        await tx`delete from app.entity_issuers where owner_id=${owner} and code=any(${registry.issuers}::text[])`;
      });
      applied.counts["app.entity_identifier_rules"] = registry.rules.length;
      applied.counts["app.entity_issuers"] = registry.issuers.length;
      // Include receipts for automatic typed/history writes as well as explicitly issued test requests.
      const candidates =
        await sql`select request_key,result from private.request_results where owner_id=${owner} and (request_key=any(${scope.requestKeys}::uuid[]) or result->>'id'=any(${
          allRoots.flatMap((root) => introduced.ids[root] ?? [])
        }::text[]) or result->>'code'=any(${registry.issuers}::text[]) or result->>'type_id'=any(${manifest.ids.entity_types}::text[]) or result->>'entity_type_id'=any(${manifest.ids.entity_types}::text[]) or result->'type'->>'id'=any(${manifest.ids.entity_types}::text[]))`;
      const keys = candidates.filter((row) =>
        scope.requestKeys.includes(row.request_key) ||
        receiptRelated(row.result, {
          ...manifest.ids,
          ...Object.fromEntries(registryRoots.map((root) => [root, introduced.ids[root]])),
        })
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
    await sql`select pg_advisory_unlock(hashtextextended(${scope.ownerId + ":entity-identity-registry"},0))`;
    await sql.end();
  }
}
