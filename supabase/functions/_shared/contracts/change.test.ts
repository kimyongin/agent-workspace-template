import { assertEquals } from "@std/assert";
import { changeMetadata } from "./change.ts";

Deno.test("change metadata retains one typed historical target without adding record parents", () => {
  const snapshot = {
    id: "app:00000000-0000-4000-8000-000000000001:captured",
    title: "게시 당시 이름",
    type: { id: "00000000-0000-4000-8000-000000000001", label: "게시 당시 종류", icon_id: "file", archived: false },
    schema_version: 2,
    captured_at: "2026-10-18T00:00:00.000Z",
    source: "selection",
  } as const;
  const metadata = {
    event_id: "00000000-0000-4000-8000-000000000002", target_kind: "entity", target_id: snapshot.id,
    target_title: snapshot.title, action: "update", source: "http", before: null, after: null, path: null,
  } as const;
  const parsed = changeMetadata.parse({ ...metadata, target_snapshot: snapshot });
  assertEquals((parsed as unknown as { target_snapshot?: unknown }).target_snapshot, snapshot);
  assertEquals(changeMetadata.safeParse({ ...metadata, target_snapshot: [snapshot] }).success, false);
  assertEquals(changeMetadata.parse(metadata), metadata);
});
