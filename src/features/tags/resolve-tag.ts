import type { TagResult } from "@contracts/tag.ts";

/** 이름 대신 ID로 찾으며 불확정 변경 뒤 목록의 모든 페이지를 확인한다. */
export async function findTag(id: string, load: (cursor: string | null) => Promise<{ items: TagResult[]; next_cursor: string | null }>): Promise<TagResult | null> {
  let cursor: string | null = null;
  do {
    const page = await load(cursor);
    const found = page.items.find(tag => tag.id === id);
    if (found) return found;
    cursor = page.next_cursor;
  } while (cursor);
  return null;
}
