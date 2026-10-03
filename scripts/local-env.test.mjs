import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readEnv, writeEnv } from "./local-env.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "local-env-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, ".env.local");
}

test("생성 값을 갱신해도 사용자 공급자 키와 따옴표·줄바꿈을 포함한 설정을 보존한다", (t) => {
  const file = fixture(t);
  writeFileSync(file, 'PINECONE_API_KEY="test-key"\r\nVITE_API_URL=old\r\nexport CUSTOM="first # line\nsecond line"\r\n');
  writeEnv(file, "로컬", { VITE_API_URL: "http://127.0.0.1:55421/functions/v1/api" });
  assert.deepEqual(readEnv(file), {
    PINECONE_API_KEY: "test-key",
    VITE_API_URL: "http://127.0.0.1:55421/functions/v1/api",
    CUSTOM: "first # line\nsecond line",
  });
  const first = readFileSync(file, "utf8");
  writeEnv(file, "로컬", { VITE_API_URL: "http://127.0.0.1:55421/functions/v1/api" });
  assert.equal(readFileSync(file, "utf8"), first);
  assert.ok(!first.includes("\r"));
});

test("함수 환경 파일도 사용자 값을 보존하고 비어 있던 파일을 준비한다", (t) => {
  const file = fixture(t);
  assert.deepEqual(readEnv(file), {});
  writeEnv(file, "함수", { PINECONE_API_KEY: "test-key", CUSTOM: "it's a # value" });
  writeEnv(file, "함수", { APP_DB_URL: "postgresql://local" });
  assert.equal(readEnv(file).PINECONE_API_KEY, "test-key");
  assert.equal(readEnv(file).CUSTOM, "it's a # value");
});

test("손실 없이 저장할 수 없는 값은 기존 설정을 지우지 않고 거부한다", (t) => {
  const file = fixture(t);
  writeFileSync(file, "KEEP=unchanged\n");
  assert.throws(() => writeEnv(file, "로컬", { INVALID: "'\"`" }), /원본 파일을 유지/);
  assert.equal(readFileSync(file, "utf8"), "KEEP=unchanged\n");
});

test("사용자 dotenv 구문·주석·변수 확장·혼합 따옴표를 재직렬화하지 않는다", (t) => {
  const file = fixture(t);
  const raw = '# 사용자 주석\nLITERAL=\'$TOKEN\'\nEXPANDED="$TOKEN"\nMIXED="He said \\"it\'s ok\\" # yes"\nMULTI="first\nVITE_API_URL=inside\nlast"\n';
  writeFileSync(file, raw + 'export VITE_API_URL="old" # 생성 값\nVITE_API_URL=duplicate\n');
  writeEnv(file, "로컬", { VITE_API_URL: "new", APP_SERVER_PASSWORD: "$TOKEN" });
  const result = readFileSync(file, "utf8");
  assert.ok(result.startsWith(raw));
  assert.equal(readEnv(file).VITE_API_URL, "new");
  assert.equal(readEnv(file).APP_SERVER_PASSWORD, "$TOKEN");
  assert.ok(result.includes("APP_SERVER_PASSWORD='$TOKEN'"));
  assert.equal(result.match(/^VITE_API_URL=new$/gm)?.length, 1);
});
