// 준비 스크립트가 소유한 값만 갱신한다. 공급자 키 등 사용자가 추가한 값은 보존한다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

export function readEnv(file) {
  return existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
}

function encode(value) {
  const text = String(value);
  if (!/[\s#'"`]/.test(text)) return text;
  // dotenv는 escape 문법으로 값을 복원하지 않는다. 값에 없는 구분자를 선택한다.
  const quote = ["'", '"', "`"].find((q) => !text.includes(q));
  if (!quote) throw new Error("로컬 설정 값을 손실 없이 저장할 수 없습니다(모든 따옴표 포함). 원본 파일을 유지합니다.");
  return `${quote}${text}${quote}`;
}

export function writeEnv(file, header, managed) {
  const values = { ...readEnv(file), ...managed };
  const lines = [`# ${header}`, ...Object.entries(values).map(([key, value]) => `${key}=${encode(value)}`), ""];
  // 저장 전에 dotenv로 다시 읽어 값의 손실 여부를 확인한다. 실패하면 기존 파일을 건드리지 않는다.
  const content = lines.join("\n");
  const decoded = parseEnv(content);
  if (Object.entries(values).some(([key, value]) => decoded[key] !== String(value))) {
    throw new Error("로컬 설정 직렬화에 실패했습니다. 원본 파일을 유지합니다.");
  }
  writeFileSync(file, content, { mode: 0o600 });
}
