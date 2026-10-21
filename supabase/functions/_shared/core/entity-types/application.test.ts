import { assertEquals, assertRejects } from "@std/assert";
import { createEntityType } from "./application.ts";
import type { EntityTypeStore } from "./application.ts";
Deno.test("explicit type creation starts with an ordinary required initial name and title template", async () => {
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
    const input of [{ label: "bad\u0000" }, { label: "name", initial_property_label: "bad\u0000" }, {
      label: "bad\uD800",
    }]
  ) {
    const e = await assertRejects(async () =>
      await createEntityType(d, { userId: "owner", source: "http", request: { key: crypto.randomUUID() } }, input)
    );
    assertEquals((e as { code: string }).code, "invalid_input");
  }
});

import { updateEntityType } from "./application.ts";
import { requestIdentity } from "../shared/request.ts";
Deno.test("removed metadata input can only replay its exact retained receipt and never execute", async () => {
  const actor = { userId: "owner", request: { key: crypto.randomUUID() } }, id = crypto.randomUUID();
  const raw = { expected_type_version: 2, label: "예전 이름" };
  const expected = await requestIdentity(actor, "entity-type.update", id, raw);
  const historical = { id, label: "예전 이름", version: 3, schema_version: 1 };
  let found = true, received: unknown;
  const store = {
    replayRetainedRequest: (request: unknown) => {
      received = request;
      return Promise.resolve({ found, result: historical });
    },
    update: () => {
      throw new Error("legacy input must never execute");
    },
    executeRequest: () => {
      throw new Error("must never allocate a new legacy receipt");
    },
  } as unknown as EntityTypeStore;
  const deps = { uow: { run: <T>(_a: unknown, fn: (s: EntityTypeStore) => Promise<T>) => fn(store) } };
  assertEquals<unknown>(await updateEntityType(deps, actor, id, raw), historical);
  assertEquals(received, expected);
  found = false;
  const error = await assertRejects(() => updateEntityType(deps, actor, id, raw));
  assertEquals((error as { code: string }).code, "invalid_input");
});
