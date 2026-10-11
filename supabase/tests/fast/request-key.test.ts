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

import { createRecord } from "../../functions/_shared/core/activity/application.ts";
Deno.test("record write without request key never starts a transaction", async () => {
  const deps = {
    clock: { now: () => new Date() },
    uow: {
      run: () => {
        throw new Error("transaction started");
      },
    },
  };
  const error = await assertRejects(
    () => createRecord(deps, { userId: crypto.randomUUID() }, { body: "memo" } as never),
    AppError,
  );
  assertEquals(error.code, "invalid_input");
});

import { z } from "zod";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";
import { entityTools } from "../../functions/_shared/adapters/mcp/entity-tools.ts";
import { principleTools } from "../../functions/_shared/adapters/mcp/principle-tools.ts";
import { tagTools } from "../../functions/_shared/adapters/mcp/tag-tools.ts";
import { settingsTools } from "../../functions/_shared/adapters/mcp/settings-tools.ts";
Deno.test("every public MCP business write requires UUID request_key before execution, preparation stays read-only", async () => {
  const deps = {
    uow: {
      run: () => {
        throw new Error("transaction started");
      },
    },
    clock: { now: () => new Date() },
  };
  const tools = [
    ...activityTools(deps),
    ...entityTools(deps),
    ...principleTools(deps),
    ...tagTools(deps),
    ...settingsTools(deps),
  ];
  const writes = tools.filter((tool) => !tool.readOnly);
  assertEquals(writes.length, 20);
  for (const tool of writes) {
    const schema = z.toJSONSchema(tool.input, { io: "input" });
    assertEquals(schema.required?.includes("request_key"), true, tool.name);
    const error = await assertRejects(async () => await tool.handler({}, { userId: crypto.randomUUID() }), AppError);
    assertEquals(error.code, "invalid_input", tool.name);
  }
  const settingsWrite = tools.find((tool) => tool.name === "update_business_settings")!;
  assertEquals(z.toJSONSchema(settingsWrite.input, { io: "input" }).required?.sort(), [
    "expected_version",
    "id",
    "request_key",
    "value",
  ]);
  for (const name of ["prepare_record_memo"]) {
    const tool = tools.find((tool) => tool.name === name)!;
    assertEquals(tool.readOnly, true);
    assertEquals(z.toJSONSchema(tool.input, { io: "input" }).required?.includes("request_key") ?? false, false);
  }
  assertEquals(tools.some((tool) => tool.name === "prepare_entity_registration"), false);
  assertEquals(tools.some((tool) => tool.name === "allocate_data_id"), false);
});
