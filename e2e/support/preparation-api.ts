import { fixtureType, fixtureSchema } from "./workspace-data.ts";
import type { Route } from "@playwright/test";
import { defaultEntityIdentitySettings } from "../../supabase/functions/_shared/contracts/entity-identity.ts";

/** Mirror the public GET selector while PATCH continues returning the full saved result. */
export function settingsResponse(route: Route, result: { settings: Record<string, unknown>; versions: Record<string, number> }) {
  const id = new URL(route.request().url()).searchParams.get("id");
  if (route.request().method() !== "GET" || id === null) return result;
  if (id !== "entity_identity" && id !== "record_templates") throw new Error(`Unexpected settings selector: ${id}`);
  return { settings: { [id]: result.settings[id] }, versions: { [id]: result.versions[id] } };
}

/** Support endpoints do not count as domain writes in isolated workflow probes. */
export async function fulfillPreparation(route: Route): Promise<boolean> {
  const path = new URL(route.request().url()).pathname;
  let json: unknown;
  if (path === "/api/entity-types") json = { items: [fixtureType], next_cursor: null };
  else if (path.startsWith("/api/entity-types/")) json = path.endsWith("/schema") ? fixtureSchema : fixtureType;
  else if (path.endsWith("/settings/business")) json = settingsResponse(route, {settings:{entity_identity:defaultEntityIdentitySettings,record_templates:{}},versions:{entity_identity:0,record_templates:0}});
  else if (path.endsWith("/records/prepare")) {
    const body = route.request().postDataJSON();
    json = {change_note:body.change_note??"변경 기록",change_tag_ids:[],missing_tag_ids:[],settings_version:0,prepared_input:body.input??{}};
  } else return false;
  await route.fulfill({json});
  return true;
}
