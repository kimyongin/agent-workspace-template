// Auth hook 계약: 서버가 제공한 issuer에서 MCP audience를 계산하며 웹 세션은 보존한다.
import { assertEquals, assertMatch } from "@std/assert";
import { connect, dbTest, outcome, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const event = (claims: Record<string, unknown>) => ({ user_id: "u", claims: { aud: "authenticated", ...claims } });

dbTest("웹 세션 토큰(client_id 없음)은 claims 전체를 보존한다", async () => {
  const input = event({ iss: "https://example.supabase.co/auth/v1", sub: "u" });
  const [{ out }] = await admin`select private.custom_access_token_hook(${admin.json(input)}) as out`;
  assertEquals(out, input);
});

dbTest("OAuth 토큰은 환경 설정 테이블 없이 Auth issuer에서 MCP audience를 계산한다", async () => {
  for (
    const [iss, expected] of [
      ["http://127.0.0.1:56321/auth/v1", "http://127.0.0.1:56321/functions/v1/mcp"],
      ["https://example.supabase.co/auth/v1", "https://example.supabase.co/functions/v1/mcp"],
    ]
  ) {
    const input = event({ client_id: "c1", iss, sub: "u" });
    const [{ out }] = await admin`select private.custom_access_token_hook(${admin.json(input)}) as out`;
    assertEquals(out, { ...input, claims: { ...input.claims, aud: expected } });
  }
  const [{ removed }] = await admin`select to_regclass('private.auth_settings') is null as removed`;
  assertEquals(removed, true);
});

dbTest("issuer가 없거나 표준 Auth 주소가 아니면 OAuth 토큰 발급을 거부한다", async () => {
  for (
    const iss of [
      undefined,
      "",
      "https://example.supabase.co",
      "https://example.supabase.co/auth/v1/",
      "https://example.supabase.co/auth/v1?redirect=x",
      "https://user@example.supabase.co/auth/v1",
    ]
  ) {
    const r = await outcome(
      admin`select private.custom_access_token_hook(${admin.json(event({ client_id: "c1", iss }))})`,
    );
    assertMatch(r, /invalid Auth issuer/);
  }
});

dbTest("일반 사용자에게 hook 실행 권한이 없고 Auth 관리 역할은 실행할 수 있다", async () => {
  for (const role of ["authenticated", "anon"]) {
    const r = await outcome(admin.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      await tx`select private.custom_access_token_hook(${tx.json(event({}))})`;
    }));
    assertMatch(r, /^42501 permission denied/);
  }
  const [{ allowed }] =
    await admin`select has_function_privilege('supabase_auth_admin', 'private.custom_access_token_hook(jsonb)', 'execute') as allowed`;
  assertEquals(allowed, true);
});
