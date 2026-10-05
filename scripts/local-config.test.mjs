import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readLocalConfig } from "./local-config.mjs";

test("별도 프로젝트의 로컬 주소·풀러·웹 origin은 해당 TOML 설정에서 읽는다", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "local-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "config.toml");
  writeFileSync(file, `project_id = 'separate-app'
[api]
port = 55621
[db.pooler]
enabled = true
port = 55629
[auth]
site_url = 'http://127.0.0.1:55680'
additional_redirect_urls = ['http://localhost:55680']
[remotes.production]
project_id = 'original-production'
`);
  assert.deepEqual(readLocalConfig(file), {
    projectId: "separate-app", apiUrl: "http://127.0.0.1:55621",
    poolerPort: 55629, webUrl: "http://127.0.0.1:55680", webPort: 55680,
    webOrigins: "http://127.0.0.1:55680,http://localhost:55680",
  });
});

test("잘못된 프로젝트·포트·운영 주소·TOML은 로컬 실행 전에 거부한다", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "local-config-invalid-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "config.toml");
  const valid = `project_id = 'isolated'
[api]
port = 55721
[db.pooler]
enabled = true
port = 55729
[auth]
site_url = 'http://127.0.0.1:55780'
`;
  for (const raw of [valid.replace("isolated", "other; stop"), valid.replace("55721", "70000"), valid.replace("http://127.0.0.1:55780", "https://production.example"), valid + "project_id = ["]) {
    writeFileSync(file, raw);
    assert.throws(() => readLocalConfig(file));
  }
});
