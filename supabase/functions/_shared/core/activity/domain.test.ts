import { assertEquals } from "@std/assert";
import { AppError } from "../shared/errors.ts";
import {
  assertRecordableOccurrence,
  completeTask,
  newTask,
  resumeTask,
  stopTask,
  type Task,
  updateTask,
} from "./domain.ts";

const meta = {
  id: "00000000-0000-4000-8000-000000000001",
  completed_at: null,
  result_record_id: null,
  version: 1,
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
};
const once = (over: Partial<Task> = {}): Task => ({
  ...newTask({ id: "t", kind: "once", title: "t", summary: "s", body: "" }),
  ...meta,
  ...over,
});
const recurring = (over: Partial<Task> = {}): Task => ({
  ...newTask({
    id: "t",
    kind: "recurring",
    title: "t",
    summary: "s",
    body: "",
    recurrence: { freq: "daily", starts_on: "2026-10-01" },
    timezone: "Asia/Seoul",
  }),
  ...meta,
  ...over,
});

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return "ok";
}

// 2026-10-03T15:30Z = 서울 2026-10-04 00:30
const now = new Date("2026-10-03T15:30:00Z");

Deno.test("일회성 완료: open이고 버전이 맞을 때만", () => {
  assertEquals(completeTask(once(), 1, now), { status: "done", completed_at: now.toISOString() });
  assertEquals(code(() => completeTask(once({ status: "done" }), 1, now)), "conflict");
  assertEquals(code(() => completeTask(once(), 2, now)), "conflict");
  assertEquals(code(() => completeTask(recurring(), 1, now)), "conflict");
});

Deno.test("수정: 종류에 맞지 않는 필드는 invalid_input, 버전 불일치는 conflict", () => {
  assertEquals(
    updateTask(once({ status: "done" }), { change_note: "테스트 변경 이유", expected_version: 1, title: "새 제목" }),
    { title: "새 제목" },
  );
  assertEquals(
    code(() => updateTask(once(), { change_note: "테스트 변경 이유", expected_version: 1, timezone: "UTC" })),
    "invalid_input",
  );
  assertEquals(
    code(() => updateTask(recurring(), { change_note: "테스트 변경 이유", expected_version: 1, due_on: "2026-10-10" })),
    "invalid_input",
  );
  assertEquals(
    code(() => updateTask(once(), { change_note: "테스트 변경 이유", expected_version: 3, title: "x" })),
    "conflict",
  );
});

Deno.test("중단·재개: 상태 전환과 할 일 시간대 기준 날짜", () => {
  const stopped = { ...recurring(), ...stopTask(recurring(), 1, now) };
  assertEquals(stopped.pauses, [{ stopped_on: "2026-10-04", resumed_on: null }]);
  assertEquals(code(() => stopTask(stopped, 1, now)), "conflict");
  assertEquals(code(() => resumeTask(recurring(), 1, now)), "conflict");
  assertEquals(code(() => stopTask(once(), 1, now)), "conflict");

  const later = new Date("2026-10-07T01:00:00Z");
  assertEquals(resumeTask(stopped, 1, later), {
    status: "active",
    pauses: [{ stopped_on: "2026-10-04", resumed_on: "2026-10-07" }],
  });
});

Deno.test("같은 날 중단·재개는 빈 중단을 남기지 않고, 다시 중단하면 이어 간다", () => {
  const stopped = { ...recurring(), ...stopTask(recurring(), 1, now) };
  assertEquals(resumeTask(stopped, 1, now).pauses, []);
  const prior = recurring({ pauses: [{ stopped_on: "2026-10-02", resumed_on: "2026-10-04" }] });
  assertEquals(stopTask(prior, 1, now).pauses, [{ stopped_on: "2026-10-02", resumed_on: null }]);
});

Deno.test("회차 기록: 회차·시작일 이후·중단 밖·오늘 이전만", () => {
  const t = recurring({ pauses: [{ stopped_on: "2026-10-02", resumed_on: "2026-10-03" }] });
  assertEquals(code(() => assertRecordableOccurrence(t, "2026-10-04", now)), "ok"); // 서울의 오늘
  assertEquals(code(() => assertRecordableOccurrence(t, "2026-10-01", now)), "ok");
  assertEquals(code(() => assertRecordableOccurrence(t, "2026-10-05", now)), "invalid_input"); // 미래
  assertEquals(code(() => assertRecordableOccurrence(t, "2026-10-02", now)), "invalid_input"); // 중단 기간
  assertEquals(code(() => assertRecordableOccurrence(t, "2026-09-30", now)), "invalid_input"); // 시작 전
  const weekly = recurring({ recurrence: { freq: "weekly", weekdays: [1], starts_on: "2026-09-01" } });
  assertEquals(code(() => assertRecordableOccurrence(weekly, "2026-09-29", now)), "invalid_input"); // 화요일
  assertEquals(code(() => assertRecordableOccurrence(weekly, "2026-09-28", now)), "ok"); // 월요일
  assertEquals(code(() => assertRecordableOccurrence(once(), "2026-10-01", now)), "conflict");
});
