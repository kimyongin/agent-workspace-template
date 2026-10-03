import assert from "node:assert/strict";
import postgres from "postgres";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const results = { observedAt: new Date().toISOString(), cli: "2.119.0", platform: process.platform, projects: [] };
for (const [project, port] of [["t08-probe-a", 56100], ["t08-probe-b", 56120]]) {
  const db = postgres(`postgresql://postgres:postgres@127.0.0.1:${port + 1}/postgres`, { max: 1 });
  try {
    await db`create table if not exists isolation_marker (value text)`;
    await db`delete from isolation_marker`;
    await db`insert into isolation_marker values (${project})`;
  } finally { await db.end(); }
  const pooler = postgres(`postgresql://postgres.pooler-dev:postgres@127.0.0.1:${port + 3}/postgres`, { prepare: false, max: 1 });
  try { assert.equal((await pooler`select value from isolation_marker`)[0].value, project); } finally { await pooler.end(); }
  const inspect = (args) => JSON.parse(execFileSync("docker", args, { encoding: "utf8" }))[0];
  const network = inspect(["network", "inspect", `supabase_network_${project}`]);
  const volume = inspect(["volume", "inspect", `supabase_db_${project}`]);
  const dbContainer = inspect(["inspect", `supabase_db_${project}`]);
  const poolerContainer = inspect(["inspect", `supabase_pooler_${project}`]);
  assert.equal(network.Labels["com.supabase.cli.project"], project);
  assert.equal(volume.Labels["com.supabase.cli.project"], project);
  assert.ok(dbContainer.Config.Labels["com.supabase.cli.workdir"].endsWith(`isolation-${project.at(-1)}`));
  const response = await fetch(`http://127.0.0.1:${port}/functions/v1/probe`);
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.marker, project);
  results.projects.push({ project, apiPort: port, tenant: "pooler-dev", networkId: network.Id, volume: volume.Name, dbContainerId: dbContainer.Id, poolerContainerId: poolerContainer.Id, poolerAliases: Object.values(poolerContainer.NetworkSettings.Networks)[0].Aliases, response: body });
}
assert.notEqual(results.projects[0].networkId, results.projects[1].networkId);
assert.notEqual(results.projects[0].volume, results.projects[1].volume);
writeFileSync(new URL("results-windows-20261004.json", import.meta.url), JSON.stringify(results, null, 2) + "\n");
console.log("Two live DB/pooler/function projects returned separate markers; evidence contains no credentials.");
