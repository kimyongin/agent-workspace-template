// 웹의 Supabase Auth 클라이언트. 로그인·세션·MCP 동의에만 쓰며 제품 데이터에 .from/.rpc를 쓰지 않는다.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});

/** 개발용 이메일 로그인은 설정이 켜져 있고 Supabase 주소가 로컬일 때만 보인다(운영 빌드에서 끈다). */
export const devLoginEnabled = import.meta.env.VITE_DEV_LOGIN === "true" &&
  /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
