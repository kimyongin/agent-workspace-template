import { assertEquals, assertRejects } from "@std/assert";
import { updateEntityTypeIdentity } from "./application.ts";
Deno.test("type identity rejects an empty active source list before storage", async () => {
  const e = await assertRejects(async () =>
    await updateEntityTypeIdentity(
      {
        uow: {
          run: () => {
            throw new Error("must not reach storage");
          },
        },
      },
      { userId: "owner", request: { key: crypto.randomUUID() } },
      "11111111-1111-4111-8111-111111111111",
      { label: "상품 번호", default_source: "app", sources: [], expected_version: 1 },
    )
  );
  assertEquals((e as { code: string }).code, "invalid_input");
});

Deno.test("type identity rejects a default source missing from active sources", async () => {
  const e = await assertRejects(async () =>
    await updateEntityTypeIdentity(
      {
        uow: {
          run: () => {
            throw new Error("must not reach storage");
          },
        },
      },
      { userId: "owner", request: { key: crypto.randomUUID() } },
      "11111111-1111-4111-8111-111111111111",
      {
        label: "상품 번호",
        default_source: "naver",
        expected_version: 1,
        sources: [{ code: "app", rule_id: "00000000-0000-4000-8000-000000000001", active: true }],
      },
    )
  );
  assertEquals((e as { code: string }).code, "invalid_input");
});

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
    ruleUsage: () => Promise.resolve({ referenced: true, usedAsDefault: false }),
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

import { createEntityIssuer, createIdentifierRule, getEntityTypeIdentity, updateEntityIssuer } from "./application.ts";
import type { EntityIssuer, EntityTypeIdentity, IdentifierRule } from "../../contracts/entity-issuer.ts";
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
  let identity: EntityTypeIdentity = {
    type_id: "11111111-1111-4111-8111-111111111111",
    label: "번호",
    default_source: "app",
    version: 1,
    sources: [{
      code: "app",
      rule_id: "00000000-0000-4000-8000-000000000001",
      active: true,
      referenced: false,
      source_label: "앱",
      rule_label: "자동 발급",
      generation: "automatic",
    }, {
      code: "crm",
      rule_id: rule.id,
      active: true,
      referenced: true,
      source_label: "고객",
      rule_label: "고객 번호",
      generation: "direct",
    }],
  };
  let defaultUsed = false, issuerActive = true, ruleActive = true, ruleVisible = true;
  const store = {
    executeRequest: <T>(_r: unknown, fn: () => Promise<T>) => fn(),
    countIssuersForUpdate: () => Promise.resolve(2),
    lockIssuer: (code: string) => Promise.resolve(code === "app" ? app : issuer),
    issuerIsDefault: () => Promise.resolve(defaultUsed),
    countRules: () => Promise.resolve(1),
    lockRule: () => Promise.resolve(rule),
    ruleUsage: () => Promise.resolve({ referenced: true, usedAsDefault: defaultUsed }),
    listRules: () => Promise.resolve([rule]),
    listIssuers: () => Promise.resolve([app, issuer]),
    getTypeIdentity: () => Promise.resolve(identity),
    lockTypeIdentity: () => Promise.resolve(identity),
    identitySourceAvailability: () =>
      Promise.resolve(
        identity.sources.filter((s) => s.code === "app" || ruleVisible).map((s) => ({
          code: s.code,
          rule_id: s.rule_id,
          issuer_active: s.code === "app" || issuerActive,
          rule_active: s.code === "app" || ruleActive,
        })),
      ),
    updateIssuer: (_code: string, input: Partial<EntityIssuer>) =>
      Promise.resolve(issuer = { ...issuer, ...input, version: issuer.version + 1 }),
    updateRule: (_id: string, input: Partial<IdentifierRule>) =>
      Promise.resolve(rule = { ...rule, ...input, version: rule.version + 1 }),
    updateTypeIdentity: (
      _id: string,
      input: { label: string; default_source: string; sources: { code: string; rule_id: string; active: boolean }[] },
    ) =>
      Promise.resolve(
        identity = {
          ...identity,
          ...input,
          version: identity.version + 1,
          sources: input.sources.map((s) => ({ ...identity.sources.find((old) => old.code === s.code)!, ...s })),
        },
      ),
  } as unknown as EntityIssuerStore;
  return {
    d: { uow: { run: <T>(_actor: unknown, fn: (store: EntityIssuerStore) => Promise<T>) => fn(store) } },
    actor: { userId: "owner", request: { key: crypto.randomUUID() } },
    rule,
    identity,
    available: (issuer: boolean, rule: boolean, visible = true) => {
      issuerActive = issuer;
      ruleActive = rule;
      ruleVisible = visible;
    },
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
  ) assertEquals((await assertRejects(command) as { code: string }).code, "conflict");
  f.defaultUsed(false);
  const stopped = await updateIdentifierRule(f.d, f.actor, f.rule.id, {
    active: false,
    label: "원본 고객 번호",
    expected_version: 1,
  });
  assertEquals([stopped.label, stopped.active], ["원본 고객 번호", false]);
  assertEquals((await listIdentifierRules(f.d, f.actor, "crm")).items[0].meaning, "고객 한 명");
});
Deno.test("referenced type mapping cannot be removed or replaced but can stop supporting new registrations", async () => {
  const f = registryFixture(),
    sources = f.identity.sources.map(({ code, rule_id, active }) => ({ code, rule_id, active }));
  for (const next of [[sources[0]], [sources[0], { ...sources[1], rule_id: "33333333-3333-4333-8333-333333333333" }]]) {
    assertEquals(
      (await assertRejects(() =>
        updateEntityTypeIdentity(f.d, f.actor, f.identity.type_id, {
          label: "번호",
          default_source: "app",
          expected_version: 1,
          sources: next,
        })
      ) as { code: string }).code,
      "invalid_input",
    );
  }
  await updateEntityTypeIdentity(f.d, f.actor, f.identity.type_id, {
    label: "번호",
    default_source: "app",
    expected_version: 1,
    sources: [sources[0], { ...sources[1], active: false }],
  });
  assertEquals((await getEntityTypeIdentity(f.d, f.actor, f.identity.type_id)).sources[1].active, false);
  assertEquals((await getEntityTypeIdentity(f.d, f.actor, f.identity.type_id)).sources[1].referenced, true);
});
Deno.test("core type identity refuses inactive and unavailable issuer-rule bindings without changing saved settings", async () => {
  const f = registryFixture(),
    input = {
      label: "새 번호",
      default_source: "app",
      expected_version: 1,
      sources: f.identity.sources.map(({ code, rule_id, active }) => ({ code, rule_id, active })),
    };
  for (const facts of [[false, true, true], [true, false, true], [true, true, false]] as const) {
    f.available(facts[0], facts[1], facts[2]);
    const error = await assertRejects(() => updateEntityTypeIdentity(f.d, f.actor, f.identity.type_id, input));
    assertEquals((error as { code: string }).code, facts[2] ? "invalid_input" : "invalid_reference");
    assertEquals((await getEntityTypeIdentity(f.d, f.actor, f.identity.type_id)).label, "번호");
  }
  f.available(true, true);
  assertEquals((await updateEntityTypeIdentity(f.d, f.actor, f.identity.type_id, input)).label, "새 번호");
});
