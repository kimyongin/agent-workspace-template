import { z } from "zod";
import type { InvitationMailer, InvitationMessage, PreparedInvitationMail } from "../../core/workspaces/delivery.ts";
export interface InvitationMailConfig {
  mode?: string;
  apiKey?: string;
  from?: string;
  webOrigin?: string;
  mailpitOrigin?: string;
}
function origin(value: string | undefined, local: boolean): string | undefined {
  try {
    const url = new URL(value ?? "");
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return;
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (local ? url.protocol !== "http:" || !loopback : url.protocol !== "https:") return;
    return url.origin;
  } catch {
    return;
  }
}
async function responseId(response: Response, field: string): Promise<boolean> {
  const reader = response.body?.getReader();
  if (!reader) return false;
  let bytes = 0, body = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 8192) {
        await reader.cancel();
        return false;
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const result = JSON.parse(body);
    return typeof result[field] === "string" && result[field].length > 0;
  } catch {
    return false;
  }
}
/** Local mode only injects into Mailpit; never calls its relay/release endpoints. */
export function createInvitationMailer(
  config: InvitationMailConfig,
  fetcher: typeof fetch = fetch,
): InvitationMailer | undefined {
  const local = config.mode === "mailpit";
  if (!local && config.mode !== "resend") return;
  if (!z.email().max(320).safeParse(config.from).success) return;
  const web = origin(config.webOrigin, local && config.webOrigin?.startsWith("http:") === true);
  const sink = local ? origin(config.mailpitOrigin, true) : "https://api.resend.com";
  if (!web || !sink || (!local && !config.apiKey)) return;
  const endpoint = `${sink}${local ? "/api/v1/send" : "/emails"}`;
  return {
    prepare(message: InvitationMessage): PreparedInvitationMail {
      if (!/^\/invitations\/[0-9a-f-]{36}$/i.test(message.acceptance_path)) throw new Error("Invalid invitation path");
      const text =
        `${message.workspace_name} 워크스페이스에 초대되었습니다.\nGoogle 계정으로 로그인한 뒤 초대를 수락하세요.\n${web}${message.acceptance_path}`;
      return {
        provider: local ? "mailpit" : "resend",
        endpoint,
        idempotency_key: `workspace-invitation/${message.invitation_id}`,
        body: JSON.stringify(
          local
            ? { From: { Email: config.from }, To: [{ Email: message.email }], Subject: "워크스페이스 초대", Text: text }
            : { from: config.from, to: [message.email], subject: "워크스페이스 초대", text },
        ),
      };
    },
    async send(mail) {
      // A configuration/provider change cannot redirect previously prepared requests.
      if (mail.provider !== (local ? "mailpit" : "resend") || mail.endpoint !== endpoint) return "unconfigured";
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (!local) {
          headers.Authorization = `Bearer ${config.apiKey}`;
          headers["Idempotency-Key"] = mail.idempotency_key;
        }
        const response = await fetcher(endpoint, {
          method: "POST",
          headers,
          body: mail.body,
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) return await responseId(response, local ? "ID" : "id") ? "sent" : "unknown";
        await response.body?.cancel();
        return [400, 401, 403, 404, 422].includes(response.status) ? "failed" : "unknown";
      } catch {
        return "unknown";
      }
    },
  };
}
