import { assertEquals } from "@std/assert";
import { activityWorkspaceSuite, scopedHttp } from "./_workspace-activity-fixture.ts";
import { call } from "./_client.ts";
import { claimsOf } from "../mcp/_mcp.ts";

activityWorkspaceSuite(
  "schema draft authority: missing material read is definite denial while analysis still requires write",
  async ({ A, workspaceA, workspaceB, schema }) => {
    const type = schema.entity_type_id;
    const base = `/entity-types/${type}/schema-changes`;
    const grants = async (access?: "read") => {
      const current = await call(A, "GET", `/workspaces/${workspaceA}`);
      assertEquals(current.status, 200);
      const changed = await call(A, "PATCH", `/workspaces/${workspaceA}/members/${claimsOf(A).sub}`, {
        expected_version: current.body.membership_version,
        grants: [
          { target_kind: "settings", target_id: "*", access: "write" },
          ...(access ? [{ target_kind: "entity_type", target_id: type, access }] : []),
        ],
      });
      assertEquals(changed.status, 200);
    };
    await grants();
    const required = {
      expected_schema_version: 1,
      edits: [{
        op: "add_property",
        client_ref: "required_price",
        field: { type: "number", title: "가격", "x-order": 30 },
        required: true,
      }],
    };
    const requestKey = crypto.randomUUID();
    const denied = await scopedHttp(A, workspaceA, "POST", base, required, requestKey);
    assertEquals(denied.status, 403, JSON.stringify(denied.body));
    assertEquals(denied.body.code, "forbidden");
    assertEquals(denied.body.message.includes("읽기 권한"), true);
    assertEquals((await scopedHttp(A, workspaceA, "GET", base)).body.items, []);
    assertEquals((await scopedHttp(A, workspaceA, "GET", `/entity-types/${type}/schema`)).body.schema_version, 1);

    const compatible = await scopedHttp(A, workspaceA, "POST", base, {
      ...required,
      edits: [{ ...required.edits[0], required: false }],
    });
    assertEquals(compatible.status, 201, JSON.stringify(compatible.body));
    const deniedUpdate = await scopedHttp(A, workspaceA, "PATCH", `${base}/${compatible.body.id}`, {
      ...required,
      expected_change_version: 1,
    });
    assertEquals(deniedUpdate.status, 403, JSON.stringify(deniedUpdate.body));
    assertEquals(deniedUpdate.body.code, "forbidden");
    const unchanged = await scopedHttp(A, workspaceA, "GET", `${base}/${compatible.body.id}`);
    assertEquals(unchanged.status, 200);
    assertEquals(unchanged.body.version, 1);
    assertEquals(unchanged.body.change_kind, "compatible");

    await grants("read");
    const created = await scopedHttp(A, workspaceA, "POST", base, required, requestKey);
    assertEquals(created.status, 201, JSON.stringify(created.body));
    assertEquals((await scopedHttp(A, workspaceA, "GET", `${base}/${created.body.id}`)).status, 200);
    const analysis = await scopedHttp(A, workspaceA, "POST", `${base}/${created.body.id}/analyze`, {
      expected_change_version: 1,
    });
    assertEquals(analysis.status, 403, JSON.stringify(analysis.body));
    assertEquals(analysis.body.code, "forbidden");
    assertEquals((await scopedHttp(A, workspaceB, "GET", `${base}/${created.body.id}`)).status, 403);
  },
);
