import { Hono } from "hono";
import type { HttpEnv } from "./input.ts";
import { json } from "./input.ts";
import {
  acceptWorkspaceInvitation,
  cancelWorkspaceInvitation,
  createWorkspace,
  inviteWorkspaceMember,
  leaveWorkspace,
  listWorkspaceInvitations,
  listWorkspaceMembers,
  listWorkspaces,
  removeWorkspaceMember,
  retryWorkspaceInvitationDelivery,
  updateWorkspaceMember,
  type WorkspaceDeps,
  workspaceDetails,
  workspaceGrantTargets,
} from "../../core/workspaces/application.ts";
export function workspaceRoutes(deps: WorkspaceDeps) {
  const app = new Hono<HttpEnv>();
  app.get("/workspaces", async (c) => c.json(await listWorkspaces(deps, c.get("actor"))));
  app.post("/workspaces", async (c) => c.json(await createWorkspace(deps, c.get("actor"), await json(c.req.raw)), 201));
  app.get("/workspaces/:id", async (c) => c.json(await workspaceDetails(deps, c.get("actor"), c.req.param("id"))));
  app.get(
    "/workspaces/:id/grant-targets",
    async (c) => c.json(await workspaceGrantTargets(deps, c.get("actor"), c.req.param("id"))),
  );
  app.get(
    "/workspaces/:id/members",
    async (c) => c.json(await listWorkspaceMembers(deps, c.get("actor"), c.req.param("id"))),
  );
  app.patch(
    "/workspaces/:id/members/:userId",
    async (c) =>
      c.json(
        await updateWorkspaceMember(
          deps,
          c.get("actor"),
          c.req.param("id"),
          c.req.param("userId"),
          await json(c.req.raw),
        ),
      ),
  );
  app.delete(
    "/workspaces/:id/members/:userId",
    async (c) =>
      c.json(
        await removeWorkspaceMember(
          deps,
          c.get("actor"),
          c.req.param("id"),
          c.req.param("userId"),
          await json(c.req.raw),
        ),
      ),
  );
  app.post(
    "/workspaces/:id/leave",
    async (c) => c.json(await leaveWorkspace(deps, c.get("actor"), c.req.param("id"), await json(c.req.raw))),
  );
  app.get(
    "/workspaces/:id/invitations",
    async (c) => c.json(await listWorkspaceInvitations(deps, c.get("actor"), c.req.param("id"))),
  );
  app.post(
    "/workspaces/:id/invitations",
    async (c) =>
      c.json(await inviteWorkspaceMember(deps, c.get("actor"), c.req.param("id"), await json(c.req.raw)), 201),
  );
  app.delete(
    "/workspaces/:id/invitations/:invitationId",
    async (c) =>
      c.json(
        await cancelWorkspaceInvitation(
          deps,
          c.get("actor"),
          c.req.param("id"),
          c.req.param("invitationId"),
          await json(c.req.raw),
        ),
      ),
  );
  app.post(
    "/invitations/:invitationId/accept",
    async (c) => c.json(await acceptWorkspaceInvitation(deps, c.get("actor"), c.req.param("invitationId"))),
  );
  app.post(
    "/workspaces/:id/invitations/:invitationId/delivery",
    async (c) =>
      c.json(
        await retryWorkspaceInvitationDelivery(
          deps,
          c.get("actor"),
          c.req.param("id"),
          c.req.param("invitationId"),
          await json(c.req.raw),
        ),
      ),
  );
  return app;
}
