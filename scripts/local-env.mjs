// 준비 스크립트가 소유한 값만 갱신한다. 공급자 키 등 사용자가 추가한 값은 보존한다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

export function readEnv(file) {
  return existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
}

function encode(value) {
  const text = String(value);
  // 생성 대상은 URL·키·비밀번호다. CLI가 escape로 해석하는 값은 조용히 바꾸지 않는다.
  if (/[\\\r\n\0]/.test(text)) throw new Error("생성 설정에 백슬래시·줄바꿈·NUL을 사용할 수 없습니다. 원본 파일을 유지합니다.");
  if (!/[\s#'"`$\\]/.test(text)) return text;
  // Node와 CLI가 같은 의미로 읽는 범위만 생성한다. $ 확장은 작은따옴표로 막는다.
  const quote = !text.includes("'") ? "'" : !/["$\\]/.test(text) ? '"' : null;
  if (!quote) throw new Error("로컬 설정 값을 손실 없이 저장할 수 없습니다. 원본 파일을 유지합니다.");
  return `${quote}${text}${quote}`;
}

export function writeEnv(file, header, managed, retired = []) {
  // 사용자 선언·주석은 재직렬화하지 않는다. CLI의 변수 확장·escape 의미까지 보존해야 한다.
  const encoded = Object.fromEntries(Object.entries(managed).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error("잘못된 설정 키입니다");
    return [key, `${key}=${encode(value)}`];
  }));
  const seen = new Set();
  const rawOriginal = existsSync(file) ? readFileSync(file, "utf8") : null;
  const original = rawOriginal?.replace(/\r\n/g, "\n") ?? `# ${header}\n`;
  // 여러 줄의 quoted 값을 하나의 선언으로 소비하므로 그 안의 KEY= 문장을 바꾸지 않는다.
  const declaration = /(^|\n)[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(?:'(?:\\'|[^'])*'|"(?:\\"|[^"])*"|`(?:\\`|[^`])*`|[^\n]*)(?:[ \t]*#[^\n]*)?/g;
  let content = original.replace(declaration, (raw, prefix, key) => {
    if (retired.includes(key)) return prefix;
    if (!Object.hasOwn(encoded, key)) return raw;
    if (seen.has(key)) return prefix;
    seen.add(key);
    return prefix + encoded[key];
  });
  content = content.replace(/\n?$/, "\n");
  for (const [key, line] of Object.entries(encoded)) {
    if (!seen.has(key)) content += `${line}\n`;
  }
  // 생성 값은 저장 전에 왕복 검증한다. 실패하면 기존 파일을 건드리지 않는다.
  const decoded = parseEnv(content);
  if (Object.entries(managed).some(([key, value]) => decoded[key] !== String(value))) {
    throw new Error("로컬 설정 직렬화에 실패했습니다. 원본 파일을 유지합니다.");
  }
  // 같은 내용을 다시 저장하면 Edge Runtime의 파일 감시가 worker를 재시작한다.
  if (content !== rawOriginal) writeFileSync(file, content, { mode: 0o600 });
}
