/** Report only setting names. Never attach secret values or their digests to diagnostics. */
export function invalidWorkerSettings(settings: Record<string, string | undefined>): string[] {
  const invalid: string[] = [];
  if (!settings.INDEX_WORKER_TOKEN || settings.INDEX_WORKER_TOKEN.length < 43) invalid.push("INDEX_WORKER_TOKEN");
  for (const name of ["PINECONE_API_KEY", "WORKER_DB_URL"]) {
    if (!settings[name]?.trim()) invalid.push(name);
  }
  const scope = settings.PINECONE_ACCOUNT_SCOPE;
  if (!scope?.trim() || scope.length > 120) invalid.push("PINECONE_ACCOUNT_SCOPE");
  return invalid;
}
