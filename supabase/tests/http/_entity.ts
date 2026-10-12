import { admin } from "./_client.ts";
import { entityFixture } from "../database/_entity.ts";

/** The signed-in local test account owns its explicitly seeded schema. */
export function httpEntityFixture(token: string) {
  const payload = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
  const { sub } = JSON.parse(atob(payload)) as { sub: string };
  return entityFixture(admin, sub);
}
