import { describe, expect, it, vi } from "vitest";
import { createDetailResource } from "./detail-resource.ts";
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
type Row = { id: string; version: number };
const row = (version: number): Row => ({ id: "one", version });

describe("detail read lifecycle", () => {
  it("aborts old reads and accepts only the latest result", async () => {
    const late = deferred<Row>(), signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => { signals.push(signal); return signals.length === 1 ? late.promise : Promise.resolve(row(2)); });
    const detail = createDetailResource({ load, isConflict: () => false });
    const first = detail.reload(); await detail.reload(); late.resolve(row(1)); await first;
    expect(signals[0].aborted).toBe(true); expect(detail.snapshot().value).toEqual(row(2));
  });
  it("keeps a confirmed write despite an older GET and a failed follow-up GET", async () => {
    const late = deferred<Row>();
    const load = vi.fn().mockResolvedValueOnce(row(1)).mockReturnValueOnce(late.promise).mockRejectedValueOnce(Error("offline"));
    const detail = createDetailResource<Row>({ load, isConflict: () => false });
    await detail.reload(); const old = detail.reload(); await detail.save(async () => row(2));
    late.resolve(row(1)); await old; await detail.reload();
    expect(detail.snapshot()).toMatchObject({ value: row(2), confirmed: true, loading: false });
    expect(detail.snapshot().error).toBeInstanceOf(Error);
  });
  it("blocks failed edit preparation while retaining the read value, except the explicit entity policy", async () => {
    for (const readyAfterFailedRefresh of [false, true]) {
      const load = vi.fn().mockResolvedValueOnce(row(1)).mockRejectedValueOnce(Error("offline"));
      const detail = createDetailResource<Row>({ load, isConflict: () => false, readyAfterFailedRefresh });
      await detail.reload(); await detail.reload(true);
      expect(detail.snapshot().value).toEqual(row(1)); expect(detail.snapshot().editReady).toBe(readyAfterFailedRefresh);
    }
  });
  it("keeps the draft's version after conflict and refreshes only when its editor closes", async () => {
    const conflict = Error("conflict");
    const load = vi.fn().mockResolvedValueOnce(row(1)).mockResolvedValueOnce(row(3));
    const detail = createDetailResource<Row>({ load, isConflict: error => error === conflict });
    await detail.reload(); await expect(detail.save(async () => { throw conflict; })).rejects.toBe(conflict);
    expect(load).toHaveBeenCalledTimes(1); expect(detail.snapshot().value).toEqual(row(1));
    detail.editClosed(); await vi.waitFor(() => expect(detail.snapshot().value).toEqual(row(3)));
    detail.editClosed(); expect(load).toHaveBeenCalledTimes(2);
  });
  it("discards a cancelled identity's late response without touching the next identity", async () => {
    const late = deferred<Row>();
    const old = createDetailResource({ load: () => late.promise, isConflict: () => false });
    const next = createDetailResource({ load: async () => ({ id: "two", version: 1 }), isConflict: () => false });
    const read = old.reload(); old.cancel(); await next.reload(); late.resolve(row(1)); await read;
    expect(old.snapshot().value).toBeNull(); expect(next.snapshot().value?.id).toBe("two");
  });
});
