// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import { normalizePair } from "../../contracts/entity-pairs.ts";
Deno.test("reverse Unicode endpoints preserve the same endpoint versions and canonical pair", () => {
  assertEquals(normalizePair("local:😀", "local:\uE000", 7, 3), {
    entity_id: "local:\uE000",
    other_id: "local:😀",
    expected_version: 3,
    expected_other_version: 7,
  });
  assertEquals(normalizePair("local:\uE000", "local:😀", 3, 7), {
    entity_id: "local:\uE000",
    other_id: "local:😀",
    expected_version: 3,
    expected_other_version: 7,
  });
});
import { assertRejects } from "@std/assert";
import { changeEntityPair, type EntityPairStore } from "./application.ts";
import type { EntityValues } from "../../contracts/entity.ts";
import type { ChangeInput } from "../shared/changes.ts";
const actor = {
  userId: "00000000-0000-4000-8000-000000000001",
  request: { key: "00000000-0000-4000-8000-000000000002" },
};
function fixture(existingCount = 0) {
  const values = ["local:a", "local:b"].map(
    (id) => ({
      id,
      title: id,
      version: 1,
      deleted_at: null,
      type: { id: "t", label: "자료", icon_id: "box", archived: false },
      current_schema_version: 1,
    } as EntityValues),
  );
  let linked = false;
  const events: ChangeInput[] = [];
  const receipts = new Map<string, { fingerprint: string; value: unknown }>();
  const store: EntityPairStore = {
    async executeRequest(r, execute) {
      const old = receipts.get(r.key);
      if (old) {
        if (old.fingerprint !== r.fingerprint) throw Error("key reused");
        return old.value as Awaited<ReturnType<typeof execute>>;
      }
      const value = await execute();
      receipts.set(r.key, { fingerprint: r.fingerprint, value });
      return value;
    },
    async endpoints(ids) {
      return values.filter((v) => ids.includes(v.id));
    },
    async exists() {
      return linked;
    },
    async count() {
      return existingCount + (linked ? 1 : 0);
    },
    async change(_l, _r, next) {
      linked = next;
      values.forEach((v) => v.version++);
    },
    async list() {
      return [];
    },
    async appendChange(i) {
      events.push(i);
    },
  };
  return {
    values,
    events,
    d: {
      uow: {
        async run<T>(_a: typeof actor, fn: (s: EntityPairStore) => Promise<T>) {
          return await fn(store);
        },
      },
    },
  };
}
Deno.test("pair link is replayed in reverse with aligned versions and a single two-context event", async () => {
  const f = fixture();
  const first = await changeEntityPair(f.d, actor, "local:a", {
    other_id: "local:b",
    expected_version: 1,
    expected_other_version: 1,
  }, true);
  const replay = await changeEntityPair(f.d, actor, "local:b", {
    other_id: "local:a",
    expected_version: 1,
    expected_other_version: 1,
  }, true);
  assertEquals(replay, first);
  assertEquals(first.endpoint_versions, [{ id: "local:a", version: 2 }, { id: "local:b", version: 2 }]);
  assertEquals(f.events.length, 1);
  assertEquals(f.events[0].target.entity_context.map((e) => e.id), ["local:a", "local:b"]);
  const noop = await changeEntityPair(f.d, { ...actor, request: { key: crypto.randomUUID() } }, "local:b", {
    other_id: "local:a",
    expected_version: 2,
    expected_other_version: 2,
  }, true);
  assertEquals(noop.changed, false);
  assertEquals(f.events.length, 1);
});
Deno.test("deleted endpoint remains unlinkable and stale endpoint/self/missing references fail", async () => {
  const f = fixture();
  await changeEntityPair(
    f.d,
    actor,
    "local:a",
    { other_id: "local:b", expected_version: 1, expected_other_version: 1 },
    true,
  );
  f.values[1].deleted_at = "2026-10-12T00:00:00.000Z";
  const unlink = await changeEntityPair(f.d, { ...actor, request: { key: crypto.randomUUID() } }, "local:b", {
    other_id: "local:a",
    expected_version: 2,
    expected_other_version: 2,
  }, false);
  assertEquals(unlink.changed, true);
  assertEquals(f.events.length, 2);
  await assertRejects(() =>
    changeEntityPair(f.d, { ...actor, request: { key: crypto.randomUUID() } }, "local:a", {
      other_id: "local:b",
      expected_version: 2,
      expected_other_version: 3,
    }, false)
  );
  await assertRejects(async () =>
    await changeEntityPair(f.d, actor, "local:a", {
      other_id: "local:a",
      expected_version: 3,
      expected_other_version: 3,
    }, true)
  );
});

Deno.test("pair cap rejects the next relation but a current relation remains a no-op at the cap", async () => {
  const full = fixture(100);
  await assertRejects(() =>
    changeEntityPair(
      full.d,
      actor,
      "local:a",
      { other_id: "local:b", expected_version: 1, expected_other_version: 1 },
      true,
    )
  );
  assertEquals(full.events.length, 0);
  const last = fixture(99);
  await changeEntityPair(last.d, actor, "local:a", {
    other_id: "local:b",
    expected_version: 1,
    expected_other_version: 1,
  }, true);
  const noop = await changeEntityPair(last.d, { ...actor, request: { key: crypto.randomUUID() } }, "local:b", {
    other_id: "local:a",
    expected_version: 2,
    expected_other_version: 2,
  }, true);
  assertEquals(noop.changed, false);
  assertEquals(last.events.length, 1);
});
