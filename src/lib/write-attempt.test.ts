import { expect, it } from "vitest";
import { WriteAttempt } from "./write-attempt.ts";
import { ApiError } from "./api-error.ts";

it("retries the original creation input and UUID after an uncertain response", async () => {
  const attempt = new WriteAttempt();
  const writes: { id: string; title: string }[] = [];
  let lost = true;
  const original = { id: attempt.creationId(), title: "상담" };
  const save = async () => {
    writes.push(original);
    if (lost) { lost = false; throw new ApiError(0, "network", "응답 유실"); }
  };
  await expect(attempt.run(save)).rejects.toThrow("응답 유실");
  expect(attempt.snapshot().uncertain).toBe(true);
  await attempt.run(async () => { writes.push({ id: "다른 ID", title: "다른 내용" }); });
  expect(writes).toEqual([original, original]);
  expect(attempt.snapshot().uncertain).toBe(false);
  expect(attempt.creationId()).not.toBe(original.id);
});

it("keeps the expected version on retry and exposes a conflict without rebasing", async () => {
  const attempt = new WriteAttempt();
  const accepted: number[] = [];
  let version = 4;
  const save = async () => {
    const expected = 4;
    if (expected !== version) throw new ApiError(409, "conflict", "버전 충돌");
    accepted.push(expected);
    version++;
    throw new ApiError(0, "network", "응답 유실");
  };
  await expect(attempt.run(save)).rejects.toThrow("응답 유실");
  await expect(attempt.run(async () => { accepted.push(5); })).rejects.toThrow("버전 충돌");
  expect(accepted).toEqual([4]);
  expect(attempt.snapshot()).toEqual({ busy: false, uncertain: false });
});

it("read-only preparation failure allows a fresh preparation instead of retaining a write", async () => {
  const attempt = new WriteAttempt();
  await expect(attempt.run(async () => { throw new ApiError(503, "unavailable", "메모 조회 실패"); }, false)).rejects.toThrow();
  expect(attempt.snapshot().uncertain).toBe(false);
  let ready = false;
  await attempt.run(async () => { ready = true; }, false);
  expect(ready).toBe(true);
});

it("discarding an uncertain creation starts a new UUID and prevents concurrent duplicate writes", async () => {
  const attempt = new WriteAttempt();
  const id = attempt.creationId();
  await expect(attempt.run(async () => { throw new ApiError(0, "network", "응답 유실"); })).rejects.toThrow();
  attempt.reset();
  expect(attempt.creationId()).not.toBe(id);
  let release!: () => void;
  let completed = false;
  const pending = attempt.run(async () => { await new Promise<void>(resolve => { release = resolve; }); completed = true; });
  await attempt.run(async () => { throw Error("중복 저장"); });
  expect(attempt.snapshot().busy).toBe(true);
  release();
  await pending;
  expect(completed).toBe(true);
});
