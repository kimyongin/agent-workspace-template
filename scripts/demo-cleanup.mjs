import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// This is an explicit administrator procedure, never imported by normal migrations/startup.
export const cleanupTables = [
  'private.passage_effects', 'pgmq.q_search_index', 'pgmq.a_search_index',
  'app.search_chunks', 'app.search_index_state', 'private.entity_schema_migration_rows',
  'private.entity_schema_analysis_rows', 'app.entity_schema_migrations', 'app.entity_schema_analyses',
  'app.entity_schema_changes', 'app.entity_pairs', 'app.entity_tags', 'app.task_tags', 'app.record_tags',
  'app.records', 'app.tasks', 'app.entities', 'app.tags',
  'app.entity_schema_versions', 'app.entity_types', 'app.user_business_settings',
];
const roots = ['entities', 'tasks', 'records', 'tags', 'entity_types'];
const actions = ['create', 'update', 'delete', 'restore'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export function validateManifest(m) {
  if (!m || !uuid.test(m.owner_id)) throw new Error('explicit UUID owner_id required');
  if (!m.environment || typeof m.environment.name !== 'string' || !m.environment.name.trim()
      || !m.environment.host || !Number.isInteger(m.environment.port) || m.environment.port < 1
      || m.environment.port > 65535 || !m.environment.database) throw new Error('explicit environment identity required');
  if (!m.ids || Object.keys(m.ids).length !== roots.length || roots.some(k => !Array.isArray(m.ids[k])
      || m.ids[k].some(id => typeof id !== 'string' || !id || id === '*' || id.length > (k === 'entities' ? 470 : 200))
      || new Set(m.ids[k]).size !== m.ids[k].length)) throw new Error('explicit ids arrays required for each supported root');
  if (m.ids.entity_types.some(id => !uuid.test(id))) throw new Error('type IDs must be UUIDs');
  if (!Array.isArray(m.reset_template_paths) || m.reset_template_paths.some(p => !Array.isArray(p)
      || !(p.length === 2 && p[0] === 'entity' && actions.includes(p[1])
        || p.length === 3 && p[0] === 'entity_types' && uuid.test(p[1]) && actions.includes(p[2])))) {
    throw new Error('only explicit entity record template action paths may be reset');
  }
  if (!roots.some(k => m.ids[k].length) && !m.reset_template_paths.length) throw new Error('empty scope');
  return m;
}
function removePaths(settings, paths) {
  const value = structuredClone(settings);
  for (const path of paths) {
    let parent = value;
    for (const key of path.slice(0, -1)) parent = parent?.[key];
    if (parent && typeof parent === 'object') {
      delete parent[path.at(-1)];
      if(path.length===3&&path[0]==='entity_types'&&Object.keys(parent).length===0)delete value.entity_types[path[1]];
    }
  }
  return value;
}
const contains = (value, ids) => typeof value === 'string' ? ids.has(value)
  : Array.isArray(value) ? value.some(v => contains(v, ids))
  : value && typeof value === 'object' ? Object.entries(value).some(([k, v]) => ids.has(k) || contains(v, ids)) : false;

export function planCleanup(manifest, inventory) {
  const m = validateManifest(manifest), owner = m.owner_id;
  const rows = table => (inventory[table] ?? []).filter(r => table.startsWith('pgmq.')
    ? r.message?.owner_id === owner : r.owner_id === owner);
  const ids = Object.fromEntries(roots.map(k => [k, new Set(m.ids[k])]));
  const selected = {}, blockers = [];
  const select = (table, predicate) => selected[table] = rows(table).filter(predicate);
  for (const root of roots) {
    select(`app.${root}`, r => ids[root].has(r.id));
    for (const id of ids[root]) if (!selected[`app.${root}`].some(r => r.id === id)) blockers.push({ table: `app.${root}`, id, reason: 'missing_or_wrong_owner' });
  }
  for (const r of rows('app.entities')) if (ids.entity_types.has(r.entity_type_id) && !ids.entities.has(r.id)) blockers.push({ table: 'app.entities', id: r.id, reason: 'unapproved_type_member' });
  for (const r of rows('app.entities')) if (!ids.entities.has(r.id) && contains(r.properties, ids.entities)) blockers.push({ table: 'app.entities', id: r.id, reason: 'unapproved_entity_reference' });
  for (const table of ['app.tasks', 'app.records']) for (const r of rows(table)) {
    if (ids[table.slice(4)].has(r.id)) continue;
    if (contains([r.entity_ids, r.entity_context, r.change_metadata], ids.entities)
      || ids.records.has(r.result_record_id) || ids.tasks.has(r.task_id)) blockers.push({ table, id: r.id, reason: 'unapproved_business_reference' });
  }
  for (const table of ['app.entity_schema_versions', 'app.entity_schema_changes', 'app.entity_schema_analyses', 'app.entity_schema_migrations']) select(table, r => ids.entity_types.has(r.type_id));
  const jobs = new Set(selected['app.entity_schema_migrations'].map(r => r.id));
  const analyses = new Set(selected['app.entity_schema_analyses'].map(r => r.id));
  select('private.entity_schema_migration_rows', r => jobs.has(r.job_id));
  select('private.entity_schema_analysis_rows', r => analyses.has(r.analysis_id));
  for (const table of ['private.entity_schema_migration_rows', 'private.entity_schema_analysis_rows']) for (const r of rows(table)) {
    if ((ids.entities.has(r.entity_id) || contains([r.source_properties, r.properties, r.after, r.record_context], ids.entities)) && !selected[table].includes(r)) blockers.push({ table, id: r.entity_id, reason: 'unapproved_recovery_reference' });
  }
  for (const r of rows('app.entity_schema_migrations')) if (!jobs.has(r.id) && contains([r.source_references, r.committed_references, r.source_templates, r.target], new Set([...ids.entities, ...ids.entity_types, ...ids.tags, ...ids.records, ...ids.tasks]))) blockers.push({ table: 'app.entity_schema_migrations', id: r.id, reason: 'unapproved_recovery_reference' });
  select('app.entity_pairs', r => ids.entities.has(r.entity_id) || ids.entities.has(r.other_id));
  for (const r of selected['app.entity_pairs']) if (!ids.entities.has(r.entity_id) || !ids.entities.has(r.other_id)) blockers.push({ table: 'app.entity_pairs', id: `${r.entity_id}/${r.other_id}`, reason: 'unapproved_pair_endpoint' });
  for (const [table, key, root] of [['app.entity_tags', 'entity_id', 'entities'], ['app.task_tags', 'task_id', 'tasks'], ['app.record_tags', 'record_id', 'records']]) {
    select(table, r => ids[root].has(r[key]) || ids.tags.has(r.tag_id));
    for (const r of selected[table]) if (ids.tags.has(r.tag_id) && !ids[root].has(r[key])) blockers.push({ table, id: r[key], reason: 'unapproved_tag_usage' });
  }
  select('app.search_chunks', r => ids.records.has(r.record_id));
  select('app.search_index_state', r => r.kind === 'record' && ids.records.has(r.id));
  select('private.passage_effects', r => ids.records.has(r.record_id));
  for (const table of ['pgmq.q_search_index', 'pgmq.a_search_index']) select(table, r => r.message?.kind === 'record' && ids.records.has(r.message.id));
  const settings = rows('app.user_business_settings').find(r => r.id === 'record_templates');
  const updatedSettings = settings && removePaths(settings.settings, m.reset_template_paths);
  for (const path of m.reset_template_paths) {
    let found = settings?.settings;
    for (const key of path) found = found?.[key];
    if (found === undefined) blockers.push({ table: 'app.user_business_settings', id: path.join('/'), reason: 'missing_template_path' });
  }
  // Preserving other templates cannot leave them pointing at deleted tags/types.
  if (contains(updatedSettings, new Set([...ids.tags, ...ids.entity_types]))) blockers.push({ table: 'app.user_business_settings', id: 'record_templates', reason: 'unapproved_template_reference' });
  for (const r of rows('app.entity_schema_versions')) if (!ids.entity_types.has(r.type_id)
      && contains(r.schema, ids.entity_types)) blockers.push({ table: 'app.entity_schema_versions', id: r.type_id, reason: 'unapproved_schema_reference' });
  const counts = Object.fromEntries(cleanupTables.map(t => [t, t === 'app.user_business_settings' ? m.reset_template_paths.length : (selected[t]?.length ?? 0)]));
  const report = { environment: m.environment, owner_id: owner, counts, reset_template_paths: m.reset_template_paths, blockers,
    digest: createHash('sha256').update(canonical({ manifest: m, inventory: Object.fromEntries(Object.entries(inventory).map(([table, values]) => [table, [...values].sort((a, b) => canonical(a).localeCompare(canonical(b)))])) })).digest('hex') };
  Object.defineProperty(report, 'selection', { value: selected });
  Object.defineProperty(report, 'updatedSettings', { value: updatedSettings });
  return report;
}

export function assertEnvironment(manifest, databaseUrl) {
  const target = new URL(databaseUrl), e = manifest.environment;
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || target.hostname !== e.host
      || Number(target.port || 5432) !== e.port || decodeURIComponent(target.pathname.slice(1)) !== e.database) {
    throw new Error('database connection does not match approved environment');
  }
}
async function inventoryFor(sql, owner) {
  const inventory = {};
  for (const table of cleanupTables) {
    if (table.startsWith('pgmq.')) inventory[table] = await sql`select * from ${sql(table)} where message->>'owner_id'=${owner}`;
    else inventory[table] = await sql`select * from ${sql(table)} where owner_id=${owner}`;
  }
  return inventory;
}
export async function runCleanup(sql, manifest, approvedDigest) {
  validateManifest(manifest);
  return sql.begin(async tx => {
    // Fail fast if a running worker or web writer prevents the maintenance lock.
    await tx`set local lock_timeout='5s'`;
    await tx`set local statement_timeout='30s'`;
    if (approvedDigest) {
      for (const table of cleanupTables) await tx`lock table ${tx(table)} in access exclusive mode`;
    } else await tx`set transaction isolation level repeatable read, read only`;
    const inventory = await inventoryFor(tx, manifest.owner_id);
    const report = planCleanup(manifest, inventory);
    if (!approvedDigest) return { mode: 'dry-run', ...report };
    if (report.digest !== approvedDigest) throw new Error('approval digest changed; repeat dry-run');
    if (report.blockers.length) throw new Error('scope has unapproved references or missing targets');
    // Owner predicates always remain alongside exact primary-key predicates.
    // Table keys are discovered so composite schema/pair/tag keys are never guessed.
    for (const table of cleanupTables.filter(t => t !== 'app.user_business_settings')) {
      const selected = report.selection[table] ?? [];
      if (!selected.length) continue;
      const keys = table.startsWith('pgmq.') ? [{ attname: 'msg_id' }] : await tx`select a.attname from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey) where i.indrelid=${table}::regclass and i.indisprimary order by a.attnum`;
      if (!keys.length) throw new Error('cleanup table needs a primary key');
      // Delete the full selected set in one statement; recovery jobs may reference each other.
      const clauses = selected.map(r => tx`(${keys.map(k => tx`${tx(k.attname)}=${r[k.attname]}`).reduce((a, b) => tx`${a} and ${b}`)})`);
      if (table.startsWith('pgmq.')) await tx`delete from ${tx(table)} where message->>'owner_id'=${manifest.owner_id} and (${clauses.reduce((a, b) => tx`${a} or ${b}`)})`;
      else await tx`delete from ${tx(table)} where owner_id=${manifest.owner_id} and (${clauses.reduce((a, b) => tx`${a} or ${b}`)})`;
    }
    if (manifest.reset_template_paths.length) await tx`update app.user_business_settings set settings=${tx.json(report.updatedSettings)}, version=version+1, updated_at=now() where owner_id=${manifest.owner_id} and id='record_templates'`;
    const after = await inventoryFor(tx, manifest.owner_id);
    for (const [table, deleted] of Object.entries(report.selection)) {
      const keys = table.startsWith('pgmq.') ? ['msg_id'] : table === 'private.passage_effects' ? ['id'] : ['owner_id', ...['id', 'entity_id', 'other_id', 'type_id', 'schema_version', 'job_id', 'analysis_id', 'record_id', 'task_id', 'tag_id', 'ordinal', 'principle_id'].filter(k => deleted.some(r => k in r))];
      if (deleted.some(r => after[table]?.some(s => keys.every(k => s[k] === r[k])))) throw new Error('residual cleanup reference');
    }
    return { mode: 'applied', ...report, residual_rows: 0 };
  });
}
async function main() {
  const [file, mode, digest, ...extra] = process.argv.slice(2);
  if (!file || extra.length || (mode && mode !== '--apply') || (mode === '--apply' && !/^[a-f0-9]{64}$/.test(digest ?? '')) || (!mode && digest)) throw new Error('usage: node scripts/demo-cleanup.mjs manifest.json [--apply APPROVED_DIGEST]');
  const manifest = validateManifest(JSON.parse(await readFile(file, 'utf8')));
  if (!process.env.DEMO_CLEANUP_DATABASE_URL) throw new Error('DEMO_CLEANUP_DATABASE_URL required');
  assertEnvironment(manifest, process.env.DEMO_CLEANUP_DATABASE_URL);
  const { default: postgres } = await import('postgres');
  const sql = postgres(process.env.DEMO_CLEANUP_DATABASE_URL, { max: 1, prepare: false });
  try { console.log(JSON.stringify(await runCleanup(sql, manifest, digest), null, 2)); }
  finally { await sql.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  // SQL/connection errors may contain passwords or record content; keep them out of routine output.
  console.error('Cleanup stopped. No partial transaction committed. Check scope, approval digest, maintenance locks and private administrator diagnostics.');
  process.exitCode = 1;
});
