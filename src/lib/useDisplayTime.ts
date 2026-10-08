import { useContext } from "react";
import { AuthContext } from "../features/auth/auth-context.ts";
import { formatDateTime } from "./format.ts";
import { browserTimezone, timezonePreference } from "./timezone.ts";
export function useDisplayTime() {
  const { session } = useContext(AuthContext);
  const timezone = timezonePreference(session?.user.user_metadata.workspace_timezone) ?? browserTimezone();
  return { timezone, formatDateTime: (iso: string | null | undefined) => formatDateTime(iso, timezone) };
}
