import { entitySchemaLimits } from "./entity-type.ts";
/** Decode a UI draft only after checking its full decimal representation. */
export function entityNumberDraft(raw: string, kind: "integer" | "number"): number {
  const pattern = kind === "integer" ? /^-?(0|[1-9][0-9]*)$/ : /^-?(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/;
  if (!pattern.test(raw)) throw new Error("숫자는 전체 십진수로 입력하세요. 정밀도를 넘는 값은 반올림하지 않습니다.");
  const value = Number(raw);
  const normalized = raw.replace(/(\.[0-9]*?)0+$/, "$1").replace(/\.$/, "").replace(/^-0$/, "0");
  if (
    !Number.isFinite(value) ||
    (kind === "integer" ? !Number.isSafeInteger(value) : Math.abs(value) > entitySchemaLimits.number_abs) ||
    String(value) !== normalized
  ) {
    throw new Error("숫자 범위 또는 손실 없이 표현할 수 있는 정밀도를 초과했습니다.");
  }
  return value;
}
