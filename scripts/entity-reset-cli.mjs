import { readFile, open, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { runEntityReset, validateEntityResetManifest } from "./entity-reset.mjs";

export async function entityResetCli(args) {
  const options = {};
  for (const arg of args) {
    const match = /^--(mode|manifest|env-file|report|approval)=(.+)$/.exec(arg);
    if (!match || options[match[1]]) throw new Error("use explicit --mode=plan|apply --manifest=path --env-file=path --report=path [--approval=path]");
    options[match[1]] = match[2];
  }
  if (!["plan", "apply"].includes(options.mode) || !options.manifest || !options["env-file"] || !options.report
    || (options.mode === "apply") !== !!options.approval) throw new Error("explicit mode, manifest, private env and report required");
  if (resolve(options.report) === resolve(options.manifest) || options.approval && resolve(options.report) === resolve(options.approval)) throw new Error("report must not overwrite reviewed inputs");
  const privateFile = await stat(options["env-file"]);
  if (privateFile.mode & 0o077) throw new Error("reset environment file must be private (0600)");
  process.loadEnvFile(options["env-file"]);
  const manifest = validateEntityResetManifest(JSON.parse(await readFile(options.manifest, "utf8")));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (execFileSync("git", ["status", "--porcelain", "--", "scripts/entity-reset.mjs", "scripts/entity-reset-cli.mjs"], { cwd: root, encoding: "utf8" }).trim()) throw new Error("reset implementation must be committed and unchanged");
  if (manifest.source_revision !== revision || process.env.ENTITY_RESET_PROJECT_ID !== manifest.project_id) throw new Error("reset source revision or explicit project identity mismatch");
  const url = new URL(process.env.LOCAL_DB_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.search || url.hash || url.hostname !== manifest.environment.host
    || Number(url.port) !== manifest.environment.port || decodeURIComponent(url.pathname.slice(1)) !== manifest.environment.database) throw new Error("private reset connection differs from manifest loopback store");
  const output = await open(options.report, "wx", 0o600);
  const sql = postgres(url.href, { max: 1, prepare: false, onnotice() {} });
  try {
    const approval = options.approval ? JSON.parse(await readFile(options.approval, "utf8")) : undefined;
    const report = await runEntityReset(sql, manifest, approval);
    await output.writeFile(JSON.stringify(report, null, 2) + "\n");
    process.stdout.write(JSON.stringify({ mode: report.mode, blockers: report.blockers.length, digest: report.digest }) + "\n");
    return report.blockers.length ? 2 : 0;
  } finally { await sql.end(); await output.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await entityResetCli(process.argv.slice(2)); }
  catch (error) {
    // SQL and connection errors may contain credentials, parameters or content.
    // Controlled policy errors are safe; PostgreSQL diagnostics stay private.
    const safe = error?.name === "PostgresError" || error?.code || error instanceof TypeError
      ? "reset failed; transaction rolled back; inspect the private environment and regenerate plan" : error.message;
    process.stderr.write(safe + "\n");
    process.exitCode = 1;
  }
}
