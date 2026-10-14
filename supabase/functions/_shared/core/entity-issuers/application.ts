import { z } from "zod";
import {
  type EntityIssuer,
  type EntityTypeIdentity,
  type IdentifierRule,
  identifierRuleCreate,
  identifierRuleUpdate,
  issuerCode,
  issuerCreate,
  issuerUpdate,
  typeIdentityUpdate,
} from "../../contracts/entity-issuer.ts";
import type { Actor } from "../shared/actor.ts";
import { type RequestStore, runWrite } from "../shared/request.ts";
import { invalidInput, notFound } from "../shared/errors.ts";
export interface EntityIdentityReadStore {
  getTypeIdentity(typeId: string): Promise<EntityTypeIdentity | null>;
}
export interface EntityIssuerStore extends RequestStore, EntityIdentityReadStore {
  listIssuers(): Promise<EntityIssuer[]>;
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
  return runWrite(d.uow, a, "issuer.create", null, i, (s) => s.createIssuer(i));
}
export function updateEntityIssuer(d: EntityIssuerDeps, a: Actor, code: string, raw: unknown) {
  code = parse(issuerCode, code);
  const i = parse(issuerUpdate, raw);
  return runWrite(d.uow, a, "issuer.update", code, i, (s) => s.updateIssuer(code, i));
}
export function listIdentifierRules(d: EntityIssuerDeps, a: Actor, source: string) {
  source = parse(issuerCode, source);
  return d.uow.run(a, async (s) => ({ items: await s.listRules(source) }));
}
export function createIdentifierRule(d: EntityIssuerDeps, a: Actor, source: string, raw: unknown) {
  source = parse(issuerCode, source);
  const i = parse(identifierRuleCreate, raw);
  return runWrite(d.uow, a, "identifier-rule.create", source, i, (s) => s.createRule(source, i));
}
export function updateIdentifierRule(d: EntityIssuerDeps, a: Actor, id: string, raw: unknown) {
  id = parse(z.string().uuid(), id);
  const i = parse(identifierRuleUpdate, raw);
  return runWrite(d.uow, a, "identifier-rule.update", id, i, (s) => s.updateRule(id, i));
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
  return runWrite(d.uow, a, "entity-type.identity.update", typeId, i, (s) => s.updateTypeIdentity(typeId, i));
}
