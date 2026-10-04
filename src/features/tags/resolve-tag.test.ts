import { describe, expect, it } from "vitest";
import type { TagResult } from "@contracts/tag.ts";
import { findTag } from "./resolve-tag.ts";
const tag = (id: string, name: string): TagResult => ({ id, name, scope:"activity", version: 2, created_at: "2026-10-04T00:00:00Z", updated_at: "2026-10-04T00:00:00Z" });
describe("불확정 태그 이름 변경 확인", () => {
  it("이름이 같은 다른 태그가 있어도 다음 페이지의 ID로 확인한다", async () => {
    const cursors: (string | null)[] = [];
    const result = await findTag("selected", async cursor => { cursors.push(cursor); return cursor ? { items: [tag("selected", "정정")], next_cursor: null } : { items: [tag("other", "정정")], next_cursor: "next" }; });
    expect(result?.id).toBe("selected"); expect(cursors).toEqual([null, "next"]);
  });
  it("삭제된 태그와 조회 오류를 구분한다", async () => {
    expect(await findTag("removed", async () => ({ items: [], next_cursor: null }))).toBeNull();
    await expect(findTag("unknown", async () => { throw new Error("조회 실패"); })).rejects.toThrow("조회 실패");
  });
});
