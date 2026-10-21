import { spawnSync } from 'node:child_process';
import { freemem } from 'node:os';

// Read only PIDs, parent PIDs and RSS; never process command lines or environments.
export function sampleProcessTree(rootPid) {
  if (!Number.isInteger(rootPid) || process.platform === 'win32') return null;
  const listed = spawnSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8', timeout: 2000, maxBuffer: 4_000_000, stdio: ['ignore', 'pipe', 'ignore'] });
  if (listed.status !== 0) return null;
  const rows = listed.stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const selected = new Set([rootPid]);
  for (let prior = -1; prior !== selected.size;) {
    prior = selected.size;
    for (const [pid, parent] of rows) if (selected.has(parent)) selected.add(pid);
  }
  const tree = rows.filter(([pid]) => selected.has(pid));
  if (!tree.length || tree.some(row => row.length !== 3 || row.some(value => !Number.isFinite(value)))) return null;
  return { rssKiB: tree.reduce((sum, row) => sum + row[2], 0), processCount: tree.length, hostFreeBytes: freemem() };
}

export function startProcessSamples(rootPid) {
  const started = performance.now(), samples = [];
  let failures = 0;
  const sample = () => {
    const value = sampleProcessTree(rootPid);
    if (value) samples.push({ elapsedMs: performance.now() - started, ...value });
    else failures++;
  };
  sample();
  const timer = setInterval(sample, 1000);
  return () => {
    clearInterval(timer);
    return { target: 'child process tree summed RSS at each sample; excludes Docker/VM and reparented children',
      unit: 'KiB', intervalMs: 1000, samples, failures,
      maxSampledRssKiB: samples.length ? Math.max(...samples.map(value => value.rssKiB)) : null,
      minSampledHostFreeBytes: samples.length ? Math.min(...samples.map(value => value.hostFreeBytes)) : null };
  };
}
