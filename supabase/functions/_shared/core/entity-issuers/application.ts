import {
  assertIssuerCreation,
  assertRegistryDeletion,
  assertRuleCreation,
  assertTypeIdentityUpdate,
  identifierRuleUpdateDecision,
  type IdentitySourceAvailability,
  issuerUpdateDecision,
  type RuleUsage,
} from "./domain.ts";
import { z } from "zod";
import {
  type EntityIssuer,
  type EntityTypeIdentity,
  type IdentifierRule,
  identifierRuleCreate,
  identifierRuleUpdate,
  type IdentityDefaultType,
  issuerCode,
  issuerCreate,
  issuerUpdate,
  registryDelete,
  typeIdentityUpdate,
} from "../../contracts/entity-issuer.ts";
import type { Actor } from "../shared/actor.ts";
import { type RequestStore, runWrite } from "../shared/request.ts";
import { invalidInput, notFound } from "../shared/errors.ts";
export interface EntityIdentityReadStore {
  getTypeIdentity(typeId: string): Promise<EntityTypeIdentity | null>;
}
/** Mutation facts hold the owner registry lock until the unit-of-work transaction ends. */
export interface EntityIssuerStore extends RequestStore, EntityIdentityReadStore {
  listIssuers(): Promise<EntityIssuer[]>;
  countIssuersForUpdate(): Promise<number>;
  lockIssuer(code: string): Promise<EntityIssuer | null>;
  defaultTypes(source: string, ruleId?: string): Promise<IdentityDefaultType[]>;
  issuerHasDependencies(code: string): Promise<boolean>;
  ruleHasDependencies(id: string): Promise<boolean>;
  deleteIssuer(code: string): Promise<void>;
  deleteRule(id: string): Promise<void>;
  countRules(source: string): Promise<number>;
  lockRule(id: string): Promise<IdentifierRule | null>;
  ruleUsage(id: string): Promise<RuleUsage>;
  lockTypeIdentity(typeId: string): Promise<EntityTypeIdentity | null>;
  identitySourceAvailability(sources: { code: string; rule_id: string }[]): Promise<IdentitySourceAvailability[]>;
  createIssuer(input: z.infer<typeof issuerCreate>): Promise<EntityIssuer>;
  updateIssuer(code: string, input: z.infer<typeof issuerUpdate>): Promise<EntityIssuer>;
  listRules(source: string): Promise<IdentifierRule[]>;
  createRule(source: string, input: z.infer<typeof identifierRuleCreate>): Promise<IdentifierRule>;
  updateRule(id: string, input: z.infer<typeof identifierRuleUpdate>): Promise<IdentifierRule>;
  updateTypeIdentity(typeId: string, input: z.infer<typeof typeIdentityUpdate>): Promise<EntityTypeIdentity>;
}
export interface EntityIssuerDeps {
  uow: { run<T>(actor: Actor, fn: (store: EntityIssuerStore) => Promise<T>): Promise<T> };
}
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw invalidInput(
      "발급처·식별자 설정 입력을 확인하세요",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}
export function listEntityIssuers(d: EntityIssuerDeps, a: Actor) {
  return d.uow.run(a, async (s) => ({ items: await s.listIssuers() }));
}
export function createEntityIssuer(d: EntityIssuerDeps, a: Actor, raw: unknown) {
  const i = parse(issuerCreate, raw);
  return runWrite(d.uow, a, "issuer.create", null, i, async (s) => {
    assertIssuerCreation(i.code, await s.countIssuersForUpdate());
    return s.createIssuer(i);
  });
}
export function updateEntityIssuer(d: EntityIssuerDeps, a: Actor, code: string, raw: unknown) {
  code = parse(issuerCode, code);
  const i = parse(issuerUpdate, raw);
  return runWrite(d.uow, a, "issuer.update", code, i, async (s) => {
    const current = await s.lockIssuer(code);
    if (!current) throw notFound();
    const next = issuerUpdateDecision(current, i, await s.defaultTypes(code));
    return s.updateIssuer(code, { ...next, expected_version: i.expected_version });
  });
}
export function listIdentifierRules(d: EntityIssuerDeps, a: Actor, source: string) {
  source = parse(issuerCode, source);
  return d.uow.run(a, async (s) => ({ items: await s.listRules(source) }));
}
export function createIdentifierRule(d: EntityIssuerDeps, a: Actor, source: string, raw: unknown) {
  source = parse(issuerCode, source);
  const i = parse(identifierRuleCreate, raw);
  return runWrite(d.uow, a, "identifier-rule.create", source, i, async (s) => {
    const current = await s.lockIssuer(source);
    if (!current) throw notFound();
    assertRuleCreation(current, await s.countRules(source));
    return s.createRule(source, i);
  });
}
export function updateIdentifierRule(d: EntityIssuerDeps, a: Actor, id: string, raw: unknown) {
  id = parse(z.string().uuid(), id);
  const i = parse(identifierRuleUpdate, raw);
  return runWrite(d.uow, a, "identifier-rule.update", id, i, async (s) => {
    const current = await s.lockRule(id);
    if (!current) throw notFound();
    const next = identifierRuleUpdateDecision(current, i, await s.ruleUsage(id));
    return s.updateRule(id, { ...next, expected_version: i.expected_version });
  });
}
export function getEntityTypeIdentity(d: EntityIssuerDeps, a: Actor, typeId: string) {
  typeId = parse(z.string().uuid(), typeId);
  return d.uow.run(a, async (s) => {
    const value = await s.getTypeIdentity(typeId);
    if (!value) throw notFound();
    return value;
  });
}
export function updateEntityTypeIdentity(d: EntityIssuerDeps, a: Actor, typeId: string, raw: unknown) {
  typeId = parse(z.string().uuid(), typeId);
  const i = parse(typeIdentityUpdate, raw);
  return runWrite(d.uow, a, "entity-type.identity.update", typeId, i, async (s) => {
    const current = await s.lockTypeIdentity(typeId);
    if (!current) throw notFound();
    assertTypeIdentityUpdate(current, i, await s.identitySourceAvailability(i.sources));
    return s.updateTypeIdentity(typeId, i);
  });
}

export function deleteEntityIssuer(d: EntityIssuerDeps, a: Actor, code: string, raw: unknown) {
  code = parse(issuerCode, code);
  const input = parse(registryDelete, raw);
  return runWrite(d.uow, a, "issuer.delete", code, input, async (s) => {
    const current = await s.lockIssuer(code);
    if (!current) throw notFound();
    assertRegistryDeletion(current, input.expected_version, current.system, await s.issuerHasDependencies(code));
    await s.deleteIssuer(code);
    return { deleted: true };
  });
}
export function deleteIdentifierRule(d: EntityIssuerDeps, a: Actor, id: string, raw: unknown) {
  id = parse(z.string().uuid(), id);
  const input = parse(registryDelete, raw);
  return runWrite(d.uow, a, "identifier-rule.delete", id, input, async (s) => {
    const current = await s.lockRule(id);
    if (!current) throw notFound();
    assertRegistryDeletion(current, input.expected_version, current.source === "app", await s.ruleHasDependencies(id));
    await s.deleteRule(id);
    return { deleted: true };
  });
}
