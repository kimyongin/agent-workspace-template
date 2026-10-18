/** Compact prepare receipts distinguish new objects from existing update targets. */
export function modelFixtureRoots(result) {
  const ids = {
    data_model_changes: [],
    entity_types: [],
    entity_relation_definitions: [],
    entity_issuers: [],
    entity_identifier_rules: [],
  };
  if (
    typeof result?.id !== "string" || !result.review?.mapping ||
    !Array.isArray(result.review.items)
  ) return ids;
  ids.data_model_changes.push(result.id);
  for (const item of result.review.items) {
    if (item.kind !== "new") continue;
    const types = result.review.mapping.types ?? {};
    if (Object.hasOwn(types, item.ref)) ids.entity_types.push(types[item.ref]);
    else if (item.ref.startsWith("relation:")) {
      ids.entity_relation_definitions.push(item.ref.slice(9));
    } else if (item.ref.startsWith("issuer:") && item.ref !== "issuer:app") {
      ids.entity_issuers.push(item.ref.slice(7));
    } else if (
      item.ref.startsWith("rule:") &&
      item.ref !== "rule:00000000-0000-4000-8000-000000000001"
    ) ids.entity_identifier_rules.push(item.ref.slice(5));
  }
  return ids;
}
