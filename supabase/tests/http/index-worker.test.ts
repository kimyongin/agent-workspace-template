import { assertEquals } from "@std/assert";
import { admin, httpTest, signIn, SUPABASE_URL } from "./_client.ts";
const url = `${SUPABASE_URL}/functions/v1/index-worker`;
httpTest("worker HTTP: 인증·메서드·입력 거부가 큐 claim/공급자 호출보다 먼저", async () => {
  const before = (await admin`select sum(read_ct)::bigint as count from pgmq.q_search_index`)[0].count;
  const user = await signIn("A"), internal = Deno.env.get("INDEX_WORKER_TOKEN")!;
  for (const token of [null, user]) {
    const response = await fetch(url, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: "{}",
    });
    assertEquals(response.status, 401);
    await response.text();
  }
  const get = await fetch(url, { headers: { authorization: `Bearer ${internal}` } });
  assertEquals(get.status, 405);
  await get.text();
  for (
    const body of [{ limit: 6 }, { body: "원문" }, { owner_id: "invalid" }, { limit: 1, extra: 1 }, {
      check_configuration: false,
    }]
  ) {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${internal}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assertEquals(response.status, 400);
    await response.text();
  }
  const after = (await admin`select sum(read_ct)::bigint as count from pgmq.q_search_index`)[0].count;
  assertEquals(after, before);
  const preflight = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${internal}`, "content-type": "application/json" },
    body: JSON.stringify({ check_configuration: true }),
  });
  if (preflight.status === 200) assertEquals(await preflight.json(), { configuration_checked: true });
  else {
    assertEquals(preflight.status, 503);
    assertEquals(await preflight.json(), { error: "worker_not_configured" });
  }
  assertEquals((await admin`select sum(read_ct)::bigint as count from pgmq.q_search_index`)[0].count, before);
  // 없는 항목으로 범위를 제한한다. CI는 key 미설정(503), 설정한 로컬은 빈 batch(200)이며 둘 다 유료 호출 0회.
  const empty = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${internal}`, "content-type": "application/json" },
    body: JSON.stringify({ limit: 1, id: "20261011-ZZZZZZZZ" }),
  });
  if (empty.status === 200) assertEquals((await empty.json()).claimed, 0);
  else {
    assertEquals(empty.status, 503);
    assertEquals(await empty.json(), { error: "worker_not_configured" });
  }
});
