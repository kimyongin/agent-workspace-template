import { assertEquals } from "@std/assert";
import { recoverEntityProperties } from "./recovery.ts";
Deno.test("recovery preserves original omission and literal values while retaining later fields", () => {
  assertEquals(
    recoverEntityProperties(["prop_1", "prop_2", "prop_3", "prop_4", "prop_5", "prop_6"], {
      prop_1: "a",
      prop_2: null,
      prop_3: 0,
      prop_4: false,
      prop_5: "",
    }, { prop_1: "b", prop_6: "filled", prop_7: "later" }),
    { prop_1: "a", prop_2: null, prop_3: 0, prop_4: false, prop_5: "", prop_7: "later" },
  );
});
