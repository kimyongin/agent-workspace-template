// Normal CLI install/remove for a newly allocated selector, never manual cache edits.
import { execFileSync } from 'node:child_process';
import { writeFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { outsideDirectory } from './files.mjs';
export async function installPreparedPlugin(binary, market, name, output) {
  if (!/^workspace-prepare122-[a-f0-9]{32}$/.test(name)) throw new Error('Only newly allocated selector');
  await outsideDirectory(output);
  const cache = resolve(process.env.CODEX_HOME ?? resolve(homedir(), '.codex'), 'plugins/cache', name);
  if (await lstat(cache).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('Experiment cache already exists');
  const selector = `workspace@${name}`;
  const config = [`marketplaces.${name}.source_type="local"`, `marketplaces.${name}.source=${JSON.stringify(resolve(market))}`].flatMap(value => ['-c', value]);
  const run = args => { try { return JSON.parse(execFileSync(binary, [...args, ...config, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); } catch { throw new Error('Native plugin operation failed; own selector retained, raw output omitted'); } };
  const list = () => run(['plugin', 'list']).installed;
  const digest = rows => createHash('sha256').update(JSON.stringify(rows.filter(row => row.marketplaceName !== name).map(row => ({ id: row.pluginId, version: row.version, enabled: row.enabled })).sort((a, b) => a.id.localeCompare(b.id)))).digest('hex');
  const before = list();
  if (before.some(row => row.marketplaceName === name)) throw new Error('Experiment selector already installed');
  const journalFile = resolve(output, 'native-install.json');
  const journal = { selector, cache, beforeExistingDigest: digest(before), attempted: false, removed: false };
  const save = () => writeFile(journalFile, JSON.stringify(journal, null, 2) + '\n');
  await writeFile(journalFile, JSON.stringify(journal, null, 2) + '\n', { flag: 'wx' });
  const cleanup = async () => {
    if (journal.attempted && !journal.removed) { run(['plugin', 'remove', selector]); journal.removed = true; await save(); }
    journal.afterExistingDigest = digest(list()); journal.existingInstallationUnchanged = journal.afterExistingDigest === journal.beforeExistingDigest; await save();
    if (!journal.existingInstallationUnchanged) throw new Error('Existing plugin metadata drift; stop further runs');
    return journal;
  };
  try {
    journal.attempted = true; await save(); run(['plugin', 'add', selector]);
    const own = list().find(row => row.marketplaceName === name && row.name === 'workspace');
    if (!own?.installed) throw new Error('Native CLI did not install allocated plugin');
    journal.installed = true; journal.version = own.version; await save();
    return { cleanup, journal, otherPluginIds: before.map(row => `${row.name}@${row.marketplaceName}`) };
  } catch (error) { await cleanup(); throw error; }
}
