import { assertEquals, assertThrows } from "@std/assert";
import { createAndLinkEntity } from "./create-and-link.ts";
import { AppError } from "../shared/errors.ts";
Deno.test("create-and-link rejects unpaired previous ID/version before storage", () => {
  const error = assertThrows(() =>
    createAndLinkEntity(
      {
        uow: {
          run() {
            throw Error("must not reach storage");
          },
        },
      },
      { userId: crypto.randomUUID() },
      {
        definition_id: crypto.randomUUID(),
        side: 0,
        origin_id: "11111111-1111-4111-8111-111111111111:00000000-0000-4000-8000-000000000001:parent",
        expected_definition_version: 1,
        expected_version: 1,
        previous_other_id: null,
        expected_previous_version: 1,
        entity: {
          action: "create",
          entity_type_id: crypto.randomUUID(),
          schema_version: 1,
          properties: { prop_1: "새 자료" },
        },
      },
    ), AppError);
  assertEquals(error.code, "invalid_input");
});
