import { assertEquals, assertRejects } from "@std/assert";
import { createEntityRelationDefinition, updateEntityRelationDefinition } from "./application.ts";
import { AppError } from "../shared/errors.ts";
import type { EntityRelationDefinition } from "../../contracts/entity-relation.ts";
import type { EntityRelationDefinitionStore } from "./application.ts";
Deno.test("relation definition preserves same-kind roles and rejects stale archive", async () => {
  let row: EntityRelationDefinition | null = null;
  const store = {
    executeRequest: (_r: unknown, execute: () => Promise<unknown>) => execute(),
    typesAvailable: () => Promise.resolve(true),
    lock: () => Promise.resolve(row),
    assertCompatible: () => Promise.resolve(),
    create: (ends: EntityRelationDefinition["ends"]) =>
      Promise.resolve(row = { id: crypto.randomUUID(), version: 1, archived: false, ends }),
    update: (_id: string, ends: EntityRelationDefinition["ends"], archived: boolean) =>
      Promise.resolve(row = { ...row!, ends, archived, version: row!.version + 1 }),
  } as unknown as EntityRelationDefinitionStore;
  const deps = { uow: { run: <T>(_a: unknown, fn: (s: EntityRelationDefinitionStore) => Promise<T>) => fn(store) } };
  const actor = { userId: crypto.randomUUID(), source: "http" as const, request: { key: crypto.randomUUID() } };
  const type = crypto.randomUUID();
  const ends = [{ type_id: type, label: "상위", cardinality: "one" }, {
    type_id: type,
    label: "하위",
    cardinality: "many",
  }];
  const created = await createEntityRelationDefinition(deps, actor, { ends });
  assertEquals(created.ends.map((e) => e.label), ["상위", "하위"]);
  assertEquals(
    (await updateEntityRelationDefinition(deps, actor, created.id, { expected_version: 1, archived: true })).archived,
    true,
  );
  assertEquals(
    (await assertRejects(
      () => updateEntityRelationDefinition(deps, actor, created.id, { expected_version: 1, archived: false }),
      AppError,
    ))
      .code,
    "settings_changed",
  );
});
