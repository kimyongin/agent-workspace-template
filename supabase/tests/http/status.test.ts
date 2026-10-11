import { assertEquals } from "@std/assert";
import { indexingIssuesPage } from "../../functions/_shared/contracts/status.ts";
import { call, httpTest, signIn } from "./_client.ts";
httpTest("status HTTP: authentication, timezone, bounded page and strict request fields", async () => {
  const token = await signIn("A");
  assertEquals((await call(null, "GET", "/status")).status, 401);
  const overview = await call(token, "GET", "/status");
  assertEquals(overview.status, 200);
  assertEquals(overview.body.timezone, "Asia/Seoul");
  assertEquals(overview.body.daily.length, 30);
  const issues = await call(token, "GET", "/status/indexing/issues");
  assertEquals(issues.status, 200);
  indexingIssuesPage.parse(issues.body);
  for (const query of ["limit=6", "owner_id=other", "request_key=x", "cursor=invalid"]) {
    assertEquals((await call(token, "GET", `/status/indexing/issues?${query}`)).status, 400);
  }
});
