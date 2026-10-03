import { lstat, realpath, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
export async function outsideDirectory(path) {
  const target = resolve(path);
  let ancestor = target;
  while (true) {
    try {
      const stat = await lstat(ancestor);
      if (stat.isSymbolicLink()) throw new Error('Experiment output ancestor must not be a symlink/junction');
      const canonical = resolve(await realpath(ancestor), relative(ancestor, target));
      const child = relative(await realpath(repository), canonical);
      if (!(child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child))) throw new Error('Experiment outputs must stay outside the repository');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = dirname(ancestor);
    }
  }
  await mkdir(target, { recursive: true });
  return target;
}
