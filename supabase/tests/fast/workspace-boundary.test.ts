import { assertEquals, assertRejects } from "@std/assert";
import { z } from "zod";
import { createHttpApp } from "../../functions/_shared/adapters/http/app.ts";
import { workspaceTool } from "../../functions/_shared/adapters/mcp/tools.ts";
import { requestIdentity } from "../../functions/_shared/core/shared/request.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
const userId = "a861fd63-1df6-48c4-af46-2f6b537c8101";
const workspaceId = "ddce23f2-83b0-4346-b98c-e05e552baeee";

Deno.test("business HTTP requires explicit workspace before dispatch while control is account scoped", async () => {
  const app = createHttpApp(
    {} as never,
    {
      basePath: "/api",
      token: { audience: "authenticated", issuer: "https://auth.invalid/auth/v1" },
      allowedOrigins: [],
    },
    {} as never,
    {} as never,
    () => Promise.resolve({ userId }),
  );
  const absent = await app.fetch(new Request("https://app.invalid/api/tasks"));
  assertEquals(absent.status, 400);
  assertEquals((await absent.json()).code, "invalid_input");
  const malformed = await app.fetch(
    new Request("https://app.invalid/api/tasks", { headers: { "X-Workspace-Id": "bad" } }),
  );
  assertEquals(malformed.status, 400);
  const control = await app.fetch(new Request("https://app.invalid/api/workspaces"));
  assertEquals(control.status, 404);
});
Deno.test("MCP scope is required, validated, stripped from payload and captured on actor per call", async () => {
  const tool = workspaceTool({
    name: "probe",
    description: "probe",
    readOnly: true,
    input: z.strictObject({}),
    handler: (input, actor) => Promise.resolve({ input, userId: actor.userId, workspaceId: actor.workspaceId }),
  });
  await assertRejects(async () => await tool.handler({}, { userId }), AppError);
  assertEquals(await tool.handler({ workspace_id: workspaceId }, { userId }), { input: {}, userId, workspaceId });
});
Deno.test("same logical key cannot identify another actor or workspace fingerprint", async () => {
  const actor = { userId, workspaceId, request: { key: crypto.randomUUID() } };
  const first = await requestIdentity(actor, "probe", null, { value: 1 });
  const otherWorkspace = await requestIdentity({ ...actor, workspaceId: crypto.randomUUID() }, "probe", null, {
    value: 1,
  });
  const otherActor = await requestIdentity({ ...actor, userId: crypto.randomUUID() }, "probe", null, { value: 1 });
  assertEquals(first.fingerprint === otherWorkspace.fingerprint, false);
  assertEquals(first.fingerprint === otherActor.fingerprint, false);
});
