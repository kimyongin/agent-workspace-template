import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(resolve("supabase/tests/database/_db.ts")).href;
function target(dbPort, poolerPort, key) {
  const env = {
    ...process.env,
    LOCAL_DB_URL: `postgresql://postgres:fixture-admin@127.0.0.1:${dbPort}/postgres`,
    APP_SERVER_PASSWORD: "fixture-server",
  };
  delete env.LOCAL_POOLER_PORT;
  if (poolerPort !== undefined) env.LOCAL_POOLER_PORT = poolerPort;
  const code = `import {urls} from ${JSON.stringify(moduleUrl)};try{console.log(new URL(urls[${
    JSON.stringify(key)
  }]).port)}catch(error){console.error(error.message);Deno.exit(2)}`;
  return spawnSync(resolve("node_modules/.bin/deno"), ["eval", "--config", "supabase/functions/deno.json", code], {
    env,
    encoding: "utf8",
    timeout: 30000,
  });
}
test("custom direct-only DB fixture imports without evaluating an absent pooler", () => {
  const result = target("62542", undefined, "direct");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "62542");
});
test("custom DB fixture refuses missing explicit pooler before connecting or revealing credentials", () => {
  const result = target("62542", undefined, "pooler");
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /LOCAL_POOLER_PORT/);
  assert.doesNotMatch(result.stderr, /fixture-admin|fixture-server|postgresql:\/\//);
});
test("custom DB fixture uses only its explicitly configured pooler", () => {
  const result = target("62622", "62629", "pooler");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "62629");
});
test("the default local DB fixture retains its existing default pooler", () => {
  const result = target("55422", undefined, "pooler");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "55429");
});
