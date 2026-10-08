import { useContext } from "react";
import { AuthContext } from "../features/auth/auth-context.ts";
import { accountPreferences } from "../features/settings/account-preferences.ts";
import { formatDateTime } from "./format.ts";
import { browserTimezone } from "./timezone.ts";
export function useDisplayTime() {
  const { session } = useContext(AuthContext);
  const timezone = accountPreferences(session?.user.user_metadata ?? {}).timezone ?? browserTimezone();
  return { timezone, formatDateTime: (iso: string | null | undefined) => formatDateTime(iso, timezone) };
}
