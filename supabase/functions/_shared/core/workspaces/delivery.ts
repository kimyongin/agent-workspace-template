/** Provider acceptance is not proof of inbox delivery. Wire payloads never contain credentials. */
export type InvitationDeliveryStatus = "pending" | "sent" | "failed" | "unknown" | "unconfigured";
export interface InvitationMessage {
  invitation_id: string;
  email: string;
  workspace_name: string;
  acceptance_path: string;
}
export interface PreparedInvitationMail {
  provider: "resend" | "mailpit";
  endpoint: string;
  body: string;
  idempotency_key: string;
}
export interface InvitationDeliveryClaim extends InvitationMessage {
  fence: string;
  prepared: PreparedInvitationMail | null;
}
export interface InvitationDeliveryStore {
  claim(invitationId?: string): Promise<InvitationDeliveryClaim | null>;
  prepare(id: string, fence: string, mail: PreparedInvitationMail): Promise<PreparedInvitationMail | null>;
  startSend(id: string, fence: string): Promise<boolean>;
  finish(id: string, fence: string, status: Exclude<InvitationDeliveryStatus, "pending">): Promise<boolean>;
}
export interface InvitationMailer {
  prepare(message: InvitationMessage): PreparedInvitationMail;
  send(mail: PreparedInvitationMail): Promise<"sent" | "failed" | "unknown" | "unconfigured">;
}
/** One bounded attempt. SQL owns leases, current authorization and retry eligibility. */
export async function deliverWorkspaceInvitation(
  store: InvitationDeliveryStore,
  mailer?: InvitationMailer,
  invitationId?: string,
): Promise<{ processed: number; status?: InvitationDeliveryStatus }> {
  const claim = await store.claim(invitationId);
  if (!claim) return { processed: 0 };
  if (!mailer) {
    const applied = await store.finish(claim.invitation_id, claim.fence, "unconfigured");
    return applied ? { processed: 1, status: "unconfigured" } : { processed: 0 };
  }
  const prepared = await store.prepare(
    claim.invitation_id,
    claim.fence,
    claim.prepared ?? mailer.prepare(claim),
  );
  if (!prepared || !await store.startSend(claim.invitation_id, claim.fence)) return { processed: 0 };
  let status: "sent" | "failed" | "unknown" | "unconfigured";
  try {
    status = await mailer.send(prepared);
  } catch {
    status = "unknown";
  }
  const applied = await store.finish(claim.invitation_id, claim.fence, status);
  return applied ? { processed: 1, status } : { processed: 0 };
}
