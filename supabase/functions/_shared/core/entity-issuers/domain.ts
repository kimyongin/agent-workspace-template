import type { z } from "zod";
import type {
  EntityIssuer,
  IdentifierDefaultField,
  IdentifierRule,
  identifierRuleUpdate,
  issuerUpdate,
} from "../../contracts/entity-issuer.ts";
import { identifierDefaultFieldPath } from "../../contracts/entity-issuer.ts";
import { AppError, invalidInput } from "../shared/errors.ts";
export interface RuleUsage {
  referenced: boolean;
  defaultTypes: IdentifierDefaultField[];
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
  defaultTypes: IdentifierDefaultField[],
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
export function assertNoDefaultTypes(types: IdentifierDefaultField[]) {
  if (types.length) {
    throw invalidInput(
      "항목의 기본 식별자 종류를 먼저 변경하세요",
      types.map((t) => ({
        path: `${identifierDefaultFieldPath}${t.type_id}.${t.property}`,
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
