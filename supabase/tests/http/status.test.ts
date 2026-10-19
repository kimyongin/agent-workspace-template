import { assertEquals } from "@std/assert";
import { indexingIssuesPage } from "../../functions/_shared/contracts/status.ts";
import { call } from "./_client.ts";
import { activityWorkspaceSuite, scopedHttp } from "./_workspace-activity-fixture.ts";
activityWorkspaceSuite(
  "status HTTP: authentication, timezone, bounded page and strict request fields",
  async ({ A: token, workspaceA: workspace }) => {
    assertEquals((await call(null, "GET", "/status")).status, 401);
    const overview = await scopedHttp(token, workspace, "GET", "/status");
    assertEquals(overview.status, 200);
    assertEquals(overview.body.timezone, "Asia/Seoul");
    assertEquals(overview.body.daily.length, 30);
    const issues = await scopedHttp(token, workspace, "GET", "/status/indexing/issues");
    assertEquals(issues.status, 200);
    indexingIssuesPage.parse(issues.body);
    for (const query of ["limit=6", "owner_id=other", "request_key=x", "cursor=invalid"]) {
      assertEquals((await scopedHttp(token, workspace, "GET", `/status/indexing/issues?${query}`)).status, 400);
    }
  },
);
