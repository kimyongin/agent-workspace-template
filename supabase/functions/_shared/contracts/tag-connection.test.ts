import { assertEquals } from "@std/assert";
import { tagConnectionInput } from "./tag-connection.ts";
Deno.test("saved target tag command separates entity identity and record metadata", () => {
  const entity = {
    target_kind: "entity",
    target_id: `app:${crypto.randomUUID()}:saved`,
    expected_version: 1,
    tag_ids: [],
  };
  assertEquals(tagConnectionInput.safeParse(entity).success, true);
  assertEquals(tagConnectionInput.safeParse({ ...entity, properties: { prop_1: "content" } }).success, false);
  assertEquals(tagConnectionInput.safeParse({ ...entity, target_id: "unsaved" }).success, false);
  const record = { target_kind: "record", target_id: "20261018-ABCDEFGH", expected_version: 1, tag_ids: [] };
  assertEquals(tagConnectionInput.safeParse(record).success, true);
  assertEquals(tagConnectionInput.safeParse({ ...record, change_note: "no recursive edit log" }).success, false);
  assertEquals(tagConnectionInput.safeParse({ ...record, change_tag_ids: [] }).success, false);
});
