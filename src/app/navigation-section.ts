export function navigationSection(path: string) {
  if (/^\/entities(?:\/|$)/.test(path)) return "entities";
  if (/^\/(tasks|records)(?:\/|$)/.test(path)) return "activity";
  if (/^\/principles(?:\/|$)/.test(path)) return "principles";
  if (/^\/(tags|guide|settings|search)(?:\/|$)/.test(path)) return "more";
  return null;
}
