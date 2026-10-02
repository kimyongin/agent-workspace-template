// Custom Access Token Hook: OAuth 클라이언트 토큰만 aud를 MCP URL로 바꾸고, 설정이 없으면 발급을 막는다.
import { assertEquals, assertMatch } from "@std/assert";
import { connect, dbTest, outcome, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const event = (claims: Record<string, unknown>) => ({ user_id: "u", claims: { aud: "authenticated", ...claims } });

dbTest("웹 세션 토큰(client_id 없음)은 aud=authenticated 그대로", async () => {
  const [{ out }] = await admin`select private.custom_access_token_hook(${admin.json(event({}))}) as out`;
  assertEquals(out.claims.aud, "authenticated");
});

dbTest("OAuth 클라이언트 토큰은 aud가 설정된 MCP URL", async () => {
  const [{ value }] = await admin`select value from private.auth_settings where key = 'mcp_audience'`;
  const [{ out }] = await admin`select private.custom_access_token_hook(${
    admin.json(event({ client_id: "c1" }))
  }) as out`;
  assertEquals(out.claims.aud, value);
});

dbTest("mcp_audience 설정이 없으면 OAuth 클라이언트 토큰 발급을 막는다", async () => {
  const r = await outcome(admin.begin(async (tx) => {
    await tx`delete from private.auth_settings where key = 'mcp_audience'`;
    await tx`select private.custom_access_token_hook(${tx.json(event({ client_id: "c1" }))})`;
  }));
  assertMatch(r, /mcp_audience is not configured/);
});

dbTest("사용자 역할은 hook과 설정에 접근하지 못한다", async () => {
  for (const role of ["authenticated", "anon"]) {
    const r = await outcome(admin.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      await tx`select value from private.auth_settings`;
    }));
    assertMatch(r, /^42501 permission denied/);
  }
});
