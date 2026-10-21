import type { EntityField, EntitySchema } from "./entity-type.ts";

/** Reuse the scalar text budget for a composed identity, counted as Unicode code points. */
export const ENTITY_TITLE_LENGTH = 4096;
export type EntityTitleTemplateIssue = { position: number; reason: string };

type Part = { literal: string } | { property: string };
function parse(template: string) {
  const parts: Part[] = [], issues: EntityTitleTemplateIssue[] = [];
  let position = 0;
  while (position < template.length) {
    const open = template.indexOf("$", position);
    if (open < 0) {
      parts.push({ literal: template.slice(position) });
      break;
    }
    if (open > position) parts.push({ literal: template.slice(position, open) });
    if (template.startsWith("$$", open)) {
      parts.push({ literal: "$" });
      position = open + 2;
      continue;
    }
    const legacy = template.startsWith("${", open), start = open + (legacy ? 2 : 1);
    const end = template.indexOf(legacy ? "$}" : "$", start);
    if (end < 0) {
      issues.push({ position: open + 1, reason: "닫는 구분자 $가 없습니다" });
      break;
    }
    parts.push({ property: template.slice(start, end) });
    position = end + (legacy ? 2 : 1);
  }
  return { parts, issues };
}

/** Only a decoding fallback during the representative-contract transition. */
export function effectiveEntityTitleTemplate(schema: EntitySchema): string {
  if (schema["x-title-template"] !== undefined) return schema["x-title-template"];
  const key = Object.keys(schema.properties).find((key) => schema.properties[key]["x-representative"]);
  return key ? `$${key}$` : "";
}

export function entityTitleTemplateIssues(template: string, schema: Pick<EntitySchema, "properties">) {
  const { parts, issues } = parse(template);
  if (Array.from(template).length > ENTITY_TITLE_LENGTH) {
    issues.push({ position: 1, reason: `제목 템플릿은 ${ENTITY_TITLE_LENGTH}자 이하입니다` });
  }
  if (!template.trim()) issues.push({ position: 1, reason: "제목 템플릿을 입력하세요" });
  if (
    template.includes("\u0000") ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(template)
  ) {
    issues.push({ position: 1, reason: "텍스트에 저장할 수 없는 문자가 있습니다" });
  }
  for (const part of parts) {
    if (!("property" in part)) continue;
    const field = Object.hasOwn(schema.properties, part.property) ? schema.properties[part.property] : undefined;
    if (!field || field.deprecated) {
      issues.push({ position: 1, reason: `사용 중인 속성을 선택하세요: ${part.property || "(빈 변수)"}` });
    }
  }
  return issues;
}

/** Resolve same-change reservations without interpreting labels or ordinary text. */
export function remapEntityTitleTemplate(template: string, resolve: (key: string) => string): string {
  return template.replace(
    /\$\{([^$]*?)\$\}|\$\$|\$([^$]*?)\$/g,
    (match, legacy, key) => match === "$$" ? match : `$${resolve(legacy ?? key)}$`,
  );
}

function scalarTitle(field: EntityField | undefined, value: unknown): string {
  const choice = field?.oneOf?.find((option) => option.const === value);
  if (choice?.title !== undefined) return choice.title;
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** Plain-text title shared by public reads and previews; never executable interpolation. */
export function renderEntityTitle(schema: EntitySchema, properties: Record<string, unknown>, fallback: string): string {
  const { parts } = parse(effectiveEntityTitleTemplate(schema));
  let result = "", hasContent = false;
  for (const part of parts) {
    const value = "literal" in part
      ? part.literal
      : scalarTitle(schema.properties[part.property], properties[part.property]);
    hasContent ||= !!value.trim();
    // Continue inspecting content for the fallback without growing the retained prefix.
    if (Array.from(result).length <= ENTITY_TITLE_LENGTH) result += value;
  }
  if (!hasContent) result = fallback;
  const points = Array.from(result);
  return points.length > ENTITY_TITLE_LENGTH ? points.slice(0, ENTITY_TITLE_LENGTH - 1).join("") + "…" : result;
}
