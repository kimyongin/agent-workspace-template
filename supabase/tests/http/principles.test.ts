import { assert, assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "./_client.ts";

const A = await signIn("A"), B = await signIn("B");
httpTest("원칙 HTTP: 원문·적용 조건·사용자 격리·잘못된 입력과 ID", async () => {
  const r = await call(A, "POST", "/principles", {
    title: "독서",
    summary: "휴가에 긴 책 읽기",
    body: "# 근거",
    applies_when: "300쪽 초과",
  });
  assertEquals(r.status, 201);
  assertEquals((await call(A, "GET", `/principles/${r.body.id}`)).body.body, "# 근거");
  assertEquals((await call(B, "GET", `/principles/${r.body.id}`)).status, 404);
  assertEquals((await call(null, "GET", "/principles")).status, 401);
  assertEquals((await call(A, "GET", "/principles/not-an-id")).status, 404);
  assertEquals((await call(A, "GET", "/principles?status=unknown")).status, 400);
  assertEquals(
    (await call(A, "POST", "/principles", { title: "독서", summary: "요약", status: "inactive" })).status,
    400,
  );
  assertEquals(
    (await call(A, "POST", "/principles", { title: "독서", summary: "요약", applies_when: "가".repeat(301) })).status,
    400,
  );
  const list = (await call(A, "GET", "/principles?limit=100")).body;
  assert(list.items.some((p: { id: string }) => p.id === r.body.id));
});
