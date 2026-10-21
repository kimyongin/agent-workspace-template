import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { parse } from 'smol-toml';
import { resolve } from 'node:path';
import { readLocalConfig } from './local-config.mjs';

// Isolated runs never merge fallback credentials from the checkout's .env.local.
export function readTestRunEnvironment(plan, inherited = process.env) {
  if (!plan.runtimeConfig) return { config: readLocalConfig(), env: inherited };
  try {
    const config = readLocalConfig(plan.runtimeConfig);
    const rawConfig = parse(readFileSync(plan.runtimeConfig, 'utf8'));
    const values = parseEnv(readFileSync(plan.envFile, 'utf8'));
    const auth = new URL(values.VITE_SUPABASE_URL), api = new URL(values.VITE_API_URL);
    const db = new URL(values.LOCAL_DB_URL);
    if (auth.href !== `${config.apiUrl}/` || auth.username || auth.password
      || api.href !== `${config.apiUrl}/functions/v1/api` || api.username || api.password
      || !['postgres:', 'postgresql:'].includes(db.protocol) || !['127.0.0.1', 'localhost'].includes(db.hostname)
      || !Number.isInteger(rawConfig.db?.port) || Number(db.port) !== rawConfig.db.port
      || db.pathname !== '/postgres' || db.search || db.hash
      || Number(values.LOCAL_POOLER_PORT) !== config.poolerPort) throw new Error();
    const paths = {
      WORKSPACE_E2E_CONFIG: plan.runtimeConfig,
      WORKSPACE_E2E_ENV_FILE: plan.envFile,
      ENTITY_SCHEMA_WORKER_CONFIG: plan.runtimeConfig,
    };
    for (const [name, path] of Object.entries(paths)) {
      if ([inherited[name], values[name]].some(value => value && resolve(value) !== path)) throw new Error();
    }
    for (const source of [inherited, values]) {
      if (source.WORKSPACE_E2E_BASE_URL && source.WORKSPACE_E2E_BASE_URL !== config.webUrl
        || source.WORKSPACE_CLEANUP_PROJECT_ID && source.WORKSPACE_CLEANUP_PROJECT_ID !== config.projectId) throw new Error();
    }
    return { config, env: { ...inherited, ...values, ...paths, WORKSPACE_E2E_BASE_URL: config.webUrl } };
  } catch {
    // URL/TOML parser errors can contain private values. Report only the validation boundary.
    throw new Error('Explicit runtime config/env mismatch: require matching loopback API, direct DB, pooler and guarded paths');
  }
}
