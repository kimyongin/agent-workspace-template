import { assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "./_client.ts";

httpTest("현재 원칙 HTTP: 같은 문서 갱신·선택 메모·미리보기·경합·삭제 후 없음·격리", async () => {
  const a = await signIn("A"), b = await signIn("B");
  const baseline = (await call(a, "GET", "/principles/current")).body.current;
  let current;
  try {
    const first = await call(a, baseline ? "PATCH" : "POST", baseline ? `/principles/${baseline.id}` : "/principles", {
      title: "현재 기준",
      body: "첫 원문",
      ...(baseline ? { expected_version: baseline.version } : {}),
    });
    assertEquals(first.status, baseline ? 200 : 201);
    current = first.body;
    const preview = await call(a, "POST", "/principles/preview", {
      action: "update",
      id: current.id,
      input: { title: "변경 기준", body: "두 번째 원문", expected_version: current.version },
    });
    assertEquals(preview.status, 404);
    assertEquals((await call(a, "GET", "/principles/current")).body.current, current);
    const unchanged = await call(a, "PATCH", `/principles/${current.id}`, {
      title: current.title,
      body: current.body,
      expected_version: current.version,
      change_note: "기록하지 않음",
    });
    assertEquals(unchanged.body, current);
    const input = {
      title: "변경 기준",
      body: "두 번째 원문",
      expected_version: current.version,
      change_note: "추가 판단 근거",
    };
    const raced = await Promise.all([
      call(a, "PATCH", `/principles/${current.id}`, input),
      call(a, "PATCH", `/principles/${current.id}`, input),
    ]);
    assertEquals(raced.map((r) => r.status).sort(), [200, 409]);
    const next = raced.find((r) => r.status === 200)!.body;
    assertEquals(next.id, current.id);
    assertEquals(next.version, current.version + 1);
    current = next;
    assertEquals((await call(b, "GET", `/principles/${current.id}`)).status, 404);
    assertEquals(
      (await call(a, "POST", `/principles/${current.id}/activate`, { expected_version: current.version })).status,
      404,
    );
    assertEquals(
      (await call(a, "PATCH", `/principles/${current.id}/correct`, {
        expected_version: current.version,
        title: "거부",
        change_note: "현재 문서",
      })).status,
      404,
    );
    assertEquals(
      (await call(a, "POST", "/principles/preview", {
        action: "delete",
        id: current.id,
        input: { expected_version: current.version },
      })).status,
      404,
    );
    assertEquals(
      (await call(a, "POST", `/principles/${current.id}/delete`, {
        expected_version: current.version,
        change_note: "이유",
      })).status,
      204,
    );
    const previous = current;
    current = null;
    assertEquals((await call(a, "GET", "/principles/current")).body.current, null);
    assertEquals(
      (await call(a, "PATCH", `/principles/${previous.id}`, {
        title: "오래된 변경",
        expected_version: previous.version,
      })).status,
      404,
    );
  } finally {
    if (baseline) {
      const actual = (await call(a, "GET", "/principles/current")).body.current;
      const restored = await call(a, actual ? "PATCH" : "POST", actual ? `/principles/${actual.id}` : "/principles", {
        title: baseline.title,
        body: baseline.body,
        ...(actual ? { expected_version: actual.version } : {}),
        change_note: "테스트 문서 복원",
      });
      assertEquals(restored.status, actual ? 200 : 201);
    } else if (current) {
      assertEquals(
        (await call(a, "DELETE", `/principles/${current.id}?expected_version=${current.version}`)).status,
        204,
      );
    }
  }
});
