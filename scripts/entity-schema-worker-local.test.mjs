import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { test } from "node:test";
import { runEntitySchemaWorker } from "./entity-schema-worker-local.mjs";

const token = "local-worker-test-token-abcdefghijklmnopqrstuvwxyz";
async function fixture(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    apiUrl,
    environment: {
      VITE_SUPABASE_URL: apiUrl,
      VITE_API_URL: `${apiUrl}/functions/v1/api`,
      PROCESSING_TOKEN: token,
    },
  };
}

test("local worker uses configured origin, internal auth and a single bounded claim without logging response data", async (t) => {
  const requests = [], output = [];
  const config = await fixture(t, async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ path: request.url, auth: request.headers.authorization, body: JSON.parse(body) });
    response.end(JSON.stringify({ claimed: 1, source: "private-source", secret: token }));
  });
  await runEntitySchemaWorker({ ...config, once: true, report: (message) => output.push(message) });
  assert.deepEqual(requests, [{
    path: "/functions/v1/entity-schema-worker",
    auth: `Bearer ${token}`,
    body: { limit: 1 },
  }]);
  assert.deepEqual(output, ["스키마 worker HTTP 200"]);
});

test("runner rejects remote or mismatched configured targets and missing internal tokens before calling", async (t) => {
  let requests = 0;
  const config = await fixture(t, (_, response) => {
    requests++;
    response.end();
  });
  for (
    const unsafe of [
      { apiUrl: "https://example.test" },
      { apiUrl: "http://user:password@127.0.0.1:1234" },
      { apiUrl: `${config.apiUrl}/other` },
      { environment: { ...config.environment, VITE_SUPABASE_URL: "http://127.0.0.1:55421" } },
      { environment: { ...config.environment, VITE_API_URL: "https://example.test/functions/v1/api" } },
      { environment: { ...config.environment, PROCESSING_TOKEN: "short" } },
    ]
  ) await assert.rejects(runEntitySchemaWorker({ ...config, ...unsafe, once: true, report: () => {} }));
  assert.equal(requests, 0);
});

test("polling waits for completion, never overlaps requests and stops on cancellation", async (t) => {
  let active = 0, maximum = 0, requests = 0;
  const stop = new AbortController();
  const config = await fixture(t, async (_, response) => {
    requests++;
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 120));
    active--;
    response.end();
  });
  const safety = setTimeout(() => stop.abort(), 2000);
  t.after(() => clearTimeout(safety));
  await runEntitySchemaWorker({
    ...config,
    intervalMs: 100,
    timeoutMs: 1000,
    signal: stop.signal,
    report: () => {
      if (requests === 2) stop.abort();
    },
  });
  assert.equal(requests, 2);
  assert.equal(maximum, 1);
});

test("configuration probe authenticates without claiming queued work", async (t) => {
  let body;
  const config = await fixture(t, async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    body = JSON.parse(raw);
    response.end();
  });
  await runEntitySchemaWorker({ ...config, once: true, checkConfiguration: true, report: () => {} });
  assert.deepEqual(body, { check_configuration: true });
});

for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  test(`executable receives ${signal} and cancels a pending request without printing secrets`, async (t) => {
    let contacted;
    const contact = new Promise((resolve) => {
      contacted = resolve;
    });
    const config = await fixture(t, () => contacted());
    const directory = mkdtempSync(join(tmpdir(), "schema-worker-cli-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(join(directory, "scripts"));
    mkdirSync(join(directory, "supabase"));
    for (const name of ["entity-schema-worker-local.mjs", "local-env.mjs", "local-config.mjs"]) {
      copyFileSync(new URL(name, import.meta.url), join(directory, "scripts", name));
    }
    symlinkSync(new URL("../node_modules", import.meta.url).pathname, join(directory, "node_modules"));
    writeFileSync(
      join(directory, "supabase", "config.toml"),
      `project_id="isolated_worker"
[api]
port=${new URL(config.apiUrl).port}
[db.pooler]
enabled=true
port=6543
[auth]
site_url="http://127.0.0.1:9999"
`,
    );
    writeFileSync(
      join(directory, ".env.local"),
      Object.entries(config.environment).map(([key, value]) => `${key}=${value}`).join("\n"),
    );
    const child = spawn(process.execPath, [join(directory, "scripts", "entity-schema-worker-local.mjs")], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => output += chunk);
    child.stderr.on("data", (chunk) => output += chunk);
    t.after(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    });
    const finished = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
    await Promise.race([
      contact,
      finished.then((result) => {
        throw new Error(`Runner exited before request: ${JSON.stringify(result)} ${output}`);
      }),
    ]);
    child.kill(signal);
    assert.deepEqual(await finished, { code: exitCode, signal: null });
    assert.ok(!output.includes(token));
  });
}

test("HTTP auth errors stop polling and suppress private response bodies", async (t) => {
  let requests = 0;
  const output = [];
  const config = await fixture(t, (_, response) => {
    requests++;
    response.writeHead(401);
    response.end(token + " private-source");
  });
  await assert.rejects(runEntitySchemaWorker({ ...config, report: (message) => output.push(message) }), /HTTP 401/);
  assert.equal(requests, 1);
  assert.deepEqual(output, ["스키마 worker HTTP 401"]);
});

test("HTTP timeout is bounded and does not claim a job failed", async (t) => {
  const config = await fixture(t, () => {});
  await assert.rejects(
    runEntitySchemaWorker({ ...config, once: true, timeoutMs: 100, report: () => {} }),
    /요청 시간 초과.*작업 상태/,
  );
});

test("runner refuses redirects and never forwards its token to another origin", async (t) => {
  let forwarded = 0;
  const other = await fixture(t, (_, response) => {
    forwarded++;
    response.end();
  });
  const config = await fixture(t, (_, response) => {
    response.writeHead(307, { Location: `${other.apiUrl}/functions/v1/entity-schema-worker` });
    response.end();
  });
  await assert.rejects(runEntitySchemaWorker({ ...config, once: true, report: () => {} }), /연결 실패/);
  assert.equal(forwarded, 0);
});

test("runner cancels interval waiting without another invocation and rejects unbounded timing", async (t) => {
  let requests = 0;
  const stop = new AbortController();
  const config = await fixture(t, (_, response) => {
    requests++;
    response.end();
  });
  await runEntitySchemaWorker({
    ...config,
    intervalMs: 60000,
    signal: stop.signal,
    report: () => setTimeout(() => stop.abort(), 20),
  });
  assert.equal(requests, 1);
  for (const value of [0, 99, 60001, NaN]) {
    await assert.rejects(
      runEntitySchemaWorker({ ...config, once: true, intervalMs: value, report: () => {} }),
      /100~60000ms/,
    );
  }
  assert.equal(requests, 1);
});

test("CLI explicit isolated config preserves tracked defaults and exact matching-origin validation", async (t) => {
  let requests = 0;
  const authorizations = [];
  const config = await fixture(t, (request, response) => {
    requests++;
    authorizations.push(request.headers.authorization);
    response.end("private-response");
  });
  const directory = mkdtempSync(join(tmpdir(), "schema-worker-config-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "scripts"));
  mkdirSync(join(directory, "supabase"));
  for (const name of ["entity-schema-worker-local.mjs", "local-env.mjs", "local-config.mjs"]) {
    copyFileSync(new URL(name, import.meta.url), join(directory, "scripts", name));
  }
  symlinkSync(new URL("../node_modules", import.meta.url).pathname, join(directory, "node_modules"));
  const toml = (port) =>
    `project_id="isolated_worker"\n[api]\nport=${port}\n[db.pooler]\nenabled=true\nport=6543\n[auth]\nsite_url="http://127.0.0.1:9999"\n`;
  const tracked = join(directory, "supabase", "config.toml"), external = join(directory, "isolated.toml");
  writeFileSync(tracked, toml(65534));
  writeFileSync(external, toml(new URL(config.apiUrl).port));
  writeFileSync(
    join(directory, ".env.local"),
    Object.entries(config.environment).map(([key, value]) => `${key}=${value}`).join("\n"),
  );
  const run = async (args) => {
    const child = spawn(process.execPath, [
      join(directory, "scripts", "entity-schema-worker-local.mjs"),
      "--once",
      ...args,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => output += chunk);
    child.stderr.on("data", (chunk) => output += chunk);
    t.after(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    });
    const code = await new Promise((resolve) => child.once("close", resolve));
    return { code, output };
  };
  const mismatch = await run([]);
  assert.equal(mismatch.code, 1);
  assert.equal(requests, 0);
  const explicit = await run([`--config=${external}`]);
  assert.equal(explicit.code, 0);
  assert.equal(requests, 1);
  assert.equal(explicit.output.trim(), "스키마 worker HTTP 200");
  assert(!explicit.output.includes(token));
  assert(!explicit.output.includes("private-response"));
  const duplicate = await run([`--config=${external}`, `--config=${external}`]);
  assert.equal(duplicate.code, 1);
  assert.equal(requests, 1);
  const selectedEnv = join(directory, "selected runtime.env");
  const selectedToken = "selected-worker-test-token-abcdefghijklmnopqrstuvwxyz";
  writeFileSync(selectedEnv, Object.entries({ ...config.environment, PROCESSING_TOKEN: selectedToken })
    .map(([key, value]) => `${key}=${value}`).join("\n"));
  writeFileSync(join(directory, ".env.local"), "VITE_SUPABASE_URL=http://127.0.0.1:65534\n");
  const noSelection = await run([`--config=${external}`]);
  assert.equal(noSelection.code, 1);
  assert.equal(requests, 1);
  const selected = await run([`--config=${external}`, `--env-file=${selectedEnv}`]);
  assert.equal(selected.code, 0, selected.output);
  assert.equal(requests, 2);
  assert.equal(authorizations.at(-1), `Bearer ${selectedToken}`);
  assert.equal(selected.output.trim(), "스키마 worker HTTP 200");
  assert(!selected.output.includes(selectedToken));
  assert(!selected.output.includes("private-response"));
  for (const args of [
    [`--env-file=${selectedEnv}`, `--env-file=${selectedEnv}`],
    ["--env-file="],
    ["--env-file=bad\npath"],
    [`--env-file=${join(directory, "missing.env")}`],
    [`--env-file=${join(directory, ".env.local")}`],
  ]) {
    const rejected = await run([`--config=${external}`, ...args]);
    // Node may reject its own malformed --env-file option before the script starts.
    assert(rejected.code > 0, rejected.output);
    assert.equal(requests, 2);
  }
});
