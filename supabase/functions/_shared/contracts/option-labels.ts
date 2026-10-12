import { z } from "zod";

/** Zod records omit __proto__. Validate the raw own entries and copy them safely instead. */
export function ownStringDictionary(label: z.ZodType<string>) {
  const dictionary = z.unknown().superRefine((value, ctx) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      ctx.addIssue({ code: "custom", message: "선택 표시 이름은 코드별 객체입니다" });
      return;
    }
    for (const [key, v] of Object.entries(value)) {
      const result = label.safeParse(v);
      if (!result.success) {
        for (const issue of result.error.issues) ctx.addIssue({ code: "custom", path: [key], message: issue.message });
      }
    }
  }).transform((value) => Object.fromEntries(Object.entries(value as Record<string, string>)));
  // Public metadata supplies the exact input contract for tools/list and nested schemas.
  const { $schema: _dialect, ...inputSchema } = z.toJSONSchema(z.record(z.string(), label), {
    target: "draft-2020-12",
    io: "input",
  });
  return dictionary.meta(inputSchema);
}
export const optionLabelDictionary = ownStringDictionary(z.string().min(1).max(80));
