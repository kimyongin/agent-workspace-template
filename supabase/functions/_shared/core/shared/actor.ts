/** 검증된 토큰에서 만든 행위자. 요청 본문의 user_id로 만들지 않는다(ADR-0006). */
export interface Actor {
  userId: string;
  source?: "http" | "mcp";
}
