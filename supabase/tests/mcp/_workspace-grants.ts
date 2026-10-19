import { assertEquals } from "@std/assert";
import { call } from "../http/_client.ts";
import { claimsOf } from "./_mcp.ts";

/** Tests explicitly grant only the newly created kinds needed by their business writes. */
export async function grantOwnedKinds(session: string, workspace: string, kindIds: string[]) {
  const current = await call(session, "GET", `/workspaces/${workspace}`);
  assertEquals(current.status, 200);
  const grants = current.body.grants.filter((grant: { target_kind: string; target_id: string }) =>
    grant.target_kind !== "entity_type" || !kindIds.includes(grant.target_id)
  );
  assertEquals(
    (await call(session, "PATCH", `/workspaces/${workspace}/members/${claimsOf(session).sub}`, {
      expected_version: current.body.membership_version,
      grants: [...grants, ...kindIds.map((id) => ({ target_kind: "entity_type", target_id: id, access: "write" }))],
    })).status,
    200,
  );
}
