import { assertEquals, assertRejects } from "@std/assert";
import { createTask } from "../../functions/_shared/core/activity/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
Deno.test("task write without logical request key never starts a transaction", async () => {
  const deps = {
    clock: { now: () => new Date() },
    uow: {
      run: () => {
        throw new Error("transaction started");
      },
    },
  };
  const error = await assertRejects(
    () => createTask(deps, { userId: crypto.randomUUID() }, { kind: "once", title: "request", body: "" } as never),
    AppError,
  );
  assertEquals(error.code, "invalid_input");
});
