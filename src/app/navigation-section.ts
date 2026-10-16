export function navigationSection(path: string) {
  if (/^\/entities(?:\/|$)/.test(path)) return "entities";
  if (/^\/tasks(?:\/|$)/.test(path)) return "tasks";
  if (/^\/records(?:\/|$)/.test(path)) return "records";
  if (/^\/(tags|guide|settings|search|status)(?:\/|$)/.test(path)) return "more";
  return null;
}
