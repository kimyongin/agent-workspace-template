import { AuthClient, type Session } from "@supabase/supabase-js";
import { accountPreferences } from "../settings/account-preferences.ts";

/** updateUser는 캡처한 세션을 응답 뒤 저장한다. 프로필 쓰기는 공유 세션과 격리한다. */
export function profileClient(session?: Session) {
  const storageKey = `workspace-profile-${crypto.randomUUID()}`;
  const memory = new Map<string, string>(session ? [[storageKey, JSON.stringify(session)]] : []);
  return new AuthClient({
    url: `${import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, "")}/auth/v1`,
    headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
    storageKey,
    storage: {
      getItem: key => {
        const value = memory.get(key) ?? null;
        // autoRefreshToken:false도 updateUser의 만료 검사에 따른 refresh를 막지는 않는다.
        // 고정 SDK의 90초 refresh 여유에 들어온 개인 스냅샷은 읽기부터 거부한다.
        // 공유 refresh token의 회전은 주 SDK만 맡는다.
        if (key === storageKey && value && (JSON.parse(value).expires_at ?? 0) * 1000 <= Date.now() + 90_000) return null;
        return value;
      },
      setItem: (key, value) => { memory.set(key, value); },
      removeItem: key => { memory.delete(key); },
    },
    autoRefreshToken: false,
    detectSessionInUrl: false,
    flowType: "pkce",
  });
}

/** 명시적 JWT 조회는 공유 SDK의 세션 읽기·초기화·refresh·저장을 전혀 사용하지 않는다. */
export async function readProfile(session: Session) {
  const client = profileClient();
  try {
    const { data, error } = await client.getUser(session.access_token);
    if (error) throw error;
    if (data.user?.id !== session.user.id) throw new Error("로그인 계정이 변경되었습니다.");
    return accountPreferences(data.user.user_metadata);
  } finally { await client.dispose(); }
}

export class ProfileDisplayRefreshError extends Error {
  constructor() { super("설정은 저장했지만 계정 표시를 새로 불러오지 못했습니다. 잠시 후 다시 시도하세요."); }
}
