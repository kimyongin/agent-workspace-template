import { invitationMailWorker } from "../_shared/adapters/mail/invitation-worker.ts";
Deno.serve(invitationMailWorker((name) => Deno.env.get(name)));
