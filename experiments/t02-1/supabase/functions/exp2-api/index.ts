// T02-1 실험 2: 웹용 HTTP API는 일반 세션 토큰(aud=authenticated)만 받는다. 격리 로컬 실험 전용.
import { withSupabase } from "npm:@supabase/server@1.9.0";

Deno.serve(
  withSupabase({ auth: "user", audience: "authenticated", cors: false }, async (_req, ctx) => {
    const c = (ctx.jwtClaims ?? {}) as Record<string, unknown>;
    return Response.json({ sub: c.sub, aud: c.aud, client_id: c.client_id ?? null });
  }),
);
