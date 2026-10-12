import { assertEquals, assertRejects } from "@std/assert";
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

Deno.test("type metadata SQL-unsafe input fails at the public usecase before transaction", async () => {
  const d = {
    uow: {
      run: () => {
        throw new Error("must not reach storage");
      },
    },
  };
  for (
    const input of [{ label: "bad\u0000" }, { label: "name", representative_label: "bad\u0000" }, {
      label: "bad\uD800",
    }]
  ) {
    const e = await assertRejects(async () =>
      await createEntityType(d, { userId: "owner", source: "http", request: { key: crypto.randomUUID() } }, input)
    );
    assertEquals((e as { code: string }).code, "invalid_input");
  }
});
