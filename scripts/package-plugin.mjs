// Dependency-free deterministic ZIP (stored entries, fixed DOS date, sorted paths).
import { mkdir, writeFile, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, dirname, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repository, pluginFiles, validatePlugin } from './check-plugin.mjs';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipPlugin(files) {
  const entries = [], directory = [];
  let offset = 0;
  for (const { name, bytes } of [...files].sort((a, b) => a.name < b.name ? -1 : 1)) {
    const path = Buffer.from(`workspace/${name}`);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc32(bytes), 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(path.length, 26);
    entries.push(local, path, bytes);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    local.copy(central, 6, 4, 30);
    central.writeUInt32LE(offset, 42);
    directory.push(central, path);
    offset += local.length + path.length + bytes.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...entries, central, end]);
}

export async function packagePlugin(output, repo = repository) {
  await assertOutside(output, repo);
  await assertOutside(`${output}.json`, repo);
  const compatibility = await validatePlugin(repo);
  const bytes = zipPlugin(await pluginFiles(resolve(repo, 'plugins/workspace')));
  await mkdir(dirname(resolve(output)), { recursive: true });
  // Check both destinations again after resolving the newly created ancestors.
  await assertOutside(output, repo);
  await assertOutside(`${output}.json`, repo);
  await writeFile(output, bytes);
  const evidence = { ...compatibility, archiveSha256: createHash('sha256').update(bytes).digest('hex') };
  await writeFile(`${output}.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function isOutside(output, repo) {
  const path = relative(repo, output);
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
}

async function assertOutside(output, repo) {
  const destination = resolve(output);
  if (!isOutside(destination, resolve(repo))) throw new Error('Write release artifacts outside the repository');
  let ancestor = destination;
  while (true) {
    try {
      const stat = await lstat(ancestor);
      if (ancestor === destination && (stat.isSymbolicLink() || !stat.isFile())) {
        throw new Error('Artifact destination must be a regular file, not a symlink or junction');
      }
      const canonical = resolve(await realpath(ancestor), relative(ancestor, destination));
      if (!isOutside(canonical, await realpath(repo))) throw new Error('Write release artifacts outside the repository (canonical path)');
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/package-plugin.mjs <absolute-output.zip>');
  console.log(JSON.stringify(await packagePlugin(process.argv[2]), null, 2));
}
