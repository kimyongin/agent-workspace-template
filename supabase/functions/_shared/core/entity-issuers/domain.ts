import type { z } from "zod";
import type {
  EntityIssuer,
  EntityTypeIdentity,
  IdentifierRule,
  identifierRuleUpdate,
  IdentityDefaultType,
  issuerUpdate,
  typeIdentityUpdate,
} from "../../contracts/entity-issuer.ts";
import { identityDefaultTypeField } from "../../contracts/entity-issuer.ts";
import { AppError, invalidInput } from "../shared/errors.ts";
export interface RuleUsage {
  referenced: boolean;
  defaultTypes: IdentityDefaultType[];
}
export interface IdentitySourceAvailability {
  code: string;
  rule_id: string;
  issuer_active: boolean;
  rule_active: boolean;
}
function assertVersion(current: number, expected: number) {
  if (current !== expected) throw new AppError("settings_changed", "설정이 변경되었습니다. 최신 버전을 확인하세요");
}
export function assertIssuerCreation(code: string, count: number) {
  if (code === "app") throw invalidInput("앱 발급처는 시스템이 관리합니다");
  if (count >= 64) throw invalidInput("발급처는 64개까지 만들 수 있습니다");
}
export function issuerUpdateDecision(
  current: EntityIssuer,
  input: z.infer<typeof issuerUpdate>,
  defaultTypes: IdentityDefaultType[],
) {
  assertVersion(current.version, input.expected_version);
  if (current.system && input.active === false) throw invalidInput("앱 발급처는 중지할 수 없습니다");
  if (input.active === false) assertNoDefaultTypes(defaultTypes);
  return { label: input.label ?? current.label, active: input.active ?? current.active };
}
export function assertRuleCreation(source: EntityIssuer, count: number) {
  if (source.system) throw invalidInput("앱 규칙은 시스템이 관리합니다");
  if (count >= 64) throw invalidInput("발급처별 규칙은 64개까지 만들 수 있습니다");
}
export function identifierRuleUpdateDecision(
  current: IdentifierRule,
  input: z.infer<typeof identifierRuleUpdate>,
  usage: RuleUsage,
) {
  assertVersion(current.version, input.expected_version);
  if (current.source === "app" && (input.meaning !== undefined || input.active === false)) {
    throw invalidInput("앱 발급 규칙은 변경할 수 없습니다");
  }
  if (input.meaning !== undefined && input.meaning !== current.meaning && usage.referenced) {
    throw invalidInput("참조된 규칙의 번호 의미는 변경할 수 없습니다");
  }
  if (input.active === false) assertNoDefaultTypes(usage.defaultTypes);
  return {
    label: input.label ?? current.label,
    meaning: input.meaning ?? current.meaning,
    active: input.active ?? current.active,
  };
}
export function assertTypeIdentityUpdate(
  current: EntityTypeIdentity,
  input: z.infer<typeof typeIdentityUpdate>,
  available: IdentitySourceAvailability[],
) {
  assertVersion(current.version, input.expected_version);
  for (const source of current.sources) {
    const next = input.sources.find((s) => s.code === source.code);
    if (source.referenced && (!next || next.rule_id.toLowerCase() !== source.rule_id.toLowerCase())) {
      throw invalidInput("참조된 발급처 규칙은 제거하거나 교체할 수 없습니다");
    }
  }
  for (const source of input.sources) {
    const facts = available.find((s) =>
      s.code === source.code && s.rule_id.toLowerCase() === source.rule_id.toLowerCase()
    );
    if (!facts) throw new AppError("invalid_reference", "발급처와 규칙을 확인하세요");
    if (source.active && (!facts.issuer_active || !facts.rule_active)) {
      throw invalidInput("중지된 발급처·규칙을 활성 연결할 수 없습니다");
    }
  }
}

export function assertNoDefaultTypes(types: IdentityDefaultType[]) {
  if (types.length) {
    throw invalidInput(
      "기본 발급처를 먼저 변경하세요",
      types.map((t) => ({
        path: `${identityDefaultTypeField}${t.type_id}`,
        message: t.label,
      })),
    );
  }
}
export function assertRegistryDeletion(
  current: { version: number },
  expected: number,
  protectedDefinition: boolean,
  used: boolean,
) {
  assertVersion(current.version, expected);
  if (protectedDefinition) throw invalidInput("앱 발급처·번호 종류는 삭제할 수 없습니다");
  if (used) throw invalidInput("연결되거나 사용된 발급처·번호 종류는 삭제할 수 없습니다. 사용을 중지하세요");
}
