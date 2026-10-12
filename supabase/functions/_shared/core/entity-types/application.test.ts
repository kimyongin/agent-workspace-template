import { assertEquals } from "@std/assert";
import { createEntityType } from "./application.ts";
import type { EntityTypeStore } from "./application.ts";
Deno.test("explicit type creation starts with required representative prop_1", async () => {
  let definition: unknown;
  const store = {
    executeRequest: (_r: unknown, fn: () => Promise<unknown>) => fn(),
    create: (input: unknown, value: unknown) => {
      definition = value;
      return Promise.resolve(input);
    },
  } as unknown as EntityTypeStore;
  await createEntityType({ uow: { run: (_actor, fn) => fn(store) } }, {
    userId: "owner",
    source: "http",
    request: { key: "11111111-1111-4111-8111-111111111111" },
  }, { label: "재료" });
  assertEquals((definition as { schema: { required: string[] } }).schema.required, ["prop_1"]);
});
