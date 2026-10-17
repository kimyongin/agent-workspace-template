import { assertEquals } from "@std/assert";
import { entityListQuery } from "../../functions/_shared/contracts/entity.ts";

Deno.test("entity lookup rejects the removed unconfigured relation candidate input", () => {
  assertEquals(
    entityListQuery.safeParse({ link_candidate_for: "app:10000000-0000-4000-8000-000000000001:product", limit: 20 })
      .success,
    false,
  );
  assertEquals(
    entityListQuery.safeParse({ entity_type_id: "10000000-0000-4000-8000-000000000001", limit: 20 }).success,
    true,
  );
});
