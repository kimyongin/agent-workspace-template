import { useAuth } from "../features/auth/AuthProvider.tsx";
import { formatDateTime } from "./format.ts";
import { browserTimezone, timezonePreference } from "./timezone.ts";
export function useDisplayTime() {
  const { session } = useAuth();
  const timezone = timezonePreference(session?.user.user_metadata.workspace_timezone) ?? browserTimezone();
  return { timezone, formatDateTime: (iso: string | null | undefined) => formatDateTime(iso, timezone) };
}
