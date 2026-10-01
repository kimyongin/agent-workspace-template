// T02-1 실험 2: MCP 서버(Streamable HTTP)와 토큰 audience 고정. 격리 로컬 실험 전용.
import { createMcpHandler, McpServer } from "npm:@modelcontextprotocol/server@2.2.0";
import { pipeline } from "npm:@supabase/middleware@1.0.0";
import { withOAuthProtectedResource, withSupabase } from "npm:@supabase/server@1.9.0";

const MCP_URL = "http://127.0.0.1:55321/functions/v1/exp2-mcp";

Deno.serve(
  pipeline(
    [withOAuthProtectedResource(), withSupabase({ auth: "user", audience: MCP_URL, cors: false })],
    async (req, ctx) => {
      const handler = createMcpHandler(() => {
        const server = new McpServer({ name: "exp2", version: "0.0.1" });
        server.registerTool(
          "whoami",
          { description: "Return the verified token claims (experiment only)", annotations: { readOnlyHint: true } },
          async () => {
            const c = (ctx.jwtClaims ?? {}) as Record<string, unknown>;
            const pick = { sub: c.sub, aud: c.aud, client_id: c.client_id, role: c.role, iss: c.iss };
            return { content: [{ type: "text", text: JSON.stringify(pick) }] };
          },
        );
        return server;
      }, { onerror: (e) => console.error("MCP request failed", e) });
      return handler.fetch(req);
    },
  ),
);
