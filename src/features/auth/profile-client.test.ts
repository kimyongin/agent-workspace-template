import { afterEach, expect, test, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { profileClient } from "./profile-client.ts";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
test("만료 임박한 개인 프로필 세션은 공유 refresh token을 회전시키지 않는다", async () => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:56521");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "fixture-public-key");
  const network = vi.fn(() => { throw new Error("unexpected network"); });
  vi.stubGlobal("fetch", network);
  const session = {
    access_token: "fixture-access", refresh_token: "shared-refresh", expires_at: Math.floor(Date.now() / 1000) + 30,
    token_type: "bearer", expires_in: 30, user: { id: "fixture-account", aud: "authenticated", app_metadata: {}, user_metadata: { workspace_avatar_id: "person" }, created_at: "2026-10-04T00:00:00Z" },
  } satisfies Session;
  const client = profileClient(session);
  try {
    const result = await client.updateUser({ data: { workspace_avatar_id: "star" } });
    expect(result.error?.name).toBe("AuthSessionMissingError");
    expect(network).not.toHaveBeenCalled();
    expect(session.refresh_token).toBe("shared-refresh");
    expect(session.user.user_metadata.workspace_avatar_id).toBe("person");
  } finally { await client.dispose(); }
});
