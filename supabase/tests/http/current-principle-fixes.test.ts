import { assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "./_client.ts";
import { currentPrincipleFixes } from "./_current-principle-fixes.ts";

httpTest(
  "HTTP review fixes: memo-only/no-op, explicit snapshot clear, all view/status coverage-anchor-cursor combinations",
  async () => {
    const token = await signIn("A");
    await currentPrincipleFixes(async (operation, input) => {
      const { id, ...body } = input;
      const paths: Record<string, [string, string]> = {
        current: ["GET", "/principles/current"],
        save: ["POST", "/principles/current"],
        get: ["GET", `/principles/${id}`],
        correct: ["PATCH", `/principles/${id}/correct`],
        delete: ["DELETE", `/principles/${id}?expected_version=${input.expected_version}`],
        search: ["POST", "/search"],
        create_record: ["POST", "/records"],
        update_record: ["PATCH", `/records/${id}`],
        get_record: ["GET", `/records/${id}`],
        delete_record: ["DELETE", `/records/${id}?expected_version=${input.expected_version}`],
      };
      const [method, path] = paths[operation];
      const res = await call(token, method, path, ["GET", "DELETE"].includes(method) ? undefined : body);
      assertEquals(
        res.status,
        method === "DELETE" ? 204 : operation === "save" || operation === "create_record" ? 201 : 200,
      );
      return res.body;
    });
  },
);
