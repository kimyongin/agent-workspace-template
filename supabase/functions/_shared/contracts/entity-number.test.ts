import { assertEquals, assertThrows } from "@std/assert";
import { entityNumberDraft } from "./entity-number.ts";
Deno.test("numeric drafts reject precision loss before conversion and preserve complete input", () => {
  for (const raw of ["1.0000000000000001", "0.0000001", "1000000000.000001", "1e3", " 1", "01"]) {
    assertThrows(() => entityNumberDraft(raw, "number"));
  }
  assertThrows(() => entityNumberDraft("9007199254740992", "integer"));
  assertEquals(entityNumberDraft("9007199254740991", "integer"), 9007199254740991);
  assertEquals(entityNumberDraft("1.230000", "number"), 1.23);
  assertEquals(entityNumberDraft("0.000001", "number"), 0.000001);
  assertEquals(entityNumberDraft("-0.000000", "number"), 0);
});
