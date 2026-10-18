import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { TaskResult } from "@contracts/task.ts";
import { TaskDataFields } from "./TaskDataFields.tsx";

vi.mock("../../lib/api.ts", () => ({ createScopedApi: () => vi.fn(), ApiError: Error }));
const task = { id: "task", title: "공유 할 일", body: "보존할 업무 내용", kind: "once", status: "open", due_on: null, recurrence: null, timezone: null, completed_at: null, result_record_id: null, entity_ids: [], entity_context: [], tag_ids: [], version: 3, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", deleted_at: "2026-10-02T00:00:00Z", created_by: "private-user-id", created_by_name: "작성자" } as TaskResult & { deleted_at: string | null; created_by: string | null; created_by_name: string | null };
it("a deleted task keeps readable content and displays its deletion state and bounded author name", () => {
  const html = renderToStaticMarkup(<TaskDataFields task={task} />);
  expect(html).toContain("공유 할 일");
  expect(html).toContain("보존할 업무 내용");
  expect(html).toContain("삭제됨");
  expect(html).toContain("작성자");
  expect(html).not.toContain("private-user-id");
});
