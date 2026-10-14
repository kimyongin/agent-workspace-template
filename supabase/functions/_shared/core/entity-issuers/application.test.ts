import { assertEquals, assertRejects } from "@std/assert";
import { updateEntityTypeIdentity } from "./application.ts";
Deno.test("type identity rejects an empty active source list before storage", async () => {
  const e = await assertRejects(async () =>
    await updateEntityTypeIdentity(
      {
        uow: {
          run: () => {
            throw new Error("must not reach storage");
          },
        },
      },
      { userId: "owner", request: { key: crypto.randomUUID() } },
      "11111111-1111-4111-8111-111111111111",
      { label: "상품 번호", default_source: "app", sources: [], expected_version: 1 },
    )
  );
  assertEquals((e as { code: string }).code, "invalid_input");
});

Deno.test("type identity rejects a default source missing from active sources", async () => {
  const e = await assertRejects(async () =>
    await updateEntityTypeIdentity(
      {
        uow: {
          run: () => {
            throw new Error("must not reach storage");
          },
        },
      },
      { userId: "owner", request: { key: crypto.randomUUID() } },
      "11111111-1111-4111-8111-111111111111",
      {
        label: "상품 번호",
        default_source: "naver",
        expected_version: 1,
        sources: [{ code: "app", rule_id: "00000000-0000-4000-8000-000000000001", active: true }],
      },
    )
  );
  assertEquals((e as { code: string }).code, "invalid_input");
});
