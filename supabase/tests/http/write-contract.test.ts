import { assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "./_client.ts";

httpTest("writes require object UUIDs and reject retired request metadata/current upsert", async () => {
  const token = await signIn("A");
  for (
    const [path, content] of [
      ["/entities", { prop1: "입력 거부" }],
      ["/tasks", { kind: "once", title: "입력 거부", summary: "검증" }],
      ["/records", { title: "입력 거부", summary: "검증" }],
      ["/principles", { title: "입력 거부", summary: "검증" }],
      ["/tags", { name: "입력 거부" }],
    ] as const
  ) {
    // An explicit undefined id bypasses the fixture helper's convenience UUID.
    assertEquals((await call(token, "POST", path, { id: undefined, ...content })).status, 400);
    assertEquals(
      (await call(token, "POST", path, {
        id: crypto.randomUUID(),
        ...content,
        request_id: crypto.randomUUID(),
      })).status,
      400,
    );
  }
  assertEquals((await call(token, "POST", "/principles/current", { title: "과거 경로", summary: "거부" })).status, 404);
});
