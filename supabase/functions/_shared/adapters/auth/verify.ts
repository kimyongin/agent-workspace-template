// 토큰 검증과 Actor 생성. 서명(JWKS)·발급자·audience·만료를 검사한다.
// 웹 세션 토큰은 aud=authenticated, MCP 토큰은 aud=MCP 서버 URL이며 각 진입점은 자기 audience만 받는다(ADR-0006).
import { verifyAuth } from "@supabase/server/core";
import type { Actor } from "../../core/shared/actor.ts";
import { AppError } from "../../core/shared/errors.ts";

export interface TokenPolicy {
  audience: string;
  issuer: string;
}

export async function verifyActor(request: Request, policy: TokenPolicy): Promise<Actor> {
  if (!request.headers.get("authorization")?.toLowerCase().startsWith("bearer ")) {
    throw new AppError("unauthenticated", "로그인이 필요합니다");
  }
  const { data, error } = await verifyAuth(request, { auth: "user", audience: policy.audience, issuer: policy.issuer });
  if (error || !data?.jwtClaims?.sub) {
    if (error && error.status >= 500) {
      console.error("auth misconfigured", error.message);
      throw new AppError("internal", "서버 인증 설정 오류입니다");
    }
    throw new AppError("unauthenticated", "토큰이 유효하지 않거나 이 진입점용이 아닙니다");
  }
  return { userId: data.jwtClaims.sub };
}
