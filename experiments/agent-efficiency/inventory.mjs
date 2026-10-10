// Offline inventory only: does not run agents, mutate checkout, or estimate tokens.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const protocol = JSON.parse(readFileSync(new URL("./protocol.json", import.meta.url), "utf8"));
const requestedRevision = process.argv[2] ?? protocol.baselineRevision;
const revision = execFileSync("git", ["rev-parse", "--verify", `${requestedRevision}^{commit}`], { encoding: "utf8" }).trim();
const paths = [...new Set([...protocol.inventoryPaths, ...protocol.tasks.flatMap(task => task.seedPaths)])].sort();
const files = paths.map(path => {
  const bytes = execFileSync("git", ["show", `${revision}:${path}`], { maxBuffer: 8 * 1024 * 1024 });
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    unicodeCodePoints: [...content].length,
  };
});
process.stdout.write(JSON.stringify({
  kind: "static-source-inventory",
  revision,
  uncommittedChangesIncluded: false,
  taskExecution: "not-run",
  tokenTelemetry: "unavailable",
  firstEditReadContext: null,
  inputTokens: null,
  outputTokens: null,
  cachedTokens: null,
  agentToolCalls: null,
  rework: null,
  taskCompletion: null,
  taskValidation: null,
  files,
}, null, 2) + "\n");
