import { assertEquals, assertRejects } from "@std/assert";
import { createWorkspace, type WorkspaceDeps, workspaceDetails } from "./application.ts";
import { AppError } from "../shared/errors.ts";

Deno.test("workspace creation validates input and requires a request key before storage", async () => {
  let calls = 0;
  const deps = {
    uow: {
      account: () => {
        calls++;
        throw new Error("unexpected");
      },
    },
  } as unknown as WorkspaceDeps;
  await assertRejects(() => createWorkspace(deps, { userId: crypto.randomUUID() }, { name: "새 공간" }), AppError);
  assertEquals(calls, 0);
});
Deno.test("selected workspace is explicit and cannot be inferred from account identity", async () => {
  let calls = 0;
  const deps = {
    uow: {
      workspace: () => {
        calls++;
        throw new Error("unexpected");
      },
    },
  } as unknown as WorkspaceDeps;
  await assertRejects(() => workspaceDetails(deps, { userId: crypto.randomUUID() }, "invalid"), AppError);
  assertEquals(calls, 0);
});
