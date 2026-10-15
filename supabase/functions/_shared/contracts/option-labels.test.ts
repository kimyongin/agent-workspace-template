import { assertEquals } from "@std/assert";
import { z } from "zod";
import { entitySchemaEdit } from "./entity-schema-change.ts";
Deno.test("choice contract preserves prototype-like string codes in const/title branches", () => {
  const edit = entitySchemaEdit.parse({
    op: "add_property",
    client_ref: "choice",
    field: {
      type: "string",
      "x-order": 20,
      oneOf: [{ const: "__proto__", title: "특수 코드" }, { const: "constructor", title: "생성 코드" }, {
        const: "toString",
        title: "문자 코드",
      }],
    },
  });
  if (edit.op !== "add_property") throw new Error("wrong operation");
  assertEquals(edit.field.oneOf?.map((o) => o.const), ["__proto__", "constructor", "toString"]);
  assertEquals(edit.field.oneOf?.[0].title, "특수 코드");
  const json = z.toJSONSchema(entitySchemaEdit, { target: "draft-2020-12", io: "input" });
  assertEquals(Array.isArray(json.oneOf), true);
});
