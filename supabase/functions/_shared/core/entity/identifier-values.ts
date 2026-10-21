import type { EntityDefinition } from "./values.ts";
import { decodeIdentifierValue, encodeIdentifierValue } from "../../contracts/entity-identifiers.ts";
import { invalidInput } from "../shared/errors.ts";
/** Validate identifier assignments and resolve generation with the caller-owned raw-value issuer. */
export async function resolveIdentifierProperties(
  definition: EntityDefinition,
  properties: Record<string, unknown>,
  intents: Record<string, string>,
  creation: boolean,
  previous: Record<string, unknown>,
  issueRaw: () => Promise<string>,
) {
  const selected = definition.schema["x-identity-property"];
  if (!selected) throw invalidInput("자료 식별자 항목이 필요합니다");
  const values = { ...properties }, commands = { ...intents };
  const kinds = definition.identifier_kinds ?? [];
  const settings = definition.schema.properties[selected]?.["x-identifier"];
  if (
    creation && values[selected] === undefined && commands[selected] === undefined && settings &&
    kinds.find((k) => k.id === settings.default_kind_id)?.generation === "automatic"
  ) {
    commands[selected] = settings.default_kind_id;
  }
  for (const [key, kindId] of Object.entries(commands)) {
    const property = definition.schema.properties[key];
    const field = property?.["x-identifier"];
    const kind = kinds.find((k) => k.id === kindId);
    if (
      (!creation && key === selected) || property?.readOnly || property?.deprecated || properties[key] !== undefined ||
      !field?.allowed_kind_ids.includes(kindId) ||
      !kind?.active || kind.generation !== "automatic"
    ) {
      throw invalidInput("자동 발급 요청을 확인하세요", [{
        path: `generate_identifiers.${key}`,
        message: "활성 자동 발급 종류를 선택하고 기존 값은 함께 보내지 마세요",
      }]);
    }
    values[key] = encodeIdentifierValue(kindId, await issueRaw());
  }
  for (const [key, field] of Object.entries(definition.schema.properties)) {
    if (!field["x-identifier"] || values[key] == null) continue;
    if (!creation && key === selected && values[key] !== previous[key]) {
      throw invalidInput("자료 식별자는 변경할 수 없습니다");
    }
    let pair;
    try {
      pair = decodeIdentifierValue(String(values[key]));
    } catch {
      throw invalidInput("식별자 종류와 원본 값을 확인하세요", [{
        path: `properties.${key}`,
        message: "완전한 식별자 값이 필요합니다",
      }]);
    }
    if (
      !field["x-identifier"].allowed_kind_ids.includes(pair.kind_id) ||
      ((creation || previous[key] !== values[key]) && !kinds.find((k) => k.id === pair.kind_id)?.active)
    ) {
      throw invalidInput("현재 허용된 활성 식별자 종류를 선택하세요", [{
        path: `properties.${key}`,
        message: "식별자 종류를 확인하세요",
      }]);
    }
  }
  return { properties: values, generated: commands[selected] !== undefined, generated_keys: Object.keys(commands) };
}
