import type postgres from "postgres";
import type {
  InvitationDeliveryClaim,
  InvitationDeliveryStatus,
  InvitationDeliveryStore,
  PreparedInvitationMail,
} from "../../core/workspaces/delivery.ts";
/** Dedicated internal worker login; never sets an end-user JWT or exposes outbox rows. */
export class SqlWorkspaceInvitationDeliveryStore implements InvitationDeliveryStore {
  constructor(private readonly sql: postgres.Sql) {}
  async claim(invitationId?: string): Promise<InvitationDeliveryClaim | null> {
    const [row] = await this.sql`select app.claim_workspace_invitation_delivery(${
      invitationId ?? null
    }::uuid) as result`;
    return row.result;
  }
  async prepare(id: string, fence: string, mail: PreparedInvitationMail): Promise<PreparedInvitationMail | null> {
    const [row] = await this.sql`select app.prepare_workspace_invitation_delivery(${id}::uuid,${fence}::uuid,${
      this.sql.json(mail as never)
    }) as result`;
    return row.result;
  }
  async startSend(id: string, fence: string): Promise<boolean> {
    const [row] = await this.sql`select app.start_workspace_invitation_delivery(${id}::uuid,${fence}::uuid) as result`;
    return row.result;
  }
  async finish(id: string, fence: string, status: Exclude<InvitationDeliveryStatus, "pending">): Promise<boolean> {
    const [row] = await this
      .sql`select app.finish_workspace_invitation_delivery(${id}::uuid,${fence}::uuid,${status}) as result`;
    return row.result;
  }
}
