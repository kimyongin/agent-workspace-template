import { assertEquals } from "@std/assert";
import { z } from "zod";
import { entitySchemaEdit } from "./entity-schema-change.ts";
import { optionLabelDictionary } from "./option-labels.ts";
Deno.test("display contract preserves own prototype-like option labels with an exact public JSON Schema", () => {
  const labels = JSON.parse('{"__proto__":"특수 코드","constructor":"생성 코드","toString":"문자 코드"}');
  const edit = entitySchemaEdit.parse({
    op: "set_display",
    display: {
      representative: "prop_1",
      order: ["prop_1", "prop_2"],
      list_columns: ["prop_1"],
      archived: [],
      option_labels: { prop_2: labels },
    },
  });
  if (edit.op !== "set_display") throw new Error("wrong operation");
  assertEquals(Object.keys(edit.display.option_labels.prop_2), ["__proto__", "constructor", "toString"]);
  assertEquals(edit.display.option_labels.prop_2["__proto__"], "특수 코드");
  assertEquals(optionLabelDictionary.safeParse(JSON.parse('{"__proto__":7}')).success, false);
  const json = z.toJSONSchema(optionLabelDictionary, { target: "draft-2020-12", io: "input" });
  assertEquals(json.type, "object");
  assertEquals(json.additionalProperties, { type: "string", minLength: 1, maxLength: 80 });
});
