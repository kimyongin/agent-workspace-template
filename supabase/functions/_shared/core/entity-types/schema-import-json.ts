import { entitySchemaImportLimits } from "../../contracts/entity-schema-import.ts";
import { invalidInput } from "../shared/errors.ts";
/** Parse the original JSON text, retaining duplicate-key evidence before object construction. */
export function parseSchemaDocument(
  document: string,
  limits: { raw_bytes: number; depth: number } = entitySchemaImportLimits,
): Record<string, unknown> {
  if (new TextEncoder().encode(document).length > limits.raw_bytes) {
    throw invalidInput("정의 원문은 2 MiB 이하입니다", [{ path: "document", message: "원문 크기 한도를 넘었습니다" }]);
  }
  let offset = 0;
  const fail = (path: string, message: string): never => {
    const lines = document.slice(0, offset).split("\n");
    throw invalidInput("JSON 정의를 확인하세요", [{
      path,
      message: `${message} (${lines.length}행 ${lines.at(-1)!.length + 1}열)`,
    }]);
  };
  const whitespace = () => {
    while (/[\t\n\r ]/.test(document[offset] ?? "\u0000")) offset++;
  };
  const string = (path: string): string => {
    const start = offset++;
    while (offset < document.length) {
      if (document[offset] === '"') {
        offset++;
        try {
          return JSON.parse(document.slice(start, offset));
        } catch {
          return fail(path, "잘못된 JSON 문자열입니다");
        }
      }
      if (document[offset] === "\\") offset++;
      offset++;
    }
    return fail(path, "닫히지 않은 JSON 문자열입니다");
  };
  const value = (path: string, depth: number): unknown => {
    whitespace();
    if (depth > limits.depth) fail(path, "JSON 중첩 깊이 한도를 넘었습니다");
    const token = document[offset];
    if (token === '"') return string(path);
    if (token === "{") {
      offset++;
      whitespace();
      const result: Record<string, unknown> = {}, keys = new Set<string>();
      if (document[offset] === "}") {
        offset++;
        return result;
      }
      while (offset < document.length) {
        whitespace();
        if (document[offset] !== '"') fail(path, "객체 속성 이름이 필요합니다");
        const key = string(path), next = path + "." + key;
        if (keys.has(key)) fail(next, "중복 JSON 객체 키입니다");
        keys.add(key);
        whitespace();
        if (document[offset++] !== ":") fail(next, "속성 이름 뒤에 콜론이 필요합니다");
        Object.defineProperty(result, key, {
          value: value(next, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
        whitespace();
        const delimiter = document[offset++];
        if (delimiter === "}") return result;
        if (delimiter !== ",") fail(path, "객체 구분자나 닫는 괄호가 필요합니다");
      }
      return fail(path, "닫히지 않은 JSON 객체입니다");
    }
    if (token === "[") {
      offset++;
      whitespace();
      const result: unknown[] = [];
      if (document[offset] === "]") {
        offset++;
        return result;
      }
      while (offset < document.length) {
        result.push(value(`${path}.${result.length}`, depth + 1));
        whitespace();
        const delimiter = document[offset++];
        if (delimiter === "]") return result;
        if (delimiter !== ",") fail(path, "배열 구분자나 닫는 괄호가 필요합니다");
      }
      return fail(path, "닫히지 않은 JSON 배열입니다");
    }
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]] as const) {
      if (document.startsWith(literal, offset)) {
        offset += literal.length;
        return result;
      }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(document.slice(offset));
    if (number) {
      offset += number[0].length;
      return Number(number[0]);
    }
    return fail(path, "유효한 JSON 값이 필요합니다");
  };
  const parsed = value("document", 0);
  whitespace();
  if (offset !== document.length) fail("document", "JSON 뒤에 추가 내용이 있습니다");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("document", "정의는 JSON 객체여야 합니다");
  return parsed as Record<string, unknown>;
}
