import { assertEquals, assertRejects } from "@std/assert";
import { type EntityIssuerStore, listIdentifierRules, updateIdentifierRule } from "./application.ts";
Deno.test("referenced rule meaning cannot change through the public core usecase", async () => {
  let stored = {
    id: "22222222-2222-4222-8222-222222222222",
    source: "crm",
    label: "고객 번호",
    meaning: "고객 한 명",
    generation: "direct" as const,
    active: true,
    version: 1,
  };
  const store = {
    executeRequest: <T>(_r: unknown, fn: () => Promise<T>) => fn(),
    lockRule: () => Promise.resolve(stored),
    ruleUsage: () => Promise.resolve({ referenced: true, defaultTypes: [] }),
    listRules: () => Promise.resolve([stored]),
    updateRule: (_id: string, input: { meaning?: string }) => {
      stored = { ...stored, meaning: input.meaning ?? stored.meaning };
      return Promise.resolve(stored);
    },
  } as unknown as EntityIssuerStore;
  const d = { uow: { run: <T>(_a: unknown, fn: (s: EntityIssuerStore) => Promise<T>) => fn(store) } },
    actor = { userId: "owner", request: { key: crypto.randomUUID() } };
  const error = await assertRejects(() =>
    updateIdentifierRule(d, actor, stored.id, { meaning: "주문 한 건", expected_version: 1 })
  );
  assertEquals((error as { code: string }).code, "invalid_input");
  assertEquals((await listIdentifierRules(d, actor, "crm")).items[0].meaning, "고객 한 명");
});

import { createEntityIssuer, createIdentifierRule, updateEntityIssuer } from "./application.ts";
import type { EntityIssuer, IdentifierRule } from "../../contracts/entity-issuer.ts";
function registryFixture() {
  const app: EntityIssuer = { code: "app", label: "앱", active: true, system: true, version: 1 },
    crm: EntityIssuer = { code: "crm", label: "고객", active: true, system: false, version: 1 };
  let issuer = crm,
    rule: IdentifierRule = {
      id: "22222222-2222-4222-8222-222222222222",
      source: "crm",
      label: "고객 번호",
      meaning: "고객 한 명",
      generation: "direct",
      active: true,
      version: 1,
    };
  const typeId = "11111111-1111-4111-8111-111111111111";
  let defaultUsed = false;
  const store = {
    executeRequest: <T>(_r: unknown, fn: () => Promise<T>) => fn(),
    countIssuersForUpdate: () => Promise.resolve(2),
    lockIssuer: (code: string) => Promise.resolve(code === "app" ? app : issuer),
    defaultTypes: () => Promise.resolve(defaultUsed ? [{ type_id: typeId, property: "prop_2", label: "상품" }] : []),
    countRules: () => Promise.resolve(1),
    lockRule: () => Promise.resolve(rule),
    ruleUsage: () =>
      Promise.resolve({
        referenced: true,
        defaultTypes: defaultUsed ? [{ type_id: typeId, property: "prop_2", label: "상품" }] : [],
      }),
    listRules: () => Promise.resolve([rule]),
    listIssuers: () => Promise.resolve([app, issuer]),
    updateIssuer: (_code: string, input: Partial<EntityIssuer>) =>
      Promise.resolve(issuer = { ...issuer, ...input, version: issuer.version + 1 }),
    updateRule: (_id: string, input: Partial<IdentifierRule>) =>
      Promise.resolve(rule = { ...rule, ...input, version: rule.version + 1 }),
  } as unknown as EntityIssuerStore;
  return {
    d: { uow: { run: <T>(_actor: unknown, fn: (store: EntityIssuerStore) => Promise<T>) => fn(store) } },
    actor: { userId: "owner", request: { key: crypto.randomUUID() } },
    rule,
    typeId,
    defaultUsed: (value: boolean) => {
      defaultUsed = value;
    },
  };
}
Deno.test("core registry keeps app definitions protected and requires moving defaults before a global stop", async () => {
  const f = registryFixture();
  for (
    const command of [
      () => createEntityIssuer(f.d, f.actor, { code: "app", label: "별도 앱" }),
      () => createIdentifierRule(f.d, f.actor, "app", { label: "다른 번호", meaning: "다른 번호" }),
      () => updateEntityIssuer(f.d, f.actor, "app", { active: false, expected_version: 1 }),
    ]
  ) assertEquals((await assertRejects(command) as { code: string }).code, "invalid_input");
  f.defaultUsed(true);
  for (
    const command of [
      () => updateEntityIssuer(f.d, f.actor, "crm", { active: false, expected_version: 1 }),
      () => updateIdentifierRule(f.d, f.actor, f.rule.id, { active: false, expected_version: 1 }),
    ]
  ) assertEquals((await assertRejects(command) as { code: string }).code, "invalid_input");
  f.defaultUsed(false);
  const stopped = await updateIdentifierRule(f.d, f.actor, f.rule.id, {
    active: false,
    label: "원본 고객 번호",
    expected_version: 1,
  });
  assertEquals([stopped.label, stopped.active], ["원본 고객 번호", false]);
  assertEquals((await listIdentifierRules(f.d, f.actor, "crm")).items[0].meaning, "고객 한 명");
});
import { deleteEntityIssuer, deleteIdentifierRule } from "./application.ts";
Deno.test("unused registry deletion checks version, system and every mapping before removing definitions", async () => {
  const issuer = { code: "crm", label: "고객", active: true, system: false, version: 3 };
  const rule = { id: "22222222-2222-4222-8222-222222222222", source: "crm", version: 4 };
  let used = true, deleted = 0;
  const store = {
    executeRequest: <T>(_r: unknown, fn: () => Promise<T>) => fn(),
    lockIssuer: () => Promise.resolve(issuer),
    lockRule: () => Promise.resolve(rule),
    issuerHasDependencies: () => Promise.resolve(used),
    ruleHasDependencies: () => Promise.resolve(used),
    deleteIssuer: () => {
      deleted++;
      return Promise.resolve();
    },
    deleteRule: () => {
      deleted++;
      return Promise.resolve();
    },
  } as unknown as EntityIssuerStore;
  const d = { uow: { run: <T>(_a: unknown, fn: (s: EntityIssuerStore) => Promise<T>) => fn(store) } };
  const actor = { userId: "owner", request: { key: crypto.randomUUID() } };
  assertEquals(
    (await assertRejects(() => deleteEntityIssuer(d, actor, "crm", { expected_version: 2 })) as { code: string }).code,
    "settings_changed",
  );
  for (
    const run of [
      () => deleteEntityIssuer(d, actor, "crm", { expected_version: 3 }),
      () => deleteIdentifierRule(d, actor, rule.id, { expected_version: 4 }),
    ]
  ) {
    assertEquals((await assertRejects(run) as { code: string }).code, "invalid_input");
  }
  assertEquals(deleted, 0);
  used = false;
  issuer.system = true;
  assertEquals(
    (await assertRejects(() => deleteEntityIssuer(d, actor, "crm", { expected_version: 3 })) as { code: string }).code,
    "invalid_input",
  );
  issuer.system = false;
  assertEquals(await deleteIdentifierRule(d, actor, rule.id, { expected_version: 4 }), { deleted: true });
  assertEquals(await deleteEntityIssuer(d, actor, "crm", { expected_version: 3 }), { deleted: true });
  assertEquals(deleted, 2);
});

Deno.test("policy refusals identify all affected kinds while stale registry versions remain settings_changed", async () => {
  const f = registryFixture();
  f.defaultUsed(true);
  const error = await assertRejects(() =>
    updateEntityIssuer(f.d, f.actor, "crm", { active: false, expected_version: 1 })
  );
  assertEquals((error as { fields: unknown }).fields, [{
    path: `default_fields.${f.typeId}.prop_2`,
    message: "상품",
  }]);
  assertEquals(
    (await assertRejects(() => updateEntityIssuer(f.d, f.actor, "crm", { active: false, expected_version: 9 })) as {
      code: string;
    }).code,
    "settings_changed",
  );
});

Deno.test("stopping a kind identifies every affected default property, including two fields on one type", async () => {
  const typeId = "11111111-1111-4111-8111-111111111111";
  const rule = {
    id: "22222222-2222-4222-8222-222222222222",
    source: "crm",
    label: "고객",
    meaning: "원본 고객",
    generation: "direct" as const,
    active: true,
    version: 1,
  };
  const store = {
    executeRequest: <T>(_r: unknown, fn: () => Promise<T>) => fn(),
    lockRule: () => Promise.resolve(rule),
    ruleUsage: () =>
      Promise.resolve({
        referenced: true,
        defaultTypes: [{ type_id: typeId, property: "prop_2", label: "상품 · 상품 번호" }, {
          type_id: typeId,
          property: "prop_3",
          label: "상품 · 주문 번호",
        }],
      }),
    updateRule: () => {
      throw Error("blocked stop must not write");
    },
  } as unknown as EntityIssuerStore;
  const error = await assertRejects(() =>
    updateIdentifierRule(
      { uow: { run: (_a, fn) => fn(store) } },
      { userId: "owner", request: { key: crypto.randomUUID() } },
      rule.id,
      { active: false, expected_version: 1 },
    )
  );
  assertEquals((error as { fields: unknown }).fields, [{
    path: `default_fields.${typeId}.prop_2`,
    message: "상품 · 상품 번호",
  }, { path: `default_fields.${typeId}.prop_3`, message: "상품 · 주문 번호" }]);
});
