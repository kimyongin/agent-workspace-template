import {
  assertIssuerCreation,
  assertRegistryDeletion,
  assertRuleCreation,
  identifierRuleUpdateDecision,
  issuerUpdateDecision,
  type RuleUsage,
} from "./domain.ts";
import { z } from "zod";
import {
  type EntityIssuer,
  type IdentifierRule,
  identifierRuleCreate,
  identifierRuleUpdate,
  type IdentityDefaultType,
  issuerCode,
  issuerCreate,
  issuerUpdate,
  registryDelete,
} from "../../contracts/entity-issuer.ts";
import type { WorkspaceEntry } from "../workspaces/application.ts";
import type { Actor } from "../shared/actor.ts";
import { type RequestStore, runWrite } from "../shared/request.ts";
import { invalidInput, notFound } from "../shared/errors.ts";
/** Mutation facts hold the owner registry lock until the unit-of-work transaction ends. */
export interface EntityIssuerStore extends RequestStore {
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
  ruleUsage(id: string, inspectReferences?: boolean): Promise<RuleUsage>;
  createIssuer(input: z.infer<typeof issuerCreate>): Promise<EntityIssuer>;
  updateIssuer(code: string, input: z.infer<typeof issuerUpdate>): Promise<EntityIssuer>;
  listRules(source: string): Promise<IdentifierRule[]>;
  createRule(source: string, input: z.infer<typeof identifierRuleCreate>): Promise<IdentifierRule>;
  updateRule(id: string, input: z.infer<typeof identifierRuleUpdate>): Promise<IdentifierRule>;
}
export interface EntityIssuerDeps {
  uow: { run<T>(actor: Actor, fn: (store: EntityIssuerStore) => Promise<T>, entry?: WorkspaceEntry): Promise<T> };
}
function scoped(d: EntityIssuerDeps, access: "read" | "write"): EntityIssuerDeps["uow"] {
  return {
    run: (actor, fn) =>
      d.uow.run(actor, fn, {
        mode: "business",
        requirements: [{ target_kind: "settings", target_id: "*", access }],
      }),
  };
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
  return scoped(d, "read").run(a, async (s) => ({ items: await s.listIssuers() }));
}
export function createEntityIssuer(d: EntityIssuerDeps, a: Actor, raw: unknown) {
  const i = parse(issuerCreate, raw);
  return runWrite(scoped(d, "write"), a, "issuer.create", null, i, async (s) => {
    assertIssuerCreation(i.code, await s.countIssuersForUpdate());
    return s.createIssuer(i);
  });
}
export function updateEntityIssuer(d: EntityIssuerDeps, a: Actor, code: string, raw: unknown) {
  code = parse(issuerCode, code);
  const i = parse(issuerUpdate, raw);
  return runWrite(scoped(d, "write"), a, "issuer.update", code, i, async (s) => {
    const current = await s.lockIssuer(code);
    if (!current) throw notFound();
    const next = issuerUpdateDecision(current, i, await s.defaultTypes(code));
    return s.updateIssuer(code, { ...next, expected_version: i.expected_version });
  });
}
export function listIdentifierRules(d: EntityIssuerDeps, a: Actor, source: string) {
  source = parse(issuerCode, source);
  return scoped(d, "read").run(a, async (s) => ({ items: await s.listRules(source) }));
}
export function createIdentifierRule(d: EntityIssuerDeps, a: Actor, source: string, raw: unknown) {
  source = parse(issuerCode, source);
  const i = parse(identifierRuleCreate, raw);
  return runWrite(scoped(d, "write"), a, "identifier-rule.create", source, i, async (s) => {
    const current = await s.lockIssuer(source);
    if (!current) throw notFound();
    assertRuleCreation(current, await s.countRules(source));
    return s.createRule(source, i);
  });
}
export function updateIdentifierRule(d: EntityIssuerDeps, a: Actor, id: string, raw: unknown) {
  id = parse(z.string().uuid(), id);
  const i = parse(identifierRuleUpdate, raw);
  return runWrite(scoped(d, "write"), a, "identifier-rule.update", id, i, async (s) => {
    const current = await s.lockRule(id);
    if (!current) throw notFound();
    const metadataUsage = { referenced: false, defaultTypes: [] };
    // Validate immutable system fields before resolving any stored assignment usage.
    identifierRuleUpdateDecision(current, i, metadataUsage);
    const meaningChanged = i.meaning !== undefined && i.meaning !== current.meaning;
    const usage = meaningChanged || i.active === false ? await s.ruleUsage(id, meaningChanged) : metadataUsage;
    const next = identifierRuleUpdateDecision(current, i, usage);
    return s.updateRule(id, { ...next, expected_version: i.expected_version });
  });
}
export function deleteEntityIssuer(d: EntityIssuerDeps, a: Actor, code: string, raw: unknown) {
  code = parse(issuerCode, code);
  const input = parse(registryDelete, raw);
  return runWrite(scoped(d, "write"), a, "issuer.delete", code, input, async (s) => {
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
  return runWrite(scoped(d, "write"), a, "identifier-rule.delete", id, input, async (s) => {
    const current = await s.lockRule(id);
    if (!current) throw notFound();
    assertRegistryDeletion(current, input.expected_version, current.source === "app", await s.ruleHasDependencies(id));
    await s.deleteRule(id);
    return { deleted: true };
  });
}
