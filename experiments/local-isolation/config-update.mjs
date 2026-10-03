import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { environment, optionalJson, digest } from "../../scripts/environment-state.mjs";
import { prepareFiles, inventory } from "../../scripts/environment-runtime.mjs";
const expected = await environment(process.cwd());
const manifest = await optionalJson(join(expected.dir, "manifest.json"));
const beforeHash = manifest.configHash;
const ports = JSON.stringify(manifest.ports);
const files = ["supabase/signing_keys.json", "runtime.env", "functions.env", "web/.env.local"];
async function fingerprints() { return Object.fromEntries(await Promise.all(files.map(async (file) => [file, { hash: digest(await readFile(join(expected.dir, file))), mtime: (await stat(join(expected.dir, file))).mtimeMs }]))); }
const before = await fingerprints(); const volumes = (await inventory(manifest)).volume;
await prepareFiles(manifest);
assert.deepEqual(await fingerprints(), before); assert.equal(JSON.stringify(manifest.ports), ports);
assert.deepEqual((await inventory(manifest)).volume, volumes);
assert.equal(await optionalJson(join(expected.dir, "config-update.json")), null);
await writeFile(new URL("config-update-windows-20261004.json", import.meta.url), JSON.stringify({ observedAt: new Date().toISOString(), id: expected.id, previousConfigHash: beforeHash, nextConfigHash: manifest.configHash, keysPasswordsEnvBytesAndMtimePreserved: true, portReservationPreserved: true, ownedVolumeIdentityAndCreationTimePreserved: true, journalCompleted: true }, null, 2) + "\n");
console.log("Stopped owned config updated; keys/passwords/ports/DB volumes preserved; journal completed.");
