import type { Route } from "@playwright/test";
import { generateDataId } from "../../supabase/functions/_shared/contracts/data-id.ts";
import { defaultEntityIdentitySettings } from "../../supabase/functions/_shared/contracts/entity-identity.ts";

/** Support endpoints do not count as domain writes in isolated workflow probes. */
export async function fulfillPreparation(route: Route): Promise<boolean> {
  const path = new URL(route.request().url()).pathname;
  let json: unknown;
  if (path.endsWith("/ids/allocate")) json = {id:generateDataId()};
  else if (path.endsWith("/settings/business")) json = {settings:{entity_identity:defaultEntityIdentitySettings,record_templates:{}},versions:{entity_identity:0,record_templates:0}};
  else if (path.endsWith("/records/prepare")) {
    const body = route.request().postDataJSON();
    json = {change_note:body.change_note??"변경 기록",change_tag_ids:[],missing_tag_ids:[],settings_version:0,prepared_input:body.input??{}};
  } else return false;
  await route.fulfill({json});
  return true;
}
