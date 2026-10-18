import postgres from "postgres";
import { deliverWorkspaceInvitation, type InvitationDeliveryStore } from "../../core/workspaces/delivery.ts";
import { SqlWorkspaceInvitationDeliveryStore } from "../supabase/workspace-delivery-store.ts";
import { createInvitationMailer } from "./invitation-mailer.ts";
export function invitationMailWorker(
  readEnv: (name: string) => string | undefined,
  connect: (url: string) => InvitationDeliveryStore = (url) =>
    new SqlWorkspaceInvitationDeliveryStore(
      postgres(url, {
        prepare: false,
        max: 1,
        idle_timeout: 20,
        onnotice: () => {},
        connection: { statement_timeout: 15000, lock_timeout: 5000 },
      }),
    ),
  fetcher: typeof fetch = fetch,
) {
  let store: InvitationDeliveryStore | undefined;
  return async (request: Request): Promise<Response> => {
    const token = readEnv("PROCESSING_TOKEN");
    if (!token || token.length < 43) return Response.json({ error: "worker_not_configured" }, { status: 503 });
    if (request.headers.get("Authorization") !== `Bearer ${token}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
    let input: Record<string, unknown>;
    try {
      const reader = request.body?.getReader();
      if (!reader) throw new Error();
      let bytes = 0, body = "";
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 2048) {
          await reader.cancel();
          throw new Error();
        }
        body += decoder.decode(value, { stream: true });
      }
      input = JSON.parse(body + decoder.decode());
      if (
        !input || Array.isArray(input) || typeof input !== "object" || Object.keys(input).some((k) =>
          !["limit", "check_configuration"].includes(k)
        ) || (input.limit !== undefined && input.limit !== 1) ||
        (input.check_configuration !== undefined && input.check_configuration !== true)
      ) throw new Error();
    } catch {
      return Response.json({ error: "invalid_input" }, { status: 400 });
    }
    const url = readEnv("WORKER_DB_URL");
    if (!url) return Response.json({ error: "worker_not_configured" }, { status: 503 });
    const mailer = createInvitationMailer({
      mode: readEnv("INVITATION_MAIL_MODE"),
      apiKey: readEnv("RESEND_API_KEY"),
      from: readEnv("INVITATION_MAIL_FROM"),
      webOrigin: readEnv("INVITATION_WEB_ORIGIN"),
      mailpitOrigin: readEnv("INVITATION_MAILPIT_ORIGIN"),
    }, fetcher);
    if (input.check_configuration) return Response.json({ configuration_checked: true, delivery_configured: !!mailer });
    try {
      store ??= connect(url);
      return Response.json(await deliverWorkspaceInvitation(store, mailer));
    } catch {
      return Response.json({ error: "worker_failed" }, { status: 503 });
    }
  };
}
