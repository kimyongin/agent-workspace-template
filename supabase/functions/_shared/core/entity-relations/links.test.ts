import { assertEquals, assertRejects } from "@std/assert";
import { connectEntityRelation } from "./links.ts";
import { AppError } from "../shared/errors.ts";
Deno.test("typed relation rejects own entity without reaching storage", async () => {
  const id = "app:11111111-1111-4111-8111-111111111111:item";
  const error = await assertRejects(() =>
    connectEntityRelation(
      {
        uow: {
          run() {
            throw new Error("storage must not run");
          },
        },
      },
      { userId: crypto.randomUUID() },
      {
        definition_id: crypto.randomUUID(),
        side: 0,
        origin_id: id,
        other_id: id,
        expected_definition_version: 1,
        expected_version: 1,
        expected_other_version: 1,
      },
    ), AppError);
  assertEquals(error.code, "invalid_input");
});
