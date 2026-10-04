import { assert, assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "./_client.ts";

httpTest("현재 원칙 HTTP: 저장·무변경·동시 경합·과거 정정·삭제 승격·메모·격리", async () => {
  const a = await signIn("A"), b = await signIn("B");
  const baseline = (await call(a, "GET", "/principles/current")).body.current;
  const first = await call(a, "POST", "/principles/current", {
    title: "현재 기준",
    summary: "판단",
    body: "첫 원문",
    ...(baseline ? { expected_version: baseline.version, change_note: "새 검증 기준" } : {}),
  });
  assertEquals(first.status, 201);
  const old = first.body;
  const noNote = await call(a, "POST", "/principles/current", {
    title: "다음",
    summary: "판단",
    expected_version: old.version,
  });
  assertEquals(noNote.status, 400);
  const unchanged = await call(a, "POST", "/principles/current", {
    title: old.title,
    summary: old.summary,
    body: old.body,
    expected_version: old.version,
    change_note: "확인",
  });
  assertEquals(unchanged.body, old);
  const request = {
    title: "변경 기준",
    summary: "다음 판단",
    body: "두 번째 원문",
    expected_version: old.version,
    change_note: "상황 변화",
  };
  const raced = await Promise.all([
    call(a, "POST", "/principles/current", request),
    call(a, "POST", "/principles/current", request),
  ]);
  assertEquals(raced.map((r) => r.status).sort(), [201, 409]);
  const next = raced.find((r) => r.status === 201)!.body;
  assert(next.id !== old.id);
  assertEquals(next.version, old.version + 1);
  assertEquals((await call(a, "GET", "/principles/current")).body.current.id, next.id);
  assertEquals((await call(a, "GET", `/principles/${old.id}`)).body.is_current, false);
  assertEquals(
    (await call(a, "POST", `/principles/${old.id}/activate`, { expected_version: old.version })).status,
    404,
  );
  const corrected = await call(a, "PATCH", `/principles/${old.id}/correct`, {
    expected_version: old.version,
    title: "과거 표현 정정",
    change_note: "오타 수정",
  });
  assertEquals(corrected.status, 200);
  assertEquals(corrected.body.saved_at, old.saved_at);
  assertEquals(corrected.body.is_current, false);
  assertEquals((await call(b, "GET", `/principles/${old.id}`)).status, 404);
  assertEquals(
    (await call(a, "PATCH", `/principles/${next.id}/correct`, {
      expected_version: next.version,
      title: "거부",
      change_note: "수정",
    })).status,
    409,
  );
  assertEquals((await call(a, "DELETE", `/principles/${next.id}?expected_version=${next.version}`)).status, 204);
  const promoted = (await call(a, "GET", "/principles/current")).body.current;
  assertEquals(promoted.id, old.id);
  assertEquals(promoted.saved_at, old.saved_at);
  assert(promoted.version > corrected.body.version);
  assertEquals(
    (await call(a, "DELETE", `/principles/${old.id}?expected_version=${corrected.body.version}`)).status,
    409,
  );
  assertEquals((await call(a, "DELETE", `/principles/${old.id}?expected_version=${promoted.version}`)).status, 204);
  assertEquals((await call(a, "GET", "/principles/current")).body.current?.id ?? null, baseline?.id ?? null);
});
