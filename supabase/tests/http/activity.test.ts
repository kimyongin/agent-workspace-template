// HTTP 계약 테스트: 실제 로컬 Edge Runtime의 /api와 실제 로그인 토큰으로 검사한다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { admin, call, httpTest, seoulDate, signIn } from "./_client.ts";

const A = await signIn("A");
const B = await signIn("B");

const newOnce = (title = "보고서 초안 쓰기") => ({
  kind: "once",
  title,
  summary: "다음 주 회의용 초안",
  body: "# 메모",
});
const completion = (version: number, extra: Record<string, unknown> = {}) => ({
  expected_version: version,
  title: "초안 완료",
  summary: "3쪽 초안을 공유함",
  body: "링크: 문서함",
  ...extra,
});
const queueCount = async () => (await admin<{ n: number }[]>`select count(*)::int as n from pgmq.q_search_index`)[0].n;

httpTest("인증: 토큰 없음·위조 토큰은 401, 본문은 공통 오류 형식", async () => {
  const none = await call(null, "GET", "/tasks");
  assertEquals(none.status, 401);
  assertEquals(none.body.code, "unauthenticated");
  const [h, p] = A.split(".");
  const forged = await call(`${h}.${p}.AAAA`, "GET", "/tasks");
  assertEquals(forged.status, 401);
  // 내용을 바꾼 토큰(서명 불일치)
  const payload = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
  const altered = btoa(JSON.stringify({ ...payload, sub: "00000000-0000-4000-8000-000000000000" }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assertEquals((await call(`${h}.${altered}.${A.split(".")[2]}`, "GET", "/tasks")).status, 401);
});

httpTest("할 일 생성·조회·한글 왕복과 색인 작업 등록", async () => {
  const before = await queueCount();
  const created = await call(A, "POST", "/tasks", newOnce("한글 제목 ✅"));
  assertEquals(created.status, 201);
  assertEquals(created.body.title, "한글 제목 ✅");
  assertEquals(created.body.status, "open");
  assertEquals(created.body.version, 1);
  assertEquals(await queueCount(), before + 1);
  const got = await call(A, "GET", `/tasks/${created.body.id}`);
  assertEquals(got.status, 200);
  assertEquals(got.body.result_record, null);
});

httpTest("입력 검증: 서버 관리 필드·한도 초과는 400과 위반 필드", async () => {
  const r = await call(A, "POST", "/tasks", { ...newOnce(), status: "done" });
  assertEquals(r.status, 400);
  assertEquals(r.body.fields, [{ path: "status", message: "허용하지 않는 필드입니다" }]);
  const long = await call(A, "POST", "/tasks", { ...newOnce(), title: "가".repeat(101) });
  assertEquals(long.status, 400);
  assertEquals(long.body.fields[0].path, "title");
  const t = (await call(A, "POST", "/tasks", newOnce())).body;
  assertEquals((await call(A, "PATCH", `/tasks/${t.id}`, { expected_version: 1, version: 9 })).status, 400);
});

httpTest("사용자 격리: B는 A의 할 일을 조회·수정·완료·삭제하지 못하고 목록에도 없다(404)", async () => {
  const t = (await call(A, "POST", "/tasks", newOnce("A만의 할 일"))).body;
  assertEquals((await call(B, "GET", `/tasks/${t.id}`)).status, 404);
  assertEquals((await call(B, "PATCH", `/tasks/${t.id}`, { expected_version: 1, title: "탈취" })).status, 404);
  assertEquals((await call(B, "POST", `/tasks/${t.id}/complete`, completion(1))).status, 404);
  assertEquals((await call(B, "DELETE", `/tasks/${t.id}?expected_version=1`)).status, 404);
  const list = await call(B, "GET", "/tasks?limit=100");
  assert(!list.body.items.some((x: { id: string }) => x.id === t.id));
  assertEquals((await call(A, "GET", `/tasks/${t.id}`)).body.title, "A만의 할 일");
});

httpTest("완료: 할 일 done·결과 기록·기록 색인을 함께 저장하고, 다시 완료하면 409", async () => {
  const t = (await call(A, "POST", "/tasks", newOnce())).body;
  const before = await queueCount();
  const done = await call(A, "POST", `/tasks/${t.id}/complete`, completion(1));
  assertEquals(done.status, 200);
  assertEquals(done.body.task.status, "done");
  assertEquals(done.body.task.result_record_id, done.body.record.id);
  assertEquals(done.body.record.task_id, t.id);
  assertEquals(await queueCount(), before + 1);
  const detail = await call(A, "GET", `/tasks/${t.id}`);
  assertEquals(detail.body.result_record, {
    id: done.body.record.id,
    title: "초안 완료",
    summary: "3쪽 초안을 공유함",
  });
  const again = await call(A, "POST", `/tasks/${t.id}/complete`, completion(2));
  assertEquals(again.status, 409);
  assertEquals(again.body.code, "conflict");
  const stale = await call(A, "PATCH", `/tasks/${t.id}`, { expected_version: 1, title: "늦은 수정" });
  assertEquals(stale.status, 409);
});

httpTest("동시 완료: 서로 다른 요청 5개 중 하나만 성공하고 결과 기록은 1개", async () => {
  const t = (await call(A, "POST", "/tasks", newOnce("동시 완료"))).body;
  const results = await Promise.all(
    Array.from({ length: 5 }, () => call(A, "POST", `/tasks/${t.id}/complete`, completion(1))),
  );
  assertEquals(results.filter((r) => r.status === 200).length, 1);
  assertEquals(results.filter((r) => r.status === 409).length, 4);
  const [{ n }] = await admin<{ n: number }[]>`select count(*)::int as n from app.records where task_id = ${t.id}`;
  assertEquals(n, 1);
});

httpTest("응답 유실 후 재시도: 같은 request_id는 첫 결과를 돌려주고 중복 기록이 없다", async () => {
  const t = (await call(A, "POST", "/tasks", newOnce("재시도"))).body;
  const requestId = crypto.randomUUID();
  // 동시에 같은 요청을 여러 번 보내도(응답 유실 후 재전송) 한 번만 실행된다.
  const results = await Promise.all(
    Array.from(
      { length: 4 },
      () => call(A, "POST", `/tasks/${t.id}/complete`, completion(1, { request_id: requestId })),
    ),
  );
  assert(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));
  assertEquals(new Set(results.map((r) => r.body.record.id)).size, 1);
  const late = await call(A, "POST", `/tasks/${t.id}/complete`, completion(1, { request_id: requestId }));
  assertEquals(late.body.record.id, results[0].body.record.id);
  const [{ n }] = await admin<{ n: number }[]>`select count(*)::int as n from app.records where task_id = ${t.id}`;
  assertEquals(n, 1);
  // 같은 키로 다른 내용을 보내면 conflict
  const changed = await call(
    A,
    "POST",
    `/tasks/${t.id}/complete`,
    completion(1, { request_id: requestId, title: "다름" }),
  );
  assertEquals(changed.status, 409);
  // 다른 사용자가 같은 키를 써도 A의 결과를 받지 못한다
  const other = await call(B, "POST", `/tasks/${t.id}/complete`, completion(1, { request_id: requestId }));
  assertEquals(other.status, 404);
});

httpTest("생성의 request_id 재전송은 같은 할 일을 돌려준다", async () => {
  const body = { ...newOnce("한 번만 생성"), request_id: crypto.randomUUID() };
  const [x, y] = await Promise.all([call(A, "POST", "/tasks", body), call(A, "POST", "/tasks", body)]);
  assertEquals(x.status, 201);
  assertEquals(y.body.id, x.body.id);
});

httpTest("기록 삭제: 일회성 할 일은 done을 유지하고 result_record_id만 비운다", async () => {
  const t = (await call(A, "POST", "/tasks", newOnce())).body;
  const done = (await call(A, "POST", `/tasks/${t.id}/complete`, completion(1))).body;
  const del = await call(A, "DELETE", `/records/${done.record.id}?expected_version=${done.record.version}`);
  assertEquals(del.status, 204);
  const after = (await call(A, "GET", `/tasks/${t.id}`)).body;
  assertEquals(after.status, "done");
  assertEquals(after.result_record_id, null);
  assertEquals(after.result_record, null);
});

httpTest("할 일 삭제: 결과 기록은 보존하고 task_id를 비운다", async () => {
  const t = (await call(A, "POST", "/tasks", newOnce())).body;
  const done = (await call(A, "POST", `/tasks/${t.id}/complete`, completion(1))).body;
  assertEquals((await call(A, "DELETE", `/tasks/${t.id}?expected_version=1`)).status, 409);
  assertEquals((await call(A, "DELETE", `/tasks/${t.id}?expected_version=2`)).status, 204);
  assertEquals((await call(A, "GET", `/tasks/${t.id}`)).status, 404);
  const rec = await call(A, "GET", `/records/${done.record.id}`);
  assertEquals(rec.status, 200);
  assertEquals(rec.body.task_id, null);
});

httpTest("반복 할 일: 회차 목록·기록·거부(미래·중단 기간)·중단·재개·회차 필터", async () => {
  const start = seoulDate(-3);
  const today = seoulDate();
  const created = await call(A, "POST", "/tasks", {
    kind: "recurring",
    title: "물 주기",
    summary: "베란다 화분",
    recurrence: { freq: "daily", starts_on: start },
    timezone: "Asia/Seoul",
  });
  assertEquals(created.status, 201);
  const t = created.body;
  assertEquals(t.status, "active");
  const rec = { title: "물 줌", summary: "200ml" };
  assertEquals((await call(A, "POST", `/tasks/${t.id}/occurrences/${seoulDate(-1)}/records`, rec)).status, 201);
  assertEquals((await call(A, "POST", `/tasks/${t.id}/occurrences/${seoulDate(-1)}/records`, rec)).status, 201);
  const future = await call(A, "POST", `/tasks/${t.id}/occurrences/${seoulDate(1)}/records`, rec);
  assertEquals(future.status, 400);
  const beforeStart = await call(A, "POST", `/tasks/${t.id}/occurrences/${seoulDate(-4)}/records`, rec);
  assertEquals(beforeStart.status, 400);
  assertEquals((await call(A, "POST", `/tasks/${t.id}/complete`, completion(1))).status, 409);

  const occ = await call(A, "GET", `/tasks/${t.id}/occurrences?from=${start}&to=${seoulDate(1)}`);
  assertEquals(occ.status, 200);
  assertEquals(occ.body.today, today);
  assertEquals(
    occ.body.items.map((
      o: { date: string; status: string; record_ids: string[] },
    ) => [o.date, o.status, o.record_ids.length]),
    [[start, "missed", 0], [seoulDate(-2), "missed", 0], [seoulDate(-1), "done", 2], [today, "due", 0], [
      seoulDate(1),
      "upcoming",
      0,
    ]],
  );

  const filtered = await call(A, "GET", `/tasks?occurrence_on=${today}&limit=100`);
  const mine = filtered.body.items.find((x: { id: string }) => x.id === t.id);
  assertEquals(mine.occurrence.status, "due");

  const stopped = await call(A, "POST", `/tasks/${t.id}/stop`, { expected_version: 1 });
  assertEquals(stopped.body.status, "stopped");
  assertEquals((await call(A, "POST", `/tasks/${t.id}/stop`, { expected_version: 2 })).status, 409);
  assertEquals((await call(A, "POST", `/tasks/${t.id}/occurrences/${today}/records`, rec)).status, 400);
  const resumed = await call(A, "POST", `/tasks/${t.id}/resume`, { expected_version: 2 });
  assertEquals(resumed.body.status, "active");
  assertEquals((await call(A, "POST", `/tasks/${t.id}/occurrences/${today}/records`, rec)).status, 201);

  const range = await call(A, "GET", `/tasks/${t.id}/occurrences?from=2026-01-01&to=2027-06-01`);
  assertEquals(range.status, 400);
});

httpTest("반복 규칙 수정: 기존 기록은 규칙 밖 기록으로 남는다", async () => {
  const start = seoulDate(-14);
  const t = (await call(A, "POST", "/tasks", {
    kind: "recurring",
    title: "운동",
    summary: "30분",
    recurrence: { freq: "daily", starts_on: start },
    timezone: "Asia/Seoul",
  })).body;
  const day = seoulDate(-2);
  await call(A, "POST", `/tasks/${t.id}/occurrences/${day}/records`, { title: "운동함", summary: "달리기" });
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
  const other = (weekday % 7) + 1; // 기록한 날의 다음 요일만 회차로
  const upd = await call(A, "PATCH", `/tasks/${t.id}`, {
    expected_version: 1,
    recurrence: { freq: "weekly", weekdays: [other], starts_on: start },
  });
  assertEquals(upd.status, 200);
  const occ = await call(A, "GET", `/tasks/${t.id}/occurrences?from=${day}&to=${day}`);
  assertEquals(occ.body.items.length, 1);
  assertEquals(occ.body.items[0].in_rule, false);
  assertEquals(occ.body.items[0].status, "done");
});

httpTest("기록 목록: 커서 페이지와 다른 조건의 커서 거부", async () => {
  const task = (await call(A, "POST", "/tasks", newOnce())).body;
  // 같은 할 일에 연결된 기록 3개를 만들기 위해 반복 대신 직접 기록 + task 필터 없는 목록을 쓴다.
  const stamp = new Date().toISOString();
  for (let i = 0; i < 3; i++) {
    await call(A, "POST", "/records", { title: `페이지 ${i}`, summary: "목록 시험", occurred_at: stamp });
  }
  const first = await call(A, "GET", `/records?limit=2&occurred_from=${encodeURIComponent(stamp)}`);
  assertEquals(first.body.items.length, 2);
  assertNotEquals(first.body.next_cursor, null);
  const second = await call(
    A,
    "GET",
    `/records?limit=2&occurred_from=${encodeURIComponent(stamp)}&cursor=${first.body.next_cursor}`,
  );
  const ids = [...first.body.items, ...second.body.items].map((r: { id: string }) => r.id);
  assertEquals(new Set(ids).size, ids.length);
  assert(second.body.items.length >= 1);
  const wrong = await call(A, "GET", `/records?limit=2&task_id=${task.id}&cursor=${first.body.next_cursor}`);
  assertEquals(wrong.status, 400);
  // B는 A의 커서로 A의 기록을 보지 못한다
  const stolen = await call(
    B,
    "GET",
    `/records?limit=2&occurred_from=${encodeURIComponent(stamp)}&cursor=${first.body.next_cursor}`,
  );
  assertEquals(stolen.status, 400);
});

httpTest("기록 수정: 제목·요약 변경은 재색인, 본문만 변경은 재색인하지 않음", async () => {
  const r = (await call(A, "POST", "/records", { title: "기록", summary: "요약" })).body;
  let before = await queueCount();
  assertEquals((await call(A, "PATCH", `/records/${r.id}`, { expected_version: 1, body: "본문만" })).status, 200);
  assertEquals(await queueCount(), before);
  before = await queueCount();
  assertEquals((await call(A, "PATCH", `/records/${r.id}`, { expected_version: 2, summary: "새 요약" })).status, 200);
  assertEquals(await queueCount(), before + 1);
});
