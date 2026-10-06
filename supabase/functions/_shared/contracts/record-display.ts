/** 표시용 대표 문구. 원문은 수정하거나 별도 속성으로 저장하지 않는다. */
export function recordDisplayText(body: string, limit = 100): string {
  const plain = body
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ").trim();
  const points = Array.from(plain);
  return points.length ? points.slice(0, limit).join("") + (points.length > limit ? "…" : "") : "기록";
}
