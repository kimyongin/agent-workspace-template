import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readEnv } from "./local-env.mjs";

test("setup generates and preserves the private schema worker token in both environment files without starting consumption", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "schema-worker-setup-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const name of ["scripts", "supabase/functions", "node_modules/postgres", "bin"]) {
    mkdirSync(join(directory, name), { recursive: true });
  }
  for (const name of ["local-setup.mjs", "local-config.mjs", "local-env.mjs"]) {
    copyFileSync(new URL(name, import.meta.url), join(directory, "scripts", name));
  }
  copyFileSync(new URL("../supabase/config.toml", import.meta.url), join(directory, "supabase/config.toml"));
  symlinkSync(
    new URL("../node_modules/smol-toml", import.meta.url).pathname,
    join(directory, "node_modules/smol-toml"),
  );
  writeFileSync(join(directory, "supabase/signing_keys.json"), "[]");
  writeFileSync(join(directory, "node_modules/postgres/package.json"), '{"type":"module","main":"index.js"}');
  writeFileSync(
    join(directory, "node_modules/postgres/index.js"),
    "export default function() { const sql = async () => []; sql.end = async () => {}; sql.unsafe = async () => {}; return sql; }",
  );
  const port = /\[api\][\s\S]*?\nport = (\d+)/.exec(readFileSync(join(directory, "supabase/config.toml"), "utf8"))[1];
  const apiUrl = `http://127.0.0.1:${port}`;
  writeFileSync(
    join(directory, "bin/npx"),
    `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nappendFileSync('${directory}/commands', process.argv.slice(2).join(' ')+'\\n');\nif (process.argv.includes('status')) console.log('API_URL=${apiUrl}\\nPUBLISHABLE_KEY=public-test-key\\nSECRET_KEY=private-test-key\\nDB_URL=postgresql://postgres:local@127.0.0.1:1234/postgres');`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(directory, "fetch.mjs"),
    "globalThis.fetch = async () => ({ ok: true, json: async () => ({ users: [] }) });",
  );
  const run = () =>
    spawnSync(
      process.execPath,
      ["--import", join(directory, "fetch.mjs"), join(directory, "scripts/local-setup.mjs")],
      {
        cwd: directory,
        env: { ...process.env, PATH: `${join(directory, "bin")}:${process.env.PATH}` },
        encoding: "utf8",
        timeout: 5000,
      },
    );
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const localFile = join(directory, ".env.local"), functionFile = join(directory, "supabase/functions/.env");
  const generated = readEnv(localFile).ENTITY_SCHEMA_WORKER_TOKEN;
  assert.match(generated ?? "", /^[A-Za-z0-9_-]{43,}$/);
  assert.equal(readEnv(functionFile).ENTITY_SCHEMA_WORKER_TOKEN, generated);
  assert.ok(!first.stdout.includes(generated));
  writeFileSync(localFile, readFileSync(localFile, "utf8") + "CUSTOM_LOCAL=keep\n");
  writeFileSync(functionFile, readFileSync(functionFile, "utf8") + "CUSTOM_FUNCTION=keep\n");
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readEnv(localFile).ENTITY_SCHEMA_WORKER_TOKEN, generated);
  assert.equal(readEnv(functionFile).ENTITY_SCHEMA_WORKER_TOKEN, generated);
  assert.equal(readEnv(localFile).CUSTOM_LOCAL, "keep");
  assert.equal(readEnv(functionFile).CUSTOM_FUNCTION, "keep");
  assert.ok(!readFileSync(join(directory, "commands"), "utf8").includes("worker"));
});
